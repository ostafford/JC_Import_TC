import type { IncomingMessage, ServerResponse } from "node:http";
import { escapeHtml, page, parseFormBody } from "@sch-import/relay/dist/lib.js";
import type { WizardState } from "../wizardState.js";

/**
 * Time Clock IDs aren't visible anywhere in Connecteam's own web UI
 * (discovered live, 2026-09-25 — not anticipated by any prior ticket), so
 * this picks from a fetched list by name, the same way the conversation
 * step does, instead of asking for a raw ID nobody could ever find.
 */
export function renderTimeClockStep(state: WizardState, error?: string): string {
  const timeClocks = state.timeClocks ?? [];
  const options = timeClocks
    .map(
      (tc, i) =>
        `<label class="radio"><input type="radio" name="timeClockIndex" value="${i}" ${i === 0 ? "checked" : ""}> ${escapeHtml(
          tc.name,
        )}${tc.isArchived ? " (archived)" : ""}</label>`,
    )
    .join("\n");

  return page(
    "Setup — Time Clock",
    `<h1>Step 4 of 6 — Time Clock and chat sender</h1>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
<form method="post" action="/step/time-clock">
  <h2>Time Clock</h2>
  <p class="hint">Used for writing Time Activities and reading manual-break configuration.</p>
  ${options}

  <label for="senderId">Custom Publisher ID</label>
  <input type="text" id="senderId" name="senderId" required>
  <p class="hint">Chat confirmations post as a Custom Publisher, not as you — Connecteam's Chat API requires it.
  If you haven't already, create one: Connecteam admin -&gt; Settings -&gt; Feed settings -&gt; Custom Publishers -&gt; Add Custom Publisher, then enter its integer Publisher ID here.</p>

  <button type="submit">Continue</button>
</form>`,
  );
}

export async function handleTimeClockStep(req: IncomingMessage, res: ServerResponse, state: WizardState): Promise<void> {
  const timeClocks = state.timeClocks ?? [];
  const form = await parseFormBody(req);
  const chosen = timeClocks[Number(form.timeClockIndex)];
  const senderId = form.senderId?.trim();

  if (!chosen || !senderId) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderTimeClockStep(state, "Pick a Time Clock and enter the Custom Publisher ID."));
    return;
  }

  let breaksConfig;
  try {
    breaksConfig = await state.client!.getManualBreaksConfig(chosen.timeClockId);
  } catch {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderTimeClockStep(state, "Couldn't read manual-break configuration for that Time Clock."));
    return;
  }

  state.timeClockId = chosen.timeClockId;
  state.timeClockName = chosen.name;
  state.senderId = senderId;
  state.breaksConfig = breaksConfig;

  res.writeHead(302, { Location: breaksConfig.areManualBreaksEnabled ? "/step/break-types" : "/step/relay-link" });
  res.end();
}
