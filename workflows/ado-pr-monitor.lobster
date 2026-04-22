# Azure DevOps PR Monitor Workflow
#
# Monitors active PRs in an Azure DevOps project and reports changes
# (new PRs, closed PRs, updated reviews/status) across runs.
#
# Prerequisites:
#   - Azure CLI with azure-devops extension (`az extension add --name azure-devops`)
#   - Authenticated via `az login`
#
# Args (pass via --args-json):
#   org         (required) Azure DevOps org URL, e.g. "https://dev.azure.com/myorg"
#   project     (required) Project name
#   repository  (optional) Repository name filter
#   targetBranch(optional) Target branch filter (e.g. "main")
#   sourceBranch(optional) Source branch filter
#   creator     (optional) PR creator filter
#   reviewer    (optional) PR reviewer filter
#   status      (optional) "active" | "completed" | "abandoned" | "all" (default: active)
#   top         (optional) Max PRs to return (default: 50)
#
# Run:
#   lobster-copilot workflows/ado-pr-monitor.lobster \
#     --args-json '{"org":"https://dev.azure.com/myorg","project":"MyProject","status":"active"}'
#
# Schedule via TUI / sched:
#   lobster-copilot sched add \
#     --name ado-prs \
#     --file workflows/ado-pr-monitor.lobster \
#     --schedule "every 5m" \
#     --args '{"org":"https://dev.azure.com/myorg","project":"MyProject","status":"active"}'

name: ado-pr-monitor
description: Monitor Azure DevOps PRs and report changes

args:
  org:
    description: "Azure DevOps org URL (e.g. https://dev.azure.com/myorg)"
  project:
    description: "Project name"
  repository:
    description: "Repository name filter"
    default: null
  targetBranch:
    description: "Target branch filter"
    default: null
  sourceBranch:
    description: "Source branch filter"
    default: null
  creator:
    description: "PR creator filter"
    default: null
  reviewer:
    description: "PR reviewer filter"
    default: null
  status:
    description: "PR status filter (active/completed/abandoned/all)"
    default: "active"
  top:
    description: "Max PRs to return"
    default: "50"
  days:
    description: "Only include PRs created within the last N days"
    default: null

steps:
  - id: monitor
    pipeline: >
      ado.pr.monitor
      --org "${org}"
      --project "${project}"
      --status "${status}"
      --top "${top}"
      --repository "${repository}"
      --target-branch "${targetBranch}"
      --source-branch "${sourceBranch}"
      --creator "${creator}"
      --reviewer "${reviewer}"
      --days "${days}"
      | copilot --prompt 'You are a PR activity summarizer.
      Analyze this Azure DevOps PR monitor result and produce a concise summary:
      1. Total PR count
      2. New PRs added since last check (if any)
      3. PRs removed/closed since last check (if any)
      4. PRs with updated status, reviewers, or votes (if any)
      5. For each current PR: number, title, author, target branch, reviewer votes
      6. Flag any PRs with all approvals (ready to merge)
      7. Flag any PRs with rejected votes
      Keep it concise — one line per PR with status indicators.'