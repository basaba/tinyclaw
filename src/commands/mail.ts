/**
 * `mail.send`         — Send an email via the agency mail MCP.
 * `mail.search`       — Search emails via the agency mail MCP.
 * `mail.read`         — Read a specific email by ID via the agency mail MCP.
 * `mail.reply`        — Reply to an email by ID via the agency mail MCP.
 * `mail.update`       — Update mutable properties on an email (mark read,
 *                       set categories, change subject/importance).
 * `mail.flag`         — Set/clear flag status on an email.
 * `mail.delete`       — Delete an email.
 * `mail.forward`      — Forward an email to other recipients.
 * `mail.attachments`  — List, download, upload, or delete attachments.
 *
 * Usage in .lobster workflows:
 *   copilot --prompt "Summarise PRs" | mail.send --to alice@example.com --subject "PR Summary"
 *   mail.search --query "from:bob subject:deploy" | mail.read
 *   mail.reply --id <messageId> --body "Thanks!"
 *   mail.search --unread --folder "Code Reviews" | mail.update --mark-read
 *   mail.search --unread | mail.flag --status flagged --due 2026-05-25
 *   mail.search --filter "subject eq 'noise'" | mail.delete --yes
 *   mail.forward --id <messageId> --to alice@example.com --comment "fyi"
 *   mail.attachments --id <messageId>
 */

import type { LobsterCommand } from "./copilot.js";
import { resolveServer, callTool } from "../mcp-client/client.js";
import type { McpServerConfig } from "../mcp-config/loader.js";
import { Marked } from "marked";
import { appendWatermark } from "./watermark.js";
import { promises as fs } from "node:fs";
import { basename } from "node:path";

/** Default $select fields — keeps payloads small and avoids Graph API size limits. */
const DEFAULT_SELECT = "id,conversationId,subject,from,receivedDateTime,isRead,hasAttachments,bodyPreview";

/** Convert markdown text to HTML for email bodies. */
async function markdownToHtml(md: string): Promise<string> {
  const marked = new Marked();
  const html = await marked.parse(md);
  return typeof html === "string" ? html : md;
}

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
  conversationId: string;
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
          conversationId: m.conversationId ?? "",
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
          markdown: { type: "boolean", description: "Convert piped markdown to HTML before sending" },
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
        "  --markdown       Convert piped markdown to HTML before sending (implies --content-type html)",
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
      const useMarkdown = args.markdown === true || args.markdown === "true";
      let contentType = (args["content-type"] as string | undefined)?.toUpperCase() === "HTML" || useMarkdown ? "HTML" : undefined;
      const isDraft = args.draft === true || args.draft === "true";

      // Determine body content
      let body = args.body as string | undefined;
      if (!body) {
        const piped = await collectInput(input);
        if (piped.trim()) body = piped;
      } else {
        await drain(input);
      }

      // Convert markdown to HTML if --markdown flag is set
      if (body && useMarkdown) {
        body = await markdownToHtml(body);
        contentType = "HTML";
      }

      // Append watermark if enabled
      if (body) {
        body = appendWatermark(body, contentType === "HTML");
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
          "order-by": { type: "string", description: "Order by date: newest (default) or oldest. Use --order-by none to disable (avoids Graph InefficientFilter on complex $filter)" },
          select: { type: "string", description: "Comma-separated fields to return (default: id,conversationId,subject,from,receivedDateTime,isRead,hasAttachments,bodyPreview). Use --select '' to fetch all fields" },
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
        // Escape inner double quotes so KQL phrases like subject:"foo bar" don't
        // collide with the outer $search="..." wrapper that Graph requires.
        const escaped = search.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        params.push(`$search="${escaped}"`);
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

      // $orderby — Note: $orderby cannot be combined with $search (Graph API limitation),
      // and combining it with multi-condition $filter (e.g. startswith() + isRead) often
      // triggers Graph's InefficientFilter error. Pass --order-by none to skip.
      if (!search && orderBy !== "none") {
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

      const READ_CONCURRENCY = 5;

      async function* readAll() {
        // Build ordered slots: passthrough items yield immediately,
        // fetch items are read in parallel with a rolling concurrency pool.
        type Slot =
          | { kind: "passthrough"; item: unknown }
          | { kind: "fetch"; promise: Promise<unknown[]> };

        const slots: Slot[] = [];
        let inFlight = 0;
        let slotIndex = 0;

        function startFetch(msgId: string): Promise<unknown[]> {
          const toolArgs: Record<string, unknown> = {
            id: msgId,
            ...(preferHtml ? { preferHtml: true } : {}),
            ...(previewOnly ? { bodyPreviewOnly: true } : {}),
          };
          return callTool(config, "GetMessage", toolArgs, timeout).then((result) => {
            if (result.isError) handleError("mail.read", result);
            return result.content as unknown[];
          });
        }

        // Enqueue all items, launching up to READ_CONCURRENCY fetches eagerly
        for (const item of piped) {
          const msgId = (item as Record<string, unknown>)?.id as string | undefined;
          if (!msgId) {
            slots.push({ kind: "passthrough", item });
          } else {
            slots.push({ kind: "fetch", promise: startFetch(msgId) });
            inFlight++;
          }

          // Drain completed slots to bound memory and maintain streaming
          while (inFlight >= READ_CONCURRENCY && slotIndex < slots.length) {
            const slot = slots[slotIndex];
            if (slot.kind === "passthrough") {
              yield slot.item;
              slotIndex++;
            } else {
              const msgs = await slot.promise;
              for (const msg of msgs) yield msg;
              inFlight--;
              slotIndex++;
            }
          }
        }

        // Drain remaining slots in order
        while (slotIndex < slots.length) {
          const slot = slots[slotIndex];
          if (slot.kind === "passthrough") {
            yield slot.item;
          } else {
            const msgs = await slot.promise;
            for (const msg of msgs) yield msg;
          }
          slotIndex++;
        }
      }

      return { output: readAll() };
    },
  };
}

