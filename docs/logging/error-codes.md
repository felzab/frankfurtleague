# Logging — error codes

**Scope:** every `error_code` value either service emits, live and retired, and which of them a
response body carries.

**A failure answers `{error_code, trace_id}` and nothing else** ([`spec.md`](spec.md#2-invariants) L4):
the message, the validation detail and the stack trace reach the log and never the wire, so a code seen on a
response is followed by finding the log line carrying that same code under that trace id.

**A code is `<AREA>-<SUBJECT>-<NNN>`, and each segment is allocated under a rule of its own:**

- **AREA is the closed set `REQ`, `DB`, `SRV` and `FE`, and names what raised the failure** — a rule
  the request broke, the database driver, the server itself outside any request's contract, and the
  Next surface. That is also who acts on one, with `DB-COMMON-*` the exception: an ordinary read or
  write outcome a caller acts on.
- **SUBJECT is closed per AREA** — the rule family under `REQ-*`, the component under the other three
  — and is named by the sections below rather than declared in either tree. One subject word under
  two areas is two families rather than a collision, which is what puts `REQ-VAL-001` beside
  `SRV-VAL-001` and `DB-FAIL-001` beside `SRV-FAIL-001`: the area carries the whole difference
  between a caller's bug and the server's, so a subject is free to repeat under another one.
- **NNN is three digits, one past the highest its own `<AREA>-<SUBJECT>` holds, and never reused.** A
  gap in a run is a spent number rather than a free one ([section 5](#5-retired-codes)).
- **A code reaches a response body only where it was raised inside a request** — [section
  1](#1-backend-codes) and no other section, which is why that one table carries a status. Everywhere
  else the code reaches a log line and nothing on the wire.

**What holds this page to the code is `scripts/checks/docs_gate/error_codes.py`**: every row is
required to be spelled in the tree its area names — `FE-*` under `fl_frontend/src/`, every other
area under `fl_backend/app/` — and every code a tree spells under a prefix it answers for is
required to have a row, so the backend codes the frontend words for a reader are not read as the
frontend's own. **It reads the shape rather than the four areas** (`:: CODE_SHAPE`), so a fifth area
would owe a row like any other rather than dropping out of both populations unseen.

**`READ-*` shares that shape and is not an error code.** A read rule refuses nothing, so it reaches no
response body, no log line and no row on this page, and the `RULES` correspondence below is scanned over
`REQ-` alone. What a read rule governs is which tier a field is served
([`docs/backend/spec.md`](../backend/spec.md#17-tier-rules) §1.7).

| Section                               | Answers                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| [Backend codes](#1-backend-codes)     | Every code FastAPI raises, its status, and where a domain rule is worded                  |
| [Frontend codes](#2-frontend-codes)   | Every code the Next surface raises, and why an admin write's never reaches the error page |
| [Startup codes](#3-startup-codes)     | Every code a boot refusal carries, none of which answers a request                        |
| [Forwarded codes](#4-forwarded-codes) | The code a line neither service raised carries, on both surfaces                          |
| [Retired codes](#5-retired-codes)     | What each gap in a run once refused, and why the number stays spent                       |

## 1. Backend codes

The exception types carrying them are declared in `fl_backend/app/core/exceptions.py` and handled in
`fl_backend/app/core/exception_handlers.py`.

**A code raised under `app/api/` is a domain rule and has a row in
`fl_backend/app/core/domain.py :: RULES`, which is where what it refuses is stated in full; the protocol codes
in `app/core/` describe who you are, whether the body parses, and whether an id is an ObjectId.**
`fl_backend/tests/core/test_domain.py :: test_every_domain_rule_the_application_defines_is_declared` holds
that correspondence in both directions and excuses the protocol codes by name, and
`:: test_the_protocol_codes_are_the_ones_outside_the_api_layer` pins the excused set — without which the
exclusion list could grow to cover a real domain rule and stay green.

Every domain refusal is a 409, for one reason: nothing about the payload is malformed, so the same request
would have succeeded against a different state of the database
(`fl_backend/app/core/exceptions.py :: DocumentConflictException`).

**That reason holds where the caller is a stranger, so the public application form's refusals are 409s
too and a shut window is not a 403.** The endpoint is open to everyone
([`docs/backend/spec.md`](../backend/spec.md) §1.1) and what refuses is the season's own state: the
same submission would have been stored a week earlier, or before another school took the Kürzel.
`REQ-*` still names a rule the request broke, and on this form the one who acts on it is a member of
the public.

**`DB-COMMON-001` is also what a season the base tier may not read answers**, deliberately the same code
and body an id naming nothing gets ([`docs/backend/spec.md`](../backend/spec.md) I47), so a 404 carrying
it is never on its own proof that the document is absent.

**Which codes name a STEP rather than a state** (`docs/backend/spec.md :: I44`), and the payload that makes
each set behave that way:

- **A season patch replaces `rules` wholesale**, so `REQ-RULES-001`, `REQ-RULES-004`, `REQ-RULES-006`,
  `REQ-RULES-007`, `REQ-RULES-008`, `REQ-RULES-009`, `REQ-RULES-010`, `REQ-RULES-011`, `REQ-RULES-012`
  and `REQ-RULES-013` arrive on the edit that introduces or worsens the violation and let a resubmission
  of the stored values through.
- **A matchday patch carries `beginn` and `ende` together**, so an `ende`-only edit resubmits the stored
  `beginn` and `REQ-DATE-008` judges the pair.
- **A match patch carries both `quelle` fields**, so `REQ-WIRING-001`, `REQ-WIRING-002` and `REQ-WIRING-003`
  judge the side whose source the save MOVES and leave a fixture already wired out of rule editable.

**`REQ-RULES-011` composes a repair per field that moved**, the three fields it names not sharing one. The
freeze is absolute on the patch, and **whether it is a dead end depends on the season**: both repairs run
only while the season is planned and nothing is recorded against a fixture. **The German an admin sees
carries neither the window nor the repair**, and deliberately: the 409 arm holds only the code, so a
sentence worded there could offer the reader a condition to evaluate and nothing more.
`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/FormRegelnSection.tsx :: SHAPE_NOTE`
states whichever of the three cases holds for the season in hand, and the toast sends the reader there.
Which route leads back for which field is
[`docs/domain.md`](../domain.md#a-seasons-rules-are-the-interesting-case).

**`Worded by` cites the module answering a code with German rather than quoting the sentence.** The
meaning is already in the column beside it and in `fl_backend/app/core/domain.py :: RULES`, and several
codes are worded at more than one site, so words here would be a third statement and still not the whole
of one. **Held is the citation and nothing behind it**: the named module still answers that code, while
whether its German states what the backend refuses on is a reading no check makes. The cell names the
write path that raises the code, never the undo route, which words a replayed refusal a second time
([`docs/frontend/spec.md`](../frontend/spec.md#13-admin-mutations)); **where a rule declares several
operations the cell names the FIRST**, so a code gaining an endpoint gains no second cell and the
choice is derivable rather than remembered. The check holds neither of those two: both are read by a
person. A row outside `RULES` carries `—`, an
authentication, validation, ObjectId or database failure reaching German chosen by HTTP status: a
per-code sentence for a 500 would name a repair that does not exist.

| Code                  | Status | Meaning                                                                                                                                                | Worded by                                                                    |
| --------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `REQ-AUTH-001`        | 401    | No bearer credentials presented                                                                                                                        | —                                                                            |
| `REQ-AUTH-002`        | 401    | `base` key invalid                                                                                                                                     | —                                                                            |
| `REQ-AUTH-003`        | 401    | `system` key invalid                                                                                                                                   | —                                                                            |
| `REQ-AUTH-004`        | 401    | `admin` key invalid                                                                                                                                    | —                                                                            |
| `REQ-AUTH-005`        | 401    | No usable `X-FL-Actor` header on an admin-tier write                                                                                                   | —                                                                            |
| `REQ-VAL-001`         | 422    | Request payload or parameters failed validation                                                                                                        | —                                                                            |
| `REQ-OID-001`         | 400    | A malformed ObjectId reached a handler — the net behind the path convertor and the query models, unreachable through routed traffic                    | —                                                                            |
| `REQ-RULES-001`       | 409    | A step made `number_of_groups` × `qualifiers_per_group` a product no phase set holds                                                                   | `fl_frontend/src/features/saisons/actions.ts :: mapRulesRefusal`             |
| `REQ-RULES-002`       | 409    | `number_of_groups` would drop below a group that still holds teams                                                                                     | `fl_frontend/src/features/saisons/actions.ts :: mapRulesRefusal`             |
| `REQ-RULES-003`       | 409    | `teams_per_group` would drop below the fullest group's occupancy                                                                                       | `fl_frontend/src/features/saisons/actions.ts :: mapRulesRefusal`             |
| `REQ-RULES-004`       | 409    | `qualifiers_per_group` would drop below a placing a bracket slot already names                                                                         | `fl_frontend/src/features/saisons/actions.ts :: mapRulesRefusal`             |
| `REQ-RULES-005`       | 409    | A finished season's points, qualifier count and tie-break are frozen, because the table derives from them                                              | `fl_frontend/src/features/saisons/actions.ts :: mapRulesRefusal`             |
| `REQ-RULES-006`       | 409    | A narrowing would leave a matchday holding more fixtures than its phase accounts for                                                                   | `fl_frontend/src/features/saisons/actions.ts :: mapRulesRefusal`             |
| `REQ-RULES-007`       | 409    | A step put `qualifiers_per_group` over `teams_per_group`, or widened an excess already there                                                           | `fl_frontend/src/features/saisons/actions.ts :: mapRulesRefusal`             |
| `REQ-RULES-008`       | 409    | A step put `draw_points` over `win_points`, or widened an excess already there                                                                         | `fl_frontend/src/features/saisons/actions.ts :: mapRulesRefusal`             |
| `REQ-RULES-009`       | 409    | `max_kadergroesse` would drop below the largest squad the season already holds                                                                         | `fl_frontend/src/features/saisons/actions.ts :: mapRulesRefusal`             |
| `REQ-RULES-010`       | 409    | A step paired a level `forfeit_ergebnis` with rules that produce a knockout round                                                                      | `fl_frontend/src/features/saisons/actions.ts :: mapRulesRefusal`             |
| `REQ-RULES-011`       | 409    | A drawn season was patched to change one of the SHAPE rules its fixtures were drawn from                                                               | `fl_frontend/src/features/saisons/actions.ts :: mapRulesRefusal`             |
| `REQ-RULES-012`       | 409    | A season patch moved `tiebreak_order` with a knockout fixture already played, abandoned, forfeited, holding a goal count or a stored shoot-out         | `fl_frontend/src/features/saisons/actions.ts :: mapRulesRefusal`             |
| `REQ-RULES-013`       | 409    | A step made the whole fixture list these rules imply larger than one season-scoped read holds                                                          | `fl_frontend/src/features/saisons/actions.ts :: mapRulesRefusal`             |
| `REQ-ACTIVATE-001`    | 409    | The outgoing season still holds fixtures with no result and no `sonderereignis` that awards none                                                       | `fl_frontend/src/features/saisons/actions.ts :: activateSaisonAction`        |
| `REQ-ACTIVATE-002`    | 409    | A `past` season was activated — refused unconditionally, since it would reopen the points and groups its table derives from                            | `fl_frontend/src/features/saisons/actions.ts :: activateSaisonAction`        |
| `REQ-ACTIVATE-003`    | 409    | A season holding no fixtures was activated, which would take the league live with nothing to play                                                      | `fl_frontend/src/features/saisons/actions.ts :: activateSaisonAction`        |
| `REQ-DATE-001`        | 409    | A fixture's date falls outside the span of the matchday it belongs to                                                                                  | `fl_frontend/src/features/spiele/actions.ts :: mapSpielRefusal`              |
| `REQ-DATE-002`        | 409    | A matchday's span falls outside its season's                                                                                                           | `fl_frontend/src/features/spieltage/actions.ts :: mapSpieltagRefusal`        |
| `REQ-DATE-003`        | 409    | A matchday's span would shrink below a date one of its own fixtures holds                                                                              | `fl_frontend/src/features/spieltage/actions.ts :: mapSpieltagRefusal`        |
| `REQ-DATE-004`        | 409    | A season's span would shrink below a dated matchday's own                                                                                              | `fl_frontend/src/features/saisons/actions.ts :: mapRulesRefusal`             |
| `REQ-DATE-005`        | 409    | The season is shorter than the matchdays its own rules imply                                                                                           | `fl_frontend/src/features/saisons/actions.ts :: mapRulesRefusal`             |
| `REQ-DATE-008`        | 409    | Within one phase, a matchday would begin before the nearest dated matchday below its position, or after the nearest one above                          | `fl_frontend/src/features/spieltage/actions.ts :: mapSpieltagRefusal`        |
| `REQ-ENTER-001`       | 409    | A team was entered into a season that is not `future`                                                                                                  | `fl_frontend/src/features/teams/actions.ts :: mapEntryRefusal`               |
| `REQ-ENTER-002`       | 409    | A team was entered into, or moved to, a group the season does not run                                                                                  | `fl_frontend/src/features/teams/actions.ts :: mapEntryRefusal`               |
| `REQ-ENTER-003`       | 409    | A team was entered into, or moved to, a group already holding `teams_per_group` rows                                                                   | `fl_frontend/src/features/teams/actions.ts :: mapEntryRefusal`               |
| `REQ-ENTER-004`       | 409    | A group change reached a team that already holds a fixture in that season, whatever the season's status                                                | `fl_frontend/src/features/teams/actions.ts :: mapEntryRefusal`               |
| `REQ-ENTER-005`       | 409    | A club that has left the LEAGUE was entered into a season, rather than reactivated first                                                               | `fl_frontend/src/features/teams/actions.ts :: mapEntryRefusal`               |
| `REQ-BEWERBUNG-001`   | 409    | An application already decided was accepted or declined a second time                                                                                  | `fl_frontend/src/features/bewerbungen/actions.ts :: mapTriageRefusal`        |
| `REQ-BEWERBUNG-002`   | 409    | Acceptance found neither an existing club nor a new school on the application to enter, or found both                                                  | `fl_frontend/src/features/bewerbungen/actions.ts :: mapTriageRefusal`        |
| `REQ-BEWERBUNG-003`   | 409    | Acceptance found a new school whose own details compose no club the read models can serve                                                              | `fl_frontend/src/features/bewerbungen/actions.ts :: mapTriageRefusal`        |
| `REQ-BEWERBUNG-004`   | 409    | A submission arrived for a season taking no application that day — no window recorded, `offen` false, or the day outside the span                      | `fl_frontend/src/features/bewerbungen/utils.ts :: mapBewerbungSubmitRefusal` |
| `REQ-BEWERBUNG-005`   | 409    | A submission named neither an existing club nor a new school, or named both                                                                            | `fl_frontend/src/features/bewerbungen/utils.ts :: mapBewerbungSubmitRefusal` |
| `REQ-BEWERBUNG-006`   | 409    | A submission picked a club the league does not offer — one `teams` does not hold, or one that has left                                                 | `fl_frontend/src/features/bewerbungen/utils.ts :: mapBewerbungSubmitRefusal` |
| `REQ-BEWERBUNG-007`   | 409    | A submission picked a club that already plays the season it applies for                                                                                | `fl_frontend/src/features/bewerbungen/utils.ts :: mapBewerbungSubmitRefusal` |
| `REQ-BEWERBUNG-008`   | 409    | A submission proposed a Kürzel a club already holds                                                                                                    | `fl_frontend/src/features/bewerbungen/utils.ts :: mapBewerbungSubmitRefusal` |
| `REQ-BEWERBUNG-009`   | 409    | A confirmation link opened no seat of any application — unknown, replaced by a re-send, or deleted with its application                                | `fl_frontend/src/features/bewerbungen/utils.ts :: mapEinwilligungRefusal`    |
| `REQ-BEWERBUNG-010`   | 409    | A seat was answered after the application's confirmation deadline, or after the application had been decided                                           | `fl_frontend/src/features/bewerbungen/utils.ts :: mapEinwilligungRefusal`    |
| `REQ-BEWERBUNG-011`   | 409    | A seat already confirmed or answered with a `Widerspruch`, or one with nothing left to confirm, was answered again or sent a new link                  | `fl_frontend/src/features/bewerbungen/utils.ts :: mapEinwilligungRefusal`    |
| `REQ-BEWERBUNG-012`   | 409    | A contact person confirmed with a date of birth outside the league's age span; nothing was written                                                     | `fl_frontend/src/features/bewerbungen/utils.ts :: mapEinwilligungRefusal`    |
| `REQ-BEWERBUNG-013`   | 409    | Acceptance found a seat its person has not confirmed, on an application carrying a confirmation block                                                  | `fl_frontend/src/features/bewerbungen/actions.ts :: mapTriageRefusal`        |
| `REQ-BEWERBUNG-014`   | 409    | An administrator corrected a contact person's address to one another contact person on the same application already holds                              | `fl_frontend/src/features/bewerbungen/actions.ts :: mapKontaktEmailRefusal`  |
| `REQ-SPIELPLAN-001`   | 409    | A season already holding fixtures was asked to draw one, and the request confirmed no replace                                                          | `fl_frontend/src/features/saisons/actions.ts :: mapSpielplanRefusal`         |
| `REQ-SPIELPLAN-002`   | 409    | A season already holding matchdays was asked to draw one, and the request confirmed no replace                                                         | `fl_frontend/src/features/saisons/actions.ts :: mapSpielplanRefusal`         |
| `REQ-SPIELPLAN-003`   | 409    | A Spielplan was drawn for a season already `past`                                                                                                      | `fl_frontend/src/features/saisons/actions.ts :: mapSpielplanRefusal`         |
| `REQ-SPIELPLAN-004`   | 409    | A Spielplan was drawn while an offered group is off the size its rules ask, or a club stands in a group the season does not offer                      | `fl_frontend/src/features/saisons/actions.ts :: mapSpielplanRefusal`         |
| `REQ-SPIELPLAN-005`   | 409    | A replace of a season's Spielplan was confirmed for a season that is not `future`, or that already holds a recorded fixture                            | `fl_frontend/src/features/saisons/actions.ts :: mapSpielplanRefusal`         |
| `REQ-SPIELPLAN-006`   | 409    | An undraw was asked of a season that is not `future`, or that holds a fixture with something recorded against it                                       | `fl_frontend/src/features/saisons/actions.ts :: undrawSpielplanAction`       |
| `REQ-SWAP-001`        | 409    | A group swap named something other than two clubs of that season standing in different groups                                                          | `fl_frontend/src/features/saisons/actions.ts :: swapGruppenAction`           |
| `REQ-SWAP-002`        | 409    | A group swap reached a season with a knockout fixture already played, abandoned, forfeited, holding a goal count or a stored shoot-out                 | `fl_frontend/src/features/saisons/actions.ts :: swapGruppenAction`           |
| `REQ-SWAP-003`        | 409    | A group swap reached a `past` season, whose table is derived from the groups it would exchange                                                         | `fl_frontend/src/features/saisons/actions.ts :: swapGruppenAction`           |
| `REQ-SWAP-004`        | 409    | A group swap named a club whose Gruppenphase fixture was played, abandoned, forfeited, given a goal count or a stored shoot-out                        | `fl_frontend/src/features/saisons/actions.ts :: swapGruppenAction`           |
| `REQ-SWAP-005`        | 409    | A group swap would have BROKEN a Spieltag, leaving a club in two of its matches                                                                        | `fl_frontend/src/features/saisons/actions.ts :: swapGruppenAction`           |
| `REQ-SWAP-006`        | 409    | A group swap would field a club that has left the season on a fixture dated on or after its exit, or on an undated one, that records no absence for it | `fl_frontend/src/features/saisons/actions.ts :: swapGruppenAction`           |
| `REQ-REPLACE-001`     | 409    | A club was replaced in a `past` season, whose fixtures are the record of who played                                                                    | `fl_frontend/src/features/teams/actions.ts :: mapReplacementRefusal`         |
| `REQ-REPLACE-002`     | 409    | A club was replaced whose fixture in that season was played, abandoned, forfeited, holding a goal count or a stored shoot-out                          | `fl_frontend/src/features/teams/actions.ts :: mapReplacementRefusal`         |
| `REQ-REPLACE-003`     | 409    | A replacement named an incoming club that already holds a row in the season, or named one club on both ends                                            | `fl_frontend/src/features/teams/actions.ts :: mapReplacementRefusal`         |
| `REQ-KONTAKT-001`     | 409    | A contacts save carries the token of a block the row has moved past — an erasure landing between the caller's read and this write                      | `fl_frontend/src/features/kontakte/actions.ts :: mapStaleBlockRefusal`       |
| `REQ-RETIRE-001`      | 409    | A club entered in an `active` or `future` season was asked to retire                                                                                   | `fl_frontend/src/features/teams/actions.ts :: deleteTeamAction`              |
| `REQ-RETIRE-003`      | 409    | A venue still booked for an unplayed fixture was asked to retire                                                                                       | `fl_frontend/src/features/spielorte/actions.ts :: mapRetireRefusal`          |
| `REQ-RETIRE-004`      | 409    | A referee still assigned to an unplayed fixture was asked to retire                                                                                    | `fl_frontend/src/features/schiedsrichter/actions.ts :: mapRetireRefusal`     |
| `REQ-ANONYMISE-001`   | 409    | A referee's name, school or contact details were entered again while an anonymisation of them ran, so it cleared nothing                               | `fl_frontend/src/features/schiedsrichter/actions.ts :: mapAnonymiseRefusal`  |
| `REQ-ANONYMISE-002`   | 409    | A save would write a name, a school or a contact detail back onto a referee whose details were deleted on request                                      | `fl_frontend/src/features/schiedsrichter/actions.ts :: mapEditRefusal`       |
| `REQ-ANONYMISE-003`   | 409    | A referee the erasure retired was asked to come back; a booking would be fresh personal data about somebody who asked to be left out                   | `fl_frontend/src/features/schiedsrichter/actions.ts :: mapReactivateRefusal` |
| `REQ-PURGE-001`       | 409    | A player still in the league was asked to be erased; the erasure needs them retired first                                                              | `fl_frontend/src/features/spieler/actions.ts :: mapErasureRefusal`           |
| `REQ-SPIELTAG-001`    | 409    | A team would play two fixtures of one Spieltag, and the clash cannot be moved                                                                          | `fl_frontend/src/shared/utils/actionError.ts :: OCCUPANT_REFUSALS`           |
| `REQ-SPIELTAG-002`    | 409    | Resolving the bracket would field one team twice on a Spieltag; a pair already stored is reported instead                                              | `fl_frontend/src/features/spiele/actions.ts :: mapSpielRefusal`              |
| `REQ-BOOKING-001`     | 409    | A venue or a referee NEWLY assigned to a fixture is unknown or retired — one already stored survives its target's retirement                           | `fl_frontend/src/features/spiele/actions.ts :: mapSpielRefusal`              |
| `REQ-CLASH-001`       | 409    | A venue or a referee would serve two fixtures less than four hours apart                                                                               | `fl_frontend/src/features/spiele/actions.ts :: mapSpielRefusal`              |
| `REQ-WIRING-001`      | 409    | A save MOVED a side's source to bracket wiring the season cannot hold; a fixture already wired that way stays editable                                 | `fl_frontend/src/shared/utils/actionError.ts :: toActionErrorResult`         |
| `REQ-WIRING-002`      | 409    | A save MOVED a side's source to a group placing on a round past the one this season's bracket opens on                                                 | `fl_frontend/src/shared/utils/actionError.ts :: toActionErrorResult`         |
| `REQ-WIRING-003`      | 409    | A save MOVED a side's source to a placing in a group this season does not run                                                                          | `fl_frontend/src/shared/utils/actionError.ts :: toActionErrorResult`         |
| `REQ-ELIGIBILITY-001` | 409    | A team that has left the season stands on a match dated on or after its exit, and the save changed an input the rule reads                             | `fl_frontend/src/shared/utils/actionError.ts :: OCCUPANT_REFUSALS`           |
| `REQ-ELIGIBILITY-002` | 409    | A newly fielded team holds no `saison_teams` row for the fixture's season                                                                              | `fl_frontend/src/shared/utils/actionError.ts :: OCCUPANT_REFUSALS`           |
| `REQ-RESULT-001`      | 409    | A side carrying goals on a played fixture was emptied rather than switched                                                                             | `fl_frontend/src/features/spiele/actions.ts :: mapSpielRefusal`              |
| `REQ-STATE-002`       | 409    | A fixture whose `sonderereignis` awards nothing was submitted carrying goals                                                                           | `fl_frontend/src/shared/utils/actionError.ts :: OCCUPANT_REFUSALS`           |
| `REQ-STATE-003`       | 409    | A no-show was recorded on a fixture with an unresolved side                                                                                            | `fl_frontend/src/shared/utils/actionError.ts :: OCCUPANT_REFUSALS`           |
| `REQ-SQUAD-001`       | 409    | A squad row names a team holding no junction row for that season                                                                                       | `fl_frontend/src/features/spieler/actions.ts :: mapSquadRefusal`             |
| `REQ-SQUAD-003`       | 409    | A squad row was added to a team already holding the season's `max_kadergroesse`                                                                        | `fl_frontend/src/features/spieler/actions.ts :: mapSquadRefusal`             |
| `REQ-SQUAD-004`       | 409    | A squad row was given a `rolle` another live row of the same team and season already holds                                                             | `fl_frontend/src/features/spieler/actions.ts :: mapSquadRefusal`             |
| `DB-CONN-001`         | 503    | Database client unavailable                                                                                                                            | —                                                                            |
| `DB-CONN-002`         | 503    | The readiness ping could not reach MongoDB (`/system/is_ready`)                                                                                        | —                                                                            |
| `DB-COMMON-001`       | 404    | No document matched the filter                                                                                                                         | —                                                                            |
| `DB-COMMON-002`       | 409    | A unique index refused the write                                                                                                                       | —                                                                            |
| `DB-FAIL-001`         | 500    | A database operation crashed                                                                                                                           | —                                                                            |
| `SRV-VAL-001`         | 500    | A server-side model failed validation outside request parsing — a data bug, not a caller bug                                                           | —                                                                            |
| `SRV-FAIL-001`        | 500    | Unhandled crash                                                                                                                                        | —                                                                            |

## 2. Frontend codes

Declared in `fl_frontend/src/core/errors.ts`, plus the call sites named. Unlike section 1's, this set has no
declaration a test holds it against, so a code added at a call site reaches this table only by hand.

**Two frontend codes sit outside this table**, each grouped with the backend code of its own class: the
environment gate's in [section 3](#3-startup-codes), and the console shim's in
[section 4](#4-forwarded-codes).

**None of them reaches the error page from an admin write.** `runAdminMutation` wraps both entry points — the
admin server actions and the page-owned editors' undo route handlers — logging the failure with its codes and
returning the `FormState` the caller toasts, because a 409 is an ordinary outcome of a create rather than a
crash ([`spec.md`](spec.md#2-invariants) L6).

| Code            | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FE-API-001`    | The API answered with a bad status (`APIBadStatusError`; `serverErrorCode` carries the backend's code)                                                                                                                                                                                                                                                                                                                                                                                                                |
| `FE-API-002`    | The API answered with an unparseable or schema-violating body (`APIMalformedDataError`)                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `FE-NET-001`    | The network did not answer, timeout included (`APINetworkError`, `isTimeout` distinguishes); the mail transport raises it for a stalled send                                                                                                                                                                                                                                                                                                                                                                          |
| `FE-RSC-001`    | Unhandled server-side error, logged by `fl_frontend/src/core/instrumentation.ts :: onRequestError`                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `FE-ACT-001`    | An admin mutation or a public route handler threw something that is not a typed API error (`fl_frontend/src/shared/utils/adminMutation.ts`, `fl_frontend/src/shared/utils/publicRoute.ts`)                                                                                                                                                                                                                                                                                                                            |
| `FE-ACT-002`    | A write committed and its cache invalidation did not — a stale read, never a failed write (`fl_frontend/src/shared/utils/undoRoute.ts`)                                                                                                                                                                                                                                                                                                                                                                               |
| `FE-AUTH-001`   | Auth.js reported an access denial (`fl_frontend/src/core/auth.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `FE-AUTH-002`   | Auth.js reported any other error (`fl_frontend/src/core/auth.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `FE-MAIL-001`   | The mail provider refused an outbound message (`MailSendError`, logged by `fl_frontend/src/core/mail.ts :: sendMail`) — a send that never reached it is `FE-NET-001`, and on the sign-in path `FE-AUTH-002` follows it under the same trace id                                                                                                                                                                                                                                                                        |
| `FE-MAIL-002`   | A message about an application did not reach the people it names — one recipient refused (`fl_frontend/src/features/bewerbungen/notifications.ts :: sendBewerbungMail`, the rest still sent), or the club's name could not be read and nobody was reached at all (`fl_frontend/src/features/bewerbungen/actions.ts :: notifyBewerbung`). What the message reports has already happened, a triage decision and a confirmation alike, so an address reaches the administrator rather than the line                      |
| `FE-MAIL-003`   | A delivery report the application could not accept — a signature it could not verify, a body it could not read, or a record the backend refused. The line carries the event's own name and the backend's status, never the tag block, the mailbox or the provider's prose (`docs/logging/spec.md :: L9`)                                                                                                                                                                                                              |
| `FE-CLIENT-001` | A browser-side crash reported through the ingest route (`fl_frontend/src/app/api/client-error/route.ts`)                                                                                                                                                                                                                                                                                                                                                                                                              |
| `FE-SWEEP-001`  | A retention pass did not finish, for one season or for the whole run (`fl_frontend/src/features/bewerbungen/sweep.ts :: runBewerbungSweep`). The remaining seasons still run, and the next hourly pass retries; the line carries the season and the error's name, never a person. A season whose id is not a four-digit year fails this way every hour until the id is corrected, the clocks reading the season after it being unable to fire at all (`fl_backend/app/api/bewerbungen/services.py :: next_saison_id`) |

## 3. Startup codes

Raised before either service serves anything — the backend's by `fl_backend/app/core/db.py :: lifespan`,
the frontend's by `fl_frontend/src/core/config.ts :: refuseInvalidEnvironment`. Each reaches a log line
and no response, so it carries no status and its `trace_id` is `SYSTEM` — the
code is the whole join key, which is why a boot failure gets one at all
([`spec.md`](spec.md#12-the-stream-contract) §1.2 makes `error_code` a field of every failure line).

`SRV-*` rather than `DB-*`: the side that must act is whoever runs the service, and on
`SRV-BOOT-002` the database is not at fault at all. The container exits and the engine starts it
again on a growing backoff (`docker-compose.yml :: restart`), so `docker ps` shows the backend
restarting rather than stopped and `docker compose logs backend` carries the code once per attempt;
a code seen here is followed by reading those lines rather than by a trace.

**The refusal an operator hits first is the environment gate's, and only the frontend's reaches this
table.** The backend gate fails while the settings the logger is configured from are still being
built, so it leaves the process as a Python traceback on stderr rather than a log line at all
([`spec.md`](spec.md#12-the-stream-contract) §1.2), and what identifies it is the variable names
`fl_backend/app/core/config.py :: get_config` prints. The frontend gate reaches its formatter
directly, so its refusal carries the envelope's fields and a code in whichever format `LOG_FORMAT`
selected, like any other failure line.

| Code           | Meaning                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------- |
| `SRV-BOOT-001` | The MongoDB server could not be reached                                                      |
| `SRV-BOOT-002` | `MONGODB_URI` yielded no server to connect to                                                |
| `SRV-BOOT-003` | The server refused to authenticate the credentials in `MONGODB_URI`                          |
| `SRV-BOOT-004` | The database constraints could not be applied                                                |
| `FE-BOOT-001`  | A frontend environment variable failed validation; the line names the variables and no value |

The first three `SRV-BOOT-*` rows are one decision — `db.py :: _refusal_for`, which pairs each
cause's sentence with its code — so a fourth cause added there takes a fourth row here.

## 4. Forwarded codes

A line neither service raised: output a dependency wrote, put into the envelope by
`fl_frontend/src/core/consoleShim.ts :: installConsoleShim` or propagated to the root handler
`fl_backend/app/core/logging.py :: setup_custom_logger` configures. The writer has no call site of
ours to take a code from, and borrowing the nearest one would file a library's warning under an
application failure, so each route gives what it forwards a code of its own.

**A forwarded code names the route rather than the failure**, so a line carrying one is followed by
reading its `message` and the writer beside it — `source` on the frontend, `module` on the backend —
and never by looking the code up for a cause. A failure worth its own code gets a call site of ours
and a row above.

| Code             | Meaning                                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `FE-CONSOLE-001` | A warning or error reaching `console.*` under the json format, Next's own `⨯ Error` dumps included         |
| `SRV-LOG-001`    | A warning or error from a logger that is not the application's — uvicorn's, PyMongo's, the file reloader's |

## 5. Retired codes

**A spent number stays spent**, so a family with a gap in its run still takes one past its highest.
Each tree holds exactly the codes it raises, while a copied-off log stream
([`spec.md`](spec.md#12-the-stream-contract) §1.2) can carry one of these, so this is the only list
that says what a gap once refused and the only thing telling a spent number from an unallocated one.
The commit that retired one is reached with `git log -S` on the code.

**Each entry is a bullet and never a table row**: the register's reader takes a backticked code in a
row's first cell as a live row (`scripts/checks/docs_gate/error_codes.py :: CODE_ROW_RE`) and would
demand a tree spell every code below.

- **`REQ-DATE-006`** — reserved and raised by nothing. What the reservation covered is unrecorded, no
  revision spelling the code at all; the commit that shipped `REQ-DATE-008` is where the run skipping
  two rather than one is argued.
- **`REQ-DATE-007`** — reserved beside `REQ-DATE-006`, on the same terms.
- **`REQ-RETIRE-002`** — a matchday holding a played match was asked to retire, which would unpublish
  that result.
- **`REQ-SQUAD-002`** — a squad row took a `nummer` another live row of the same team and season
  already held.
- **`REQ-STATE-001`** — what it refused is unrecorded: no revision this history holds spells it, and
  the family's rows open at `REQ-STATE-002`.
