Type: research
Status: resolved
Blocked by: 01

## Question

Given the real Schedule Export sample(s) from [issue 01](01-real-schedule-export-sample.md), decide how the Importer should map an export row to a Connecteam Employee (userId) via the API — e.g. exact name match against a `GET` users list, email match, or something more robust. Cover the ambiguous cases: two Employees with the same display name, an Employee removed/deactivated since the export was taken, and a row that matches nothing.

## Answer

**Confirmed from developer.connecteam.com**: `GET /users/v1/users` returns `userId`, `firstName`, `lastName` (no `fullName` field — must concatenate), `email` (required only for `manager`/`owner`, not plain `user`), and `isArchived` (the active/inactive flag). Source: https://developer.connecteam.com/reference/get_users_users_v1_users_get. A `fullNames` query param (string array, exact "First Last" match) lets the Importer batch-resolve every distinct name in one Import in a single call rather than paging the whole roster; pagination is `limit`/`offset` (max 500). A `userStatus` param (`active`/`archived`/`all`, default `active`) must be passed as `all` or archived Employees vanish silently instead of surfacing as "deactivated." Sources: https://developer.connecteam.com/reference/get_users_users_v1_users_get, https://developer.connecteam.com/docs/read-users-data. Name uniqueness is **not documented anywhere** — contrast `phoneNumber` and `userId`, which docs explicitly call unique. That silence is reasoned (not confirmed) evidence duplicate full names are possible. Source: https://developer.connecteam.com/docs/update-users-data.

**Strategy**: once per Import, call `fullNames=<all distinct export names>&userStatus=all`; for each row, case-insensitively compare `firstName + " " + lastName` against the export name within the returned set (the docs self-contradict on server-side case handling, so don't rely on it). Then: exactly one active match → use its `userId`. Exactly one match but `isArchived=true` → skip row, flag "Employee deactivated since export." Zero matches → skip row, flag "no matching Employee found." More than one match → skip row, flag "ambiguous name — resolve manually" listing candidate `userId`s. Never auto-pick: the export has no secondary identifier (issue 01) to break a tie, and misattributing a shift is worse than skipping it. Feeds issue 04's per-row failure policy.

## Addendum from live implementation (2026-09-22)

**Real, serious bug found and fixed**: `fullNames` must be sent as **repeated query params** (`fullNames=A&fullNames=B`), never one comma-joined value. The comma-joined guess this ticket originally shipped with didn't error — it silently matched **zero** users for any batch of 2+ names, which meant every real multi-row Import Run flagged every single Employee as unmatched. A real account's real roster (10 real Employees, exact-name matches) confirmed both the bug and the fix: 0/10 matched before, 10/10 after. This is the same repeated-vs-comma-joined issue as `GET /jobs/v1/jobs`'s `jobNames`/`instanceIds` params (new — see [issue 12](12-job-tracking-required.md)); treat every Connecteam array-typed query filter as needing repeated params unless proven otherwise.

Also confirmed live: the response wraps `users` in a `{requestId, data, paging}` envelope (not a bare body), and `userId` is a **number** on the wire, not a string. See [issue 11](11-users-api-name-matching-verification.md) for the case-sensitivity/duplicate-name follow-up this also prompted.
