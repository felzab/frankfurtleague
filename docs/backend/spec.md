# Backend — spec

**Verified against:** `a1dddec`, 2026-08-05
**Scope:** `fl_backend/`

---

## 1. Endpoints

All paths are prefixed `/api/v{API_VERSION}`. Guards are declared at router level and inherited by
every endpoint in the router.

### Read routers — guard `verify_access_base`

| Method | Path                       | Handler                    | Notes                                                                                   |
| ------ | -------------------------- | -------------------------- | --------------------------------------------------------------------------------------- |
| GET    | `/spiele`                  | `spiele/router.py`         | Filters below; omitted `saison_id` means the current season                             |
| GET    | `/spiele/{spiel_id}`       | `spiele/router.py`         | Unused by the frontend                                                                  |
| GET    | `/teams`                   | `teams/router.py`          | Two response shapes, discriminated by `format`; `statistik_scope` picks the table (I1c) |
| GET    | `/teams/{team_id}`         | `teams/router.py`          | `getTeam(id)` — the two team detail pages. `format: "single"`                           |
| GET    | `/spieler`                 | `spieler/router.py`        | **No current-season default** — see I4                                                  |
| GET    | `/spieler/{spieler_id}`    | `spieler/router.py`        | Unused by the frontend                                                                  |
| GET    | `/spieltage`               | `spieltage/router.py`      | Omitted `saison_id` means the current season                                            |
| GET    | `/spieltage/{spieltag_id}` | `spieltage/router.py`      | Unused by the frontend                                                                  |
| GET    | `/saisons`                 | `saisons/router.py`        |                                                                                         |
| GET    | `/saisons/current`         | `saisons/router.py`        | **Declared before `/{saison_id}`** and must stay there — see I18                        |
| GET    | `/saisons/{saison_id}`     | `saisons/router.py`        | Unused by the frontend                                                                  |
| GET    | `/spielorte`               | `spielorte/router.py`      |                                                                                         |
| GET    | `/spielorte/{spielort_id}` | `spielorte/router.py`      | Unused by the frontend                                                                  |
| GET    | `/schiedsrichter`          | `schiedsrichter/router.py` | Only ever called with no arguments by the frontend                                      |
| GET    | `/schiedsrichter/{id}`     | `schiedsrichter/router.py` | Unused by the frontend                                                                  |

**Six of the seven single reads have no caller**, and that is deliberate: every resource is addressable
the same way whether or not something currently uses it
([ADR-0034](../_decisions/0034-the-write-path-is-resource-first-in-a-second-router.md)).

### Write routers — guard `verify_access_admin`

One `admin_router.py` per slice, beside the reads for the resource it changes
([ADR-0034](../_decisions/0034-the-write-path-is-resource-first-in-a-second-router.md)). **30 mutations
across seven slices**, each addressed resource-first with the id in the path.
`tests/api/test_admin_guard.py` walks `app.openapi()["paths"]` and fails if any of them loses its guard.

