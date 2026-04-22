# Demo Approval Workflow
#
# A simple workflow that generates sample items and pauses
# for approval, demonstrating the rich approval item display.
#
# Run:
#   lobster run --file workflows/demo-approval.lobster
#   lobster run --mode tool --file workflows/demo-approval.lobster

name: demo-approval
description: Demo workflow showing structured approval items

steps:
  - id: gather
    run: |
      echo '[
        {"id":"PR-101","title":"Fix login timeout bug","author":"alice","status":"ready","summary":"Increases session timeout from 5m to 30m"},
        {"id":"PR-204","title":"Add dark mode support","author":"bob","status":"ready","summary":"Adds CSS variables for dark theme toggle"},
        {"id":"PR-317","title":"Upgrade Node to v22","author":"carol","status":"ready","summary":"Bumps Node runtime and updates CI pipeline"}
      ]'

  - id: confirm
    approval: "Merge these pull requests?"
    stdin: $gather.json
