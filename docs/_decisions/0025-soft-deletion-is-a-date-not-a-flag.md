# ADR-0025 — Soft deletion is a date, not a flag, and creating never revives

**Status:** Accepted\
**Date:** 2026-08-02\
**Surface:** backend, frontend\
**Supersedes:** —\
**Superseded by:** —\
**Source:** Open item BE-4, building the write path for the reference collections.

## Context

Six of the nine collections hold rows that stop being current without ever becoming safe to delete. A
venue is embedded in every match played there; a referee is embedded in every match they officiated; a
club is referenced by `spiele.team1.team_id`; a matchday is referenced by `spiele.spieltag_id`. Nothing
cascades, so a hard delete orphans history that the public site renders.

Two collections already carried a boolean `is_inactive` for this — `spielorte` and `schiedsrichter` —
and the four collections gaining a write path in BE-4 needed the same idea: `teams`, `spieler`,
`saison_spieler`, `spieltage`.

**The boolean is where the problem starts.** "Retired" is a fact with a time. Once a retirement is a
thing the system can express, three questions follow immediately and a boolean answers none of them:
when did this stop being current, may it be purged yet, and what does the admin list show beside the
name. A flag _plus_ a date — the shape most codebases arrive at — is strictly worse, because the two
can disagree (`is_inactive: false` beside `inactive_since: "2026-03-01"`) and **no `$jsonSchema`
validator can express that they must not**. ADR-0020 put cross-field rules out of the validators' scope
deliberately, so this would be an invariant with nothing enforcing it, on nine collections.

The second question the write path forced is what `POST` does when the resource already exists and is
retired. It is tempting to make create idempotent: look up the natural key, and if a retired row holds
it, revive it instead of failing. For `teams` the natural key is `shorthand`, two letters, held by
`uniq_shorthand` whether the club is retired or not.

**That reading is unrecoverable when it is wrong.** Two letters cannot distinguish _the same club
returning_ from _a different club wanting two letters the retired one still holds_. Guess wrong and the
new club inherits the old one's `_id`, which means every historical match embedding the old name now
points at the new club — silently, across matches nobody will re-read.

## Decision

**`inactive_since` is a nullable `YYYY-MM-DD` string. There is no boolean anywhere.** Present and
required on `spielorte`, `schiedsrichter`, `teams`, `spieler`, `saison_spieler` and `spieltage`; `null`
means current, a date means retired on that date. `DELETE /{resource}/{id}` sets it to the German
current date; the field is on no payload, so a client cannot set or clear it directly.

**Reviving is its own operation: `POST /{resource}/{id}/reactivate`**, which clears the field. It takes
an id, so it cannot guess. Creating is always a plain insert, and a natural-key collision comes back
**409** from the `DuplicateKeyError` handler rather than resolving itself.

Three collections are deliberately outside this:

- **`saisons`** — `status: past` is what "gone" means for a season, and a season is never deleted at
  all. See [ADR-0026](0026-one-active-season-and-one-path-to-it.md).
- **`saison_teams`** — a team never leaves a season once squads are settled; the only way out is
  disqualification ([ADR-0026](0026-one-active-season-and-one-path-to-it.md)). The junction has a POST
  and a PATCH and no DELETE.
- **`spiele`** — a match that did not happen is `is_canceled`, which is a fact about the match rather
  than about the row.

## Consequences

**Every default read filters on it, and every admin list can opt in.** `include_inactive` on the list
endpoints is what an admin picker uses to show a retired venue beside a live one, and the public reads
never pass it.

**A retired row keeps its slot in the unique index, and that is correct.** `uniq_shorthand` keeps
indexing a retired club, so its two letters stay reserved — which is exactly why creating a club whose
shorthand is taken returns 409 instead of succeeding. The same holds for `uniq_saison_id_spieler_id`,
which is why bringing a player back into a season they already have a row for is the reactivate
endpoint and never a second create.

**The date is the reason the field is a date.** A scheduled purge selecting rows retired long enough to
be safe to delete is now expressible as a query, and it is open item BE-12. A boolean would have made
that item start with a migration.

**The two collections without a Pydantic model gained the field by transcription.** `saison_spieler` is
one of them, so its validator in `app/core/constraints.py` was written against the live documents and
verified with `python -m app.core.constraints --check` (ADR-0024).

**The field is required, so it had to exist on every live document before the image requiring it ran.**
Setting it to `null` across the six collections is a one-off `updateMany` per collection, filtered on
`{"$exists": false}` so it is idempotent and cannot overwrite a real date. It was run by hand against
the live database **before** the deploy — the reverse order leaves a backend whose response models
require a field the documents lack, and every read of a team, player, matchday, venue or referee
returns 500. No migration tooling exists in this repository and none was added for it: a one-off that
ships as a script is a permanent file with one day's purpose.

## Alternatives considered

**A boolean `is_inactive`, extended to the four new collections.** Rejected: it answers none of the
three questions retirement raises, and it makes BE-12 start with a migration. It was also already
in the codebase on two collections, so the honest framing is that this ADR _replaced_ it rather than
declined it.

**A boolean and a date together.** Rejected on the contradiction argument above. This is the option
that looks most complete and is the only one of the three with a state the database cannot refuse.

**A `deleted_at` timestamp rather than a date.** Rejected for consistency: every other date in this
system is a German `YYYY-MM-DD` string (`datum`, `beginn`, `start_date`), the retirement of a venue is
not an event whose hour matters, and a second date format is a second parsing rule on the frontend.

**Make `POST` idempotent — revive a retired row holding the natural key.** Rejected on the
unrecoverability argument above. What makes this different from an ordinary convenience: the failure
is silent, it is discovered by reading historical match cards that name the wrong club, and no record
survives of what those rows pointed at. A 409 an admin has to think about is the correct cost.

**Hard delete, with a check that nothing references the row.** Rejected: the reference check is a scan
over `spiele` per delete, it is exactly the cascade the schema deliberately does not have, and it
answers "may I delete this" with "no" for essentially every row that has ever been used — which is the
soft delete, arrived at the expensive way.
