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

/** Default $select fields — keeps payloads small and avoids Graph API size limits. */
const DEFAULT_SELECT = "id,subject,from,receivedDateTime,isRead,hasAttachments,bodyPreview";

function asStream(items: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

// ── Mail result normalisation ──────────────────────────────────────

/** Normalised mail message — the fields downstream steps actually need. */
interface MailSummary {
  id: string;
  from: string;
  to: string[];
  subject: string;
  date: string;
  isRead: boolean;
  hasAttachments: boolean;
  preview: string;
}

/** Extract a display-friendly email string from a Graph API recipient. */
export function formatRecipient(r: any): string {
  if (!r) return "";
  if (typeof r === "string") return r;
  const addr = r.emailAddress ?? r;
  const name = addr.name ?? "";
  const email = addr.address ?? "";
  return name ? `${name} <${email}>` : email;
}

/** Result of normalising mail content — messages plus optional pagination link. */
interface NormalisedMailResult {
  messages: unknown[];
  nextLink?: string;
}

/**
 * Try to parse raw MCP content items into normalised MailSummary objects.
 * Falls through to raw content if the shape doesn't match.
 * Also extracts nextLink for pagination if present.
 *
 * The agency mail MCP often returns:
 *   { type: "text", text: '{"rawResponse":"{\\"value\\":[...]}"}' }
 * i.e. a rawResponse wrapper with double-escaped Graph API JSON inside.
 */
export function normaliseMailResults(content: unknown[]): NormalisedMailResult {
  const messages: MailSummary[] = [];
  let nextLink: string | undefined;

  for (const item of content) {
    // MCP content items are typically { type: "text", text: "..." }
    const raw = typeof item === "string"
      ? item
      : (item as any)?.text ?? (item as any)?.content;

    if (typeof raw !== "string") continue;

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    // Unwrap { rawResponse: "<JSON string>" } wrapper from agency mail MCP
    if (parsed && typeof parsed === "object" && typeof parsed.rawResponse === "string") {
      try {
        parsed = JSON.parse(parsed.rawResponse);
      } catch {
        continue;
      }
    }

    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const msg of list) {
      if (!msg || typeof msg !== "object") continue;

      // Extract pagination link from Graph API response wrapper
      if (msg["@odata.nextLink"]) {
        nextLink = msg["@odata.nextLink"];
      }
      if (msg.hasMoreResults === true && msg.nextLink) {
        nextLink = msg.nextLink;
      }

      // Handle Graph API response wrapper (value: [...])
      const items = Array.isArray(msg.value) ? msg.value : [msg];
      for (const m of items) {
        if (!m.id && !m.subject) continue; // not a mail message
        messages.push({
          id: m.id ?? "",
          from: formatRecipient(m.from ?? m.sender),
          to: Array.isArray(m.toRecipients)
            ? m.toRecipients.map(formatRecipient)
            : [],
          subject: m.subject ?? "(no subject)",
          date: m.receivedDateTime ?? m.sentDateTime ?? m.createdDateTime ?? "",
          isRead: m.isRead ?? false,
          hasAttachments: m.hasAttachments ?? false,
          preview: m.bodyPreview ?? "",
        });
      }
    }
  }

  // If we managed to normalise at least one message, return the clean list;
  // otherwise fall through to the original content so nothing is lost.
  return {
    messages: messages.length > 0 ? messages : content,
    nextLink,
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

/** Parse a human-friendly duration (e.g. "1d", "6h", "2w") into an ISO 8601 date string. */
function parseSince(since: string): string {
  const m = since.trim().match(/^(\d+)\s*(m|h|d|w)$/i);
  if (!m) {
    throw new Error(
      `mail.search: invalid --since value '${since}'. Use a number + unit: 30m, 1h, 6h, 1d, 3d, 1w, 2w`,
    );
  }
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const ms = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[unit]!;
  return new Date(Date.now() - n * ms).toISOString();
}

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
          since: { type: "string", description: "Relative time filter: 1h, 6h, 1d, 3d, 1w, 2w, 30d (shorthand for receivedDateTime OData filter)" },
          "order-by": { type: "string", description: "Order by date: newest (default) or oldest" },
          select: { type: "string", description: "Comma-separated fields to return (default: id,subject,from,receivedDateTime,isRead,hasAttachments,bodyPreview). Use --select '' to fetch all fields" },
          all: { type: "boolean", description: "Auto-paginate to fetch all results (default: true). Use --no-all for single page" },
          "page-size": { type: "number", description: "Items per page when using --all (default 25)" },
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
        "  mail.search --unread --since 1d --folder inbox",
        "  mail.search --since 6h",
        "",
        "Options:",
        "  --query    Natural language search (AI-powered, cannot combine with --search/--filter)",
        "  --search   KQL keyword search (from:, to:, subject:, cc:, bcc:)",
        "  --filter   OData $filter (subject, isRead, isDraft, hasAttachments, importance, receivedDateTime)",
        "  --folder   Restrict to folder: inbox, drafts, sent, deleted, junk, archive",
        "  --top      Max results (default 25)",
        "  --unread   Shorthand for isRead eq false (combinable with --filter and --since)",
        "  --since    Relative time filter: 30m, 1h, 6h, 1d, 3d, 1w, 2w (combinable with --unread and --filter)",
        "  --order-by Order by date: newest (default) or oldest",
        "  --select   Comma-separated fields to return (reduces payload)",
        "             Default: id,subject,from,receivedDateTime,isRead,hasAttachments,bodyPreview",
        "             Use --select '' to fetch all fields",
        "  --all      Auto-paginate to fetch all matching results (default: on)",
        "  --no-all   Disable auto-pagination (single page only)",
        "  --page-size Items per page when using --all (default 25)",
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
      const since = args.since as string | undefined;
      const orderBy = (args["order-by"] as string | undefined)?.toLowerCase();
      const select = args.select !== undefined ? (args.select as string) : DEFAULT_SELECT;
      const noAll = args["no-all"] === true || args["no-all"] === "true";
      const fetchAll = noAll ? false : (args.all !== false && args.all !== "false");
      const pageSize = args["page-size"] !== undefined ? Number(args["page-size"]) : undefined;

      // --unread and --since are shorthands that append to --filter
      const shorthands: string[] = [];
      if (unread) shorthands.push("isRead eq false");
      if (since) shorthands.push(`receivedDateTime ge ${parseSince(since)}`);

      if (shorthands.length > 0) {
        const combined = shorthands.join(" and ");
        filter = filter ? `(${filter}) and ${combined}` : combined;
      }

      if (!query && !search && !filter && !folder && top === undefined) {
        throw new Error("mail.search: provide --query, --search, --filter, --folder, or --top");
      }

      if (query && (search || filter)) {
        throw new Error("mail.search: --query (AI search) cannot be combined with --search or --filter");
      }

      const { config, timeout } = getMailConfig(getServers);

      // Natural language mode → SearchMessages
      if (query) {
        const result = await callTool(config, "SearchMessages", { message: query }, timeout);
        if (result.isError) handleError("mail.search", result);
        return { output: asStream(normaliseMailResults(result.content as unknown[]).messages) };
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

      // When paginating, $top is the per-page size; --top is the overall max.
      const perPage = pageSize ?? (fetchAll ? 25 : (top ?? 25));
      params.push(`$top=${perPage}`);

      if (select) {
        params.push(`$select=${select}`);
      }

      // $orderby — Note: $orderby cannot be combined with $search (Graph API limitation)
      if (!search) {
        const dir = orderBy === "oldest" ? "asc" : "desc";
        params.push(`$orderby=receivedDateTime ${dir}`);
      }

      const queryParameters = `?${params.join("&")}`;
      const maxResults = top ?? (fetchAll ? Infinity : 25);
      const allMessages: unknown[] = [];
      let nextPageLink: string | undefined;
      let currentQuery: string | undefined = queryParameters;

      // Fetch first page (and auto-paginate if --all)
      do {
        const toolArgs: Record<string, unknown> = nextPageLink
          ? { nextLink: nextPageLink }
          : { queryParameters: currentQuery };

        const result = await callTool(
          config,
          "SearchMessagesQueryParameters",
          toolArgs,
          timeout,
        );
        if (result.isError) handleError("mail.search", result);

        const page = normaliseMailResults(result.content as unknown[]);
        allMessages.push(...page.messages);
        nextPageLink = page.nextLink;
        currentQuery = undefined;
      } while (fetchAll && nextPageLink && allMessages.length < maxResults);

      // Trim to --top limit
      const trimmed = Number.isFinite(maxResults) && allMessages.length > maxResults
        ? allMessages.slice(0, maxResults)
        : allMessages;

      return { output: asStream(trimmed) };
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
        "mail.read — Read full email body by message ID",
        "",
        "Usage:",
        "  mail.read --id <messageId>",
        "  mail.read --id <messageId> --html",
        "  mail.read --id <messageId> --preview-only",
        "  mail.search --unread --since 1d | mail.read",
        "",
        "Options:",
        "  --id             Message ID (optional if piped from mail.search)",
        "  --html           Return HTML body format",
        "  --preview-only   Return body preview only (~255 chars)",
        "",
        "When piped from mail.search, reads the full body of each message.",
      ].join("\n");
    },
    async run({
      input,
      args,
    }: {
      input: AsyncIterable<unknown>;
      args: Record<string, unknown>;
    }) {
      const id = args.id as string | undefined;
      const preferHtml = args.html === true || args.html === "true";
      const previewOnly = args["preview-only"] === true || args["preview-only"] === "true";

      const { config, timeout } = getMailConfig(getServers);

      // Collect piped messages to check if we have upstream input
      const piped: unknown[] = [];
      for await (const item of input) piped.push(item);

      // If --id is given, read that single message
      if (id) {
        const toolArgs: Record<string, unknown> = {
          id,
          ...(preferHtml ? { preferHtml: true } : {}),
          ...(previewOnly ? { bodyPreviewOnly: true } : {}),
        };
        const result = await callTool(config, "GetMessage", toolArgs, timeout);
        if (result.isError) handleError("mail.read", result);
        return { output: asStream(result.content as unknown[]) };
      }

      // No --id: read each piped message by its .id field
      if (piped.length === 0) {
        throw new Error("mail.read: --id is required, or pipe messages from mail.search");
      }

      async function* readAll() {
        for (const item of piped) {
          const msgId = (item as Record<string, unknown>)?.id as string | undefined;
          if (!msgId) { yield item; continue; }
          const toolArgs: Record<string, unknown> = {
            id: msgId,
            ...(preferHtml ? { preferHtml: true } : {}),
            ...(previewOnly ? { bodyPreviewOnly: true } : {}),
          };
          const result = await callTool(config, "GetMessage", toolArgs, timeout);
          if (result.isError) handleError("mail.read", result);
          for (const msg of result.content as unknown[]) yield msg;
        }
      }

      return { output: readAll() };
    },
  };
}
