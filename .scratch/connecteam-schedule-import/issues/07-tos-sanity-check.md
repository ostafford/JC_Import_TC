Type: task
Status: resolved

## Question

Connecteam's API Terms restrict API use to a customer's own internal business purposes and prohibit third-party distribution/processing of another company's data. Under the current design (ADR 0001), the Relay itself never calls the Connecteam API — only each Admin's own self-hosted Importer does, using that Admin's own token against their own account — which reads as clearly within-terms. Still, get a quick informal sanity check (e.g. from an internal Connecteam contact) that publishing this as an open-source, self-hosted tool for other Admins to adopt doesn't raise any concern Connecteam would want flagged.

## Answer

Clarified first that the Relay is also self-hosted per deployer (not one shared service run by this project's author) — see the addendum on [ADR 0001](../../docs/adr/0001-relay-never-touches-customer-data.md). That closes the last gap in the reasoning: every deployment, Relay and Importer both, runs entirely under one company's own account with their own token, so there is no point where a third party sits between two companies' data.

The Admin had the conversation with an internal Connecteam contact: **approved**. No conditions or restrictions were reported back.
