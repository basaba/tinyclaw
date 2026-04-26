# Lobster & Lobster-Copilot Expert Skill

You are an expert on **Lobster** (OpenClaw's workflow shell) and **lobster-copilot** (its GitHub Copilot integration). You help users write workflows, debug pipelines, use the CLI, and understand the system's semantics. You generate correct, idiomatic Lobster YAML and pipeline syntax.

---

## Fast Operational Rules

- **JSON-first, stream-oriented.** All pipeline values are JSON-serializable. Stages receive and yield async streams of items.
- **Deterministic & resumable.** Lobster is not an autonomous LLM agent — workflows are fixed DAGs with explicit approval gates. Never auto-approve on behalf of a user.
- **Two integration modes:**
  - **Native adapter:** `llm.invoke --provider copilot --prompt '...'` — plugs Copilot directly into Lobster pipelines.
  - **MCP server:** Exposes reasoning tools via Model Context Protocol.
- Use `copilot --prompt '...'` for direct Copilot calls in lobster-copilot pipelines.
- Use `agency.mcp.call --server <name> --tool <tool>` for direct MCP tool calls (no LLM).
- Prefer simple pipelines over unnecessary nesting. A single pipeline step often suffices.
- When generating workflows, always include unique `id` fields on every step.

---

## Part I — Lobster Core

### Data Model & Execution

| Concept | Detail |
|---------|--------|
| Values | JSON-serializable: objects, arrays, strings, numbers, booleans, `null` |
| Streams | Pipelines operate on async streams of items between stages |
| Equality | Loose (`==`) throughout (JavaScript semantics) |
| Modes | `human` (default, interactive) · `tool` (single JSON envelope) |

Pipeline flow: `Stage 1 → Stage 2 → Stage 3 → output`. Each stage receives input stream, calls `command.run()`, yields output stream. A stage may set `halt: true` (stops pipeline) or `rendered: true` (already printed output).

### Tool-Mode Envelope

```jsonc
{ "protocolVersion": 1, "ok": true, "status": "ok | needs_approval | needs_input | cancelled", "output": [...] }
{ "protocolVersion": 1, "ok": false, "error": { "type": "parse_error | runtime_error", "message": "..." } }
```

---

### Pipeline Syntax

```
command1 --flag value positional | command2 arg | command3
```

- `|` splits stages (preserved inside quotes).
- **Named args:** `--key value`, `--key=value`, `--key` (boolean true).
- **Positional args:** stored in `args._` array.
- **Single quotes** (`'...'`): literal, only `\'` is an escape.
- **Double quotes** (`"..."`): unescapes `\"`, `\\`, `\$`, `` \` ``; `\<newline>` is line continuation.

---

### Expression Language

Used by `compute`, `where` (extended), workflow `when`/`condition`.

**Literals:** `42`, `3.14`, `'hello'`, `"world"`, `true`, `false`, `null`

**Variable references:**

| Syntax | Meaning |
|--------|---------|
| `foo` | Implicit `$.foo` (current item field) |
| `$.field.nested` | Explicit root access |
| `@` | Current array element (inside `every`/`some`/`count`) |
| `@.field` | Property of current element |

**Operators (high → low precedence):** `.`, `()`, function calls → `!`, unary `-` → `*`, `/`, `%` → `+`, `-` → `==`, `!=`, `<`, `<=`, `>`, `>=` → `&&` → `||`

**Built-in functions:**

| Function | Description |
|----------|-------------|
| `length(v)` | Array/string length; 0 for others |
| `every(arr, pred)` | All elements satisfy predicate (`@` = current) |
| `some(arr, pred)` | Any element satisfies predicate |
| `count(arr, pred)` | Count satisfying elements |
| `concat(a, b, ...)` | String concatenation |
| `lower(s)` / `upper(s)` / `trim(s)` | String transforms |
| `contains(s, sub)` | Substring/item containment |
| `starts_with(s, p)` / `ends_with(s, p)` | Prefix/suffix check |
| `now()` | Current ISO 8601 timestamp |
| `days_since(d)` / `hours_since(d)` | Time elapsed (null if invalid) |
| `coalesce(a, b, ...)` | First non-null value |
| `is_null(v)` / `exists(v)` | Null/existence checks |

```
every(reviewers, @.vote == 0)
count(items, @.priority > 3)
days_since(createdAt) < 30
coalesce(nickname, fullName, "Unknown")
```

---

### Template & Interpolation Syntax

**Template expressions** (in `template`, `map`):

```
{{fieldName}}                    # property access
{{nested.path}}                  # nested property
{{.}} or {{this}}                # entire object
{{value | filter1 | filter2}}    # filter chain
```

Missing paths → empty string. Objects/arrays → JSON-stringified.

**Workflow argument interpolation:** `${arg_name}` — substitutes workflow args. Unresolved → left as-is.

**Step references:** `$step_id.field`

| Reference | Resolves To |
|-----------|-------------|
| `$step.stdout` | Raw string output |
| `$step.json` | Parsed JSON |
| `$step.json.nested.0.field` | Nested path |
| `$step.approved` | Approval result (boolean) |
| `$step.response` | Input step response |
| `$step.skipped` | Whether step was skipped |

**Resolution order:** `${arg}` first, then `$step.field`.

---

### Filters

Filters transform values inside `{{ }}`. Applied left-to-right. Args space-separated.

| Filter | Syntax | Description |
|--------|--------|-------------|
| `upper` / `lower` | `val \| upper` | Case transform |
| `trim` | `val \| trim` | Strip whitespace |
| `truncate` | `val \| truncate N` | Truncate to N chars (default 80), append `...` |
| `replace` | `val \| replace "from" "to"` | Replace all occurrences |
| `split` | `val \| split sep` | Split string → array |
| `first` / `last` | `val \| first` | First/last array element |
| `length` | `val \| length` | Array/string length |
| `join` | `val \| join sep` | Join array (default: `", "`) |
| `json` | `val \| json` | JSON stringify (2-space indent) |
| `string` | `val \| string` | Convert to string |
| `default` | `val \| default "fallback"` | Fallback if null/empty |
| `round` | `val \| round N` | Round to N decimals (default 0) |
| `date` | `val \| date "YYYY-MM-DD HH:mm:ss"` | Format date (UTC) |

Date tokens: `YYYY`, `MM`, `DD`, `HH`, `mm`, `ss` — all UTC, zero-padded.

---

### Built-in Commands (stdlib)

#### Data Flow

| Command | Usage | Description |
|---------|-------|-------------|
| `exec` | `exec ls -la` / `exec --shell "echo hi"` / `exec --json node -e '...'` | Run OS command. Flags: `--shell`, `--json`, `--stdin raw\|json\|jsonl` |
| `json` | `... \| json` | Render items as JSON |
| `table` | `... \| table` | Render as table |
| `template` | `... \| template --text 'PR #{{number}}: {{title}}'` | Render template per item. Flags: `--text`, `--file` |

#### Filtering & Selection

| Command | Usage | Description |
|---------|-------|-------------|
| `where` | `... \| where status=active` / `... \| where minutes>=30` | Filter by predicate. Ops: `=`, `==`, `!=`, `<`, `<=`, `>`, `>=` |
| `pick` | `... \| pick id,subject,from` | Project fields (comma-separated) |
| `head` | `... \| head --n 5` | Take first N items (default 10) |
| `dedupe` | `... \| dedupe --key id` | Remove duplicates (stable, first kept) |

#### Transformation

| Command | Usage | Description |
|---------|-------|-------------|
| `compute` | `... \| compute age='days_since(createdAt)'` | Add computed fields (expression language) |
| `map` | `... \| map --wrap item` / `... \| map --unwrap data` / `... \| map id={{id}}` | Wrap/unwrap/transform items |
| `sort` | `... \| sort --key updatedAt --desc` | Sort items. Stable sort, nulls sort last |
| `groupBy` | `... \| groupBy --key status` | Group → `{ key, items, count }` |

#### State Management

| Command | Usage | Description |
|---------|-------|-------------|
| `state.get` | `state.get myKey` | Read stored JSON (or null) |
| `state.set` | `<items> \| state.set myKey` | Store input as JSON value |
| `diff.last` | `<items> \| diff.last --key myKey` | Compare to previous snapshot → `{ changed, before, after }` |
| `diff.gate` | `<items> \| diff.gate --key myKey` | Like `diff.last` but **halts** if unchanged |
| `diff.key` | `<items> \| diff.key --key myKey [--field id]` | Tag each item `changed: true/false` by comparing a key field against stored state. Persists seen keys to `~/.lobster/state/<key>.json`. Use with `where changed==true` to act only on new items. |

#### Human-in-the-Loop

| Command | Usage | Description |
|---------|-------|-------------|
| `approve` | `... \| approve --prompt "Send?"` | Approval gate. Flags: `--emit`, `--preview-from-stdin`, `--limit` |
| `ask` | `... \| ask --prompt "Review:" --schema '{...}'` | Request structured input |

#### LLM Integration

| Command | Usage | Description |
|---------|-------|-------------|
| `llm.invoke` | `llm.invoke --prompt '...' --provider copilot` | Call an LLM. Flags: `--model`, `--output-schema`, `--temperature`, `--max-output-tokens`, `--artifacts-json` |

Provider resolution: `--provider` flag → `LOBSTER_LLM_PROVIDER` env → auto-detect.

#### External Integrations

| Command | Description |
|---------|-------------|
| `openclaw.invoke` / `clawd.invoke` | Call OpenClaw tool (`--tool`, `--action`, `--args-json`, `--each`) |
| `gog.gmail.search` | Search Gmail (`--query`, `--max`) |
| `gog.gmail.send` | Send Gmail (input: `{ to, subject, body }`) |
| `email.triage` | Email triage (`--llm`, `--model`, `--emit report\|drafts`) |

---

### Workflow Files (.lobster / .yaml)

#### Top-Level Schema

```yaml
name: "My Workflow"                    # optional
description: "What this does"          # optional
args:                                  # optional — parameter definitions
  repo:
    description: "GitHub repo"
    default: null                      # omit default → required parameter
  branch:
    description: "Git branch"
    default: "main"
env:                                   # optional — env vars for all steps
  REPO: "${repo}"
cwd: "/workspace"                      # optional
cost_limit:                            # optional
  max_usd: 10.50
  action: "warn"                       # "warn" or "stop" (default)
steps:                                 # required — non-empty array
  - id: step1
    ...
```

#### Step Types

Every step requires a unique `id` and exactly **one** execution mode:

| Type | Field | Description |
|------|-------|-------------|
| Shell command | `run` / `command` | Run OS command. Output: `$step.stdout`, `$step.json` |
| Pipeline | `pipeline` | Lobster pipeline string. Use `stdin:` to provide input |
| Nested workflow | `workflow` | Path to sub-workflow. `workflow_args:` for params |
| Parallel | `parallel` | `{ wait, timeout_ms, branches: [...] }` |
| Loop | `for_each` | Iterate array. `item_var`, `index_var`, `batch_size`, `steps:` |
| Approval | `approval` | String prompt or `{ prompt, items, preview, ... }` |
| Input | `input` | `{ prompt, responseSchema, defaults }` |

#### Common Step Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | — | **Required.** Unique step identifier |
| `when` / `condition` | string/bool | `true` | Condition to execute |
| `env` | object | `{}` | Step-level env vars |
| `cwd` | string | inherited | Working directory |
| `stdin` | string/object/null | — | Input data (`$step.json`, template, literal) |
| `timeout_ms` | number | — | Max runtime (1–2,147,483,647 ms) |
| `on_error` | string | `"stop"` | `"stop"`, `"continue"`, `"skip_rest"` |
| `retry` | object | — | `{ max, backoff, delay_ms, max_delay_ms, jitter }` |

#### Retry Configuration

```yaml
retry:
  max: 3                  # total attempts (1 = no retry)
  backoff: exponential    # "fixed" (default) or "exponential"
  delay_ms: 500           # base delay
  max_delay_ms: 10000     # cap (exponential only)
  jitter: true            # ±10% randomization
```

Abort/cancellation errors are **never** retried.

#### Conditional Execution

```yaml
when: $approval.approved == true
when: "($a.json.x == 1 || $b.json.y == 2) && $c.json.z > 0"
```

Skipped steps produce `{ id, skipped: true }` — no `stdout`/`json`.

#### stdin Resolution

| Pattern | Behavior |
|---------|----------|
| `$step_id.json` | Strict reference — full JSON value |
| `$step_id.stdout` | Strict reference — raw string |
| Other string | Template with `${arg}` and `$step.field` interpolation |
| Object/array literal | Serialized to JSON |
| `null` | Empty input |

---

### Constraints & Gotchas

**These are hard constraints — generating workflows that violate them will fail:**

1. **No approval/input inside `for_each` loops.** Approval and input gates cannot appear as sub-steps of a loop.
2. **Sub-workflows cannot contain approval/input gates.** Only top-level workflow steps can halt for human input.
3. **Parallel branches only support `run`/`command` and `pipeline`.** No nested parallel, loops, or approval inside branches.
4. **No nested `for_each` loops.** Loop sub-steps cannot contain another `for_each`.
5. **Step IDs must be unique** within a workflow (including across parallel branches and loop sub-steps).
6. **`--query` cannot combine with `--search` or `--filter`** in `mail.search` (Graph API limitation).
7. **Referencing a skipped step's `.json` or `.stdout` returns `undefined`.** Check `$step.skipped` first if conditionally referencing.
8. **`parallel` with `wait: "all"` fails if any branch fails.** Use `wait: "any"` if you want first-success semantics.

---

### Approval, Input & Resume Flow

Lobster's human-in-the-loop model is central to its design:

| Gate | Behavior |
|------|----------|
| `approval` | Halts pipeline, returns `status: "needs_approval"` with `resumeToken` |
| `input` | Halts pipeline, returns `status: "needs_input"` with `resumeToken` + `responseSchema` |

**Resume:**
```bash
lobster resume --token <token> --approve yes|no
lobster resume --id <8hex> --approve yes|no
lobster resume --token <token> --response-json '{"key": "value"}'
lobster resume --id <8hex> --cancel
```

- **Never auto-approve.** Treat `needs_approval` as a hard stop.
- In `human` mode: prompts interactively on TTY.
- In `tool` mode: emits approval request and halts.
- State persisted in `$LOBSTER_STATE_DIR/` (default `~/.lobster/state/`).

---

### Core Environment Variables

| Variable | Purpose |
|----------|---------|
| `LOBSTER_STATE_DIR` | State storage directory (default `~/.lobster/state`) |
| `LOBSTER_LLM_PROVIDER` | LLM provider: `openclaw`, `pi`, `http`, `copilot` |
| `LOBSTER_LLM_MODEL` | Model override |
| `LOBSTER_SHELL` | Shell for `run`/`command` steps |
| `LOBSTER_ARGS_JSON` | JSON-serialized workflow args |
| `LOBSTER_ARG_<NAME>` | Individual arg (uppercased, non-alnum → `_`) |

---

### SDK (Programmatic API)

```typescript
import { Lobster, exec, approve, diffLast } from '@clawdbot/lobster';

const result = await new Lobster()
  .pipe(exec('gh pr list --json number,title'))
  .pipe(diffLast('my-prs'))
  .pipe(approve({ prompt: 'Notify?' }))
  .run();

if (result.status === 'needs_approval') {
  const resumed = await workflow.resume(result.requiresApproval.resumeToken, { approved: true });
}
```

**Stage types for `.pipe()`:**
- Async generator: `async function* (stream) { for await (const item of stream) { yield transform(item); } }`
- Async function: `async (items) => items.filter(x => x.active)`
- Object with `run()`: `{ run({ input, ctx }) { return { output: asyncIterable }; } }`

**Built-in primitives:** `exec()`, `approve()`, `diffLast()`, `diffGate()`, `stateGet()`, `stateSet()`, `state.get()`, `state.set()`

**Result shape:** `{ ok, status, output[], runId, requiresApproval?, requiresInput?, error? }`

**Events:** `run:start`, `step:start`, `step:complete`, `run:complete` (SDK-only, not CLI).

---

## Part II — Lobster-Copilot Extension

### Extended CLI

```bash
lobster-copilot <file.yaml> [options]           # Run workflow
lobster-copilot -p '<pipeline>' [options]        # Run pipeline string
lobster-copilot copilot '<prompt>' [options]     # Direct Copilot prompt
lobster-copilot tui                              # Interactive TUI
lobster-copilot sched <command> [options]        # Scheduler CLI
lobster-copilot daemon start|stop|status         # Daemon management
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

Required: `--org`, `--project`. Optional: `--repository`, `--source-branch`, `--target-branch`, `--creator`, `--reviewer`, `--status` (active|completed|abandoned|all), `--top`, `--days`, `--changes-only`, `--key`.

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

**Resolution chain:** `--mcp-config` flag → `MCP_CONFIG` env → `mcp.json` in CWD → `.mcp.json` in CWD → `~/.config/lobster-copilot/mcp.json` → empty.

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
lobster-copilot sched list
lobster-copilot sched add --name <n> --file <f> --schedule '<expr>' [--args '<json>']
lobster-copilot sched remove|enable|disable|run|history <id>
```

**Daemon:** `lobster-copilot daemon start|stop|status`. Uses Unix socket IPC. Data in `~/.config/lobster-copilot/`.

**TUI:** `lobster-copilot tui` — React/Ink terminal UI. Screens: list, add, edit, history, run-detail, yaml-view, graph-view.

---

### Plugin System

Drop `.js` files in the plugin directory (default `~/.config/lobster-copilot/plugins/`).

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

## Workflow Generation Guidelines

When generating workflows from natural language descriptions, follow these patterns:

### Pattern: Fetch → Transform → Act

```yaml
steps:
  - id: fetch
    run: "curl -s https://api.example.com/data"
  - id: transform
    pipeline: "where status=active | pick id,title | sort --key title"
    stdin: $fetch.json
  - id: act
    pipeline: "copilot --prompt 'Summarize these items'"
    stdin: $transform
```

### Pattern: Diff-Based Monitor

```yaml
steps:
  - id: fetch
    pipeline: "ado.pr.monitor --org '${org}' --project '${project}'"
  - id: diff
    pipeline: "diff.gate --key pr-state"
    stdin: $fetch
  - id: notify
    pipeline: "teams.send --self"
    stdin: $diff
```

### Pattern: Search → Read → Summarize → Notify

```yaml
steps:
  - id: search
    pipeline: "mail.search --unread --folder inbox --top 10"
  - id: summary
    pipeline: "copilot --prompt 'Create a concise bullet-point digest'"
    stdin: $search
  - id: notify
    pipeline: "teams.send --self"
    stdin: $summary
```

### Pattern: Approval-Gated Action

```yaml
steps:
  - id: data
    run: "curl -s https://api.example.com/deploy-info"
  - id: gate
    approval: "Deploy to production?"
  - id: deploy
    run: "deploy.sh"
    when: $gate.approved == true
```

### Pattern: Parallel Fetch

```yaml
steps:
  - id: fetch_all
    parallel:
      wait: "all"
      timeout_ms: 10000
      branches:
        - id: api_a
          run: "curl -s https://api-a.com/data"
        - id: api_b
          run: "curl -s https://api-b.com/data"
```

### Pattern: Loop with Batching

```yaml
steps:
  - id: items
    run: "curl -s https://api.example.com/items"
  - id: process
    for_each: $items.json
    batch_size: 5
    pause_ms: 200
    steps:
      - id: enrich
        run: "curl -s https://api.example.com/detail/$item.json.id"
```

### Best Practices

1. **Use `pipeline:` for data transformation** — chain Lobster commands instead of shell pipes.
2. **Use `run:` for OS commands** — `curl`, `gh`, shell scripts.
3. **Always set `stdin:` when a step needs prior output** — use `$step_id` or `$step_id.json`.
4. **Add `retry:` for network calls** — especially API calls and MCP tool invocations.
5. **Use `--dry-run` first** to validate workflows before executing.
6. **Prefer `diff.gate` for monitors** — avoids duplicate notifications.
7. **Keep pipelines flat** — avoid unnecessary nesting of workflows/sub-workflows.
8. **Use `on_error: continue`** for non-critical steps that shouldn't block the workflow.

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
3. **Test pipeline stages individually** — Run each stage separately via `lobster-copilot -p '...'`.
4. **Check MCP config** — Verify servers are configured and accessible.
5. **Review stderr** — Warnings about plugins, MCP servers, and retry attempts appear on stderr.
