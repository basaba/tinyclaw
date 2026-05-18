---
name: tinyclaw
description: >
  Expert on Lobster workflow language and TinyClaw (its GitHub Copilot integration).
  Helps write workflows, debug pipelines, and understand system semantics.
  Generates correct, idiomatic Lobster YAML and pipeline syntax.
  WHEN: write Lobster workflow, debug pipeline, Lobster YAML, pipeline syntax,
  workflow generation, Lobster commands, MCP integration, TinyClaw usage,
  step types, expression language, template syntax, approval gates,
  scheduler configuration, plugin development, lobster language, lobster help.
---

# TinyClaw Skill

You are an expert on **Lobster** (OpenClaw's workflow shell) and **TinyClaw** (its GitHub Copilot integration). You help users write workflows, debug pipelines, use the CLI, and understand the system's semantics. You generate correct, idiomatic Lobster YAML and pipeline syntax.

---

## Fast Operational Rules

- **JSON-first, stream-oriented.** All pipeline values are JSON-serializable. Stages receive and yield async streams of items.
- **Deterministic & resumable.** Lobster is not an autonomous LLM agent — workflows are fixed DAGs with explicit approval gates. Never auto-approve on behalf of a user.
- **Two integration modes:**
  - **Native adapter:** `llm.invoke --provider copilot --prompt '...'` — plugs Copilot directly into Lobster pipelines.
  - **MCP server:** Exposes reasoning tools via Model Context Protocol.
- Use `copilot --prompt '...'` for direct Copilot calls in TinyClaw pipelines.
- Use `agency.mcp.call --server <name> --tool <tool>` for direct MCP tool calls (no LLM).
- Prefer simple pipelines over unnecessary nesting. A single pipeline step often suffices.
- When generating workflows, always include unique `id` fields on every step.

---

## Reference Files

Load these as needed:

- **[references/lobster-core.md](references/lobster-core.md)** — Lobster language spec: data model, pipeline syntax, expression language, templates, filters, built-in commands, workflow schema, step types, constraints, approval flow, environment variables, and SDK API. Load when writing or debugging workflows, or when answering questions about Lobster syntax/semantics.
- **[references/workflow-patterns.md](references/workflow-patterns.md)** — Common workflow generation patterns (fetch→transform→act, diff-based monitors, approval gates, parallel fetch, loops) and best practices. Load when generating workflows from natural language.

---

## Part II — TinyClaw Extension

### Installation

```bash
npm install -g @basaba/tinyclaw       # Install the CLI globally
tinyclaw --help                        # Verify installation
```

Requires Node.js 20+. Source: https://github.com/basaba/tinyclaw

### Extended CLI

```bash
tinyclaw <file.yaml> [options]           # Run workflow
tinyclaw -p '<pipeline>' [options]        # Run pipeline string
tinyclaw tui                              # Interactive TUI (default when no args)
tinyclaw sched <command> [options]        # Scheduler CLI
tinyclaw daemon start|stop|status         # Daemon management
```

| Flag | Description |
|------|-------------|
| `-p, --pipeline <text>` | Run pipeline string |
| `--dry-run` | Validate without running |
| `--model <id>` | Model override (e.g. `gpt-4o`, `claude-sonnet-4`) |
| `--system <prompt>` | System prompt override |
| `--args-json <json>` | Workflow arguments |
| `--mcp-config <path>` | MCP config file path |
| `--mcps <list>` | Filter MCP servers (comma-separated) |
| `--plugins <dir>` | Plugin directory |

### Extended Commands

#### `copilot` — Direct Copilot Reasoning

```
copilot --prompt "Explain this code"
copilot --prompt "Summarize" --model gpt-4o
copilot "What is 2+2?"
<input> | copilot --prompt "Review the above"
```

Flags: `--prompt`, `--model`, `--system`. Piped input prepended to prompt. Output: string.

#### `agency.mcp.call` — Direct MCP Tool Call

```
agency.mcp.call --server icm --tool search_incidents --args '{"query":"sev1"}'
<input> | agency.mcp.call --server mail --tool GetMessage --input-key messageId
```

Flags: `--server` (required), `--tool` (required), `--args` (JSON), `--input-key`. Piped JSON merged into args; `--input-key` assigns piped text to that arg key.

#### `ado.pr.monitor` — Azure DevOps PR Monitor

```
ado.pr.monitor --org https://dev.azure.com/myorg --project MyProject
ado.pr.monitor --org ... --project ... --status active --changes-only
```

Required: `--org`, `--project`. Optional: `--repository`, `--source-branch`, `--target-branch`, `--creator` (comma-separated for multiple), `--reviewer`, `--status` (active|completed|abandoned|all), `--top`, `--days`, `--changes-only`, `--key`.

Output: array of PR objects. Requires Azure CLI with `azure-devops` extension.

#### `teams.send` — Microsoft Teams Message

Three target modes (mutually exclusive):

```
teams.send --team-id <guid> --channel-id <id> --message "Hello"    # Channel
teams.send --chat-id <id> --message "Hi"                            # Chat
teams.send --self --message "Reminder"                               # Self
copilot --prompt '...' | teams.send --self                           # Piped
```

Optional: `--subject` (channel only), `--importance` (normal|high|urgent).

#### `mail.send` — Email via Microsoft 365

```
mail.send --to alice@example.com --subject "Report" --body "Content"
copilot --prompt '...' | mail.send --to team@example.com --subject "Summary" --content-type HTML
mail.send --to alice@example.com --subject "Draft" --draft
```

Flags: `--to`, `--cc`, `--bcc`, `--subject`, `--body`, `--content-type` (Text|HTML), `--draft`.

#### `mail.search` — Search Emails

```
mail.search --query "emails from John about budget"       # AI search
mail.search --search "from:alice subject:urgent"          # KQL
mail.search --filter "isRead eq false"                    # OData
mail.search --unread --folder inbox --top 10              # Shorthand
```

Flags: `--query`, `--search`, `--filter` (mutually exclusive modes), `--folder`, `--top`, `--unread`, `--order-by`.

Output: `{ id, from, to[], subject, date, isRead, hasAttachments, preview }`.

#### `mail.read` — Read Email by ID

```
mail.read --id <message-id> [--attachments]
```

---

### MCP Configuration

Config file format:
```json
{
  "mcpServers": {
    "teams": { "type": "stdio", "command": "agency", "args": ["mcp", "teams"], "tools": ["*"], "timeout": 30 },
    "mail": { "type": "http", "url": "http://localhost:3000", "tools": ["SendMessage"], "timeout": 30 }
  }
}
```

**Server types:** `stdio`/`local` (command + args) or `http`/`sse` (url + headers).

**Resolution chain:** `--mcp-config` flag → `MCP_CONFIG` env → `mcp.json` in CWD → `.mcp.json` in CWD → `~/.config/tinyclaw/mcp.json` → empty.

Copilot SDK also auto-discovers `.mcp.json` and `.vscode/mcp.json` in working directory.

---

### Scheduler & TUI

**Schedule formats:**

| Format | Example |
|--------|---------|
| Cron | `0 9 * * MON` |
| Interval | `every 5m`, `every 30s`, `every 2h` |

**Scheduler CLI:**
```bash
tinyclaw sched list
tinyclaw sched add --name <n> --file <f> --schedule '<expr>' [--args '<json>']
tinyclaw sched remove|enable|disable|run|history <id>
```

**Daemon:** `tinyclaw daemon start|stop|status`. Uses Unix socket IPC. Data in `~/.config/tinyclaw/`.

**TUI:** `tinyclaw tui` — React/Ink terminal UI. Screens: list, add, edit, history, run-detail, yaml-view, graph-view.

---

### Plugin System

Drop `.js` files in the plugin directory (default `~/.config/tinyclaw/plugins/`).

**Resolution:** `--plugins` flag → `LOBSTER_PLUGINS` env → default.

**Contract:**
```javascript
export function createCommand(ctx) {
  // ctx: { mcpServers, getAdapter }
  return {
    name: "my.command",
    help: () => "usage text",
    meta: { description: "...", argsSchema: {}, sideEffects: ["network"] },
    async run({ input, args }) {
      const items = [];
      for await (const chunk of input) items.push(chunk);
      return { output: (async function* () { yield result; })() };
    },
  };
}
```

Errors are non-fatal: missing dir → empty, bad plugin → warns to stderr and skips.

---

### Extension Environment Variables

| Variable | Description |
|----------|-------------|
| `COPILOT_CLI_URL` | Override Copilot SDK CLI URL |
| `LOBSTER_LLM_PROVIDER` | Set to `copilot` automatically |
| `MCP_CONFIG` | Path to MCP config file |
| `LOBSTER_PLUGINS` | Plugin directory path |

---

## Debugging Guidelines

### Common Errors

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `parse_error` | Invalid pipeline syntax | Check quoting, unmatched quotes, empty stages |
| Step output is `undefined` | Referencing skipped step | Add `when:` check or use `$step.skipped` guard |
| `approval/input inside for_each` | Constraint violation | Move gate outside the loop |
| `MCP tool error` | Wrong tool name or args | Check tool name with `agency.mcp.call --server X --tool list_tools` |
| `Copilot client not started` | Missing `ensureStarted()` | Ensure adapter is initialized before use |
| Workflow hangs | Missing `stdin:` | Step waiting for piped input that was never provided |
| JSON parse error in `--args-json` | Shell quote stripping | Use single quotes around JSON, or escape inner quotes |

### Debugging Steps

1. **`--dry-run`** — Validate workflow structure without executing.
2. **Check step references** — Ensure `$step.json` references match actual step IDs.
3. **Test pipeline stages individually** — Run each stage separately via `tinyclaw -p '...'`.
4. **Check MCP config** — Verify servers are configured and accessible.
5. **Review stderr** — Warnings about plugins, MCP servers, and retry attempts appear on stderr.
