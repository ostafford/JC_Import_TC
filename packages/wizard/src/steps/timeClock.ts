import type { IncomingMessage, ServerResponse } from "node:http";
import { asTimeClockId } from "@sch-import/shared";
import { escapeHtml, page, parseFormBody } from "@sch-import/relay/dist/lib.js";
import type { WizardState } from "../wizardState.js";

export function renderTimeClockStep(error?: string): string {
  return page(
    "Setup — Time Clock",
    `<h1>Step 4 of 6 — Time Clock and chat sender</h1>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
<form method="post" action="/step/time-clock">
  <label for="timeClockId">Time Clock ID</label>
  <input type="text" id="timeClockId" name="timeClockId" required autofocus>
  <p class="hint">Used for writing Time Activities and reading manual-break configuration.</p>

  <label for="senderId">Custom Publisher ID</label>
  <input type="text" id="senderId" name="senderId" required>
  <p class="hint">Chat confirmations post as a Custom Publisher, not as you — Connecteam's Chat API requires it.
  If you haven't already, create one: Connecteam admin -&gt; Settings -&gt; Feed settings -&gt; Custom Publishers -&gt; Add Custom Publisher, then enter its integer Publisher ID here.</p>

  <button type="submit">Continue</button>
</form>`,
  );
}

export async function handleTimeClockStep(req: IncomingMessage, res: ServerResponse, state: WizardState): Promise<void> {
  const form = await parseFormBody(req);
  const timeClockId = form.timeClockId?.trim();
  const senderId = form.senderId?.trim();

  if (!timeClockId || !senderId) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderTimeClockStep("Enter both the Time Clock ID and the Custom Publisher ID."));
    return;
  }

  let breaksConfig;
  try {
    breaksConfig = await state.client!.getManualBreaksConfig(asTimeClockId(timeClockId));
  } catch {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderTimeClockStep("Couldn't read manual-break configuration for that Time Clock ID — check it's correct."));
    return;
  }

  state.timeClockId = timeClockId;
  state.senderId = senderId;
  state.breaksConfig = breaksConfig;

  res.writeHead(302, { Location: breaksConfig.areManualBreaksEnabled ? "/step/break-types" : "/step/relay-link" });
  res.end();
}
