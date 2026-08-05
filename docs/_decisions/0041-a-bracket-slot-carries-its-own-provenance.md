# ADR-0041 — A bracket slot carries its own provenance, beside the team rather than inside it

**Status:** Accepted
**Date:** 2026-08-05
**Surface:** backend, frontend
**Supersedes:** —
**Superseded by:** —
**Source:** Open item BE-9, whose subject was the "TBD" placeholder team and whose stated hard part
was not the nullability but where the bracket slot label would live once the reference could be null.

## Context

An unresolved playoff opponent was a **real `teams` document** named "TBD" carrying
`is_placeholder: true`, with a `saison_teams` junction row per season. It worked, and it cost in four
places: the junction row nothing prompted anyone to create, whose absence dropped the placeholder out
of that season's team queries because the join is strict; a two-character shorthand `"??"` invented for
a non-team; an exemption in `PATCH /teams/{team_id}`; and a free-text mechanism in the edit form so
each bracket slot could read something other than "TBD".

**The measurement that constrained the answer.** On 2026-08-02, matches 29, 30 and 31 held
`team1.name` values reading `"Sieger 25."`, `"Sieger 26."` and `"Sieger 29."` while the `teams`
document all three referenced read `"TBD"`. The embedded field was doing double duty: a display copy of
`teams.name` on every other match, and a bracket slot label on those three — a label that existed
nowhere else in the database. Nulling the reference deletes it, so "make the reference nullable" is
only half a decision.

That double duty had already forced a hole in an invariant.
[ADR-0028](0028-store-what-was-true-then-derive-what-is-true-now.md) rule 3 obliges the endpoint that
can change a source to fan a rename into every embedded copy of it — and `patch_team` had to read the
team document first, purely to decide whether it was allowed to write `team1.name`, because for one
club that field held something a fan-out would destroy.

Two further constraints were already in force:

- **A `$jsonSchema` validator may assert types, presence and enums and nothing else**
  ([ADR-0027](0027-the-database-enforces-its-own-invariants.md)), so no cross-field rule about these
  fields can live in the database. Matches are still hand-created in Compass, so a rule enforceable
  only in Pydantic fails on **read**, which takes a public page down rather than refusing a bad write.
- **The Zod mirror is compared against the published document on nullability**
  ([ADR-0040](0040-the-zod-mirror-is-checked-against-the-published-document.md)), which names this
  exact edit as the case it was proved against.

## Decision

**Model the unknown opponent as absent, and give the slot label its own field beside the team.**

```python
class FLSpiel(BaseModel):
    team1: FLSpielTeamField | None
    team2: FLSpielTeamField | None
    team1_herkunft: str | None
    team2_herkunft: str | None
```

**`herkunft` is provenance, not a placeholder.** It answers "where does this side of the fixture come
from", which is a fact about the **fixture** — so it is set when the bracket is drawn, it stays true
once the winner is written into the slot, and it is never derived and never fanned out into.

**Nothing pairs the two fields, and no rule may be added to.** All four combinations are meaningful:

| `team1` | `team1_herkunft` | Means                                             |
| ------- | ---------------- | ------------------------------------------------- |
| set     | null             | An ordinary group-phase fixture                   |
| set     | set              | A resolved bracket slot — the winner of match 25  |
| null    | set              | An unresolved bracket slot — "Sieger 25."         |
| null    | null             | An opponent nobody has entered yet — "Noch offen" |

**Every reader takes the team's own text first, then the `herkunft`, then `PLACEHOLDER.slot`**, and
branches on nothing else. `fl_frontend/src/features/spiele/components/ui/SpielTeamSlot.tsx` is that
rule for the three match cards, which stay separate ([ADR-0007](0007-three-spiel-cards-stay-separate.md)).

**The placeholder team and `is_placeholder` are deleted outright**, along with
`include_placeholders`, the `"??"` shorthand and the `patch_team` exemption. The rename fan-out is now
unconditional, because no path under `team1.` or `team2.` can reach a provenance label.

## Consequences

