# Backend — spec

**Verified against:** `179f802`, 2026-08-02
**Scope:** `fl_backend/`

---

## 1. Endpoints

All paths are prefixed `/api/v{API_VERSION}`. Guards are declared at router level and inherited by
every endpoint in the router.

### Read routers — guard `verify_access_base`

| Method | Path              | Handler                    | Notes                                                                                     |
| ------ | ----------------- | -------------------------- | ----------------------------------------------------------------------------------------- |
| GET    | `/spiele`         | `spiele/router.py`         | Filters below; omitted `saison_id` means the current season                               |
| GET    | `/teams`          | `teams/router.py`          | Three response shapes, discriminated by `format`; `statistik_scope` picks the table (I1c) |
| GET    | `/spieler`        | `spieler/router.py`        | **No current-season default** — see I4                                                    |
| GET    | `/spieltage`      | `spieltage/router.py`      | Omitted `saison_id` means the current season                                              |
| GET    | `/saisons`        | `saisons/router.py`        |                                                                                           |
| GET    | `/spielorte`      | `spielorte/router.py`      |                                                                                           |
| GET    | `/schiedsrichter` | `schiedsrichter/router.py` | Only ever called with no arguments by the frontend                                        |

### `admin` router — guard `verify_access_admin`

| Method | Path                           | Effect                                                                        |
| ------ | ------------------------------ | ----------------------------------------------------------------------------- |
| GET    | `/admin/action_required`       | Matches needing attention: cancelled, missing a field, or past with no result |
| PATCH  | `/admin/update_spiel_data`     | Writes one match; the league table follows from it on read. See §3            |
| POST   | `/admin/post_spielort`         | Creates a venue; builds `maps_link` server-side                               |
| PATCH  | `/admin/patch_spielort`        | Updates a venue **and fans the change out** into every match embedding it     |
| DELETE | `/admin/delete_spielort`       | Soft delete — sets `is_inactive: true`                                        |
| POST   | `/admin/post_schiedsrichter`   | Creates a referee                                                             |
| PATCH  | `/admin/patch_schiedsrichter`  | Updates a referee **and fans the name out** into every match embedding it     |
| DELETE | `/admin/delete_schiedsrichter` | Soft delete                                                                   |

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

## 3. `PATCH /admin/update_spiel_data` — the write path

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
(§4, I1), so entering a result moves the table on the next read, with no second write to forget. The
frontend still invalidates the `teams` cache tags in the same action — the data it caches changed even
though no team document did.

## 4. Invariants

