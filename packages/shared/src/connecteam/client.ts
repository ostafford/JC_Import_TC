import {
  asBreakTypeId,
  asJobId,
  asTimeActivityId,
  asTimeClockId,
  asUserId,
  type BreakTypeId,
  type ConversationId,
  type FileId,
  type TimeClockId,
  type UserId,
} from "../vocabulary.js";
import type {
  ChatConversation,
  ConnecteamUser,
  ConnecteamWebhook,
  CreateBreakTimeActivityInput,
  CreateBreakTimeActivityResult,
  CreateShiftTimeActivityInput,
  CreateShiftTimeActivityResult,
  Job,
  ManualBreaksConfig,
  PostChatMessageInput,
  TimeClock,
  TimestampWithTimezone,
} from "./types.js";

export interface ConnecteamClientOptions {
  apiToken: string;
  baseUrl?: string;
}

/**
 * A systemic, non-row-specific failure (auth/authorization from the API itself).
 * Per issue 04, this is the only thing that should abort a whole Import Run —
 * every other per-row failure gets caught, flagged, and skipped instead.
 */
export class ConnecteamAuthError extends Error {}

/** Any other Connecteam API error — callers decide per-row handling (issue 04). */
export class ConnecteamApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

const DEFAULT_BASE_URL = "https://api.connecteam.com";
const USERS_PAGE_LIMIT = 500;
/** Confirmed live (2026-09-22): GET /chat/v1/conversations 400s above limit=100. */
const CONVERSATIONS_PAGE_LIMIT = 100;
/** Confirmed live (2026-09-22): GET /jobs/v1/jobs accepts up to limit=500. */
const JOBS_PAGE_LIMIT = 500;

/**
 * Thin wrapper over the Connecteam API surface this project needs.
 *
 * Endpoints marked "confirmed" were pasted/cited directly in the resolved
 * tickets under .scratch/connecteam-schedule-import/issues/, or verified live
 * against a real account. Endpoints marked "unconfirmed" are this project's
 * best-guess request/response shape and MUST be checked against
 * developer.connecteam.com (or a sandbox account) before the first real
 * write — same spirit as map.md's own outstanding "empirical validation"
 * item for the users fullNames filter.
 *
 * Every GET endpoint checked live so far (users, conversations, time-clocks,
 * manual-breaks — 2026-09-22) wraps its payload in a common envelope,
 * `{requestId, data: {...}, paging?}`, not the bare body originally guessed.
 * `unwrapEnvelope` below applies that unwrap centrally; write endpoints are
 * assumed to follow the same convention but that part isn't empirically
 * confirmed yet (their response fields, separately, may still be wrong).
 */
export class ConnecteamClient {
  private readonly apiToken: string;
  private readonly baseUrl: string;

  constructor(options: ConnecteamClientOptions) {
    this.apiToken = options.apiToken;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  }

  private async request<T>(
    method: string,
    path: string,
    options: { query?: Record<string, string | number | (string | number)[] | undefined>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(key, String(v));
      } else {
        url.searchParams.set(key, String(value));
      }
    }

