import { randomUUID } from "node:crypto";
import { CopilotBridgeClient, type CopilotBridgeConfig } from "../copilot/client.js";
import { loadMcpConfig, type McpServerConfig } from "../mcp-config/loader.js";

// ── Lobster-compatible types ────────────────────────────────────────

export type LlmResponseEnvelope = {
  ok: boolean;
  result?: LlmResult | null;
  error?: { message?: string } | null;
};

export type LlmResult = {
  runId?: string | null;
  model?: string | null;
  prompt?: string | null;
  status?: string | null;
  output?: { text?: string | null; data?: any; format?: string | null } | null;
  usage?: Record<string, unknown> | null;
  warnings?: string[] | null;
  metadata?: Record<string, unknown> | null;
  diagnostics?: Record<string, unknown> | null;
};

export type AdapterParams = {
  env: any;
  args: any;
  payload: Record<string, any>;
  ctx: any;
};

export type DirectAdapter = {
  source: string;
  invoke: (params: AdapterParams) => Promise<LlmResponseEnvelope>;
};

// ── Configuration ───────────────────────────────────────────────────

export interface CopilotAdapterOptions extends CopilotBridgeConfig {
  /** Max characters per artifact before truncation (default: 8000) */
  maxArtifactChars?: number;
  /** Default model to use when workflow doesn't specify one */
  defaultModel?: string;
  /** Default reasoning effort level */
  defaultReasoningEffort?: "low" | "medium" | "high" | "xhigh";
  /** MCP servers to attach (already resolved configs) */
  mcpServers?: Record<string, McpServerConfig>;
  /** Path to mcp.json config file (alternative to passing mcpServers directly) */
  mcpConfigPath?: string;
}

const DEFAULT_MAX_ARTIFACT_CHARS = 8000;

const COPILOT_ADAPTER_SYSTEM_PROMPT = `You are an LLM execution engine for Lobster workflow pipelines. You receive structured task prompts and return precise outputs suitable for automated consumption.

Rules:
- When a JSON output schema is provided, respond with ONLY valid JSON. No prose, no code fences, no explanation.
- When no schema is provided, respond with clear, structured text.
- Use artifact context to inform your response.
- Be deterministic — same input should produce consistent output.
- If information is insufficient, indicate what is missing rather than fabricating data.`;

// ── Adapter implementation ──────────────────────────────────────────

export class CopilotAdapter implements DirectAdapter {
  readonly source = "copilot";

  private client: CopilotBridgeClient;
  private started = false;
  private startPromise: Promise<void> | null = null;
  private options: CopilotAdapterOptions;

