# 🦞 TinyClaw

TinyClaw is an automation engine that is meant to run determenistic workflows locally with native integration with LLM/coding agents.
Think of it as Power Automate/CI-CD that is running locally and work with full coding agent capabilities.
It uses Lobster as it's workflow execution engine.

### What is Lobster?

[Lobster](https://github.com/openclaw/lobster) is OpenClaw's workflow shell — a JSON-first pipeline DSL language for deterministic, resumable automation. Pipelines are composed of typed stages connected by pipes, with built-in support for approval gates, retry logic, state management, and structured input/output.

> Note:
> TinyClaw uses forked version of lobster that has some additions located [here](https://github.com/basaba/lobster). 

While Lobster is powerful, but it was built to handle only the execution core only and not the UX around (e.g. the scheduling), this project aimed to bridge this gap, and more improtantly offer 
more capabilities to make it work with copilot and agency mcps.
<br>
It aims to make it simple to author and schedule execution pipelines locally, that otherwise would require the dev to write custom scripts and run it with cronjobs.

### What it does

- **LLM-powered workflows** — Use `llm.invoke --provider copilot` in any Lobster pipeline to call copilot for reasoning, summarization, code review, or structured data extraction.
- **Scheduler & TUI** — Schedule workflows on cron-like intervals and manage them from a terminal UI. A background daemon handles execution, approval gates, and run history.
- **MCP integration** — Call external tools via the MCP. TinyClaw discovers and connects to MCP servers defined in your config, with native support for agency MCP servers (mail, Teams, and more) out of the box.
- **Built-in commands** — Send Teams messages, search and compose emails, monitor Azure DevOps PRs — all from within workflows.
- **Plugin system** — Drop `.js` files in the plugin directory to add custom commands without modifying source.


## Short examples

Monitor ADO PRs given critirea and send as teams message.   
```yaml
steps:
  - id: monitor
    pipeline: >
      ado.pr.monitor
      --org "${org}"
      --project "${project}"
      --repository "${repository}"
      --creator "${creator}"
      --days "${days}"
      | where changed==true # Remove already processed PRs
      | copilot --prompt "Summarize these PRs"
      | teams.send --self # send to self via Teams agency MCP
```

Summarize mails and send to self.
```yaml
steps:
  - id: mail-track
    pipeline: >
        mail.search --folder inbox --top 5 --order-by newest
        | copilot --prompt "Summarize these mails"
        | teams.send --self
```

See more:
- [Language Specification](./docs/LANGUAGE_SPEC.md) — Full reference for Lobster syntax, cli doc, built-in commands, and TinyClaw extensions.
- [Examples](./examples) — Ready-to-run workflows for mail, Teams, ADO PR monitoring, and more.

## Installation

### From npm

```bash
npm install -g @basaba/tinyclaw
```

### From source

```bash
git clone https://github.com/basaba/tinyclaw.git
cd tinyclaw
npm install
npm run build
npm link
```

## Quick Start

Launch the TUI (terminal UI):

```bash
tinyclaw
```

Launch the Web UI:

```bash
tinyclaw web
```

This starts a web server at `http://127.0.0.1:7777`. Open it in your browser for a full dashboard with workflow management, run history, and the sample gallery.

Options:
```bash
tinyclaw web --port 8080        # Custom port
tinyclaw web --host 0.0.0.0     # Listen on all interfaces
```

Launch the desktop UI (Electron):

```bash
tinyclaw ui
```

Run a workflow file:

```bash
tinyclaw examples/approval-demo.yaml
```

Run a pipeline string:

```bash
tinyclaw -p "llm.invoke --provider copilot --prompt 'Hello'"
```

## skill

TinyClaw includes a GitHub Copilot CLI skill that helps you write, debug, and understand Lobster workflows directly in your terminal. Once installed, Copilot gains expert knowledge of Lobster syntax, pipeline patterns, and TinyClaw commands.
In copilot cli run this:

```bash
/plugin install basaba/tinyclaw
```

## Sample Gallery

TinyClaw includes a built-in gallery of sample workflows. Browse, search, and install pre-made workflows directly from the TUI or Web UI.

See [gallery/README.md](./gallery/README.md) for usage and how to contribute samples.


## License

See [LICENSE](./LICENSE) for details.
