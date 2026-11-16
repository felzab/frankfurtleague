# Backend tests

**Folder purpose:** the regression net under everything the backend refuses, composes and serves —
the constraints the frontend mirrors rather than enforces, plus what MongoDB actually does with
them. Beside it stands the made-up league the local and end-to-end stacks load, built from the same
documents.

## Folder overview

The tree mirrors `app/`'s folders, so a module's tests are in the folder you would look in, `api/`
being flat.

| Read                                                                     | For                                                                                                                                                  |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`../../docs/backend/overview.md`](../../docs/backend/overview.md#tests) | The two tiers and the `db` marker                                                                                                                    |
| `conftest.py`                                                            | The factory fixtures, the bound every async case runs under, and the session-scoped `mongod` replica set, yielded as a url                           |
| `config.py`                                                              | The settings an application under test is built with                                                                                                 |
| `app_client.py`                                                          | The application under test, built once per database and served in process to an HTTP client of the test's own                                        |
| `boot.py`                                                                | The image's own boot, run in a process of its own over an environment and a secrets folder a case writes                                             |
| `session_headers.py`                                                     | The actor's session headers as the frontend's server sends them (`fl_backend/tests/session_headers.py :: StampedHeaders`)                            |
| `database.py`                                                            | The bound every async case runs under, the database a case opens in its body, and the corpus a module holds across its cases, each judged after them |
| `worker.py`                                                              | The per-worker database naming, and the guard that holds every open to it                                                                            |
| `tier.py`                                                                | The refusal of a test that asks for a server without `@pytest.mark.db`                                                                               |
| `documents.py`                                                           | The stored shapes both tiers build from: seeds, and the rules and consent payload fixtures and rules models take                                     |
| `payloads.py`                                                            | The request bodies a test submits, built from a stored document, the factories' type and the bracket's source builders                               |
| `team_writes.py`                                                         | The team editor's save and a seat's block written as the routes write them, outside a request                                                        |
| `spiel_saves.py`                                                         | A season whose fixtures a case saves, and the save run by the route's own function                                                                   |
| `spielbestaetigung_corpus.py`                                            | A league whose fixtures the confirmation pass asks about, and the pass run by its route's own function                                               |
| `austritt_corpus.py`                                                     | A season one club leaves, the opponents its exit tells, and the notices owed                                                                         |
| `bewerbung_routes.py`                                                    | The routes a seat's link reaches, each called by its own function outside a request                                                                  |
| `bans.py`                                                                | The ban list under the suite's key, and a ban entered through its route rather than seeded                                                           |
| `acts.py`                                                                | The `action_log` rows a write left, the journal lines a case captured, and the administrator a direct call acts as                                   |
| `outbox.py`                                                              | The clock a case owes mail under, and one drain of the Postausgang as the frontend's drain settles it                                                |
| `delivery.py`                                                            | A mail the provider reported undeliverable, seeded straight into the Postausgang                                                                     |
| `isolation.py`                                                           | A rival run once inside a write, and what the write reports: its refusal's code, or that it committed                                                |
| `holds.py`                                                               | A write parked mid-transaction until a concurrent one commits (`fl_backend/tests/holds.py :: HeldCollection`)                                        |
| `erasure.py`                                                             | A person's erasure run outside a request by the person route's own function or the administrator route's, every collection handed in by name         |
| `erasure_corpus.py`                                                      | One person holding a record of every kind an erasure takes, and the league around them                                                               |
| `erasure_sweep_corpus.py`                                                | Pupils the erasure's season-after rule judges, the league they play in, and one run of the rule                                                      |
| `subject_corpus.py`                                                      | The addresses the subject lookup answers, each held on a seat, a pupil row and a referee row                                                         |
| `records.py`                                                             | The subject lookup's collections as a request holds them, any one replaced by name, and the sign-in's read outside a request                         |
| `handles.py`                                                             | The collections a handler takes, each wired off one database by its parameter's name, any one replaced by name                                       |
| `stored.py`                                                              | The one row a case reads back, by its id or by a filter, refused where none stands                                                                   |
| `whole_database.py`                                                      | Each collection holding a value anywhere in the database, so a value is looked for where nobody thought to put it                                    |
| `plans.py`                                                               | The server's plan for each read a call sends, which the index cases hold their scans to                                                              |
| `wire.py`                                                                | The commands a call sends, counted by name on a client of its own (`fl_backend/tests/wire.py :: commands_by_name`)                                   |
| `bracket_reference.py`                                                   | The hand-written bracket rows the draw's construction is held to                                                                                     |
| `made_up_seed.py`, `made_up_people.json`                                 | The made-up league the local and end-to-end stacks load, run by `scripts/ops/made_up_seed.sh`, and the people its journeys type                      |
| `shared/`                                                                | The custom types and shared schemas under `app/shared/`, and the tables the frontend's suite reads beside this one                                   |
| `core/`                                                                  | What `app/core/` declares, and what a real `mongod` does with it                                                                                     |
| `core/app_source.py`                                                     | The application as it mounts its routes, which the sweeps hold every operation to                                                                    |
| `core/context_canary_cases.py`                                           | The cases of the context an async case runs in, run whole by `core/test_case_context.py` in a pytest of their own                                    |
| `api/`                                                                   | The endpoint suites, split by concern rather than by entity                                                                                          |
| `api/address_change_harness.py`                                          | One person holding every record an address change moves, and every route driving a change                                                            |

## Read next

- [`../../docs/ops/spec.md`](../../docs/ops/spec.md) — which gate scope runs which tier
