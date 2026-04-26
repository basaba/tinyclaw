# Workflow Generation Patterns

When generating workflows from natural language descriptions, follow these patterns:

## Pattern: Fetch → Transform → Act

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

## Pattern: Diff-Based Monitor

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

## Pattern: Search → Read → Summarize → Notify

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

## Pattern: Approval-Gated Action

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

## Pattern: Parallel Fetch

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

## Pattern: Loop with Batching

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

## Best Practices

1. **Use `pipeline:` for data transformation** — chain Lobster commands instead of shell pipes.
2. **Use `run:` for OS commands** — `curl`, `gh`, shell scripts.
3. **Always set `stdin:` when a step needs prior output** — use `$step_id` or `$step_id.json`.
4. **Add `retry:` for network calls** — especially API calls and MCP tool invocations.
5. **Use `--dry-run` first** to validate workflows before executing.
6. **Prefer `diff.gate` for monitors** — avoids duplicate notifications.
7. **Keep pipelines flat** — avoid unnecessary nesting of workflows/sub-workflows.
8. **Use `on_error: continue`** for non-critical steps that shouldn't block the workflow.
