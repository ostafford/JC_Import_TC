import type { IncomingMessage, ServerResponse } from "node:http";
import { escapeHtml, page, parseFormBody } from "@sch-import/relay/dist/lib.js";
import { advanceTimeClockQueue } from "../timeClockQueue.js";
import type { WizardState } from "../wizardState.js";

/**
 * Time Clock IDs aren't visible anywhere in Connecteam's own web UI
 * (discovered live, 2026-09-25), so this picks from a fetched list by name,
 * the same way the conversation step does, instead of asking for a raw ID
 * nobody could ever find.
 *
 * Multi-select (multi-time-clock-routing map, Phase 2): each checkbox gets
 * its own field name (`timeClock_<index>`) rather than sharing one name —
 * `parseFormBody` (a plain `URLSearchParams` walk, shared with the Relay)
 * only keeps the last value for a repeated key, so a single shared
 * `name="timeClockIndex"` across checkboxes would silently drop every
 * selection but one.
 */
export function renderTimeClockStep(state: WizardState, error?: string): string {
  const timeClocks = state.timeClocks ?? [];
  const options = timeClocks
    .map(
      (tc, i) =>
        `<label class="checkbox"><input type="checkbox" name="timeClock_${i}" value="on" ${
          i === 0 ? "checked" : ""
        }> ${escapeHtml(tc.name)}${tc.isArchived ? " (archived)" : ""}</label>`,
    )
    .join("\n");

  return page(
    "Setup — Time Clocks",
    `<h1>Step 4 of 6 — Time Clocks and chat sender</h1>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
<form method="post" action="/step/time-clock">
  <h2>Time Clocks</h2>
  <p class="hint">Pick every Time Clock this Importer should route Import Runs across.</p>
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
  const chosen = timeClocks.filter((_, i) => form[`timeClock_${i}`] === "on");
  const senderId = form.senderId?.trim();

  if (chosen.length === 0 || !senderId) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderTimeClockStep(state, "Pick at least one Time Clock and enter the Custom Publisher ID."));
    return;
  }

  state.timeClockQueue = chosen;
  state.timeClockResults = [];
  state.senderId = senderId;

  let result;
  try {
    result = await advanceTimeClockQueue(state.client!, state);
  } catch {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderTimeClockStep(state, "Couldn't read manual-break configuration for one of those Time Clocks."));
    return;
  }

  res.writeHead(302, { Location: result === "needs-break-picker" ? "/step/break-types" : "/step/relay-link" });
  res.end();
}
