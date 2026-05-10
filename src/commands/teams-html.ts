/**
 * Teams-safe HTML sanitizer and custom marked renderer.
 *
 * Microsoft Teams Graph API (contentType: "html") only supports a limited
 * subset of HTML tags. Unsupported tags are silently stripped, breaking
 * formatting. This module provides:
 *
 * 1. A custom `marked` renderer that avoids generating unsupported tags.
 * 2. A post-process sanitizer that strips/converts any remaining unsupported
 *    HTML (covers raw HTML in markdown and --content-type html input).
 *
 * Supported tags: a, b, strong, i, em, u, s, strike, br, ul, ol, li,
 *   span, pre, code, table, tr, td, th.
 *
 * Unsupported / stripped: div, p (→ br), h1-h6 (→ bold), img, blockquote,
 *   hr, script, iframe, style, thead, tbody, tfoot (unwrapped),
 *   section, article, nav, header, footer, etc.
 */

import { Marked, type MarkedExtension, type Tokens } from "marked";

// ─── Allowed tags ──────────────────────────────────────────────────────
const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "strike",
  "br",
  "ul",
  "ol",
  "li",
  "span",
  "pre",
  "code",
  "table",
  "tr",
  "td",
  "th",
]);

/** Tags whose content should be removed entirely (not just unwrapped). */
const STRIP_WITH_CONTENT = new Set(["script", "iframe", "style", "noscript"]);

/** Tags that should be unwrapped (keep content, remove tag). */
const UNWRAP_TAGS = new Set([
  "div",
  "section",
  "article",
  "nav",
  "header",
  "footer",
  "main",
  "aside",
  "figure",
  "figcaption",
  "details",
  "summary",
  "mark",
  "abbr",
  "address",
  "dd",
  "dl",
  "dt",
  "small",
  "sub",
  "sup",
  "thead",
  "tbody",
  "tfoot",
]);

/** Allowed attributes per tag. Everything else is stripped. */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "title", "target"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan"]),
  ol: new Set(["start", "type"]),
  code: new Set(["class"]), // marked uses class="language-*"
};

const SAFE_HREF_SCHEMES = new Set(["http:", "https:", "mailto:"]);

// ─── Sanitiser ─────────────────────────────────────────────────────────

/**
 * Sanitise an HTML string so it only contains tags supported by Teams.
 * Should be called on **all** HTML content before sending to Teams.
 */
export function sanitizeForTeams(html: string): string {
  // 1. Strip dangerous tags (with content)
  for (const tag of STRIP_WITH_CONTENT) {
    const re = new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, "gi");
    html = html.replace(re, "");
  }

  // 2. Convert <p> → content + <br><br>
  html = html.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_m, inner) => `${inner}<br><br>`);

  // 3. Convert <h1>-<h6> → <b>content</b><br>
  html = html.replace(
    /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_m, _level, inner) => `<b>${inner}</b><br>`,
  );

  // 4. Convert <blockquote> → indented with bar
  html = html.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner) => {
    const trimmed = inner.replace(/^\s+|\s+$/g, "");
    return `<br>▎ <em>${trimmed}</em><br>`;
  });

  // 5. Convert <hr> → visual separator
  html = html.replace(/<hr\s*\/?>/gi, "<br>───<br>");

  // 6. Convert <img> → alt text or remove
  html = html.replace(/<img\s+[^>]*?alt=["']([^"']*)["'][^>]*\/?>/gi, (_m, alt) =>
    alt ? `[image: ${alt}]` : "",
  );
  html = html.replace(/<img[^>]*\/?>/gi, "");

  // 7. Unwrap container tags (keep content)
  for (const tag of UNWRAP_TAGS) {
    const openRe = new RegExp(`<${tag}[^>]*>`, "gi");
    const closeRe = new RegExp(`</${tag}>`, "gi");
    html = html.replace(openRe, "");
    html = html.replace(closeRe, "");
  }

  // 8. Sanitise attributes on allowed tags and strip unknown tags
  html = html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (full, tagName, attrs) => {
    const tag = (tagName as string).toLowerCase();
    const isClosing = full.startsWith("</");

    if (isClosing) {
      return ALLOWED_TAGS.has(tag) ? `</${tag}>` : "";
    }

    if (!ALLOWED_TAGS.has(tag)) {
      return "";
    }

    const isSelfClosing = full.endsWith("/>") || tag === "br";
    const cleanAttrs = sanitizeAttributes(tag, attrs as string);

    if (isSelfClosing) {
      return cleanAttrs ? `<${tag} ${cleanAttrs}>` : `<${tag}>`;
    }
    return cleanAttrs ? `<${tag} ${cleanAttrs}>` : `<${tag}>`;
  });

  // 10. Escape backslashes — Teams API interprets them as escape sequences
  // (e.g. \U in C:\Users triggers "Unrecognized escape sequence")
  html = escapeBackslashes(html);

  // 11. Collapse excessive <br> runs (more than 2 in a row)
  html = html.replace(/(<br\s*\/?>[\s]*){3,}/gi, "<br><br>");

  // 12. Trim leading/trailing whitespace and <br>s
  html = html.replace(/^(\s|<br\s*\/?>)+/, "");
  html = html.replace(/(\s|<br\s*\/?>)+$/, "");

  return html;
}

