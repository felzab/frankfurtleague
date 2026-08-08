# ADR-0072 — `ausstehend` includes today as a filter and excludes it as a label, deliberately

**Status:** Accepted
**Date:** 2026-08-08
**Surface:** frontend, backend
**Supersedes:** —
**Superseded by:** —
**Source:** Roadmap item F1, the oldest open finding: two definitions of `ausstehend`, flagged
2026-07-29 and narrowed to the backend's filter half when FE-5 closed.

## Context

The server and the client both derive `ausstehend`, differently:

- `build_spiele_filter` (`fl_backend/app/api/spiele/services.py :: build_spiele_filter`) compiles
  `spiel_status=ausstehend` to `datum >= today` — **including today**.
- `computeSpielStatus` (`fl_frontend/src/features/spiele/utils.ts :: computeSpielStatus`) labels a
  match `ausstehend` only when `datum > today` — **excluding today**, which is `heute`.

A match played today is therefore returned by an "upcoming" query and labelled `heute` by its own
card. F1 existed to settle whether that is a defect, and two things narrowed it before this
decision. The Spielsuche's Status facet filters client-side through `computeSpielStatus`
(FE-5), so what a card says and what that filter finds cannot disagree — the client's definition is
the only one on any screen. And the backend parameter has exactly one consumer left:
`RecentAndUpcomingSpieleGrid`, the landing page's "Nächste Begegnungen", which asks for
`spiel_status=ausstehend`.

That consumer decides the question. On a match day, the landing page **must** show today's
fixtures under upcoming — an "upcoming" list that drops the games happening today, on the one
morning visitors actually look, would be the defect F1 was suspected of being.

## Decision

**The two definitions are ratified as answers to two different questions, and neither moves.**

A **filter** answers "which fixtures should this list show". The backend's `spiel_status` values
select along the date axis and are deliberately **not a partition**: `ausstehend` is
`datum >= today` — everything still ahead, today included — and `heute` (`datum == today`) is a
subset of it, for a caller that wants only today. `vergangen` is `datum < today`.

A **label** answers "what should this card say about this fixture". `computeSpielStatus` is a
partition — every fixture gets exactly one of `abgesagt`, `unbekannt`, `ausstehend`, `heute`,
`vergangen` — because one card cannot wear two words, and `heute` is the most informative word a
card can say on the day.

So a fixture today is _found_ by `ausstehend` and _labelled_ `heute`, and that composition is the
intended behaviour of the one surface that uses both.

## Consequences

**The landing page is correct on match day**, and stays correct: its upcoming list includes today's
fixtures, each labelled `HEUTE` by its own card.

**The glossary's `spiel_status` section states the rule instead of flagging a pitfall**, and the
notes at both derivation sites cite this decision rather than warning the reader off.

**`fl_backend/tests/api/test_filter_builders.py` pins `$gte` as intent, not as an accident** — a
future "cleanup" tightening it to `$gt` fails a test whose docstring names this ADR.

**FE-1 re-derives both under date ranges.** A range makes the ausstehend/heute/vergangen ternary
genuinely harder, and F1's entry always named FE-1 as the point where these semantics would be
reopened. This decision fixes the intent — a fixture whose play window includes today belongs to
"upcoming" as a filter and to "today" as a label — and FE-1 owns the arithmetic.

## Alternatives considered

**Align the server with the client (`> today`).** Rejected: it silently drops today's matches from
the landing page's upcoming list — a wrong answer delivered on exactly the day it matters, to fix a
divergence no user can observe.

**Align the client with the server (label today `ausstehend`).** Rejected: a card saying "upcoming"
about a match happening today is strictly less informative than `heute`, and it would re-open the
agreement FE-5 built between the Spielsuche's facet and the cards it filters.

**A new filter value for "today or later", keeping `ausstehend` strict.** Rejected: it adds
vocabulary for zero callers — the one consumer wants today included, nothing wants it excluded —
and the migration would touch the published OpenAPI document, both schema mirrors and the glossary
to serve a distinction nobody asked for.
