import type {
  BreakTypeId,
  ConversationId,
  FileId,
  JobId,
  PublisherId,
  TimeActivityId,
  TimeClockId,
  UserId,
} from "../vocabulary.js";

/**
 * Confirmed via GET /users/v1/users (developer.connecteam.com/reference/get_users_users_v1_users_get).
 * No `fullName` field — callers must concatenate firstName + " " + lastName themselves (issue 03).
 */
export interface ConnecteamUser {
  userId: UserId;
  firstName: string;
  lastName: string;
  email?: string;
  isArchived: boolean;
}

/**
 * Confirmed via GET /time-clock/v1/time-clocks/{timeClockId}/manual-breaks (issue 08).
 * `duration` is the type's configured default and is NOT what gets written to a break
 * Time Activity — actual duration always comes from the Schedule Export's real start/end.
 */
export interface ManualBreakType {
  id: BreakTypeId;
  name: string;
  isPaid: boolean;
  duration: number;
}

export interface ManualBreaksConfig {
  areManualBreaksEnabled: boolean;
  breakTypes: ManualBreakType[];
}

export interface ChatConversation {
  conversationId: ConversationId;
  name?: string;
}

/**
 * Confirmed via a direct `GET /settings/v1/webhooks` call (issue 06 addendum,
 * 2026-09-23) — used only to let the setup wizard verify a webhook the Admin
 * created by hand in Connecteam's own UI actually exists with the right
 * scope, since `secretKey` is never echoed back by this endpoint (so the
 * secret itself can't be verified this way, only the object's existence and
 * targeting).
 */
export interface ConnecteamWebhook {
  id: string;
  name: string;
  url: string;
  isDisabled: boolean;
  featureType: string;
  entityId: string | null;
  eventTypes: string[];
  webhookVersion: number;
}

export interface FileAttachment {
  type: "file";
  fileId: FileId;
}

export interface ImageAttachment {
  type: "image";
  fileId: FileId;
}

/**
 * Confirmed via developer.connecteam.com's OpenAPI schema (2026-09-22):
 * POST /chat/v1/conversations/{conversationId}/message. `senderId` is a
 * Custom Publisher ID (an integer on the wire), not a real Employee's
 * UserId — issue 06's original design conflated the two. `attachments`
 * is `[{type, fileId}]`, not a bare array of fileIds as originally guessed.
 * `text` should stay well under 500 chars — Connecteam's own docs disagree with themselves
 * (1000 char field limit vs. "under 500" in prose) so target the stricter number.
 * Response body is a genuinely empty object — confirmed live (2026-09-22) — so
 * there's no messageId to return, unlike this project's original guess.
 */
export interface PostChatMessageInput {
  conversationId: ConversationId;
  senderId: PublisherId;
  text: string;
  attachments?: Array<FileAttachment | ImageAttachment>;
}

/**
 * Confirmed via developer.connecteam.com's Time Activities guide (2026-09-22):
 * every timestamp Connecteam's write API takes is `{timestamp, timezone}`,
 * not a bare instant — it wants the local IANA zone alongside the Unix
 * seconds, not just an absolute point in time.
 */
export interface TimestampWithTimezone {
  timestamp: Date;
  timezone: string;
}

/** Confirmed via GET /jobs/v1/jobs (discovered live, 2026-09-22 — see JobId's doc comment). */
export interface Job {
  jobId: JobId;
  title: string;
}

export interface CreateShiftTimeActivityInput {
  timeClockId: TimeClockId;
  userId: UserId;
  start: TimestampWithTimezone;
  end: TimestampWithTimezone;
  /** Required on Time Clocks that enforce job tracking; omit where a row carries no Resource/Job. */
  jobId?: JobId;
}

export interface CreateShiftTimeActivityResult {
  timeActivityId: TimeActivityId;
}

/**
 * Confirmed via developer.connecteam.com's Time Activities guide (2026-09-22):
 * this corrects issue 08's design in two ways. First, the real endpoint wants
 * a break's own `start`/`end` (not a bare `durationMinutes`) — issue 08 had
 * assumed no real break start time exists (the export only carries an
 * aggregate per-category duration, issue 01), which is still true; callers
 * now derive a placement window within the shift themselves (see
 * `placeBreaksWithinShift` in the Importer's importRun.ts) rather than
 * Connecteam accepting a duration directly. Second, there's no
 * `shiftTimeActivityId` to reference — splitting is automatic, based on
 * whichever already-created shift the break's window overlaps
 * (`isSplitShiftOnManualBreak: true`), not an explicit foreign key.
 */
export interface CreateBreakTimeActivityInput {
  timeClockId: TimeClockId;
  userId: UserId;
  breakTypeId: BreakTypeId;
  start: TimestampWithTimezone;
  end: TimestampWithTimezone;
}

export interface CreateBreakTimeActivityResult {
  timeActivityId: TimeActivityId;
}

/** True once the user has already clocked something real for that shift — the "skip" signal for issue 04. */
export interface ExistingTimeActivityCheck {
  hasRealEntry: boolean;
  isLockedDay: boolean;
}
