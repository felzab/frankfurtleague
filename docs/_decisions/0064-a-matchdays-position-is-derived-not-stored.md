# ADR-0064 — A matchday's position and name are derived, not stored

**Status:** Accepted
**Date:** 2026-08-07
**Surface:** backend, frontend
**Supersedes:** —
**Superseded by:** —
**Source:** My correction of 2026-08-07, reviewing FB-6's matchday surface: `order_val`
existed only so `SpielplanView` had something to order by, it should not be reachable by an admin,
reordering should not be possible, and it starts at 0, which reads wrongly in the interface. The
follow-up review of 2026-08-08 — "what else on here is not a fact about this matchday?" — removed
the stored name by the same argument (retired number 0067 recorded that half separately).

## Context

`spieltage.order_val` was a required non-negative integer on the document, on both write payloads, in the
`$jsonSchema` validator, and the default `sort_by`. Nine source comments and five documents asserted the
same justification: **the bracket orders by `order_val`, not by date, because matchdays routinely share
dates.**

**Read against the code, that justification was wrong in both halves.**

The bracket does not read the field. `order_val` appears nowhere in `fl_backend/app/api/spiele/`.
`fl_backend/app/api/spiele/services.py :: resolve_bracket` builds `by_nr` from `spiel_nr` and follows
`teamN_quelle`; `find_wiring_refusal` ranks phases through `PHASE_RANK`.
[ADR-0042](0042-a-result-entry-resolves-the-whole-bracket.md) says so outright — "`spieltage.order_val`
orders the rounds and says nothing about who feeds whom." What actually depends on the ordering is one
frontend derivation, `fl_frontend/src/features/spieltage/utils.ts :: orderRoundsByWiring`, which anchors on
the **last** round of the arrival order and walks backwards; `PlayoffsView` then draws its columns from
that. So the ordering is load-bearing for a bracket's **presentation**, not its topology.

And matchdays do not share dates. The live 2026 season's six matchdays begin 07.03, 18.04, 13.05, 12.06,
21.08 and 04.09 — six distinct, non-overlapping dates, already in the sequence `order_val` 0–5 encoded.
What shares dates is the **matches inside** a matchday, which is a different collection and a different
sort. The claim had been copied across nine comments without anyone re-deriving it.

**What the stored field cost, meanwhile, was real.** Nothing made it unique: no validator sees two
documents ([ADR-0027](0027-the-database-enforces-its-own-invariants.md)), and a unique index would forbid a
season from having two matchdays at all once positions repeat across seasons. So two matchdays could hold
one position and sort against each other arbitrarily, and the only report was a page marking the collision
while somebody was looking at it. It also permitted the mirror-image defect that no marker caught: a
Halbfinale at a lower number than the Viertelfinale it follows is legal, orders wrongly, and looks tidy.

**`spieltage.name` had the same shape**: a required string, set by whoever created the matchday, carrying
no information the document did not already hold. A matchday's name is one of exactly two things. A
group-phase matchday is its ordinal — the first, the second — and the ordinal is its place in the order
this decision derives. A knockout matchday is its round, and the round is `saison_phase`, already on the
document and already enumerated. So the stored name restated two fields, in prose, in a place nothing
reconciled with them. Both ways of disagreeing were reachable, and neither is a hypothetical class of
typo — the name was free text on a create form, and the phase was a select beside it:

- **Two matchdays could share a name.** Nothing was unique about it, so a season could hold two
  "3. Spieltag" and a reader had no way to tell which fixtures belonged to which.
- **A name could contradict its own phase.** A matchday called "Finale" could sit in the
  `gruppenphase`, because the two fields were written independently and neither was checked against
  the other.

The stored name was also load-bearing in a place it should never have been: the first version of the
derived order used it as the final tie-break, which is circular — the name a reader sees is composed
_from_ the order, so ordering by it orders a season by a value that only exists because the order does.

## Decision

### The position

**A matchday's position is derived, and no field holds one.** `order_val` is removed from `FLSpieltag`,
from `FLPostSpieltagPayload`, from `FLPatchSpieltagPayload`, from the `spieltage` `$jsonSchema` validator,
from the `sort_by` options, from the Zod mirror and from `openapi.json`.

