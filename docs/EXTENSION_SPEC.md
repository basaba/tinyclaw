# Lobster-Copilot Extension Specification

> **Version:** 1.0 — derived from source (`src/`) as of April 2026  
> **Audience:** AI agents, automation authors, and contributors

Lobster-Copilot is a Copilot adapter and workflow scheduler for [Lobster](https://github.com/basaba/lobster). It plugs GitHub Copilot into Lobster's pipeline engine as an LLM provider and adds commands for Teams messaging, Microsoft 365 mail, Azure DevOps PR monitoring, and a TUI-based scheduler daemon.

> **Relationship to Lobster:** Lobster-Copilot extends Lobster — it does not replace it. All Lobster pipeline syntax, expressions, workflow files, and built-in commands remain available. This document covers only the additions.

---

## Table of Contents

1. [CLI Interface](#1-cli-interface)
2. [Extended Commands](#2-extended-commands)
3. [MCP Configuration](#3-mcp-configuration)
4. [Scheduler & TUI](#4-scheduler--tui)
5. [Plugin System](#5-plugin-system)
6. [Environment Variables](#6-environment-variables)
7. [Example Workflows](#7-example-workflows)

---

## 1. CLI Interface

### Invocation

```bash
# Run a workflow file
lobster-copilot <file.yaml> [options]

# Run a pipeline string
lobster-copilot -p '<pipeline>' [options]

# Direct Copilot prompt
lobster-copilot copilot '<prompt>' [options]

# Interactive TUI
lobster-copilot tui

# Scheduler CLI
lobster-copilot sched <command> [options]

# Daemon management
lobster-copilot daemon start|stop|status

# Help
lobster-copilot help
```

### Run Flags

| Flag | Description |
|------|-------------|
| `-p, --pipeline <text>` | Run pipeline string instead of file |
| `--dry-run` | Validate and print execution plan without running |
| `--args-json <json>` | JSON object of workflow arguments |
| `--mcp-config <path>` | Path to `mcp.json` config file |
| `--mcps <list>` | Filter MCP servers from config (comma-separated) |
| `--plugins <dir>` | Plugin directory override |

### Copilot Shortcut Flags

```bash
lobster-copilot copilot '<prompt>' [--model <id>] [--system <prompt>] [--mcp-config <path>] [--mcps <list>]
```

| Flag | Description |
|------|-------------|
| `--model <id>` | Model ID override (e.g. `gpt-4o`, `claude-sonnet-4`) |
| `--system <prompt>` | System prompt override |
| `--mcp-config <path>` | Path to `mcp.json` |
| `--mcps <list>` | Filter MCP servers (comma-separated) |

Accepts stdin — piped text is prepended to the prompt.

### Scheduler CLI

```bash
lobster-copilot sched list                         # List all scheduled workflows
lobster-copilot sched add --name <n> --file <f> --schedule '<expr>' [--args '<json>']
lobster-copilot sched remove <id>                  # Remove a workflow
lobster-copilot sched enable <id>                  # Enable a workflow
lobster-copilot sched disable <id>                 # Disable a workflow
lobster-copilot sched run <id>                     # Trigger manual run
lobster-copilot sched history <id>                 # Show run history
lobster-copilot sched help                         # Show subcommand help
```

### Daemon Management

```bash
lobster-copilot daemon start    # Start daemon (checks for existing)
lobster-copilot daemon stop     # Stop running daemon
lobster-copilot daemon status   # Check daemon status
```

The daemon communicates with the TUI over a Unix domain socket. PID file and config are stored in `~/.config/lobster-copilot/`.

---

## 2. Extended Commands

These commands are available in pipelines and workflow files, in addition to all Lobster stdlib commands.

### `copilot` — Direct Copilot Reasoning

Send a prompt to GitHub Copilot and receive a response.

```
copilot --prompt "Explain this code"
copilot --prompt "Summarize" --model gpt-4o
copilot "What is 2+2?"
<input> | copilot --prompt "Review the above"
```

| Flag | Type | Description |
|------|------|-------------|
| `--prompt <text>` | string | Prompt text |
| `--model <id>` | string | Model override |
| `--system <text>` | string | System prompt override |
| Positional args | string | Alternative prompt syntax |

**Input:** Piped text is prepended to the prompt.  
**Output:** String response from Copilot.

---

### `agency.mcp.call` — Direct MCP Tool Invocation

Call any MCP server tool directly without LLM intermediation.

```
agency.mcp.call --server icm --tool search_incidents --args '{"query":"sev1"}'
<input> | agency.mcp.call --server mail --tool GetMessage --input-key messageId
```

| Flag | Type | Description |
|------|------|-------------|
| `--server <name>` | string | MCP server name (required) |
| `--tool <name>` | string | Tool name to call (required) |
| `--args <json>` | string | JSON object of tool arguments |
| `--input-key <name>` | string | Key to inject piped input into |

**Input:** Piped input is merged into `--args` if JSON, or assigned to `--input-key`.  
**Output:** Array of tool result items.

---

### `ado.pr.monitor` — Azure DevOps PR Monitor

Fetch PRs from Azure DevOps, compare against last-known state, and report changes.

```
ado.pr.monitor --org https://dev.azure.com/myorg --project MyProject
ado.pr.monitor --org ... --project ... --status active --target-branch main
ado.pr.monitor --org ... --project ... --changes-only
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--org <url>` | string | — | Azure DevOps org URL (required) |
| `--project <name>` | string | — | Project name (required) |
| `--repository <name>` | string | — | Repository filter |
| `--source-branch <name>` | string | — | Source branch filter |
| `--target-branch <name>` | string | — | Target branch filter |
| `--creator <user>` | string | — | PR creator filter |
| `--reviewer <user>` | string | — | PR reviewer filter |
| `--status <string>` | string | `active` | `active\|completed\|abandoned\|all` |
| `--top <number>` | number | `50` | Max PRs to return |
| `--days <number>` | number | — | Only PRs from last N days |
| `--changes-only` | boolean | `false` | Report only new/removed/updated |
| `--key <string>` | string | — | State key for tracking |

**Output:** Array of PR objects with fields like `pullRequestId`, `title`, `status`, `createdBy`, `reviewers`, `creationDate`, etc.

**Prerequisites:** Azure CLI with `azure-devops` extension, authenticated via `az login`.

---

### `teams.send` — Send Microsoft Teams Message

Send a message via the agency Teams MCP server. Three target modes:

```
teams.send --team-id <guid> --channel-id <id> --message "Hello team"
teams.send --chat-id <id> --message "Hi"
teams.send --self --message "Note to self"
copilot --prompt '...' | teams.send --self
```

| Flag | Type | Description |
|------|------|-------------|
| `--team-id <guid>` | string | Team GUID (required for channel) |
| `--channel-id <id>` | string | Channel ID (required for channel) |
| `--chat-id <id>` | string | Chat ID (for direct/group chat) |
| `--self` | boolean | Send to yourself (Notes to Self) |
| `--message <text>` | string | Message body (or use piped input) |
| `--subject <text>` | string | Subject line (channel only) |
| `--importance <level>` | string | `normal` (default) \| `high` \| `urgent` |

**Input:** Piped input used as message body if `--message` is omitted.  
**MCP Server:** `teams` (agency fallback: `{ command: "agency", args: ["mcp", "teams"] }`).

---

### `mail.send` — Send Email via Microsoft 365

```
mail.send --to alice@example.com --subject "Report" --body "Here is the report"
copilot --prompt '...' | mail.send --to team@example.com --subject "Summary" --content-type HTML
mail.send --to alice@example.com --subject "Draft" --draft
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--to <recipients>` | string | — | Comma-separated recipients (required unless `--draft`) |
| `--cc <recipients>` | string | — | Cc recipients |
| `--bcc <recipients>` | string | — | Bcc recipients |
| `--subject <text>` | string | — | Subject line |
| `--body <text>` | string | — | Body (or use piped input) |
| `--content-type <type>` | string | `Text` | `Text` or `HTML` |
| `--draft` | boolean | `false` | Create draft instead of sending |

**MCP Tools:** `SendEmailWithAttachments` (send) or `CreateDraftMessage` (draft).

---

### `mail.search` — Search Emails

Three search modes (mutually exclusive):

```
# Natural language (AI-powered)
mail.search --query "emails from John about budget"

# KQL keyword search (deterministic)
mail.search --search "from:alice subject:urgent"

# OData filter (deterministic)
mail.search --filter "isRead eq false and hasAttachments eq true"

# Folder restriction
mail.search --unread --folder inbox --top 10
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--query <text>` | string | — | AI natural language search |
| `--search <text>` | string | — | KQL keyword search (`from:`, `to:`, `subject:`, `cc:`, `bcc:`) |
| `--filter <expr>` | string | — | OData `$filter` expression |
| `--folder <name>` | string | — | `inbox\|drafts\|sent\|deleted\|junk\|archive` |
| `--top <number>` | number | `25` | Max results |
| `--unread` | boolean | — | Shorthand for `--filter 'isRead eq false'` |
| `--order-by <dir>` | string | `newest` | `newest` or `oldest` |

**Constraints:**
- `--query` cannot combine with `--search` or `--filter`.
- `--search` cannot combine with `--filter` (Graph API limitation).

**Output:** Array of normalized mail summary objects: `{ id, from, to[], subject, date, isRead, hasAttachments, preview }`.

**MCP Tools:** `SearchMessages` (query) or `SearchMessagesQueryParameters` (deterministic).

---

### `mail.read` — Read Email by ID

```
mail.read --id <message-id>
mail.read --id <message-id> --attachments
```

| Flag | Type | Description |
|------|------|-------------|
| `--id <string>` | string | Email message ID (required) |
| `--attachments` | boolean | Include attachment details |

**MCP Tool:** `GetMessage`.

---

## 3. MCP Configuration

### Config File Format

```json
{
  "mcpServers": {
    "teams": {
      "type": "stdio",
      "command": "agency",
      "args": ["mcp", "teams"],
      "tools": ["*"],
      "timeout": 30
    },
    "mail": {
      "type": "http",
      "url": "http://localhost:3000",
      "headers": { "Authorization": "Bearer token" },
      "tools": ["SendMessage", "SearchMessages"],
      "timeout": 30
    }
  }
}
```

### Server Types

**Local / Stdio:**

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"stdio"` \| `"local"` | Server type |
| `command` | string | Executable command (required) |
| `args` | string[] | Command arguments |
| `env` | Record<string, string> | Environment variables |
| `cwd` | string | Working directory |
| `tools` | string[] | Advertised tools (`["*"]` for all) |
| `timeout` | number | Timeout in seconds |

**Remote / HTTP:**

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"http"` \| `"sse"` | Server type |
| `url` | string | Server URL (required) |
| `headers` | Record<string, string> | HTTP headers |
| `tools` | string[] | Advertised tools |
| `timeout` | number | Timeout in seconds |

### Resolution Chain (first found wins)

1. `--mcp-config <path>` CLI flag
2. `MCP_CONFIG` environment variable
3. `mcp.json` in current directory
4. `.mcp.json` in current directory
5. `~/.config/lobster-copilot/mcp.json`
6. Empty (no servers loaded)

### Copilot SDK Auto-Discovery

In addition to the explicit MCP config, the Copilot SDK (`enableConfigDiscovery: true` by default) also discovers:
- `.mcp.json` in the working directory
- `.vscode/mcp.json` in the working directory

These are merged with explicitly loaded servers. Explicit servers take precedence on name collision.

### Filtering

```bash
# Load only specific servers
lobster-copilot -p "..." --mcps teams,mail

# Use custom config file
lobster-copilot -p "..." --mcp-config ./custom-mcp.json
```

---

## 4. Scheduler & TUI

### Overview

The scheduler runs workflows on cron expressions or interval schedules. It consists of:

- **Daemon** — Background process managing cron/interval timers and executing workflows
- **TUI** — Interactive React/Ink terminal UI connected to the daemon via Unix socket
- **Scheduler CLI** — Non-interactive CLI for managing workflows

### Schedule Formats

| Format | Example | Description |
|--------|---------|-------------|
| Cron | `0 9 * * MON` | Standard cron expression (via `node-cron`) |
| Interval | `every 5m` | Repeat every 5 minutes |
| Interval | `every 30s` | Repeat every 30 seconds |
| Interval | `every 2h` | Repeat every 2 hours |

### Workflow Entry

```typescript
{
  id: string;                      // UUID (auto-generated)
  name: string;                    // Display name
  filePath: string;                // Path to workflow file
  schedule: string;                // Cron or interval expression
  enabled: boolean;                // Active/inactive toggle
  args?: Record<string, unknown>;  // Workflow arguments
}
```

### Run Record

```typescript
{
  id: string;                      // UUID
  workflowId: string;              // Links to WorkflowEntry
  triggeredBy: "schedule" | "manual";
  triggeredAt: string;             // ISO timestamp
  completedAt?: string;
  durationMs?: number;
  status: "running" | "success" | "error" | "pending-approval" | "rejected";
  input: { filePath, args?, schedule };
  output?: string;
  logs?: string;
  error?: string;
  failedStage?: string;            // Stage ID where workflow failed
  approvalInfo?: {
    prompt: string;
    items: unknown[];
    preview?: string;
    resumeToken: string;
    approvalId: string;
  };
}
```

### Engine Events

| Event | Payload | Description |
|-------|---------|-------------|
| `run-start` | `{ run }` | Workflow execution started |
| `run-complete` | `{ run }` | Workflow execution finished |
| `run-output` | `{ runId, text }` | Incremental output from running workflow |
| `approval-pending` | `{ run }` | Workflow halted at approval gate |
| `config-changed` | — | Workflow list was modified |

### TUI Screens

| Screen | Description |
|--------|-------------|
| **List** | All scheduled workflows with status indicators |
| **Add** | Form to create a new scheduled workflow |
| **Edit** | Modify an existing workflow |
| **History** | Run history for a specific workflow |
| **Run Detail** | Detailed view of a single run (output, logs, errors) |
| **YAML View** | View the raw workflow file |
| **Graph View** | DAG visualization of workflow steps |

### Persistence

All data is stored in `~/.config/lobster-copilot/`:

| File | Purpose |
|------|---------|
| `schedules.json` | Workflow definitions |
| `history.json` | Run history (capped at 100 per workflow) |
| `daemon.sock` | Unix domain socket for IPC |
| `daemon.pid` | Daemon PID file |

---

---

## 5. Plugin System

### Overview

Plugins let consumers add custom commands without modifying lobster-copilot source. Drop a `.js` file in the plugin directory and it's auto-discovered on startup.

### Plugin Directory Resolution (first found wins)

1. `--plugins <dir>` CLI flag
2. `LOBSTER_PLUGINS` environment variable
3. `~/.config/lobster-copilot/plugins/` (default)

### Plugin Contract

Each `.js` file must export a `createCommand` function (or default export):

```javascript
/**
 * @param {{ mcpServers: Record<string, unknown>, getAdapter: () => unknown }} ctx
 * @returns {LobsterCommand | LobsterCommand[]}
 */
export function createCommand(ctx) {
  return {
    name: "my-command.name",

    help: () => "my-command.name [--flag] — Short description",

    meta: {
      description: "Longer description for UI/tooling",
      argsSchema: { /* JSON Schema */ },
      sideEffects: ["network"],
    },

    async run({ input, args }) {
      // input: AsyncIterable<unknown> — piped data from previous stage
      // args: Record<string, unknown> — parsed flags

      // Drain input
      const items = [];
      for await (const chunk of input) items.push(chunk);

      // Do work...

      // Return output as async iterable
      return {
        output: (async function* () {
          yield { text: "result" };
        })(),
      };
    },
  };
}
```

### LobsterCommand Interface

```typescript
{
  name: string;                              // Command name (dot-separated convention)
  help: () => string;                        // One-liner help text
  run: (params: {
    input: AsyncIterable<unknown>;           // Piped input stream
    args: Record<string, unknown>;           // Parsed flags and positional args
  }) => Promise<{ output: AsyncIterable<unknown> }>;
  meta?: {
    description?: string;                    // UI/tooling description
    argsSchema?: object;                     // JSON Schema for args
    sideEffects?: string[];                  // e.g. ["network", "filesystem"]
  };
}
```

### Plugin Context

Plugins receive a context object with:

| Field | Type | Description |
|-------|------|-------------|
| `mcpServers` | `Record<string, McpServerConfig>` | Loaded MCP server configurations |
| `getAdapter` | `() => unknown` | Access to the CopilotAdapter instance |

### Example Plugin

See `examples/plugins/hello-world.js` for a complete, annotated example.

```bash
# Copy example to default plugin dir
mkdir -p ~/.config/lobster-copilot/plugins
cp examples/plugins/hello-world.js ~/.config/lobster-copilot/plugins/

# Use immediately
lobster-copilot -p "hello.world --name Alice"

# Or point at a custom dir
lobster-copilot -p "hello.world --name Alice" --plugins ./examples/plugins
```

### Error Handling

- Missing plugin directory → silently returns empty (no error)
- Plugin without `createCommand` export → warns to stderr, skips
- Plugin that throws during `createCommand()` → warns to stderr, skips
- Invalid return value → warns to stderr, skips

The scheduler engine loads plugins from the same directory, so custom commands work in scheduled workflows too.

---

## 6. Environment Variables

| Variable | Description |
|----------|-------------|
| `COPILOT_CLI_URL` | Override Copilot SDK CLI URL |
| `LOBSTER_LLM_PROVIDER` | Default LLM provider (set to `copilot` automatically) |
| `MCP_CONFIG` | Path to MCP config file |
| `LOBSTER_PLUGINS` | Plugin directory path |
| `NODE_NO_WARNINGS` | Set to `1` automatically to suppress experimental warnings |

---

## 7. Example Workflows

### ADO PR Monitor

```yaml
# examples/ado/pr-monitor.yaml
name: ado-pr-monitor
args:
  org: { description: "Azure DevOps org URL" }
  project: { description: "Project name" }
  status: { default: "active" }
  top: { default: "50" }
steps:
  - id: monitor
    pipeline: >
      ado.pr.monitor
      --org "${org}" --project "${project}"
      --status "${status}" --top "${top}"
```

```bash
lobster-copilot examples/ado/pr-monitor.yaml \
  --args-json '{"org":"https://dev.azure.com/myorg","project":"MyProject"}'
```

### PR Email Report (Multi-step Pipeline)

```yaml
# examples/ado/pr-email-report.yaml
name: pr-email-report
args:
  org: { required: true }
  project: { required: true }
  to: { description: "Email recipients (comma-separated)", required: true }
steps:
  - id: prs
    pipeline: >
      ado.pr.monitor --org "${org}" --project "${project}"
  - id: report
    pipeline: >
      copilot --prompt 'Create a concise HTML email summarising these PRs.
        Use <b> for titles, group by status. Include reviewer votes.'
    stdin: $prs
  - id: send
    pipeline: >
      mail.send --to '${to}' --subject 'PR Report — ${project}' --content-type HTML
    stdin: $report
```

### Mail Digest

```yaml
# examples/mail/mail-digest.yaml
name: mail-digest
steps:
  - id: unread
    pipeline: >
      mail.search --unread --folder inbox --top 20
    retry:
      max: 3
      backoff: exponential
      delay_ms: 1000
  - id: summary
    pipeline: >
      copilot --prompt 'Summarise as concise bullet-point digest. Group by sender.'
    stdin: $unread
  - id: notify
    pipeline: >
      teams.send --self
    stdin: $summary
```

### Scheduled Workflow (via CLI)

```bash
# Schedule the PR monitor to run every 5 minutes
lobster-copilot sched add \
  --name "ado-prs" \
  --file examples/ado/pr-monitor.yaml \
  --schedule "every 5m" \
  --args '{"org":"https://dev.azure.com/myorg","project":"MyProject"}'

# Schedule a daily mail digest at 9 AM
lobster-copilot sched add \
  --name "mail-digest" \
  --file examples/mail/mail-digest.yaml \
  --schedule "0 9 * * *"
```
