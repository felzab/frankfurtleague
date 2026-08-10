# Backend tests

**Verified against:** `7555ecd`, 2026-08-10\
**Folder purpose:** the regression net under the backend's validation rules — the constraints the
frontend mirrors rather than enforces, plus what MongoDB actually does with them.

## Folder overview

| Read                                                       | For                                                                   |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| [`../../docs/backend/spec.md`](../../docs/backend/spec.md) | The contract: the two tiers, the `db` marker, the conventions         |
| `conftest.py`                                              | The factory fixtures, and the session-scoped `mongod` container       |
| `config.py`                                                | The settings an application under test is built with                  |
| `shared/`                                                  | The custom types and shared schemas under `app/shared/`               |
| `core/`                                                    | The declared domain model, the database constraints, logging          |
| `api/`                                                     | One module per entity: models, filters, refusals, pipelines, guards   |
| `openapi_document.py`                                      | Not a test — builds and writes `openapi.json` (`--write` / `--check`) |

## Two tiers, and one of them needs Docker

`cd fl_backend && uv run pytest` runs the fast tier, which needs no daemon.
`uv run pytest -m db` runs the tier that starts a real `mongod`
([ADR-0023](../../docs/_decisions/0023-a-real-mongod-behind-a-deselected-marker.md)). Which tests
belong to which tier, why the split exists, and every convention the suite is written to are in the
backend spec sheet — `fl_backend/` is the backend surface, and the surface owns its contract.

The tree mirrors `app/`, so the test for a module is where you would look for it.

## Read next

- [`../../docs/backend/spec.md`](../../docs/backend/spec.md) — the suite's contract, in §1.6
- [`../../docs/ops/spec.md`](../../docs/ops/spec.md) — which gate scope runs which tier
