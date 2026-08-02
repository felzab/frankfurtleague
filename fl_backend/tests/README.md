# `fl_backend` tests

## What this suite is for

Wave 4 of the [audit remediation](../../docs/audit/0-remediation-ledger.md) moved roughly forty
validation rules out of the frontend and into the backend, on the principle that **the backend is the
source of truth and the frontend mirrors it**. Each rule was verified once, by hand, in a throwaway
script. This suite is that verification made permanent.

Without it, any of those constraints could be relaxed — to make a stubborn 422 go away, say — and
nothing would notice. That gap is ledger row **BE-5**.

## What it covers, and what it deliberately does not

Since 2026-08-02 it covers a second thing the models cannot check about themselves: the database's own
`$jsonSchema` validators and unique indexes
([ADR-0027](../../docs/_decisions/0027-the-database-enforces-its-own-invariants.md)), and whether they
have drifted from the models they mirror.

**Covers:** Pydantic model validation, chiefly. Every constrained model accepts a valid payload,
rejects the specific bad value each constraint exists to stop, and still accepts the legitimate edge
cases that look like bad values (an empty `stadtteil`, a null `ergebnis` for an unplayed match, an
integral float `mietpreis`). Plus `FLGruppen.from_teams`, the one piece of real behaviour in the
schema layer, and `build_team_pipeline` — both what it *says* and, since
[ADR-0030](../../docs/_decisions/0030-a-real-mongod-behind-a-deselected-marker.md), what MongoDB
*computes* from what it says.

**Does not cover:** routers, CRUD, or authentication.

## Two tiers, and the marker that separates them

[ADR-0030](../../docs/_decisions/0030-a-real-mongod-behind-a-deselected-marker.md), 2026-08-02.

| Tier                       | Selected by            | Needs Docker | Cost                    |
| -------------------------- | ---------------------- | ------------ | ----------------------- |
| **Default** — 294 tests    | everything unmarked    | no           | 0.39s                   |
| **`db`** — 52 tests        | `@pytest.mark.db`      | yes          | 13.0s warm, 21.2s cold |

`pyproject.toml` puts `-m "not db"` in `addopts`, so a bare `pytest` runs the fast tier only. A
command-line `-m` overrides it — addopts are prepended rather than merged — so `pytest -m db` runs
exactly what the default run skips.

**Why a real database was unavoidable here.** `build_team_pipeline` returns a dict that MongoDB
executes. A structural test proves the dict says the right thing; only an engine proves the right
thing comes back, and a `$cond` reading the wrong side of a match would pass every structural
assertion. `mongomock` is not an option — it raises `NotImplementedError` for both `let` and
`pipeline` on `$lookup`, and this pipeline uses both.

**Why the marker, rather than just adding them.** The fast tier is the asset: a suite that runs in
under half a second gets run. Putting a container behind every `pytest` invocation would also make
Docker a prerequisite of `./scripts/verify.sh --quick`, which is what CI runs on every pull request.

`scripts/verify.sh` therefore runs the **default** tier only. The `db` tier runs in its own parallel
CI job (`backend-db` in `.github/workflows/verify.yml`), which costs a pull request no extra wall
clock because it finishes inside the longer `verify` job.

**What is still uncovered, named because it is load-bearing.** Routers, CRUD and auth have no tests
at all. That boundary is deliberate and belongs to the planned `fl_backend` audit, which wants one
strategy across those layers rather than a suite designed twice — and which now inherits a working
`mongod` fixture rather than having to invent one.

## Layout

```
tests/
  conftest.py                    factory fixtures — one per model, returning a valid payload,
                                 plus the session-scoped mongod container   [db tier only]
  shared/                        mirrors app/shared/schemas/
    test_addresses.py
    test_kontakt.py
    test_custom.py               date/time/URL/ObjectId custom types
  core/                          mirrors app/core/
    test_constraints.py          the validators and indexes read as data, incl. the drift guard
    test_constraints_execution.py      …and what MongoDB enforces from them   [db]
  api/                           mirrors app/api/
    conftest.py                  the seeded league — `db` tier only
    test_teams.py                FLTeam, FLTeamStatistik, FLGruppen
    test_teams_pipeline.py       build_team_pipeline — what the pipeline says
    test_teams_pipeline_execution.py   …and what MongoDB computes from it   [db]
    test_spiele.py               FLSpiel, its embedded fields, the admin patch payload
    test_reference_models.py     spielorte, schiedsrichter, spieler, spieltage, saisons
    test_response_envelope.py    every *Response model carries `acknowledged`
```

