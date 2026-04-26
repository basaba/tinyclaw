# TinyClaw

Bridge service integrating [OpenClaw Lobster](https://github.com/openclaw/lobster) workflows with GitHub Copilot as the LLM reasoning engine. Provides two integration modes:

1. **Native Lobster Adapter** — plugs directly into `llm.invoke --provider copilot` via Lobster's `ctx.llmAdapters` system
2. **MCP Server** — exposes reasoning tools via the [Model Context Protocol](https://modelcontextprotocol.io/)

## Architecture

```
┌──────────────────────┐      MCP (stdio/sse)      ┌───────────────────────┐
│   Lobster Workflow   │ ◄──────────────────────► │   tinyclaw     │
│   Engine             │                           │   (MCP Server)        │
└──────────────────────┘                           │                       │
                                                   │  ┌─────────────────┐  │
                                                   │  │  Tool Registry  │  │
                                                   │  │  reason         │  │
                                                   │  │  summarize      │  │
                                                   │  │  code_review    │  │
                                                   │  │  llm_invoke     │  │
                                                   │  └────────┬────────┘  │
                                                   │           │           │
                                                   │  ┌────────▼────────┐  │
                                                   │  │ Context Builder │  │
                                                   │  └────────┬────────┘  │
                                                   │           │           │
                                                   │  ┌────────▼────────┐  │
                                                   │  │  Memory Store   │  │
                                                   │  │  (SQLite)       │  │
                                                   │  └─────────────────┘  │
                                                   │           │           │
                                                   │  ┌────────▼────────┐  │
                                                   │  │ Copilot Bridge  │──┼──► GitHub Copilot
                                                   │  │ Client (SDK)    │  │
                                                   │  └─────────────────┘  │
                                                   └───────────────────────┘
```

## Quick Start

### Option A: Native Lobster Adapter (Recommended)

Use Copilot directly as an `llm.invoke` provider — no MCP server needed:

```typescript
import { createCopilotAdapters } from 'tinyclaw/adapters';
import { runToolRequest } from '@basaba/lobster/tool_runtime';

const { adapters, dispose } = createCopilotAdapters({
  cliUrl: 'http://localhost:3000', // optional: Copilot CLI server URL
});

try {
  const result = await runToolRequest({
    pipeline: `llm.invoke --provider copilot --prompt 'Summarize this document'`,
    ctx: { llmAdapters: adapters },
  });
  console.log(result.output);
} finally {
  await dispose();
}
```

Or in a Lobster YAML workflow:

```yaml
name: analyze-with-copilot
env:
  LOBSTER_LLM_PROVIDER: copilot
steps:
  - name: summarize
    run: |
      cat README.md | llm.invoke --prompt 'Summarize this document in 3 bullet points'
  - name: extract-actions
    run: |
      cat notes.md | llm.invoke --prompt 'Extract action items' --output-schema '{"type":"array","items":{"type":"object","properties":{"task":{"type":"string"},"assignee":{"type":"string"}}}}'
```

### Option B: MCP Server

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env

# Build & run
npm run build
npm start
```

## How It Works

### Native Adapter Mode

The `CopilotAdapter` implements Lobster's `DirectAdapter` interface. When registered in `ctx.llmAdapters`, it intercepts `llm.invoke --provider copilot` calls and:

1. Builds a structured prompt from the payload (task, artifacts, output schema, retry context)
2. Sends it to GitHub Copilot via the `@github/copilot-sdk`
3. Extracts JSON when `outputSchema` is specified (full-parse → fenced blocks → balanced extraction)
4. Returns a standard `LlmResponseEnvelope` that Lobster's caching and validation system processes

The adapter lazily initializes the Copilot SDK client on first call. Call `dispose()` to clean up.

**Note:** The Copilot SDK manages its own model selection. `--model`, `--temperature`, and `--max-output-tokens` params are accepted but produce warnings since they cannot be enforced.

### MCP Server Mode

1. **Lobster** invokes MCP tools (e.g., `reason`) through the MCP protocol.
2. The **MCP server** receives the request and routes it to the appropriate tool handler.
3. The **Context Builder** fetches prior conversation history and relevant memory from the **Memory Store** (SQLite), assembling a context window within the configured token budget.
4. The **Copilot Bridge Client** sends the prompt + context to GitHub Copilot via the `@github/copilot-sdk`.
5. The response is persisted back to the memory store and returned to Lobster.

## Available MCP Tools

### `reason`

General-purpose LLM reasoning powered by GitHub Copilot.

| Parameter         | Type   | Required | Description                          |
| ----------------- | ------ | -------- | ------------------------------------ |
| `prompt`          | string | ✅       | The reasoning prompt                 |
| `conversation_id` | string | ❌       | Conversation ID for context history  |
| `workflow_id`     | string | ❌       | Workflow identifier                  |
| `namespace`       | string | ❌       | Memory namespace                     |

### `summarize`

Summarize data from workflow steps.

| Parameter         | Type   | Required | Description                                      |
| ----------------- | ------ | -------- | ------------------------------------------------ |
| `data`            | string | ✅       | Data to summarize                                |
| `format`          | string | ❌       | Output format: `brief`, `detailed`, `bullet_points` (default: `brief`) |
| `conversation_id` | string | ❌       | Conversation ID for context history              |

### `code_review`

Analyze code for bugs, security issues, and improvements.

| Parameter         | Type   | Required | Description                                  |
| ----------------- | ------ | -------- | -------------------------------------------- |
| `code`            | string | ✅       | Code to review                               |
| `language`        | string | ❌       | Programming language                         |
| `focus`           | string | ❌       | Focus area: `bugs`, `security`, `performance`, `all` (default: `all`) |
| `conversation_id` | string | ❌       | Conversation ID for context history          |

### `llm_invoke`

Lobster-native `llm-task` compatible tool. Supports both structured JSON and freeform text actions — drop-in replacement for any `llm-task` step in your workflow.

| Parameter         | Type   | Required | Description                                  |
| ----------------- | ------ | -------- | -------------------------------------------- |
| `prompt`          | string | ✅       | The prompt text to send to the LLM           |
| `action`          | string | ❌       | `json` for structured output, `text` for freeform (default: `text`) |
| `input`           | any    | ❌       | Structured input data (included as context)  |
| `schema`          | object | ❌       | JSON Schema to validate output (with `json` action) |
| `model`           | string | ❌       | Model name override                          |
| `temperature`     | number | ❌       | Sampling temperature (0–2)                   |
| `maxTokens`       | number | ❌       | Max output tokens (default: 800)             |
| `thinking`        | string | ❌       | Reasoning depth: `low`, `medium`, `high`     |
| `conversation_id` | string | ❌       | Conversation ID for memory persistence       |
| `workflow_id`     | string | ❌       | Workflow ID for namespace isolation           |

**Example Lobster workflow step:**
```yaml
- id: classify-email
  type: tool
  tool: llm_invoke
  config:
    action: json
    prompt: "Given the input email, return intent and draft reply."
    input: $steps.fetch-email.result
    schema:
      type: object
      properties:
        intent: { type: string }
        draft: { type: string }
      required: [intent, draft]
    thinking: low
    conversation_id: "email-session"
```

## Memory Management

tinyclaw uses SQLite for persistent memory across workflow steps.

### Conversations & Messages

Each workflow step can share a `conversation_id` to maintain context across multiple tool calls. Messages (user prompts and assistant responses) are automatically persisted.

### Key-Value Store

The memory store also supports namespaced key-value entries with optional TTL:

- **Namespace isolation** — different workflows can use separate namespaces.
- **TTL expiration** — entries can auto-expire after a configured number of hours.
- **Cleanup** — expired entries are periodically removed via `deleteExpiredMemory()`.

## Example Lobster Workflows

See the [`examples/`](./examples) directory:

- **[simple-reasoning.yaml](./examples/simple-reasoning.yaml)** — Single-step reasoning workflow.
- **[multi-step-analysis.yaml](./examples/multi-step-analysis.yaml)** — Multi-step workflow with data fetching, summarization, approval gate, deep analysis, and report generation — all sharing a conversation for context continuity.

## Configuration

| Variable              | Default                | Description                                |
| --------------------- | ---------------------- | ------------------------------------------ |
| `COPILOT_API_KEY`     | *(none)*               | GitHub Copilot API key (uses GitHub auth by default) |
| `COPILOT_CLI_URL`     | *(none)*               | URL to connect to an existing Copilot CLI server |
| `SQLITE_PATH`         | `./tinyclaw.db` | Path to the SQLite database file           |
| `MEMORY_TTL_HOURS`    | `168`                  | Default memory entry TTL in hours (1 week) |
| `CONTEXT_TOKEN_BUDGET`| `8000`                 | Max tokens for the LLM context window      |
| `MCP_TRANSPORT`       | `stdio`                | MCP transport: `stdio` or `sse`            |
| `LOG_LEVEL`           | `info`                 | Log level: `debug`, `info`, `warn`, `error`|

## Development

```bash
# Build
npm run build

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Type-check without emitting
npm run typecheck

# Lint
npm run lint

# Development mode (tsx)
npm run dev
```

## License

See [LICENSE](./LICENSE) for details.