// ── mail.reply ─────────────────────────────────────────────────────

export function createMailReplyCommand(
  getServers: () => Record<string, McpServerConfig>,
): LobsterCommand {
  return {
    name: "mail.reply",
    meta: {
      description: "Reply to an email by message ID via Microsoft 365",
      argsSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Message ID to reply to" },
          body: { type: "string", description: "Reply body (or pipe input)" },
          markdown: { type: "boolean", description: "Convert piped markdown to HTML before sending" },
          "content-type": { type: "string", description: "text (default) or html" },
          "reply-all": { type: "boolean", description: "Reply to all recipients" },
          send: { type: "boolean", description: "Send immediately (default true). Use --send false to create a draft reply" },
          html: { type: "boolean", description: "Return HTML body in the response" },
        },
      },
      sideEffects: ["network"],
    },
    help() {
      return [
        "mail.reply — Reply to an email via Microsoft 365",
        "",
        "Usage:",
        "  mail.reply --id <messageId> --body 'Thanks!'",
        "  mail.reply --id <messageId> --reply-all --body 'Acknowledged'",
        "  copilot --prompt '...' | mail.reply --id <messageId>",
        "  mail.search --unread | mail.reply --body 'Auto-reply'",
        "",
        "Options:",
        "  --id             Message ID to reply to (optional if piped from mail.search)",
        "  --body           Reply body (or pipe input as body)",
        "  --markdown       Convert piped markdown to HTML before sending (implies --content-type html)",
        "  --content-type   text (default) or html",
        "  --reply-all      Reply to all recipients (default: reply to sender only)",
        "  --send           Send immediately (default true). --send false creates draft",
        "  --html           Return HTML body in the response",
        "",
        "When piped from mail.search, replies to each message with the same body.",
      ].join("\n");
    },
    async run({
      input,
      args,
    }: {
      input: AsyncIterable<unknown>;
      args: Record<string, unknown>;
    }) {
      const messageId = args.id as string | undefined;
      const replyAll = args["reply-all"] === true || args["reply-all"] === "true";
      const sendImmediately = args.send !== false && args.send !== "false";
      const useMarkdown = args.markdown === true || args.markdown === "true";
      const preferHtml = args.html === true || args.html === "true" || useMarkdown;
      const contentType = (args["content-type"] as string | undefined)?.toUpperCase() === "HTML" || useMarkdown ? "HTML" : undefined;

      const { config, timeout } = getMailConfig(getServers);

      // Collect piped input
      const piped: unknown[] = [];
      for await (const item of input) piped.push(item);

      // Determine reply body
      let body = args.body as string | undefined;
      if (!body) {
        // If piped items look like text/content, use them as the body
        const textParts: string[] = [];
        const msgItems: unknown[] = [];
        for (const item of piped) {
          const msgId = (item as Record<string, unknown>)?.id as string | undefined;
          if (msgId && !body) {
            // This looks like a mail message from mail.search — separate it
            msgItems.push(item);
          } else if (typeof item === "string") {
            textParts.push(item);
          } else if (item && typeof item === "object") {
            const obj = item as Record<string, unknown>;
            const text = obj.text ?? obj.content ?? obj.message ?? obj.body ?? obj.output;
            if (typeof text === "string") {
              textParts.push(text);
            } else {
              textParts.push(JSON.stringify(item, null, 2));
            }
          }
        }

        if (textParts.length > 0) {
          body = textParts.join("\n");
        }

        // If we have mail messages to reply to (from pipe), use them
        if (msgItems.length > 0 && !messageId) {
          if (!body) {
            throw new Error("mail.reply: --body is required when piping messages from mail.search");
          }

          if (useMarkdown) body = await markdownToHtml(body);
          body = appendWatermark(body, contentType === "HTML");

          const results: unknown[] = [];
          for (const msg of msgItems) {
            const id = (msg as Record<string, unknown>).id as string;
            const toolName = replyAll ? "ReplyAllToMessage" : "ReplyToMessage";
            const toolArgs: Record<string, unknown> = {
              id,
              comment: body,
              sendImmediately,
              ...(preferHtml ? { preferHtml: true } : {}),
            };
            const result = await callTool(config, toolName, toolArgs, timeout);
            if (result.isError) handleError("mail.reply", result);
            results.push(...(result.content as unknown[]));
          }
          return { output: asStream(results) };
        }
      }

      if (!messageId) {
        throw new Error("mail.reply: --id is required, or pipe messages from mail.search");
      }
      if (!body) {
        throw new Error("mail.reply: --body is required, or pipe input as reply body");
      }

      if (useMarkdown) body = await markdownToHtml(body);
      body = appendWatermark(body, contentType === "HTML");

      const toolName = replyAll ? "ReplyAllToMessage" : "ReplyToMessage";
      const toolArgs: Record<string, unknown> = {
        id: messageId,
        comment: body,
        sendImmediately,
        ...(preferHtml ? { preferHtml: true } : {}),
      };

      const result = await callTool(config, toolName, toolArgs, timeout);
      if (result.isError) handleError("mail.reply", result);
      return { output: asStream(result.content as unknown[]) };
    },
  };
}

