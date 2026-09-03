---
paths:
  - "fl_backend/**/*"
  - "fl_backend/**/.*"
---

# Ratified decisions — the backend surface

`.claude/CLAUDE.md` §7's never-clauses whose only violator is a session inside `fl_backend/`, on
§7's terms.

- **models** — Give `saison_id` a Pydantic field default
- **db** — Swallow a failed validator or index; widen one past types and enums
- **db** — Generate the `$jsonSchema` validators from the models
- **routing** — Move a guard onto an endpoint; merge the two routers; delete `GET /{id}`
- **placings** — Recurse the tiebreak chain; seed a placing the group can still change
- **draw** — Store `anzahl_spiele`; hardcode the qualifier cap
- **domain** — Import `app/core/domain.py` from `app/`; generate it; enforce it
- **db** — Spell a collection name as a literal; enumerate the field names too
- **routing** — Answer 422 for a malformed path id, or 404 for a query one
- **spiele** — Drop a forfeit from the cancellation count; merge it into the scoring lookup
- **tests** — Mark a test `db` for a decision the default tier reaches

## Traps

`.claude/CLAUDE.md` §6's, on §6's terms: each fails silently.

- Mark a db-touching test `@pytest.mark.db`. Without it the test runs in the default tier with no
  container and fails for an unrelated-looking reason; nothing catches an omitted marker.
- Pass a Pydantic field default by keyword — `Field(default=0, ge=0)`, never `Field(0, ge=0)`.
  Positional leaves Pyright believing the field is required while ruff and pytest stay green.
- Change a model and its hand-written copy in `fl_backend/app/core/constraints.py` in the same
  commit; a default-tier test names the field if you forget. `saison_teams` has no model — verify it
  with `python -m app.core.constraints --check`.
