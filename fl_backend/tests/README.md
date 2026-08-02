# `fl_backend` tests

## What this suite is for

Wave 4 of the [audit remediation](../../docs/audit/0-remediation-ledger.md) moved roughly forty
validation rules out of the frontend and into the backend, on the principle that **the backend is the
source of truth and the frontend mirrors it**. Each rule was verified once, by hand, in a throwaway
script. This suite is that verification made permanent.

Without it, any of those constraints could be relaxed — to make a stubborn 422 go away, say — and
nothing would notice. That gap is ledger row **BE-5**.

## What it covers, and what it deliberately does not

**Covers:** Pydantic model validation, chiefly. Every constrained model accepts a valid payload,
rejects the specific bad value each constraint exists to stop, and still accepts the legitimate edge
cases that look like bad values (an empty `stadtteil`, a null `ergebnis` for an unplayed match, an
integral float `mietpreis`). Plus `FLGruppen.from_teams`, the one piece of real behaviour in the
schema layer, and `build_team_pipeline` — a pure function that returns a dict, so it fits the "no
database" boundary below while pinning rules that are otherwise only enforced by MongoDB.

**Does not cover:** routers, CRUD, authentication, or the database. There are **no HTTP calls and no
database connection** — every test is a dict in and a model or a pipeline out, which is why the whole
suite runs in well under a second and needs no fixtures beyond Python objects.

**The gap that boundary leaves, named because it is load-bearing.** Since
[ADR-0026](../../docs/_decisions/0026-team-statistics-are-derived-from-spiele.md) the league table is
computed by an aggregation pipeline, and `test_teams_pipeline.py` can assert what the pipeline *says*
but never what MongoDB *computes* from it. Executing it needs a database fixture this suite does not
have. Tracked in [`docs/roadmap/open-items.md`](../../docs/roadmap/open-items.md).

The same gap now covers a second rule.
[ADR-0029](../../docs/_decisions/0029-the-league-table-counts-the-gruppenphase.md) added a
`statistik_scope`, so the pipeline encodes *which* matches count as well as how they are counted — and
a scope that filtered on the wrong phase would still return a well-formed table. The tests pin that
the phase appears in the `$match` under `"gruppenphase"`, is absent under `"gesamt"`, and that nothing
else about the pipeline differs between the two.

That boundary is deliberate. A broader backend suite belongs with the planned `fl_backend` audit,
which will want one strategy across all layers rather than a schema suite designed twice.

## Layout

```
tests/
  conftest.py                    factory fixtures — one per model, returning a valid payload
  shared/                        mirrors app/shared/schemas/
    test_addresses.py
    test_kontakt.py
    test_custom.py               date/time/URL/ObjectId custom types
  api/                           mirrors app/api/
    test_teams.py                FLTeam, FLTeamStatistik, FLGruppen
    test_teams_pipeline.py       build_team_pipeline — the derived league table's rules
    test_spiele.py               FLSpiel, its embedded fields, the admin patch payload
    test_reference_models.py     spielorte, schiedsrichter, spieler, spieltage, saisons
    test_response_envelope.py    every *Response model carries `acknowledged`
```

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

It also runs as step 4 of the full gate, `./scripts/verify.sh`, alongside `ruff` over `app` and
`tests`.