// ── Shared helpers for mutating commands ───────────────────────────

/** Collect piped input items into an array (without joining as string). */
async function collectItems(input: AsyncIterable<unknown>): Promise<unknown[]> {
  const items: unknown[] = [];
  for await (const item of input) items.push(item);
  return items;
}

/**
 * Extract a message id from a piped item. Tolerates several shapes:
 *   { id }                       — mail.search output
 *   { messageId }                — explicit field
 *   { json: { id } }             — wrapped by for_each
 */
function extractMessageId(item: unknown): string | undefined {
  if (!item || typeof item !== "object") return undefined;
  const obj = item as Record<string, unknown>;
  const direct = obj.id ?? obj.messageId;
  if (typeof direct === "string" && direct) return direct;
  const json = obj.json;
  if (json && typeof json === "object") {
    const nested = (json as Record<string, unknown>).id ?? (json as Record<string, unknown>).messageId;
    if (typeof nested === "string" && nested) return nested;
  }
  return undefined;
}

/**
 * Resolve the list of message IDs to operate on, given an --id arg and piped input.
 * If --id is provided, returns just that id (and drains input).
 * Otherwise collects all ids from piped messages.
 * Throws if neither is available.
 */
async function resolveTargetIds(
  toolName: string,
  args: Record<string, unknown>,
  input: AsyncIterable<unknown>,
): Promise<string[]> {
  const id = args.id as string | undefined;
  if (id) {
    await drain(input);
    return [id];
  }
  const items = await collectItems(input);
  const ids: string[] = [];
  for (const item of items) {
    const msgId = extractMessageId(item);
    if (msgId) ids.push(msgId);
  }
  if (ids.length === 0) {
    throw new Error(`${toolName}: --id is required, or pipe messages from mail.search`);
  }
  return ids;
}

