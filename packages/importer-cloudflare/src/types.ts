/**
 * Duplicated + trimmed from `@sch-import/shared` (see vocabulary.ts) — only
 * the types this runtime-only Worker actually needs. Setup-flow types
 * (ManualBreaksConfig, ChatConversation, ConnecteamWebhook,
 * ExistingTimeActivityCheck) are dropped: this package has no `importer
 * setup` equivalent — configuration is Wrangler vars/secrets instead
 * (issue 14/15).
 */
import type { BreakTypeId, ConversationId, FileId, JobId, PublisherId, TimeActivityId, TimeClockId, UserId } from "./vocabulary.js";

/** Confirmed via GET /users/v1/users. No `fullName` field — callers concatenate firstName + " " + lastName. */
export interface ConnecteamUser {
  userId: UserId;
  firstName: string;
  lastName: string;
  email?: string;
  isArchived: boolean;
}

export interface FileAttachment {
  type: "file";
  fileId: FileId;
}

export interface ImageAttachment {
  type: "image";
  fileId: FileId;
}

export interface PostChatMessageInput {
  conversationId: ConversationId;
  senderId: PublisherId;
  text: string;
  attachments?: Array<FileAttachment | ImageAttachment>;
}

/** Every timestamp Connecteam's write API takes is `{timestamp, timezone}`, not a bare instant. */
export interface TimestampWithTimezone {
  timestamp: Date;
  timezone: string;
}

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
