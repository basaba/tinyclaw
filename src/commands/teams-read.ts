/**
 * Teams read/search commands for deterministic Teams channel operations.
 *
 * `teams.messages` — List root messages in a Teams channel.
 * `teams.replies`  — List replies to a specific channel message thread.
 * `teams.reply`    — Reply to a channel message thread.
 *
 * All read commands normalise output to include `bodyText` (HTML-stripped).
 */

import type { LobsterCommand } from "./copilot.js";
import { resolveServer, callTool } from "../mcp-client/client.js";
import type { McpServerConfig } from "../mcp-config/loader.js";
import { markdownToTeamsHtml, sanitizeForTeams } from "./teams-html.js";
import { appendWatermark } from "./watermark.js";

// ── Helpers ──────────────────────────────────────────────────────────

function asStream(items: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

async function drain(input: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of input) { /* no-op */ }
}

/** Collect piped input into a single message string. */
async function collectInput(input: AsyncIterable<unknown>): Promise<string> {
  const parts: string[] = [];
  for await (const item of input) {
    if (typeof item === "string") {
      parts.push(item);
    } else if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const text = obj.text ?? obj.content ?? obj.message ?? obj.output;
      if (typeof text === "string") {
        parts.push(text);
      } else {
        parts.push(JSON.stringify(item, null, 2));
      }
    }
  }
  return parts.join("\n");
}

/** Strip HTML tags to produce plain text. */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Normalise a Teams message object from MCP response. */
function normaliseMessage(
  msg: Record<string, unknown>,
  rootMessageId?: string,
  teamId?: string,
  channelId?: string,
): Record<string, unknown> {
  const body = msg.body as Record<string, unknown> | undefined;
  const bodyHtml = (body?.content as string) ?? "";
  const bodyText = stripHtml(bodyHtml);
  const sender = msg.from as Record<string, unknown> | undefined;
  const senderUser = sender?.user as Record<string, unknown> | undefined;

  return {
    id: msg.id,
    rootMessageId: rootMessageId ?? (msg.id as string),
    teamId: teamId ?? "",
    channelId: channelId ?? "",
    sender: senderUser?.displayName ?? "",
    senderId: senderUser?.id ?? "",
    createdDateTime: msg.createdDateTime ?? "",
    lastModifiedDateTime: msg.lastModifiedDateTime ?? "",
    subject: msg.subject ?? "",
    bodyText,
    bodyHtml,
    preview: bodyText.substring(0, 200),
  };
}

/** Unwrap MCP tool result content into an array of parsed objects. */
function unwrapMcpContent(content: unknown[]): unknown[] {
  const results: unknown[] = [];
  for (const c of content) {
    const item = c as Record<string, unknown>;
    if (item?.type === "text" && typeof item.text === "string") {
      try {
        const parsed = JSON.parse(item.text);
        if (Array.isArray(parsed)) {
          results.push(...parsed);
        } else if (parsed && typeof parsed === "object") {
          // MCP/Graph may wrap in { value: [...] } or { messages: [...] }
          const obj = parsed as Record<string, unknown>;
          const arr = obj.value ?? obj.messages ?? obj.replies;
          if (Array.isArray(arr)) {
            results.push(...arr);
          } else {
            results.push(parsed);
          }
        } else {
          results.push(parsed);
        }
      } catch {
        results.push(item.text);
      }
    } else {
      results.push(c);
    }
  }
  return results;
}

// ── teams.messages ───────────────────────────────────────────────────