| Method | Path                                                   | Effect                                                                    |
| ------ | ------------------------------------------------------ | ------------------------------------------------------------------------- |
| GET    | `/spiele/action_required`                              | Matches needing attention. Admin-authorized, and uncached (ADR-0013)      |
| PATCH  | `/spiele/{spiel_id}`                                   | Writes one match; the league table follows from it on read. See §3        |
| POST   | `/teams`                                               | Creates a club                                                            |
| PATCH  | `/teams/{team_id}`                                     | Renames a club **and fans it out** into `spiele`, with no exception       |
| DELETE | `/teams/{team_id}`                                     | Soft delete — stamps `inactive_since`                                     |
| POST   | `/teams/{team_id}/reactivate`                          | Clears `inactive_since`                                                   |
| POST   | `/teams/{team_id}/saisons`                             | Adds the club to a season. `saison_id` and `gruppe` on the body           |
| PATCH  | `/teams/{team_id}/saisons/{saison_id}`                 | Group and disqualification. **No DELETE** — see I19                       |
| POST   | `/spieler`                                             | Creates a person                                                          |
| PATCH  | `/spieler/{spieler_id}`                                | Updates a person                                                          |
| DELETE | `/spieler/{spieler_id}`                                | Soft delete                                                               |
| POST   | `/spieler/{spieler_id}/reactivate`                     | Clears `inactive_since`                                                   |
| POST   | `/spieler/{spieler_id}/saisons`                        | Adds a squad row. 409 on a repeat — see I20                               |
| PATCH  | `/spieler/{spieler_id}/saisons/{saison_id}`            | Team, number, position and stufe for that season                          |
| DELETE | `/spieler/{spieler_id}/saisons/{saison_id}`            | Soft delete of the squad row, independent of the person                   |
| POST   | `/spieler/{spieler_id}/saisons/{saison_id}/reactivate` | Brings a player back into a season they already have a row for            |
| POST   | `/saisons`                                             | Creates a season, always `future` — see I18                               |
| PATCH  | `/saisons/{saison_id}`                                 | Dates and scoring rules. `status` is on no payload                        |
| POST   | `/saisons/{saison_id}/activate`                        | **The only path that writes `status`** — see I18                          |
| POST   | `/spieltage`                                           | Creates a matchday                                                        |
| PATCH  | `/spieltage/{spieltag_id}`                             | Updates a matchday; `order_val` is what the bracket orders by             |
| DELETE | `/spieltage/{spieltag_id}`                             | Soft delete                                                               |
| POST   | `/spieltage/{spieltag_id}/reactivate`                  | Clears `inactive_since`                                                   |
| POST   | `/spielorte`                                           | Creates a venue; builds `maps_link` server-side                           |
| PATCH  | `/spielorte/{spielort_id}`                             | Updates a venue **and fans the change out** into every match embedding it |
| DELETE | `/spielorte/{spielort_id}`                             | Soft delete                                                               |
| POST   | `/spielorte/{spielort_id}/reactivate`                  | Clears `inactive_since`                                                   |
| POST   | `/schiedsrichter`                                      | Creates a referee                                                         |
| PATCH  | `/schiedsrichter/{id}`                                 | Updates a referee **and fans the name out** into every match embedding it |
| DELETE | `/schiedsrichter/{id}`                                 | Soft delete                                                               |
| POST   | `/schiedsrichter/{id}/reactivate`                      | Clears `inactive_since`                                                   |

**There is no `DELETE /saisons/{id}`**, and none on `/teams/{team_id}/saisons/{saison_id}` either
([ADR-0033](../_decisions/0033-one-active-season-and-one-path-to-it.md)).

### `system` router — mixed guards

| Method | Path               | Guard                            |
| ------ | ------------------ | -------------------------------- |
| GET    | `/system/is_live`  | **none** — container healthcheck |
| GET    | `/system/is_ready` | `verify_access_system`           |
| GET    | `/system/info`     | `verify_access_system`           |

### Unrouted

`GET /` returns the string `"Hello World"` (`app/main.py`). Not used by anything.

## 2. `GET /spiele` parameters

| Param          | Type                                                                | Default            | Notes                                                                                                   |
| -------------- | ------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------- |
| `saison_id`    | `str \| None`                                                       | **current season** | Resolved in the handler, not as a field default — a default is a constant and cannot query the database |
| `saison_phase` | `playoffs \| gruppenphase \| viertelfinale \| halbfinale \| finale` | `None`             | `playoffs` is an alias compiled to `saison_phase != "gruppenphase"`; it is not a stored value           |
| `spiel_status` | `ausstehend \| vergangen \| heute \| abgesagt \| unbekannt`         | `None`             | Compiled to a `datum` / `is_canceled` filter. `unbekannt` has no branch and filters nothing             |
| `team_id`      | `ObjectId`                                                          | `None`             | Matches either side (`$or` over `team1`/`team2`)                                                        |
| `limit`        | `int`                                                               | `1024`             | `ge=1, le=1024`                                                                                         |
| `sort_by`      | `datum \| uhrzeit \| spiel_nr \| saison_phase`                      | `datum`            | Always tie-broken by `spiel_nr`                                                                         |
| `order`        | `asc \| desc`                                                       | `asc`              |                                                                                                         |

## 3. `PATCH /spiele/{spiel_id}` — the match write path

