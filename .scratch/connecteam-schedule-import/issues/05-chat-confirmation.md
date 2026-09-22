Type: grilling
Status: resolved

## Question

Should the Importer post a confirmation/result message back into the linked Connecteam Chat conversation after an Import Run finishes (success count, skipped rows, failures)? If so, what should that message contain, and does it use the outbound "send message" Chat API already confirmed to exist? If not, how does the Admin find out an Import succeeded or failed?

Context from [issue 04](04-import-failure-policy.md): the Admin already confirmed that a locked-timesheet-day failure, at minimum, should be flagged in Chat, naming the affected Employee and advising the Admin to reopen it. Issue 04 also defines the full Import Run outcome record this ticket can draw on: total/succeeded/skipped counts (skipped broken down by reason) plus a per-row `{date, employee name, outcome, reason}` list.

## Answer

**Always post a result message** after every Import Run — Chat is the only interface for this tool, so silence would be ambiguous (ran-and-succeeded vs. never-triggered).

**Full success**: a short one-line confirmation, e.g. "✅ Imported 18 shifts from your schedule export." No per-row detail needed when nothing went wrong.

**Partial/full failure**: a short text summary (counts by outcome, kept well under Connecteam's message limit — see Mechanics) plus a separate attached report file carrying the full per-row detail from issue 04's outcome record (`{date, employee name, outcome, reason}`), reusing the same Attachments API the Importer already uses to receive the Schedule Export — upload the report, then reference its `fileId` in the outbound message's `attachments` array.

**Mechanics** (`POST /chat/v1/conversations/{conversationId}/message`, body: `senderId`, `text`, optional `attachments`): the message text field has a documented max of 1000 characters, but the same reference page's field description contradicts it at "under 500" — Connecteam's own docs disagree with themselves, so the Importer should target well under 500 for the text summary, and always route detail into the attached file rather than the message body. Only one non-image file attachment is allowed per message. No threading/reply support exists at all — every result message posts as a new top-level message in the linked conversation, never a reply to the original upload.
