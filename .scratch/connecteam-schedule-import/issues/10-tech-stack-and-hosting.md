Type: grilling
Status: open

## Question

Decide the tech stack and hosting approach for the Relay and the Importer, given both are self-hosted per deployer (ADR 0001) — a company clones the repo and runs both themselves. Cover: language/framework for each (they may reasonably share one, since both need to call Connecteam's API and could share types/client code), how a company is expected to actually run them (Docker Compose, a single binary, a specific PaaS one-click deploy, plain `npm start`-style local process), and what the Relay's minimal data store needs to be (just enough for one Chat Link record + break-type defaults + a shared secret — likely doesn't need a full database).
