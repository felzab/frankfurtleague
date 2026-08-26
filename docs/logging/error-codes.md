# Logging — error codes

**Verified against:** `d1fc5f37`, 2026-08-26\
**Scope:** every `error_code` value either service emits, and the response body that carries it.

**Every failure response body is `{error_code, correlation_id}` and nothing else** — messages, validation
details and stack traces go to the log, never the wire
(`fl_backend/app/core/exception_handlers.py :: error_response`). **Every failure log line carries its code as
the `error_code` field.**

The taxonomy is `<AREA>-<SUBJECT>-<NNN>`, and the area names the side that must act: `REQ-*` the request was
wrong, `DB-*` the database refused or failed, `SRV-*` the server itself failed, `FE-*` a frontend-side
failure class. A new failure mode gets a new code, never a reused one.

**`READ-*` shares that shape and is not an error code.** A read rule refuses nothing, so it reaches no
response body, no log line and no row on this page, and the `RULES` correspondence below is scanned over
`REQ-` alone. What a read rule governs is which tier a field is served
([`docs/backend/spec.md`](../backend/spec.md#17-read-rules) §1.7).

| Section                                           | Answers                                         |
| ------------------------------------------------- | ----------------------------------------------- |
| [Backend codes](#1-backend-codes)                 | Every code FastAPI raises, and its status       |
| [Frontend codes](#2-frontend-codes)               | Every code the Next surface raises              |
| [The mutation boundary](#3-the-mutation-boundary) | Why an admin write never reaches the error page |

## 1. Backend codes

Declared in `fl_backend/app/core/exceptions.py`, handled in `fl_backend/app/core/exception_handlers.py`.

**A code raised under `app/api/` is a domain rule and has a row in
`fl_backend/app/core/domain.py :: RULES`; the protocol codes in `app/core/` describe who you are, whether
the body parses, and whether an id is an ObjectId.**
`fl_backend/tests/core/test_domain.py :: test_every_domain_rule_the_application_defines_is_declared` holds
that correspondence in both directions and excuses the protocol codes by name;
`fl_backend/tests/core/test_domain.py :: test_the_protocol_codes_are_the_ones_outside_the_api_layer` pins the
excused set, without which the exclusion list could grow to cover a real domain rule and stay green.
**`RULES` says what each rule refuses; this table says its code and status.**

Every domain refusal is a 409, for one reason: nothing about the payload is malformed, so the same request
would have succeeded against a different state of the database
(`fl_backend/app/core/exceptions.py :: DocumentConflictException`).

**`DB-COMMON-001` is also what a season the base tier may not read answers**, deliberately the same code
and body an id naming nothing gets ([`docs/backend/spec.md`](../backend/spec.md) I47), so a 404 carrying
it is never on its own proof that the document is absent.

**A refusal comparing a payload against the document it replaces names a step, never a state**: `REQ-RULES-001`,
`REQ-RULES-004`, `REQ-RULES-006`, `REQ-RULES-007`, `REQ-RULES-008`, `REQ-RULES-009`, `REQ-RULES-010` and
`REQ-RULES-011` arrive on the edit that introduces or worsens the violation and let a resubmission of the stored
values through, because a season patch replaces `rules` wholesale. `REQ-DATE-008` is the same shape one payload
over: a matchday patch carries `beginn` and `ende` together, so an `ende`-only edit resubmits the stored `beginn`
(`docs/backend/spec.md :: I44`).

**The draw freezes a season's SHAPE alone**: `REQ-RULES-011` names `number_of_groups`, `teams_per_group` and
`qualifiers_per_group`, the rules the fixtures were drawn from. The freeze is ABSOLUTE on the patch and it is not a dead
end, but the three do not share one repair, so the refusal composes a repair per field that moved: `qualifiers_per_group`
moves by drawing the season AGAIN with the new number carried on the replace and written in the transaction that redraws
(`REQ-SPIELPLAN-005`), while the clubs entered fix the other two, whose repair is an undraw (`REQ-SPIELPLAN-006`), a
change to those entries, and a fresh draw ([`docs/domain.md`](../domain.md)). What a season scores by stays editable
until the season turns `past`, where `REQ-RULES-005` freezes it.

| Code                  | Status | Meaning                                                                                                                                     |
| --------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `REQ-AUTH-001`        | 401    | No bearer credentials presented                                                                                                             |
| `REQ-AUTH-002`        | 401    | `base` key invalid                                                                                                                          |
| `REQ-AUTH-003`        | 401    | `system` key invalid                                                                                                                        |
| `REQ-AUTH-004`        | 401    | `admin` key invalid                                                                                                                         |
| `REQ-AUTH-005`        | 401    | No usable `X-FL-Actor` header on an admin-tier write                                                                                        |
| `REQ-VAL-001`         | 422    | Request payload or parameters failed validation                                                                                             |
| `REQ-OID-001`         | 400    | A malformed ObjectId reached a handler — the net behind the path convertor and the query models, unreachable through routed traffic         |
| `REQ-RULES-001`       | 409    | A step made `number_of_groups` × `qualifiers_per_group` a product no phase set holds                                                        |
| `REQ-RULES-002`       | 409    | `number_of_groups` would drop below a group that still holds teams                                                                          |
| `REQ-RULES-003`       | 409    | `teams_per_group` would drop below the fullest group's occupancy                                                                            |
| `REQ-RULES-004`       | 409    | `qualifiers_per_group` would drop below a placing a bracket slot already names                                                              |
| `REQ-RULES-005`       | 409    | A finished season's points, qualifier count and tie-break are frozen, because the table derives from them                                   |
| `REQ-RULES-006`       | 409    | A narrowing would leave a matchday holding more fixtures than its phase accounts for                                                        |
| `REQ-RULES-007`       | 409    | A step put `qualifiers_per_group` over `teams_per_group`, or widened an excess already there                                                |
| `REQ-RULES-008`       | 409    | A step put `draw_points` over `win_points`, or widened an excess already there                                                              |
| `REQ-RULES-009`       | 409    | `max_kadergroesse` would drop below the largest squad the season already holds                                                              |
| `REQ-RULES-010`       | 409    | A step paired a level `forfeit_ergebnis` with rules that produce a knockout round                                                           |
| `REQ-RULES-011`       | 409    | A drawn season was patched to change one of the SHAPE rules its fixtures were drawn from; the refusal names the repair each moved field has |
| `REQ-ACTIVATE-001`    | 409    | The outgoing season still holds fixtures with no result and no `sonderereignis` that awards none                                            |
| `REQ-ACTIVATE-002`    | 409    | A `past` season was activated — refused unconditionally, since it would reopen the points and groups its table derives from                 |
| `REQ-ACTIVATE-003`    | 409    | A season holding no fixtures was activated, which would take the league live with nothing to play                                           |
| `REQ-DATE-001`        | 409    | A fixture's date falls outside the span of the matchday it belongs to                                                                       |
| `REQ-DATE-002`        | 409    | A matchday's span falls outside its season's                                                                                                |
| `REQ-DATE-003`        | 409    | A matchday's span would shrink below a date one of its own fixtures holds                                                                   |
| `REQ-DATE-004`        | 409    | A season's span would shrink below a live matchday's own                                                                                    |
| `REQ-DATE-005`        | 409    | The season is shorter than the matchdays its own rules imply                                                                                |
| `REQ-DATE-008`        | 409    | Within one phase, a matchday would begin before the nearest dated matchday below its position, or after the nearest one above               |
| `REQ-ENTER-001`       | 409    | A team was entered into a season that is not `future`                                                                                       |
| `REQ-ENTER-002`       | 409    | A team was entered into, or moved to, a group the season does not run                                                                       |
| `REQ-ENTER-003`       | 409    | A team was entered into, or moved to, a group already holding `teams_per_group` rows                                                        |
| `REQ-ENTER-004`       | 409    | A group change reached a team that already holds a fixture in that season, whatever the season's status                                     |
| `REQ-ENTER-005`       | 409    | A club that has left the LEAGUE was entered into a season, rather than reactivated first                                                    |
| `REQ-SPIELPLAN-001`   | 409    | A season already holding fixtures was asked to draw one, and the request confirmed no replace                                               |
| `REQ-SPIELPLAN-002`   | 409    | A season already holding matchdays was asked to draw one, and the request confirmed no replace                                              |
| `REQ-SPIELPLAN-003`   | 409    | A Spielplan was drawn for a season already `past`                                                                                           |
| `REQ-SPIELPLAN-004`   | 409    | A Spielplan was drawn while an offered group is off the size its rules ask, or a club stands in a group the season does not offer           |
| `REQ-SPIELPLAN-005`   | 409    | A replace of a season's Spielplan was confirmed for a season that is not `future`, or that already holds a recorded fixture                 |
| `REQ-SPIELPLAN-006`   | 409    | An undraw was asked of a season that is not `future`, or that holds a fixture with something recorded against it                            |
| `REQ-SWAP-001`        | 409    | A group swap named something other than two clubs of that season standing in different groups                                               |
| `REQ-SWAP-002`        | 409    | A group swap reached a season with a knockout fixture already played, abandoned, forfeited or holding a goal count                          |
| `REQ-SWAP-003`        | 409    | A group swap reached a `past` season, whose table is derived from the groups it would exchange                                              |
| `REQ-SWAP-004`        | 409    | A group swap named a club whose Gruppenphase fixture was played, abandoned, forfeited or given a goal count                                 |
| `REQ-SWAP-005`        | 409    | A group swap would have BROKEN a Spieltag, leaving a club in two of its matches                                                             |
| `REQ-SWAP-006`        | 409    | A group swap would field a club that has left the season on a fixture dated on or after its exit, or on an undated one                      |
| `REQ-REPLACE-001`     | 409    | A club was replaced in a `past` season, whose fixtures are the record of who played                                                         |
| `REQ-REPLACE-002`     | 409    | A club was replaced whose fixture in that season was played, abandoned, forfeited or holding a goal count                                   |
| `REQ-REPLACE-003`     | 409    | A replacement named an incoming club that already holds a row in the season, or named one club on both ends                                 |
| `REQ-RETIRE-001`      | 409    | A club entered in an `active` or `future` season was asked to retire                                                                        |
| `REQ-RETIRE-003`      | 409    | A venue still booked for an unplayed fixture was asked to retire                                                                            |
| `REQ-RETIRE-004`      | 409    | A referee still assigned to an unplayed fixture was asked to retire                                                                         |
| `REQ-PURGE-001`       | 409    | A player still in the league was asked to be erased; the erasure needs them retired first                                                   |
| `REQ-SPIELTAG-001`    | 409    | A team would play two fixtures of one Spieltag, and the clash cannot be moved                                                               |
| `REQ-BOOKING-001`     | 409    | A venue or a referee NEWLY assigned to a fixture is unknown or retired — one already stored survives its target's retirement                |
| `REQ-CLASH-001`       | 409    | A venue or a referee would serve two fixtures less than four hours apart                                                                    |
| `REQ-WIRING-001`      | 409    | Bracket wiring the season cannot hold reached the match write path                                                                          |
| `REQ-ELIGIBILITY-001` | 409    | A team that has left the season stands on a match dated on or after its exit, and the save changed an input the rule reads                  |
| `REQ-ELIGIBILITY-002` | 409    | A newly fielded team holds no `saison_teams` row for the fixture's season                                                                   |
| `REQ-RESULT-001`      | 409    | A side carrying goals on a played fixture was emptied rather than switched                                                                  |
| `REQ-STATE-002`       | 409    | A fixture whose `sonderereignis` awards nothing was submitted carrying goals                                                                |
| `REQ-STATE-003`       | 409    | A no-show was recorded on a fixture with an unresolved side                                                                                 |
| `REQ-SQUAD-001`       | 409    | A squad row names a team holding no junction row for that season                                                                            |
| `REQ-SQUAD-003`       | 409    | A squad row was added to a team already holding the season's `max_kadergroesse`                                                             |
| `DB-CONN-001`         | 503    | Database client unavailable                                                                                                                 |
| `DB-CONN-002`         | 503    | The readiness ping could not reach MongoDB (`/system/is_ready`)                                                                             |
| `DB-COMMON-001`       | 404    | No document matched the filter                                                                                                              |
| `DB-COMMON-002`       | 409    | A unique index refused the write                                                                                                            |
| `DB-FAIL-001`         | 500    | A database operation crashed                                                                                                                |
| `SRV-VAL-001`         | 500    | A server-side model failed validation outside request parsing — a data bug, not a caller bug                                                |
| `SRV-FAIL-001`        | 500    | Unhandled crash                                                                                                                             |

## 2. Frontend codes

Declared in `fl_frontend/src/core/errors.ts`, plus the call sites named.

| Code            | Meaning                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| `FE-API-001`    | The API answered with a bad status (`APIBadStatusError`; `serverErrorCode` carries the backend's code) |
| `FE-API-002`    | The API answered with an unparseable or schema-violating body (`APIMalformedDataError`)                |
| `FE-NET-001`    | The network did not answer, timeout included (`APINetworkError`, `isTimeout` distinguishes)            |
| `FE-RSC-001`    | Unhandled server-side error, logged by `fl_frontend/src/core/instrumentation.ts :: onRequestError`     |
| `FE-ACT-001`    | An admin mutation threw something that is not a typed API error (`shared/utils/adminMutation.ts`)      |
| `FE-ACT-002`    | A write committed and its cache invalidation did not — a stale read, never a failed write              |
| `FE-AUTH-001`   | Auth.js reported an access denial (`fl_frontend/src/core/auth.ts`)                                     |
| `FE-AUTH-002`   | Auth.js reported any other error (`fl_frontend/src/core/auth.ts`)                                      |
| `FE-CLIENT-001` | A browser-side crash reported through the ingest route (`src/app/api/client-error/route.ts`)           |

## 3. The mutation boundary

**An admin mutation never lets a typed API error escape.** `runAdminMutation` logs the failure with its codes
and returns the `FormState` the caller toasts, because a 409 is an ordinary outcome of a create rather than a
crash. It wraps both entry points: the admin server actions and the page-owned editors' undo route handlers.