**Two nullable fields per side rather than one.** Four fields describe two slots, and nothing
structurally forbids a label beside a resolved team — which under the provenance reading is the
second row of the table above rather than a defect, and is why no validator polices it.

**The placeholder team is HARD deleted, and its junction rows with it.** That reverses neither
[ADR-0032](0032-soft-deletion-is-a-date-not-a-flag.md) nor
[ADR-0033](0033-one-active-season-and-one-path-to-it.md), and the distinction is worth stating.
Soft deletion exists because `spiele` embeds and references what it points at; after the migration
below, nothing references this document. `inactive_since` means "the day this **club** left the
league", and the placeholder was never a club. ADR-0033 forbids a DELETE **endpoint** on
`saison_teams`; a one-off hand operation is not an endpoint, and no endpoint is added.

**A three-step production change, and the order is load-bearing.** No migration tooling is added —
ADR-0032 settled that a one-off ships as a runbook rather than as a permanent file with one day's
purpose. The two halves pull in opposite directions:

1. **Before the deploy**, seed `teamN_herkunft` as null across `spiele` and lift each placeholder
   slot's label out of `team1.name`. The running image ignores unknown keys. Skipping this leaves the
   new `FLSpiel` unable to parse a document that lacks the key, and `GET /spiele` takes the site down.
2. **Deploy.** `python -m app.core.constraints --check` reports exactly what step 1 missed.
3. **After the deploy**, null the placeholder references, delete its junction rows and the team, and
   `$unset` `is_placeholder`.

Nulling `team1` in step 1 would break the deployed image's read of every match, which is why it is not
there.

**The `herkunft` fields are required, with no Pydantic default.** A default would let a document that
has never carried the key read as null, which is precisely the state step 1 exists to remove — and the
step could then be skipped with nothing to say so.

**It discharges ADR-0028's open obligation without reversing it.** Rules 1 to 4 all still hold; what
changes is that rule 3's fan-out no longer has an exception, because the field it fans into now holds
one kind of thing.

**FB-4's auto-advance is unblocked and unconstrained.** Writing a winner into the next match's slot is
now an ordinary write to a nullable field, and the slot keeps saying where its occupant came from.

## Alternatives considered

**A discriminated union — `team1: FLSpielTeamField | FLSpielSlotOffen`.** Cleaner in type theory: two
states, illegal states unrepresentable, no combination to explain. Rejected on three counts. It needs a
discriminator on every stored team field, so every match document is rewritten rather than extended.
`$jsonSchema` cannot express a `oneOf` within ADR-0027's boundary, so the third copy of the schema
would stop covering this shape at exactly the point it became structural. And it is the wrong sum:
"where this side comes from" is not the opposite of "which team it is" but an independent fact that
outlives the union's own discriminator.

**A structural reference — `{spiel_nr: 25, ausgang: "sieger"}`, with the German label derived.**
Strictly more informative, and it is what an auto-advance workflow would query. Rejected because it can
express only a slot fed by an earlier **match**, and open item FB-4 has not decided whether the
quarter-finals are fed by matches or by group placings (A1 vs B2) — a shape this cannot represent at
all. Choosing it here would answer FB-4's question by accident. It can be added beside `herkunft`
once that item is worked; nothing in this decision blocks it.

**Keep one field per side and nullify its contents** — `team_id: ObjectId | None`,
`shorthand: str | None`, with `name` still carrying the label. The smallest diff, and it keeps every
consumer reading `team1.name`. Rejected because that last property is the problem rather than the
benefit: it is precisely what stops the type checker finding the consumers. Under `strict: true` a
nullable `team1` makes every `.name`, `.team_id` and `.shorthand` access a compile error until it is
handled, which is the sweep ADR-0040 records as having no other net. It also leaves `name`'s
`min_length=1` demanding text for a side with no team — which is how "TBD" came to be stored in the
first place — and leaves an object called "team" describing something that is not one.

**Leave the placeholder team and only fix the junction-row omission.** Rejected: it treats the symptom
that was cheapest to see. The missing row is one of four costs, and the other three — the invented
shorthand, the fan-out exemption and the form's special case — all follow from the same lie.
