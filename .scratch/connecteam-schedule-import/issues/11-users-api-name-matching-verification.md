Type: task
Status: partially resolved

## Question

Empirically verify, against a live/sandbox Connecteam account, two things left unconfirmed by [issue 03](03-employee-identity-matching.md)'s doc research: (1) whether the `GET /users/v1/users` `fullNames` filter is actually case-sensitive or not (Connecteam's own OpenAPI spec and Guide prose disagree), and (2) what happens if two active Employees in the same account genuinely share a full name — does the filter return both, or something else? Create two same-named test Employees and a couple of differently-cased name variants, call the endpoint, and record the actual behavior. This should confirm or correct the matching strategy in issue 03 before it's implemented as designed.

## Answer (partial)

**(1) Case sensitivity — confirmed, resolved.** Tested live against a real account (2026-09-22): `fullNames=jack mitchell`, `fullNames=JACK MITCHELL`, and `fullNames=Jack Mitchell` all returned the same one match. The server-side filter is case-**insensitive**. (The Importer's own `fullNameMatches` still re-checks case-insensitively client-side too, which stays correct and cheap either way.)

**(2) Duplicate full names — still unconfirmed.** Not tested: doing so would mean creating fake duplicate-named Employees in a real production Connecteam account, which wasn't judged worth the cleanup/pollution cost for this project. Still open — a real sandbox account would settle it properly.

**Unrelated, more urgent bug this investigation surfaced**: multi-name batches were failing entirely, for a different reason than anything this ticket asked about — see [issue 03](03-employee-identity-matching.md)'s addendum. Fixed live.
