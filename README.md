# Connecteam Schedule → Timesheet Import

Lets a Connecteam account Admin turn an exported Schedule into Time Clock entries, triggered by uploading the export as a file in a linked Connecteam Chat conversation.

The system is split into two self-hosted pieces so that no shared infrastructure ever sees a customer's Connecteam credentials or data — see [`docs/adr/0001-relay-never-touches-customer-data.md`](docs/adr/0001-relay-never-touches-customer-data.md) for why:

- **Relay** — stores one Chat Link (a conversation ID + an Importer's endpoint URL) per Admin, and forwards a bare trigger event when it sees a Schedule Export uploaded. Never sees a Connecteam API token or the export's contents.
- **Importer** — the Admin's own process, holding the Admin's own Connecteam API token. Does the actual work: downloads the Schedule Export, parses it, matches rows to Employees, and writes Time Activities.

Both are cloned and run from this same repo, self-hosted by whoever deploys them — not a shared service. See [`CONTEXT.md`](CONTEXT.md) for the full vocabulary (Admin, Employee, Chat Link, Import Run, etc.) used throughout the code and docs.

## Requirements

- Node.js >= 20
- A Connecteam account on the Expert plan (required for API token access), with admin rights to create an API token and a Custom Publisher
- A way to expose two local ports to the public internet: one for the Relay, one for the Importer. Any tunnel tool works (e.g. `cloudflared tunnel --url http://localhost:8788`, or `ngrok`). This is needed during setup and for as long as the integration should keep running — **or** deploy either piece (or both) to Cloudflare instead and skip its tunnel entirely (see [Deploying to Cloudflare](#deploying-to-cloudflare-optional) below, including its cost note — the Importer's Cloudflare option isn't free).

## Setup

Setup is done once per company, through a browser-based wizard. It talks to Connecteam and to your own Relay, and writes the Importer's config for you.

### 1. Install and build

```
git clone <this repo>
cd sch_import
npm install
npm run build
```

### 2. Set a shared setup token

The wizard authenticates its one-time call into the Relay with a shared secret. For now this is set by hand and must be identical in both files:

```
cp packages/relay/.env.example packages/relay/.env
cp packages/wizard/.env.example packages/wizard/.env
```

Generate a random value (e.g. `openssl rand -hex 32`) and set it as `WIZARD_SETUP_TOKEN` in both `packages/relay/.env` and `packages/wizard/.env`.

### 3. Start the Relay and the Importer

```
npm run relay      # listens on :8788 by default
npm run importer   # listens on :8787 by default
```

Leave both running in their own terminals.

### 4. Expose both publicly

Start two tunnels, one per process, and note the public URL each one gives you:

```
cloudflared tunnel --url http://localhost:8788   # → Relay's public URL
cloudflared tunnel --url http://localhost:8787   # → Importer's public URL
```

Set `RELAY_BASE_URL` in `packages/relay/.env` to the Relay's tunnel URL, then restart the Relay so it picks up the change.

### 5. Run the wizard

```
npm run wizard   # listens on :8789 by default
```

Open `http://localhost:8789` and work through its six steps:

1. **Connecteam API token** — from Connecteam: Settings → Integrations → API.
2. **Pick a conversation** to link, and enter the Relay's public webhook URL (the Relay's tunnel URL from step 4, with `/webhooks/connecteam` appended). Use a chat containing only the Admins who should be able to trigger an Import Run.
3. **Create the webhook yourself in Connecteam** — the wizard shows you the exact values to enter (name, endpoint URL, secret key, feature, event type), then verifies it exists once you confirm.
4. **Time Clocks and Custom Publisher ID** — pick every Time Clock this Importer should be able to write to (one is fine; pick more if this Admin manages several locations — see [Multiple Time Clocks](#multiple-time-clocks) below), and the Custom Publisher chat confirmations post as (Connecteam admin → Settings → Feed settings → Custom Publishers, if you haven't made one yet).
5. **Default Break Types, one pass per Time Clock** — for each Time Clock picked in step 4 with manual breaks enabled, picks the default label for unpaid and paid breaks (actual durations always come from the Schedule Export); a Time Clock with breaks disabled is skipped automatically.
6. **Importer's public endpoint URL and your email** — the Importer's tunnel URL from step 4, and the email you'll use to log into the Relay's dashboard later (magic-link, no password).

Finishing step 6 writes `packages/importer/importer.config.json` and `packages/importer/.env`, and saves the Chat Link on the running Relay.

### 6. Restart the Importer

The wizard writes the Importer's config to disk but can't reach into its already-running process, so restart it once setup finishes:

```
npm run importer
```

Keep the Relay, the Importer, and both tunnels running for the integration to keep working.

## Day-to-day use

Once set up, an Admin uploads a Schedule Export to the linked chat conversation. Connecteam calls the Relay's webhook, the Relay forwards a bare trigger (conversation ID, message ID, attachment URL — never the file itself or a token) to the Importer, and the Importer does the rest, posting the result back to the same chat.

To manage the Chat Link later (e.g. re-point it at a different Importer endpoint), log into the Relay at its public URL with the Admin email from step 6 — it emails a magic link, or logs it to the console if no SMTP is configured (see `packages/relay/.env.example`).

## Multiple Time Clocks

One Importer can hold several Time Clocks — for one company with several locations (a café chain, say), each its own Time Clock feeding its own payroll/Xero connection, all still sharing one Chat Link and one set of Admins.

Each Import Run resolves to exactly one Time Clock, checked in this order:

1. **Primary — the Schedule Export's own Jobs.** The `Resource` column is matched to a real Connecteam Job, the same job-tracking match this project already makes, and that Job's own Time Clock association is used automatically — no extra step from the Admin at all. This only resolves cleanly if every Job referenced in one Schedule Export belongs to the *same* Time Clock, so for this to work reliably, set each location's Jobs up as exclusive to that location's Time Clock in Connecteam.
2. **Fallback — a caption on the upload.** If the Jobs don't resolve to exactly one Time Clock (shared Jobs, or a genuinely mixed file), add a caption to the file when uploading it in Connecteam Chat, naming the Time Clock — e.g. "add to Xero v2". Matching looks for the Time Clock's name anywhere in the caption, case-insensitive, so a full sentence is fine.

If neither resolves it, or the two disagree (the Jobs point to one Time Clock, the caption names a different one), nothing is imported — Chat explains why and, for an unresolved case, lists the valid Time Clock names, so a real disagreement is never silently guessed through.

With only one Time Clock configured, none of this applies — every Import Run just uses it, exactly as if this feature didn't exist.

## CLI setup (fallback)

`packages/importer` also has a terminal-based setup you can run directly against the Importer, without the Relay or wizard involved:

```
npm run importer -- setup
```

This prompts for the same information as the wizard — including a multi-select for Time Clocks and a Break Type picker for each one — has Connecteam create the webhook automatically instead of walking through it in Connecteam's UI, and prints the values you'd need to paste into the Relay's dashboard by hand. If `importer.config.json` already exists, it offers to add one more Time Clock instead of redoing everything.

## Deploying to Cloudflare (optional)

Both the Relay and the Importer can run as Cloudflare Workers instead of local processes + tunnels — no laptop needs to stay on, and each gets a stable public URL that never changes across restarts. They're independent choices: run one, the other, or both, in any combination. The browser wizard doesn't drive any Cloudflare deployment yet — use the CLI setup fallback (`npm run importer -- setup`, described above) either way, then paste values in by hand as described per-piece below.

**Cost note**: the Relay is free either way. The Importer needs the **Workers Paid plan (~$5/month)**, not Free — its per-row Connecteam API calls (issue 08: 45 rows → ~140 calls in one real run) exceed the Free plan's 50-subrequest-per-invocation limit. A useful combination for a security-conscious Admin: Relay on Cloudflare (public-facing, never holds your Connecteam token, free) + Importer local (holds your real token, stays on your own network, also free) — full Cloudflare is the easiest to run continuously, but isn't free.

### Relay

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ostafford/JS_Import_TC/tree/main/packages/relay-cloudflare)

Or manually: `cd packages/relay-cloudflare && npx wrangler deploy`

Either way, this prints the Worker's public URL (`https://sch-import-relay.<your-subdomain>.workers.dev` by default) — that's the Relay's webhook URL for the rest of setup. To finish: run `npm run importer -- setup` using this URL (with `/webhooks/connecteam` appended) as the Relay webhook URL when prompted, then open the Cloudflare Relay's URL and sign in — read the magic link from `npx wrangler tail` (run from `packages/relay-cloudflare`) since no email provider is configured by default — and paste the values `importer setup` printed into the Chat Link form.

### Importer

Either way, run `npm run importer -- setup` first (if you haven't already) against your real Connecteam account — you'll need the values it writes to `packages/importer/importer.config.json` (`conversationId`, `senderId`, and the list of configured Time Clocks with their break settings) plus the generated shared secret it prints, for either path below.

**Using the button** (no terminal needed for anything after clicking it):

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ostafford/JS_Import_TC/tree/main/packages/importer-cloudflare)

> **Known issue (2026-09-26)**: this button can fail with "Invalid repository URL — Monorepos are not yet fully supported" on Cloudflare's side, for a monorepo-subdirectory URL like this one — not something fixable from this repo. If you hit that, use **Manually (CLI)** below instead; it's fully working and verified.

This also creates the queue the Importer depends on automatically — Cloudflare's button provisions Queues (and Durable Objects, KV, D1, R2, etc.) declared in the repo's Wrangler config, the same as a manual `wrangler queues create` would. Once it's deployed, set the config entirely through the dashboard, no CLI: open this Worker at **Workers & Pages → (your Worker) → Settings → Variables and Secrets → Add**, and add:
- **Secrets**: `CONNECTEAM_API_TOKEN`, `WEBHOOK_SHARED_SECRET` (from `importer setup`'s output)
- **Plain vars**: `CONVERSATION_ID`, `SENDER_ID`, and `TIME_CLOCKS_JSON` — one JSON-encoded array, one object per configured Time Clock (`timeClockId`, `name`, `manualBreaksEnabled`, `unpaidBreakTypeId`/`paidBreakTypeId` where enabled). `importer setup` doesn't print this exact string — build it from `importer.config.json`, e.g. `node -e "console.log(JSON.stringify(require('./importer.config.json').timeClocks))"` run from `packages/importer`

Then click **Deploy** in the dashboard to apply them.

**Manually (CLI)**:

```
cd packages/importer-cloudflare
npx wrangler queues create sch-import-triggers
npx wrangler secret put CONNECTEAM_API_TOKEN
npx wrangler secret put WEBHOOK_SHARED_SECRET
```

Then set the plain vars (`CONVERSATION_ID`, `SENDER_ID`, `TIME_CLOCKS_JSON`) in `packages/importer-cloudflare/wrangler.jsonc` and run `npm run deploy --workspace packages/importer-cloudflare` (bundles fresh, then deploys — see the note below).

**Either way**, paste this Worker's URL (shown after deploy — no path suffix, it's a single endpoint) into the Relay's Chat Link form as the Importer's webhook endpoint.

The Importer's `fetch` handler only validates the incoming trigger and enqueues it — the actual Import Run runs in a separate queue-consumer invocation.

**A note for anyone changing this Importer's code**: the button installs from `packages/importer-cloudflare` in isolation and can't resolve `@sch-import/shared` as a workspace dependency (it's private, not on npm) — so `wrangler.jsonc`'s `main` points at a committed, pre-bundled `packages/importer-cloudflare/release/index.js` instead of live source, and `@sch-import/shared` is declared as an `optionalDependency` so the button's `npm install` doesn't hard-fail trying to fetch it. If you change anything in `packages/importer-cloudflare/src` or `packages/shared`, run `npm run bundle --workspace packages/importer-cloudflare` and commit the regenerated `release/` before the button (or a plain `npx wrangler deploy`) will reflect it. `npm run dev --workspace packages/importer-cloudflare` bundles live from `src/index.ts` instead and is unaffected.

## Project layout

```
packages/
  shared/              Connecteam API client and shared types/vocabulary
  relay/               the Relay: Chat Link storage, admin login, webhook forwarding
  relay-cloudflare/    the Relay, ported to run as a Cloudflare Worker (optional — see above)
  importer/            the Importer: Schedule Export parsing, Time Activity writes, CLI
  importer-cloudflare/ the Importer, ported to run as a Cloudflare Worker + Queue (optional — see above)
  wizard/              the browser-based setup wizard described above
docs/adr/    architecture decision records
CONTEXT.md   project vocabulary
```

## Further reading

- [`CONTEXT.md`](CONTEXT.md) — vocabulary used throughout the code and docs
- [`docs/adr/0001-relay-never-touches-customer-data.md`](docs/adr/0001-relay-never-touches-customer-data.md) — why the Relay/Importer split exists
- [`docs/adr/0003-shared-deployment-resolves-time-clock-at-upload-time.md`](docs/adr/0003-shared-deployment-resolves-time-clock-at-upload-time.md) — why [multiple Time Clocks](#multiple-time-clocks) resolve from the upload itself, not a live chat back-and-forth
