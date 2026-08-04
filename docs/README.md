# Documentation

**Verified against:** `af67d7d`, 2026-08-04

Frankfurt-League is a league website: a Next.js frontend, a FastAPI backend, MongoDB, deployed with
Docker Compose behind nginx on a single host.

This page is the entry point to everything written down about it. **Start with the task table**; the
rest explains how the documentation is organised and why.

---

## Start here

| If you want to                                                      | Read                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Understand a part of the system                                     | the **overview** for that surface                                  |
| Look up an exact contract, or check whether something is still true | the **spec** for that surface                                      |
| Know why something is built the way it is                           | [`_decisions/`](_decisions/) — the ADR log                         |
| Find out whether a rule is deliberate before "fixing" it            | [`_decisions/README.md`](_decisions/README.md), then the ADR       |
| Branch, commit, open a pull request, or deploy                      | [`workflows/`](workflows/)                                         |
| Write a commit message, a PR or an issue                            | [`workflows/message-templates.md`](workflows/message-templates.md) |
| Run a script, publish an image, or roll back                        | [`../scripts/README.md`](../scripts/README.md)                     |
| Understand the German domain vocabulary                             | [`glossary.md`](glossary.md)                                       |
| Write or change any documentation                                   | [`_standard/`](_standard/)                                         |
| Run an audit or remediation programme                               | [`_auditing/`](_auditing/)                                         |
| See what is planned, and what is deliberately not                   | [`roadmap/open-items.md`](roadmap/open-items.md)                   |
| Find out what happened to an item no longer listed                  | [`roadmap/closed-items.md`](roadmap/closed-items.md)               |

### Coming back after a while

Read in this order. About an hour, and it is the shortest path back to changing things confidently.

1. **[`glossary.md`](glossary.md)** — the German vocabulary is load-bearing and some of it is
   counter-intuitive. Everything else assumes it.
2. **The three surface overviews** — [frontend](frontend/overview.md), [backend](backend/overview.md),
   [ops](ops/overview.md). What each part is, and why it is shaped that way.
3. **The [ADR index](_decisions/README.md)** — one line per decision. The fastest answer to "why is it
   like this", and the reason you will not re-litigate settled questions.
4. **[`workflows/`](workflows/)** — how to actually ship a change.

The specs are reference, not reading. Look things up in them; do not read them through.

---

## How this documentation is organised

**Three layers, three different update triggers.** That is the whole design — nothing here needs a
scheduled review, because nothing depends on one.

| Layer          | Answers                                 | Shape                          | Changes when                   |
| -------------- | --------------------------------------- | ------------------------------ | ------------------------------ |
| **Overview**   | What is this surface for?               | ~120 lines of prose, read once | A surface's purpose changes    |
| **Spec sheet** | What is the contract? Is it still true? | Tables, looked up              | A constraint changes           |
| **ADR**        | Why is it like this? May I change it?   | One decision, argued           | **Never** — superseded instead |

Plus the **glossary**, which is cross-cutting and belongs to no surface.

The rule underneath all of it: **code documents the local and the changeable, `/docs` documents the
cross-cutting and the decided.** An inline comment says what not to do at the line where doing it is
tempting; an ADR says why, once, in full; the comment cites the ADR number. Nothing appears twice.

### A worked example

_May I delete the unconditional `updateTag("spiele")`, since the granular tag covers it?_

- The **overview** says the frontend owns all caching because the browser never talks to FastAPI.
  Context, not an answer.
- The **spec sheet** gives invariant I2 and how it breaks: the default read path sends no `saison_id`,
  so those entries carry only base tags. That is the answer — no.
- The **ADR** says why, what was deleted, and what would have to change for the answer to become yes.

---

## Surfaces

A **surface** is one of the three parts a reader goes to as a whole. Three, because that is the
granularity at which a question has one answer.

| Surface                                        | Is                                   | Overview                         | Spec                     |
| ---------------------------------------------- | ------------------------------------ | -------------------------------- | ------------------------ |
| **Frontend** — the Next.js app, `fl_frontend/` | Every page, and all caching          | [overview](frontend/overview.md) | [spec](frontend/spec.md) |
| **Backend** — the FastAPI app, `fl_backend/`   | The API and every database rule      | [overview](backend/overview.md)  | [spec](backend/spec.md)  |
| **Ops** — compose, nginx, scripts, Dockerfiles | How it is built, routed and deployed | [overview](ops/overview.md)      | [spec](ops/spec.md)      |

