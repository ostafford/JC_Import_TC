import { ConnecteamApiError, ConnecteamAuthError, type ConnecteamClient } from "./connecteamClient.js";
import { matchEmployeesByName } from "./employeeMatching.js";
import type { ScheduleExportRow } from "./scheduleExport.js";
import type { BreakTypeId, JobId, TimeClockId, UserId } from "./vocabulary.js";

/** Only the write operations this module needs — keeps it mockable without a real ConnecteamClient. */
export type ImportWriter = Pick<
  ConnecteamClient,
  "listUsersByFullNames" | "listJobsByTitles" | "createShiftTimeActivity" | "createBreakTimeActivity"
>;

export type SkipReason =
  | "unmatched-employee"
  | "ambiguous-employee"
  | "archived-employee"
  | "unmatched-job"
  | "already-has-real-entry"
  | "locked-day"
  | "other-write-error";

export interface ImportRowResult {
  date: string;
  employeeName: string;
  outcome: "success" | "skipped";
  reason?: SkipReason;
  detail?: string;
}

export interface ImportRunOutcome {
  totalRows: number;
  succeeded: number;
  skippedByReason: Record<SkipReason, number>;
  rows: ImportRowResult[];
}

export interface ImportPipelineConfig {
  timeClockId: TimeClockId;
  manualBreaksEnabled: boolean;
  unpaidBreakTypeId?: BreakTypeId;
  paidBreakTypeId?: BreakTypeId;
}

const SKIP_REASONS: SkipReason[] = [
  "unmatched-employee",
  "ambiguous-employee",
  "archived-employee",
  "unmatched-job",
  "already-has-real-entry",
  "locked-day",
  "other-write-error",
];

/**
 * Per issue 04: partial-success-by-default. Every per-row failure is caught,
 * flagged, and skipped — the whole run only aborts on a systemic
 * ConnecteamAuthError, since that would just repeat on every remaining row.
 */
export async function runImportRun(
  client: ImportWriter,
  rows: ScheduleExportRow[],
  config: ImportPipelineConfig,
): Promise<ImportRunOutcome> {
  const matches = await matchEmployeesByName(client, rows.map((r) => r.employeeName));
  const jobsByResource = await resolveJobsByResource(client, rows.map((r) => r.resource), config.timeClockId);

  const results: ImportRowResult[] = [];
  const skippedByReason = Object.fromEntries(SKIP_REASONS.map((r) => [r, 0])) as Record<SkipReason, number>;
  let succeeded = 0;

  const skip = (row: ScheduleExportRow, reason: SkipReason, detail?: string) => {
    skippedByReason[reason]++;
    results.push({ date: row.date, employeeName: row.employeeName, outcome: "skipped", reason, detail });
  };

  for (const row of rows) {
    if (row.hasRealEntry) {
      skip(row, "already-has-real-entry");
      continue;
    }

    const match = matches.get(row.employeeName)!;
    if (match.kind === "unmatched") {
      skip(row, "unmatched-employee", "No matching Employee found for this name.");
      continue;
    }
    if (match.kind === "archived") {
      skip(row, "archived-employee", "Employee has been deactivated since the export was taken.");
      continue;
    }
    if (match.kind === "ambiguous") {
      skip(row, "ambiguous-employee", `Ambiguous name — candidate userIds: ${match.candidateUserIds.join(", ")}`);
      continue;
    }

    let jobId: JobId | undefined;
    if (row.resource.trim().length > 0) {
      jobId = jobsByResource.get(row.resource);
      if (!jobId) {
        skip(row, "unmatched-job", `No Job named "${row.resource}" found on this Time Clock.`);
        continue;
      }
    }

    try {
      await writeRow(client, row, match.userId, jobId, config);
      succeeded++;
      results.push({ date: row.date, employeeName: row.employeeName, outcome: "success" });
    } catch (err) {
      if (err instanceof ConnecteamAuthError) throw err;

      if (err instanceof ConnecteamApiError && isLockedDayError(err)) {
        skip(row, "locked-day", `Timesheet day is locked for ${row.employeeName} — an Admin must reopen it in Connecteam.`);
      } else {
        skip(row, "other-write-error", err instanceof Error ? err.message : String(err));
      }
    }
  }

  return { totalRows: rows.length, succeeded, skippedByReason, rows: results };
}

