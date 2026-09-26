Type: prototype
Status: resolved

## Question

Neither the primary Time Clock Signal (Job `instanceIds`, [issue 01](01-time-clock-signal-source.md)) nor its fallback ([issue 05](05-fallback-signal-when-job-resolution-is-ambiguous.md)) needs a stored Time Clock Mapping — both resolve live against Connecteam's own data. So the only setup-time change this feature needs is: what does `importer setup` (CLI, `packages/importer/src/setup.ts`) and the wizard (`packages/wizard`) actually ask an Admin for, once more than one Time Clock is in play?

At minimum, two things the original map's issue 16 and issue 08 got wrong for this case:
- **Time Clock selection**: issue 16 built a single-pick `listTimeClocks()` picker (`importer.config.json`'s `timeClockId`). This needs to become a multi-select of every Time Clock this Importer is allowed to route Import Runs across.
- **Break Type defaults**: issue 08 built a single default Break Type per paid/unpaid category, account-wide. [Issue 02](02-job-and-break-type-scoping.md) of this map confirmed Break Types and their enablement are per-Time-Clock — so this needs to become a default per paid/unpaid category *per selected Time Clock*, and must skip break-writing entirely for any selected Time Clock with `areManualBreaksEnabled: false`, without that disabling breaks for the others.

Build a rough prototype of the CLI/wizard flow (multi-select Time Clock step, then a per-Time-Clock break-type sub-step) to react to — this is a "how should it look/behave" question, not a pure decision.

## Answer

Validated live against a runnable prototype (`node`, real terminal, mocked Connecteam data — 3 fake Time Clocks including one with breaks disabled, plus an archived one to confirm it stays filtered out). Prototype captured on branch `prototype/setup-ux-multi-timeclock`, path `.scratch/multi-time-clock-routing/prototypes/setup-multi-timeclock.mjs` — a primary source, not production code.

**Multi-select Time Clock picker**: comma-separated indices over `listTimeClocks()`'s existing list-and-number format (e.g. `0,2`), replacing issue 16's single-index pick. Confirmed feels right as-is.

**Per-selected-Time-Clock Break Type sub-step**: for each selected Time Clock, fetch its own `getManualBreaksConfig()` and pick a default paid/unpaid Break Type; a Time Clock with `areManualBreaksEnabled: false` prints a one-line skip notice instead of prompting, without affecting the others. Confirmed feels right as-is — validated this correctly generalizes issue 08's single-Time-Clock flow per issue 02's per-Time-Clock scoping finding.

**Re-run/reconfiguration entry point**: when `importer setup` is re-run and a config already exists, offer `[a] Add one more Time Clock` / `[b] Reconfigure everything from scratch` / `[c] Cancel`, rather than always forcing a full re-run. Confirmed feels right — appending is the common case (a client adding a new café location) and shouldn't require redoing every already-configured Time Clock's Break Type picks.

**Terminal output needs colour and spacing to be legible** — flagged live as a real gap after trying the first (plain-text) version: it "felt boring and hard to read." Fixed in the prototype with plain ANSI escapes (bold headers, cyan section dividers, magenta `[index]` markers, green ✓ confirmations, yellow ⚠ warnings for disabled breaks), auto-disabling when stdout isn't a real terminal (piped/redirected) — deliberately no new dependency (e.g. `chalk`/`picocolors`), matching this project's existing zero-dependency CLI style. Confirmed feels a lot better after the revision. This should carry into the real `setup.ts`/wizard implementation, not just this prototype, whenever this map moves to execution.

