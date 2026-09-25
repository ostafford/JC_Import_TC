import { asJobId, asTimeActivityId, asUserId, type FileId, type TimeClockId } from "./vocabulary.js";
import type {
  ConnecteamUser,
  CreateBreakTimeActivityInput,
  CreateBreakTimeActivityResult,
  CreateShiftTimeActivityInput,
  CreateShiftTimeActivityResult,
  Job,
  PostChatMessageInput,
  TimestampWithTimezone,
} from "./types.js";

/**
 * Duplicated + trimmed from `@sch-import/shared`'s `ConnecteamClient` (see
 * vocabulary.ts's isolation note) — only the runtime methods this Worker
 * actually calls. Setup-only methods (getManualBreaksConfig,
 * listConversations, createConversationWebhook, listWebhooks) are dropped.
 * `Buffer` is replaced with `ArrayBuffer` throughout (Workers' native
 * currency for raw bytes — no Node polyfill needed for this part).
 */

export interface ConnecteamClientOptions {
  apiToken: string;
  baseUrl?: string;
}

export class ConnecteamAuthError extends Error {}

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
const JOBS_PAGE_LIMIT = 500;

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

  async listUsersByFullNames(fullNames: string[]): Promise<ConnecteamUser[]> {
    if (fullNames.length === 0) return [];

    const results: ConnecteamUser[] = [];
    let offset = 0;
    for (;;) {
      const page = await this.request<{ users: RawUser[] }>("GET", "/users/v1/users", {
        query: { fullNames, userStatus: "all", limit: USERS_PAGE_LIMIT, offset },
      });
      const users = page.users ?? [];
      results.push(...users.map(fromRawUser));
      if (users.length < USERS_PAGE_LIMIT) break;
      offset += USERS_PAGE_LIMIT;
    }
    return results;
  }

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

  async postChatMessage(input: PostChatMessageInput): Promise<void> {
    await this.request<unknown>("POST", `/chat/v1/conversations/${input.conversationId}/message`, {
      body: {
        senderId: Number(input.senderId),
        text: input.text,
        attachments: input.attachments,
      },
    });
  }

  async createShiftTimeActivity(input: CreateShiftTimeActivityInput): Promise<CreateShiftTimeActivityResult> {
    const raw = await this.request<TimeActivitiesBatchResponse>(
      "POST",
      `/time-clock/v1/time-clocks/${input.timeClockId}/time-activities`,
      {
        body: {
          timeActivities: [
            {
              userId: Number(input.userId),
              shifts: [{ start: toWireTimestamp(input.start), end: toWireTimestamp(input.end), jobId: input.jobId }],
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
              manualbreaks: [{ id: input.breakTypeId, start: toWireTimestamp(input.start), end: toWireTimestamp(input.end) }],
            },
          ],
        },
      },
    );
    const brk = raw.timeActivitiesByUsers[0]?.manualBreaks[0];
    if (!brk) throw new Error("Connecteam did not return the created manual break");
    return { timeActivityId: asTimeActivityId(brk.id) };
  }

  /** A received attachment carries a direct download `url` — no fileId-based download exists. */
  async downloadAttachment(url: string): Promise<ArrayBuffer> {
    const res = await fetch(url, { headers: { "X-API-KEY": this.apiToken } });
    if (res.status === 401 || res.status === 403) {
      throw new ConnecteamAuthError(`Connecteam API auth failure (${res.status}) downloading attachment`);
    }
    if (!res.ok) {
      throw new ConnecteamApiError(`Failed to download attachment (${res.status})`, res.status, await res.text());
    }
    return res.arrayBuffer();
  }

  /**
   * Three-step dance: (1) generate a pre-signed cloud-storage URL, (2) PUT
   * the bytes directly there (not Connecteam's API — expires in 300s), (3)
   * finalize/register the upload by fileId.
   */
  async uploadChatAttachment(fileName: string, content: ArrayBuffer, fileTypeHint: string): Promise<FileId> {
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
      throw new ConnecteamApiError(`Failed to PUT attachment to cloud storage (${putRes.status})`, putRes.status, await putRes.text());
    }

    await this.request<{ fileId: string }>("PUT", `/attachments/v1/files/complete-upload/${generated.fileId}`);

    return generated.fileId as FileId;
  }
}

interface RawUser {
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

function unwrapEnvelope<T>(json: unknown): T {
  if (typeof json === "object" && json !== null && "data" in json) {
    return (json as { data: T }).data;
  }
  return json as T;
}

function toWireTimestamp(t: TimestampWithTimezone): { timestamp: number; timezone: string } {
  return { timestamp: Math.floor(t.timestamp.getTime() / 1000), timezone: t.timezone };
}

interface TimeActivitiesBatchResponse {
  timeActivitiesByUsers: Array<{
    userId: number;
    shifts: Array<{ id: string }>;
    manualBreaks: Array<{ id: string }>;
  }>;
}
