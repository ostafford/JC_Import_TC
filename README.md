# Connecteam Schedule → Timesheet Import

Lets a Connecteam account Admin turn an exported Schedule into Time Clock entries, triggered by uploading the export as a file in a linked Connecteam Chat conversation.

The system is split into two self-hosted pieces so that no shared infrastructure ever sees a customer's Connecteam credentials or data — see [`docs/adr/0001-relay-never-touches-customer-data.md`](docs/adr/0001-relay-never-touches-customer-data.md) for why:

- **Relay** — stores one Chat Link (a conversation ID + an Importer's endpoint URL) per Admin, and forwards a bare trigger event when it sees a Schedule Export uploaded. Never sees a Connecteam API token or the export's contents.
- **Importer** — the Admin's own process, holding the Admin's own Connecteam API token. Does the actual work: downloads the Schedule Export, parses it, matches rows to Employees, and writes Time Activities.

Both are cloned and run from this same repo, self-hosted by whoever deploys them — not a shared service. See [`CONTEXT.md`](CONTEXT.md) for the full vocabulary (Admin, Employee, Chat Link, Import, etc.) used throughout the code and docs.

## Requirements

- Node.js >= 20
- A Connecteam account on the Expert plan (required for API token access), with admin rights to create an API token and a Custom Publisher
- A way to expose two local ports to the public internet: one for the Relay, one for the Importer. Any tunnel tool works (e.g. `cloudflared tunnel --url http://localhost:8788`, or `ngrok`). This is needed during setup and for as long as the integration should keep running — **or**, for the Relay only, deploy it to Cloudflare instead and skip its tunnel entirely (see [Deploying the Relay to Cloudflare](#deploying-the-relay-to-cloudflare-optional) below). The Importer still needs a tunnel either way for now — it doesn't have a Cloudflare option yet.

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
2. **Pick a conversation** to link, and enter the Relay's public webhook URL (the Relay's tunnel URL from step 4, with `/webhooks/connecteam` appended). Use a chat containing only the Admins who should be able to trigger an Import.
3. **Create the webhook yourself in Connecteam** — the wizard shows you the exact values to enter (name, endpoint URL, secret key, feature, event type), then verifies it exists once you confirm.
4. **Time Clock ID and Custom Publisher ID** — the Time Clock Time Activities are written to, and the Custom Publisher chat confirmations post as (Connecteam admin → Settings → Feed settings → Custom Publishers, if you haven't made one yet).
5. **Default Break Types** — only shown if manual breaks are enabled on that Time Clock; picks the default label for unpaid and paid breaks (actual durations always come from the Schedule Export).
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

## CLI setup (fallback)

`packages/importer` also has a terminal-based setup you can run directly against the Importer, without the Relay or wizard involved:

```
npm run importer -- setup
```

This prompts for the same information as the wizard, has Connecteam create the webhook automatically instead of walking through it in Connecteam's UI, and prints the values you'd need to paste into the Relay's dashboard by hand.

## Deploying the Relay to Cloudflare (optional)

The Relay can run as a Cloudflare Worker instead of a local process + tunnel — no laptop needs to stay on, and it gets a stable public URL that never changes across restarts. The Importer doesn't have a Cloudflare option yet (only the Relay does so far) — mixing the two (Cloudflare Relay + local Importer) is a fully supported combination, and arguably the one worth defaulting to: the Relay is the public-facing piece with no sensitive token, while the Importer — which holds your real Connecteam API token — stays on your own network either way.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ostafford/JS_Import_TC/tree/main/packages/relay-cloudflare)

Or manually:

```
cd packages/relay-cloudflare
npx wrangler deploy
```

Either way, this prints the Worker's public URL (`https://sch-import-relay.<your-subdomain>.workers.dev` by default) — that's the Relay's webhook URL for the rest of setup.

**Finishing setup uses the CLI fallback above, not the browser wizard** — the wizard only knows how to save a Chat Link on a *locally-running* Relay, not a Cloudflare-hosted one. Instead:

1. Run `npm run importer -- setup` as described above, using the Cloudflare Relay's URL (with `/webhooks/connecteam` appended) as the Relay webhook URL when prompted.
2. Open the Cloudflare Relay's URL and sign in. No email provider is configured by default, so read the magic link from `npx wrangler tail` (run from `packages/relay-cloudflare`) instead of your inbox.
3. Paste the values `importer setup` printed into the Chat Link form.

## Project layout

```
packages/
  shared/            Connecteam API client and shared types/vocabulary
  relay/             the Relay: Chat Link storage, admin login, webhook forwarding
  relay-cloudflare/  the Relay, ported to run as a Cloudflare Worker (optional — see above)
  importer/          the Importer: Schedule Export parsing, Time Activity writes, CLI
  wizard/            the browser-based setup wizard described above
docs/adr/    architecture decision records
CONTEXT.md   project vocabulary
```

## Further reading

- [`CONTEXT.md`](CONTEXT.md) — vocabulary used throughout the code and docs
- [`docs/adr/0001-relay-never-touches-customer-data.md`](docs/adr/0001-relay-never-touches-customer-data.md) — why the Relay/Importer split exists