| Step | Behaviour                                                                        | What breaks if changed                                                       |
| ---- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1    | `ergebnis` derived as `f"{team1.tore}:{team2.tore}"`, `None` if either is `None` | A client could submit a result disagreeing with the goals rendered beside it |
| 2    | Payload written wholesale with `$set`                                            | A field absent from the payload is **overwritten**, not preserved            |
| 3    | A `None` return means no document matched — the 404 branch                       | A missing match would be reported as a successful edit                       |

**One document, and still a transaction.** It was a two-document write until
[ADR-0026](../_decisions/0026-team-statistics-are-derived-from-spiele.md) made team statistics derived
rather than stored; the session stays so the endpoint's atomicity does not have to be re-established
the next time it grows.

**Nothing here touches a team.** The league table is computed from the match documents by `GET /teams`
(§5, I1), so entering a result moves the table on the next read, with no second write to forget. The
frontend still invalidates the `teams` cache tags in the same action — the data it caches changed even
though no team document did.

## 4. Error codes and failure responses

**Every failure response body is `{error_code, correlation_id}`** — the full code table, the field
contract and the correlation-id design are in [`docs/logging.md`](../logging.md), which every
failure line and response must follow ([ADR-0039](../_decisions/0039-one-correlation-id-per-request-one-document-per-line.md)).
The invariant the tests pin here: the code on the wire and in the log is the **exception's own**
(`fl_backend/app/core/exceptions.py :: BaseAPIException`), checked by
`fl_backend/tests/api/test_error_responses.py`.

**409 arrived with the write path.** A `DuplicateKeyError` was an unhandled 500 while nothing could
write; with seven create endpoints it is an ordinary outcome, so a dedicated handler maps it
([ADR-0034](../_decisions/0034-the-write-path-is-resource-first-in-a-second-router.md)). Starlette
resolves handlers by walking `type(exc).__mro__`, so registration order does not matter — the most
specific registered class wins.

## 4a. Environment

Declared once as a pydantic-settings model (`fl_backend/app/core/config.py :: BackendConfig`);
fields without a default are required at boot and the process refuses to start without them.

| Variable                      | Constraint                                      | Default    |
| ----------------------------- | ----------------------------------------------- | ---------- |
| `API_TRUSTED_HOSTS`           | comma-separated host list                       | — required |
| `API_CORS_ALLOWED_ORIGINS`    | comma-separated origin list                     | — required |
| `MONGODB_URI`                 | must start `mongodb://` or `mongodb+srv://`     | — required |
| `DB_BASE_NAME`                | string                                          | — required |
| `DB_SERVER_SELECTION_TIMEOUT` | int, ms                                         | `15000`    |
| `DB_MIN_CONNECTIONS`          | int                                             | `5`        |
| `DB_MAX_CONNECTIONS`          | int                                             | `100`      |
| `INTERNAL_API_KEY_*`          | `BASE` / `SYSTEM` / `ADMIN`, each a `SecretStr` | — required |
| `LOG_LEVEL_APP`               | `DEBUG`…`CRITICAL`, case-normalised             | `INFO`     |
| `LOG_LEVEL_DB`                | same vocabulary, for motor/pymongo              | `WARNING`  |
| `LOG_FORMAT`                  | `json` \| `console`, case-normalised            | **`json`** |

`LOG_FORMAT` defaults to the **production** format on purpose: a `.env` that omits it must not
colourise the container stream ([`docs/logging.md`](../logging.md)). `API_VERSION` is deliberately
not here — it is a constant of the code (`fl_backend/app/core/config.py :: API_VERSION`).

## 5. Invariants

