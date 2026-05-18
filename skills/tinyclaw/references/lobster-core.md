# Lobster Core Language Reference

## Data Model & Execution

| Concept | Detail |
|---------|--------|
| Values | JSON-serializable: objects, arrays, strings, numbers, booleans, `null` |
| Streams | Pipelines operate on async streams of items between stages |
| Equality | Loose (`==`) throughout (JavaScript semantics) |
| Modes | `human` (default, interactive) · `tool` (single JSON envelope) |

Pipeline flow: `Stage 1 → Stage 2 → Stage 3 → output`. Each stage receives input stream, calls `command.run()`, yields output stream. A stage may set `halt: true` (stops pipeline — used by `approve`, `diff.gate`, `break`) or `rendered: true` (already printed output).

### Tool-Mode Envelope

```jsonc
{ "protocolVersion": 1, "ok": true, "status": "ok | needs_approval | needs_input | cancelled", "output": [...] }
{ "protocolVersion": 1, "ok": false, "error": { "type": "parse_error | runtime_error", "message": "..." } }
```

---

## Pipeline Syntax

```
command1 --flag value positional | command2 arg | command3
```

- `|` splits stages (preserved inside quotes).
- **Named args:** `--key value`, `--key=value`, `--key` (boolean true).
- **Positional args:** stored in `args._` array.
- **Single quotes** (`'...'`): literal, only `\'` is an escape.
- **Double quotes** (`"..."`): unescapes `\"`, `\\`, `\$`, `` \` ``; `\<newline>` is line continuation.

---

## Expression Language

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
| `iff(cond, a, b)` | Conditional: if `cond` truthy returns `a`, else `b` |

```
every(reviewers, @.vote == 0)
count(items, @.priority > 3)
days_since(createdAt) < 30
coalesce(nickname, fullName, "Unknown")
iff(score > 80, "pass", "fail")
```

---

## Template & Interpolation Syntax

**Template expressions** (in `template`, `map`):

```
{{fieldName}}                    # property access
{{nested.path}}                  # nested property
{{.}} or {{this}}                # entire object
{{value | filter1 | filter2}}    # filter chain
```

Missing paths → empty string. Objects/arrays → JSON-stringified.

**Workflow argument interpolation:** `${arg_name}` — substitutes workflow args. Unresolved → left as-is.

**Environment variable interpolation:** `${env:VAR_NAME}` — substitutes host env vars. The `env:` prefix distinguishes from workflow args. Unset → left as-is. Not resolved in `--dry-run` or `graph` output to avoid leaking secrets.

**Step references:** `$step_id.field`

| Reference | Resolves To |
|-----------|-------------|
| `$step.stdout` | Raw string output |
| `$step.json` | Parsed JSON |
| `$step.json.nested.0.field` | Nested path |
| `$step.approved` | Approval result (boolean) |
| `$step.response` | Input step response |
| `$step.skipped` | Whether step was skipped |

**Resolution order:** `${arg}` and `${env:VAR}` first, then `$step.field`.

---

## Filters

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

## Built-in Commands (stdlib)

### Data Flow

| Command | Usage | Description |
|---------|-------|-------------|
| `exec` | `exec ls -la` / `exec --shell "echo hi"` / `exec --json node -e '...'` | Run OS command. Flags: `--shell`, `--json`, `--stdin raw\|json\|jsonl`, `--stdin-file raw\|json\|jsonl` (writes to temp file, sets `LOBSTER_STDIN_FILE`) |
| `emit` | `emit hello world` / `emit --json '{"a":1}' '{"b":2}'` | Emit literal values as stream items. Without `--json`, each arg is a plain string. With `--json`, each arg is parsed as JSON. No args → passes through input items (identity/passthrough). No side effects. |
| `json` | `... \| json` | Render items as JSON |
| `table` | `... \| table` | Render as table |
| `template` | `... \| template --text 'PR #{{number}}: {{title}}'` | Render template per item. Flags: `--text`, `--file` |

### Filtering & Selection

| Command | Usage | Description |
|---------|-------|-------------|
| `where` | `... \| where status=active` / `... \| where "x>5 && y<6"` / `... \| where '(status==queued \|\| status==rejected) && changed==true'` | Filter by predicate. Uses the full expression engine. Ops: `=`, `==`, `!=`, `<`, `<=`, `>`, `>=`. Combine with `&&`/`\|\|` (quote the expression). Parentheses supported for grouping. Bare RHS identifiers treated as strings (`status==queued`); use `$.field` for property-to-property comparison. Functions: `contains()`, `starts_with()`, `length()`, etc. |
| `pick` | `... \| pick id,subject,from` / `... \| pick author=from` / `... \| pick pr.number` | Project fields (comma-separated). Supports renaming (`new=old`) and dot-path access. |
| `head` | `... \| head --n 5` | Take first N items (default 10) |
| `tail` | `... \| tail --n 5` | Take last N items (default 10) |
| `count` | `... \| count` | Count items, outputs `{ count: N }` |
| `dedupe` | `... \| dedupe --key id` | Remove duplicates (stable, first kept) |

### Transformation

| Command | Usage | Description |
|---------|-------|-------------|
| `compute` | `... \| compute age='days_since(createdAt)'` | Add computed fields (expression language) |
| `map` | `... \| map --wrap item` / `... \| map --unwrap data` / `... \| map id={{id}}` | Wrap/unwrap/transform items |
| `sort` | `... \| sort --key updatedAt --desc` | Sort items. Stable sort, nulls sort last |
| `groupBy` | `... \| groupBy --key status` | Group → `{ key, items, count }` |

### State Management

| Command | Usage | Description |
|---------|-------|-------------|
| `state.get` | `state.get myKey` | Read stored JSON (or null) |
| `state.set` | `<items> \| state.set myKey` | Store input as JSON value |
| `diff.last` | `<items> \| diff.last --key myKey` | Compare to previous snapshot → `{ changed, before, after }` |
| `diff.gate` | `<items> \| diff.gate --key myKey` | Like `diff.last` but **halts** if unchanged |
| `diff.key` | `<items> \| diff.key --key myKey [--field id]` | Mark each item `changed: true/false` by comparing key field(s) against stored state. `--field` supports multiple fields for composite keys: `--field owner --field repo --field number` or `--field owner,repo,number`. Default field: `id`. |
| `diff.key.exists` | `<items> \| diff.key.exists --key myKey [--field id]` | Like `diff.key` but **read-only** — does not update stored state. Same args and output. |
| `diff.key.set` | `<items> \| diff.key.set --key myKey [--field id]` | Like `diff.key` but **write-only** — stores item keys into state without adding `changed` to output. Items pass through unchanged. Use with `diff.key.exists` for two-phase check-then-commit patterns. |
| `break` | `break [--message "reason"]` | Halt pipeline immediately. Stdin items pass through as output before halting. In workflows, use as `pipeline:` step with `when:` for conditional early termination — workflow returns `status: "ok"` with output from last completed step. |
| `gate` | `... \| gate --when empty` / `... \| gate --when "length($) > 10"` | Conditional pipeline halt. Collects items, evaluates condition, halts if true. Built-in: `empty`, `not_empty`. Expression: `$` = items array, `@` = per-element. Items pass through as output. |

### Human-in-the-Loop

| Command | Usage | Description |
|---------|-------|-------------|
| `approve` | `... \| approve --prompt "Send?"` | Approval gate. Flags: `--emit`, `--preview-from-stdin`, `--limit` |
| `ask` | `... \| ask --prompt "Review:" --schema '{...}'` | Request structured input |

### LLM Integration

| Command | Usage | Description |
|---------|-------|-------------|
| `llm.invoke` | `llm.invoke --prompt '...' --provider copilot` | Call an LLM. Flags: `--model`, `--output-schema`, `--temperature`, `--max-output-tokens`, `--artifacts-json` |

Provider resolution: `--provider` flag → `LOBSTER_LLM_PROVIDER` env → auto-detect.

### External Integrations

| Command | Description |
|---------|-------------|
| `openclaw.invoke` / `clawd.invoke` | Call OpenClaw tool (`--tool`, `--action`, `--args-json`, `--each`) |
| `gog.gmail.search` | Search Gmail (`--query`, `--max`) |
| `gog.gmail.send` | Send Gmail (input: `{ to, subject, body }`) |
| `email.triage` | Email triage (`--llm`, `--model`, `--emit report\|drafts`) |

---

## Workflow Files (.lobster / .yaml)

### Top-Level Schema

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

### Step Types

Every step requires a unique `id` and exactly **one** execution mode:

| Type | Field | Description |
|------|-------|-------------|
| Shell command | `run` / `command` | Run OS command. Output: `$step.stdout`, `$step.json` |
| Pipeline | `pipeline` | Lobster pipeline string. Use `stdin:` to provide input |
| Nested workflow | `workflow` | Path to sub-workflow. `workflow_args:` for params |
| Parallel | `parallel` | `{ wait, timeout_ms, branches: [...] }` |
| Loop | `for_each` | Iterate array or object (single object treated as one-element array). `item_var`, `index_var`, `include_unmatched`, `batch_size`, `concurrency`, `steps:`. Use `concurrency: N` to run up to N iterations in parallel (results preserve input order; on error, in-flight iterations are aborted). `concurrency` cannot be used with `batch_size`/`pause_ms`. Iterations where all sub-steps are skipped are excluded from output by default; set `include_unmatched: true` to keep them. |
| Approval | `approval` | String prompt or `{ prompt, items, preview, ... }` |
| Input | `input` | `{ prompt, responseSchema, defaults }` |

### Sub-Workflows

A step with `workflow:` invokes another workflow file as a nested unit. The parent waits for the sub-workflow to complete, then exposes its output via the usual `$step.stdout` / `$step.json` references.

**Schema:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workflow` | string | yes | Relative or absolute path to the sub-workflow `.yaml` file. Relative paths resolve from the **parent workflow's directory**. |
| `workflow_args` | object | no | Key-value arguments passed to the sub-workflow. These substitute `${arg_name}` placeholders in the sub-workflow, matching its `args:` definitions. |

