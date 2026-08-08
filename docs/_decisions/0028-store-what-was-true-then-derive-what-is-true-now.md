# ADR-0028 — Store what was true then; derive what is true now

**Status:** Accepted
**Date:** 2026-08-02
**Surface:** backend, frontend
**Supersedes:** —
**Superseded by:** —
**Source:** Open item DB-1. Raised by me during the review, immediately after
[ADR-0026](0026-team-statistics-are-derived-from-spiele.md): if statistics should be derived rather
than stored, what about every other place this database keeps a second copy?

## Context

A `spiel` document embeds a great deal that also lives elsewhere:

| Embedded on `spiele`                          | Also exists at                                     |
| --------------------------------------------- | -------------------------------------------------- |
| `team1.name`, `team1.shorthand` (and `team2`) | `teams.name`, `teams.shorthand`                    |
| `ort.name`, `ort.maps_link`                   | `spielorte.name`, `spielorte.maps_link`            |
| `ort.mietpreis`                               | `spielorte.default_mietpreis`                      |
| `schiedsrichter.name`                         | `schiedsrichter.name`                              |
| `schiedsrichter.payment`                      | `schiedsrichter.default_payment`                   |
| `is_disqualified` — proposed by FB-5          | `saison_teams.is_disqualified`, scoped to a season |

Read as a list, every row is the same defect ADR-0026 just removed. It is not, and treating it as one
would break things that are currently correct. Measured against the live database on 2026-08-02:

- **No name has drifted.** All 31 matches agree with their source documents on `ort.name`,
  `ort.maps_link` and `schiedsrichter.name`. The fan-out in `patch_spielort` and
  `patch_schiedsrichter` works.
- **`mietpreis` and `payment` disagree with their sources by design.** The source holds a _default_;
  the match holds what was agreed for that match. `patch_schiedsrichter`'s docstring already records
  the reason — propagating the fee "would rewrite history".
- **The embedded team fields carry information the source does not have.** Matches 29, 30 and 31
  hold `"Sieger 25."`, `"Sieger 26."` and `"Sieger 29."` where `teams.name` reads `"TBD"`. The field
  is doing double duty as a bracket slot label, which is BE-9's subject.
- **`GET /spiele` is a plain `find`**, with no aggregation pipeline at all — and it is the hottest
  read on the site, serving the landing page, every grid and the bracket.

## Decision

**Judge each duplicate by what it is a copy _of_, not by the fact that it is a copy.**

1. **A derived aggregate is never stored.** A pure function of other documents' current state has one
   right answer at any moment, so a stored copy is either equal to it or wrong. `statistik` is
   settled by ADR-0026; `spieltage.anzahl_spiele` is the same shape and is carried in DB-2.
2. **A point-in-time record is always stored, and is not a duplicate.** `ort.mietpreis` and
   `schiedsrichter.payment` record what was agreed for one match. **Never derive these, and never fan
   a source change into them.**
3. **A display copy of a current fact stays embedded, and the endpoint that can change the source
   owes it a fan-out.** `team1.name`, `team1.shorthand`, `ort.name`, `ort.maps_link` and
   `schiedsrichter.name` stay where they are.
4. **A season-scoped field that changes during a season is derived, not embedded.** So **FB-5's
   `is_disqualified` is joined from `saison_teams`**, which means `GET /spiele` becomes an
   aggregation. Do not denormalise it into the team fields.

**The obligation rule 3 creates, stated because it is currently unpaid: there is no fan-out for
teams.** Venues and referees have one; teams do not, because no endpoint can rename a team. FB-3
builds exactly that page, and a rename without a `patch_many_in_db` over `spiele` leaves every match
card showing the old name indefinitely.

## Consequences

**What it costs.**

- Rule 3 keeps a maintenance obligation alive, and it is the same class of obligation that produced
  F4: a write path that must remember to fan out, with nothing enforcing that it does. The mitigation
  is that the obligation is now written down and attached to the endpoint that owes it, rather than
  being folklore.
- Rule 4 converts `GET /spiele` from a `find` into an `aggregate` when FB-5 lands — real work on the
  most-read endpoint, to display a badge. The alternative was cheaper to build and is rejected below.
- The four rules are a judgement call each time, not a mechanical test. Someone will have to decide
  which category a new field falls into, and the categories have a genuine grey edge: a display copy
  that starts changing frequently becomes rule 4's case.

**What it enables.** The embedded team fields survive, and with them the bracket slot labels that
have no other home until BE-9 decides on nullable opponent references. And the question "should this
be normalised?" now has an answer that does not require re-deriving ADR-0026's argument.

## Alternatives considered

**Normalise everything — embed only ids, `$lookup` the rest.** The consistent-sounding position, and
rejected on three counts. It is not free: `GET /spiele` would gain four lookups where it currently
has none. It would delete the bracket slot labels, which exist nowhere else. And it would be actively
wrong for `mietpreis` and `payment`, which are not copies of anything — the "source" holds a default
the match may not have used.

**Denormalise `is_disqualified` too, and fan it out.** The consistent-with-existing-practice
position: embed the flag and update every affected match from whatever endpoint sets it, about five
lines, and `/spiele` stays a `find`. Rejected because the flag's entire purpose is to change during a
season, so the fan-out would run on the one field most likely to be forgotten, and a stale
disqualification badge is a visibly wrong answer on a public page. It also sits on the _season_
junction while `spiele` embeds season-agnostic team data, so denormalising it would put season-scoped
state into a document that has deliberately never carried any.

**Leave the whole question to FB-5 when it is worked.** Rejected because FB-2, FB-3, FB-5 and BE-9
all touch this and would each answer it separately — which is exactly the "five ad-hoc decisions"
DB-1 existed to prevent.
