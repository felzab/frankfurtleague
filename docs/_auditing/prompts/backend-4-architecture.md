# Backend pass 4 — architecture, dead code, tests, tooling

Paste into a fresh session (or run via `/audit:pass backend 4`).

---

Audit pass 4 of 4 on `./fl_backend`. Lens: ARCHITECTURE, CONSISTENCY, DEAD CODE, TEST STRATEGY,
TOOLING CONFIG.

Read `docs/_auditing/prompts/_shared-protocol.md` and follow it for the whole pass. Write the report
to `docs/audit/b4-architecture.md`. Read the b1–b3 reports first; cite, do not re-report.

BASELINE — verify before starting, do not trust: `ruff check` and `ruff format --check` over `app`
and `tests`, `pyright` over both, and `pytest` should all be clean/green (they were at the close of
the documentation programme; state the counts you actually observe). Findings in this pass are
therefore judgment calls, not lint output — do not pad the report with what the toolchain already
proves.

THE CHECKS, in priority order:

1. **MODULE-LAYOUT CONFORMANCE.** The convention is `app/api/<resource>/{router,schemas,services}`
   (+ `crud.py` where present) over `app/core/` infra and `app/shared/schemas/`. Which packages
   deviate, and which put query construction, business rules or validation in the wrong module?
   Where does logic sit in a router that belongs in a service (or vice versa)? Is the
   `crud.py`-sometimes-exists asymmetry principled or drift?

2. **LAYER AND IMPORT DIRECTION.** `core` must not import from `api`; `shared` must not import from
   either. Report every wrong-direction or cross-resource import with the chain. Where a
   cross-resource import is legitimate (e.g. season resolution used by three routers), say so and
   name it — the frontend's A7/ADR-0012 pattern — rather than flagging it raw.

3. **DEAD AND DUPLICATED CODE.** Unused schemas, adapters, helpers and config keys (the NEW-SC4
   class: a _duplicate_ model is worse than a dead one, because editing the wrong one is silently
   ineffective — sweep specifically for same-named or near-same classes). Repeated pipeline/filter
   logic that belongs in one helper. Anything `__init__.py` exports that nothing imports.

4. **TYPING AND MODERNISATION.** Seeded prior finding **BE-7**, open by design: several modules
   import `Mapping`/`Sequence`/`Optional`/`Callable` from `typing` instead of `collections.abc` /
   PEP-604 syntax, and the recorded decision is to enable ruff's `UP` rules and migrate **in one
   pass, never piecemeal**. This pass is that moment: measure what `UP` would flag, report the full
   inventory, and put the one-pass migration in the fix-priority list. Also: `pyright` strictness
   gaps, `Any` leaks, missing return types on public functions.

5. **TEST STRATEGY BY LAYER.** The existing suite is deliberately model-validation-only
   (`fl_backend/tests/README.md` records the scope and that routers/services/crud/auth were left
   "to the planned backend audit" — that is this audit). Produce the required table: layer
   (schemas / filter builders / services & pipelines / routers+auth / crud) | what exists | what a
   defect there would look like | recommended suite shape and cost. Design ONE strategy across the
   untested layers rather than growing the schema suite sideways. Respect the recorded quality
   bars: every test needs a positive baseline, use the `assert_rejects`-style field-naming fixture
   where more than one field could fail, no `parametrize` over possibly-empty discovery without a
   count floor, diagnostics on (`-ra --showlocals`, never `-q`).

6. **TEST QUALITY OF WHAT EXISTS.** Sample the current suites against those bars, and specifically
   against the wrong-bar lesson: "rejects a bad value" is not "the rule is right" — for every
   regex/anchor-carrying constraint, is there a test that fails if the anchor or mode flag is
   deleted? (The frontend programme found a security regex whose six rejection tests all passed
   with its `^` removed.)

7. **TOOLING CONFIG VS REALITY.** `pyproject.toml`: ruff rule selection and ignores (each ignore
   still justified?), dependency floors versus installed versions, dev/runtime dependency
   placement, pytest configuration, Python version pins consistent across pyproject / Dockerfile /
   CI. Does every configured tool actually run in `scripts/verify.sh` and CI, and does anything run
   there that is configured nowhere?

8. **DOCUMENTATION CURRENCY.** Module headers and endpoint docstrings were completed by the
   documentation programme with a same-commit currency rule. Sample for drift: headers whose
   invariants no longer match the code, docstrings contradicted by behaviour. Report drift as
   findings; do not rewrite documentation in this pass.

BOUNDARIES — not this pass: write→read consistency → b1 · contract divergence → b2 · auth,
injection, leakage → b3 · Dockerfile, compose, CI mechanics beyond "does the configured tool run" →
ops passes.