| #   | Invariant                                                                                                                                                                                         | Enforced by                                                                                                                                 | Breaks how                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | Team statistics are **derived from `spiele`**, never stored ([ADR-0026](../_decisions/0026-team-statistics-are-derived-from-spiele.md))                                                           | `build_statistik_lookup_stage` in `teams/services.py`                                                                                       | A stored or cached copy reintroduces the drift the ADR removed — that is the decision reversed, not an optimisation                                                               |
| I1a | A match counts towards the table **exactly when it carries an `ergebnis`**; `is_canceled` is not consulted, because a cancelled match with a result is a forfeit                                  | The `$match` inside that lookup                                                                                                             | Filtering cancelled matches out drops three of season 2026's results and looks like a correction while doing it                                                                   |
| I1b | Points come from the season's `rules.win_points` / `draw_points`                                                                                                                                  | The final `$project` inside that lookup                                                                                                     | A hardcoded 3/1/0 silently ignores a season that scores differently                                                                                                               |
| I1c | `statistik_scope` defaults to **`gruppenphase`**, so the table a caller gets by saying nothing is the group standing ([ADR-0029](../_decisions/0029-the-league-table-counts-the-gruppenphase.md)) | The field default on `FLTeamsFilterParams`, read by that same `$match`                                                                      | Both scopes return the same seven fields, so a wrong scope is a plausible table rather than an error — defaulting to `gesamt` puts playoff results in the league table            |
| I2  | `patch_one_in_db` returns the pre-write document                                                                                                                                                  | `core/crud.py`                                                                                                                              | The venue and referee fan-outs read the post-write document and pass `ReturnDocument.AFTER` for it; flipping the default would fan out the values being replaced                  |
| I3  | `ergebnis` is derived server-side, never accepted from a client                                                                                                                                   | `admin/router.py:77-79`                                                                                                                     | Result can disagree with its own goal counts                                                                                                                                      |
| I4  | Omitting `saison_id` means the current season on `/spiele`, `/teams`, `/spieltage`                                                                                                                | Each router's handler                                                                                                                       | `/spieler` deliberately excluded — it takes `team_id` instead, so a season default would not narrow anything                                                                      |
| I5  | `saison_id` is exactly 4 characters everywhere it appears                                                                                                                                         | `min_length=4, max_length=4` on `FLSaison.id`, `FLSpiel`, `FLSpieltag`                                                                      | A longer id validates on the season and makes every match referencing it fail to parse                                                                                            |
| I6  | Money fields (`mietpreis`, `payment`) have **no** Pydantic default                                                                                                                                | `spiele/schemas.py:38`, `:44`                                                                                                               | The `$set` write silently zeroes an omitted value                                                                                                                                 |
| I7  | Router-level guards, not per-endpoint                                                                                                                                                             | `dependencies=[Depends(...)]` on each `APIRouter`                                                                                           | A new endpoint added to `admin` without its own decorator would be unguarded                                                                                                      |
| I8  | API keys compared with `secrets.compare_digest`                                                                                                                                                   | `core/security.py:27`                                                                                                                       | Timing-based key recovery                                                                                                                                                         |
| I9  | The app refuses to start if MongoDB is unreachable                                                                                                                                                | `core/db.py:26-34`                                                                                                                          | A container that starts healthy and serves 503s                                                                                                                                   |
| I10 | The teams grouped response always contains all four groups                                                                                                                                        | `FLGruppen.from_teams`                                                                                                                      | A season with an empty group omitted the key, failing frontend validation and taking down `/dashboard/saisontabelle`                                                              |
| I11 | With a `saison_id`, the `saison_teams` join is strict                                                                                                                                             | `preserveNullAndEmptyArrays: not strict_join`                                                                                               | Teams with no junction row would return with an unset `gruppe` and fail response validation                                                                                       |
| I12 | Venue and referee deletion is soft                                                                                                                                                                | `delete_*` handlers set `is_inactive`                                                                                                       | Matches embed venue and referee data; a hard delete would orphan those copies                                                                                                     |
| I13 | Venue/referee renames fan out into embedded match copies                                                                                                                                          | `patch_many_in_db` in both patch handlers                                                                                                   | Match cards would show stale names indefinitely                                                                                                                                   |
| I14 | `GET /teams` requires a resolved season, and `build_team_pipeline` raises without one                                                                                                             | The guard at the top of the builder                                                                                                         | The derived table would sum no matches at all and serve a full set of zeros that looks like a real answer                                                                         |
| I15 | Every collection carries a `$jsonSchema` validator and the four uniqueness rules are unique indexes, applied on **every boot**; startup fails if any cannot be applied                            | `core/constraints.py`, called from the lifespan ([ADR-0027](../_decisions/0027-the-database-enforces-its-own-invariants.md))                | Three resources are hand-edited in Compass, so a bad write is discovered when a page fails to parse it. `"Lessing-Gymnasium"` in a `team_id` cost a squad page and a 422          |
| I16 | Those validators assert **types, required fields and enums only** — never ranges, patterns or lengths                                                                                             | `test_no_validator_constrains_a_range_or_a_format`                                                                                          | A third copy of the schema is affordable only while it is this narrow; ranges and formats stay Pydantic's, and duplicating them would triple the drift surface F2 warns about     |
| I17 | A Pydantic model and its validator declare the same field set                                                                                                                                     | `test_every_mirrored_model_matches_its_validator` ([ADR-0031](../_decisions/0031-the-third-copy-of-the-schema-is-checked-not-generated.md)) | Nothing about editing a model would announce that its validator was forgotten. The validators are hand-written on purpose — generating them would type every ObjectId as a string |

