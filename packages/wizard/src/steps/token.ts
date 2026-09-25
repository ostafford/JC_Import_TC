import type { IncomingMessage, ServerResponse } from "node:http";
import { ConnecteamClient } from "@sch-import/shared";
import { escapeHtml, page, parseFormBody } from "@sch-import/relay/dist/lib.js";
import type { WizardState } from "../wizardState.js";

export function renderTokenStep(error?: string): string {
  return page(
    "Setup — Connecteam API token",
    `<h1>Step 1 of 6 — Connecteam API token</h1>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
<p>Generate an API token in Connecteam: Settings -&gt; Integrations -&gt; API (Expert plan required).</p>
<form method="post" action="/step/token">
  <label for="apiToken">Connecteam API token</label>
  <input type="password" id="apiToken" name="apiToken" required autofocus>
  <button type="submit">Continue</button>
</form>`,
  );
}

export async function handleTokenStep(
  req: IncomingMessage,
  res: ServerResponse,
  state: WizardState,
  connecteamBaseUrl: string | undefined,
): Promise<void> {
  const form = await parseFormBody(req);
  const apiToken = form.apiToken?.trim();

  if (!apiToken) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderTokenStep("Enter your Connecteam API token."));
    return;
  }

  const client = new ConnecteamClient({ apiToken, baseUrl: connecteamBaseUrl });

  let conversations, timeClocks;
  try {
    [conversations, timeClocks] = await Promise.all([client.listConversations(), client.listTimeClocks()]);
  } catch {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderTokenStep("Couldn't reach Connecteam with that token — check it's correct and try again."));
    return;
  }

  if (conversations.length === 0) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderTokenStep("That token works, but there are no conversations to link yet — create one in Connecteam first."));
    return;
  }

  if (timeClocks.length === 0) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderTokenStep("That token works, but there are no Time Clocks to write to yet — set one up in Connecteam first."));
    return;
  }

  state.apiToken = apiToken;
  state.client = client;
  state.conversations = conversations;
  state.timeClocks = timeClocks;

  res.writeHead(302, { Location: "/step/conversation" });
  res.end();
}
