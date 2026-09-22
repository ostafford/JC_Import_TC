/**
 * Canonical vocabulary for this project — see CONTEXT.md at the repo root.
 * Branded ID types exist because Connecteam hands back several different
 * bare-string IDs (user, conversation, file, time clock, break type,
 * publisher, job) and mixing them up silently is exactly the kind of bug
 * that's easy to write and hard to notice in a payroll-writing pipeline.
 */

type Brand<T, B extends string> = T & { readonly __brand: B };

export type UserId = Brand<string, "UserId">;
export type ConversationId = Brand<string, "ConversationId">;
export type FileId = Brand<string, "FileId">;
export type TimeClockId = Brand<string, "TimeClockId">;
export type BreakTypeId = Brand<string, "BreakTypeId">;
export type TimeActivityId = Brand<string, "TimeActivityId">;
/**
 * A Connecteam Job ID. Discovered live (2026-09-22), not anticipated by any
 * ticket: some Time Clocks (e.g. this account's "Xero v2") enforce job
 * tracking, and reject a shift write with "Job ID is required for this time
 * clock" unless one is attached. The Schedule Export's `Resource` column
 * (e.g. "Chef", "Barista") is the job's title — confirmed to match real Job
 * records scoped to the relevant Time Clock via GET /jobs/v1/jobs.
 */
export type JobId = Brand<string, "JobId">;
/**
 * A Connecteam Custom Publisher ID — a bot-like sender identity configured
 * in Settings -> Feed settings, distinct from a real Employee's UserId.
 * Confirmed via developer.connecteam.com's Custom Publishers guide
 * (2026-09-22): the Chat "send message" API's `senderId` must be one of
 * these, not a real user's UserId — issue 06's original design conflated
 * the two. On the wire it's an integer, not a string.
 */
export type PublisherId = Brand<string, "PublisherId">;

export const asUserId = (v: string): UserId => v as UserId;
export const asConversationId = (v: string): ConversationId => v as ConversationId;
export const asFileId = (v: string): FileId => v as FileId;
export const asTimeClockId = (v: string): TimeClockId => v as TimeClockId;
export const asBreakTypeId = (v: string): BreakTypeId => v as BreakTypeId;
export const asTimeActivityId = (v: string): TimeActivityId => v as TimeActivityId;
export const asPublisherId = (v: string): PublisherId => v as PublisherId;
export const asJobId = (v: string): JobId => v as JobId;

/** The name string as it appears in a Schedule Export's `Users` column — not yet resolved to a UserId. */
export type ExportEmployeeName = Brand<string, "ExportEmployeeName">;
export const asExportEmployeeName = (v: string): ExportEmployeeName => v as ExportEmployeeName;

/** Break category as written in the Schedule Export's column headers (issue 01 / issue 08). */
export type BreakCategory = "unpaid" | "paid";