export function createTeamsMessagesCommand(
  getServers: () => Record<string, McpServerConfig>,
): LobsterCommand {
  return {
    name: "teams.messages",
    meta: {
      description: "List root messages in a Teams channel",
      argsSchema: {
        type: "object",
        properties: {
          "team-id": { type: "string", description: "Team GUID" },
          "channel-id": { type: "string", description: "Channel ID" },
          top: { type: "number", description: "Max messages to return (default 20, max 50)" },
        },
        required: ["team-id", "channel-id"],
      },
      sideEffects: ["network"],
    },
    help() {
      return [
        "teams.messages — List root messages in a Teams channel",
        "",
        "Usage:",
        "  teams.messages --team-id <GUID> --channel-id <ID>",
        "  teams.messages --team-id <GUID> --channel-id <ID> --top 50",
        "",
        "Options:",
        "  --team-id      Team GUID (required)",
        "  --channel-id   Channel ID (required)",
        "  --top          Max messages to return (default 20, max 50)",
        "",
        "Output fields:",
        "  id, rootMessageId, teamId, channelId, sender, createdDateTime,",
        "  subject, bodyText (HTML-stripped), bodyHtml, preview",
      ].join("\n");
    },
    async run({
      input,
      args,
    }: {
      input: AsyncIterable<unknown>;
      args: Record<string, unknown>;
    }) {
      await drain(input);

      const teamId = args["team-id"] as string;
      const channelId = args["channel-id"] as string;
      const top = args.top !== undefined ? Number(args.top) : undefined;

      if (!teamId) throw new Error("teams.messages: --team-id is required");
      if (!channelId) throw new Error("teams.messages: --channel-id is required");

      const config = resolveServer("teams", getServers());
      const timeout = typeof (config as any).timeout === "number"
        ? (config as any).timeout * 1000
        : undefined;

      const toolArgs: Record<string, unknown> = { teamId, channelId };
      if (top !== undefined) toolArgs.top = top;

      const result = await callTool(config, "ListChannelMessages", toolArgs, timeout);

      if (result.isError) {
        const errMsg = result.content
          .map((c: any) => c?.text ?? JSON.stringify(c))
          .join("\n");
        throw new Error(`teams.messages: ${errMsg}`);
      }

      const messages = unwrapMcpContent(result.content as unknown[]);
      const normalised = messages
        .filter((m): m is Record<string, unknown> => typeof m === "object" && m !== null)
        .map((m) => normaliseMessage(m, undefined, teamId, channelId));

      return { output: asStream(normalised) };
    },
  };
}

// ── teams.replies ────────────────────────────────────────────────────

export function createTeamsRepliesCommand(
  getServers: () => Record<string, McpServerConfig>,
): LobsterCommand {
  return {
    name: "teams.replies",
    meta: {
      description: "List replies to a channel message thread",
      argsSchema: {
        type: "object",
        properties: {
          "team-id": { type: "string", description: "Team GUID" },
          "channel-id": { type: "string", description: "Channel ID" },
          "message-id": { type: "string", description: "Root message ID to get replies for" },
          top: { type: "number", description: "Max replies to return (default 50)" },
        },
        required: ["team-id", "channel-id"],
      },
      sideEffects: ["network"],
    },
    help() {
      return [
        "teams.replies — List replies to a channel message thread",
        "",
        "Usage:",
        "  teams.replies --team-id <GUID> --channel-id <ID> --message-id <ID>",
        "  <input> | teams.replies --team-id <GUID> --channel-id <ID>",
        "",
        "Options:",
        "  --team-id      Team GUID (required)",
        "  --channel-id   Channel ID (required)",
        "  --message-id   Root message ID (or use piped input's id/messageId field)",
        "  --top          Max replies to return (default 50)",
        "",
        "Output fields:",
        "  id, rootMessageId, teamId, channelId, sender, createdDateTime,",
        "  bodyText (HTML-stripped), bodyHtml, preview",
      ].join("\n");
    },
    async run({
      input,
      args,
    }: {
      input: AsyncIterable<unknown>;
      args: Record<string, unknown>;
    }) {
      const teamId = args["team-id"] as string;
      const channelId = args["channel-id"] as string;
      let messageId = args["message-id"] as string | undefined;
      const top = args.top !== undefined ? Number(args.top) : undefined;

      if (!teamId) throw new Error("teams.replies: --team-id is required");
      if (!channelId) throw new Error("teams.replies: --channel-id is required");

      // If no --message-id, try to get it from piped input
      if (!messageId) {
        for await (const item of input) {
          if (typeof item === "object" && item !== null) {
            const obj = item as Record<string, unknown>;
            messageId = (obj.messageId ?? obj.rootMessageId ?? obj.id) as string | undefined;
            if (messageId) break;
          }
        }
      } else {
        await drain(input);
      }

      if (!messageId) {
        throw new Error("teams.replies: --message-id is required (or pipe input with id/messageId)");
      }

      const config = resolveServer("teams", getServers());
      const timeout = typeof (config as any).timeout === "number"
        ? (config as any).timeout * 1000
        : undefined;

      const toolArgs: Record<string, unknown> = { teamId, channelId, messageId };
      if (top !== undefined) toolArgs.maxReplies = top;

      const result = await callTool(config, "ListChannelMessageReplies", toolArgs, timeout);

      if (result.isError) {
        const errMsg = result.content
          .map((c: any) => c?.text ?? JSON.stringify(c))
          .join("\n");
        throw new Error(`teams.replies: ${errMsg}`);
      }

      const replies = unwrapMcpContent(result.content as unknown[]);
      const normalised = replies
        .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
        .map((r) => normaliseMessage(r, messageId, teamId, channelId));

      return { output: asStream(normalised) };
    },
  };
}

