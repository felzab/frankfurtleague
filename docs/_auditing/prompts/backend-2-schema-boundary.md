# Backend pass 2 — schema and contract boundary

Paste into a fresh session (or run via `/audit:pass backend 2`).

---

Audit pass 2 of 4 on `./fl_backend`. Lens: SCHEMA AND CONTRACT BOUNDARY — is what the backend
declares, validates and serves the same thing the frontend mirrors, in both validation modes, on
both the read and write path.

Read `docs/_auditing/prompts/_shared-protocol.md` and follow it for the whole pass. Write the report
to `docs/audit/b2-schema-boundary.md`. Read `docs/audit/b1-consistency.md` first; cite it rather
than re-reporting.

CONTEXT — derive, do not assume: the Pydantic models live in `app/api/*/schemas.py` and
`app/shared/schemas/`; their zod mirrors in `fl_frontend/src/features/*/schemas.ts` and
`fl_frontend/src/shared/schemas.ts`. The two are **hand-maintained mirrors with no generation
step** (documented as finding F2 — accepted, not a defect; the drift _between_ them is this pass's
subject). The backend is the ratified source of truth; the frontend mirrors it. Pydantic validates
on the way **out** of Mongo, so read-model constraints are load-bearing against stored data, not
just against requests.

THE CHECKS, in priority order:

1. **TWO-SIDED CONTRACT TABLE.** The required table, one row per field of every response model that
   has a zod mirror: model.field | backend type + constraints | frontend type + constraints |
   divergence, classified as one of — `missing-on-frontend` (zod's default strip mode silently
   discards it: the class that ate `saison_id` and was invisible to the frontend audit, which
   checked only for permissiveness), `missing-on-backend`, `constraint-looser-frontend`,
   `constraint-looser-backend`, `nullability-mismatch`, `none`. Both directions, every field —
   the table is the deliverable. Where a divergence is deliberate (e.g. `trace_id` documented as
   error-path-only), cite the recorded reason and mark it already-correct.

2. **VALIDATION-MODE COVERAGE.** For every custom type in `app/shared/schemas/custom.py` and every
   `json_or_python_schema` / custom validator: does it enforce the same rule in **JSON mode**
   (`model_validate_json`) as in Python mode? Seeded prior finding **BE-6**, open: `CustomObjectId`
   passes a bare `str_schema()` on the JSON branch, so JSON-mode validation accepts any string —
   re-verify at current code, then sweep every other custom type for the same shape. Also check
   each custom type's _serialization_ schema matches what is actually stored/emitted.

3. **READ-PATH CONSTRAINT HAZARDS.** For every constraint on a model that validates data read from
   Mongo: could stored data violate it, and what happens then (a 500 on the serving endpoint)?
   Where feasible, verify against live data read-only (counts and `_id`s only — and check the
   correct half of a join: the API's `FLTeam` is `teams` ⋈ `saison_teams`; the frontend
   programme's first data audit checked the wrong half and reported all 17 teams broken). Flag any
   constraint added without a recorded data audit.

4. **REQUEST-MODEL BOUNDS.** Every query/path/body parameter: bounded (`ge`/`le` on limits,
   `Literal` for enums, validated id types), correct defaults (an omitted `saison_id` means the
   current season, resolved in the handler — ADR-0002; never a field default), and alias handling
   (`serialization_alias` / `by_alias` used correctly — the BE-8 class lives at this boundary).
   Unknown-field behaviour: what does each write model do with an undeclared field — silently drop
   (Pydantic default) where the frontend might believe it was sent?

5. **ENVELOPE AND RESPONSE-MODEL CONSISTENCY.** Every endpoint returns a model extending the base
   response envelope, or has a documented reason not to. Any raw `JSONResponse` bypassing
   `response_model` gets one declared anyway (the `getSystemInfo` incident — a route and schema
   that had _never_ matched — is the cautionary case). Discriminated unions: the discriminator
   value, the class name and the frontend union member must agree.

6. **ERROR CONTRACT.** `app/core/exception_handlers.py` and `exceptions.py`: one documented error
   shape, `trace_id` behaviour consistent with what the frontend schema expects, validation errors
   surfaced with enough structure to act on and no more (leakage itself is pass B3's).

7. **SEMANTIC CONTRACTS.** Where both sides _derive_ the same concept independently — status
   derivation (`ausstehend`/`heute`: seeded prior finding **F1**, server includes today, client
   excludes it; verify current state, report as a decision to confirm), score formatting, phase
   aliases (`"playoffs"` compiles to a filter and never appears on a document — glossary) — name
   every derivation pair and whether they agree at the boundaries (today, null, empty).

8. **OPENAPI TRUTHFULNESS.** Endpoint docstrings and `summary=` exist (the documentation programme
   put them there — verify the claims still match behaviour), `response_model` matches what the
   handler actually returns, and documented status codes match raised exceptions.

CROSS-SURFACE QUESTIONS: whether a looser side is deliberate slack or drift is often owner
knowledge (the frontend programme's Q2/Q3 were exactly this shape). Collect and batch per the
shared protocol.

BOUNDARIES — not this pass: whether a write lands where reads read → B1 · injection through these
models, auth on the endpoints → B3 · where schema code _lives_, duplication, dead schemas → B4 ·
the frontend's own use of its schemas → the frontend programme's reports.
