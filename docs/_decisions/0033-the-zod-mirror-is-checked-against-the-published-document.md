# ADR-0033 — The Zod mirror is checked against a committed OpenAPI document, not generated from it

**Status:** Accepted\
**Date:** 2026-08-05\
**Surface:** frontend, backend, ops\
**Supersedes:** —\
**Superseded by:** —\
**Source:** Open item F2, my instruction on which was to find a way to verify the frontend schemas
against the backend's, and possibly generate them.

## Context

`fl_backend/app/api/*/schemas.py` and the ten Zod modules under `fl_frontend/src` are hand-maintained
mirrors of one another across a network boundary. Nothing compared them. A field added, removed,
retyped or made nullable on one side and forgotten on the other compiled, linted and built green on
both sides, and surfaced as an `APIMalformedDataError` on a public page — or worse, as silence, because
Zod's default strip mode discards an undeclared field with no error at all.

[ADR-0024](0024-the-third-copy-of-the-schema-is-checked-not-generated.md) settled the sibling question
for the third copy of the same shapes and explicitly declined to settle this one: "The Zod mirror is in
another language, in another package, behind a network boundary — checking it mechanically means
building a contract-test harness." That sentence is what this decision revisits, because two things
that were not true when it was written now are.

**Both sides emit JSON Schema without a new dependency.** Zod 4 ships `z.toJSONSchema()`, and FastAPI
has always published an OpenAPI document. Measured on 2026-08-05 against this repository: **all 52
exported Zod schemas convert, with zero failures**, and `app.openapi()` builds byte-identically across
runs from `create_app(build_test_config())` — no server, no database, no `.env`. The harness ADR-0024
imagined is a comparison between two JSON documents.

**Naming already pairs them.** `FLX` ↔ `FLXSchema` matches **34 of the 70 components** with no manual
mapping at all, and five more pair once the frontend's `…ReturnSchema` and `FLDelete…` spellings are
declared as aliases. What is left over is 31 backend-only and 14 frontend-only names, each with a
one-line reason and most of them one category: a write path BE-4 built that no admin page calls yet.

Three measurements decided the shape of the check rather than whether to have one.

| Measured                                                                                                                                                              | What it rules out                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `CustomObjectId` publishes `{"type": "string"}` with no pattern, while `CustomObjectIdStringSchema` carries a 24-hex regex                                            | Comparing patterns. The frontend is stricter on purpose, and the check must not push it to be looser |
| `z.int()` emits `maximum: 9007199254740991`; Pydantic emits none                                                                                                      | Comparing numeric bounds                                                                             |
| `acknowledged`, the three `format` discriminators and `FLTeamStatistik`'s seven counters carry defaults, so FastAPI's validation schema leaves them out of `required` | Reading `required` off the document verbatim in the response direction                               |

## Decision

**Commit `fl_backend/openapi.json`, and compare the Zod mirror against it on the wire contract.**

Three pieces, each in the scope that owns it:

- **`fl_backend/tests/openapi_document.py`** builds and writes the document.
  `python -m tests.openapi_document --write` regenerates it; `--check` reports staleness.
- **`fl_backend/tests/api/test_openapi_document.py`** asserts the committed document equals the built
  one, as parsed JSON. Default tier, no Docker.
- **`fl_frontend/src/core/apiContract.test.ts`** converts every exported Zod schema, pairs it by name,
  and compares **five facts per field: presence, required, nullable, primitive type, enum members.**

**Compare the wire contract and nothing beyond it.** Those five are what both sides must agree on for a
body to round-trip. Patterns, lengths, numeric bounds, formats and error messages are each side's own
validation policy, they differ deliberately, and comparing them produces failures nobody can act on.

**Every shape is paired or written into an exception list with its reason**, and the pair count is
pinned. A check that silently skips what it cannot pair is the failure mode `tests/api/test_admin_guard.py`
already documents — walking four framework routes and passing while proving nothing.

Two normalisations are applied and commented at the line: on a **response**, a property carrying a
`default` is always on the wire, because no route sets `response_model_exclude_unset`; and `integer`
collapses into `number`, because `z.literal([0, 1])` and `Literal[0, 1]` spell the same wire value
differently.

## Consequences

**A model change is now a three-file change**, and the third file is generated: edit the Pydantic
model, run `--write`, update the Zod mirror. Forgetting the second step fails the backend test;
forgetting the third fails the frontend test. Both name the field.

**The committed document is what closes the scope hole, and that is why it is committed rather than
generated at gate time.** `scripts/ci_scopes.sh` maps a change under `fl_backend/` to the backend scope
alone, so a Pydantic model edit would never run the frontend job that holds the comparison. The
document is mapped to **both** scopes, so regenerating it carries the model change into the frontend
job in the same pull request. A gate-time document cannot do this, and would additionally give the
frontend scope a Python prerequisite that `docs/ops/spec.md`'s scope table says it does not have.

**A 153 KB generated file is in the tree.** It is excluded from prettier for the reason the ignore file
already gives for `pnpm-lock.yaml`, and it earns its place independently: a schema change is now
visible as a diff of the published contract, which is the artifact a consumer would read.

**What it does not cover.** The comparison is between the published document and the Zod schemas. It
says nothing about whether a handler returns what its `response_model` declares, and nothing about the
constraints deliberately left out. A schema on either side that nothing publishes or consumes is
recorded in an exception list rather than checked — 31 backend components and 14 Zod schemas today,
against 39 pairs actually compared, most of the exceptions being the write path waiting on FB-3 and
FB-6.

**It found three drifts on its first run**, which is the evidence that the surface was worth checking:
`FLSpieler.inactive_since` and `FLSpieltag.inactive_since` were sent by the backend and absent from
both mirrors, so Zod was stripping them silently; and `FLTeam.gruppe` was `z.string().length(1)`
against a backend `Literal["A", "B", "C", "D"]`.

## Alternatives considered

**Generate the Zod schemas from the document.** Rejected on measurement, not on taste. Of 52 exported
Zod schemas, **18 have no backend component at all** — the German per-field error messages that back
admin forms, the draft types that let a currency field be `null` mid-edit, `FLSpielplan` and
`FLSpieltagWithSpiele` composed client-side, the delete payloads that describe a server action's
argument rather than a request body, and the scalar aliases. Generation therefore means a generated
core plus a hand-written layer over it, and the drift moves into the layer. It would also make the
mirror **weaker**: a generated `team_id` is a bare string, `website_url` loses `ExternalUrlSchema`'s
scheme restriction on a value rendered into an `href`, and every German message is gone. ADR-0024
rejected generation for the third copy on the same grounds, with different numbers.

**Generate the document at gate time instead of committing it.** Rejected for the scope reason above,
which is decisive on its own: it leaves a backend-only schema change unchecked. It also puts a Python
dependency into the frontend scope and CI's frontend job, neither of which has one.

**A Python test that parses the `.ts` files.** Rejected because it re-derives by regex what
`z.toJSONSchema()` already computes exactly, and would be wrong in precisely the places the mirror is
subtle — a nested `anyOf`, a `.nullable()` on a union, a schema composed with `.extend()`.

**Compare only field names, exactly as ADR-0024 does.** Rejected because it does not catch the change
this check was built for. BE-9 makes `FLSpiel.team1` nullable; the field is still called `team1` on both
sides, and a name-only comparison stays green while the bracket rendering meets a `null` it was never
written for.

**Compare everything JSON Schema expresses.** Rejected on the three measurements in the context table.
It fails immediately and for reasons that are not drift, and the only way to make it pass is to weaken
the frontend's validation to match a document that deliberately carries less.
