# ADR-0024 — The third copy of the schema is checked by a test, not generated

**Status:** Accepted\
**Date:** 2026-08-02\
**Surface:** backend\
**Supersedes:** —\
**Superseded by:** —\
**Source:** Open item DB-2, implementing [ADR-0020](0020-the-database-enforces-its-own-invariants.md).

## Context

[ADR-0020](0020-the-database-enforces-its-own-invariants.md) accepted a third copy of the schema —
after Pydantic and the Zod mirror — and named the cost without saying how it would be paid: "F2 already
records hand-mirroring as this codebase's main drift risk, and this makes it worse before BE-4 makes it
better."

Building it made the question concrete. A `$jsonSchema` validator lists the same field names and the
same types as the Pydantic model beside it, so **every future model change is now a two-file change**,
and nothing about the first file would announce that the second was forgotten. The obvious answer is to
stop writing the second file by hand: Pydantic can emit a JSON Schema, and `$jsonSchema` is a dialect
of JSON Schema, so a generator looks like it should be a short function.

**It is not, and the reasons are measurable rather than aesthetic.** Run against this codebase's own
models on 2026-08-02:

| Measured                                                                                | What a generated validator would then assert                                                                               |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `FLSpielTeamField.model_json_schema()["properties"]["team_id"]` is `{"type": "string"}` | That every ObjectId reference **is a string** — blessing `"Lessing-Gymnasium"`, the exact defect ADR-0020 exists to refuse |
| `tore` emits `{"anyOf": [{"minimum": 0, "type": "integer"}, {"type": "null"}]}`         | A range ADR-0020 puts out of scope, plus an `anyOf` where `bsonType` is the BSON-aware spelling                            |
| `FLTeam.model_fields` includes `gruppe`, `is_disqualified` and `statistik`              | Three fields that are on no `teams` document: two come from the junction, one is derived and stored nowhere (ADR-0019)     |

`CustomObjectId` passing a bare `str_schema()` for its JSON branch is open item BE-6, recorded weeks
before this. Generation would turn that latent inconsistency into the load-bearing type declaration of
the collection it is least safe in.

Two collections make it worse: `saison_teams` and `saison_spieler` have **no Pydantic model at all**, so
generation covers seven of nine and looks complete.

## Decision

**Write the validators by hand, and make the drift a test failure.**

`tests/core/test_constraints.py::test_every_mirrored_model_matches_its_validator` compares each
Pydantic model's stored field names — `id` read through its `_id` validation alias — against the field
names its validator declares, and fails naming the field. It runs in the **default** tier, so
`./scripts/verify.sh` and every pull request catch it in under half a second with no database.

Two supporting rules make the comparison an equality rather than a subset check, which is what gives it
teeth:

- **Where a model deliberately carries a field the document does not**, the test names it. `FLTeam`'s
  three season-scoped extras and `FLSpieler`'s five junction fields are written out in
  `MIRRORED_MODELS`, so the flattening is recorded in the one place that breaks when it changes.
- **The two model-less collections are named too**, so giving one a model later fails the suite rather
  than silently leaving its validator unmirrored.

`test_no_validator_constrains_a_range_or_a_format` enforces ADR-0020's scope in the same file. Widening
that scope is a one-word edit that reads as an improvement, which is precisely why it needs a test and
not a paragraph.

## Consequences

**What it costs.** Changing a Pydantic model that mirrors a collection means changing
`app/core/constraints.py` in the same commit. That obligation is now stated in three places: this ADR,
CLAUDE.md's backend conventions, and the failure message of the test itself — which is the only one of
the three that will actually be read at the moment it matters.

**What it enables.** The two copies are checked against each other on every run, so the drift F2 warns
about does not, for this pair, depend on anybody remembering. This is stronger than generation in one
respect: a generator makes the copies agree by construction and therefore cannot tell you the model
itself is wrong, whereas the test makes a person look at the field twice — once as an API shape, once
as a stored shape. For `FLTeam` and `FLSpieler` that difference is real information, and it has a home.

**What it does not cover.** Field _types_ are not compared, only field _names_. Mapping
`str | None` to `["string", "null"]` mechanically is most of a converter, and a converter is the thing
this ADR declined to write. A wrong type is caught by
`test_constraints_execution.py`'s conforming-document cases instead, which insert the real shapes into a
real `mongod` (ADR-0023) — a slower net, in the deselected tier, but an exact one.

## Alternatives considered

**Generate the validators from the Pydantic models.** Rejected on the three measurements above. Each of
them fails _silently_ by producing a plausible validator — a string-typed `team_id` looks entirely
reasonable in a diff — which is a worse failure mode than the forgotten edit it removes. It would also
put the validators behind a converter whose output nobody reads, so the day Pydantic changes how it
emits a nullable integer, nine production validators change shape on the next boot with no diff to
review.

**Write storage models for all nine collections and generate from those.** The honest version of the
idea above, and genuinely better in the long run: it would give `saison_teams` and `saison_spieler` the
models they lack, and separate the API shape from the stored shape rather than conflating them in
`FLTeam`. Rejected for _this_ item on scope — it is a redesign of the read models, it needs
`CustomObjectId` to learn its BSON type first (BE-6), and DB-2 is the item that stops a live defect
rather than the item that restructures the model layer. Reconsider it inside BE-4, which is already
building the write path where storage models would live.

**Accept the duplication and document it, as F2 does for the Zod mirror.** Rejected because the
comparison is not the same. The Zod mirror is in another language, in another package, behind a network
boundary — checking it mechanically means building a contract-test harness. Both copies here are Python
objects in the same process, importable in the same test, and the check is fifteen lines. Declining a
fifteen-line check because a harder version of the same problem elsewhere was accepted would be
reasoning from precedent rather than from cost.
