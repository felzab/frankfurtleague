# Documentation

**Verified against:** `52b6ef5`, 2026-08-01

Frankfurt-League is a league website: a Next.js 16 frontend, a FastAPI backend, MongoDB, deployed with
Docker Compose behind nginx on a single host.

## Start here

| If you want to                                                      | Read                                                     |
| ------------------------------------------------------------------- | -------------------------------------------------------- |
| Understand a part of the system                                     | the **overview** for that surface                        |
| Look up an exact contract, or check whether something is still true | the **spec** for that surface                            |
| Know why something is built the way it is                           | [`_decisions/`](_decisions/) — 16 ADRs                   |
| Branch, commit, open a PR, or deploy                                | [`workflows.md`](workflows.md)                           |
| Understand the German domain vocabulary                             | [`glossary.md`](glossary.md)                             |
| Write or change documentation                                       | [`_standard/`](_standard/)                               |
| See what is documented and what is left                             | [`0-documentation-ledger.md`](0-documentation-ledger.md) |

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
4. **[`workflows.md`](workflows.md)** — how to actually ship a change.

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

Recorded while documenting, deliberately not acted on. Full detail in the ledger.

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
- [`audit/`](audit/) — the five-pass audit and the remediation programme that preceded this
  documentation. **Historical, and safe to delete:** every decision it held is now an ADR, and the two
  open items it owned (BE-4, BE-9) have been moved into the ledger's Part 5. It stays in git history
  either way.