/** Split a comma-separated argument into a trimmed list (or undefined when empty). */
function splitCsv(s: string | undefined): string[] | undefined {
  if (!s) return undefined;
  const list = s.split(",").map((x) => x.trim()).filter(Boolean);
  return list.length > 0 ? list : undefined;
}

/** Coerce a CLI flag (boolean or "true"/"false" string) to a boolean. */
function asBool(v: unknown): boolean {
  return v === true || v === "true";
}

// ── mail.update ────────────────────────────────────────────────────

export function createMailUpdateCommand(
  getServers: () => Record<string, McpServerConfig>,
): LobsterCommand {
  return {
    name: "mail.update",
    meta: {
      description: "Update mutable properties on a message (subject, body, categories, importance, sensitivity)",
      argsSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Message ID (optional if piped from mail.search)" },
          subject: { type: "string", description: "New subject line" },
          body: { type: "string", description: "New body (replaces existing body)" },
          "content-type": { type: "string", description: "Body content type: Text or HTML" },
          categories: { type: "string", description: "Replace categories with this comma-separated list (use --categories '' to clear)" },
          importance: { type: "string", description: "Low | Normal | High" },
          sensitivity: { type: "string", description: "Normal | Personal | Private | Confidential" },
        },
      },
      sideEffects: ["network"],
    },
    help() {
      return [
        "mail.update — Update mutable properties on an email",
        "",
        "Usage:",
        "  mail.update --id <messageId> --categories 'Personal,Followup'",
        "  mail.update --id <messageId> --importance High",
        "  mail.update --id <messageId> --subject 'New subject'",
        "  mail.update --id <messageId> --sensitivity Confidential",
        "",
        "Options:",
        "  --id             Message ID (optional if piped from mail.search)",
        "  --subject        New subject line",
        "  --body           Replace the message body",
        "  --content-type   Body content type: Text or HTML",
        "  --categories     Replace categories with a comma-separated list (use '' to clear)",
        "  --importance     Low | Normal | High",
        "  --sensitivity    Normal | Personal | Private | Confidential",
        "",
        "When piped from mail.search, applies the same update to every message.",
      ].join("\n");
    },
    async run({
      input,
      args,
    }: {
      input: AsyncIterable<unknown>;
      args: Record<string, unknown>;
    }) {
      const update: Record<string, unknown> = {};

      if (args.categories !== undefined) {
        const csv = args.categories as string;
        update.categories = csv === "" ? [] : (splitCsv(csv) ?? []);
      }
      if (typeof args.subject === "string") update.subject = args.subject;
      if (typeof args.body === "string") update.body = args.body;
      if (typeof args["content-type"] === "string") {
        const ct = (args["content-type"] as string).toLowerCase();
        if (!["text", "html"].includes(ct)) {
          throw new Error(`mail.update: --content-type must be Text or HTML (got '${args["content-type"]}')`);
        }
        update.contentType = ct === "html" ? "HTML" : "Text";
      }
      if (typeof args.importance === "string") {
        const imp = (args.importance as string).toLowerCase();
        if (!["low", "normal", "high"].includes(imp)) {
          throw new Error(`mail.update: --importance must be Low|Normal|High (got '${args.importance}')`);
        }
        update.importance = imp.charAt(0).toUpperCase() + imp.slice(1);
      }
      if (typeof args.sensitivity === "string") {
        const sens = (args.sensitivity as string).toLowerCase();
        const allowed = ["normal", "personal", "private", "confidential"];
        if (!allowed.includes(sens)) {
          throw new Error(`mail.update: --sensitivity must be Normal|Personal|Private|Confidential (got '${args.sensitivity}')`);
        }
        update.sensitivity = sens.charAt(0).toUpperCase() + sens.slice(1);
      }

      if (Object.keys(update).length === 0) {
        throw new Error(
          "mail.update: nothing to update — pass --subject, --body, --content-type, --categories, --importance, or --sensitivity",
        );
      }

      const ids = await resolveTargetIds("mail.update", args, input);
      const { config, timeout } = getMailConfig(getServers);

      const results: unknown[] = [];
      for (const id of ids) {
        const result = await callTool(config, "UpdateMessage", { id, ...update }, timeout);
        if (result.isError) handleError("mail.update", result);
        results.push(...(result.content as unknown[]));
      }
      return { output: asStream(results) };
    },
  };
}