| #   | Invariant                                                                                                                                                                                                                                | Enforced by                                                                                                                                 | Breaks how                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | Team statistics are **derived from `spiele`**, never stored ([ADR-0026](../_decisions/0026-team-statistics-are-derived-from-spiele.md))                                                                                                  | `build_statistik_lookup_stage` in `teams/services.py`                                                                                       | A stored or cached copy reintroduces the drift the ADR removed — that is the decision reversed, not an optimisation                                                                                                                                                                                                          |
| I1a | A match counts towards the table **exactly when it carries an `ergebnis`**; `is_canceled` is not consulted, because a cancelled match with a result is a forfeit                                                                         | The `$match` inside that lookup                                                                                                             | Filtering cancelled matches out drops three of season 2026's results and looks like a correction while doing it                                                                                                                                                                                                              |
| I1b | Points come from the season's `rules.win_points` / `draw_points`                                                                                                                                                                         | The final `$project` inside that lookup                                                                                                     | A hardcoded 3/1/0 silently ignores a season that scores differently                                                                                                                                                                                                                                                          |
| I1c | `statistik_scope` defaults to **`gruppenphase`**, so the table a caller gets by saying nothing is the group standing ([ADR-0029](../_decisions/0029-the-league-table-counts-the-gruppenphase.md))                                        | The field default on `FLTeamsFilterParams`, read by that same `$match`                                                                      | Both scopes return the same seven fields, so a wrong scope is a plausible table rather than an error — defaulting to `gesamt` puts playoff results in the league table                                                                                                                                                       |
| I2  | `patch_one_in_db` returns the pre-write document                                                                                                                                                                                         | `core/crud.py`                                                                                                                              | The venue and referee fan-outs read the post-write document and pass `ReturnDocument.AFTER` for it; flipping the default would fan out the values being replaced                                                                                                                                                             |
| I3  | `ergebnis` is derived server-side, never accepted from a client                                                                                                                                                                          | `spiele/admin_router.py`                                                                                                                    | Result can disagree with its own goal counts                                                                                                                                                                                                                                                                                 |
| I4  | Omitting `saison_id` means the current season on `/spiele`, `/teams`, `/spieltage`                                                                                                                                                       | Each router's handler                                                                                                                       | `/spieler` deliberately excluded — it takes `team_id` instead, so a season default would not narrow anything                                                                                                                                                                                                                 |
| I5  | `saison_id` is exactly 4 characters everywhere it appears                                                                                                                                                                                | `min_length=4, max_length=4` on `FLSaison.id`, `FLSpiel`, `FLSpieltag`                                                                      | A longer id validates on the season and makes every match referencing it fail to parse                                                                                                                                                                                                                                       |
| I6  | Money fields (`mietpreis`, `payment`) have **no** Pydantic default                                                                                                                                                                       | `fl_backend/app/api/spiele/schemas.py :: mietpreis`                                                                                         | The `$set` write silently zeroes an omitted value                                                                                                                                                                                                                                                                            |
| I7  | Router-level guards, not per-endpoint, with reads and writes in **separate routers** ([ADR-0034](../_decisions/0034-the-write-path-is-resource-first-in-a-second-router.md))                                                             | `dependencies=[Depends(...)]` on each `APIRouter`, checked by `tests/api/test_admin_guard.py`                                               | An endpoint reaches the wrong authorization only by being written in the wrong FILE — visible at the top of a diff rather than absent from the middle of one                                                                                                                                                                 |
| I8  | API keys compared with `secrets.compare_digest`                                                                                                                                                                                          | `fl_backend/app/core/security.py :: compare_digest`                                                                                         | Timing-based key recovery                                                                                                                                                                                                                                                                                                    |
| I9  | The app refuses to start if MongoDB is unreachable                                                                                                                                                                                       | `fl_backend/app/core/db.py :: lifespan`                                                                                                     | A container that starts healthy and serves 503s                                                                                                                                                                                                                                                                              |
| I10 | The teams grouped response always contains all four groups                                                                                                                                                                               | `FLGruppen.from_teams`                                                                                                                      | A season with an empty group omitted the key, failing frontend validation and taking down `/dashboard/saisontabelle`                                                                                                                                                                                                         |
| I11 | With a `saison_id`, the `saison_teams` join is strict                                                                                                                                                                                    | `preserveNullAndEmptyArrays: not strict_join`                                                                                               | Teams with no junction row would return with an unset `gruppe` and fail response validation                                                                                                                                                                                                                                  |
| I12 | Deletion is soft on six collections, and `inactive_since` is a **date, never a boolean** ([ADR-0032](../_decisions/0032-soft-deletion-is-a-date-not-a-flag.md))                                                                          | Every `delete_*` handler stamps the German current date; the field is on no payload                                                         | Matches embed venue, referee and team data; a hard delete orphans those copies. A flag beside a date can contradict itself and no validator could catch that                                                                                                                                                                 |
| I13 | Venue/referee renames fan out into embedded match copies                                                                                                                                                                                 | `patch_many_in_db` in both patch handlers                                                                                                   | Match cards would show stale names indefinitely                                                                                                                                                                                                                                                                              |
| I14 | `GET /teams` requires a resolved season, and `build_team_pipeline` raises without one                                                                                                                                                    | The guard at the top of the builder                                                                                                         | The derived table would sum no matches at all and serve a full set of zeros that looks like a real answer                                                                                                                                                                                                                    |
| I15 | Every collection carries a `$jsonSchema` validator and the four uniqueness rules are unique indexes, applied on **every boot**; startup fails if any cannot be applied                                                                   | `core/constraints.py`, called from the lifespan ([ADR-0027](../_decisions/0027-the-database-enforces-its-own-invariants.md))                | Any document can still be edited directly in MongoDB, where nothing applies a Pydantic model, so a malformed write surfaces only when a page fails to parse it. A wrong-shaped `team_id` costs a squad page and a 422                                                                                                        |
| I16 | Those validators assert **types, required fields and enums only** — never ranges, patterns or lengths                                                                                                                                    | `test_no_validator_constrains_a_range_or_a_format`                                                                                          | A third copy of the schema is affordable only while it is this narrow; ranges and formats stay Pydantic's, and duplicating them would triple the surface over which the three copies can drift                                                                                                                               |
| I18 | **Exactly one season is `active`**, and `POST /saisons/{saison_id}/activate` is the only code path that writes `status` ([ADR-0033](../_decisions/0033-one-active-season-and-one-path-to-it.md))                                         | The endpoint demotes the incumbent and promotes the target in one transaction; `status` is on no payload                                    | No validator and no index can express "exactly one": a validator sees one document, and a unique index on `status` would permit exactly one `past` season                                                                                                                                                                    |
| I19 | A team **never leaves a season** — the junction has a POST and a PATCH and no DELETE ([ADR-0033](../_decisions/0033-one-active-season-and-one-path-to-it.md))                                                                            | No DELETE is declared on `/teams/{team_id}/saisons/{saison_id}`                                                                             | Deleting the row would erase the group assignment, the disqualification and the team's presence in a season that has already been played. Disqualification is the way out                                                                                                                                                    |
| I20 | Creating **never revives** a retired row; `POST /{resource}/{id}/reactivate` does ([ADR-0032](../_decisions/0032-soft-deletion-is-a-date-not-a-flag.md))                                                                                 | Every create is a plain insert, so a natural-key collision is a `DuplicateKeyError` → 409                                                   | Reviving from a natural key cannot tell the same club returning from a different club wanting two letters the retired one still holds — and getting it wrong repoints every historical match                                                                                                                                 |
| I17 | A Pydantic model and its validator declare the same field set                                                                                                                                                                            | `test_every_mirrored_model_matches_its_validator` ([ADR-0031](../_decisions/0031-the-third-copy-of-the-schema-is-checked-not-generated.md)) | Nothing about editing a model would announce that its validator was forgotten. The validators are hand-written on purpose — generating them would type every ObjectId as a string                                                                                                                                            |
| I22 | A fixture side is `null` while its occupant is unknown, and `teamN_herkunft` is an INDEPENDENT sibling saying where it comes from ([ADR-0041](../_decisions/0041-a-bracket-slot-carries-its-own-provenance.md))                          | `FLSpiel` and the `spiele` validator, both of which type the four fields and pair none of them                                              | Putting the label inside the team field is what made `patch_team` carry a fan-out exemption, since one field then held both a display copy of `teams.name` and a label a rename must never overwrite. A cross-field rule is equally wrong: matches are hand-created, so it would fail on READ and take the bracket page down |
| I21 | `fl_backend/openapi.json` is committed and equals what the service publishes; regenerate it with `python -m tests.openapi_document --write` ([ADR-0040](../_decisions/0040-the-zod-mirror-is-checked-against-the-published-document.md)) | `fl_backend/tests/api/test_openapi_document.py :: test_the_committed_document_is_the_one_the_service_publishes`                             | The frontend's contract test compares the Zod mirror against this document. A stale one is worse than no check: it stays green while the two sides diverge. Committing it is also what selects the frontend gate scope for a backend model change                                                                            |

