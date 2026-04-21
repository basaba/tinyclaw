# Sample Approval Workflow
#
# Demonstrates Lobster's approval gate: the workflow pauses at the
# "confirm" step and waits for a human yes/no before continuing.
#
# Run interactively (prompts on the terminal):
#   lobster run --file sample-approval.lobster
#
# Run in tool mode (returns JSON with resumeToken):
#   lobster run --mode tool --file sample-approval.lobster
#
# Resume after approval:
#   lobster resume --id <approvalId> --approve yes
#   lobster resume --id <approvalId> --approve no

name: sample-approval
description: A minimal workflow that pauses for approval before deploying

steps:
  - id: build
    run: echo '{"artifact":"app-v1.2.3.tar.gz","size_mb":42}'

  - id: confirm
    approval: "Deploy app-v1.2.3 to production?"
    stdin: $build.json

  - id: deploy
    run: echo '{"status":"deployed","artifact":"app-v1.2.3.tar.gz"}'
    when: $confirm.approved
