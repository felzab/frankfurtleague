# `fl_backend` tests

## What this suite is for

Wave 4 of the [audit remediation](../../docs/audit/0-remediation-ledger.md) moved roughly forty
validation rules out of the frontend and into the backend, on the principle that **the backend is the
source of truth and the frontend mirrors it**. Each rule was verified once, by hand, in a throwaway
script. This suite is that verification made permanent.

Without it, any of those constraints could be relaxed — to make a stubborn 422 go away, say — and
nothing would notice. That gap is ledger row **BE-5**.

## What it covers, and what it deliberately does not

**Covers:** Pydantic model validation only. Every constrained model accepts a valid payload, rejects
the specific bad value each constraint exists to stop, and still accepts the legitimate edge cases
that look like bad values (an empty `stadtteil`, a null `ergebnis` for an unplayed match, an integral
float `mietpreis`). Plus `FLGruppen.from_teams`, the one piece of real behaviour in the schema layer.

**Does not cover:** routers, services, CRUD, authentication, or the database. There are **no HTTP
calls and no database connection** — every test is a dict in and a model out, which is why the whole
suite runs in well under a second and needs no fixtures beyond Python objects.

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

## Running

```bash
cd fl_backend && uv run pytest
```

It also runs as step 4 of the full gate, `./scripts/verify.sh`, alongside `ruff` over `app` and
`tests`.
