/**
 * `mail.send`   — Send an email via the agency mail MCP.
 * `mail.search` — Search emails via the agency mail MCP.
 * `mail.read`   — Read a specific email by ID via the agency mail MCP.
 *
 * Usage in .lobster workflows:
 *   copilot --prompt "Summarise PRs" | mail.send --to alice@example.com --subject "PR Summary"
 *   mail.search --query "from:bob subject:deploy" | mail.read
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
      const obj = item as Record<string, unknown>;
      const text = obj.text ?? obj.content ?? obj.message ?? obj.body ?? obj.output;
      if (typeof text === "string") {
        parts.push(text);
      } else {
        parts.push(JSON.stringify(item, null, 2));
      }
    }
  }
  return parts.join("\n");
}

/** Drain an async iterable without using the values. */
async function drain(input: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of input) { /* no-op */ }
}

function getMailConfig(getServers: () => Record<string, McpServerConfig>) {
  const config = resolveServer("mail", getServers());
  const timeout = typeof (config as any).timeout === "number"
    ? (config as any).timeout * 1000
    : undefined;
  return { config, timeout };
}

function handleError(toolName: string, result: any): never {
  const errMsg = result.content
    .map((c: any) => (typeof c === "string" ? c : c?.text ?? JSON.stringify(c)))
    .join("\n");
  throw new Error(`${toolName}: ${errMsg}`);
}

// ── mail.send ──────────────────────────────────────────────────────

export function createMailSendCommand(
  getServers: () => Record<string, McpServerConfig>,
): LobsterCommand {
  return {
    name: "mail.send",
    meta: {
      description: "Send an email via Microsoft 365 (agency mail MCP)",
      argsSchema: {
        type: "object",
        properties: {
          to: { type: "string", description: "Comma-separated To recipients (names or emails)" },
          cc: { type: "string", description: "Comma-separated Cc recipients" },
          bcc: { type: "string", description: "Comma-separated Bcc recipients" },
          subject: { type: "string", description: "Email subject" },
          body: { type: "string", description: "Email body (or pipe input)" },
          "content-type": { type: "string", description: "Text (default) or HTML" },
          draft: { type: "boolean", description: "Create a draft instead of sending" },
        },
      },
      sideEffects: ["network"],
    },
    help() {
      return [
        "mail.send — Send an email via Microsoft 365",
        "",
        "Usage:",
        "  mail.send --to 'alice@example.com' --subject 'Hello' --body 'Hi there'",
        "  mail.send --to 'Alice, Bob' --subject 'Report' --draft",
        "  copilot --prompt '...' | mail.send --to alice@example.com --subject 'Summary'",
        "",
        "Options:",
        "  --to             To recipients (comma-separated names or emails)",
        "  --cc             Cc recipients (comma-separated)",
        "  --bcc            Bcc recipients (comma-separated)",
        "  --subject        Email subject line",
        "  --body           Email body (if omitted, uses piped input)",
        "  --content-type   Text (default) or HTML",
        "  --draft          Create a draft instead of sending immediately",
      ].join("\n");
    },
    async run({
      input,
      args,
    }: {
      input: AsyncIterable<unknown>;
      args: Record<string, unknown>;
    }) {
      const to = args.to as string | undefined;
      const cc = args.cc as string | undefined;
      const bcc = args.bcc as string | undefined;
      const subject = args.subject as string | undefined;
      const contentType = args["content-type"] as string | undefined;
      const isDraft = args.draft === true || args.draft === "true";

      // Determine body content
      let body = args.body as string | undefined;
      if (!body) {
        const piped = await collectInput(input);
        if (piped.trim()) body = piped;
      } else {
        await drain(input);
      }

      if (!to && !isDraft) {
        throw new Error("mail.send: --to is required (or use --draft for drafts without recipients)");
      }

      const splitRecipients = (s: string | undefined) =>
        s ? s.split(",").map((r) => r.trim()).filter(Boolean) : undefined;

      const { config, timeout } = getMailConfig(getServers);

      const toolName = isDraft ? "CreateDraftMessage" : "SendEmailWithAttachments";
      const toolArgs: Record<string, unknown> = {
        ...(splitRecipients(to) ? { to: splitRecipients(to) } : {}),
        ...(splitRecipients(cc) ? { cc: splitRecipients(cc) } : {}),
        ...(splitRecipients(bcc) ? { bcc: splitRecipients(bcc) } : {}),
        ...(subject ? { subject } : {}),
        ...(body ? { body } : {}),
        ...(contentType ? { contentType } : {}),
      };

      const result = await callTool(config, toolName, toolArgs, timeout);
      if (result.isError) handleError(`mail.send (${toolName})`, result);

      return { output: asStream(result.content as unknown[]) };
    },
  };
}

// ── mail.search ────────────────────────────────────────────────────

// Well-known folder IDs: https://learn.microsoft.com/en-us/graph/api/resources/mailfolder
const WELL_KNOWN_FOLDERS: Record<string, string> = {
  inbox: "inbox",
  drafts: "drafts",
  sent: "sentitems",
  deleted: "deleteditems",
  junk: "junkemail",
  archive: "archive",
};

