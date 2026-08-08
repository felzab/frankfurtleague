# ADR-0061 — A player's position and stufe are closed sets

**Status:** Accepted
**Date:** 2026-08-07
**Surface:** backend
**Supersedes:** —
**Superseded by:** —
**Source:** My decision of 2026-08-07, taken when FB-3's spieler half reached the squad
editor and had to decide what its two pickers offer. The set's membership is mine; the
inspection that made the question unavoidable is recorded in
[`../roadmap/open-items.md`](../roadmap/open-items.md).

## Context

`saison_spieler.position` and `saison_spieler.stufe` are free-text strings, filled in by hand
directly in MongoDB. Across 362 squad rows they have already split:

| Field      | In use                                                 | Strays                      |
| ---------- | ------------------------------------------------------ | --------------------------- |
| `position` | `Mittelfeld` 121, `Abwehr` 118, `Angriff` 86, `Tor` 29 | `?` ×5, `Sturm` ×2, `TW` ×1 |
| `stufe`    | `Q1` 324, `E1` 24, `Q3` 4, `Q4` 4, `Q2` 3              | `??` ×2, `10` ×1            |

`Sturm` and `Angriff` name the same position; so do `TW` and `Tor`. Eleven field values across ten
rows are therefore either a second spelling of a value the league already has, or a placeholder
somebody typed instead of leaving the field null — which it already permits.

The split has cost nothing so far because nothing groups by either field. FB-3's squad editor is the
first surface that offers a box to type into, and a free-text box is how the fourth spelling of
"Tor" arrives. A closed set costs least at the moment before that, not after.

Whether an unanswered field is null or a placeholder string is settled and not at issue: both columns
are already nullable, and a squad filled in over time is exactly what ADR-0032 records as normal.

## Decision

**`position` is `Tor | Abwehr | Mittelfeld | Angriff`. `stufe` is `E1 | E2 | Q1 | Q2 | Q3 | Q4`.**
Both stay nullable. Both are declared as a Pydantic `Literal` on every model that carries them and as
an `enum` in the `saison_spieler` validator, so the set holds against the write path and against a
hand-edit in MongoDB alike.

**`E2` is offered although no row holds it.** The two Oberstufe phases run in sequence, so a set
built from what the current season happens to contain would refuse a legitimate entry the moment the
year turns. `stufe` is the one field here whose membership is decided by the school system rather
than by the league.

**`nummer` stays free text and is NOT part of this decision.** A squad number is worn rather than
counted: it is not unique within a squad — seven rows across three teams already share one with a
team-mate — and there is no set to close it to.

**The ten stray rows are normalised before the deploy, by hand, and the runbook is below.** The two
directions of the change pull against each other exactly as ADR-0042's did: the validator refuses
what the documents currently hold, so the order is not a preference.

### Runbook

Run against the live database **before** deploying the image that carries this ADR's models.

**The reverse order was measured rather than predicted, and it costs more than the public pages.**
Running the local stack against the live data with these models in place:

- `GET /spieler?team_id=…` answers **500** for the five teams holding a stray row — Carl-Schurz,
  Gagern, Gymnasium Nord, Riedberg and Ziehen — so those five `/dashboard/spieler/{team_id}` pages
  fail. The other eleven answer 200 and render in full.
- **`GET /spieler/memberships` answers 500 outright**, and with it the whole of `/admin/spieler`. That
  read returns every player with every squad row, so one stray anywhere in the collection fails all of
  it — there is no per-team blast radius to hide behind.

The second is the one that decides the ordering. **The admin list is the surface an operator would
reach for to repair the data, and it is down until the data is repaired**, so the runbook is not a
tidy-up that can follow the deploy at leisure — it is the only way in. Widening the admin read to
tolerate a value the write path refuses was considered and rejected below.

1. **The two spellings become the value they already mean.** Two `updateMany`s on `saison_spieler`:
   `{"position": "Sturm"}` → `Angriff` (2 rows), `{"position": "TW"}` → `Tor` (1 row).
