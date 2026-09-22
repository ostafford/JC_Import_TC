#!/usr/bin/env node
import { loadImporterConfig } from "./config.js";
import { runSetup } from "./setup.js";
import { startWebhookServer } from "./webhookServer.js";

const command = process.argv[2] ?? "serve";

switch (command) {
  case "setup":
    await runSetup();
    break;
  case "serve":
    startWebhookServer(loadImporterConfig());
    break;
  default:
    console.error(`Unknown command: ${command}\nUsage: importer [setup|serve]`);
    process.exit(1);
}