    const res = await fetch(url, {
      method,
      headers: {
        "X-API-KEY": this.apiToken,
        "Content-Type": "application/json",
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    if (res.status === 401 || res.status === 403) {
      throw new ConnecteamAuthError(`Connecteam API auth failure (${res.status}) on ${method} ${path}`);
    }

    const text = await res.text();
    const json = text.length > 0 ? JSON.parse(text) : undefined;

    if (!res.ok) {
      throw new ConnecteamApiError(`Connecteam API error (${res.status}) on ${method} ${path}`, res.status, json);
    }

    return unwrapEnvelope<T>(json);
  }

  /**
   * Confirmed: GET /users/v1/users?fullNames=...&userStatus=all (issue 03).
   * `userStatus=all` is required, or archived Employees vanish silently instead
   * of surfacing as "deactivated" (issue 03). Paginates via limit/offset (max 500).
   *
   * `fullNames` must be repeated query params (`fullNames=A&fullNames=B`), NOT
   * one comma-joined value — this was map.md's own flagged "needs empirical
   * validation" item, and the comma-joined guess was wrong: it silently
   * matched zero users for any 2+ name batch instead of erroring, so every
   * multi-row Import Run failed to match anyone. Confirmed live (2026-09-22).
   */
  async listUsersByFullNames(fullNames: string[]): Promise<ConnecteamUser[]> {
    if (fullNames.length === 0) return [];

    const results: ConnecteamUser[] = [];
    let offset = 0;
    for (;;) {
      const page = await this.request<{ users: RawUser[] }>("GET", "/users/v1/users", {
        query: {
          fullNames,
          userStatus: "all",
          limit: USERS_PAGE_LIMIT,
          offset,
        },
      });
      const users = page.users ?? [];
      results.push(...users.map(fromRawUser));
      if (users.length < USERS_PAGE_LIMIT) break;
      offset += USERS_PAGE_LIMIT;
    }
    return results;
  }

  /**
   * Confirmed live (2026-09-22): GET /jobs/v1/jobs?jobNames=...&instanceIds=...
   * Scoped to one Time Clock via `instanceIds`, matching Job titles case-sensitively
   * (per developer.connecteam.com's Get Jobs guide) — same repeated-query-param
   * lesson as `listUsersByFullNames`: `jobNames`/`instanceIds` must each be
   * sent as repeated params, not comma-joined, or the API silently matches
   * nothing rather than erroring.
   */
  async listJobsByTitles(titles: string[], instanceId: TimeClockId): Promise<Job[]> {
    if (titles.length === 0) return [];

    const results: Job[] = [];
    let offset = 0;
    for (;;) {
      const page = await this.request<{ jobs: Array<{ jobId: string; title: string }> }>("GET", "/jobs/v1/jobs", {
        query: {
          jobNames: titles,
          instanceIds: [String(instanceId)],
          includeDeleted: "false",
          limit: JOBS_PAGE_LIMIT,
          offset,
        },
      });
      const jobs = page.jobs ?? [];
      results.push(...jobs.map((j) => ({ jobId: asJobId(j.jobId), title: j.title })));
      if (jobs.length < JOBS_PAGE_LIMIT) break;
      offset += JOBS_PAGE_LIMIT;
    }
    return results;
  }

  /**
   * Confirmed via developer.connecteam.com (2026-09-25): GET /time-clock/v1/time-clocks.
   * No pagination documented — the whole account's Time Clocks return in one array.
   * Exists because Time Clock IDs aren't visible anywhere in Connecteam's own web UI,
   * so `importer setup` and the wizard both need this to offer a picker by name
   * instead of asking the Admin to type a raw ID they have no way to find.
   */
  async listTimeClocks(): Promise<TimeClock[]> {
    const page = await this.request<{ timeClocks: Array<{ id: number; name: string; isArchived: boolean }> }>(
      "GET",
      "/time-clock/v1/time-clocks",
    );
    return (page.timeClocks ?? []).map((tc) => ({
      timeClockId: asTimeClockId(String(tc.id)),
      name: tc.name,
      isArchived: tc.isArchived,
    }));
  }

  /** Confirmed: GET /time-clock/v1/time-clocks/{timeClockId}/manual-breaks (issue 08). */
  async getManualBreaksConfig(timeClockId: TimeClockId): Promise<ManualBreaksConfig> {
    const raw = await this.request<{
      areManualBreaksEnabled: boolean;
      manualBreaks: Array<{ id: string; name: string; isPaid: boolean; duration: number }>;
    }>("GET", `/time-clock/v1/time-clocks/${timeClockId}/manual-breaks`);

    return {
      areManualBreaksEnabled: raw.areManualBreaksEnabled,
      breakTypes: raw.manualBreaks.map((b) => ({
        id: asBreakTypeId(b.id),
        name: b.name,
        isPaid: b.isPaid,
        duration: b.duration,
      })),
    };
  }

  /**
   * Confirmed via developer.connecteam.com's OpenAPI schema (2026-09-22):
   * POST /chat/v1/conversations/{conversationId}/message. `senderId` must be
   * sent as an integer on the wire, not the branded string it's typed as
   * internally — this project's own `PublisherId` is still a string brand,
   * only the JSON body needs the numeric form Connecteam expects.
   * Keep `text` well under 500 chars; put per-row detail in an attached file instead.
   * Response is a genuinely empty object (confirmed live, 2026-09-22) — nothing to return.
   */
  async postChatMessage(input: PostChatMessageInput): Promise<void> {
    await this.request<unknown>("POST", `/chat/v1/conversations/${input.conversationId}/message`, {
      body: {
        senderId: Number(input.senderId),
        text: input.text,
        attachments: input.attachments,
      },
    });
  }

  /**
   * Confirmed via developer.connecteam.com's Time Activities guide (2026-09-22):
   * POST /time-clock/v1/time-clocks/{id}/time-activities is a BATCH endpoint
   * (`timeActivities: [{userId, shifts, manualbreaks}]`, up to 100 users and
   * 50 shifts/breaks each per call) — this project calls it with a single
   * user/single shift each time, preserving the per-row error isolation issue
   * 04 relies on rather than batching rows together. `userId` goes over the
   * wire as an integer; `start`/`end` are `{timestamp, timezone}` objects, not
   * bare epoch numbers as originally guessed. `jobId` is required on any Time
   * Clock with job tracking enforced — discovered live (2026-09-22), not
   * anticipated by any ticket; see `JobId`'s doc comment.
   */
  async createShiftTimeActivity(input: CreateShiftTimeActivityInput): Promise<CreateShiftTimeActivityResult> {
    const raw = await this.request<TimeActivitiesBatchResponse>(
      "POST",
      `/time-clock/v1/time-clocks/${input.timeClockId}/time-activities`,
      {
        body: {
          timeActivities: [
            {
              userId: Number(input.userId),
              shifts: [
                {
                  start: toWireTimestamp(input.start),
                  end: toWireTimestamp(input.end),
                  jobId: input.jobId,
                },
              ],
              manualbreaks: [],
            },
          ],
        },
      },
    );
    const shift = raw.timeActivitiesByUsers[0]?.shifts[0];
    if (!shift) throw new Error("Connecteam did not return the created shift");
    return { timeActivityId: asTimeActivityId(shift.id) };
  }

  /**
   * Confirmed via developer.connecteam.com's Time Activities guide (2026-09-22):
   * same batch endpoint as createShiftTimeActivity, with `isSplitShiftOnManualBreak: true`
   * so this break splits whatever already-created shift its start/end window
   * overlaps — there's no `shiftTimeActivityId` field; splitting is by time
   * overlap, not an explicit reference (issue 08's original design guessed a
   * reference existed). Per the guide's own recommended pattern, this must be
   * called AFTER the shift it should split already exists — split logic looks
   * up shifts at the moment the break is created and does not retroactively
   * run against shifts created later.
   */
  async createBreakTimeActivity(input: CreateBreakTimeActivityInput): Promise<CreateBreakTimeActivityResult> {
    const raw = await this.request<TimeActivitiesBatchResponse>(
      "POST",
      `/time-clock/v1/time-clocks/${input.timeClockId}/time-activities`,
      {
        body: {
          isSplitShiftOnManualBreak: true,
          timeActivities: [
            {
              userId: Number(input.userId),
              shifts: [],
              manualbreaks: [
                { id: input.breakTypeId, start: toWireTimestamp(input.start), end: toWireTimestamp(input.end) },
              ],
            },
          ],
        },
      },
    );
    const brk = raw.timeActivitiesByUsers[0]?.manualBreaks[0];
    if (!brk) throw new Error("Connecteam did not return the created manual break");
    return { timeActivityId: asTimeActivityId(brk.id) };
  }

  /**
   * Confirmed live against a real account (2026-09-22): GET /chat/v1/conversations.
   * The conversation identifier field is `id`, and the display name is `title` —
   * both differ from this project's own `ChatConversation`/`conversationId` naming,
   * so they're renamed on the way in.
   *
   * Paginates via limit/offset like listUsersByFullNames — confirmed live that this
   * matters: an account with 70+ conversations only returns a handful per page, and
   * `limit` caps out at 100 server-side (a `limit=500` request 400s).
   */
  async listConversations(): Promise<ChatConversation[]> {
    const results: ChatConversation[] = [];
    let offset = 0;
    for (;;) {
      const page = await this.request<{ conversations: Array<{ id: string; title?: string }> }>(
        "GET",
        "/chat/v1/conversations",
        { query: { limit: CONVERSATIONS_PAGE_LIMIT, offset } },
      );
      const conversations = page.conversations ?? [];
      results.push(...conversations.map((c) => ({ conversationId: c.id as ConversationId, name: c.title })));
      if (conversations.length < CONVERSATIONS_PAGE_LIMIT) break;
      offset += CONVERSATIONS_PAGE_LIMIT;
    }
    return results;
  }

  /**
   * Confirmed via developer.connecteam.com's OpenAPI schema and Chat webhook
   * guide (2026-09-22): POST /settings/v1/webhooks, `featureType: "chat"`,
   * `eventTypes: ["message_created"]`, scoped to one conversation via
   * `entityId` (issue 06's original guess at the param name was right; the
   * path and the rest of the body were not). `secretKey` is echoed back on
   * every delivery in an `x-webhook-secret` header — passing one here is what
   * lets the Relay verify inbound calls actually came from Connecteam.
   * Response wraps a numeric `id`, not the `webhookId` string originally guessed.
   *
   * `webhookVersion: 0` is required for `featureType: "chat"` specifically —
   * confirmed by trial against a live account (2026-09-22): the docs say
   * `webhookVersion` defaults to and generally means `1`, and 1/2/3/4/5/10 all
   * get rejected with "Invalid webhook version N for feature chat", but `0`
   * is accepted. Undocumented quirk, not a guess — verified empirically.
   */
  async createConversationWebhook(
    conversationId: ConversationId,
    targetUrl: string,
    secretKey: string,
  ): Promise<{ webhookId: string }> {
    const raw = await this.request<{ id: number }>("POST", "/settings/v1/webhooks", {
      body: {
        name: "Schedule Export chat trigger",
        url: targetUrl,
        featureType: "chat",
        eventTypes: ["message_created"],
        entityId: conversationId,
        secretKey,
        webhookVersion: 0,
      },
    });
    return { webhookId: String(raw.id) };
  }

  /**
   * Confirmed live (2026-09-23): `GET /settings/v1/webhooks` returns every
   * webhook on the account (no `limit`/`offset` needed for the 3 this
   * project's own testing produced — unlike `listConversations`, this has
   * NOT been confirmed to paginate under a large account; revisit if an
   * account with many webhooks ever needs this). Used by the setup wizard to
   * verify an Admin manually created the right webhook in Connecteam's own
   * UI (issue 06 addendum) rather than the Importer creating it via API —
   * `secretKey` is never present on this response, so only existence and
   * targeting (`url`, `entityId`, `eventTypes`) can be verified this way.
   */
  async listWebhooks(): Promise<ConnecteamWebhook[]> {
    const raw = await this.request<{
      webhooks: Array<{
        id: number;
        name: string;
        url: string;
        isDisabled: boolean;
        featureType: string;
        entityId: string | null;
        eventTypes: string[];
        webhookVersion: number;
      }>;
    }>("GET", "/settings/v1/webhooks");
    return raw.webhooks.map((w) => ({ ...w, id: String(w.id) }));
  }

  /**
   * Confirmed live (2026-09-22): a received attachment carries a direct
   * download `url` on `public.cdn.connecteam.com`, not a `fileId` — the
   * fileId-based download this originally guessed doesn't exist. The URL
   * works fine with the API token attached (sent defensively); whether it's
   * actually required (vs. this being an unauthenticated public CDN URL,
   * which the hostname suggests) wasn't specifically isolated.
   */
  async downloadAttachment(url: string): Promise<Buffer> {
    const res = await fetch(url, { headers: { "X-API-KEY": this.apiToken } });
    if (res.status === 401 || res.status === 403) {
      throw new ConnecteamAuthError(`Connecteam API auth failure (${res.status}) downloading attachment`);
    }
    if (!res.ok) {
      throw new ConnecteamApiError(`Failed to download attachment (${res.status})`, res.status, await res.text());
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return buf;
  }

  /**
   * Confirmed via developer.connecteam.com's "Upload file to the Cloud" guide
   * (2026-09-22): uploading isn't a single POST as originally guessed — it's a
   * 3-step dance: (1) generate a pre-signed cloud-storage URL scoped to a
   * `featureType`, (2) PUT the bytes directly to that URL (not Connecteam's
   * API — cloud storage, and it expires in 300s), (3) finalize/register the
   * upload by fileId. Only after step 3 can the fileId be used in a message's
   * `attachments`. `conversationId` plays no part in any of this — attachments
   * aren't conversation-scoped, only referenced by fileId when posting.
   */
  async uploadChatAttachment(fileName: string, content: Buffer, fileTypeHint: string): Promise<FileId> {
    const generated = await this.request<{ fileId: string; uploadFileUrl: string }>(
      "POST",
      "/attachments/v1/files/generate-upload-url",
      { body: { fileName, fileTypeHint, featureType: "chat" } },
    );

    const putRes = await fetch(generated.uploadFileUrl, {
      method: "PUT",
      headers: { "Content-Type": fileTypeHint },
      body: content,
    });
    if (!putRes.ok) {
      throw new ConnecteamApiError(
        `Failed to PUT attachment to cloud storage (${putRes.status})`,
        putRes.status,
        await putRes.text(),
      );
    }

    await this.request<{ fileId: string }>("PUT", `/attachments/v1/files/complete-upload/${generated.fileId}`);

    return generated.fileId as FileId;
  }
}

interface RawUser {
  /** Confirmed live (2026-09-22): a number on the wire, not a string as originally guessed. */
  userId: number;
  firstName: string;
  lastName: string;
  email?: string;
  isArchived: boolean;
}

function fromRawUser(raw: RawUser): ConnecteamUser {
  return {
    userId: asUserId(String(raw.userId)),
    firstName: raw.firstName,
    lastName: raw.lastName,
    email: raw.email,
    isArchived: raw.isArchived,
  };
}

/**
 * Unwraps Connecteam's common `{requestId, data, paging?}` response envelope
 * (confirmed live 2026-09-22 across users/conversations/time-clocks/manual-breaks).
 * Falls back to the raw body for any response that doesn't use it, rather than
 * silently returning `undefined`.
 */
function unwrapEnvelope<T>(json: unknown): T {
  if (typeof json === "object" && json !== null && "data" in json) {
    return (json as { data: T }).data;
  }
  return json as T;
}

function toWireTimestamp(t: TimestampWithTimezone): { timestamp: number; timezone: string } {
  return { timestamp: Math.floor(t.timestamp.getTime() / 1000), timezone: t.timezone };
}

/**
 * Response shape confirmed via developer.connecteam.com's Time Activities
 * guide (2026-09-22) — same envelope for both create-shift and create-break
 * calls since they hit the same batch endpoint.
 */
interface TimeActivitiesBatchResponse {
  timeActivitiesByUsers: Array<{
    userId: number;
    shifts: Array<{ id: string }>;
    manualBreaks: Array<{ id: string }>;
  }>;
}
