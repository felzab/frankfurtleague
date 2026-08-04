# ADR-0030 — Pipelines are tested against a real `mongod`, behind a marker the default suite deselects

**Status:** Accepted
**Date:** 2026-08-02
**Surface:** backend, ops
**Supersedes:** —
**Superseded by:** —
**Source:** Open item BE-11, itself left behind by
[ADR-0026](0026-team-statistics-are-derived-from-spiele.md): "whoever implements this should add
integration coverage rather than assume the pipeline is obvious."

## Context

`build_team_pipeline` is a Python function that returns a **dict MongoDB executes**. The schema suite
can prove the dict says the right thing; only a database can prove the right thing comes back.

That gap widened twice in one day.
[ADR-0026](0026-team-statistics-are-derived-from-spiele.md) made the league table derived rather than
stored, and [ADR-0029](0029-the-league-table-counts-the-gruppenphase.md) gave it a `statistik_scope`,
so the pipeline now decides **which** matches count as well as how. A scope filtering on the wrong
phase returns a well-formed table for a different competition, and every structural test passes. Both
changes were proved by rendering `/dashboard/saisontabelle` through the production image against the
live database and diffing the text — twice, by hand, correctly, and not repeatably.

The suite this had to fit into is the constraint. 250 tests in **0.33 seconds**, no HTTP, no database,
no Docker — which is why it is actually run. Any answer that made `pytest` slow or made it depend on a
daemon would be trading a real asset for a hypothetical one.

Three facts settled most of the question before preference entered it:

- **`mongomock` cannot run this pipeline at all.** It raises `NotImplementedError` for both `let` and
  `pipeline` on `$lookup`, and this pipeline uses both, twice. Not a fidelity trade-off; it does not
  execute one stage.
- **A read-only check against the live database tests the data, not the code.** The figures move with
  every result entered, so exact assertions rot within weeks, and the invariant-only version
  (`siege + unentschieden + niederlagen == anzahl_gespielte_spiele`) passes against a pipeline
  counting the wrong phase.
- **The money question does not exist.** The repository is public, so GitHub Actions is free on
  standard runners with no minute cap. This decision trades developer seconds, never euros.

## Decision

**A real `mongod` via testcontainers, behind a `db` marker that `pyproject.toml` deselects by
default, executed in its own parallel CI job.**

- `pyproject.toml` registers the marker and adds `-m "not db"` to `addopts`. A command-line `-m`
  overrides it, because addopts are prepended rather than merged — so `pytest -m db` runs exactly the
  tests the default run excludes.
- `tests/api/conftest.py` starts `mongo:8` once per session and seeds a five-team, eight-match corpus
  sized so every expected figure can be worked out on paper. The `testcontainers` import sits
  **inside** the fixture, so the default run never loads it.
- `.github/workflows/verify.yml` gains a `backend-db` job running `pytest -m db`. It is a **separate
  job, not a step**: jobs run concurrently, so a pull request waits on the slower one and this changes
  the wait by nothing.
- `scripts/verify.sh` keeps running the **default** tier at step 4, so the gate gains nothing to run
  and `--quick` still needs no Docker daemon. Only its step label and header comment changed.

**The marker is the load-bearing half.** It is a property of the test suite, so no CI restructuring
can invalidate it; the job is a property of the pipeline, whose current shape
`.github/workflows/verify.yml` records — `pytest -m db` selects these tests under any arrangement.

## Consequences

**What it costs**, all measured on 2026-08-02:

|                                                 | Before             | After                            |
| ----------------------------------------------- | ------------------ | -------------------------------- |
| `pytest`                                        | 250 tests, 0.33s   | 250 tests, **0.42s**             |
| `pytest -m db`                                  | —                  | 21 tests, 5.1s warm / 23.6s cold |
| `verify.sh --quick`, and its Docker requirement | unchanged          | unchanged — still none           |
| Pull-request CI wall clock                      | 136s median (n=27) | **136s**                         |
| Dev dependencies                                | 2                  | 8                                |
| Money                                           | €0                 | €0                               |

The 0.33 → 0.42 second default run is real and is the honest cost: pytest still **collects** the 21
`db` tests before deselecting them. Ninety milliseconds is worth naming rather than rounding away,
and it is the price of one suite with two speeds instead of two suites.

Six packages arrive with testcontainers — `docker`, `requests`, `charset-normalizer`, `wrapt`,
`pywin32`, and testcontainers itself. All dev-group; none reaches the image.

**What it enables.**

- The forfeit rule, the scope rule, the season filter and the goal orientation are now executed
  rather than described. The corpus reproduces ADR-0029's live measurement exactly — Helmholtz at 3
  matches and 4 points under `"gruppenphase"`, 4 and 7 under `"gesamt"` — from invented documents.
- **The fixture is the backend audit's first brick, not a fork.** Backend pass 4 wants one test
  strategy across routers, CRUD and auth; every one of those layers needs a real database, so this is
  the component that pass cannot design around. It inherits a working `mongod` fixture and decides
  the layer shapes on top.
- A stored `statistik` on the junction row is now proven to be ignored, which is the claim
  [ADR-0026](0026-team-statistics-are-derived-from-spiele.md) rests on and DB-3 is about to act on.

**A constraint this creates.** A test that needs a database must carry `@pytest.mark.db` or it will
run in the fast suite and fail there for a reason that looks unrelated. `--strict-markers` turns a
misspelled marker into an error, which covers the typo but not the omission.

## Alternatives considered

**`mongomock`.** Rejected on capability, not preference — see Context. It would not execute one stage
of this pipeline.

**A read-only check against the live Atlas database.** The cheapest thing that could work, and the
approach both previous pipeline changes used. Rejected as a permanent net: it tests today's data
rather than the code, its assertions rot as results are entered, and it cannot express the
Helmholtz 3-versus-4 divergence durably because next season's Helmholtz has different numbers. It
remains the right tool for a one-off measurement, which is what it was used for.

**A GitHub Actions `services: mongo` container instead of testcontainers.** Zero new dependencies —
`pymongo` is already installed via motor — and it is the cheaper mechanism in CI. Rejected because the
tests would then run **only** in CI: a broken pipeline would be discovered after pushing rather than
before, which removes most of the reason to have them. One mechanism that behaves identically on a
laptop and on a runner is worth six dev packages.

**The `db` tests in the default suite, with no marker.** Simpler — no marker, no second job. Rejected
because it makes Docker a prerequisite of `pytest` and of `verify.sh --quick`, which is the path CI
runs on every pull request and the owner runs on Windows. A test suite you must start a daemon to run
is a test suite that gets run less.

**A step inside the existing `verify` job.** Rejected on measurement: it puts the image pull on the
critical path, taking pull-request CI from 136s to an estimated 155–180s, for no benefit over a
concurrent job that finishes early anyway.

**Waiting for the backend audit to design one strategy.** The recorded plan, and the reason BE-11 was
an entry rather than a task. Rejected because the audit has no date, the pipeline computes a
public-facing number, and it has been edited twice on the strength of a hand measurement. The audit's
concern is the _shape of suites per layer_, which one executed pipeline module does not constrain.