**The order is `saison_phase` in bracket order, then `beginn`, then `_id`**, expressed once in
`fl_backend/app/api/spieltage/services.py :: order_spieltage`. Every one of those is a field that
already has to be right for another reason, so the order cannot drift from the data — there is nothing
separate to keep in step.

**The phase leads, and that is the correctness half.** Ordering by date alone would let a knockout round
dated before a group matchday render ahead of it. Leading with the phase makes that display impossible
rather than merely unlikely, which is the defect the stored field permitted in the other direction and
never reported.

**The final tie-break is `_id`, because the order must be total.** Two matchdays in one phase on one
date is a state nothing refuses, and an order that is not total lets two reads disagree — which on the
public Spielplan means the tabs move between reloads. The id is unique and stable, so the order stays
total, and it is the only candidate that is not itself composed from the order.

**`PHASE_RANK` moves to `fl_backend/app/api/spiele/schemas.py`, beside the `Literal` it ranks.** Two rules
now read it and neither is presentation: `find_wiring_refusal` needs "strictly earlier" to refuse a feeder
played too late, and `order_spieltage` needs a total order over the phases. One declaration beside the set
is what keeps a fifth phase from being added to one and not the other.

**The ordering runs in Python, after the read.** A `$sort` on `saison_phase` orders the four values
lexically — finale, gruppenphase, halbfinale, viertelfinale — which is not the order they are played in, and
a plain `find` has no stage to compute a rank in. The Mongo sort still approximates the natural order
(`beginn`, then `_id`) so `limit` selects the right prefix.

**`sort_by=natural` is the default and the explicit alternatives stay.** A caller may genuinely want a
date or a size ordering; none of them is what a bracket reads, and the default is the one that is.

**The admin surface offers no position and no reordering.** The create dialog opens with nothing
preselected, the edit dialog has one fewer field, and both say which fields decide the placement — moving a
matchday is editing its date. What the list renders instead is an **ordinal**: the row's 1-based place within
its phase section, counted per render from the order the API returned. It is 1-based because it is a
position a person reads rather than an index a program uses, and it can never be wrong, because it is
counted from the arrangement it labels.

### The name

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

### The retired keys on live documents

**Live documents keep `order_val` and `name` harmlessly, and that is not a migration the deploy waits
on.** Pydantic's default `extra="ignore"` drops an unknown key and `additionalProperties` is never
`false` in these validators, so a document still carrying either validates on both layers and the values
are ignored. Cleaning them up is `db.spieltage.updateMany({}, {$unset: {order_val: "", name: ""}})`
whenever convenient — **after** the deploy, while no image requiring the fields is live.

## Consequences

**Six ordering defects stop being possible, and one report becomes unnecessary.** A duplicate position, a
gap, a negative value, a phase out of sequence, a matchday whose number contradicts its date, and a
reordering that renumbered one document and not its neighbour — none has a state to occupy now. The
collision marker `AdminSpieltageList` carried, and frontend invariant I27 which described it, both go with
them.

**Two matchdays can no longer share a name, and a name can no longer contradict its phase** — not because
a rule refuses either, but because neither state is expressible.

**The ordering gains its first tests.** With the value written by hand there was nothing to assert but its
type, and `fl_backend/tests/api/test_reference_models.py` asserted exactly that. `TestSpieltageOrder` in
`fl_backend/tests/api/test_filter_builders.py` now covers the phase order, the phase outranking the date,
the date ordering within a phase, the `_id` tie-break on a shared phase and date, and that the function
does not mutate its input; `fl_backend/tests/api/test_schedule.py` pins that every member of the phase
`Literal` has a rank.

**Two tests guard the absences.** `test_carries_no_stored_position` asserts `order_val` is not a field of
`FLSpieltag` and that a document still carrying it validates without gaining one; `test_carries_no_name`
does the same for `name`. A stored position is the shape this model is most likely to grow back, and an
absence looks identical to an omission.