Both `*_execution.py` files pair with a structural sibling, and neither of a pair replaces the other:
the structural one fails when a rule is **deleted**, the executing one when a rule is present but
**wrong**.

**The container fixture lives in the root `conftest.py`**, not in `api/`, because two suites want a
database now. It is session-scoped, so one `mongod` serves both. It yields the *container* rather than
a client: the pipeline suite reads with pymongo and the constraint suite drives Motor, which needs the
connection URL.

**One test here guards a rule nothing else can.**
`test_constraints.py::test_every_mirrored_model_matches_its_validator` compares each Pydantic model's
stored field names against the `$jsonSchema` its collection carries, and fails naming the field. That
is the mechanism that makes a third copy of the schema affordable
([ADR-0031](../../docs/_decisions/0031-the-third-copy-of-the-schema-is-checked-not-generated.md)) —
change a model, forget `app/core/constraints.py`, and the default tier says so.

The tree mirrors `app/`, so the test for a module is where you would look for it.

There are **no `__init__.py` files** — `pyproject.toml` sets `--import-mode=importlib`, pytest's
recommended mode for new suites, which needs none and cannot suffer same-basename collisions.

## Conventions

- **Fixtures are factories, not constants.** Every fixture returns a callable producing a fresh valid
  payload; a test calls it with the one field it wants to break. No test can leak state into another,
  and each case reads as "this payload, but with X wrong".
- **Payloads are keyed as MongoDB serves them** — `_id`, not `id` — because that is the validation
  alias the models declare, so the tests exercise the shape production actually validates.
- **Reject-cases are parametrised.** One `pytest.mark.parametrize` per rule, listing every value that
  must fail, so adding a case is one line.
- **Comments explain the *why*, not the assertion.** Where a constraint exists because of a specific
  defect, the test says so — see `test_spiele.py`'s `ergebnis` cases, which document the value that
  used to render as a loss for both teams.
- **A test that touches the database carries `@pytest.mark.db`.** Without it the test runs in the
  fast tier, where there is no container, and fails for a reason that looks unrelated to what it is
  testing. `--strict-markers` catches a misspelled marker; nothing catches an omitted one.
- **The `db` corpus is documented once, in `tests/api/conftest.py`.** Its header derives every
  expected figure by hand; the tests assert against them and do not restate the arithmetic. Each of
  the five seeded teams exists to make exactly one invariant observable.
- **Assert *which* field failed when more than one could.** A bare `pytest.raises(ValidationError)`
  passes whatever went wrong, so a test can stay green while the constraint it names goes
  unenforced. The `assert_rejects` fixture takes the model, the payload and the field, and fails
  with the list of fields that actually failed. Use it wherever the payload is hand-built rather
  than produced by a factory.

## When something fails

The output is configured to tell you where, not just that:

- `-ra` prints a reason line per non-passing test, so failures are named in the summary rather than
  only in the scrollback.
- `--showlocals` includes the fixture values in the traceback — you see the exact payload that
  produced the failure, not just the assertion.
- `-q` is deliberately **not** used: quiet mode suppresses precisely that detail, and the suite runs
  in well under a second, so verbosity costs nothing.

A failure therefore names the file and line, the expected and actual values, the parsed model, and
appears again in a `short test summary info` block at the end.

## Running

```bash
cd fl_backend && uv run pytest
```

That is the fast tier — 294 tests, no Docker. To run the ones that need a real `mongod`:

```bash
cd fl_backend && uv run pytest -m db
```

The first run pulls `mongo:8` (about 1.3 GB) if it is not already cached; afterwards the container
starts in under two seconds. Everything is torn down when the session ends.

The fast tier also runs as step 4 of the full gate, `./scripts/verify.sh`, alongside `ruff` over
`app` and `tests`. The `db` tier deliberately does **not**, so the gate needs no daemon on the
`--quick` path; it runs in the `backend-db` CI job instead.