## 5. Violation → remedy

| Symptom                                          | Cause                                         | Remedy                                                                                          |
| ------------------------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| League table does not change after a result edit | A stale frontend cache, not the backend       | The table is recomputed per request (I1); check that the Spiel action still invalidates `teams` |
| A cancelled match still counts in the table      | Working as intended — it is a forfeit (I1a)   | Nothing. Clear the `ergebnis` if it should not count                                            |
| A team's page and the Saisontabelle disagree     | Working as intended — two scopes (I1c)        | Nothing. The page counts every phase, the table counts the Gruppenphase                         |
| Every team's table reads zero                    | A season resolved to one with no matches      | Check `saison_id`; an unknown season now 404s rather than returning an empty list               |
| Venue rent becomes 0 after an unrelated edit     | A Pydantic default was added to `mietpreis`   | Remove it (I6)                                                                                  |
| A team vanishes from `/teams`                    | No `saison_teams` row for that season         | Create the junction row (I11)                                                                   |
| `/dashboard/saisontabelle` fails to load         | A group key missing from the grouped response | I10 — should be impossible now                                                                  |
| 401 with `REQ-AUTH-002`                          | Wrong or missing `base` key                   | Check `INTERNAL_API_KEY_BASE` matches on both sides                                             |
| 503 with `Retry-After: 30`                       | Database unavailable                          | `DB-CONN-001` — check MongoDB                                                                   |

## 6. Error codes

| Code            | Status | Meaning                         |
| --------------- | ------ | ------------------------------- |
| `REQ-AUTH-001`  | 401    | No bearer credentials presented |
| `REQ-AUTH-002`  | 401    | `base` key invalid              |
| `REQ-AUTH-003`  | 401    | `system` key invalid            |
| `REQ-AUTH-004`  | 401    | `admin` key invalid             |
| `DB-CONN-001`   | 503    | Database client unavailable     |
| `DB-COMMON-001` | 404    | No document matched the filter  |

## 7. Known-open

| #    | Item                                                  | State                                                                                                                                                                                                                                                                       |
| ---- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —    | Routers, CRUD and authentication have no tests        | The suite covers models and the team pipeline (the latter executed against a real `mongod` since [ADR-0030](../_decisions/0030-a-real-mongod-behind-a-deselected-marker.md)). The remaining layers belong to the planned backend audit, which inherits the database fixture |
| —    | The database user needs `collMod`                     | `collMod` is a `dbAdmin` action; `readWrite` and `readWriteAnyDatabase` carry `createIndex` but not it. So a user can build all four indexes and attach no validators, and the app then refuses to start (I15). `python -m app.core.constraints --check` reports the answer |
| —    | CORS `allow_methods` omits `DELETE`                   | `app/main.py:30` lists `GET, POST, PATCH` while the admin router exposes two DELETEs. No impact today: the only client calls server-side, where CORS does not apply. It would bite the moment a browser called the API directly                                             |
| —    | OpenAPI carries no service-level prose                | Every endpoint now has a `summary` and a docstring, but the app declares no `title` or `description`. The Swagger UI is also not publicly routed — nginx sends `/api` here but FastAPI's `/docs` sits at the app root, which nginx sends to Next                            |
| BE-4 | No write path for `saisons` / `spieler` / `spieltage` | Edited out of band; the frontend cache is cleared by a script. Tracked in [`docs/roadmap/open-items.md`](../roadmap/open-items.md)                                                                                                                                          |
| BE-9 | The `is_placeholder` "TBD" team                       | Should become a nullable opponent reference. Tracked in [`docs/roadmap/open-items.md`](../roadmap/open-items.md)                                                                                                                                                            |
