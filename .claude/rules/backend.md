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
- Change a stored shape and its record model (`fl_backend/app/core/readback.py :: RECORD_MODELS`) in
  the same commit as the Playground paste that moves the stored documents; nothing in the database
  refuses a document of another shape, and only `python -m app.core.readback` after the paste names
  one.
