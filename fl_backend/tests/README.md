# Backend tests

**Folder purpose:** the regression net under everything the backend refuses, composes and serves —
the constraints the frontend mirrors rather than enforces, plus what MongoDB actually does with
them.

## Folder overview

| Read                                                       | For                                                                                                                                    |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [`../../docs/backend/spec.md`](../../docs/backend/spec.md) | The contract: the two tiers, the `db` marker, the conventions                                                                          |
| `conftest.py`                                              | The factory fixtures, and the session-scoped `mongod` servers, each yielded as a url                                                   |
| `config.py`                                                | The settings an application under test is built with                                                                                   |
| `app_client.py`                                            | The application under test, served in process to an HTTP client of the test's own                                                      |
| `grants.py`                                                | The actor check answered from a fixed set of grants, for an application whose database never answers                                   |
| `actor_tokens.py`                                          | Actor tokens signed as the frontend's server signs them, under a pair made per run (`fl_backend/tests/actor_tokens.py :: SignedActor`) |
| `database.py`                                              | The database a db test opens for itself: built once, emptied per call                                                                  |
| `worker.py`                                                | The per-worker database naming, and the guard that holds every open to it                                                              |
| `tier.py`                                                  | The refusal of a test that uses a database without `@pytest.mark.db`                                                                   |
| `documents.py`                                             | The stored shapes both tiers build from: seeds, and the rules and consent payload fixtures and rules models take                       |
| `payloads.py`                                              | The request bodies a test submits, built from a stored document                                                                        |
| `bans.py`                                                  | The ban list under the suite's key, and a ban entered through its route rather than seeded                                             |
| `isolation.py`                                             | A rival run once inside a write, and what the write reports: its refusal's code, or that it committed                                  |
| `holds.py`                                                 | A write parked mid-transaction until a concurrent one commits (`fl_backend/tests/holds.py :: HeldCollection`)                          |
| `bracket_reference.py`                                     | The hand-written bracket rows the draw's construction is held to                                                                       |
| `shared/`                                                  | The custom types and shared schemas under `app/shared/`                                                                                |
| `core/`                                                    | What `app/core/` declares, and what a real `mongod` does with it                                                                       |
| `api/`                                                     | The endpoint suites, split by concern rather than by entity ([spec §1.6](../../docs/backend/spec.md#16-the-test-suite))                |
| `openapi_document.py`                                      | Not a test — builds and writes `openapi.json` (`--write` / `--check`)                                                                  |

## Two tiers, and one of them needs Docker

`cd fl_backend && uv run pytest` runs the fast tier, which needs no daemon.
`uv run pytest -m db` runs the tier that starts a real `mongod`.

The tree mirrors `app/`'s folders, so a module's tests are in the folder you would look in, `api/`
being flat.

## Read next

- [`../../docs/ops/spec.md`](../../docs/ops/spec.md) — which gate scope runs which tier
