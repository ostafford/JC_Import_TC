# Connecteam Schedule → Timesheet Import

A personal, open-source integration that lets a Connecteam account Admin turn an exported Schedule into Time Clock entries for their Employees, triggered by uploading the export as a file in a linked Connecteam Chat conversation. The system is deliberately split across two pieces of software so that the publicly-hosted half never sees a customer's Connecteam credentials or data.

## Language

**Admin**:
Any Connecteam account owner/admin at a company using this tool. A company can have several Admins; nothing here assumes only one. Whichever Admin can access the linked Chat Link conversation can trigger an Import Run; whichever Admin logs into the Relay can manage that company's Chat Link record.
_Avoid_: User, customer (ambiguous with Connecteam's own "User" concept — see Employee), "the Admin" implying exactly one person per company

**Employee**:
A Connecteam user whose scheduled shift is being imported into their own timesheet. This is Connecteam's own "User" concept, scoped to this project's vocabulary as Employee to keep it distinct from the software processes below.
_Avoid_: User, worker (worker is reserved — see Importer)

**Relay**:
The website/service this project builds, self-hosted by each company that deploys it (cloned from the same open-source repo as the Importer, not a shared service run on other companies' behalf). It stores only a Chat Link per Admin and forwards a trigger event when it detects a Schedule Export upload — it never receives, stores, or forwards the Admin's Connecteam API token or the Schedule Export's contents.
_Avoid_: The website, the app, the server, "the hosted Relay" (implying one shared instance across companies)

**Importer**:
The Admin's own self-hosted process, holding the Admin's own Connecteam API token, that does the actual work: downloading the Schedule Export, parsing it, matching rows to Employees, and writing Time Activities. One Importer per Admin; the Relay never runs it.
_Avoid_: Worker, the backend, the LLM (an Importer may or may not use an LLM internally — that's an implementation detail of the Importer, not what the term means)

**Chat Link**:
The Relay's stored pairing of one Admin's Connecteam Chat conversation ID to that Admin's Importer endpoint. This is the entire state the Relay holds per Admin.
_Avoid_: Config, connection, integration

**Schedule Export**:
The Excel/CSV file an Admin generates from Connecteam's own Schedule export feature and uploads as a chat attachment to start an Import Run. Its column layout is fixed by Connecteam, not by this project.
_Avoid_: The CSV, the file, the spreadsheet (all still fine informally, but Schedule Export is the canonical name for tickets/docs)

**Import Run**:
The end-to-end act of turning one Schedule Export upload into Time Activities in Connecteam, performed entirely by an Importer after the Relay forwards the trigger. One trigger produces exactly one Import Run; there is no separate "Import" concept above it.
_Avoid_: Import (was the earlier glossary term; renamed to match the codebase's own usage — `runImportRun`, `ImportRunOutcome`, chat copy), sync, upload (upload refers only to the Admin's chat action, not the whole operation)

**Time Activity**:
Connecteam's own API term for a single timesheet/time-clock entry (a shift, or a break within a shift). Borrowed directly from Connecteam's API — not renamed, since tickets will reference Connecteam's API docs directly.

**Time Clock**:
Connecteam's own container that Time Activities (and, where job tracking is enabled, Jobs) are scoped to. An Admin picks one Time Clock to write to during setup; every Import Run for that Admin writes into it. Borrowed directly from Connecteam's own naming.
_Avoid_: Clock, timesheet (timesheet is the general concept; Time Clock is the specific Connecteam entity holding it)

**Job**:
A Connecteam job-tracking record, scoped to one Time Clock, that some Time Clocks (not all) require every Time Activity to reference. Matched from the Schedule Export's `Resource` column (e.g. "Chef", "Barista") by title, case-sensitively. Borrowed directly from Connecteam's own naming.
_Avoid_: Resource (Resource is only the Schedule Export's column name for the value that gets matched to a Job — not the domain concept itself), role

**Break Type**:
A pre-configured, account-specific identifier (set up in the Admin's own Connecteam account settings) that every break Time Activity must reference. Not a free-text or paid/unpaid field on the break itself.

**Custom Publisher**:
A bot-like chat-sender identity an Admin configures in their own Connecteam account (Settings → Feed settings), distinct from any real Employee's identity. Every chat message an Importer posts — results, aborts, crash notices — is sent as a Custom Publisher, never as a real Employee, because Connecteam's Chat "send message" API requires it.
_Avoid_: Sender, bot, publisher ID (PublisherId is the branded type in code; Custom Publisher is the concept)
