# Relay only forwards a trigger; the Importer does all the work

Connecteam's API Terms of Service restrict API use to a customer's own internal business purposes and prohibit a third party distributing the API or processing another company's data on their behalf. Since this project is meant to be public and open-source, a centrally-hosted service that stored many Admins' API tokens and processed their Schedule Exports would sit close to that restriction, and would make the project's author the custodian of many companies' credentials and data.

We decided the Relay stores only a Chat Link (chat conversation ID + Importer endpoint) per Admin and forwards a bare trigger event when it sees a Schedule Export uploaded. Each Admin runs their own Importer, holding their own Connecteam API token, which does the actual downloading, parsing, and writing of Time Activities. The Relay's infrastructure never sees a customer's token or data.

Consequence: onboarding a new Admin requires them to deploy/configure their own Importer, which is more setup friction than a fully centralized service — accepted as the cost of staying clearly within Connecteam's API terms and avoiding credential custody risk.

**Addendum**: the Relay itself is also meant to be self-hosted per deployer, not a single shared service the project's author operates for multiple companies. Cloning the repo means running both the Relay and the Importer on one's own infrastructure. This closes the remaining gap in the reasoning above — there is no scenario where the author's own infrastructure sits between two different companies' data at all, which is why issue 07 (a ToS sanity check) found the concern largely resolved by this architecture rather than merely mitigated.
