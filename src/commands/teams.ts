/**
 * `teams.send` — Send a message to Microsoft Teams via the agency teams MCP.
 *
 * Targets (mutually exclusive):
 *   --team-id <id> --channel-id <id>   → PostChannelMessage
 *   --chat-id <id>                     → PostMessage
 *   --self                             → SendMessageToSelf
 *
 * Message source: --message "text" or piped input (joined as string).
 *
 * Usage in .lobster workflows:
 *   copilot --prompt "Summarise PRs" | teams.send --team-id abc --channel-id def
 *   teams.send --self --message "Reminder: deploy at 5pm"
 */

import type { LobsterCommand } from "./copilot.js";
import { resolveServer, callTool } from "../mcp-client/client.js";
import type { McpServerConfig } from "../mcp-config/loader.js";

function asStream(items: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

/** Collect piped input into a single message string. */
async function collectInput(input: AsyncIterable<unknown>): Promise<string> {
  const parts: string[] = [];
  for await (const item of input) {
    if (typeof item === "string") {
      parts.push(item);
    } else if (item && typeof item === "object") {
      // If the item has a text/content/message field, use that
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

export function createTeamsSendCommand(
  getServers: () => Record<string, McpServerConfig>,
): LobsterCommand {
  return {
    name: "teams.send",
    meta: {
      description: "Send a message to Microsoft Teams (channel, chat, or self)",
      argsSchema: {
        type: "object",
        properties: {
          "team-id": { type: "string", description: "Team GUID (for channel messages)" },
          "channel-id": { type: "string", description: "Channel ID (for channel messages)" },
          "chat-id": { type: "string", description: "Chat ID (for chat messages)" },
          self: { type: "boolean", description: "Send to self (Notes to Self)" },
          message: { type: "string", description: "Message content (or pipe input)" },
          subject: { type: "string", description: "Subject line (channel messages only)" },
          importance: { type: "string", description: "normal | high | urgent" },
        },
      },
      sideEffects: ["network"],
    },
    help() {
      return [
        "teams.send — Send a message to Microsoft Teams",
        "",
        "Usage:",
        "  teams.send --team-id <GUID> --channel-id <ID> --message 'Hello'",
        "  teams.send --chat-id <ID> --message 'Hello'",
        "  teams.send --self --message 'Reminder'",
        "  copilot --prompt '...' | teams.send --team-id <GUID> --channel-id <ID>",
        "",
        "Options:",
        "  --team-id      Team GUID (required for channel messages)",
        "  --channel-id   Channel ID (required for channel messages)",
        "  --chat-id      Chat ID (for direct/group chat messages)",
        "  --self         Send to yourself (Notes to Self)",
        "  --message      Message text (if omitted, uses piped input)",
        "  --subject      Subject line (channel messages only)",
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
      const teamId = args["team-id"] as string | undefined;
      const channelId = args["channel-id"] as string | undefined;
      const chatId = args["chat-id"] as string | undefined;
      const isSelf = args.self === true || args.self === "true";
      const subject = args.subject as string | undefined;
      const importance = args.importance as string | undefined;

      // Determine message content
      let message = args.message as string | undefined;
      if (!message) {
        const piped = await collectInput(input);
        if (piped.trim()) {
          message = piped;
        }
      } else {
        // Drain input even if not used
        for await (const _ of input) { /* no-op */ }
      }

      if (!message) {
        throw new Error("teams.send: no message provided (use --message or pipe input)");
      }

      // Determine which MCP tool to call
      let toolName: string;
      let toolArgs: Record<string, unknown>;

      if (teamId && channelId) {
        toolName = "PostChannelMessage";
        toolArgs = {
          teamId,
          channelId,
          content: message,
          ...(subject ? { subject } : {}),
          ...(importance ? { importance } : {}),
        };
      } else if (chatId) {
        toolName = "PostMessage";
        toolArgs = {
          chatId,
          content: message,
          ...(importance ? { importance } : {}),
        };
      } else if (isSelf) {
        toolName = "SendMessageToSelf";
        toolArgs = {
          content: message,
          ...(importance ? { importance } : {}),
        };
      } else {
        throw new Error(
          "teams.send: specify a target — --team-id + --channel-id, --chat-id, or --self",
        );
      }

      // Call the agency teams MCP
      const config = resolveServer("teams", getServers());
      const timeout = typeof (config as any).timeout === "number"
        ? (config as any).timeout * 1000
        : undefined;

      const result = await callTool(config, toolName, toolArgs, timeout);

      if (result.isError) {
        const errMsg = result.content
          .map((c: any) => (typeof c === "string" ? c : c?.text ?? JSON.stringify(c)))
          .join("\n");
        throw new Error(`teams.send (${toolName}): ${errMsg}`);
      }

      return { output: asStream(result.content as unknown[]) };
    },
  };
}