**`FLSpieltag` and its validator lost the fields together, which a test forced.**
`fl_backend/tests/core/test_constraints.py :: MIRRORED_MODELS` requires the model and the `$jsonSchema` to
declare the same field set ([ADR-0031](0031-the-third-copy-of-the-schema-is-checked-not-generated.md)), so
the two could not drift apart across this change even by accident.

**The bracket's column order is now derived from data the bracket also validates.** `orderRoundsByWiring`
still anchors on the last round of the arrival order, and that order is now `PHASE_RANK` — the same mapping
`find_wiring_refusal` uses to refuse a feeder that is not played first. A season whose wiring the write path
accepts is a season whose columns order correctly, which was not previously true of a hand-set number.

**Five surfaces read the composed label**: the admin matchday list, the retire dialog, the public
Spielplan's tabs, the public bracket's column headers, and the admin wiring review. The last two take it
from the **played** order rather than from `orderRoundsByWiring`'s output, which rearranges rounds by the
bracket's wiring — a matchday's ordinal is its place in its phase, not its place in a column.

**Creating a matchday is entering the phase and the dates, and nothing else.** Which is also what makes
"a matchday in the wrong place" a phase or a date that is wrong, and nothing else.

**A matchday is now described entirely by facts about that matchday**: its season, its phase, its dates,
its derived match count, its retirement. The position (here), the match count
([ADR-0065](0065-a-seasons-schedule-is-derived-from-its-rules.md)) and the name (here) all left the
document for the same reason — each was a statement about the matchday's neighbours or a restatement of
its other fields, which is what made them different in kind from everything they sat beside.

## Alternatives considered

**Keep the field stored and assign it on create from `(phase, beginn)`.** No migration, no live-data change,
and the admin never sees it. Rejected: a stored derivation is a cache with no invalidation, so editing a
matchday's date would leave the position it was derived from behind, and the next reader would have to be
told why a field exists that nothing may write.

**Keep the field and fix only the UI** — drop the control and the collision marker, leave the backend
untouched. The smallest change, and rejected as the one that leaves the trap loaded: the field would stay
writable through the API, still unconstrained, still asserting in nine comments that the bracket depends on
it.

**Order by `beginn` alone and drop the phase from the key.** Simpler, and it reproduces the correct order for
every season anyone has entered. Rejected because it makes the wrong display possible for a season somebody
enters carelessly, and the phase is free — it is already on the document and already ranked.

**Order by `spiel_nr` of the matchday's first fixture.** Tempting, since `spiel_nr` is unique within a season
and already the bracket's own iteration order. Rejected: a matchday with no fixtures entered yet has no
first fixture, which is exactly the state a season being set up is in, and the order would then depend on
data the admin has not created.

**A bulk reorder endpoint, so positions could be dragged.** ADR-0063 declined this while the field existed;
with the field gone there is nothing to reorder, and a drag would have to write dates — which the edit dialog
already does, one matchday at a time, with the date visible.

**Keep the stored name and add a refusal that checks it against the phase.** Rejected: it makes the two
agree at write time and does nothing about the copy that already exists, and it spends a rule on keeping a
derivable value honest. A field that must be checked against another field is a field that should have
been the other field.

**Derive the name on the backend and serve it as a read-only response field.** This is the shape ADR-0065
took for `anzahl_spiele`, so it deserved a real answer. Rejected because the two values are different
kinds of thing: a match count is arithmetic, identical in every language, and the label is German display
text. Serving it would put a German vocabulary in a backend that has none and would make the API the place
a wording change is made. ADR-0042 already drew that line for `quelle`, and drawing it differently here
would leave the app deriving one label in each codebase.

**Compose the label per row in each component, rather than once per season.** Rejected: the `(1)`/`(2)`
suffix depends on the whole phase, so a per-row derivation is wrong on the first row it meets.
`spieltagLabels` exists because that constraint is real, not because one pass is tidier.

**Keep the name as the order's tie-break and derive only the display.** Rejected as circular, and it is the
clearest statement of why the field had to go: the order produces the name, so the name cannot produce the
order.

**Leave the nine comments asserting the old justification and add a tenth correcting them.** Rejected under
the documentation standard's rule that a document states the final position rather than appending a
correction below text that still says the old thing.
