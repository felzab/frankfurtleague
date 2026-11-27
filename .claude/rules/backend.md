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
- A judge asks each gate through `refuse` (`fl_backend/app/core/crud.py`) ahead of any box: a gate
  stops the write before any box means anything, as a closed season or a missing record does. A gate
  that means nothing until a field check found nothing waits behind that check's call, with a
  comment above it naming the check. Then it hands its independent field checks to one
  `refuse_faults` call, never one call each: a second call holding a check that means something
  alone is asked only once the first found nothing, so the answer names the first box at fault and
  the person meets the next on a later press. A check that means nothing once another failed sits in
  the same call behind a guard on that check (`None if base else find_…(…)`, `base` the other
  check's answer, read first), so one answer still names every box at fault. A helper that reads for
  a check returns its `FieldCheck` for its caller's one call rather than raising its own. A value a
  person typed is judged on its box by a `FieldFault` check under a `FieldCode` member, never by a
  gate, and never by calling a gate that `fl_backend/tests/core/test_gate_refusals.py :: ALLOWED`
  lists: each listed gate stands only where its reason does, as for an address read from a path, and
  an entry is added only with the reason a reviewer can check. A judge a change touches is brought
  to this order in the same change.
- What holds the refusal order: pyright refuses a `FieldFault` sent through `refuse` or raised bare,
  and an assignment to a refusal's `faults`; ruff refuses an import of `FieldRefusal` in the
  application outside `crud.py`; the sweep refuses a gate built by calling an imported `APIError` or
  `Subject` with a `FieldCode` member or a body-located `Subject` outside the sites it lists.
  Nothing sees two calls where one belongs, a missing guard, a gate asked in the wrong order, a new
  caller of a listed gate, a box's check written as a gate under a code outside `FieldCode`, a gate
  built through a subclass or a module attribute, or a subclass overriding `faults`.
