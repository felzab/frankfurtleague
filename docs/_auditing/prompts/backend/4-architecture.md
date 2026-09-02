# Backend pass 4 — architecture, excess, tests, tooling

Audit pass `backend 4` on `./fl_backend`. Lens: ARCHITECTURE, CONSISTENCY, EXCESS, TEST STRATEGY,
TOOLING CONFIG.

Read `docs/_auditing/prompts/_shared-protocol.md` and follow it for the whole pass. Write the report
to `docs/audit/programme/b4-architecture.md`.

DELIVERABLE: required tables — the excess table (check 3, in the shape the shared protocol sets) and
the per-layer test-strategy table (check 5). The test-strategy table must design ONE strategy across
the untested layers rather than a list of per-layer suggestions.

BASELINE — run these before starting, and state the counts you observe: `ruff check` and
`ruff format --check` over `app` and `tests`, `pyright` over both, and `pytest`. **A non-green
baseline ends the pass** — report it and stop. Green, they define this pass's floor: findings here
are judgment calls, not lint output.

THE CHECKS, in priority order:

1. **MODULE-LAYOUT CONFORMANCE.** The convention is `app/api/<resource>/{router,schemas,services}`
   plus `crud.py` where present, over `app/core/` infra and `app/shared/schemas/`. Which packages
   deviate, and which put query construction, business rules or validation in the wrong module? Where
   does logic sit in a router that belongs in a service, or the reverse? Is the
   `crud.py`-sometimes-exists asymmetry principled or drift?

2. **LAYER AND IMPORT DIRECTION.** `core` must not import from `api`; `shared` must not import from
   either. Report every wrong-direction or cross-resource import with its chain. Where a
   cross-resource import is legitimate — season resolution used by three routers, for example — name
   it as legitimate and say why, following the aggregator pattern ratified on the frontend, rather
   than flagging it raw.

3. **EXCESS — code that should not exist.** The candidates for this surface:

   | Class         | The candidate                                                                                  |
   | ------------- | ---------------------------------------------------------------------------------------------- |
   | `duplicated`  | The same model, pipeline stage, filter or helper defined in two or more modules                |
   | `one-caller`  | An abstraction — wrapper, dependency, adapter, helper — with a single call site                |
   | `hand-rolled` | A reimplementation of what FastAPI, Pydantic, PyMongo or the standard library already provides |
   | `simpler`     | A plainly simpler construction reaching the same result                                        |
   | `dead-export` | A schema, adapter, helper or `__init__.py` export nothing imports                              |
   | `dead-config` | A settings key, ruff ignore, pytest marker or dependency nothing reads                         |
   - **A duplicated model is worse than a dead one**, because editing the wrong copy is silently
     ineffective. Sweep specifically for same-named and near-identical classes.
   - `.claude/rules/backend.md` bears directly on this check: the `$jsonSchema` validators duplicate the
     Pydantic models by hand on purpose, and `app/core/domain.py` is a declaration nothing may import
     from `app/`.

4. **TYPING AND MODERNISATION.** A known open item in `docs/_roadmap/open-items.md`: several modules
   import `Mapping` / `Sequence` / `Optional` / `Callable` from `typing` instead of
   `collections.abc` and PEP-604 syntax, and the recorded decision is to enable ruff's `UP` rules and
   migrate **in one pass, never piecemeal**. This pass is that moment: measure what `UP` would flag,
   report the full inventory, and put the one-pass migration in the fix-priority list. Also:
   `pyright` strictness gaps, `Any` leaks, missing return types on public functions.

5. **TEST STRATEGY BY LAYER.** Establish what the suite actually covers before judging it. **A real
   `mongod` fixture already exists**, behind a `db` marker the default tier deselects, so this pass
   decides the layer shapes on top of it rather than choosing a mechanism. Produce the required
   table: layer (schemas / filter builders / services and pipelines / routers and auth / crud) | what
   exists | what a defect there would look like | recommended suite shape and cost. Design ONE
   strategy across the untested layers rather than growing the schema suite sideways. Respect the
   recorded quality bars: every test needs a positive baseline, use the `assert_rejects`-style
   field-naming fixture where more than one field could fail, no `parametrize` over possibly-empty
   discovery without a count floor, diagnostics on (`-ra --showlocals`, never `-q`).

6. **TEST QUALITY OF WHAT EXISTS.** Sample the current suites against those bars, and against the
   wrong-bar problem: **"rejects a bad value" is not "the rule is right"**
   (`docs/_auditing/lessons.md` §3). For every constraint carrying a regex, an anchor or a mode flag,
   is there a test that _fails_ when that part is removed?

7. **TOOLING CONFIG VS REALITY.** `pyproject.toml`: ruff rule selection and ignores (each ignore
   still justified?), dependency floors versus installed versions, dev and runtime dependency
   placement, pytest configuration, Python version pins consistent across `pyproject`, the Dockerfile
   and CI. Does every configured tool actually run in `scripts/gate/verify.sh` and CI, and does anything
   run there that is configured nowhere?

BOUNDARIES — not this pass: write→read consistency → b1 · contract divergence → b2 · auth, injection
and leakage → b3 · Dockerfile, compose and CI mechanics beyond "does the configured tool run" → the
ops passes · module headers, docstrings and comment drift → `/docs:audit`, which reads every comment
in this tree against `docs/standard.md`.
