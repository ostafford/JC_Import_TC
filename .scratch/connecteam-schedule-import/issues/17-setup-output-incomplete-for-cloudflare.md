Type: task
Status: resolved

## Question

Not anticipated by any prior ticket: `importer setup`'s final printed output was written back when the Importer only ran locally, before issue 15's Cloudflare port existed. It printed `WEBHOOK_SHARED_SECRET` and the four Chat Link values, but silently wrote `timeClockId`, `senderId`, `manualBreaksEnabled`, and the break type IDs straight into `importer.config.json` without ever printing them — fine for the local Importer (which reads that file directly), but useless for a Cloudflare deployment, which has no local file to read and needs every one of those values typed into Worker vars by hand. Discovered live (2026-09-25) while actually configuring a real Cloudflare Importer deployment — the Admin had to open `importer.config.json` directly to find values the CLI never showed.

## Answer

`setup.ts`'s final output now prints every persisted config value explicitly (`conversationId`, `timeClockId`, `senderId`, `manualBreaksEnabled`, and both break type IDs if set), not just the subset that happened to matter for local deployment. It also now explicitly names both deployment targets and points at README.md's "Deploying to Cloudflare" section for exactly where each value goes, rather than assuming local `.env` is the only destination. The Relay Chat Link paste-in block is unchanged — that part was already complete.

This is the second setup-flow gap discovered by actually running the tool for real, not by re-reading the design (see [issue 16](16-time-clock-id-not-discoverable.md)) — the CLI and wizard were both designed and verified before the Cloudflare option existed, and neither had been re-examined for what a Cloudflare-deploying Admin specifically needs to see. Worth treating that as a standing question whenever anything else in the local setup flow changes: does this still make sense for someone deploying to Cloudflare, not just locally?
