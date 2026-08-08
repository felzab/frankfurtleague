# ADR-0067 — A matchday's name is composed by the reader, not stored beside it

**Status:** Accepted
**Date:** 2026-08-08
**Surface:** backend, frontend
**Supersedes:** —
**Superseded by:** —
**Source:** The owner's review of the matchday document, 2026-08-08, immediately after
[ADR-0064](0064-a-matchdays-position-is-derived-not-stored.md) and
[ADR-0065](0065-a-seasons-schedule-is-derived-from-its-rules.md) removed the position and the match count
from it: what else on here is not a fact about this matchday?

## Context

`spieltage.name` was a required string, set by whoever created the matchday, and it carried no information
the document did not already hold.

A matchday's name is one of exactly two things. **A group-phase matchday is its ordinal** — the first, the
second — and the ordinal is its place in the order the backend already returns
([ADR-0064](0064-a-matchdays-position-is-derived-not-stored.md)). **A knockout matchday is its round**, and
the round is `saison_phase`, already on the document and already enumerated. So the stored name restated
two fields, in prose, in a place nothing reconciled with them.

Nothing held the two consistent, and both ways of disagreeing were reachable:

- **Two matchdays could share a name.** Nothing was unique about it, so a season could hold two "3.
  Spieltag" and a reader had no way to tell which fixtures belonged to which.
- **A name could contradict its own phase.** A matchday called "Finale" could sit in the `gruppenphase`,
  because the two fields were written independently and neither was checked against the other.

Neither is a hypothetical class of typo: the name was free text on a create form, and the phase was a
select beside it.

**It was also load-bearing in a place it should never have been.** ADR-0064's derived order used the name
as its final tie-break, which is circular — the name a reader sees is composed _from_ the order, so
ordering by it orders a season by a value that only exists because the order does.

## Decision

**`spieltage` stores no name.** The field leaves `FLSpieltag`, both write payloads, the `$jsonSchema`
validator, the Zod mirror, the create and edit forms, the search keys and `openapi.json`.

**The label is composed on the frontend**, by `fl_frontend/src/features/spieltage/utils.ts :: spieltagLabel`,
from the phase and the matchday's 1-based place within that phase.
[ADR-0042](0042-a-result-entry-resolves-the-whole-bracket.md) set the precedent: a bracket reference carries
no label either, and what a card shows is derived where it is shown. The backend has no German vocabulary
for the phases and gains none for this.

**The composition has three cases, and the third is why it is not a lookup table:**

| The matchday                                    | Reads               |
| ----------------------------------------------- | ------------------- |
| Group phase                                     | `1. Spieltag`       |
| A knockout round the season plays once          | `Viertelfinale`     |
| A knockout round split across several matchdays | `Viertelfinale (1)` |

Four quarter-finals over two dates are two matchdays, and a reader has to be able to tell them apart. The
suffix appears only where it distinguishes something.

**`spieltagLabels` computes the whole season in one pass**, because the third case depends on how many
matchdays the phase holds — a per-row computation cannot know that on the first row, and would either be
wrong there or re-scan the list once per row.

**The order's final tie-break is `_id`.** The removal forces it and it is what the tie-break should always
have been: the id is unique and stable, so the order stays total. Total is what it has to be — nothing
refuses two matchdays in one phase on one date, and two reads that disagreed would move the public
Spielplan's tabs between reloads.

## Consequences

**A matchday is now described entirely by facts about that matchday**: its season, its phase, its dates,
its retirement. Together with ADR-0064 and ADR-0065 this is the third value to leave the document for the
same reason, and the last hand-maintained one.

**Two matchdays can no longer share a name, and a name can no longer contradict its phase** — not because
a rule refuses either, but because neither state is expressible.

**Five surfaces read the composed label**: the admin matchday list, the retire dialog, the public
Spielplan's tabs, the public bracket's column headers, and the admin wiring review. The last two take it
from the **played** order rather than from `orderRoundsByWiring`'s output, which rearranges rounds by the
bracket's wiring — a matchday's ordinal is its place in its phase, not its place in a column.

**The create form lost a field and gained nothing.** Entering the phase and the dates is now the whole of
creating a matchday, which is also what makes "a matchday in the wrong place" a phase or a date that is
wrong, and nothing else.

**Live documents keep the retired key harmlessly.** Pydantic's `extra="ignore"` drops it, and no validator
sets `additionalProperties: false` ([ADR-0027](0027-the-database-enforces-its-own-invariants.md)).
`db.spieltage.updateMany({}, {$unset: {name: ""}})` is cleanup whenever convenient — **after** the deploy,
because a currently-live older image still requires the field.

## Alternatives considered

**Keep the field and add a refusal that checks it against the phase.** Rejected: it makes the two agree at
write time and does nothing about the copy that already exists, and it spends a rule on keeping a
derivable value honest. A field that must be checked against another field is a field that should have
been the other field.

**Derive it, but on the backend, and serve it as a read-only response field.** This is the shape ADR-0065
took for `anzahl_spiele`, so it deserved a real answer. Rejected because the two values are different
kinds of thing: a match count is arithmetic, identical in every language, and the label is German display
text. Serving it would put a German vocabulary in a backend that has none and would make the API the place
a wording change is made. ADR-0042 already drew that line for `quelle`, and drawing it differently here
would leave the app deriving one label in each codebase.

**Compose it per row in each component, rather than once per season.** Rejected: the `(1)`/`(2)` suffix
depends on the whole phase, so a per-row derivation is wrong on the first row it meets. `spieltagLabels`
exists because that constraint is real, not because one pass is tidier.

**Keep the name as the order's tie-break and derive only the display.** Rejected as circular, and it is the
clearest statement of why the field had to go: the order produces the name, so the name cannot produce the
order.
