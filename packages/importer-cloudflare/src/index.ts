import {
  asBreakTypeId,
  asConversationId,
  asPublisherId,
  asTimeClockId,
  ConnecteamClient,
  processImportTrigger,
  verifyRelayTrigger,
  type BreakTypeId,
  type ConversationId,
  type PublisherId,
  type RelayTriggerPayload,
  type RelayTriggerVerificationFailure,
  type TimeClockId,
} from "@sch-import/shared";

const SIGNATURE_HEADER = "x-relay-signature";

export interface Env {
  CONNECTEAM_API_TOKEN: string;
  WEBHOOK_SHARED_SECRET: string;
  CONNECTEAM_BASE_URL?: string;
  CONVERSATION_ID: string;
  TIME_CLOCK_ID: string;
  /** A Custom Publisher ID (Settings -> Feed settings in Connecteam), not a real Employee's user ID. */
  SENDER_ID: string;
  MANUAL_BREAKS_ENABLED: string;
  UNPAID_BREAK_TYPE_ID?: string;
  PAID_BREAK_TYPE_ID?: string;
  IMPORT_QUEUE: Queue<RelayTriggerPayload>;
}

/**
 * Cloudflare Worker port of the local Importer's webhook receiver
 * (`packages/importer/src/webhookServer.ts`), per issue 14/15.
 *
 * The `fetch()` handler below only validates and enqueues — it does none of
 * the actual Import Run work. This is a real architecture change from the
 * local process (which acks 202 then keeps working on the same process),
 * driven by an empirical finding, not a preference: issue 08's own measured
 * real-world numbers (45 rows -> ~140 sequential Connecteam API calls)
 * already sit close to 30 seconds of wall-clock time, and BOTH of a
 * Worker's two execution-extension mechanisms cap out around there —
 * `ctx.waitUntil()` extends ~30s past a response being sent, and staying
 * inside the request/response cycle only avoids a cap as long as the
 * original CALLER (the Relay) stays connected, which its own `waitUntil`
 * budget bounds to the same ~30s once *it* has already acked Connecteam.
 * Neither path is safe for this project's actual measured call volume.
 *
 * A Queue consumer has neither restriction — no HTTP client to disconnect
 * from, and a wall-clock budget of up to 15 minutes per invocation
 * (confirmed via developers.cloudflare.com/queues/platform/limits/) — so the
 * real work moves to `queue()` below. This is this ticket's concrete answer
 * to issue 14's deferred "Worker vs Queue-backed processing" question: a
 * plain Worker fetch handler alone isn't enough at this project's real
 * scale; a producer/consumer split is.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response(null, { status: 405 });
    }

    const rawBody = await request.arrayBuffer();
    const signature = request.headers.get(SIGNATURE_HEADER);

    const verification = await verifyRelayTrigger(
      rawBody,
      signature,
      env.WEBHOOK_SHARED_SECRET,
      asConversationId(env.CONVERSATION_ID),
    );

    if (!verification.ok) {
      return new Response(null, { status: statusForFailure(verification.reason) });
    }

    await env.IMPORT_QUEUE.send(verification.payload);
    return new Response(null, { status: 202 });
  },

  /**
   * One message per Import Run trigger (`max_batch_size: 1` in
   * wrangler.jsonc) — deliberately not batched, so one trigger's processing
   * can't be entangled with another's.
   *
   * No automatic retry (`max_retries: 0`, issue 18, discovered live
   * 2026-09-25): a crash partway through can mean some rows already wrote
   * real Time Activities, and this pipeline has no way to know which on a
   * second attempt — a blind retry duplicates writes instead of fixing
   * anything. `processImportTrigger` always notifies Chat itself and never
   * rejects, so this always acks.
   */
  async queue(batch: MessageBatch<RelayTriggerPayload>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const client = new ConnecteamClient({ apiToken: env.CONNECTEAM_API_TOKEN, baseUrl: env.CONNECTEAM_BASE_URL });
      const config = configFromEnv(env);

      await processImportTrigger(
        client,
        {
          timeClockId: config.timeClockId,
          manualBreaksEnabled: config.manualBreaksEnabled,
          unpaidBreakTypeId: config.unpaidBreakTypeId,
          paidBreakTypeId: config.paidBreakTypeId,
        },
        { conversationId: config.conversationId, senderId: config.senderId },
        message.body,
      );
      message.ack();
    }
  },
};

function statusForFailure(reason: RelayTriggerVerificationFailure): number {
  switch (reason) {
    case "bad-signature":
      return 401;
    case "malformed-payload":
      return 400;
    case "wrong-conversation":
      return 403;
  }
}

interface ResolvedConfig {
  conversationId: ConversationId;
  timeClockId: TimeClockId;
  senderId: PublisherId;
  manualBreaksEnabled: boolean;
  unpaidBreakTypeId?: BreakTypeId;
  paidBreakTypeId?: BreakTypeId;
}

function configFromEnv(env: Env): ResolvedConfig {
  return {
    conversationId: asConversationId(env.CONVERSATION_ID),
    timeClockId: asTimeClockId(env.TIME_CLOCK_ID),
    senderId: asPublisherId(env.SENDER_ID),
    manualBreaksEnabled: env.MANUAL_BREAKS_ENABLED === "true",
    unpaidBreakTypeId: env.UNPAID_BREAK_TYPE_ID ? asBreakTypeId(env.UNPAID_BREAK_TYPE_ID) : undefined,
    paidBreakTypeId: env.PAID_BREAK_TYPE_ID ? asBreakTypeId(env.PAID_BREAK_TYPE_ID) : undefined,
  };
}
