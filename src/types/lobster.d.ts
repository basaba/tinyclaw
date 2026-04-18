declare module "@clawdbot/lobster/core" {
  export function runToolRequest(params: {
    pipeline?: string;
    filePath?: string;
    args?: Record<string, unknown>;
    ctx?: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      llmAdapters?: Record<string, any>;
      [key: string]: any;
    };
  }): Promise<{
    protocolVersion: 1;
    ok: boolean;
    status?: "ok" | "needs_approval" | "needs_input" | "cancelled";
    output?: any[];
    requiresApproval?: {
      prompt: string;
      items: unknown[];
      preview?: string;
      resumeToken?: string;
    } | null;
    requiresInput?: {
      prompt: string;
      responseSchema: unknown;
      defaults?: unknown;
      subject?: unknown;
      resumeToken?: string;
    } | null;
    error?: { type: string; message: string };
  }>;

  export function createToolContext(ctx?: any): any;
  export function createDefaultRegistry(): any;
  export function parsePipeline(pipeline: string): any;
  export function runPipeline(params: any): any;
  export function runWorkflowFile(params: any): any;
}

declare module "@clawdbot/lobster" {
  export class Lobster {
    constructor(options?: any);
    pipe(stage: any): this;
    meta(meta: any): this;
    run(initialInput?: any[]): Promise<any>;
    resume(token: string, options?: any): Promise<any>;
  }
  export function approve(options?: any): any;
  export function exec(command: string): any;
  export function stateGet(key: string): any;
  export function stateSet(key: string): any;
}
