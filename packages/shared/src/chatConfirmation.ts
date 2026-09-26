import type { ConnecteamClient } from "./connecteam/client.js";
import type { ConversationId, PublisherId } from "./vocabulary.js";
import type { ImportRunOutcome } from "./importRun.js";

const TEXT_CHAR_BUDGET = 480; // stay well under Connecteam's self-contradicting 500/1000 char guidance (issue 05)

export interface ChatConfirmationConfig {
  conversationId: ConversationId;
  senderId: PublisherId;
}

/** Only the chat-posting operations these functions need — keeps them mockable without a real ConnecteamClient. */
export type ChatSender = Pick<ConnecteamClient, "postChatMessage" | "uploadChatAttachment">;

/**
 * Always posts a result message (issue 05) — Chat is the only interface for
 * this tool, so silence would be ambiguous. Full success gets a one-liner;
 * anything else gets a short text summary plus an attached per-row report.
 */
export async function sendImportResultToChat(
  client: ChatSender,
  config: ChatConfirmationConfig,
  outcome: ImportRunOutcome,
  timeClockName?: string,
): Promise<void> {
  const totalSkipped = outcome.totalRows - outcome.succeeded;
  const targetSuffix = timeClockName ? ` into ${timeClockName}` : "";

  if (totalSkipped === 0) {
    await client.postChatMessage({
      conversationId: config.conversationId,
      senderId: config.senderId,
      text: `✅ Imported ${outcome.succeeded} shift${outcome.succeeded === 1 ? "" : "s"}${targetSuffix} from your schedule export.`,
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
    text: truncate(summaryText(outcome, targetSuffix), TEXT_CHAR_BUDGET),
    attachments: [{ type: "file", fileId }],
  });
}

/**
 * For when neither the primary (Job) nor fallback (caption) Time Clock
 * Signal resolves to exactly one Time Clock (multi-time-clock-routing map,
 * issue 03) — posted instead of running anything, since there's no
 * `timeClockId` to scope any write with. Lists the valid names so the
 * Admin's next attempt is self-service.
 */
export async function sendTimeClockUnresolvedToChat(
  client: ChatSender,
  config: ChatConfirmationConfig,
  timeClockNames: string[],
): Promise<void> {
  await client.postChatMessage({
    conversationId: config.conversationId,
    senderId: config.senderId,
    text: truncate(
      `⚠️ Couldn't tell which Time Clock this schedule belongs to. Re-upload with a caption naming one of: ${timeClockNames.join(", ")}.`,
      TEXT_CHAR_BUDGET,
    ),
  });
}

/**
 * For when the Job-based signal and the caption each resolve, but to
 * *different* Time Clocks (discovered live, 2026-09-26 — see
 * `resolveTimeClockForRun`'s doc comment) — an explicit caption is a real
 * instruction, so a disagreement is a genuine conflict to surface, never
 * something to silently pick a winner for.
 */
export async function sendTimeClockConflictToChat(
  client: ChatSender,
  config: ChatConfirmationConfig,
  jobResolvedName: string,
  captionResolvedName: string,
): Promise<void> {
  await client.postChatMessage({
    conversationId: config.conversationId,
    senderId: config.senderId,
    text: truncate(
      `⚠️ This schedule's Jobs point to ${jobResolvedName}, but your caption said ${captionResolvedName} — nothing was imported. ` +
        `If ${jobResolvedName} is right, re-upload with no caption (or one naming ${jobResolvedName}). ` +
        `If ${captionResolvedName} is right, this schedule's Jobs need to be reassigned to it in Connecteam first.`,
      TEXT_CHAR_BUDGET,
    ),
  });
}

/** For the systemic-abort case (issue 04): auth/authorization failure from the API itself. */
export async function sendImportAbortedToChat(
  client: ChatSender,
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
  client: ChatSender,
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

function summaryText(outcome: ImportRunOutcome, targetSuffix: string): string {
  const skippedParts = Object.entries(outcome.skippedByReason)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${count} ${humanizeReason(reason)}`);

  const lockedDayNames = outcome.rows
    .filter((r) => r.reason === "locked-day")
    .map((r) => r.employeeName);
  const lockedDayNote = lockedDayNames.length > 0 ? ` Locked day(s) for: ${Array.from(new Set(lockedDayNames)).join(", ")}.` : "";

  return `Imported ${outcome.succeeded}/${outcome.totalRows} shifts${targetSuffix}. Skipped: ${skippedParts.join(", ")}.${lockedDayNote} Full detail attached.`;
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
