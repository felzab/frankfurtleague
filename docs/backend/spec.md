# Backend — spec

**Verified against:** `ba71aca`, 2026-08-01
**Scope:** `fl_backend/`

---

## 1. Endpoints

All paths are prefixed `/api/v{API_VERSION}`. Guards are declared at router level and inherited by
every endpoint in the router.

### Read routers — guard `verify_access_base`

| Method | Path              | Handler                    | Notes                                                       |
| ------ | ----------------- | -------------------------- | ----------------------------------------------------------- |
| GET    | `/spiele`         | `spiele/router.py`         | Filters below; omitted `saison_id` means the current season |
| GET    | `/teams`          | `teams/router.py`          | Three response shapes, discriminated by `format`            |
| GET    | `/spieler`        | `spieler/router.py`        | **No current-season default** — see I4                      |
| GET    | `/spieltage`      | `spieltage/router.py`      | Omitted `saison_id` means the current season                |
| GET    | `/saisons`        | `saisons/router.py`        |                                                             |
| GET    | `/spielorte`      | `spielorte/router.py`      |                                                             |
| GET    | `/schiedsrichter` | `schiedsrichter/router.py` | Only ever called with no arguments by the frontend          |

### `admin` router — guard `verify_access_admin`

| Method | Path                           | Effect                                                                        |
| ------ | ------------------------------ | ----------------------------------------------------------------------------- |
| GET    | `/admin/action_required`       | Matches needing attention: cancelled, missing a field, or past with no result |
| PATCH  | `/admin/update_spiel_data`     | The one complex write. Transactional; see §3                                  |
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

The only multi-document write in the system. Everything below happens inside one MongoDB transaction.

| Step | Behaviour                                                                        | What breaks if changed                                                                                 |
| ---- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1    | `ergebnis` derived as `f"{team1.tore}:{team2.tore}"`, `None` if either is `None` | A client could submit a result disagreeing with the goals rendered beside it                           |
| 2    | Payload written wholesale with `$set`                                            | A field absent from the payload is **overwritten**, not preserved                                      |
| 3    | The write returns the **pre-write** document (`ReturnDocument.BEFORE`)           | Statistics deltas computed from post-write values — every team's table silently wrong, no error raised |
| 4    | `update_team_statistik` per team slot                                            | See below                                                                                              |

`update_team_statistik` handles two cases. If the team in a slot is unchanged, it applies the
**difference** between the old and new contribution. If the slot's team changed, it reverts the old
team's contribution in full and applies the new team's in full. Both use `$inc`, and zero-valued fields
are dropped from the increment document to save database work.

`get_stats_contribution` returns an **all-zero** contribution for an unplayed match, including
`anzahl_gespielte_spiele`. That is what makes a first-time result entry correct: the old side is zero
across every field, so the delta equals the new contribution.

> ⚠️ **The statistics written here are not the statistics served.** See invariant I1 and Finding F4.

## 4. Invariants