  constructor(options: CopilotAdapterOptions = {}) {
    this.options = options;

    // Resolve MCP servers: explicit mcpServers > mcpConfigPath > auto-discover
    const mcpServers = options.mcpServers
      ?? (options.mcpConfigPath ? loadMcpConfig({ configPath: options.mcpConfigPath }) : undefined);

    this.client = new CopilotBridgeClient({
      cliUrl: options.cliUrl,
      apiKey: options.apiKey,
      ...(mcpServers && Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
    });
    // Bind invoke so it works when Lobster extracts it via `direct.invoke`
    this.invoke = this.invoke.bind(this);
  }

  /** Lazy-start the underlying Copilot client on first call. */
  private async ensureStarted(): Promise<void> {
    if (this.started) return;
    if (!this.startPromise) {
      this.startPromise = this.client.start().then(() => {
        this.started = true;
      });
    }
    await this.startPromise;
  }

  /** Clean up the Copilot client. */
  async dispose(): Promise<void> {
    if (this.started) {
      await this.client.stop();
      this.started = false;
      this.startPromise = null;
    }
  }

  async invoke(params: AdapterParams): Promise<LlmResponseEnvelope> {
    const { payload } = params;
    const warnings: string[] = [];
    const runId = randomUUID();

    // Resolve model: workflow payload > adapter default > none (SDK picks)
    const model = payload.model ?? this.options.defaultModel ?? this.options.model;
    const reasoningEffort = this.options.defaultReasoningEffort ?? this.options.reasoningEffort;

    if (payload.temperature !== undefined) {
      warnings.push("copilot adapter: temperature parameter is not supported and was ignored");
    }
    if (payload.maxOutputTokens !== undefined) {
      warnings.push("copilot adapter: maxOutputTokens parameter is not supported and was ignored");
    }

    const prompt = buildPrompt(payload, this.options.maxArtifactChars ?? DEFAULT_MAX_ARTIFACT_CHARS);
    const hasSchema = Boolean(payload.outputSchema);
    const modelLabel = model ?? "copilot";

    try {
      await this.ensureStarted();
      const rawResponse = await this.client.reason(
        prompt,
        undefined,
        COPILOT_ADAPTER_SYSTEM_PROMPT,
        { model, reasoningEffort },
      );

      if (hasSchema) {
        return buildJsonResponse(rawResponse, payload, runId, warnings, modelLabel);
      }

      return {
        ok: true,
        result: {
          runId,
          model: modelLabel,
          prompt: payload.prompt,
          status: "completed",
          output: { text: rawResponse, format: "text" },
          ...(warnings.length ? { warnings } : {}),
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: {
          message: `copilot adapter error: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }
  }
}

// ── Prompt assembly ─────────────────────────────────────────────────

export function buildPrompt(payload: Record<string, any>, maxArtifactChars: number): string {
  const sections: string[] = [];

  // Task
  sections.push(`<task>\n${payload.prompt}\n</task>`);

  // Artifacts
  const artifacts: any[] = payload.artifacts ?? [];
  if (artifacts.length > 0) {
    const artifactLines: string[] = [];
    const hashes: string[] = payload.artifactHashes ?? [];

    for (let i = 0; i < artifacts.length; i++) {
      const art = artifacts[i];
      const hash = hashes[i] ? ` hash="${hashes[i].slice(0, 12)}…"` : "";
      const kind = art.kind ?? "unknown";
      const name = art.name ? ` name="${art.name}"` : "";

      let content: string;
      if (art.text !== undefined) {
        content = String(art.text);
      } else if (art.data !== undefined) {
        content = JSON.stringify(art.data, null, 2);
      } else {
        content = JSON.stringify(art, null, 2);
      }

      if (content.length > maxArtifactChars) {
        content = content.slice(0, maxArtifactChars) + `\n… [truncated, ${content.length} chars total]`;
      }

      artifactLines.push(`<artifact index="${i}" kind="${kind}"${name}${hash}>\n${content}\n</artifact>`);
    }

    sections.push(`<artifacts>\n${artifactLines.join("\n")}\n</artifacts>`);
  }

  // Output schema
  if (payload.outputSchema) {
    sections.push(
      `<output_schema>\nYour response MUST be valid JSON conforming to this schema:\n${JSON.stringify(payload.outputSchema, null, 2)}\nRespond with ONLY the JSON object/array. No prose, no fences.\n</output_schema>`,
    );
  }

  // Retry context
  if (payload.retryContext) {
    const rc = payload.retryContext;
    const lines = [`Attempt ${rc.attempt}. Your previous output failed validation.`];
    if (rc.validationErrors?.length) {
      lines.push("Validation errors:");
      for (const err of rc.validationErrors) {
        lines.push(`  - ${err}`);
      }
    }
    lines.push("Return ONLY corrected JSON that satisfies the schema.");
    sections.push(`<retry_feedback>\n${lines.join("\n")}\n</retry_feedback>`);
  }

  return sections.join("\n\n");
}

// ── JSON extraction & response building ─────────────────────────────

export function extractJson(text: string): { data: any; raw: string } | null {
  const trimmed = text.trim();

  // 1. Try full-string parse
  try {
    return { data: JSON.parse(trimmed), raw: trimmed };
  } catch {
    // continue
  }

  // 2. Try fenced code blocks (```json ... ``` or ``` ... ```)
  const fencePattern = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/g;
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(text)) !== null) {
    const candidate = match[1].trim();
    try {
      return { data: JSON.parse(candidate), raw: candidate };
    } catch {
      // try next fence
    }
  }

  // 3. Try balanced top-level JSON object or array extraction
  const firstBrace = trimmed.indexOf("{");
  const firstBracket = trimmed.indexOf("[");
  const starts: Array<{ pos: number; open: string; close: string }> = [];
  if (firstBrace >= 0) starts.push({ pos: firstBrace, open: "{", close: "}" });
  if (firstBracket >= 0) starts.push({ pos: firstBracket, open: "[", close: "]" });
  starts.sort((a, b) => a.pos - b.pos);

  for (const { pos, open, close } of starts) {
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = pos; i < trimmed.length; i++) {
      const ch = trimmed[i];

      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === open) depth++;
      else if (ch === close) depth--;

      if (depth === 0) {
        const candidate = trimmed.slice(pos, i + 1);
        try {
          return { data: JSON.parse(candidate), raw: candidate };
        } catch {
          break;
        }
      }
    }
  }

  return null;
}

function buildJsonResponse(
  rawResponse: string,
  payload: Record<string, any>,
  runId: string,
  warnings: string[],
  model: string,
): LlmResponseEnvelope {
  const extracted = extractJson(rawResponse);

  if (!extracted) {
    return {
      ok: true,
      result: {
        runId,
        model,
        prompt: payload.prompt,
        status: "completed",
        output: { text: rawResponse, format: "text" },
        warnings: [...warnings, "copilot adapter: failed to extract JSON from response"],
        diagnostics: { rawResponse },
      },
    };
  }

  return {
    ok: true,
    result: {
      runId,
      model,
      prompt: payload.prompt,
      status: "completed",
      output: { text: extracted.raw, data: extracted.data, format: "json" },
      ...(warnings.length ? { warnings } : {}),
    },
  };
}
