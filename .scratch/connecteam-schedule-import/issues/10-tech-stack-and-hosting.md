Type: grilling
Status: open (language/data-store half settled by implementation; deployment/hosting half still fully open — see below)

## Question

Decide the tech stack and hosting approach for the Relay and the Importer, given both are self-hosted per deployer (ADR 0001) — a company clones the repo and runs both themselves. Cover: language/framework for each (they may reasonably share one, since both need to call Connecteam's API and could share types/client code), how a company is expected to actually run them (Docker Compose, a single binary, a specific PaaS one-click deploy, plain `npm start`-style local process), and what the Relay's minimal data store needs to be (just enough for one Chat Link record + break-type defaults + a shared secret — likely doesn't need a full database).

## Context as of 2026-09-22 — resume here

The Relay and Importer got built (see the addenda on issues 03/06/08/11 and new issue 12 for everything that changed along the way) before this ticket was formally resolved, so part of it is now settled *by what already exists*, not by a decision made here:

**Effectively settled already** (would need a real reason to revisit, not just "let's decide"):
- **Language/framework**: plain Node.js + TypeScript, no framework, for both the Relay (`packages/relay`) and the Importer (`packages/importer`) — matches this monorepo's existing `@sch-import/shared` package for the common Connecteam API client/types (npm workspaces, `tsc -b`).
- **Relay's data store**: a single local JSON file (`relay.data.json`, gitignored — holds the Chat Link record, magic-link/session tokens) via `packages/relay/src/store.ts`. No database. Confirmed sufficient — this is genuinely all the state the Relay ever holds (ADR 0001).

**Still fully open — this is the actual remaining question**: how does an Admin *actually run this continuously*, with a stable public URL, without a laptop staying on? Today's entire real-account test session ran on **ad-hoc local `node` processes + `cloudflared tunnel --url ...` quick tunnels** — that's a real proof it works end-to-end, but it is explicitly not viable long-term:
- Quick tunnels are anonymous, unauthenticated, have "no uptime guarantee" (cloudflared's own warning), and hand out a **new random URL every time they restart** — the Connecteam webhook and the Relay's Chat Link form would need updating after every restart.
- Nothing survives a machine reboot or the terminal closing; both processes were manually restarted multiple times during today's session whenever code changed.

Open sub-questions for whoever picks this back up:
1. **Where does this actually run?** A small VPS (systemd services, no Docker)? Docker Compose (would need Dockerfiles — none exist yet)? A specific PaaS (Fly.io, Railway, Render, etc.) with one-click/one-command deploy? Something the Admin's own infra team already runs?
2. **How does the Relay get a stable public URL** for Connecteam's webhook, and the Importer get one for the Relay's trigger forwarding? (A named/authenticated Cloudflare Tunnel — not a quick tunnel — is one option or reverse proxy + real DNS is another.)
3. Does the answer differ for the Relay vs. the Importer? They have different trust boundaries (ADR 0001) and might reasonably live in different places — e.g. Relay on cheap always-on infra, Importer on the Admin's own machine/network since it holds the real Connecteam token.
4. Whatever gets decided should probably turn into a concrete "Deploying" section in the README (issue 09 already commits to documenting full setup order).
