# Logging — error codes

**Verified against:** `84d43da`, 2026-08-11\
**Scope:** every `error_code` value either service emits, and the response body that carries it.

**Every failure response body is `{error_code, correlation_id}` and nothing else** — messages,
validation details and stack traces go to the log, never the wire
(`fl_backend/app/core/exception_handlers.py :: error_response`). **Every failure log line carries
its code as the `error_code` field.**

The taxonomy is `<AREA>-<SUBJECT>-<NNN>`, and the area names the side that must act: `REQ-*` the
request was wrong, `DB-*` the database refused or failed, `SRV-*` the server itself failed, `FE-*` a
frontend-side failure class. A new failure mode gets a new code, never a reused one.

| Section                                           | Answers                                         |
| ------------------------------------------------- | ----------------------------------------------- |
| [Backend codes](#1-backend-codes)                 | Every code FastAPI raises, and its status       |
| [Frontend codes](#2-frontend-codes)               | Every code the Next surface raises              |
| [The mutation boundary](#3-the-mutation-boundary) | Why an admin write never reaches the error page |

## 1. Backend codes

Declared in `fl_backend/app/core/exceptions.py`, handled in
`fl_backend/app/core/exception_handlers.py`.

**A code raised under `app/api/` is a domain rule and has a row in
`fl_backend/app/core/domain.py :: RULES`; the six that live in `app/core/` describe who you are,
whether the body parses, and whether an id is an ObjectId.** That is the split
[ADR-0053](../_decisions/0053-the-domain-model-is-declared-and-conformance-checked.md) draws and the
conformance test keys on. **`RULES` is the source for what each rule refuses and where it is
implemented; this table is the source for the code and its status.**

Every domain refusal is a 409, for one reason: nothing about the payload is malformed, so the same
request would have succeeded against a different state of the database
(`fl_backend/app/core/exceptions.py :: DocumentConflictException`).

| Code                  | Status | Meaning                                                                                                                                        |
| --------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `REQ-AUTH-001`        | 401    | No bearer credentials presented                                                                                                                |
| `REQ-AUTH-002`        | 401    | `base` key invalid                                                                                                                             |
| `REQ-AUTH-003`        | 401    | `system` key invalid                                                                                                                           |
| `REQ-AUTH-004`        | 401    | `admin` key invalid                                                                                                                            |
| `REQ-VAL-001`         | 422    | Request payload or parameters failed validation                                                                                                |
| `REQ-OID-001`         | 400    | A malformed ObjectId reached a handler — the net behind the path convertor and the query models, unreachable through routed traffic (ADR-0057) |
| `REQ-RULES-001`       | 409    | `number_of_groups` × `qualifiers_per_group` is not a power of two the phase set holds (ADR-0052)                                               |
| `REQ-RULES-002`       | 409    | `number_of_groups` would drop below a group that still holds teams                                                                             |
| `REQ-RULES-003`       | 409    | `teams_per_group` would drop below the fullest group's occupancy                                                                               |
| `REQ-RULES-004`       | 409    | `qualifiers_per_group` would drop below a placing a bracket slot already names                                                                 |
| `REQ-RULES-005`       | 409    | A finished season's points and qualifier count are frozen, because the table derives from them (ADR-0019)                                      |
| `REQ-RULES-006`       | 409    | A narrowing would leave a matchday holding more fixtures than its phase accounts for (ADR-0052)                                                |
| `REQ-RULES-007`       | 409    | `qualifiers_per_group` exceeds `teams_per_group`                                                                                               |
| `REQ-ACTIVATE-001`    | 409    | The outgoing season still holds fixtures that are neither played nor cancelled (ADR-0026)                                                      |
| `REQ-ENTER-001`       | 409    | A team was entered into a season that is not `future`                                                                                          |
| `REQ-ENTER-002`       | 409    | A team was entered into, or moved to, a group the season does not run                                                                          |
| `REQ-ENTER-003`       | 409    | A team was entered into, or moved to, a group already holding `teams_per_group` rows                                                           |
| `REQ-ENTER-004`       | 409    | A group change reached a team whose fixtures the started season has already drawn                                                              |
| `REQ-RETIRE-001`      | 409    | A club entered in an `active` or `future` season was asked to retire                                                                           |
| `REQ-RETIRE-002`      | 409    | A matchday holding a played match was asked to retire, which would unpublish that result                                                       |
| `REQ-RETIRE-003`      | 409    | A venue still booked for an unplayed fixture was asked to retire                                                                               |
| `REQ-RETIRE-004`      | 409    | A referee still assigned to an unplayed fixture was asked to retire                                                                            |
| `REQ-SPIELTAG-001`    | 409    | A team would play two fixtures of one Spieltag, and the clash cannot be moved (ADR-0042)                                                       |
| `REQ-SPIELTAG-002`    | 409    | A matchday's new phase accounts for fewer matches than the matchday already holds (ADR-0052)                                                   |
| `REQ-SPIELTAG-003`    | 409    | A season whose knockout phase has started was asked for a new matchday                                                                         |
| `REQ-DATE-001`        | 409    | A fixture's date falls outside the span of the matchday it belongs to                                                                          |
| `REQ-DATE-002`        | 409    | A matchday's span falls outside its season's                                                                                                   |
| `REQ-DATE-003`        | 409    | A matchday's span would shrink below a date one of its own fixtures holds                                                                      |
| `REQ-DATE-004`        | 409    | A season's span would shrink below a live matchday's own                                                                                       |
| `REQ-CLASH-001`       | 409    | A venue or a referee would serve two fixtures less than four hours apart                                                                       |
| `REQ-WIRING-001`      | 409    | Bracket wiring the season cannot hold reached the match write path (ADR-0038)                                                                  |
| `REQ-ELIGIBILITY-001` | 409    | A disqualified team was newly fielded on a match (ADR-0042)                                                                                    |
| `REQ-ELIGIBILITY-002` | 409    | A newly fielded team holds no `saison_teams` row for the fixture's season (ADR-0042)                                                           |
| `REQ-RESULT-001`      | 409    | A side carrying goals on a played fixture was emptied rather than switched (ADR-0041)                                                          |
| `REQ-SQUAD-001`       | 409    | A squad row names a team holding no junction row for that season                                                                               |
| `REQ-SQUAD-002`       | 409    | A squad number this write would newly take from another player in the same team                                                                |
| `DB-CONN-001`         | 503    | Database client unavailable                                                                                                                    |
| `DB-CONN-002`         | 503    | The readiness ping could not reach MongoDB (`/system/is_ready`)                                                                                |
| `DB-COMMON-001`       | 404    | No document matched the filter                                                                                                                 |
| `DB-COMMON-002`       | 409    | A unique index refused the write                                                                                                               |
| `DB-FAIL-001`         | 500    | A database operation crashed                                                                                                                   |
| `SRV-VAL-001`         | 500    | A server-side model failed validation outside request parsing — a data bug, not a caller bug                                                   |
| `SRV-FAIL-001`        | 500    | Unhandled crash                                                                                                                                |

## 2. Frontend codes

Declared in `fl_frontend/src/core/errors.ts`, plus the call sites named.

| Code            | Meaning                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| `FE-API-001`    | The API answered with a bad status (`APIBadStatusError`; `serverErrorCode` carries the backend's code) |
| `FE-API-002`    | The API answered with an unparseable or schema-violating body (`APIMalformedDataError`)                |
| `FE-NET-001`    | The network did not answer, timeout included (`APINetworkError`, `isTimeout` distinguishes)            |
| `FE-RSC-001`    | Unhandled server-side error, logged by `fl_frontend/src/core/instrumentation.ts :: onRequestError`     |
| `FE-ACT-001`    | An admin mutation threw something that is not a typed API error (`shared/utils/adminMutation.ts`)      |
| `FE-ACT-002`    | A write committed and its cache invalidation did not — a stale read, never a failed write (ADR-0041)   |
| `FE-AUTH-001`   | Auth.js reported an access denial (`fl_frontend/src/core/auth.ts`)                                     |
| `FE-AUTH-002`   | Auth.js reported any other error (`fl_frontend/src/core/auth.ts`)                                      |
| `FE-CLIENT-001` | A browser-side crash reported through the ingest route (`src/app/api/client-error/route.ts`)           |

## 3. The mutation boundary

**An admin mutation never lets a typed API error escape.** `runAdminMutation` logs the failure with
its codes and returns the `FormState` the caller toasts, because a 409 is an ordinary outcome of a
create (ADR-0025) rather than a crash. It wraps both entry points: the admin server actions and the
page-owned editors' undo route handlers
([ADR-0049](../_decisions/0049-every-page-owned-editors-undo-is-a-route-handler.md)).