**Example — parent workflow:**

```yaml
steps:
  - id: greet
    workflow: "./greet.yaml"
    workflow_args:
      name: "Lobster"

  - id: use-result
    run: "echo Sub-workflow said: $greet.stdout"
```

**Example — sub-workflow (`greet.yaml`):**

```yaml
name: greet
args:
  name:
    description: "Name to greet"
    default: "World"
steps:
  - id: say-hello
    run: "echo Hello, ${name}!"
```

**Output access:**

| Reference | Resolves to |
|-----------|-------------|
| `$step.stdout` | Raw string output of the sub-workflow's last step |
| `$step.json` | Parsed JSON output (if the sub-workflow emits JSON) |
| `$step.skipped` | Whether the sub-workflow step was skipped (via `when:`) |

**Constraints:**

- Sub-workflows **cannot** contain `approval` or `input` gates — only top-level workflow steps can halt for human input.
- All common step fields (`when`, `on_error`, `retry`, `timeout_ms`, `env`, `cwd`) apply to the `workflow` step.
- Step IDs must be unique within each workflow; the parent and sub-workflow have separate ID namespaces.
- Sub-workflows are not recursive — a workflow cannot invoke itself.

### Common Step Fields

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

### Retry Configuration

```yaml
retry:
  max: 3                  # total attempts (1 = no retry)
  backoff: exponential    # "fixed" (default) or "exponential"
  delay_ms: 500           # base delay
  max_delay_ms: 10000     # cap (exponential only)
  jitter: true            # ±10% randomization
```