/**
 * Batch-resolves every distinct non-blank `Resource` value in the export to a
 * real Job on the configured Time Clock, mirroring `matchEmployeesByName`'s
 * shape. Unlike Employee names, Job titles are matched case-sensitively
 * (per Connecteam's own docs) and duplicate-titled Jobs aren't specially
 * handled — first one returned wins.
 */
async function resolveJobsByResource(
  client: Pick<ImportWriter, "listJobsByTitles">,
  resources: string[],
  timeClockId: TimeClockId,
): Promise<Map<string, JobId>> {
  const distinct = Array.from(new Set(resources.map((r) => r.trim()).filter((r) => r.length > 0)));
  if (distinct.length === 0) return new Map();

  const jobs = await client.listJobsByTitles(distinct, timeClockId);
  const byTitle = new Map<string, JobId>();
  for (const job of jobs) {
    if (distinct.includes(job.title) && !byTitle.has(job.title)) {
      byTitle.set(job.title, job.jobId);
    }
  }
  return byTitle;
}

async function writeRow(
  client: ImportWriter,
  row: ScheduleExportRow,
  userId: UserId,
  jobId: JobId | undefined,
  config: ImportPipelineConfig,
): Promise<void> {
  await client.createShiftTimeActivity({
    timeClockId: config.timeClockId,
    userId,
    start: { timestamp: row.shiftStart, timezone: row.timezone },
    end: { timestamp: row.shiftEnd, timezone: row.timezone },
    jobId,
  });
  // No id to capture: a break isn't linked to its shift by reference — createBreakTimeActivity splits by time overlap instead.

  if (!config.manualBreaksEnabled) return;

  const requested: Array<{ minutes: number; breakTypeId: BreakTypeId }> = [];
  if (row.unpaidBreakMinutes !== undefined && config.unpaidBreakTypeId) {
    requested.push({ minutes: row.unpaidBreakMinutes, breakTypeId: config.unpaidBreakTypeId });
  }
  if (row.paidBreakMinutes !== undefined && config.paidBreakTypeId) {
    requested.push({ minutes: row.paidBreakMinutes, breakTypeId: config.paidBreakTypeId });
  }
  if (requested.length === 0) return;

  const placements = placeBreaksWithinShift(
    row.shiftStart,
    row.shiftEnd,
    requested.map((b) => b.minutes),
  );

  for (let i = 0; i < requested.length; i++) {
    await client.createBreakTimeActivity({
      timeClockId: config.timeClockId,
      userId,
      breakTypeId: requested[i]!.breakTypeId,
      start: { timestamp: placements[i]!.start, timezone: row.timezone },
      end: { timestamp: placements[i]!.end, timezone: row.timezone },
    });
  }
}

/**
 * The Schedule Export only ever gives a per-category aggregate duration for
 * breaks, never a real clock time — this derives a placement: every
 * requested break is laid out as one contiguous block, centered within the
 * shift, in the order given. The exact clock time is an invented placement,
 * not the employee's real break time — only the total duration is real.
 */
function placeBreaksWithinShift(shiftStart: Date, shiftEnd: Date, breakMinutesInOrder: number[]): Array<{ start: Date; end: Date }> {
  const totalBreakMs = breakMinutesInOrder.reduce((sum, m) => sum + m * 60_000, 0);
  const shiftMs = shiftEnd.getTime() - shiftStart.getTime();
  const blockStart = shiftStart.getTime() + Math.max(0, (shiftMs - totalBreakMs) / 2);

  const placed: Array<{ start: Date; end: Date }> = [];
  let cursor = blockStart;
  for (const minutes of breakMinutesInOrder) {
    const start = new Date(cursor);
    cursor += minutes * 60_000;
    placed.push({ start, end: new Date(cursor) });
  }
  return placed;
}

/**
 * Confirmed via developer.connecteam.com's Time Activities guide: locked-day
 * validation on Create Time Activities is a 400 with
 * `{"detail": ["User: X has locked days: [...]"]}`.
 */
function isLockedDayError(err: ConnecteamApiError): boolean {
  if (err.status !== 400 && err.status !== 422) return false;
  const detail = (err.body as { detail?: unknown } | undefined)?.detail;
  const message = Array.isArray(detail) ? detail.join(" ") : typeof detail === "string" ? detail : JSON.stringify(err.body ?? "");
  return /locked/i.test(message);
}
