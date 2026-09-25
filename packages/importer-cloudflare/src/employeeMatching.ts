import type { ConnecteamClient } from "./connecteamClient.js";
import type { ConnecteamUser } from "./types.js";
import { type ExportEmployeeName, type UserId } from "./vocabulary.js";

export type EmployeeMatchOutcome =
  | { kind: "matched"; userId: UserId }
  | { kind: "unmatched" }
  | { kind: "archived" }
  | { kind: "ambiguous"; candidateUserIds: UserId[] };

/** Only the lookup this module needs — keeps it mockable without a real ConnecteamClient. */
export type UserLookup = Pick<ConnecteamClient, "listUsersByFullNames">;

/**
 * Per issue 03: batch-resolve every distinct export name in one call, then
 * case-insensitively confirm `firstName + " " + lastName` client-side (the
 * API docs self-contradict on server-side case handling, so this project
 * doesn't rely on it). Never auto-picks between candidates — the export has
 * no secondary identifier to break a tie.
 */
export async function matchEmployeesByName(
  client: UserLookup,
  exportNames: ExportEmployeeName[],
): Promise<Map<ExportEmployeeName, EmployeeMatchOutcome>> {
  const distinctNames = Array.from(new Set(exportNames));
  const users = await client.listUsersByFullNames(distinctNames);

  const result = new Map<ExportEmployeeName, EmployeeMatchOutcome>();
  for (const name of distinctNames) {
    const candidates = users.filter((u) => fullNameMatches(u, name));

    if (candidates.length === 0) {
      result.set(name, { kind: "unmatched" });
    } else if (candidates.length === 1) {
      const only = candidates[0]!;
      result.set(name, only.isArchived ? { kind: "archived" } : { kind: "matched", userId: only.userId });
    } else {
      result.set(name, { kind: "ambiguous", candidateUserIds: candidates.map((c) => c.userId) });
    }
  }
  return result;
}

function fullNameMatches(user: ConnecteamUser, exportName: ExportEmployeeName): boolean {
  const full = `${user.firstName} ${user.lastName}`.trim().toLowerCase();
  return full === (exportName as string).trim().toLowerCase();
}