// ── teams.reply ──────────────────────────────────────────────────────

export function createTeamsReplyCommand(
  getServers: () => Record<string, McpServerConfig>,
): LobsterCommand {
  return {
    name: "teams.reply",
    meta: {
      description: "Reply to a channel message thread in Teams",
      argsSchema: {
        type: "object",
        properties: {
          "team-id": { type: "string", description: "Team GUID" },
          "channel-id": { type: "string", description: "Channel ID" },
          "message-id": { type: "string", description: "Root message ID to reply to" },
          message: { type: "string", description: "Reply content (or pipe input)" },
          markdown: { type: "boolean", description: "Convert markdown to HTML before sending" },
          "content-type": { type: "string", description: "Content type: text (default) or html" },
          importance: { type: "string", description: "normal | high | urgent" },
        },
        required: ["team-id", "channel-id", "message-id"],
      },
      sideEffects: ["network"],
    },
    help() {
      return [
        "teams.reply — Reply to a channel message thread in Teams",
        "",
        "Usage:",
        "  teams.reply --team-id <GUID> --channel-id <ID> --message-id <ID> --message 'text'",
        "  copilot --prompt '...' | teams.reply --team-id <GUID> --channel-id <ID> --message-id <ID>",
        "  copilot --prompt '...' | teams.reply --team-id <GUID> --channel-id <ID> --message-id <ID> --markdown",
        "",
        "Options:",
        "  --team-id      Team GUID (required)",
        "  --channel-id   Channel ID (required)",
        "  --message-id   Root message ID to reply to (required)",
        "  --message      Reply text (if omitted, uses piped input)",
        "  --markdown     Convert piped markdown to HTML before sending",
        "  --content-type Content type: text (default) or html",
        "  --importance   normal (default) | high | urgent",
      ].join("\n");
    },
    async run({
      input,
      args,
    }: {
      input: AsyncIterable<unknown>;
      args: Record<string, unknown>;
    }) {
      const teamId = args["team-id"] as string;
      const channelId = args["channel-id"] as string;
      const messageId = args["message-id"] as string;
      const useMarkdown = args.markdown === true || args.markdown === "true";
      let contentType = (args["content-type"] as string | undefined)?.toLowerCase() === "html" || useMarkdown ? "html" : undefined;
      const importance = args.importance as string | undefined;

      if (!teamId) throw new Error("teams.reply: --team-id is required");
      if (!channelId) throw new Error("teams.reply: --channel-id is required");
      if (!messageId) throw new Error("teams.reply: --message-id is required");

      // Determine message content
      let message = args.message as string | undefined;
      if (!message) {
        const piped = await collectInput(input);
        if (piped.trim()) {
          message = piped;
        }
      } else {
        await drain(input);
      }

      if (!message) {
        throw new Error("teams.reply: no message provided (use --message or pipe input)");
      }

      // Convert markdown to Teams-safe HTML
      if (useMarkdown) {
        message = await markdownToTeamsHtml(message);
      } else if (contentType === "html") {
        message = sanitizeForTeams(message);
      }

      message = appendWatermark(message, contentType === "html");

      const config = resolveServer("teams", getServers());
      const timeout = typeof (config as any).timeout === "number"
        ? (config as any).timeout * 1000
        : undefined;

      const toolArgs: Record<string, unknown> = {
        teamId,
        channelId,
        messageId,
        content: message,
        ...(contentType ? { contentType } : {}),
        ...(importance ? { importance } : {}),
      };

      const result = await callTool(config, "ReplyToChannelMessage", toolArgs, timeout);

      if (result.isError) {
        const errMsg = result.content
          .map((c: any) => c?.text ?? JSON.stringify(c))
          .join("\n");
        throw new Error(`teams.reply: ${errMsg}`);
      }

      return { output: asStream(result.content as unknown[]) };
    },
  };
}