// ── mail.flag ──────────────────────────────────────────────────────

export function createMailFlagCommand(
  getServers: () => Record<string, McpServerConfig>,
): LobsterCommand {
  const VALID_STATUSES = new Set(["notflagged", "flagged", "complete"]);

  return {
    name: "mail.flag",
    meta: {
      description: "Set or clear the flag status on a message",
      argsSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Message ID (optional if piped from mail.search)" },
          status: { type: "string", description: "NotFlagged | Flagged (default) | Complete" },
          mailbox: { type: "string", description: "Address of a shared mailbox to update" },
        },
      },
      sideEffects: ["network"],
    },
    help() {
      return [
        "mail.flag — Flag or unflag an email",
        "",
        "Usage:",
        "  mail.flag --id <messageId>                       # flag for follow-up",
        "  mail.flag --id <messageId> --status Complete     # mark flag complete",
        "  mail.flag --id <messageId> --status NotFlagged   # clear flag",
        "  mail.search --unread | mail.flag --status Flagged",
        "",
        "Options:",
        "  --id       Message ID (optional if piped from mail.search)",
        "  --status   NotFlagged | Flagged (default) | Complete",
        "  --mailbox  Address of a shared mailbox to update",
      ].join("\n");
    },
    async run({
      input,
      args,
    }: {
      input: AsyncIterable<unknown>;
      args: Record<string, unknown>;
    }) {
      const rawStatus = ((args.status as string | undefined) ?? "Flagged").trim();
      const lower = rawStatus.toLowerCase();
      if (!VALID_STATUSES.has(lower)) {
        throw new Error(
          `mail.flag: --status must be NotFlagged|Flagged|Complete (got '${rawStatus}')`,
        );
      }
      const flagStatus =
        lower === "notflagged" ? "NotFlagged" : lower.charAt(0).toUpperCase() + lower.slice(1);

      const toolArgsBase: Record<string, unknown> = { flagStatus };
      if (typeof args.mailbox === "string" && args.mailbox) {
        toolArgsBase.mailboxAddress = args.mailbox;
      }

      const ids = await resolveTargetIds("mail.flag", args, input);
      const { config, timeout } = getMailConfig(getServers);

      const results: unknown[] = [];
      for (const messageId of ids) {
        const result = await callTool(config, "FlagEmail", { messageId, ...toolArgsBase }, timeout);
        if (result.isError) handleError("mail.flag", result);
        results.push(...(result.content as unknown[]));
      }
      return { output: asStream(results) };
    },
  };
}

// ── mail.delete ────────────────────────────────────────────────────

