import { loadRelayConfig } from "./config.js";
import { startServer } from "./server.js";

startServer(loadRelayConfig());
