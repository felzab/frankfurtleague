# ADR-0059 — A disqualification is a record, and its absence is the null

**Status:** Accepted
**Date:** 2026-08-07
**Surface:** backend, frontend
**Supersedes:** —
**Superseded by:** —
**Source:** Open item FB-2, the owner's item of 2026-08-02: find a way to handle disqualifications
properly, recording the reason and the date rather than only the fact.

## Context

`saison_teams.is_disqualified` was a bare boolean, and a boolean is the whole of what the system could
say about a team leaving a season. That is a narrower answer than the question deserves, because
disqualification is the **only** way out: [ADR-0033](0033-one-active-season-and-one-path-to-it.md)
settles that a team never leaves a season and the junction has no `DELETE`, so this one field carries
every departure the competition can express.

Four constraints were already fixed before this decision, and together they left less room than the
question suggests:

- **There is exactly one place to put it.** A disqualification is season-scoped by definition and there
  is one per team per season, so a separate collection buys a join and nothing else at sixteen junction
  rows. The structure review took that on 2026-08-02.
- **Nothing may hold a second copy.**
  [ADR-0028](0028-store-what-was-true-then-derive-what-is-true-now.md) rule 4 makes this field joined
  into `FLSpiel` rather than denormalised into it, precisely because it changes during a season. So
  whatever the junction stores is what every reader reads, and there is no fan-out to forget.
- **The database can assert types, presence and enums, and nothing else**
  ([ADR-0027](0027-the-database-enforces-its-own-invariants.md)). An enum is the only lever a
  `$jsonSchema` validator has over a field's contents.
- **The audit trail is somebody else's item.** Open item BE-15 owns who changed what and when. A reason
  and a date describe the current state; they are not a history, and this decision does not pretend
  otherwise.

**The league publishes no disciplinary code.** Its rules are four sentences of FAQ copy in
`fl_frontend/src/features/meta/constants.ts :: QA_QUESTIONS` — eleven-a-side, two halves of 45 minutes,
neutral referees where possible, and squads drawn only from the school's own Abijahrgang. One offence
category can be grounded in that text. The rest would have to be invented.

## Decision

**`saison_teams.disqualifikation` holds the whole record, and `null` is what "not disqualified"
means.** Two keys, both required when the object is present:

| Key     | Holds                                                                        |
| ------- | ---------------------------------------------------------------------------- |
| `grund` | Why, as free text, written for publication and rendered as authored          |
| `datum` | The day the disqualification took effect, `YYYY-MM-DD` like every other date |

**There is no boolean anywhere** — not on the document, not on `FLTeam`, not in the Zod mirror. A team
is disqualified exactly when the field is not null. This is
[ADR-0032](0032-soft-deletion-is-a-date-not-a-flag.md)'s shape applied to a second question and it is
adopted for the same reason: a flag beside a record is the one arrangement with a state the database
cannot refuse, because `$jsonSchema` sees one document at a time and cannot say that two of its fields
must agree.

**`grund` is public.** It is served on `FLTeam`, which the frontend renders on public pages, and it is
written knowing that — the same trust this system already places in `teams.description`. FE-3's note on
disqualified teams renders it as authored: never truncated to a label, never parsed for a category it
does not carry.

**`GET /teams?is_disqualified=` stays a boolean, and is a question rather than a field.**
`build_team_pipeline` translates it into a null test against the junction. Nobody filters a list by the
wording of a reason, so the parameter's shape is unchanged and no client has to be updated.

**`PATCH /teams/{team_id}/saisons/{saison_id}` takes the record whole**, and `null` is how a
disqualification is lifted. The field is required on the payload with no Pydantic default, so a form
that omits it is a 422 rather than a team quietly reinstated.

### The production data change, and the order is load-bearing

**Sixteen `saison_teams` rows, measured 2026-08-06.** `disqualifikation` is required and has no
Pydantic default, so a row that has never carried the key cannot be read at all — and `GET /teams`
serves the league table, the group grids and every team page. This follows the staged shape
[ADR-0041](0041-a-bracket-slot-carries-its-own-provenance.md) and
[ADR-0044](0044-a-shoot-out-is-its-own-scoreline.md) both used:

1. **Before the deploy**, against the live database, seed the new key and leave the old one in place:

   ```js
   db.saison_teams.updateMany({ disqualifikation: { $exists: false } }, [
     { $set: { disqualifikation: null } },
   ]);
   ```

   Filtered on `$exists: false` so it is idempotent and cannot overwrite a record already entered. The
   running image ignores unknown keys, so this is invisible until step 2. **Any team disqualified at
   this moment needs its `grund` and `datum` written by hand in the same sitting** — the boolean does
   not carry them and nothing can derive them.

