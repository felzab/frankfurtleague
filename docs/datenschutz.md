# Datenschutz — the rulings, held here until each reaches its home

**Purpose:** every data-protection decision I have taken for the league site, recorded once, so
none is lost before the code, a spec sheet or a runbook carries it. A ruling leaves only when its
text has reached its destination, and it moves rather than copies (`docs/_standard/standard.md` COR-2).

Nothing here is a legal conclusion. A ruling marked **Datenschutzexperte consulted** was taken after
consulting one; every other ruling is mine, taken on 2026-09-01 in a review of every open question
and refined on 2026-09-02, and each stands open to a qualified reviewer's correction. Where today's
behaviour differs from a ruling, the entry says so.

| Section                                                                                                    | Answers                                                      |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [1. Responsibility and the request route](#1-responsibility-and-the-request-route)                         | Who the controller is, which authority, where a request goes |
| [2. Consent comes from the person, from 16](#2-consent-comes-from-the-person-from-16)                      | The sign-up flow every ruling on consent assumes             |
| [3. The current pupil records are reset once](#3-the-current-pupil-records-are-reset-once)                 | What happens to the backfilled consents                      |
| [4. What is published, and on what basis](#4-what-is-published-and-on-what-basis)                          | Addresses, names, the team page, crawlers, the notice        |
| [5. Erasure reaches everyone who asks](#5-erasure-reaches-everyone-who-asks)                               | Who can be erased, what erasure reaches, what it does not    |
| [6. Retention is bounded where a bound was chosen](#6-retention-is-bounded-where-a-bound-was-chosen)       | The action log, applications, contacts, access logs          |
| [7. Processors and third parties](#7-processors-and-third-parties)                                         | Who receives data, under which agreement, and the gaps       |
| [9. A local copy of production expires](#9-a-local-copy-of-production-expires)                             | The development practice the rulings bound                   |
| [10. Adjacent decisions were accepted as recommended](#10-adjacent-decisions-were-accepted-as-recommended) | Roadmap items that needed no expert                          |
| [11. Open, and owed a decision](#11-open-and-owed-a-decision)                                              | What the rulings above do not settle                         |

## 1. Responsibility and the request route

- **The controller is the association.** Wherever the privacy notice lands it names
  "Frankfurt League e. V. i. G." until the register entry exists, and drops the suffix the day it
  does. No school and no individual is the controller; the league is run by its pupils as an
  association, and a school-law basis is unavailable.
- **Every request — withdrawal of a consent, access, rectification, erasure, objection — goes to
  kontakt@frankfurtleague.de** until people can act for themselves. The application form's text
  (`fl_frontend/src/core/einwilligung.ts :: LIGA_EINWILLIGUNG`) and the confirmation page's
  (`:: BESTAETIGUNG_EINWILLIGUNG`) both send a reader to the Datenschutzerklärung rather than
  spelling a route, so that page is where this address has to stand. Self-service comes with the account tiers planned for teams, players and referees, and the
  deletion route lives there once they exist.

## 2. Consent comes from the person, from 16

Every ruling below assumes the sign-up flow settled for the next season, which does not exist yet.

- **Everyone signs up for themselves through the website and gives their own consent there** —
  players, referees, contact persons, organisers and administrators alike. An administrator can
  neither create a player nor assume, enter or transcribe a consent on anybody's behalf.
  `8wd7-ff49` holds the question this answers.
- **The minimum age is 16, for everyone, and a sign-up below it is refused.** Sixteen is the age
  at which a person consents for themselves under Art. 8 GDPR in Germany, and one rule for every
  role replaces three. The birthdate is **required** at sign-up and stored, never optional —
  `8y7c-rstr` holds the optional field as the rejected shape and the reason it stays rejected. The
  consent vocabulary's `volljaehrig` (`fl_backend/app/api/spieler/schemas.py :: FLEinwilligung`, and
  `fl_backend/app/core/constraints.py`) pins no age in code and reads as 18, so reading the enum as
  the rule gets the threshold wrong by two years; 16 is the one number the tree already commits to
  for a contact person
  (`fl_backend/app/shared/schemas/bounds.py :: BEWERBUNG_KONTAKT_MIN_AGE_YEARS`).
- **There is no guardian workflow.** The consent a registration composes today asserts a guardian
  (`fl_backend/app/api/spieler/services.py :: registration_einwilligung`) while its only caller
  is an administrator; that path goes with the flow that replaces it, and the consent vocabulary
  then needs to express only a person's own consent and a carried-over record. The comment at
  that line gives a reason that is true of no caller, and is false today.
- **Nothing about a person is published without that person's recorded consent.** The gate reads
  the consent the sign-up flow stores. It may be built before the flow ships, provided every
  pupil row that exists today counts as fully consented, since those rows go at the season's end
  ([section 3](#3-the-current-pupil-records-are-reset-once)) and the gate must not empty the public
  squad lists meanwhile. The predicate is written into
  [`backend/spec.md`](backend/spec.md#17-read-rules) before any code. Today no read consults the
  stored consent.
- **Referees get a consent record** on the same terms as contact persons. A referee is a pupil
  whose phone, email and school are stored, and today no consent field exists for them.

## 3. The current pupil records are reset once

- **The backfilled consents stand until the end of this season.** The pupil rows that were
  backfilled carry a consent nobody was asked for, marked as carried over
  (`bestandsuebernahme`); the rows registered since through the admin form carry the guardian
  consent an administrator composed. Nothing is built against either population and nobody is
  unpublished in the meantime. **Datenschutzexperte consulted.** Ruled 2026-08 and re-confirmed
  2026-09-01 and 2026-09-02.
- **At the end of this season, once, every player row is deleted and the action log is reset in
  full.** From the next season on every player signs up through the website, and from then on
  player records are kept and governed by
  [section 6](#6-retention-is-bounded-where-a-bound-was-chosen); the reset is not repeated. Ruled
  2026-09-02.

## 4. What is published, and on what basis

- **A club's street address is public and the application form says so** (`READ-ADDRESS-002`).
  **Datenschutzexperte consulted.** Ruled 2026-08.
- **The application form's address sentence also belongs on the acceptance screen**, where the
  administrator takes the action that publishes it and which
  `docs/backend/spec.md :: Acceptance publishes a school's address as the club's` already names;
  the admin club forms need none. Ruled 2026-09-01.
- **The organisers named on the public team page each fully agreed to be listed**, having confirmed
  it to me directly on 2026-09-02. Their names are source code in a public repository, so removal is
  a code change plus a deploy, and a name stays in the repository's history regardless. The page's
  source carries this record once it leaves here.
- **AI crawlers are both asked and blocked, and the block is the source of truth.**
  `fl_frontend/src/app/robots.ts` disallows named crawlers, which is a request; the edge's
  crawler block enforces it, and that setting lives in the hosting dashboard rather than in this
  repository, which records that it exists and is deliberate.
- **The free-text fields on public pages stay public** — a fixture's note and a withdrawal's
  reason — with the input saying so (`READ-FREETEXT-001`, `READ-FREETEXT-002`).

## 5. Erasure reaches everyone who asks

- **Anyone — player, referee, contact person, administrator — can have their data deleted, with
  the least asymmetry between roles.** The mechanisms today are
  `DELETE /spieler/{spieler_id}/erasure`, `POST /kontakte/erasure` and
  `POST /schiedsrichter/{schiedsrichter_id}/anonymisieren`; what the referee path leaves on past
  fixtures is `docs/backend/spec.md :: 1.1`'s anonymisation row. Details re-entered
  while an anonymisation runs refuse it (`REQ-ANONYMISE-001`,
  `docs/backend/spec.md :: I118`) rather than answering a success it did not achieve, so the run is
  repeated and nobody is told a person's details are gone while they stand.
- **An erasure keyed on an email address warns first.** Colleagues sharing a school inbox are one
  subject to the match, so the matched names are shown for confirmation before the write. A
  person id across seasons is not introduced: contact persons are season-scoped by design.
- **The administrator's own email on every log row stays, outside every redaction.** The log
  exists to say who did what; the asymmetry is deliberate and is stated at the invariant once it
  leaves here (`docs/backend/spec.md :: I42` is the redaction it sits beside, and `:: I48` what a
  removal records).
- **An administrator's erasure includes the sign-in store.** The second database holding
  administrators' addresses, sessions and sign-in tokens is inside the erasure, and tokens and
  sessions expire rather than persisting unredeemed.
- **Backups outlive an erasure by the snapshot window, and the person is told so.** The hosting
  keeps snapshots for about eight days, taken daily — a figure mirrored from the provider's own
  console, which moves without us, as it stood on 2026-09-01. An erased person is gone from the live
  database at once and from backups within that window, and that sentence is what a requester
  receives. No replay of erasures after a restore is built.
- **A retired row is never removed because of its age.** A player who left a squad, a referee who
  stopped, a club that left and a past season all keep their rows; the one removal is the
  person's own request, and self-service for that request comes with the account tiers. The
  Known-open row `docs/backend/spec.md :: Nothing purges a retired row` carries this today, naming
  `fl_backend/app/core/domain.py :: UNENFORCED` and `docs/backend/spec.md :: I12`, which holds the
  erasure's own refusal code. **Datenschutzexperte consulted.** Ruled 2026-08 and re-confirmed
  2026-09-02.

## 6. Retention is bounded where a bound was chosen

- **The log keeps storing the full prior document on every write, person-bearing rows included.**
  That copy is what a restore over the log replays, which is the log's purpose, and the
  twelve-month bound `docs/backend/spec.md :: I119` states is what answers the accumulation. Dropping the copies would remove the
  log's value exactly where writes matter most. A person who asks for erasure still has their log
  rows emptied and stamped inside the transaction that removes them
  (`docs/backend/spec.md :: I42`); what the bound answers is the copies of everyone who never
  asked. Ruled 2026-09-02.
- **A declined application is kept for one month after the decision, its three people's contact
  details included, then deleted. An accepted application is kept for the season it was accepted
  for and the season after it, then deleted.** The retention sweep runs both clocks
  (`docs/backend/spec.md :: I153` and `:: I154`), and the application's own privacy text states
  both periods once it exists. This bounds the permanent record that `docs/glossary.md :: Bewerbung`
  and `docs/backend/spec.md :: a decided application stays listed` describe. Ruled 2026-09-02.
- **A season's contact persons follow the accepted application's clock**: their contact block is
  cleared when the season after the one they were collected for ends. The consent text scopes
  itself to one season, and the clearing uses the mechanism the erasure already had. Ruled
  2026-09-02.
- **Access logs stay on the host and are bounded by age as well as by size: eight days.** The
  host's own nginx log carries the visitor's address, user agent and referer and survives a
  deploy, so the only bound today is the container runtime's size rotation
  (`docs/logging/spec.md :: Retention is Docker's`). A size bound is a period set by traffic volume
  rather than chosen, so a quiet month keeps addresses far longer than a busy one. The bound is the
  backup window an erased person is told about ([section 5](#5-erasure-reaches-everyone-who-asks)),
  which lets one figure answer both the access-log question and the erasure question. Nothing is
  shipped to a collector: that would lengthen retention and add a processor receiving visitors'
  addresses. That the access line carries no credential is a separate guarantee, held by
  `nginx/redaction_test.sh` in the gate's ops scope.

## 7. Processors and third parties

Every row mirrors that provider's own legal pages, which move without us and were read on
2026-09-02.

| Processor                      | What reaches them                                                                                                                                                                                                       | Agreement                                                                                               | Where the data is                                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Resend                         | Applicants' and administrators' email addresses, and every message the league sends in full — the two decisions, the submission's receipt and the confirmation links, a confirmation link being a single-use credential | Standard Art. 28 addendum, in force for every account on sign-up; an executed copy is downloadable      | United States for all stored data; the EU region changes only where mail is dispatched from; transfer rests on the SCCs |
| Cloudflare                     | Every request in plaintext at the edge: addresses, URLs, headers, form bodies                                                                                                                                           | Standard addendum incorporated by reference into the self-serve agreement                               | Edge processing worldwide; content not stored for the core services; region pinning is an enterprise-only add-on        |
| MongoDB Atlas                  | Both databases and their backup snapshots                                                                                                                                                                               | Standard addendum incorporated into the cloud terms, accepted by creating the account                   | The chosen deployment region; single-region snapshots stay in the cluster's region                                      |
| Proton (the league's mailbox)  | Every request and reply, correspondence with referees, contacts and applicants                                                                                                                                          | **None on the personal plan in use.** Proton for Business carries one; the upgrade is the fix           | Switzerland                                                                                                             |
| Gmail, via members' forwarding | Whatever league mail a member opens in a personal Gmail account                                                                                                                                                         | **None — a consumer Gmail account has no processing agreement.** Accepted for now, as a known gap       | Not committed                                                                                                           |
| WhatsApp (consumer app)        | Phone numbers and messages of anyone who contacts the league that way                                                                                                                                                   | **None for the consumer app**; the consent text discloses the channel. Accepted for now, as a known gap | Not committed                                                                                                           |

**Nothing is left to sign for Resend, Cloudflare and MongoDB Atlas.** Ruled 2026-09-02. What is
owed:

- Keep the dated agreement pages, and Resend's executed copy with the account's acceptance date.
- Record Resend's United States storage as a transfer.
- Leave the gaps in bold accepted, and named so the notice can tell the truth about them.

## 9. A local copy of production expires

- **A local copy of production refuses to be reused after seven days.** `./scripts/ops/local.sh --seed`
  fills the local stack from a production dump (`scripts/ops/local.sh :: take_dump`), and the copy is
  whole. The disk is encrypted and one person holds the connection string; the bound is what
  stops cleanup depending on memory. Today the copy is reused at any age
  (`docs/ops/spec.md :: however old it is`); this ruling narrows that.

## 10. Adjacent decisions were accepted as recommended

Roadmap items that needed no expert, each accepted on 2026-09-02 as its entry recommends. What is
still to do is that entry's own `Status` in [`_roadmap/items.md`](_roadmap/items.md).

| Entry       | Decision                                                                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skyx-nrgh` | Narrow the refusal's sentence to the window in which the undraw it recommends is possible                                                            |
| `kyc4-75k5` | The player editor shows the stored consent, read-only; it never gates publication                                                                    |
| `n56q-zu6n` | Relabel the league's own people's page; keep its route                                                                                               |
| `huzh-hdfx` | Replace the §7 clause's first half with the spec's formulation and keep the second half — a `.claude/CLAUDE.md` edit only I authorise, and I do here |
| `cu59-4gqt` | Stays deferred until a rollover is actually missed                                                                                                   |
| `2pqm-yxyu` | Authenticated origin pulls are the cheapest real fix; a tunnel is the strongest                                                                      |

## 11. Open, and owed a decision

- **No Datenschutzexperte has seen the rulings this page does not mark as consulted**, and the
  privacy notice they feed is still a draft. Both stand over the request and the breach procedures
  in [`ops/runbooks.md`](ops/runbooks.md), which answer a person on the strength of the rulings
  above.
- **The access-log bound is not yet configured at Cloudflare's own edge.**
  [Section 6](#6-retention-is-bounded-where-a-bound-was-chosen) is meant to reach the edge log
  (`docs/logging/spec.md :: Cloudflare logs the request line`) as well as the host's; Cloudflare's
  retention is set in its dashboard rather than in this repository.
