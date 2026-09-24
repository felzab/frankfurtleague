# Logging — error codes

**Scope:** every `error_code` value either service emits, live and retired, and which of them a
response body carries; a live domain rule's is stated at `fl_backend/app/core/domain.py :: RULES`
instead.

**A failure answers `{error_code, trace_id}`, and a refused payload adds where each refusal sits**
([`spec.md`](spec.md#2-invariants) L4): the message, the refused value and the stack trace reach the log and
never the wire, so a code seen on a response is followed by finding the log line carrying that same code
under that trace id.

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
required to have a row unless `RULES` declares it, which no row may restate, so the backend codes the
frontend words for a reader are not read as the frontend's own. **It reads the shape rather than the four areas** (`:: CODE_SHAPE`), so a fifth area
would owe a row like any other rather than dropping out of both populations unseen.

**`READ-*` shares that shape and is not an error code.** A read rule refuses nothing, so it reaches no
response body, no log line and no row on this page, and the `RULES` correspondence below is scanned over
`REQ-` alone. What a read rule governs is which tier a field is served
([`docs/backend/spec.md`](../backend/spec.md#17-tier-rules) §1.7).

| Section                               | Answers                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| [Backend codes](#1-backend-codes)     | Every code FastAPI raises outside the domain rules, and its status                        |
| [Frontend codes](#2-frontend-codes)   | Every code the Next surface raises, and why an admin write's never reaches the error page |
| [Startup codes](#3-startup-codes)     | Every code a boot refusal carries, none of which answers a request                        |
| [Forwarded codes](#4-forwarded-codes) | The code a line neither service raised carries, on both surfaces                          |
| [Retired codes](#5-retired-codes)     | What each gap in a run once refused, and why the number stays spent                       |

## 1. Backend codes

The exception types carrying them are declared in `fl_backend/app/core/exceptions.py` and handled in
`fl_backend/app/core/exception_handlers.py`.

**A code raised under `app/api/` is a domain rule, stated in full at
`fl_backend/app/core/domain.py :: RULES` and published on its operations' 409s in
`fl_backend/openapi.json`, and it takes no row here; the protocol codes in `app/core/` describe who you
are, whether the body parses, and whether an id is an ObjectId.**
`fl_backend/tests/core/test_domain.py :: test_every_domain_rule_the_application_defines_is_declared` holds
that correspondence in both directions, excusing the protocol codes by name, and
`:: test_the_protocol_codes_are_the_ones_outside_the_api_layer` pins the excused set.

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
only while the season is planned and nothing is recorded against a fixture. The German an admin sees
carries neither the window nor the repair and sends the reader to
`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/FormRegelnSection.tsx :: SHAPE_NOTE`,
which states whichever of the three cases holds for the season in hand. Which route leads back for
which field is [`docs/domain.md`](../domain.md#a-seasons-rules-are-the-interesting-case).

| Code            | Status | Meaning                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REQ-AUTH-001`  | 401    | No bearer credentials presented                                                                                                                                                                                                                                                                                                                                                                                     |
| `REQ-AUTH-002`  | 401    | `base` key invalid                                                                                                                                                                                                                                                                                                                                                                                                  |
| `REQ-AUTH-003`  | 401    | `system` key invalid                                                                                                                                                                                                                                                                                                                                                                                                |
| `REQ-AUTH-004`  | 401    | `admin` key invalid                                                                                                                                                                                                                                                                                                                                                                                                 |
| `REQ-AUTH-005`  | 401    | No usable `X-FL-Actor` header on an admin-tier write                                                                                                                                                                                                                                                                                                                                                                |
| `REQ-VAL-001`   | 422    | Request payload or parameters failed validation                                                                                                                                                                                                                                                                                                                                                                     |
| `REQ-OID-001`   | 400    | A malformed ObjectId reached a handler — the net behind the path convertor and the query models, unreachable through routed traffic                                                                                                                                                                                                                                                                                 |
| `DB-CONN-001`   | 503    | Database client unavailable                                                                                                                                                                                                                                                                                                                                                                                         |
| `DB-CONN-002`   | 503    | The readiness ping could not reach MongoDB (`/system/is_ready`)                                                                                                                                                                                                                                                                                                                                                     |
| `DB-COMMON-001` | 404    | No document matched the filter                                                                                                                                                                                                                                                                                                                                                                                      |
| `DB-COMMON-002` | 409    | A unique index refused the write                                                                                                                                                                                                                                                                                                                                                                                    |
| `DB-FAIL-001`   | 500    | A database operation crashed, or a request writing nothing ran out its deadline (`docs/backend/spec.md :: I320`), which its line says as "Database deadline passed". The status is the RAISED path's: the code also logs on a request that answers 200, where `fl_backend/app/api/saisons/admin_router.py :: _mail_one_team` catches one team's failure and answers a row rather than losing the other teams' links |
| `DB-FAIL-002`   | 500    | A write that may stand: a commit the driver labels of unknown outcome, or a write request the deadline cut (`docs/backend/spec.md :: I321`). The page says the outcome is unclear rather than failed. Also logged, answering 200, where `fl_backend/app/api/saisons/admin_router.py :: _mail_one_team` answers that team's row `erzeugung_ungewiss`                                                                 |
| `SRV-VAL-001`   | 500    | A server-side model failed validation outside request parsing — a data bug, not a caller bug                                                                                                                                                                                                                                                                                                                        |
| `SRV-FAIL-001`  | 500    | Unhandled crash, a sweep's declared stall among them (`docs/backend/spec.md :: I295`)                                                                                                                                                                                                                                                                                                                               |

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

| Code            | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FE-API-001`    | The API answered with a bad status (`APIBadStatusError`; `serverErrorCode` carries the backend's code)                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `FE-API-002`    | The API answered with an unparseable or schema-violating body (`APIMalformedDataError`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `FE-NET-001`    | The network did not answer, timeout included (`APINetworkError`: `isTimeout` distinguishes, and `method` names the request); a write whose answer never arrived is answered as of unknown outcome, as `DB-FAIL-002` is; the mail transport raises it for a stalled send                                                                                                                                                                                                                                                                                           |
| `FE-RSC-001`    | Unhandled server-side error, logged by `fl_frontend/src/core/instrumentation.ts :: onRequestError`                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `FE-ACT-001`    | An admin mutation or a public route handler threw something that is not a typed API error (`fl_frontend/src/shared/utils/adminMutation.ts`, `fl_frontend/src/shared/utils/publicRoute.ts`)                                                                                                                                                                                                                                                                                                                                                                        |
| `FE-ACT-002`    | An undo's cache invalidation did not run, whatever its restore wrote — a stale read, never a failed write (`fl_frontend/src/shared/utils/undoRoute.ts`)                                                                                                                                                                                                                                                                                                                                                                                                           |
| `FE-AUTH-002`   | A sign-in the application could not complete: the link's send failed (`fl_frontend/src/core/auth.ts`), or the whole request the action scheduled behind its response threw (`fl_frontend/src/features/auth/actions.ts`). The line carries the error's NAME and nothing else, an error on this path routinely holding the submitted address (`docs/logging/spec.md :: L9`)                                                                                                                                                                                         |
| `FE-AUTH-003`   | The sign-in LIBRARY's own error stream, shaped into this envelope (`fl_frontend/src/core/auth.ts :: logger`). The line carries an event this repository named and the raised error's NAME; the library's message is dropped, because each of the messages it raises at this level ends in the value that was rejected — a `callbackURL`, an `origin` (`docs/logging/spec.md :: L9`). The events are `auth.origin_refused`, `auth.callback_refused`, `auth.cross_site_login_blocked` and `auth.library_failed`, the last being anything the map does not recognise |
| `FE-AUTH-004`   | A passkey change the administrator was not told about: the notice's send failed (`fl_frontend/src/core/auth.ts :: notify`). The change stands — a row rolled back for an unreachable mailbox is a lockout nobody asked for. The line carries the error's NAME alone, a failure on this path routinely holding the address (`docs/logging/spec.md :: L9`)                                                                                                                                                                                                          |
| `FE-AUTH-005`   | Two changes to one administrator's passkeys met, or a removal's sign-out met another write to that administrator's sessions, and the database refused one (`fl_frontend/src/core/auth.ts :: claimAccount`, `:: removePasskey`): an enrolment answered 409, or a removal refused. The line is the record, and under a stolen mailbox racing the administrator's own first enrolment it is the only one. It carries the event and nothing else: `auth.passkey_enrolment_conflict` or `auth.passkey_removal_conflict`                                                |
| `FE-MAIL-001`   | The mail provider refused an outbound message (`MailSendError`, logged by `fl_frontend/src/core/mail.ts :: sendMail`) — a send that never reached it is `FE-NET-001`, and on the sign-in path `FE-AUTH-002` follows it under the same trace id                                                                                                                                                                                                                                                                                                                    |
| `FE-MAIL-002`   | A message about an application did not reach the people it names — one recipient refused (`fl_frontend/src/features/bewerbungen/notifications.ts :: sendBewerbungMail`, the rest still sent), or the club's name could not be read and nobody was reached at all (`fl_frontend/src/features/bewerbungen/actions.ts :: notifyBewerbung`). What the message reports has already happened, a triage decision and a confirmation alike, so an address reaches the administrator rather than the line                                                                  |
| `FE-MAIL-003`   | A delivery report the application could not accept — a signature it could not verify, a body it could not read, or a record the backend refused. The line carries the event's own name and the backend's status, never the tag block, the mailbox or the provider's prose (`docs/logging/spec.md :: L9`)                                                                                                                                                                                                                                                          |
| `FE-MAIL-004`   | A message a deployment that does not mail withheld — `APP_ENV` is not `production`, or no `AUTH_RESEND_KEY` was demanded of it (`fl_frontend/src/core/mail.ts :: sendMail`, raising `MailWithheldError`). Outside `production` the message is written to the directory `fl_frontend/src/core/mail.ts :: MAIL_SINK_DIR` names and the line carries that file's name, which is where a developer reads what nobody was sent; the line also carries the subject and the send's tags, never the recipient or a body (`docs/logging/spec.md :: L9`)                    |
| `FE-MAIL-005`   | A withheld message that reached no file — the sink's directory or its own name was refused (`fl_frontend/src/core/mail.ts :: writeToSink`). The send was refused either way, so this never means a message went; it means the deployment has nothing for the developer to open, and the line carries the errno token alone, never the path, the recipient or a body                                                                                                                                                                                               |
| `FE-MAIL-006`   | A message's delivery state reached no record, on one of two lines. A provider event whose tags name a kind this side has no home for, or no row at all, logs `grund` as `ziel_unbekannt` or `ziel_id_unlesbar`, with the kind where it parsed (`fl_frontend/src/app/api/mail/zustellung/route.ts`). An accepted send the backend applied to nothing logs its kind and operation (`fl_frontend/src/features/zustellung/notifications.ts`). Neither line carries the recipient, the row's id or the raw tag value (`docs/logging/spec.md :: L9`)                    |
| `FE-MAIL-007`   | A sign-in link's message reached the administrator it was addressed to in any state but delivered, as the provider reported it (`fl_frontend/src/app/api/mail/zustellung/route.ts`). This kind keeps no delivery record and no page shows one, so the LINE is the record, and somebody who is locked out of the only surface they reach that way is found here; it carries the reported state and the provider's message id, never the address (`docs/logging/spec.md :: L9`)                                                                                     |
| `FE-MAIL-008`   | The message telling somebody their address has been barred did not reach them (`fl_frontend/src/features/sperrliste/actions.ts :: benachrichtigen`). The ban itself stands and its administrator is told the person was not reached; the address was typed for that one send and is stored nowhere, so nothing can re-send it and the line is the only record that a ban went out unannounced. It carries the error's NAME alone, never the address (`docs/logging/spec.md :: L9`)                                                                                |
| `FE-CLIENT-001` | A browser-side crash reported through the ingest route (`fl_frontend/src/app/api/client-error/route.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `FE-SWEEP-001`  | A retention pass did not finish, for one season or for the whole run (`fl_frontend/src/features/bewerbungen/sweep.ts :: runBewerbungSweep`). The remaining seasons still run, and the next hourly pass retries; the line carries the season and the error's name, never a person. A season whose id is not a four-digit year fails this way every hour until the id is corrected, the clocks reading the season after it being unable to fire at all (`fl_backend/app/api/bewerbungen/services.py :: next_saison_id`)                                             |

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
table**, the backend's leaving the process as a Python traceback on stderr before its logger is
configured ([`spec.md`](spec.md#12-the-stream-contract) §1.2): what identifies it is the variable
names `fl_backend/app/core/config.py :: get_config` prints.

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
- **`REQ-ANONYMISE-001`** — a referee's details were entered again while an anonymisation of them
  ran, so it cleared nothing; an erasure that deletes the row leaves no such state.
- **`REQ-ANONYMISE-002`** — a save would have written a detail back onto an anonymised referee; there
  is no anonymised row to write onto.
- **`REQ-ANONYMISE-003`** — a referee the erasure retired was asked back; the deleted row cannot be.
- **`REQ-RETIRE-002`** — a matchday holding a played match was asked to retire, which would unpublish
  that result.
- **`REQ-SQUAD-002`** — a squad row took a `nummer` another live row of the same team and season
  already held.
- **`REQ-STATE-001`** — what it refused is unrecorded: no revision this history holds spells it, and
  the family's rows open at `REQ-STATE-002`.
- **`FE-AUTH-001`** — a sign-in library reported an access denial. The allowlist gate is this
  repository's own and answers an unlisted address by returning rather than by raising
  (`fl_frontend/src/core/auth.ts :: sendMagicLink`), so nothing on that path has a denial to report.
