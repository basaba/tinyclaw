# Email Triage & Draft Reply Workflow
#
# Fetches recent unread emails, uses Copilot to triage them
# (needs-reply vs FYI vs ignore), drafts replies for actionable
# ones, and creates Outlook drafts after human approval.
#
# Prerequisites:
#   - agency mcp mail server configured (auth via Entra)
#
# Run:
#   lobster run --file workflows/email-triage.lobster
#   lobster run --mode tool --file workflows/email-triage.lobster

name: email-triage
description: Triage unread emails and draft replies with approval

steps:
  - id: fetch
    pipeline: >
      agency.mcp.call
      --server mail
      --tool SearchMessagesQueryParameters
      --args '{"queryParameters": "?$filter=isRead eq false&$top=1"}'
    retry:
      max: 3
      backoff: exponential
      delay_ms: 1000

  - id: triage
    stdin: "$fetch.stdout"
    pipeline: >
      llm.invoke
      --prompt 'You are an email triage assistant.
      Analyze the emails and classify each one:
        - "needs-reply": requires a response from me
        - "fyi": informational, no reply needed
        - "ignore": spam, notifications, automated messages
      Include a 1-2 sentence summary and the first 200 chars of body for each.'
      --output-schema '{"type":"object","properties":{"emails":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string"},"from":{"type":"string"},"subject":{"type":"string"},"category":{"type":"string","enum":["needs-reply","fyi","ignore"]},"summary":{"type":"string"},"bodyPreview":{"type":"string"}},"required":["id","from","subject","category","summary"]}}},"required":["emails"]}'
      --schema-version email-triage.v1

  - id: draft
    stdin: "$triage.stdout"
    pipeline: >
      llm.invoke
      --prompt 'You are a professional email assistant.
      For each email classified as "needs-reply" in the input,
      draft a concise, professional reply.
      If no emails need a reply, return an empty array.'
      --output-schema '{"type":"object","properties":{"drafts":{"type":"array","items":{"type":"object","properties":{"messageId":{"type":"string"},"from":{"type":"string"},"subject":{"type":"string"},"summary":{"type":"string"},"replyText":{"type":"string"}},"required":["messageId","from","subject","replyText"]}}},"required":["drafts"]}'
      --schema-version email-draft.v1

  - id: confirm
    approval: "Review drafted email replies before creating Outlook drafts"
    stdin: "$draft.json.drafts"

  # - id: send
  #   when: $confirm.approved
  #   for_each: "$draft.json.drafts"
  #   item_var: d
  #   steps:
  #     - id: reply
  #       stdin: "$d.json"
  #       pipeline: >
  #         map id={{messageId}} comment={{replyText}}
  #         | pick id comment
  #         | agency.mcp.call --server mail --tool ReplyToMessage --args '{"sendImmediately": false}'
