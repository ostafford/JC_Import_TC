import type { ConnecteamClient } from "./connecteam/client.js";
import type { ConversationId, PublisherId } from "./vocabulary.js";
import type { ImportRunOutcome } from "./importRun.js";

const TEXT_CHAR_BUDGET = 480; // stay well under Connecteam's self-contradicting 500/1000 char guidance (issue 05)

export interface ChatConfirmationConfig {
  conversationId: ConversationId;
  senderId: PublisherId;
}

/**
 * Always posts a result message (issue 05) — Chat is the only interface for
 * this tool, so silence would be ambiguous. Full success gets a one-liner;
 * anything else gets a short text summary plus an attached per-row report.
 */
export async function sendImportResultToChat(
  client: ConnecteamClient,
  config: ChatConfirmationConfig,
  outcome: ImportRunOutcome,
): Promise<void> {
  const totalSkipped = outcome.totalRows - outcome.succeeded;

  if (totalSkipped === 0) {
    await client.postChatMessage({
      conversationId: config.conversationId,
      senderId: config.senderId,
      text: `✅ Imported ${outcome.succeeded} shift${outcome.succeeded === 1 ? "" : "s"} from your schedule export.`,
    });
    return;
  }

  const reportCsv = buildReportCsv(outcome);
  const fileId = await client.uploadChatAttachment(
    `import-report-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`,
    Buffer.from(reportCsv, "utf8"),
    "text/csv",
  );

  await client.postChatMessage({
    conversationId: config.conversationId,
    senderId: config.senderId,
    text: truncate(summaryText(outcome), TEXT_CHAR_BUDGET),
    attachments: [{ type: "file", fileId }],
  });
}

/** For the systemic-abort case (issue 04): auth/authorization failure from the API itself. */
export async function sendImportAbortedToChat(
  client: ConnecteamClient,
  config: ChatConfirmationConfig,
  detail: string,
): Promise<void> {
  await client.postChatMessage({
    conversationId: config.conversationId,
    senderId: config.senderId,
    text: truncate(
      `⚠️ Import Run stopped: Connecteam rejected this Importer's credentials (${detail}). No shifts were imported. Check the Importer's API token.`,
      TEXT_CHAR_BUDGET,
    ),
  });
}

/**
 * For any other uncaught failure (issue 18, discovered live 2026-09-25):
 * silence here is worse than everywhere else this tool posts to Chat,
 * because a crash mid-run may have already written some real shifts before
 * failing — and this Importer never retries automatically (writes aren't
 * idempotent), so nothing will fix itself. The Admin must know to check.
 */
export async function sendImportCrashedToChat(
  client: ConnecteamClient,
  config: ChatConfirmationConfig,
  detail: string,
): Promise<void> {
  await client.postChatMessage({
    conversationId: config.conversationId,
    senderId: config.senderId,
    text: truncate(
      `❌ Import Run failed before finishing (${detail}). Some shifts from this export may already be written — check today's Time Clock entries for duplicates before re-uploading. This will not retry automatically.`,
      TEXT_CHAR_BUDGET,
    ),
  });
}

function summaryText(outcome: ImportRunOutcome): string {
  const skippedParts = Object.entries(outcome.skippedByReason)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${count} ${humanizeReason(reason)}`);

  const lockedDayNames = outcome.rows
    .filter((r) => r.reason === "locked-day")
    .map((r) => r.employeeName);
  const lockedDayNote = lockedDayNames.length > 0 ? ` Locked day(s) for: ${Array.from(new Set(lockedDayNames)).join(", ")}.` : "";

  return `Imported ${outcome.succeeded}/${outcome.totalRows} shifts. Skipped: ${skippedParts.join(", ")}.${lockedDayNote} Full detail attached.`;
}

function humanizeReason(reason: string): string {
  return reason.replace(/-/g, " ");
}

function buildReportCsv(outcome: ImportRunOutcome): string {
  const header = "date,employee name,outcome,reason,detail";
  const lines = outcome.rows.map((r) =>
    [r.date, r.employeeName, r.outcome, r.reason ?? "", r.detail ?? ""].map(csvEscape).join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}