/** Strip all attributes except those in the allowlist for the tag. */
function sanitizeAttributes(tag: string, attrString: string): string {
  const allowed = ALLOWED_ATTRS[tag];
  if (!allowed || !attrString.trim()) return "";

  const result: string[] = [];
  const attrRe = /([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
  let match: RegExpExecArray | null;

  while ((match = attrRe.exec(attrString)) !== null) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4];

    if (!allowed.has(name)) continue;

    // Validate href schemes
    if (name === "href") {
      if (!isValidHref(value)) continue;
    }

    result.push(`${name}="${escapeAttr(value)}"`);
  }

  return result.join(" ");
}

function isValidHref(href: string): boolean {
  const lower = href.toLowerCase().trim();
  if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("vbscript:")) {
    return false;
  }
  try {
    const url = new URL(href, "https://placeholder.invalid");
    return SAFE_HREF_SCHEMES.has(url.protocol);
  } catch {
    return true; // Relative URLs / anchors
  }
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Escape literal backslashes in text content (outside HTML tags) so the
 * Teams API doesn't interpret them as escape sequences.
 * Replaces `\` with `&#92;` only in text nodes, leaving tag markup intact.
 */
function escapeBackslashes(html: string): string {
  // Split into tag vs text segments, only escape in text segments
  return html.replace(/([^<>]+)/g, (text) => text.replace(/\\/g, "&#92;"));
}

// ─── Custom marked renderer ───────────────────────────────────────────

/**
 * A `marked` renderer extension that produces Teams-compatible HTML,
 * avoiding unsupported tags like <p>, <h1>-<h6>, <blockquote>, <hr>, <img>.
 */
export function teamsMarkedExtension(): MarkedExtension {
  return {
    renderer: {
      // <p> → inline content with trailing break
      paragraph({ tokens }: Tokens.Paragraph): string {
        const body = this.parser.parseInline(tokens);
        return `${body}<br><br>`;
      },

      // <h1>-<h6> → bold text
      heading({ tokens, depth }: Tokens.Heading): string {
        const text = this.parser.parseInline(tokens);
        // Larger headings get extra emphasis
        if (depth <= 2) {
          return `<b><u>${text}</u></b><br>`;
        }
        return `<b>${text}</b><br>`;
      },

      // <blockquote> → italic with bar prefix
      blockquote({ tokens }: Tokens.Blockquote): string {
        const body = this.parser.parse(tokens);
        // Remove trailing <br> from inner content
        const trimmed = body.replace(/(<br\s*\/?>[\s]*)+$/, "");
        return `<br>▎ <em>${trimmed}</em><br><br>`;
      },

      // <hr> → visual line
      hr(): string {
        return "<br>───<br>";
      },

      // <img> → text fallback
      image({ href, title, text }: Tokens.Image): string {
        if (text) return `[image: ${text}]`;
        if (title) return `[image: ${title}]`;
        if (href) return `[image: ${href}]`;
        return "";
      },

      // Standard code block: use <pre><code>
      code({ text, lang }: Tokens.Code): string {
        const escaped = text
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        const cls = lang ? ` class="language-${lang}"` : "";
        return `<pre><code${cls}>${escaped}</code></pre><br>`;
      },

      // Ensure lists don't get wrapped in <p>
      list({ items, ordered, start }: Tokens.List): string {
        const tag = ordered ? "ol" : "ul";
        const startAttr = ordered && start !== 1 ? ` start="${start}"` : "";
        const body = items.map((item) => this.listitem(item)).join("");
        return `<${tag}${startAttr}>${body}</${tag}>`;
      },

      listitem({ tokens, task, checked }: Tokens.ListItem): string {
        let body = this.parser.parse(tokens);
        // Remove <br><br> from inner paragraphs in list items
        body = body.replace(/<br><br>$/g, "");
        if (task) {
          const checkbox = checked ? "☑ " : "☐ ";
          return `<li>${checkbox}${body}</li>`;
        }
        return `<li>${body}</li>`;
      },

      // Teams doesn't support <thead>/<tbody>/<tfoot> — emit flat <table><tr> structure
      table({ header, rows }: Tokens.Table): string {
        const headerRow = this.tablerow({ text: header.map((cell) => this.tablecell(cell)).join("") } as any);
        const bodyRows = rows
          .map((row) => this.tablerow({ text: row.map((cell) => this.tablecell(cell)).join("") } as any))
          .join("");
        return `<table>${headerRow}${bodyRows}</table>`;
      },

      tablerow({ text }: Tokens.TableRow): string {
        return `<tr>${text}</tr>`;
      },

      tablecell({ tokens, header }: Tokens.TableCell): string {
        const content = this.parser.parseInline(tokens);
        const tag = header ? "th" : "td";
        return `<${tag}>${content}</${tag}>`;
      },
    },
  };
}

/**
 * Convert markdown to Teams-safe HTML using the custom renderer,
 * then run the sanitizer as a safety net.
 */
export async function markdownToTeamsHtml(md: string): Promise<string> {
  const instance = new Marked();
  instance.use(teamsMarkedExtension());
  const raw = await instance.parse(md);
  return sanitizeForTeams(raw);
}
