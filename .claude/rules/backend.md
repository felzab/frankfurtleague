---
paths:
  - "fl_backend/**/*"
  - "fl_backend/**/.*"
---

# Traps — the backend surface

Each fails silently. The ratified decisions for this surface are in `docs/decisions.md`.

- Mark every db-touching test `@pytest.mark.db`; one whose database command comes from a process it
  starts fails nothing when unmarked, `fl_backend/tests/tier.py` watching this process alone.
- Pass a Pydantic field default by keyword — `Field(default=0, ge=0)`, never `Field(0, ge=0)`.
  Positional leaves Pyright believing the field is required while ruff and pytest stay green.
- Change a model and its hand-written copy in `fl_backend/app/core/constraints.py` in the same
  commit; a default-tier test names the field if you forget. `saison_teams` has no model — verify it
  with `python -m app.core.constraints --check`.