## 6. Violation → remedy

| Symptom                                          | Cause                                         | Remedy                                                                                          |
| ------------------------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| League table does not change after a result edit | A stale frontend cache, not the backend       | The table is recomputed per request (I1); check that the Spiel action still invalidates `teams` |
| A cancelled match still counts in the table      | Working as intended — it is a forfeit (I1a)   | Nothing. Clear the `ergebnis` if it should not count                                            |
| A team's page and the Saisontabelle disagree     | Working as intended — two scopes (I1c)        | Nothing. The page counts every phase, the table counts the Gruppenphase                         |
| Every team's table reads zero                    | A season resolved to one with no matches      | Check `saison_id`; an unknown season now 404s rather than returning an empty list               |
| Venue rent becomes 0 after an unrelated edit     | A Pydantic default was added to `mietpreis`   | Remove it (I6)                                                                                  |
| A team vanishes from `/teams`                    | No `saison_teams` row for that season         | Create the junction row (I11)                                                                   |
| `/dashboard/saisontabelle` fails to load         | A group key missing from the grouped response | I10 — should be impossible now                                                                  |
| A create comes back 409                          | A unique index still holds the key            | The retired row keeps its slot on purpose (I20). Reactivate it, or choose another key           |
| A retired venue is missing from an admin picker  | The default read filters it out               | Pass `include_inactive=true` — a switch, not a value to match on                                |
| 401 with `REQ-AUTH-002`                          | Wrong or missing `base` key                   | Check `INTERNAL_API_KEY_BASE` matches on both sides                                             |
| 503 with `Retry-After: 30`                       | Database unavailable                          | `DB-CONN-001` — check MongoDB                                                                   |

