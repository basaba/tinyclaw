import { describe, it, expect } from "vitest";
import { sanitizeForTeams, markdownToTeamsHtml } from "../../src/commands/teams-html.js";

// ─── sanitizeForTeams ──────────────────────────────────────────────────

describe("sanitizeForTeams", () => {
  it("keeps allowed tags untouched", () => {
    const html = "<b>bold</b> <i>italic</i> <em>em</em> <strong>strong</strong>";
    expect(sanitizeForTeams(html)).toBe(html);
  });

  it("keeps lists untouched", () => {
    const html = "<ul><li>one</li><li>two</li></ul>";
    expect(sanitizeForTeams(html)).toBe(html);
  });

  it("keeps tables untouched", () => {
    const html = "<table><tr><th>H</th></tr><tr><td>D</td></tr></table>";
    expect(sanitizeForTeams(html)).toBe(html);
  });

  it("keeps <pre><code> blocks", () => {
    const html = "<pre><code>const x = 1;</code></pre>";
    expect(sanitizeForTeams(html)).toBe(html);
  });

  it("keeps <a> with safe href", () => {
    const html = '<a href="https://example.com">link</a>';
    expect(sanitizeForTeams(html)).toBe(html);
  });

  it("keeps <a> with mailto href", () => {
    const html = '<a href="mailto:a@b.com">email</a>';
    expect(sanitizeForTeams(html)).toBe(html);
  });

  // ─── Conversions ────────────────────────────────────────────────────

  it("converts <p> to content + <br><br>", () => {
    expect(sanitizeForTeams("<p>Hello</p>")).toBe("Hello");
    expect(sanitizeForTeams("<p>One</p><p>Two</p>")).toBe("One<br><br>Two");
  });

  it("converts <h1>-<h6> to bold", () => {
    expect(sanitizeForTeams("<h1>Title</h1>")).toBe("<b>Title</b>");
    expect(sanitizeForTeams("<h3>Heading</h3>")).toBe("<b>Heading</b>");
  });

  it("converts <blockquote> to indented italic", () => {
    const result = sanitizeForTeams("<blockquote>Quote text</blockquote>");
    expect(result).toContain("▎");
    expect(result).toContain("<em>");
    expect(result).toContain("Quote text");
  });

  it("converts <hr> to visual separator", () => {
    const result = sanitizeForTeams("Above<hr>Below");
    expect(result).toBe("Above<br>───<br>Below");
  });

  it("converts <img> with alt to text fallback", () => {
    expect(sanitizeForTeams('<img src="x.png" alt="diagram" />')).toBe("[image: diagram]");
  });

  it("strips <img> without alt", () => {
    expect(sanitizeForTeams('<img src="x.png" />')).toBe("");
  });

  // ─── Stripping ──────────────────────────────────────────────────────

  it("strips <script> with content", () => {
    expect(sanitizeForTeams('<script>alert("x")</script>safe')).toBe("safe");
  });

  it("strips <iframe> with content", () => {
    expect(sanitizeForTeams("<iframe src='x'></iframe>safe")).toBe("safe");
  });

  it("strips <style> with content", () => {
    expect(sanitizeForTeams("<style>.x{color:red}</style>safe")).toBe("safe");
  });

  it("unwraps <div> (keeps content)", () => {
    expect(sanitizeForTeams("<div>content</div>")).toBe("content");
  });

  it("unwraps <section>, <article>, <nav>", () => {
    expect(sanitizeForTeams("<section>A</section><article>B</article>")).toBe("AB");
  });

  it("strips unknown tags", () => {
    expect(sanitizeForTeams("<custom>text</custom>")).toBe("text");
  });

  // ─── Attribute sanitisation ─────────────────────────────────────────

  it("strips style attributes", () => {
    expect(sanitizeForTeams('<b style="color:red">bold</b>')).toBe("<b>bold</b>");
  });

  it("strips class and id attributes from non-code tags", () => {
    expect(sanitizeForTeams('<span class="x" id="y">text</span>')).toBe("<span>text</span>");
  });

  it("strips javascript: hrefs", () => {
    const result = sanitizeForTeams('<a href="javascript:alert(1)">click</a>');
    expect(result).not.toContain("javascript:");
  });

  it("strips data: hrefs", () => {
    const result = sanitizeForTeams('<a href="data:text/html,hello">click</a>');
    expect(result).not.toContain("data:");
  });

  // ─── Edge cases ─────────────────────────────────────────────────────

  it("collapses excessive <br> runs", () => {
    const html = "A<br><br><br><br><br>B";
    expect(sanitizeForTeams(html)).toBe("A<br><br>B");
  });

  it("handles nested unsupported tags", () => {
    const html = "<div><p>Hello <b>world</b></p></div>";
    const result = sanitizeForTeams(html);
    expect(result).toBe("Hello <b>world</b>");
  });

  it("handles empty input", () => {
    expect(sanitizeForTeams("")).toBe("");
  });

  it("handles plain text", () => {
    expect(sanitizeForTeams("just text")).toBe("just text");
  });

  it("preserves <br /> self-closing", () => {
    const result = sanitizeForTeams("line1<br>line2");
    expect(result).toContain("line1");
    expect(result).toContain("line2");
  });
});