export function createMailDeleteCommand(
  getServers: () => Record<string, McpServerConfig>,
): LobsterCommand {
  return {
    name: "mail.delete",
    meta: {
      description: "Delete a message from the mailbox",
      argsSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Message ID (optional if piped from mail.search)" },
          yes: { type: "boolean", description: "Required confirmation flag — delete is permanent (moves to Deleted Items)" },
        },
      },
      sideEffects: ["network"],
    },
    help() {
      return [
        "mail.delete — Delete a message (moves it to Deleted Items)",
        "",
        "Usage:",
        "  mail.delete --id <messageId> --yes",
        "  mail.search --filter \"subject eq 'spam'\" | mail.delete --yes",
        "",
        "Options:",
        "  --id   Message ID (optional if piped from mail.search)",
        "  --yes  Required — confirms intent to delete.",
      ].join("\n");
    },
    async run({
      input,
      args,
    }: {
      input: AsyncIterable<unknown>;
      args: Record<string, unknown>;
    }) {
      if (!asBool(args.yes)) {
        throw new Error("mail.delete: pass --yes to confirm. This moves messages to Deleted Items.");
      }
      const ids = await resolveTargetIds("mail.delete", args, input);
      const { config, timeout } = getMailConfig(getServers);

      const results: unknown[] = [];
      for (const id of ids) {
        const result = await callTool(config, "DeleteMessage", { id }, timeout);
        if (result.isError) handleError("mail.delete", result);
        results.push(...(result.content as unknown[]));
      }
      return { output: asStream(results) };
    },
  };
}

// ── mail.forward ───────────────────────────────────────────────────

export function createMailForwardCommand(
  getServers: () => Record<string, McpServerConfig>,
): LobsterCommand {
  return {
    name: "mail.forward",
    meta: {
      description: "Forward a message to other recipients",
      argsSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Message ID (optional if piped from mail.search)" },
          to: { type: "string", description: "Comma-separated additional To recipients (required)" },
          cc: { type: "string", description: "Comma-separated additional Cc recipients" },
          bcc: { type: "string", description: "Comma-separated additional Bcc recipients" },
          comment: { type: "string", description: "Intro comment placed above the quoted thread (or pipe input)" },
          markdown: { type: "boolean", description: "Convert piped/comment markdown to HTML before sending" },
          "full-thread": { type: "boolean", description: "Use ForwardMessageWithFullThread to preserve quoted history" },
          "include-attachments": { type: "boolean", description: "With --full-thread: re-attach original non-inline attachments" },
        },
      },
      sideEffects: ["network"],
    },
    help() {
      return [
        "mail.forward — Forward an email to other recipients",
        "",
        "Usage:",
        "  mail.forward --id <messageId> --to alice@example.com --comment 'FYI'",
        "  mail.forward --id <messageId> --to 'Alice, Bob' --full-thread",
        "  copilot --prompt 'Add context...' | mail.forward --id <messageId> --to alice@example.com",
        "  mail.search --search 'subject:incident' | mail.forward --to oncall@example.com --comment 'see thread'",
        "",
        "Options:",
        "  --id                   Message ID (optional if piped from mail.search)",
        "  --to                   Comma-separated additional To recipients (required)",
        "  --cc                   Comma-separated additional Cc recipients",
        "  --bcc                  Comma-separated additional Bcc recipients",
        "  --comment              Intro comment above quoted thread (or pipe input)",
        "  --markdown             Convert comment/piped markdown to HTML",
        "  --full-thread          Use ForwardMessageWithFullThread (preserves quoted history)",
        "  --include-attachments  With --full-thread, re-attach original non-inline files",
      ].join("\n");
    },
    async run({
      input,
      args,
    }: {
      input: AsyncIterable<unknown>;
      args: Record<string, unknown>;
    }) {
      const additionalTo = splitCsv(args.to as string | undefined);
      if (!additionalTo || additionalTo.length === 0) {
        throw new Error("mail.forward: --to is required");
      }
      const additionalCc = splitCsv(args.cc as string | undefined);
      const additionalBcc = splitCsv(args.bcc as string | undefined);
      const useMarkdown = asBool(args.markdown);
      const fullThread = asBool(args["full-thread"]);
      const includeAttachments = asBool(args["include-attachments"]);

      // Comment: --comment wins; otherwise drain piped input as comment when --id is set,
      // or collect items (which may be messages to forward) when --id is absent.
      let introComment = args.comment as string | undefined;
      const hasIdArg = typeof args.id === "string" && (args.id as string).length > 0;

      let ids: string[];
      if (hasIdArg) {
        if (!introComment) {
          const piped = await collectInput(input);
          if (piped.trim()) introComment = piped;
        } else {
          await drain(input);
        }
        ids = [args.id as string];
      } else {
        const items = await collectItems(input);
        const msgIds: string[] = [];
        const textParts: string[] = [];
        for (const item of items) {
          const msgId = extractMessageId(item);
          if (msgId) {
            msgIds.push(msgId);
          } else if (typeof item === "string") {
            textParts.push(item);
          } else if (item && typeof item === "object") {
            const obj = item as Record<string, unknown>;
            const text = obj.text ?? obj.content ?? obj.message ?? obj.body ?? obj.output;
            if (typeof text === "string") textParts.push(text);
          }
        }
        if (!introComment && textParts.length > 0) introComment = textParts.join("\n");
        if (msgIds.length === 0) {
          throw new Error("mail.forward: --id is required, or pipe messages from mail.search");
        }
        ids = msgIds;
      }

      if (introComment && useMarkdown) introComment = await markdownToHtml(introComment);
      if (introComment) introComment = appendWatermark(introComment, useMarkdown);

      const { config, timeout } = getMailConfig(getServers);
      const toolName = fullThread ? "ForwardMessageWithFullThread" : "ForwardMessage";

      const results: unknown[] = [];
      for (const messageId of ids) {
        const toolArgs: Record<string, unknown> = {
          messageId,
          additionalTo,
          ...(additionalCc ? { additionalCc } : {}),
          ...(additionalBcc ? { additionalBcc } : {}),
          ...(introComment ? { introComment } : {}),
          ...(useMarkdown ? { preferHtml: true } : {}),
          ...(fullThread && includeAttachments ? { includeOriginalNonInlineAttachments: true } : {}),
        };
        const result = await callTool(config, toolName, toolArgs, timeout);
        if (result.isError) handleError("mail.forward", result);
        results.push(...(result.content as unknown[]));
      }
      return { output: asStream(results) };
    },
  };
}

