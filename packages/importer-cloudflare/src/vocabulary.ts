/**
 * Duplicated from `@sch-import/shared` rather than imported (same reasoning
 * as `relay-cloudflare/src/vocabulary.ts`): Cloudflare's "Deploy to
 * Cloudflare" button requires a monorepo subdirectory to be fully isolated,
 * including dependencies — no cross-package workspace deps allowed (issue 14).
 *
 * Branded ID types exist because Connecteam hands back several different
 * bare-string IDs and mixing them up silently is exactly the kind of bug
 * that's easy to write and hard to notice in a payroll-writing pipeline.
 */

type Brand<T, B extends string> = T & { readonly __brand: B };

export type UserId = Brand<string, "UserId">;
export type ConversationId = Brand<string, "ConversationId">;
export type FileId = Brand<string, "FileId">;
export type TimeClockId = Brand<string, "TimeClockId">;
export type BreakTypeId = Brand<string, "BreakTypeId">;
export type TimeActivityId = Brand<string, "TimeActivityId">;
export type JobId = Brand<string, "JobId">;
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
