# ADR-0064 — A matchday's position is derived from what it is, not stored beside it

**Status:** Accepted
**Date:** 2026-08-07
**Surface:** backend, frontend
**Supersedes:** —
**Superseded by:** —
**Source:** The owner's correction of 2026-08-07, reviewing FB-6's matchday surface: `order_val` existed
only so `SpielplanView` had something to order by, it should not be reachable by an admin, reordering
should not be possible, and it starts at 0, which reads wrongly in the interface.

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

## Decision

**A matchday's position is derived, and no field holds one.** `order_val` is removed from `FLSpieltag`,
from `FLPostSpieltagPayload`, from `FLPatchSpieltagPayload`, from the `spieltage` `$jsonSchema` validator,
from the `sort_by` options, from the Zod mirror and from `openapi.json`.

**The order is `saison_phase` in bracket order, then `beginn`, then `name`**, expressed once in
`fl_backend/app/api/spieltage/services.py :: order_spieltage`. Every one of those three is a field that
already has to be right for another reason, so the order cannot drift from the data — there is nothing
separate to keep in step.

**The phase leads, and that is the correctness half.** Ordering by date alone would let a knockout round
dated before a group matchday render ahead of it. Leading with the phase makes that display impossible
rather than merely unlikely, which is the defect the stored field permitted in the other direction and
never reported.

**The name is the final tie-break, and it is not decoration.** Two matchdays in one phase on one date is a
state nothing refuses, and an order that is not total lets two reads disagree — which on the public
Spielplan means the tabs move between reloads.

**`PHASE_RANK` moves to `fl_backend/app/api/spiele/schemas.py`, beside the `Literal` it ranks.** Two rules
now read it and neither is presentation: `find_wiring_refusal` needs "strictly earlier" to refuse a feeder
played too late, and `order_spieltage` needs a total order over the phases. One declaration beside the set
is what keeps a fifth phase from being added to one and not the other.

**The ordering runs in Python, after the read.** A `$sort` on `saison_phase` orders the four values
lexically — finale, gruppenphase, halbfinale, viertelfinale — which is not the order they are played in, and
a plain `find` has no stage to compute a rank in. The Mongo sort still approximates the natural order
(`beginn`, then `name`) so `limit` selects the right prefix.

**`sort_by=natural` is the default and the three explicit alternatives stay.** A caller may genuinely want a
date or a size ordering; none of them is what a bracket reads, and the default is the one that is.

**The admin surface offers no position and no reordering.** The create dialog opens with nothing
preselected, the edit dialog has one fewer field, and both say which fields decide the placement — moving a
matchday is editing its date. What the list renders instead is an **ordinal**: the row's 1-based place within
its phase section, counted per render from the order the API returned. It is 1-based because it is a
position a person reads rather than an index a program uses, and it can never be wrong, because it is
counted from the arrangement it labels.

**The live documents keep their retired key, and that is not a migration the deploy waits on.** Pydantic's
default `extra="ignore"` drops an unknown key and `additionalProperties` is never `false` in these
validators, so a `spieltage` document still carrying `order_val` validates on both layers and the value is
ignored. Cleaning it up is `db.spieltage.updateMany({}, {$unset: {order_val: ""}})` whenever convenient —
**after** the deploy, because the currently-live image still requires the field.

## Consequences

**Six ordering defects stop being possible, and one report becomes unnecessary.** A duplicate position, a
gap, a negative value, a phase out of sequence, a matchday whose number contradicts its date, and a
reordering that renumbered one document and not its neighbour — none has a state to occupy now. The
collision marker `AdminSpieltageList` carried, and frontend invariant I27 which described it, both go with
them.

**The ordering gains its first tests.** With the value written by hand there was nothing to assert but its
type, and `fl_backend/tests/api/test_reference_models.py` asserted exactly that. `TestSpieltageOrder` in
`fl_backend/tests/api/test_filter_builders.py` now covers the phase order, the phase outranking the date,
the date ordering within a phase, the name tie-break, that the function does not mutate its input, and that
every member of the phase `Literal` has a rank.

**One test now guards the absence.** `test_carries_no_stored_position` asserts `order_val` is not a field of
`FLSpieltag` and that a document still carrying it validates without gaining one. A stored position is the
shape this model is most likely to grow back, and an absence looks identical to an omission.

**`FLSpieltag` and its validator lost a field together, which a test forced.**
`fl_backend/tests/core/test_constraints.py :: MIRRORED_MODELS` requires the model and the `$jsonSchema` to
declare the same field set ([ADR-0031](0031-the-third-copy-of-the-schema-is-checked-not-generated.md)), so
the two could not drift apart across this change even by accident.

**The bracket's column order is now derived from data the bracket also validates.** `orderRoundsByWiring`
still anchors on the last round of the arrival order, and that order is now `PHASE_RANK` — the same mapping
`find_wiring_refusal` uses to refuse a feeder that is not played first. A season whose wiring the write path
accepts is a season whose columns order correctly, which was not previously true of a hand-set number.

**A matchday is now fully described by facts about the matchday.** Name, dates, phase, expected match count,
season, retirement. Nothing on it is a statement about its neighbours, which is what made a position
different in kind from every other field it sat beside.

**The same argument reached `anzahl_spiele`, and [ADR-0065](0065-a-seasons-schedule-is-derived-from-its-rules.md)
acts on it.** A single round robin per group fixes how many matches a matchday of a given phase holds, so
what looked like an intention is arithmetic over the season's rules. That decision removes the last
hand-maintained value from this document, which leaves a matchday described entirely by facts about the
matchday.

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

**Leave the nine comments asserting the old justification and add a tenth correcting them.** Rejected under
the documentation standard's rule that a document states the final position rather than appending a
correction below text that still says the old thing.
