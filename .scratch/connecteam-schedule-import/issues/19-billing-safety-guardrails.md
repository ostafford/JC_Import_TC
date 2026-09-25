Type: task
Status: resolved

## Question

Not a bug — a proactive request after tonight's incident (issue 18): Okky's first time carrying a usage-based monthly charge rather than a fixed subscription, and wanted to understand what guardrails Cloudflare actually offers against an unexpectedly large bill, and to put whatever's available in place.

## Answer

Checked directly against Cloudflare's current billing docs rather than assumed:

- **Budget alerts exist** (Dashboard → Manage Account → Billing → Billable Usage → Create budget alert) — an email when cumulative usage-based spend crosses a dollar threshold you set. Account-wide, not per-Worker.
- **No hard spend cap or auto-pause exists on Cloudflare at all** — confirmed via their own docs: "Budget alerts are informational only. They do not pause or cap usage." Worth being explicit about this rather than letting "guardrails" imply more safety than actually exists — a budget alert buys reaction time, not automatic protection.
- **A proactive usage view** (same Billable Usage page) shows a daily cost chart and per-service breakdown, checkable anytime without waiting for an alert.
- **`limits.cpu_ms` in `wrangler.jsonc`** is the one real per-Worker cost-capping lever that isn't just an alert — it caps how much CPU time a single invocation can consume, independent of what triggered it. Cloudflare's own docs frame this exactly as protection against "accidental runaway bills."

Added `limits.cpu_ms` to both Workers, sized to their actual workload with headroom, not to Cloudflare's own default:
- `relay-cloudflare`: `500` — its real work per request is trivial (parse a small JSON body, one HMAC sign, a couple of Durable Object calls).
- `importer-cloudflare`: `10000` — needs more room for parsing a Schedule Export and building many request bodies, but waiting on the many outbound Connecteam API calls themselves doesn't count against CPU time at all, so this stays a real ceiling, not a number picked to just barely fit normal use.

Both redeployed and verified still responding correctly.

**Still Okky's own action, not something I can do**: actually creating the Budget Alert in the Cloudflare dashboard, and confirming the account is on the Workers Paid plan (issue 18's still-open prerequisite).
