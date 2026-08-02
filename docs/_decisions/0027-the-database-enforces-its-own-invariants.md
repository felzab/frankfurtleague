# ADR-0027 — The database enforces its own invariants

**Status:** Accepted
**Date:** 2026-08-02
**Surface:** backend, ops
**Supersedes:** —
**Superseded by:** —
**Source:** Open item DB-1, the database structure review.

## Context

Inspected against the live database on 2026-08-02, read-only:

- **No collection has a validator.** Not a `$jsonSchema`, not anything else, in any of the nine
  collections.
- **No index exists that is not `_id_`.** Nine collections, nine indexes.

Neither gap costs anything in performance and neither ever will — the whole database is about 130 KB
and a season adds roughly that much. The gap costs correctness, and it has already been paid.

**Three of the four reference resources are edited directly in MongoDB.** `saisons`, `spieler` and
`spieltage` have no write endpoints at all (BE-4); squads and matchdays are maintained in Compass.
Hand-editing is therefore not an exception to the write path, it _is_ the write path, and it will
remain so until BE-4 is built — a work package away. The Pydantic models constrain what is **read**,
so a bad value written by hand is discovered when a page fails to parse it.

That is not hypothetical. Two `saison_spieler` rows carry `team_id: "Lessing-Gymnasium"` — a string
where every other row carries an `ObjectId`, and it is the team's `full_name` rather than a
reference. The two players are missing from Lessing's squad page, which shows 21 of 23, and
`GET /spieler` without a `team_id` returns 422 because `FLSpieler.team_id` refuses the string.
Verified against the running backend. Nothing calls the endpoint that way today, so the failure is
latent rather than visible — one call site away from an outage nobody could explain from the code.

Four uniqueness rules are true in the data today and enforced by nothing: one `saison_teams` row per
team per season, one `saison_spieler` row per player per season, `spiel_nr` unique within a season,
and a unique team `shorthand`. Each was verified to hold; each would break silently.

## Decision

**Give the database its own constraints, and create them in code so they are versioned.**

- **`$jsonSchema` validators on every collection**, transcribed from the Pydantic models rather than
  invented: BSON types, required fields, and the enumerations that are already `Literal`s in Python
  (`saison_phase`, `gruppe`, `status`). The models are the specification; the validator is a second
  copy of it placed where hand-edits actually land.
- **Unique indexes on the four rules above**, because a `unique` index is the only mechanism in this
  system that can enforce one.
- **Both are declared in the application and applied at startup** — in `app/core/db.py`'s lifespan or
  a module it calls — never clicked into the Atlas console. A constraint that exists only in a
  dashboard is invisible to this repository, cannot be reviewed, and is lost on a cluster restore.
  This is the same argument OPS-3 makes about Cloudflare, applied before it costs anything.

Indexes added **for query performance are explicitly out of scope**. At this size they would be
theatre, and an index that exists for no measured reason is a maintenance obligation with no payer.

## Consequences

**What it costs.**

- A third place where the schema is written, after Pydantic and the Zod mirror. F2 already records
  hand-mirroring as this codebase's main drift risk, and this makes it worse before BE-4 makes it
  better. Mitigated by scope: the validator asserts types, presence and closed sets — never ranges,
  formats or cross-field rules, which stay Pydantic's job and would triple the drift surface.
- **Startup gains a failure mode.** A validator or index that cannot be applied must not silently be
  skipped, and a `unique` index over data that already violates it fails to build. The two malformed
  `saison_spieler` rows must therefore be corrected _before_ this lands; that ordering is carried in
  DB-2.
- A hand-edit that the validator rejects will fail in Compass with a message about the validator
  rather than about the field. That is the intended trade — an error at write time beats a 422 weeks
  later — but it is a worse error message.

**What it enables.** The `"Lessing-Gymnasium"` class of defect becomes impossible rather than
undetected. And BE-4, when it is built, inherits a database that already enforces what its endpoints
would have to: the write path and the hand-edit converge on the same constraints instead of two
different ones.

## Alternatives considered

**Leave it, and let BE-4's write paths solve it.** Rejected on timing. BE-4 is an L, sits behind
other work, and covers only three resources — the two broken rows are in `saison_spieler`, which BE-4
would reach through a `spieler` write path that does not yet have a design. Hand-editing stays the
operating model throughout, so this defers the control past the period it is most needed.

**Unique indexes only, no validators.** Cheaper, and it enforces the four rules. Rejected because it
would not have caught the incident that motivated this: `"Lessing-Gymnasium"` is unique, well-formed
as a string, and wrong. Type enforcement is the half that mattered.

**Create them by hand in Atlas.** Faster today and rejected outright: it puts a load-bearing
constraint outside version control, where nothing reviews it, nothing restores it, and no reader of
this repository can discover it exists.

**Validate on read instead — reject malformed documents louder at the API boundary.** Rejected as a
category error. Pydantic already does this, and doing it harder converts a silent wrong answer into a
loud 500. The defect is created at write time; that is where it has to be refused.
