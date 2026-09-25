import { createHmac } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  ConnecteamAuthError,
  asConversationId,
  asJobId,
  asPublisherId,
  asTimeActivityId,
  asTimeClockId,
  asUserId,
} from "./index.js";
import { EXPECTED_HEADERS } from "./scheduleExport.js";
import { processImportTrigger, verifyRelayTrigger, type ImportTriggerClient } from "./importTrigger.js";

const SECRET = "shared-secret";
const EXPECTED_CONVERSATION = asConversationId("conv-1");

function signBody(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

test("verifyRelayTrigger: valid signature and payload -> ok", async () => {
  const body = JSON.stringify({ conversationId: "conv-1", messageId: "m1", attachmentUrl: "https://cdn/x" });
  const signature = signBody(SECRET, body);

  const result = await verifyRelayTrigger(Buffer.from(body, "utf8"), signature, SECRET, EXPECTED_CONVERSATION);

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok ? result.payload : undefined, {
    conversationId: "conv-1",
    messageId: "m1",
    attachmentUrl: "https://cdn/x",
  });
});

test("verifyRelayTrigger: wrong secret -> bad-signature", async () => {
  const body = JSON.stringify({ conversationId: "conv-1", messageId: "m1", attachmentUrl: "https://cdn/x" });
  const signature = signBody("some-other-secret", body);

  const result = await verifyRelayTrigger(Buffer.from(body, "utf8"), signature, SECRET, EXPECTED_CONVERSATION);

  assert.deepEqual(result, { ok: false, reason: "bad-signature" });
});

test("verifyRelayTrigger: missing signature header -> bad-signature", async () => {
  const body = JSON.stringify({ conversationId: "conv-1", messageId: "m1", attachmentUrl: "https://cdn/x" });

  const result = await verifyRelayTrigger(Buffer.from(body, "utf8"), undefined, SECRET, EXPECTED_CONVERSATION);

  assert.deepEqual(result, { ok: false, reason: "bad-signature" });
});

test("verifyRelayTrigger: correctly signed but not JSON shaped like a trigger -> malformed-payload", async () => {
  const body = JSON.stringify({ nope: "not a trigger" });
  const signature = signBody(SECRET, body);

  const result = await verifyRelayTrigger(Buffer.from(body, "utf8"), signature, SECRET, EXPECTED_CONVERSATION);

  assert.deepEqual(result, { ok: false, reason: "malformed-payload" });
});

test("verifyRelayTrigger: valid trigger for a different conversation -> wrong-conversation", async () => {
  const body = JSON.stringify({ conversationId: "conv-2", messageId: "m1", attachmentUrl: "https://cdn/x" });
  const signature = signBody(SECRET, body);

  const result = await verifyRelayTrigger(Buffer.from(body, "utf8"), signature, SECRET, EXPECTED_CONVERSATION);

  assert.deepEqual(result, { ok: false, reason: "wrong-conversation" });
});

/** A minimal, synthetic one-row Schedule Export — not the repo's real sample files, which scheduleExport.test.ts already covers. */
async function buildScheduleExportBuffer(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Schedule");
  sheet.addRow([...EXPECTED_HEADERS]);
  sheet.addRow([
    "21/09/2026", // Date
    "09:00am", // Start
    "05:00pm", // End
    "Australia/Melbourne", // Timezone
    "", // Availability status
    "", // Resource — blank, so processing never needs a Job lookup
    "Jack Mitchell", // Users
    "", // Address
    "", // Note
    "", // Note has attachments
    "", // Shift tags
    "", // Shift title
    "", // Draft
    "", // Unpaid Breaks
    "", // Paid Breaks
    "", // Last Status
    "", // Tasks
    "", // Check In
    "", // Check In Note
    "", // Check In GPS
    "", // Complete
    "", // Complete Note
    "", // Complete GPS
  ]);
  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
}

const basePayload = { conversationId: "conv-1", messageId: "m1", attachmentUrl: "https://cdn/attachment" };
const baseConfig = { timeClockId: asTimeClockId("tc1"), manualBreaksEnabled: false };
const baseChatConfig = { conversationId: EXPECTED_CONVERSATION, senderId: asPublisherId("pub-1") };

function fakeClient(overrides: Partial<ImportTriggerClient> = {}): ImportTriggerClient {
  return {
    async downloadAttachment() {
      throw new Error("downloadAttachment should not be called in this test");
    },
    async listUsersByFullNames() {
      return [{ userId: asUserId("u1"), firstName: "Jack", lastName: "Mitchell", isArchived: false }];
    },
    async listJobsByTitles() {
      return [{ jobId: asJobId("job-1"), title: "Chef" }];
    },
    async createShiftTimeActivity() {
      return { timeActivityId: asTimeActivityId("ta1") };
    },
    async createBreakTimeActivity() {
      throw new Error("should not be called — manual breaks disabled");
    },
    async postChatMessage() {},
    async uploadChatAttachment() {
      throw new Error("uploadChatAttachment should not be called — no skipped rows in this test");
    },
    ...overrides,
  };
}

test("processImportTrigger: full success -> posts a one-line success message", async () => {
  const posted: Array<{ text: string }> = [];
  const buffer = await buildScheduleExportBuffer();
  const client = fakeClient({
    async downloadAttachment() {
      return buffer;
    },
    async postChatMessage(input) {
      posted.push({ text: input.text ?? "" });
    },
  });

  await processImportTrigger(client, baseConfig, baseChatConfig, basePayload);

  assert.equal(posted.length, 1);
  assert.match(posted[0]!.text, /Imported 1 shift/);
});

test("processImportTrigger: a systemic auth error -> posts an abort notice, never rejects", async () => {
  const posted: Array<{ text: string }> = [];
  const buffer = await buildScheduleExportBuffer();
  const client = fakeClient({
    async downloadAttachment() {
      return buffer;
    },
    async createShiftTimeActivity() {
      throw new ConnecteamAuthError("token rejected");
    },
    async postChatMessage(input) {
      posted.push({ text: input.text ?? "" });
    },
  });

  await processImportTrigger(client, baseConfig, baseChatConfig, basePayload);

  assert.equal(posted.length, 1);
  assert.match(posted[0]!.text, /Connecteam rejected this Importer's credentials/);
});

test("processImportTrigger: a crash mid-run -> posts a crash notice, never rejects", async () => {
  const posted: Array<{ text: string }> = [];
  const client = fakeClient({
    async downloadAttachment() {
      throw new Error("network boom");
    },
    async postChatMessage(input) {
      posted.push({ text: input.text ?? "" });
    },
  });

  await processImportTrigger(client, baseConfig, baseChatConfig, basePayload);

  assert.equal(posted.length, 1);
  assert.match(posted[0]!.text, /Import Run failed before finishing \(network boom\)/);
});

test("processImportTrigger: crash AND the crash notice itself fails to send -> still never rejects", async () => {
  let postAttempts = 0;
  const client = fakeClient({
    async downloadAttachment() {
      throw new Error("network boom");
    },
    async postChatMessage() {
      postAttempts++;
      throw new Error("chat is also down");
    },
  });

  await processImportTrigger(client, baseConfig, baseChatConfig, basePayload);

  assert.equal(postAttempts, 1);
});
