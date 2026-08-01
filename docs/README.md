# Documentation

**Verified against:** `7e5ea28`, 2026-08-01

Frankfurt-League is a league website: a Next.js 16 frontend, a FastAPI backend, MongoDB, deployed with
Docker Compose behind nginx on a single host.

## Start here

| If you want to                                                      | Read                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Understand a part of the system                                     | the **overview** for that surface                                  |
| Look up an exact contract, or check whether something is still true | the **spec** for that surface                                      |
| Know why something is built the way it is                           | [`_decisions/`](_decisions/) — 16 ADRs                             |
| Branch, commit, open a PR, or deploy                                | [`workflows/`](workflows/)                                         |
| Write a commit message, a PR or an issue                            | [`workflows/message-templates.md`](workflows/message-templates.md) |
| Understand the German domain vocabulary                             | [`glossary.md`](glossary.md)                                       |
| Write or change documentation                                       | [`_standard/`](_standard/)                                         |
| Run an audit or remediation programme                               | [`_auditing/`](_auditing/)                                         |
| See open items and future plans                                     | [`roadmap/`](roadmap/)                                             |

### Coming back after a while?

Read in this order. About an hour, and it is the shortest path back to being able to change things
confidently:

1. **[`glossary.md`](glossary.md)** — the German vocabulary is load-bearing and some of it is
   counter-intuitive. Everything else assumes it.
2. **The three surface overviews** — [frontend](frontend/overview.md),
   [backend](backend/overview.md), [ops](ops/overview.md). What each part is and why it is shaped that
   way.
3. **The [ADR index](_decisions/README.md)** — sixteen one-line summaries. This is the fastest
   available answer to "why is it like this", and the reason you will not re-litigate settled
   questions.
4. **[`workflows/`](workflows/)** — how to actually ship a change, and the message templates.

The specs are reference, not reading. Look things up in them; do not read them through.

## Surfaces

| Surface                                        | Overview                         | Spec                     |
| ---------------------------------------------- | -------------------------------- | ------------------------ |
| **Frontend** — the Next.js app, `fl_frontend/` | [overview](frontend/overview.md) | [spec](frontend/spec.md) |
| **Backend** — the FastAPI app, `fl_backend/`   | [overview](backend/overview.md)  | [spec](backend/spec.md)  |
| **Ops** — build, routing, deployment           | [overview](ops/overview.md)      | [spec](ops/spec.md)      |

Operational procedures — every script, the tag scheme, rollback — are in
[`../scripts/README.md`](../scripts/README.md), which is the operational manual and is not duplicated
here.

## The three things most likely to surprise you

1. **The browser never talks to FastAPI.** Every application read is a server-side fetch from the Next
   container, which is why all caching lives in the frontend and the backend authenticates with three
   shared API keys rather than user sessions.
2. **A team document is season-independent.** Group, statistics and disqualification live on a separate
   `saison_teams` junction, joined at read time. `FLTeam` flattens the two back together, so it looks
   like one document and is not.
3. **`"playoffs"` is not a stored value.** It is a query-only alias for "not gruppenphase".

## Open findings

Recorded while documenting, deliberately not acted on. Full analyses: [`roadmap/open-items.md`](roadmap/open-items.md).

| #      | Finding                                                                                                                     | Severity                                                                 |
| ------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **F4** | Team statistics are written to `teams` but read from `saison_teams` — so a result edit may not move the league table at all | **High.** Statically evidenced, never confirmed against a running system |
| F1     | `ausstehend` means "today or later" on the server and "later than today" on the client                                      | Question of intent, not a bug                                            |
| F2     | The Pydantic and Zod models are hand-mirrored, with no generation step                                                      | Accepted risk                                                            |
| F7     | The landing page's season badge is hardcoded, so it goes stale at the rollover                                              | Cosmetic, but fails silently                                             |

Two more have been resolved: **F5**, a dead empty backend module, deleted; and **F6**, a comment saying
to revisit something once a revalidation route existed — it already did, and the comment was corrected.

## Also here

- [`_decisions/`](_decisions/) — **16 ADRs**, one per architectural decision, append-only. Start at its
  [index](_decisions/README.md); it is the fastest summary of why the codebase is shaped as it is.
- [`_auditing/`](_auditing/) — how audit programmes are run: methodology, lessons, prompt library,
  templates, and the permanent [final reports](_auditing/reports/) of completed programmes
  (frontend: [2026-07](_auditing/reports/2026-07-frontend.md)). Driven by the `/audit:*` commands.
- `audit/` — **gitignored and local-only**: the working documents (pass reports, remediation
  ledger, wave reports) of whatever audit programme is currently running. Deliberately never
  committed — the repo is public and unfixed findings must not publish. A finished programme's
  permanent record is its final report in [`_auditing/reports/`](_auditing/reports/); the 2026-07
  frontend programme's decisions are the 16 ADRs and its open items live in the
  [`roadmap/open-items.md`](roadmap/open-items.md).
