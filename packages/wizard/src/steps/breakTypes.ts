import type { IncomingMessage, ServerResponse } from "node:http";
import type { ManualBreakType } from "@sch-import/shared";
import { validateBreakTypeSelection } from "@sch-import/importer/dist/lib.js";
import { escapeHtml, page, parseFormBody } from "@sch-import/relay/dist/lib.js";
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

export function renderBreakTypesStep(state: WizardState, error?: string): string {
  const config = state.breaksConfig!;
  const unpaid = config.breakTypes.filter((b) => !b.isPaid);
  const paid = config.breakTypes.filter((b) => b.isPaid);

  return page(
    "Setup — Break Types",
    `<h1>Step 5 of 6 — default Break Types</h1>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
<p>Manual breaks are enabled for this Time Clock — pick the default Break Type for each category.</p>
<form method="post" action="/step/break-types">
  ${pickerFor("unpaid", unpaid)}
  ${pickerFor("paid", paid)}
  <button type="submit">Continue</button>
</form>`,
  );
}

export async function handleBreakTypesStep(req: IncomingMessage, res: ServerResponse, state: WizardState): Promise<void> {
  const config = state.breaksConfig!;
  const form = await parseFormBody(req);

  try {
    const unpaid = validateBreakTypeSelection(config.breakTypes.filter((b) => !b.isPaid), form.unpaidBreakTypeId ?? "");
    const paid = validateBreakTypeSelection(config.breakTypes.filter((b) => b.isPaid), form.paidBreakTypeId ?? "");
    state.unpaidBreakTypeId = unpaid.id;
    state.paidBreakTypeId = paid.id;
  } catch {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderBreakTypesStep(state, "Pick a valid Break Type for both categories."));
    return;
  }

  res.writeHead(302, { Location: "/step/relay-link" });
  res.end();
}