2. **Deploy.** `python -m app.core.constraints --check` reports exactly what step 1 missed, and the
   validator is attached only once it reports clean.

3. **After the deploy**, `$unset` `is_disqualified`. It is last because the running image reads it
   until the moment it stops running, and `additionalProperties` is never `false` (ADR-0027), so the
   new validator tolerates the stale key until it goes.

Reversing steps 1 and 2 takes `GET /teams` down on read. Doing step 3 early takes it down on the image
that is still live. No migration tooling is added, for the reason ADR-0032 settled: a one-off that
ships as a script is a permanent file with one day's purpose.

## Consequences

**A disqualification can now be explained, and one that is entered says so everywhere at once.** The DQ
badge on the Saisontabelle and in `TeamPopoverMenu`, the picker's blocking chip, and FE-3's note all
read the same joined record, so no surface can disagree with another about whether a team is out.

**The reason is on the public wire, and that is a standing editorial obligation rather than a
mechanism.** `GET /teams` sits behind `verify_access_base`, but the frontend holds that key and renders
the result publicly, so `grund` reaches readers as typed. Nothing in the system can soften a sentence
somebody regrets, and nothing tries to.

**The database checks less than it would with an enum.** It asserts that the field is an object or
null, and that a present object has both keys as strings. It cannot check that the reason is
meaningful, and `min_length=1` on `grund` stays Pydantic's, which is the line ADR-0027 draws and
`test_no_validator_constrains_a_range_or_a_format` holds.

**The frontend reads a null test rather than a flag**, at five call sites. `tsc` located every one of
them, which is the property that made the sweep safe — a boolean renamed to another boolean would not
have.

**The drift check now reaches inside a modelless collection.** `saison_teams` still has no model of its
row and stays in `MODELLESS_COLLECTIONS`, while `FLDisqualifikation` mirrors the one sub-document that
does have one — so `test_only_the_two_junctions_are_unmirrored` compares root entries only. Without
that distinction the junction would have dropped off the list of collections whose row is unmodelled,
while the gap that list names was entirely unchanged.

**BE-15 is not closed and is not smaller.** A reason and a date state why a team is out **now**. They
do not record that it was reinstated last week, or who decided either. Lifting a disqualification
writes `null` over the record and the record is gone.

## Alternatives considered

**A closed set of reasons — `grund` as a `Literal`.** The strongest rejected option, and the one that
matches how federation administration software actually works: a sanction cites an article of the
competition's regulations, which is what makes it justifiable later. It also buys the only content
constraint a `$jsonSchema` validator can express. Rejected on two grounds. There is no code to cite, so
three of roughly five categories would be invented and the enum would document a rulebook nobody wrote.
And its failure mode is backwards: an unlisted reason needs a model change, a validator change and a
deploy **before the disqualification can be recorded at all**, which lands at the moment somebody is
trying to record an unusual event.

**A closed set plus a free-text internal note**, the note kept off `FLTeam` and reachable only through
a new `GET` on the junction. The closest scaled-down version of the textbook shape, and rejected
because it fails the consumer it exists for. A `sonstiges` disqualification renders publicly as
"Sonstiges" while the explanation sits in a field the page cannot read — so the case where a reader
most needs the reason is the case where the public page has least to say. Established practice answers
that with a **published decision summary** distinct from the internal file, which is a third text field
this league's scale does not justify.

**The full textbook artefact — a disciplinary case with an audit trail.** A coded offence, the sanction,
the deciding body, the decision date, and a history of both. Rejected as out of scope rather than
wrong: half of it is BE-15, which is opened, ranked and deliberately unscheduled, and building the
other half here would decide BE-15's shape without its analysis.

**Keep `is_disqualified` and add the record beside it.** The smallest diff, and the only option with a
state nothing can refuse: `is_disqualified: false` next to a populated record, or `true` next to a null
one. ADR-0032 rejected exactly this arrangement for `inactive_since` and the argument transfers without
modification.

**A separate `disqualifikationen` collection.** The normalised reading, and rejected on size and on
lifetime. One row per team per season is the junction's own cardinality, so a separate collection is a
join for a one-to-one relationship over sixteen rows — and `GET /teams` would gain a third lookup on
the hottest read the site has, to render a badge.
