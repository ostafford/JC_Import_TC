#!/usr/bin/env node
import { loadWizardConfig } from "./wizardConfig.js";
import { startWizardServer } from "./wizardServer.js";

startWizardServer(loadWizardConfig());