| #   | Invariant                                                                          | Enforced by                                                            | Breaks how                                                                                                           |
| --- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| I1  | Team statistics are read from the `saison_teams` junction                          | `teams/services.py:73`                                                 | **Currently violated on the write side** — `update_team_statistik` writes `teams.statistik`. See F4                  |
| I2  | `patch_one_in_db` returns the pre-write document                                   | `core/crud.py:44`                                                      | Statistics deltas silently corrupt every league table                                                                |
| I3  | `ergebnis` is derived server-side, never accepted from a client                    | `admin/router.py:77-79`                                                | Result can disagree with its own goal counts                                                                         |
| I4  | Omitting `saison_id` means the current season on `/spiele`, `/teams`, `/spieltage` | Each router's handler                                                  | `/spieler` deliberately excluded — it takes `team_id` instead, so a season default would not narrow anything         |
| I5  | `saison_id` is exactly 4 characters everywhere it appears                          | `min_length=4, max_length=4` on `FLSaison.id`, `FLSpiel`, `FLSpieltag` | A longer id validates on the season and makes every match referencing it fail to parse                               |
| I6  | Money fields (`mietpreis`, `payment`) have **no** Pydantic default                 | `spiele/schemas.py:38`, `:44`                                          | The `$set` write silently zeroes an omitted value                                                                    |
| I7  | Router-level guards, not per-endpoint                                              | `dependencies=[Depends(...)]` on each `APIRouter`                      | A new endpoint added to `admin` without its own decorator would be unguarded                                         |
| I8  | API keys compared with `secrets.compare_digest`                                    | `core/security.py:27`                                                  | Timing-based key recovery                                                                                            |
| I9  | The app refuses to start if MongoDB is unreachable                                 | `core/db.py:26-34`                                                     | A container that starts healthy and serves 503s                                                                      |
| I10 | The teams grouped response always contains all four groups                         | `FLGruppen.from_teams`                                                 | A season with an empty group omitted the key, failing frontend validation and taking down `/dashboard/saisontabelle` |
| I11 | With a `saison_id`, the `saison_teams` join is strict                              | `preserveNullAndEmptyArrays: not strict_join`                          | Teams with no junction row would return with unset `gruppe`/`statistik` and fail response validation                 |
| I12 | Venue and referee deletion is soft                                                 | `delete_*` handlers set `is_inactive`                                  | Matches embed venue and referee data; a hard delete would orphan those copies                                        |
| I13 | Venue/referee renames fan out into embedded match copies                           | `patch_many_in_db` in both patch handlers                              | Match cards would show stale names indefinitely                                                                      |

## 5. Violation → remedy

| Symptom                                          | Cause                                                   | Remedy                                              |
| ------------------------------------------------ | ------------------------------------------------------- | --------------------------------------------------- |
| League table does not change after a result edit | Statistics written to `teams`, read from `saison_teams` | See F4 — unresolved                                 |
| Team table drifts after result edits             | `ReturnDocument.AFTER` on the match write               | Restore the pre-write read (I2)                     |
| Venue rent becomes 0 after an unrelated edit     | A Pydantic default was added to `mietpreis`             | Remove it (I6)                                      |
| A team vanishes from `/teams`                    | No `saison_teams` row for that season                   | Create the junction row (I11)                       |
| `/dashboard/saisontabelle` fails to load         | A group key missing from the grouped response           | I10 — should be impossible now                      |
| 401 with `REQ-AUTH-002`                          | Wrong or missing `base` key                             | Check `INTERNAL_API_KEY_BASE` matches on both sides |
| 503 with `Retry-After: 30`                       | Database unavailable                                    | `DB-CONN-001` — check MongoDB                       |

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

| #    | Item                                                            | State                                                                                                                                                                                                                           |
| ---- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F4   | Team statistics write/read mismatch                             | **Open, unverified in a running system.** [`../roadmap/open-items.md`](../roadmap/open-items.md) §F4                                                                                                                            |
| —    | Season `rules.win_points` / `draw_points` are stored but unused | `get_stats_contribution` hardcodes 3 and 1. They agree today; they are not wired together                                                                                                                                       |
| —    | CORS `allow_methods` omits `DELETE`                             | `app/main.py:30` lists `GET, POST, PATCH` while the admin router exposes two DELETEs. No impact today: the only client calls server-side, where CORS does not apply. It would bite the moment a browser called the API directly |
| —    | OpenAPI carries no prose                                        | No `title`, `description`, or endpoint docstrings. The Swagger UI is also not publicly routed — nginx sends `/api` here but FastAPI's `/docs` sits at the app root, which nginx sends to Next                                   |
| BE-4 | No write path for `saisons` / `spieler` / `spieltage`           | Edited out of band; the frontend cache is cleared by a script. Tracked in [`docs/roadmap/open-items.md`](../roadmap/open-items.md)                                                                                              |
| BE-9 | The `is_placeholder` "TBD" team                                 | Should become a nullable opponent reference. Tracked in [`docs/roadmap/open-items.md`](../roadmap/open-items.md)                                                                                                                |
