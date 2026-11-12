---
paths:
  - "fl_backend/**/*"
  - "fl_backend/**/.*"
---

# Traps — the backend surface

Each fails silently. The ratified decisions for this surface are in `docs/decisions.md`.

- Mark every db-touching test `@pytest.mark.db`. Unmarked, one asking for a server fixture is refused
  at setup (`fl_backend/tests/tier.py`), but one reaching a server another way passes wherever a
  local `mongod` answers on 27017 and fails only in CI, whose backend job starts none.
- Pass a Pydantic field default by keyword — `Field(default=0, ge=0)`, never `Field(0, ge=0)`.
  Positional leaves Pyright believing the field is required while ruff and pytest stay green.
- Change a stored shape and its record model (`fl_backend/app/readback.py :: RECORD_MODELS`) in
  the same commit, and hand the owner the migration that moves the stored documents: a few
  generated, self-checking files the owner runs with `mongosh --file` in a terminal, never a file in
  the tree, a test or a runbook. Nothing in the database refuses a document of another shape, and
  only `python -m app.readback` after the run names one.
