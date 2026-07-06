# Sample Gallery

TinyClaw includes a built-in gallery of sample workflows. Browse, search, and install pre-made workflows directly from the TUI or Web UI.

## Usage

**TUI:** Press `s` on the workflow list screen to open the gallery. Use `/` to search, arrow keys to navigate, `v` to preview, and `Enter` to install a sample.

**Web UI:** Click the **📦 Samples** button in the toolbar (or **📦 Browse Sample Gallery** if no workflows are configured). Double-click a card to preview the workflow YAML.

Installed workflows are saved to:
- **Linux / macOS:** `~/.config/tinyclaw/workflows/`
- **Windows:** `%APPDATA%\tinyclaw\workflows\`

## Contributing Samples

To add a new sample, create a workflow YAML in `gallery/samples/<category>/` and add an entry to `gallery/manifest.json`:

```json
{
  "id": "my-sample",
  "name": "My Sample Workflow",
  "description": "What this workflow does",
  "category": "general",
  "file": "samples/general/my-sample.yaml",
  "args": ["param1"],
  "tags": ["tag1", "tag2"]
}
```

### Manifest Fields

| Field | Description |
|-------|-------------|
| `id` | Unique identifier (kebab-case) |
| `name` | Display name |
| `description` | Short description shown in gallery cards |
| `category` | Folder/category grouping (e.g. `ado`, `mail`, `diary`, `general`) |
| `file` | Path relative to `gallery/` directory |
| `args` | List of workflow argument names |
| `tags` | Searchable tags for filtering |

### Categories

- **ado** — Azure DevOps workflows (PR monitoring, build investigation, code review)
- **mail** — Email automation (tracking, investigation, auto-reply)
- **diary** — Personal productivity (daily summaries)
- **observability** — Monitor scheduled-run health (e.g. surface failures as GitHub issues)
- **general** — General-purpose examples
