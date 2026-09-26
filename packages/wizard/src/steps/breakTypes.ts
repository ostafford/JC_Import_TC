import type { IncomingMessage, ServerResponse } from "node:http";
import type { ManualBreakType } from "@sch-import/shared";
import { validateBreakTypeSelection } from "@sch-import/importer/dist/lib.js";
import { escapeHtml, page, parseFormBody } from "@sch-import/relay/dist/lib.js";
import { advanceTimeClockQueue } from "../timeClockQueue.js";
import type { WizardState } from "../wizardState.js";

function pickerFor(category: "unpaid" | "paid", types: ManualBreakType[]): string {
  const options = types
    .map(
      (t, i) =>
        `<label class="radio"><input type="radio" name="${category}BreakTypeId" value="${escapeHtml(t.id)}" ${
          i === 0 ? "checked" : ""
        }> ${escapeHtml(t.name)} (default ${t.duration}m)</label>`,
    )
    .join("\n");
  return `<h2>Default ${category} Break Type</h2>
<p class="hint">Its label only — actual duration always comes from the Schedule Export.</p>
${options || `<p class="error">No ${category} Break Types are configured in Connecteam — configure one first, then re-run setup.</p>`}`;
}

/**
 * Renders for `state.currentTimeClock` — one Time Clock at a time, popped
 * off `state.timeClockQueue` by `advanceTimeClockQueue` (multi-time-clock-routing
 * map, Phase 2). Progress ("Time Clock 2 of 3") is derived from
 * `timeClockResults`/`timeClockQueue`'s current lengths rather than stored
 * separately — `currentTimeClock` has already been shifted out of the queue
 * by the time this renders, so `results.length + 1` is always this one's
 * position.
 */
export function renderBreakTypesStep(state: WizardState, error?: string): string {
  const tc = state.currentTimeClock!;
  const config = state.currentBreaksConfig!;
  const unpaid = config.breakTypes.filter((b) => !b.isPaid);
  const paid = config.breakTypes.filter((b) => b.isPaid);
  const position = (state.timeClockResults?.length ?? 0) + 1;
  const total = position + (state.timeClockQueue?.length ?? 0);

  return page(
    "Setup — Break Types",
    `<h1>Step 5 of 6 — default Break Types (Time Clock ${position} of ${total}: ${escapeHtml(tc.name)})</h1>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
<p>Manual breaks are enabled for <strong>${escapeHtml(tc.name)}</strong> — pick the default Break Type for each category.</p>
<form method="post" action="/step/break-types">
  ${pickerFor("unpaid", unpaid)}
  ${pickerFor("paid", paid)}
  <button type="submit">Continue</button>
</form>`,
  );
}

export async function handleBreakTypesStep(req: IncomingMessage, res: ServerResponse, state: WizardState): Promise<void> {
  const tc = state.currentTimeClock!;
  const config = state.currentBreaksConfig!;
  const form = await parseFormBody(req);

  let unpaidBreakTypeId: string;
  let paidBreakTypeId: string;
  try {
    unpaidBreakTypeId = validateBreakTypeSelection(config.breakTypes.filter((b) => !b.isPaid), form.unpaidBreakTypeId ?? "").id;
    paidBreakTypeId = validateBreakTypeSelection(config.breakTypes.filter((b) => b.isPaid), form.paidBreakTypeId ?? "").id;
  } catch {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderBreakTypesStep(state, "Pick a valid Break Type for both categories."));
    return;
  }

  state.timeClockResults!.push({
    timeClockId: tc.timeClockId,
    name: tc.name,
    manualBreaksEnabled: true,
    unpaidBreakTypeId,
    paidBreakTypeId,
  });

  let result;
  try {
    result = await advanceTimeClockQueue(state.client!, state);
  } catch {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderBreakTypesStep(state, "Couldn't read manual-break configuration for the next Time Clock."));
    return;
  }

  res.writeHead(302, { Location: result === "needs-break-picker" ? "/step/break-types" : "/step/relay-link" });
  res.end();
}