export function createMailSearchCommand(
  getServers: () => Record<string, McpServerConfig>,
): LobsterCommand {
  return {
    name: "mail.search",
    meta: {
      description: "Search emails in Microsoft 365 mailbox",
      argsSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural language search query (uses AI-powered SearchMessages)" },
          search: { type: "string", description: "KQL keyword search (e.g. 'from:alice subject:budget')" },
          filter: { type: "string", description: "OData $filter expression (e.g. 'isRead eq false')" },
          folder: { type: "string", description: "Folder: inbox, drafts, sent, deleted, junk, archive" },
          top: { type: "number", description: "Max results to return (default 25)" },
          unread: { type: "boolean", description: "Shorthand for --filter 'isRead eq false'" },
        },
      },
      sideEffects: ["network"],
    },
    help() {
      return [
        "mail.search — Search emails in Microsoft 365 mailbox",
        "",
        "Usage (natural language — AI-powered):",
        "  mail.search --query 'emails from John about the project'",
        "  mail.search --query 'unread messages from last week'",
        "",
        "Usage (deterministic — KQL search):",
        "  mail.search --search 'from:alice subject:budget'",
        "  mail.search --search 'to:bob report' --folder inbox",
        "",
        "Usage (deterministic — OData filter):",
        "  mail.search --filter 'isRead eq false' --top 10",
        "  mail.search --filter 'hasAttachments eq true' --folder inbox",
        "  mail.search --unread --folder inbox --top 5",
        "",
        "Options:",
        "  --query    Natural language search (AI-powered, cannot combine with --search/--filter)",
        "  --search   KQL keyword search (from:, to:, subject:, cc:, bcc:)",
        "  --filter   OData $filter (subject, isRead, isDraft, hasAttachments, importance, receivedDateTime)",
        "  --folder   Restrict to folder: inbox, drafts, sent, deleted, junk, archive",
        "  --top      Max results (default 25)",
        "  --unread   Shorthand for --filter 'isRead eq false'",
        "",
        "Notes:",
        "  --search cannot be combined with --filter (Graph API limitation).",
        "  --folder works with both --search and --filter modes.",
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

      const query = args.query as string | undefined;
      const search = args.search as string | undefined;
      let filter = args.filter as string | undefined;
      const folder = args.folder as string | undefined;
      const top = args.top !== undefined ? Number(args.top) : undefined;
      const unread = args.unread === true || args.unread === "true";

      if (unread && !filter) {
        filter = "isRead eq false";
      }

      if (!query && !search && !filter) {
        throw new Error("mail.search: provide --query, --search, or --filter");
      }

      if (query && (search || filter)) {
        throw new Error("mail.search: --query (AI search) cannot be combined with --search or --filter");
      }

      const { config, timeout } = getMailConfig(getServers);

      // Natural language mode → SearchMessages
      if (query) {
        const result = await callTool(config, "SearchMessages", { message: query }, timeout);
        if (result.isError) handleError("mail.search", result);
        return { output: asStream(result.content as unknown[]) };
      }

      // Deterministic mode → SearchMessagesQueryParameters
      const params: string[] = [];

      if (search) {
        params.push(`$search="${search}"`);
      }
      if (filter) {
        if (search) {
          throw new Error("mail.search: --search and --filter cannot be combined (Graph API limitation)");
        }
        // If folder is specified, add parentFolderId filter
        if (folder) {
          const folderId = WELL_KNOWN_FOLDERS[folder.toLowerCase()] ?? folder;
          filter = `(${filter}) and parentFolderId eq '${folderId}'`;
        }
        params.push(`$filter=${filter}`);
      } else if (folder && !search) {
        const folderId = WELL_KNOWN_FOLDERS[folder.toLowerCase()] ?? folder;
        params.push(`$filter=parentFolderId eq '${folderId}'`);
      }

      params.push(`$top=${top ?? 25}`);

      const queryParameters = `?${params.join("&")}`;
      const result = await callTool(
        config,
        "SearchMessagesQueryParameters",
        { queryParameters },
        timeout,
      );
      if (result.isError) handleError("mail.search", result);

      return { output: asStream(result.content as unknown[]) };
    },
  };
}

// ── mail.read ──────────────────────────────────────────────────────

export function createMailReadCommand(
  getServers: () => Record<string, McpServerConfig>,
): LobsterCommand {
  return {
    name: "mail.read",
    meta: {
      description: "Read a specific email by message ID",
      argsSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Message ID" },
          html: { type: "boolean", description: "Return HTML body" },
          "preview-only": { type: "boolean", description: "Return body preview only (~255 chars)" },
        },
      },
      sideEffects: ["network"],
    },
    help() {
      return [
        "mail.read — Read a specific email by message ID",
        "",
        "Usage:",
        "  mail.read --id <messageId>",
        "  mail.read --id <messageId> --html",
        "  mail.read --id <messageId> --preview-only",
        "",
        "Options:",
        "  --id             Message ID (required)",
        "  --html           Return HTML body format",
        "  --preview-only   Return body preview only (~255 chars)",
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

      const id = args.id as string | undefined;
      if (!id) {
        throw new Error("mail.read: --id is required");
      }

      const preferHtml = args.html === true || args.html === "true";
      const previewOnly = args["preview-only"] === true || args["preview-only"] === "true";

      const { config, timeout } = getMailConfig(getServers);
      const toolArgs: Record<string, unknown> = {
        id,
        ...(preferHtml ? { preferHtml: true } : {}),
        ...(previewOnly ? { bodyPreviewOnly: true } : {}),
      };

      const result = await callTool(config, "GetMessage", toolArgs, timeout);
      if (result.isError) handleError("mail.read", result);

      return { output: asStream(result.content as unknown[]) };
    },
  };
}
