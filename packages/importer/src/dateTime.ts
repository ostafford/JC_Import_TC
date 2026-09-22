/**
 * Schedule Export date/time parsing (issue 01): dates are `DD/MM/YYYY`, times are
 * 12-hour `hh:mmam/pm`, and each row carries its own IANA `Timezone` string —
 * so a shift's real UTC instant depends on all three fields together.
 */

const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const TIME_RE = /^(\d{2}):(\d{2})(am|pm)$/i;
const DURATION_RE = /^(\d{1,2}):(\d{2})$/;

export function parseExportDate(raw: string): { year: number; month: number; day: number } {
  const m = DATE_RE.exec(raw.trim());
  if (!m) throw new Error(`Unrecognized Schedule Export date: ${JSON.stringify(raw)}`);
  const [, dd, mm, yyyy] = m;
  return { year: Number(yyyy), month: Number(mm), day: Number(dd) };
}

export function parseExportTime(raw: string): { hour24: number; minute: number } {
  const m = TIME_RE.exec(raw.trim());
  if (!m) throw new Error(`Unrecognized Schedule Export time: ${JSON.stringify(raw)}`);
  const [, hh, mm, meridiem] = m;
  let hour24 = Number(hh) % 12;
  if (meridiem.toLowerCase() === "pm") hour24 += 12;
  return { hour24, minute: Number(mm) };
}

/** "00:45" -> 45, "01:15" -> 75. Returns undefined for blank/absent values. */
export function parseBreakDurationMinutes(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const m = DURATION_RE.exec(trimmed);
  if (!m) throw new Error(`Unrecognized break duration: ${JSON.stringify(raw)}`);
  const [, hh, mm] = m;
  return Number(hh) * 60 + Number(mm);
}

/**
 * Resolves a Schedule Export row's local date + time + IANA timezone to the
 * real UTC instant, using a one-pass guess-and-correct against Intl's own
 * timezone database (no external tz library needed). Accurate except right at
 * a DST transition edge, which this project doesn't need to handle precisely.
 */
export function exportLocalTimeToUtc(dateRaw: string, timeRaw: string, timeZone: string): Date {
  const { year, month, day } = parseExportDate(dateRaw);
  const { hour24, minute } = parseExportTime(timeRaw);

  const naiveUtcMs = Date.UTC(year, month - 1, day, hour24, minute);
  const offsetMinutes = timeZoneOffsetMinutesAt(new Date(naiveUtcMs), timeZone);
  return new Date(naiveUtcMs - offsetMinutes * 60_000);
}

/** Offset (in minutes, UTC ahead-of/behind) of `timeZone` at the instant `at`. */
function timeZoneOffsetMinutesAt(at: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(at)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }

  const asUtcMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );

  return (asUtcMs - at.getTime()) / 60_000;
}
