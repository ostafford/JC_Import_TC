Type: task
Status: resolved

## Question

Not anticipated by any prior ticket: `importer setup` (and the wizard's step 4) asked the Admin to type a raw Connecteam Time Clock ID from a bare text field, the same way `senderId` (Custom Publisher ID) is entered. Unlike a Custom Publisher ID — which the Admin creates themselves in Connecteam's Settings → Feed settings and can see there — a Time Clock's ID is **not visible anywhere in Connecteam's own web UI**. Discovered live (2026-09-25) when actually running `importer setup` against a real account: there was no way to answer the prompt at all, for the Admin who built this project or for any future client.

## Answer

Confirmed via developer.connecteam.com: `GET /time-clock/v1/time-clocks` exists, returns every Time Clock on the account with `id`, `name`, and `isArchived` — no pagination needed. Added `listTimeClocks()` to `@sch-import/shared`'s `ConnecteamClient` (mirroring `listConversations()`'s existing shape) and a `TimeClock` type.

Both surfaces that asked for a raw Time Clock ID now list and pick by name instead, matching how the conversation step already works:
- **CLI (`packages/importer/src/setup.ts`)**: fetches and numbers the list (`[0] Main Store`, etc., with `(archived)` noted rather than silently hidden — consistent with this project's existing convention of never silently hiding archived things, e.g. issue 03's Employee matching), Admin picks by index.
- **Wizard (`packages/wizard/src/steps/timeClock.ts`)**: time clocks are now fetched alongside conversations right when the API token is validated (`token.ts`, mirroring the existing conversation-prefetch pattern) and rendered as a radio picker, replacing the bare text input. Errors out at the token step if the account has zero Time Clocks, same as the existing zero-conversations check.

No change needed to the Cloudflare ports (`relay-cloudflare`, `importer-cloudflare`) — they consume whatever `importer setup` produces as plain config values; they don't do interactive setup themselves.

Whole workspace rebuilds clean (`npm run build`); all 17 existing importer tests still pass unaffected (they test the pure pipeline logic via mocked `Pick<>` interfaces, not the raw client methods this touched).
