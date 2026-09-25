import ExcelJS from "exceljs";
import { asExportEmployeeName, type ExportEmployeeName } from "./vocabulary.js";
import { exportLocalTimeToUtc, parseBreakDurationMinutes } from "./dateTime.js";

/**
 * Exact 23-column schema confirmed against two real exports in issue 01.
 * Connecteam controls this layout, not this project — a header mismatch means
 * the export format changed and this parser needs re-checking, not silently
 * shifting columns.
 */
export const EXPECTED_HEADERS = [
  "Date",
  "Start",
  "End",
  "Timezone",
  "Availability status",
  "Resource",
  "Users",
  "Address",
  "Note",
  "Note has attachments",
  "Shift tags",
  "Shift title",
  "Draft",
  "Unpaid Breaks",
  "Paid Breaks",
  "Last Status",
  "Tasks",
  "Check In",
  "Check In Note",
  "Check In GPS",
  "Complete",
  "Complete Note",
  "Complete GPS",
] as const;

const COL = {
  date: 1,
  start: 2,
  end: 3,
  timezone: 4,
  resource: 6,
  users: 7,
  shiftTitle: 12,
  draft: 13,
  unpaidBreaks: 14,
  paidBreaks: 15,
  checkIn: 18,
  complete: 21,
} as const;

export interface ScheduleExportRow {
  /** 1-based row number in the sheet, for error/report messages. */
  rowNumber: number;
  /** Raw `DD/MM/YYYY` as it appears in the export. */
  date: string;
  resource: string;
  employeeName: ExportEmployeeName;
  shiftTitle: string;
  isDraft: boolean;
  /** Raw IANA zone from the export's Timezone column — Connecteam's write API wants this alongside every Unix timestamp. */
  timezone: string;
  unpaidBreakMinutes?: number;
  paidBreakMinutes?: number;
  /** Non-empty Check In / Complete columns mean a real entry already exists for this shift (issue 01 / issue 04). */
  hasRealEntry: boolean;
  shiftStart: Date;
  shiftEnd: Date;
}

export class ScheduleExportFormatError extends Error {}

/**
 * Takes whatever bytes the caller already has in hand — a Node `Buffer` from
 * `fs.readFile`/an HTTP body, or the Worker's `ArrayBuffer` from
 * `Response.arrayBuffer()` — since exceljs's `Workbook#xlsx.load` accepts
 * either at runtime (its own bundled types just predate current @types/node's
 * generic `Buffer`, hence the cast below; harmless).
 */
export async function parseScheduleExport(content: Buffer | ArrayBuffer): Promise<ScheduleExportRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(content as unknown as ArrayBuffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new ScheduleExportFormatError("Schedule Export has no worksheet");

  validateHeaderRow(sheet.getRow(1));

  const rows: ScheduleExportRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const dateRaw = cellText(row, COL.date);
    if (dateRaw.length === 0) continue; // trailing blank row

    const startRaw = cellText(row, COL.start);
    const endRaw = cellText(row, COL.end);
    const timezone = cellText(row, COL.timezone);
    const employeeNameRaw = cellText(row, COL.users);
    if (employeeNameRaw.length === 0) {
      throw new ScheduleExportFormatError(`Row ${r}: empty Users column`);
    }

    const checkIn = cellText(row, COL.checkIn);
    const complete = cellText(row, COL.complete);

    rows.push({
      rowNumber: r,
      date: dateRaw,
      resource: cellText(row, COL.resource),
      employeeName: asExportEmployeeName(employeeNameRaw),
      shiftTitle: cellText(row, COL.shiftTitle),
      isDraft: cellText(row, COL.draft).toLowerCase() === "yes",
      timezone,
      unpaidBreakMinutes: parseBreakDurationMinutes(cellText(row, COL.unpaidBreaks)),
      paidBreakMinutes: parseBreakDurationMinutes(cellText(row, COL.paidBreaks)),
      hasRealEntry: checkIn.length > 0 || complete.length > 0,
      shiftStart: exportLocalTimeToUtc(dateRaw, startRaw, timezone),
      shiftEnd: exportLocalTimeToUtc(dateRaw, endRaw, timezone),
    });
  }
  return rows;
}

function validateHeaderRow(headerRow: ExcelJS.Row): void {
  for (let i = 0; i < EXPECTED_HEADERS.length; i++) {
    const actual = cellText(headerRow, i + 1);
    if (actual !== EXPECTED_HEADERS[i]) {
      throw new ScheduleExportFormatError(
        `Schedule Export header mismatch at column ${i + 1}: expected ${JSON.stringify(EXPECTED_HEADERS[i])}, got ${JSON.stringify(actual)}`,
      );
    }
  }
}

function cellText(row: ExcelJS.Row, colNumber: number): string {
  const value = row.getCell(colNumber).value;
  if (value === null || value === undefined) return "";
  return String(value).trim();
}
