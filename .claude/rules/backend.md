---
paths:
  - "fl_backend/**/*"
  - "fl_backend/**/.*"
---

# Traps — the backend surface

Each fails silently. The ratified decisions for this surface are in `docs/decisions.md`.

- Mark every db-touching test `@pytest.mark.db`. Unmarked, one asking for a server fixture is
  refused at setup (`fl_backend/tests/tier.py`), but one reaching a server another way passes
  wherever a local `mongod` answers on 27017 and fails only in CI, whose backend job starts none.
- Change a stored shape and its record model (`fl_backend/app/readback.py :: RECORD_MODELS`) in the
  same commit, and hand the owner the migration files that move the stored documents, run in
  [the runbook's order](../../docs/ops/runbooks.md#2-before-deploying-a-change-to-a-stored-shape-or-an-index).
  Nothing in the database refuses a document of another shape, and only `python -m app.readback`
  after the run names one. Each file names its database by `db = db.getSiblingDB("<name>")`, guards
  each `dropIndex`, which throws on an unknown name, writes integers as `Int32()` and ids as
  `ObjectId()`, is safe to run twice and `print`s its own report, which holds counts and never
  names, since `mongosh --file` prints nothing for a bare last expression. No file asks the owner to
  compare figures by eye or to remember a value. Each is proven on a throwaway database of
  production's version and shape, then on a copy of production's snapshot.
- Declare a newly added stored field required in its record model, with no default, and hand the
  owner the migration file that writes it into every stored document of its collection. A default
  spared a migration hides a missing key the runtime then misreads, and the read-back passes a
  document lacking a defaulted key. A collection holding no document still takes its file, which
  counts, finds none and ends. A field that already carries a default for older documents loses it
  the same way: its file counts the documents lacking the key, writes the default's value into each,
  and counts again to 0. Where no value for it can be written, the file counts them and stops before
  its first write unless it finds none.
- A judge's field checks go into one `refuse_faults` call (`fl_backend/app/core/crud.py`), after its
  gates' `refuse`, never one call each: a second call is asked only once the first found nothing, so
  the person meets its fault a press later, and no check sees it. A check that means nothing once
  another failed sits in the same call behind a guard on that check (`None if base else find_…(…)`),
  and a helper returns its `FieldCheck` rather than raising its own. `docs/backend/overview.md`
  describes the two passes.
