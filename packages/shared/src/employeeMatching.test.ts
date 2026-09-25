import { test } from "node:test";
import assert from "node:assert/strict";
import { asExportEmployeeName, asUserId } from "./vocabulary.js";
import { matchEmployeesByName, type UserLookup } from "./employeeMatching.js";

function fakeClient(users: Array<{ userId: string; firstName: string; lastName: string; isArchived: boolean }>): UserLookup {
  return {
    async listUsersByFullNames() {
      return users.map((u) => ({ ...u, userId: asUserId(u.userId) }));
    },
  };
}

test("exactly one active match -> matched", async () => {
  const client = fakeClient([{ userId: "u1", firstName: "Jack", lastName: "Mitchell", isArchived: false }]);
  const result = await matchEmployeesByName(client, [asExportEmployeeName("Jack Mitchell")]);
  assert.deepEqual(result.get(asExportEmployeeName("Jack Mitchell")), { kind: "matched", userId: "u1" });
});

test("case-insensitive match", async () => {
  const client = fakeClient([{ userId: "u1", firstName: "Jack", lastName: "Mitchell", isArchived: false }]);
  const result = await matchEmployeesByName(client, [asExportEmployeeName("jack mitchell")]);
  assert.equal(result.get(asExportEmployeeName("jack mitchell"))?.kind, "matched");
});

test("zero matches -> unmatched", async () => {
  const client = fakeClient([]);
  const result = await matchEmployeesByName(client, [asExportEmployeeName("Nobody Here")]);
  assert.deepEqual(result.get(asExportEmployeeName("Nobody Here")), { kind: "unmatched" });
});

test("one match but archived -> archived, never auto-matched", async () => {
  const client = fakeClient([{ userId: "u1", firstName: "Jack", lastName: "Mitchell", isArchived: true }]);
  const result = await matchEmployeesByName(client, [asExportEmployeeName("Jack Mitchell")]);
  assert.deepEqual(result.get(asExportEmployeeName("Jack Mitchell")), { kind: "archived" });
});

test("more than one match -> ambiguous, never auto-picked", async () => {
  const client = fakeClient([
    { userId: "u1", firstName: "Jack", lastName: "Mitchell", isArchived: false },
    { userId: "u2", firstName: "Jack", lastName: "Mitchell", isArchived: true },
  ]);
  const result = await matchEmployeesByName(client, [asExportEmployeeName("Jack Mitchell")]);
  assert.deepEqual(result.get(asExportEmployeeName("Jack Mitchell")), {
    kind: "ambiguous",
    candidateUserIds: ["u1", "u2"],
  });
});
