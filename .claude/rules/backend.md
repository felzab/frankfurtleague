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
- Change a stored shape and its record model (`fl_backend/app/readback.py :: RECORD_MODELS`) in
  the same commit, and hand the owner the migration files that move the stored documents, run in
  [the runbook's order](../../docs/ops/runbooks.md#2-before-deploying-a-change-to-a-stored-shape-or-an-index).
  Nothing in the database refuses a document of another shape, and only `python -m app.readback`
  after the run names one. Each file names its database by `use(...)`, guards each `dropIndex`, which
  throws on an unknown name, writes integers as `Int32()`, `print`s its report and is proven on a
  copy of production's snapshot.
- Declare a newly added stored field required in its record model, with no default, and hand the
  owner the migration file that writes it into every stored document of its collection. A default
  spared a migration hides a missing key the runtime then misreads, and the read-back passes a
  document lacking a defaulted key. A collection holding no document still takes its file, which
  counts, finds none and ends. A field that already carries a default for older documents keeps it.