Every spec follows the same spine — numbered contract sections, then **Invariants**, **Violation →
remedy**, **Known-open** — so moving between them costs nothing. Operational procedure (every script,
the tag scheme, rollback) lives in [`../scripts/README.md`](../scripts/README.md) and is not
duplicated here.

---

## The rest of `docs/`

| Path                         | Holds                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| [`_decisions/`](_decisions/) | The ADR log. Append-only, globally numbered, never rewritten. Start at its index            |
| [`_standard/`](_standard/)   | How this repository is documented — the principles, the shapes, and how they stay true      |
| [`_auditing/`](_auditing/)   | How an audit-and-remediation programme is run, plus the permanent reports of completed ones |
| [`workflows/`](workflows/)   | Branching, commits, pull requests, deployment, and the message templates                    |
| [`roadmap/`](roadmap/)       | Open items with their analyses, and the closed log naming the commit that closed each       |
| [`glossary.md`](glossary.md) | The German domain vocabulary                                                                |
| `audit/`                     | **Gitignored.** Working documents of a running programme — see below                        |

**The two underscored folders are cross-cutting meta**, which is what the prefix marks: they are about
the decisions and about the documentation itself, so they sort above the three surfaces and never read
as a fourth one.

**`audit/` is gitignored and has two tiers.** `audit/programme/` holds a running programme's working
documents and is deleted when that programme closes; `audit/register.md` is the standing failure-mode
register and survives every close. Neither is ever committed — this repository is public, and unfixed
findings must not publish. A finished programme's permanent record is its final report in
[`_auditing/reports/`](_auditing/reports/); decisions it ratified become ADRs, and anything left open
moves to the roadmap.

---

## Keeping it true

Documentation drifts unless something stops it. Four defences, and only the third is automatic:

1. **Anchored citations.** Every claim cites `<file> :: <symbol>` or an ADR number — never
   a line number, which is wrong after any edit above it and detected by nothing.
2. **The same-commit rule.** A change that invalidates a documented claim updates that document **in
   the same commit**. A commit whose docs contradict its code is incomplete, not a commit with a
   follow-up.
3. **The documentation gate**, inside `./scripts/verify.sh`. It fails on a citation that resolves to
   nothing — a dangling ADR number, a dead link, a broken anchor, a missing path — in `/docs` and
   inside source comments alike.
4. **One question before every pull request:** what did this change make untrue?

Pages describing current state carry a **`Verified against`** line naming the commit someone last
checked them against. ADRs deliberately do not: an ADR is dated to when its decision was taken, so a
re-check line would imply something that by design never happens.

Full rules and the reasoning: [`_standard/`](_standard/), starting at
[`1-principles.md`](_standard/1-principles.md).

---

## The three things most likely to surprise you

1. **The browser never talks to FastAPI.** Every application read is a server-side fetch from the Next
   container, which is why all caching lives in the frontend and the backend authenticates with shared
   API keys rather than user sessions.
2. **A team document is season-independent.** Group and disqualification live on a separate
   `saison_teams` junction, joined at read time; the league table is computed from the match documents
   on every read and stored nowhere. `FLTeam` flattens all three sources together, so it looks like one
   document and is not.
3. **`"playoffs"` is not a stored value.** It is a query-only alias for "not gruppenphase".

## Open findings

Recorded rather than acted on. Full analyses in [`roadmap/open-items.md`](roadmap/open-items.md).

| #   | Finding                                                                                | Severity                      |
| --- | -------------------------------------------------------------------------------------- | ----------------------------- |
| F1  | `ausstehend` means "today or later" on the server and "later than today" on the client | Question of intent, not a bug |
| F2  | The Pydantic and Zod models are hand-mirrored, with no generation step                 | Accepted risk                 |
| F7  | The landing page's season badge is hardcoded, so it goes stale at the rollover         | Cosmetic, but fails silently  |

Resolved findings are rows in [`roadmap/closed-items.md`](roadmap/closed-items.md), each naming the
commit that closed it.
