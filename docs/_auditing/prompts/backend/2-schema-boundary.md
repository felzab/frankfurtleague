# Backend pass 2 — schema and contract boundary

Audit pass `backend 2` on `./fl_backend`. Lens: SCHEMA AND CONTRACT BOUNDARY — is what the backend
declares, validates and serves the same thing the frontend mirrors, in both validation modes, on both
the read and the write path.

Read `docs/_auditing/prompts/_shared-protocol.md` and follow it for the whole pass. Write the report
to `docs/audit/programme/b2-schema-boundary.md`.

DELIVERABLE: the two-sided contract table (check 1) is required — one row per field of every response
model that has a zod mirror, both directions, no field omitted. It is the pass's primary output.

CONTEXT — derive, do not assume: the Pydantic models live in `app/api/*/schemas.py` and
`app/shared/schemas/`; their zod mirrors in `fl_frontend/src/features/*/schemas.ts` and
`fl_frontend/src/shared/schemas.ts`. The two are **hand-maintained mirrors with no generation step**
— a ratified decision, not a defect to report. A gate check already compares presence, required,
nullable, primitive type and enum members against the committed `fl_backend/openapi.json`
(`fl_frontend/src/core/apiContract.test.ts`), so **this pass's subject is what that check deliberately
leaves out**: ranges, patterns, lengths, formats and the shapes recorded in its exception lists.
The backend is the ratified source of truth; the frontend mirrors it. Pydantic validates on the way
**out** of Mongo, so read-model constraints are load-bearing against stored data, not only against
requests.

THE CHECKS, in priority order:

1. **TWO-SIDED CONTRACT TABLE.** The required table, one row per field of every response model that
   has a zod mirror: model.field | backend type and constraints | frontend type and constraints |
   divergence, classified as one of — `missing-on-frontend` (**zod's default strip mode silently
   discards such a field**, so the frontend never sees it and nothing errors; an audit that checks
   only for over-permissiveness cannot see this class at all), `missing-on-backend`,
   `constraint-looser-frontend`, `constraint-looser-backend`, `nullability-mismatch`, `none`. Both
   directions, every field — the table is the deliverable. Where a divergence is deliberate (for
   example `trace_id` documented as error-path-only), cite the recorded reason and mark it
   already-correct.

2. **VALIDATION-MODE COVERAGE.** For every custom type in `app/shared/schemas/custom.py` and every
   `json_or_python_schema` or custom validator: does it enforce the same rule in **JSON mode**
   (`model_validate_json`) as in Python mode? `CustomObjectId` is the shape to measure the others
   against — the same chain serves its json branch and its python union, so a JSON string is
   converted and checked exactly as a Python one is, and `__get_pydantic_json_schema__` states the
   published schema rather than leaving it to be read off that chain. A branch that only declares a
   value's type where the other branch converts it is the defect to look for. Also check that each
   custom type's _serialization_ schema matches what is actually stored and emitted.

3. **NEW AND CHANGED READ-PATH CONSTRAINTS.** The inventory of what stored data could violate belongs
   to b1's check 8; do not rebuild it. What belongs here is the provenance of each constraint on a
   read model: was it added with a recorded read-only data audit behind it, or asserted? Flag every
   one without that record. Where you verify against live data (counts and `_id`s only), **audit the
   correct half of a join** — the API's `FLTeam` is `teams` ⋈ `saison_teams`, and checking the wrong
   collection reports every row as broken.

4. **REQUEST-MODEL BOUNDS.** Every query, path and body parameter: bounded (`ge` / `le` on limits,
   `Literal` for enums, validated id types), correct defaults (an omitted `saison_id` means the
   current season, resolved in the handler; never a field default), and alias handling
   (`serialization_alias` / `by_alias` used correctly — a name-versus-alias mismatch fails silently
   at this boundary rather than raising). Unknown-field behaviour: what does each write model do with
   an undeclared field — silently drop it, where the frontend might believe it was sent?

5. **ENVELOPE AND RESPONSE-MODEL CONSISTENCY.** Every endpoint returns a model extending the base
   response envelope, or has a documented reason not to. Any raw `JSONResponse` bypassing
   `response_model` gets one declared anyway: **a route with no declared response model can have a
   consumer-side schema that has never once matched it, and nothing anywhere errors.** Discriminated
   unions: the discriminator value, the class name and the frontend union member must all agree.

6. **ERROR CONTRACT.** `app/core/exception_handlers.py` and `exceptions.py`: one documented error
   shape, `trace_id` behaviour consistent with what the frontend schema expects, validation errors
   surfaced with enough structure to act on and no more.

7. **SEMANTIC CONTRACTS.** Where both sides _derive_ the same concept independently — status
   derivation (`ausstehend` / `heute` — ratified; verify the code still matches rather than
   reporting the divergence), score formatting, phase aliases (`"playoffs"` compiles to a
   filter and never appears on a document — see `docs/glossary.md`) — name every derivation pair and
   state whether the two agree at the boundaries: today, null, empty.

8. **OPENAPI TRUTHFULNESS.** Every endpoint has a docstring and a `summary=` — verify the claims
   still match the behaviour; `response_model` matches what the handler actually returns; documented
   status codes match the exceptions actually raised.

CROSS-SURFACE QUESTIONS: whether a looser side is deliberate slack or accumulated drift is usually
knowledge only I have, and this lens generates such questions in volume. Collect and batch them per
the shared protocol rather than deciding silently.

BOUNDARIES — not this pass: whether a write lands where reads read, and the out-of-band constraint
inventory → b1 · injection through these models, auth on the endpoints → b3 · where schema code
_lives_, duplication, dead schemas → b4 · the frontend's own use of its schemas → the frontend
passes · **which call site parses which route with which schema** → the crosscut pass, which joins
this table against the actual call graph.