// ── mail.attachments ───────────────────────────────────────────────

/** 3 MB threshold — above this, UploadLargeAttachment is required by Graph API. */
const LARGE_ATTACHMENT_THRESHOLD_BYTES = 3 * 1024 * 1024;

export function createMailAttachmentsCommand(
  getServers: () => Record<string, McpServerConfig>,
): LobsterCommand {
  return {
    name: "mail.attachments",
    meta: {
      description: "List, download, upload, or delete attachments on a message",
      argsSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Message ID (optional if piped from mail.search)" },
          download: { type: "string", description: "Attachment ID to download" },
          out: { type: "string", description: "Path to write downloaded attachment (default: <attachment-name>)" },
          upload: { type: "string", description: "Local file path to upload as an attachment" },
          name: { type: "string", description: "Override attachment name when uploading (default: file basename)" },
          "content-type": { type: "string", description: "MIME type of the uploaded file (optional)" },
          delete: { type: "string", description: "Attachment ID to delete" },
        },
      },
      sideEffects: ["network", "filesystem"],
    },
    help() {
      return [
        "mail.attachments — Manage attachments on an email",
        "",
        "Usage:",
        "  mail.attachments --id <messageId>                              # list attachments",
        "  mail.attachments --id <messageId> --download <attachmentId>    # download to current dir",
        "  mail.attachments --id <messageId> --download <attachmentId> --out report.pdf",
        "  mail.attachments --id <messageId> --upload ./report.pdf",
        "  mail.attachments --id <messageId> --upload ./report.pdf --name 'Q2 Report.pdf'",
        "  mail.attachments --id <messageId> --delete <attachmentId>",
        "  mail.search --filter 'hasAttachments eq true' | mail.attachments",
        "",
        "Options:",
        "  --id        Message ID (optional if piped from mail.search)",
        "  --download  Attachment ID to fetch (writes the file to disk)",
        "  --out       Output path for --download (default: attachment's own name)",
        "  --upload    Local file path to upload (auto picks small/large upload tool)",
        "  --name      Override the attachment name when uploading",
        "  --content-type  MIME type of the uploaded file (optional)",
        "  --delete    Attachment ID to delete",
        "",
        "Mutually exclusive: --download, --upload, --delete. Omit all three to list.",
      ].join("\n");
    },
    async run({
      input,
      args,
    }: {
      input: AsyncIterable<unknown>;
      args: Record<string, unknown>;
    }) {
      const download = args.download as string | undefined;
      const upload = args.upload as string | undefined;
      const del = args.delete as string | undefined;

      const modes = [download, upload, del].filter(Boolean).length;
      if (modes > 1) {
        throw new Error("mail.attachments: --download, --upload, and --delete are mutually exclusive");
      }

      const ids = await resolveTargetIds("mail.attachments", args, input);
      const { config, timeout } = getMailConfig(getServers);

      const results: unknown[] = [];

      for (const messageId of ids) {
        if (download) {
          const result = await callTool(
            config,
            "DownloadAttachment",
            { messageId, attachmentId: download },
            timeout,
          );
          if (result.isError) handleError("mail.attachments (download)", result);

          // Try to write the file. The MCP returns either { name, contentBytes } JSON
          // or a base64 blob inside a text item. We extract whichever is present.
          const written = await writeDownloadedAttachment(
            result.content as unknown[],
            args.out as string | undefined,
          );
          results.push({ messageId, attachmentId: download, savedTo: written });
          continue;
        }

        if (upload) {
          const fileBuf = await fs.readFile(upload);
          const attachmentName = (args.name as string | undefined) ?? basename(upload);
          const contentType = args["content-type"] as string | undefined;
          const tool = fileBuf.byteLength > LARGE_ATTACHMENT_THRESHOLD_BYTES
            ? "UploadLargeAttachment"
            : "UploadAttachment";
          const toolArgs: Record<string, unknown> = {
            messageId,
            fileName: attachmentName,
            contentBase64: fileBuf.toString("base64"),
            ...(contentType ? { contentType } : {}),
          };
          const result = await callTool(config, tool, toolArgs, timeout);
          if (result.isError) handleError(`mail.attachments (${tool})`, result);
          results.push(...(result.content as unknown[]));
          continue;
        }

        if (del) {
          const result = await callTool(
            config,
            "DeleteAttachment",
            { messageId, attachmentId: del },
            timeout,
          );
          if (result.isError) handleError("mail.attachments (delete)", result);
          results.push(...(result.content as unknown[]));
          continue;
        }

        // Default: list attachments
        const result = await callTool(config, "GetAttachments", { messageId }, timeout);
        if (result.isError) handleError("mail.attachments (list)", result);
        results.push(...(result.content as unknown[]));
      }

      return { output: asStream(results) };
    },
  };
}

/**
 * Decode a downloaded attachment from MCP content and write it to disk.
 * Returns the path that was written.
 *
 * Handles the two shapes the agency mail MCP returns for DownloadAttachment:
 *   1. { name, contentBytes }       — base64-encoded body inline
 *   2. { type: "text", text: "..."} — a JSON envelope containing the above
 */
async function writeDownloadedAttachment(
  content: unknown[],
  outArg: string | undefined,
): Promise<string> {
  let name: string | undefined;
  let contentBytes: string | undefined;

  for (const item of content) {
    const raw = typeof item === "string" ? item : (item as any)?.text;
    if (typeof raw !== "string") continue;

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (parsed && typeof parsed === "object" && typeof parsed.rawResponse === "string") {
      try {
        parsed = JSON.parse(parsed.rawResponse);
      } catch { /* keep parsed */ }
    }
    name ??= parsed?.name;
    contentBytes ??= parsed?.contentBytes;
    if (name && contentBytes) break;
  }

  if (!contentBytes) {
    throw new Error("mail.attachments: download did not return contentBytes");
  }

  const outPath = outArg ?? name ?? `attachment-${Date.now()}.bin`;
  await fs.writeFile(outPath, Buffer.from(contentBytes, "base64"));
  return outPath;
}