// ─── markdownToTeamsHtml ───────────────────────────────────────────────

describe("markdownToTeamsHtml", () => {
  it("converts bold and italic", async () => {
    const result = await markdownToTeamsHtml("**bold** and *italic*");
    expect(result).toContain("<strong>bold</strong>");
    expect(result).toContain("<em>italic</em>");
  });

  it("converts headings to bold (not <h1>)", async () => {
    const result = await markdownToTeamsHtml("# Title\n\nBody");
    expect(result).not.toMatch(/<h[1-6]/);
    expect(result).toContain("<b>");
    expect(result).toContain("Title");
  });

  it("converts h1-h2 with underline emphasis", async () => {
    const result = await markdownToTeamsHtml("# Top Title");
    expect(result).toContain("<u>");
  });

  it("converts h3+ without underline", async () => {
    const result = await markdownToTeamsHtml("### Sub Heading");
    expect(result).not.toContain("<u>");
    expect(result).toContain("<b>Sub Heading</b>");
  });

  it("converts links with safe href", async () => {
    const result = await markdownToTeamsHtml("[click](https://example.com)");
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain("click");
  });

  it("converts code blocks to <pre><code>", async () => {
    const result = await markdownToTeamsHtml("```js\nconst x = 1;\n```");
    expect(result).toContain("<pre>");
    expect(result).toContain("<code");
    expect(result).toContain("const x = 1;");
  });

  it("converts bullet lists", async () => {
    const result = await markdownToTeamsHtml("- one\n- two\n- three");
    expect(result).toContain("<ul>");
    expect(result).toContain("<li>");
    expect(result).toContain("one");
  });

  it("converts numbered lists", async () => {
    const result = await markdownToTeamsHtml("1. first\n2. second");
    expect(result).toContain("<ol>");
    expect(result).toContain("first");
  });

  it("converts blockquote to italic with bar", async () => {
    const result = await markdownToTeamsHtml("> Important note");
    expect(result).toContain("▎");
    expect(result).toContain("<em>");
    expect(result).toContain("Important note");
  });

  it("converts horizontal rule", async () => {
    const result = await markdownToTeamsHtml("Above\n\n---\n\nBelow");
    expect(result).toContain("───");
  });

  it("converts images to text fallback", async () => {
    const result = await markdownToTeamsHtml("![diagram](img.png)");
    expect(result).toContain("[image: diagram]");
    expect(result).not.toContain("<img");
  });

  it("never produces unsupported tags", async () => {
    const complex = `
# Heading 1

## Heading 2

Some **bold** and *italic* text.

> A blockquote

- List item 1
- List item 2

1. Numbered 1
2. Numbered 2

---

\`\`\`ts
const x = 42;
\`\`\`

![alt](img.png)

[link](https://example.com)

| Col1 | Col2 |
|------|------|
| a    | b    |
`;
    const result = await markdownToTeamsHtml(complex);
    // Must not contain unsupported tags
    expect(result).not.toMatch(/<h[1-6][\s>]/i);
    expect(result).not.toMatch(/<\/?p[\s>]/i);
    expect(result).not.toMatch(/<\/?div[\s>]/i);
    expect(result).not.toMatch(/<\/?blockquote[\s>]/i);
    expect(result).not.toMatch(/<hr[\s/>]/i);
    expect(result).not.toMatch(/<img[\s]/i);
  });

  it("handles inline HTML in markdown", async () => {
    const result = await markdownToTeamsHtml("Text with <div>inline div</div> content");
    expect(result).not.toMatch(/<\/?div/i);
    expect(result).toContain("inline div");
  });

  it("strips javascript from markdown links", async () => {
    const result = await markdownToTeamsHtml('[click](javascript:alert(1))');
    expect(result).not.toContain("javascript:");
  });

  it("handles task lists", async () => {
    const result = await markdownToTeamsHtml("- [x] Done\n- [ ] Todo");
    expect(result).toContain("☑");
    expect(result).toContain("☐");
  });
});
