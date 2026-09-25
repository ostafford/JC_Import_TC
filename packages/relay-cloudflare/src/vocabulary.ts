/**
 * Duplicated from `@sch-import/shared` rather than imported (unlike every
 * other package in this repo): Cloudflare's "Deploy to Cloudflare" button
 * requires a monorepo subdirectory to be "fully isolated... including any
 * dependencies," with no cross-package workspace deps (issue 14). This is
 * the one piece of `@sch-import/shared` this package actually uses.
 */

type Brand<T, B extends string> = T & { readonly __brand: B };

export type ConversationId = Brand<string, "ConversationId">;
export const asConversationId = (v: string): ConversationId => v as ConversationId;
