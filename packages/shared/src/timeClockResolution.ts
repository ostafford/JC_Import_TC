import type { ConnecteamClient } from "./connecteam/client.js";
import type { TimeClockId } from "./vocabulary.js";

export interface TimeClockOption {
  timeClockId: TimeClockId;
  name: string;
}

export type TimeClockResolution =
  | { kind: "resolved"; timeClockId: TimeClockId }
  | { kind: "unresolved" }
  | { kind: "conflict"; jobResolvedTimeClockId: TimeClockId; captionResolvedTimeClockId: TimeClockId };

/** Only the lookup this module needs — keeps it mockable without a real ConnecteamClient. */
export type JobLookup = Pick<ConnecteamClient, "listJobsAcrossTimeClocksByTitles">;

/**
 * Resolves which of this Importer's configured Time Clocks a Schedule
 * Export belongs to (multi-time-clock-routing map, issues 01/05). Only
 * called when more than one Time Clock is configured — a single configured
 * Time Clock never needs resolution at all.
 *
 * Primary signal: every distinct `Resource` value in the file, resolved to a
 * real Job (the Importer's existing Job-matching step, just unscoped), then
 * intersected against this Importer's configured Time Clocks. Narrows across
 * every resource in the file — a genuinely mixed-location file, or a Job
 * shared across more than one configured Time Clock, won't narrow to
 * exactly one, and correctly falls through to the caption instead of
 * guessing.
 *
 * Fallback: `caption` (the upload's own message text) matched against a
 * configured Time Clock's real name, case-insensitively and trimmed — the
 * same tolerance this project already applies to other name matching.
 */
export async function resolveTimeClockForRun(
  client: JobLookup,
  resourceTitles: string[],
  configuredTimeClocks: TimeClockOption[],
  caption: string | undefined,
): Promise<TimeClockResolution> {
  const viaJobs = await resolveViaJobs(client, resourceTitles, configuredTimeClocks);
  const viaCaption = resolveViaCaption(caption, configuredTimeClocks);

  // Discovered live (2026-09-26): a caption is a real, explicit instruction
  // from the Admin — silently overriding it with the Job-resolved Time Clock
  // whenever Jobs happen to resolve cleanly (the original design) let two
  // uploads captioned for two different Time Clocks both write to the same
  // one with no warning. Both signals are checked every time now; when they
  // disagree, that's a genuine conflict, not something to guess through.
  if (viaJobs && viaCaption && viaJobs !== viaCaption) {
    return { kind: "conflict", jobResolvedTimeClockId: viaJobs, captionResolvedTimeClockId: viaCaption };
  }

  if (viaJobs) return { kind: "resolved", timeClockId: viaJobs };
  if (viaCaption) return { kind: "resolved", timeClockId: viaCaption };
  return { kind: "unresolved" };
}

async function resolveViaJobs(
  client: JobLookup,
  resourceTitles: string[],
  configuredTimeClocks: TimeClockOption[],
): Promise<TimeClockId | undefined> {
  const distinct = Array.from(new Set(resourceTitles.map((r) => r.trim()).filter((r) => r.length > 0)));
  if (distinct.length === 0) return undefined;

  const configuredIds = new Set(configuredTimeClocks.map((tc) => tc.timeClockId));
  const jobs = await client.listJobsAcrossTimeClocksByTitles(distinct);
  const matchedJobs = jobs.filter((j) => distinct.includes(j.title));
  if (matchedJobs.length === 0) return undefined;

  let candidates: Set<TimeClockId> | undefined;
  for (const job of matchedJobs) {
    const jobCandidates = new Set(job.instanceIds.filter((id) => configuredIds.has(id)));
    candidates = candidates === undefined ? jobCandidates : intersect(candidates, jobCandidates);
  }

  if (candidates === undefined || candidates.size !== 1) return undefined;
  return [...candidates][0];
}

/**
 * A substring match, not an exact one — discovered live (2026-09-26) that an
 * Admin naturally types a caption like "import to MYOB", not the bare Time
 * Clock name on its own, so requiring an exact match silently failed every
 * real attempt. Still requires exactly one configured Time Clock's name to
 * appear in the caption — if two configured names both show up (e.g. one
 * name is itself a substring of another, and the caption spells out the
 * longer one), that's correctly left ambiguous rather than guessed.
 */
function resolveViaCaption(
  caption: string | undefined,
  configuredTimeClocks: TimeClockOption[],
): TimeClockId | undefined {
  const normalized = caption?.trim().toLowerCase();
  if (!normalized) return undefined;

  const matches = configuredTimeClocks.filter((tc) => normalized.includes(tc.name.trim().toLowerCase()));
  return matches.length === 1 ? matches[0]!.timeClockId : undefined;
}

function intersect<T>(a: Set<T>, b: Set<T>): Set<T> {
  return new Set([...a].filter((x) => b.has(x)));
}