## 7. Known-open

| #     | Item                                                   | State                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —     | Routers and CRUD have no direct tests                  | The suite covers the models, the filter builders, the response envelope, the team pipeline against a real `mongod` ([ADR-0030](../_decisions/0030-a-real-mongod-behind-a-deselected-marker.md)), and every router's guard (`fl_backend/tests/api/test_admin_guard.py`). Handler bodies and the CRUD helpers are still reached only indirectly; the backend audit passes in [`docs/_auditing/`](../_auditing/) inherit the database fixture and own that gap |
| —     | The database user needs `collMod`                      | `collMod` is a `dbAdmin` action; `readWrite` and `readWriteAnyDatabase` carry `createIndex` but not it. So a user can build all four indexes and attach no validators, and the app then refuses to start (I15). `python -m app.core.constraints --check` reports the answer                                                                                                                                                                                 |
| —     | OpenAPI carries no service-level prose                 | Every endpoint now has a `summary` and a docstring, but the app declares no `title` or `description`. The Swagger UI is also not publicly routed — nginx sends `/api` here but FastAPI's `/docs` sits at the app root, which nginx sends to Next                                                                                                                                                                                                            |
| —     | Six single reads have no caller                        | `GET /{id}` exists on all seven resources and only `/teams/{team_id}` is called. Accepted knowingly: uniform addressability is the point (ADR-0034)                                                                                                                                                                                                                                                                                                         |
| BE-12 | Nothing purges a retired row                           | `inactive_since` is a date so a scheduled purge can select on it, and that purge is not built. Tracked in [`docs/roadmap/open-items.md`](../roadmap/open-items.md)                                                                                                                                                                                                                                                                                          |
| BE-13 | A malformed id is a 404 in a path and a 422 in a query | `by_id()` constrains an id path to 24 hex characters, so a malformed one matches no route; the same value in a query parameter reaches a `CustomObjectId` field and Pydantic rejects it. Uniform within each spelling, and stated nowhere across the two. Tracked in [`docs/roadmap/open-items.md`](../roadmap/open-items.md)                                                                                                                               |