Abort/cancellation errors are **never** retried.

### Conditional Execution

```yaml
when: $approval.approved == true
when: "($a.json.x == 1 || $b.json.y == 2) && $c.json.z > 0"
when: length($data.json.items) > 0
when: some($data.json.items, item, $item.status == "ready")
when: every($data.json.scores, s, $s.value >= 80)
when: ${mode} == active                           # workflow arg reference
when: $source.json.msg == ${expected}              # step ref + arg ref
```

**Operators:** `==`, `!=`, `<`, `<=`, `>`, `>=`, `&&`, `||`, `!`, `()`.  
**Functions:** `length($ref.field)` → number (array/string length), `some($ref.field, var, predicate)` → boolean, `every($ref.field, var, predicate)` → boolean. Iterator variable is referenced with `$` prefix (e.g. `$item.field`). Empty/null arrays: `every([])` → `true`, `some([])` → `false`.  
**Arg references:** `${arg_name}` resolves to the workflow argument value at evaluation time. Undefined args resolve to `undefined` (falsy in comparisons).

Skipped steps produce `{ id, skipped: true }` — no `stdout`/`json`.

### stdin Resolution

| Pattern | Behavior |
|---------|----------|
| `$step_id.json` | Strict reference — full JSON value |
| `$step_id.stdout` | Strict reference — raw string |
| Other string | Template with `${arg}` and `$step.field` interpolation |
| Object/array literal | Serialized to JSON |
| `null` | Empty input |

---

## Constraints & Gotchas

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

## Approval, Input & Resume Flow

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

## Core Environment Variables

| Variable | Purpose |
|----------|---------|
| `LOBSTER_STATE_DIR` | State storage directory (default `~/.lobster/state`) |
| `LOBSTER_LLM_PROVIDER` | LLM provider: `openclaw`, `pi`, `http`, `copilot` |
| `LOBSTER_LLM_MODEL` | Model override |
| `LOBSTER_SHELL` | Shell for `run`/`command` steps |
| `LOBSTER_ARGS_JSON` | JSON-serialized workflow args |
| `LOBSTER_ARG_<NAME>` | Individual arg (uppercased, non-alnum → `_`) |

---

## SDK (Programmatic API)

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