2. **The placeholders become null**, which is what "nobody has answered this yet" already looks like
   on both columns: `{"position": "?"}` → `null` (5 rows), `{"stufe": {"$in": ["??", "10"]}}` → `null`
   (3 rows). One row carries both a stray position and a stray stufe, which is why ten rows are
   refused and eleven values change.
3. **One `nummer` reads `"NaN"`** — an import artifact, not a number anyone wears. `{"nummer": "NaN"}`
   → `null` (1 row). No validator refuses it, because `nummer` is free text and stays so; it is in the
   runbook because the squad editor would otherwise render it as this player's shirt number.
4. **Deploy.** `python -m app.core.constraints --check` reports exactly what steps 1 to 3 missed, and
   reported `10 of 362` before them.

Each filter is idempotent and matches on the stray value itself, so re-running a step is a no-op
rather than an overwrite. No migration tooling is added: ADR-0032 settled that a one-off ships as a
runbook rather than as a permanent file with one day's purpose.

## Consequences

**A fourth spelling of an existing position can no longer be entered**, by the API or by hand. That
is the whole point, and it is also the cost: a genuinely new value now needs a code change and a
deploy rather than a keystroke. Six values across two fields, in a league of school teams, is a rate
of change measured in years.

**Eight of the ten normalised rows lose information that was never information.** `?` and `??` say
nothing null did not already say. The two that do change meaning — `Sturm`→`Angriff` and `TW`→`Tor` —
are recorded here rather than only in a shell history, because after the runbook nothing in the data
shows those rows were ever spelled differently.

**One row's `stufe` of `10` is discarded rather than represented.** A year-10 pupil is outside the
Oberstufe, and the alternative was a twelve-member set for one row. If under-Oberstufe pupils turn
out to play regularly, that is a new decision and this ADR is what it supersedes.

**The validator's `enum` is a hand-copied third copy of each `Literal`**, and the field-name drift
check did not reach enum values. `test_every_validator_enum_matches_its_literal` and
`test_every_declared_enum_is_checked` are added with this decision and cover all eight enums in the
file, not only these two — the second found an unchecked one on `spieltage` the moment it ran.

[ADR-0027](0027-the-database-enforces-its-own-invariants.md) is why types, presence and enums
are the validator's scope and ranges and formats are not;
[ADR-0031](0031-the-third-copy-of-the-schema-is-checked-not-generated.md) is why the validator
is transcribed and checked rather than generated;
[ADR-0032](0032-soft-deletion-is-a-date-not-a-flag.md) is the runbook convention, and why a
one-off is not a script.

## Alternatives considered

**Leave both free text and normalise nothing.** Rejected: the split is already there at eight rows
and nothing stops the ninth. The field survives being free text only while no UI offers it, and this
is the change that offers it.

**A closed set in Pydantic but not in the validator.** Rejected: squads are hand-edited in MongoDB,
where no Pydantic model runs, and that is precisely where the eight strays came from. A set the write
path honours and the database does not is a set that holds everywhere except where it broke.

**Normalise the strays and keep the fields free text.** Rejected: it fixes today's data and none of
tomorrow's, and it is strictly more work than this decision for a subset of the benefit.

**A reference collection of positions, joined at read time.** Rejected as disproportionate: four
values that change on a scale of years do not need a collection, a join and an admin surface of their
own. That shape earns its place when the set is data; here it is vocabulary.

**Let the admin read tolerate a value the write path refuses**, typing `position` and `stufe` as bare
strings on `FLSpielerMembership` alone, so `/admin/spieler` could display and repair a stray row
instead of failing on it. Genuinely tempting, because the alternative is an admin surface that cannot
show the data it exists to fix. Rejected on scope: the tolerance would be permanent and would exist
for a state that lasts from the deploy until step 2 of a runbook — after which the validator makes it
unreachable, since it refuses a bad value on update as well as on insert. A second shape of the same
field, kept forever to serve a window measured in minutes, is the more expensive mistake. It is also
the shape ADR-0042 and ADR-0059 both declined for the same reason: the data is ordered against the
deploy, not accommodated by it.

**Include the Mittelstufe years (5–10) in `stufe`.** Rejected by me: twelve members to
represent one row, in a set otherwise decided by the Oberstufe's two phases. The single row
normalises to null instead.
