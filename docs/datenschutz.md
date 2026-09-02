# Datenschutz — the rulings, held here until each reaches its home

**Purpose:** every data-protection decision I have taken for the league site, recorded once, so
none is lost between the moment it was taken and the moment the code, a spec sheet or a runbook
carries it. **This file is a temporary holding place, not the rulings' permanent home.** Where
each ruling finally lives is a separate decision, taken once the shape of the whole set is known;
until then a ruling leaves this file only when its text has reached its destination — a read
rule, a spec-sheet invariant, a comment at the line it constrains, a runbook section or a roadmap
entry — and the text moves rather than copies, so this file only ever shrinks. It is neither a
spec sheet nor an overview: `docs/standard.md` OUT-1 names it among the exceptions to the two
layers, and it goes when it is empty.

Nothing here is a legal conclusion. The rulings marked 2026-08 were taken after consulting a
Datenschutzexperte; every other ruling is mine, taken on 2026-09-01 in a review of every open
question and refined on 2026-09-02, and each stands open to a qualified reviewer's correction. A
ruling is a decision about how the system is to behave; where today's behaviour differs, the
entry says so, because a ruling written in the present tense reads as a description.

| Section                                                                                                       | Answers                                                      |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [1. Responsibility and the request route](#1-responsibility-and-the-request-route)                            | Who the controller is, which authority, where a request goes |
| [2. Consent comes from the person, from 16](#2-consent-comes-from-the-person-from-16)                         | The sign-up flow every ruling on consent assumes             |
| [3. The current pupil records are reset once](#3-the-current-pupil-records-are-reset-once)                    | What happens to the backfilled consents                      |
| [4. What is published, and on what basis](#4-what-is-published-and-on-what-basis)                             | Addresses, names, the team page, crawlers, the notice        |
| [5. Erasure reaches everyone who asks](#5-erasure-reaches-everyone-who-asks)                                  | Who can be erased, what erasure reaches, what it does not    |
| [6. Retention is bounded where a bound was chosen](#6-retention-is-bounded-where-a-bound-was-chosen)          | The action log, applications, contacts, access logs          |
| [7. Processors and third parties](#7-processors-and-third-parties)                                            | Who receives data, under which agreement, and the gaps       |
| [8. Two procedures still to be written](#8-two-procedures-still-to-be-written)                                | Rights requests and breaches                                 |
| [9. A local copy of production expires](#9-a-local-copy-of-production-expires)                                | The development practice the rulings bound                   |
| [10. Adjacent decisions were accepted as recommended](#10-adjacent-decisions-were-accepted-as-recommended)    | Roadmap items that needed no expert                          |
| [11. A ruling carried elsewhere is cited, not restated](#11-a-ruling-carried-elsewhere-is-cited-not-restated) | The rows and lines that carry or contradict a ruling today   |
| [12. Open, and owed a decision](#12-open-and-owed-a-decision)                                                 | What this round did not settle                               |

## 1. Responsibility and the request route

- **The controller is the association.** Wherever the privacy notice lands it names
  "Frankfurtleague e. V. i. G." until the register entry exists, and drops the suffix the day it
  does. No school and no individual is the controller; the league is run by its pupils as an
  association, and a school-law basis is unavailable. Ruled 2026-09-01, spelling fixed
  2026-09-02.
- **The supervisory authority is Der Hessische Beauftragte für Datenschutz und
  Informationsfreiheit** in Wiesbaden, reached at datenschutz.hessen.de, which supervises
  associations seated in Hesse. A personal-data breach is reported through its Art. 33 form within
  72 hours of becoming aware of it; requesting the upload link does not stop that clock. This is a
  fact read from the authority's own pages on 2026-09-02, recorded here because section 8's
  breach procedure needs it, not a ruling.
- **Every request — withdrawal of a consent, access, rectification, erasure, objection — goes to
  kontakt@frankfurtleague.de** until people can act for themselves. The consent text
  (`fl_frontend/src/core/einwilligung.ts`) promises withdrawal at any time and today names no
  route; it names this address from its next version. Self-service comes with the account tiers
  planned for teams, players and referees, and the deletion route lives there once they exist.
  Ruled 2026-09-01, address given 2026-09-02.

## 2. Consent comes from the person, from 16

Every ruling below assumes the sign-up flow settled for the next season, which does not exist
yet. The rulings are recorded against it deliberately: they are decisions, not implementations.

- **Everyone signs up for themselves through the website and gives their own consent there** —
  players, referees, contact persons, organisers and administrators alike. An administrator can
  neither create a player nor assume, enter or transcribe a consent on anybody's behalf. Ruled
  2026-09-01, scope confirmed 2026-09-02.
- **The minimum age is 16, for everyone, and a sign-up below it is refused.** Sixteen is the age
  at which a person consents for themselves under Art. 8 GDPR in Germany, and one rule for every
  role replaces three. The birthdate is **required** at sign-up and stored, because the check
  cannot run without it; this supersedes the optional field `BE-48` decided. The consent
  vocabulary's `volljaehrig` (`fl_backend/app/api/spieler/schemas.py :: FLEinwilligung`) pins no
  age in code and reads as 18; the threshold this ruling sets is 16, the one number the tree
  already commits to for a contact person (`fl_backend/app/shared/schemas/bounds.py ::
BEWERBUNG_KONTAKT_MIN_AGE_YEARS`). Ruled 2026-09-01 and 2026-09-02.
- **There is no guardian workflow.** The consent a registration composes today asserts a guardian
  (`fl_backend/app/api/spieler/services.py :: registration_einwilligung`) while its only caller
  is an administrator; that path goes with the flow that replaces it, and the consent vocabulary
  then needs to express only a person's own consent and a carried-over record. The comment at
  that line gives a reason that is true of no caller, and is false today. Ruled 2026-09-01.
- **Nothing about a person is published without that person's recorded consent.** The gate reads
  the consent the sign-up flow stores. It may be built before the flow ships, provided every
  pupil row that exists today counts as fully consented, since those rows go at the season's end
  (section 3) and the gate must not empty the public squad lists meanwhile. The predicate is
  written into the read-rules table of `docs/backend/spec.md` before any code. Today no read
  consults the stored consent. Ruled 2026-09-01, build-order 2026-09-02.
- **Every version of a consent text is retained**, so a stored consent's version label resolves
  to the words the person agreed to from the running application, not from git history. Ruled
  2026-09-01.
- **An application names three people and one person ticks for all of them.** The two who were
  not asked are recorded as entered on their behalf, never as having consented themselves, and
  each receives their own link to give the consent. The vocabulary exists:
  `fl_backend/app/api/teams/schemas.py :: FLKontaktEinwilligung` distinguishes `person` from
  `administrativ`; today the public form composes `person` for all three. Ruled 2026-09-01.
- **Referees get a consent record** on the same terms as contact persons. A referee is a pupil
  whose phone, email and school are stored, and today no consent field exists for them. Ruled
  2026-09-01.

## 3. The current pupil records are reset once

- **The backfilled consents stand until the end of this season.** The pupil rows that were
  backfilled carry a consent nobody was asked for, marked as carried over
  (`bestandsuebernahme`); the rows registered since through the admin form carry the guardian
  consent an administrator composed. Nothing is built against either population and nobody is
  unpublished in the meantime. Ruled 2026-08 and re-confirmed 2026-09-01 and 2026-09-02.
- **At the end of this season, once, every player row is deleted and the action log is reset in
  full.** From the next season on every player signs up through the website, and from then on
  player records are kept and governed by section 6; the reset is not repeated. Ruled
  2026-09-02.

## 4. What is published, and on what basis

- **A club's street address is public and the application form says so** (2026-08,
  Datenschutzexperte consulted; `READ-ADDRESS-002`). The sentence also belongs on the acceptance
  screen, where the administrator takes the action that publishes it; the admin club forms need
  none. Ruled 2026-09-01.
- **The organisers named on the public team page each fully agreed to be listed**, and I confirm
  it. Their names are source code in a public repository, so removal is a code change plus a
  deploy, and a name stays in the repository's history regardless. The page's source carries this
  record once it leaves here. Ruled 2026-09-01, agreement confirmed 2026-09-02.
- **AI crawlers are both asked and blocked, and the block is the source of truth.**
  `fl_frontend/src/app/robots.ts` disallows named crawlers, which is a request; the edge's
  crawler block enforces it, and that setting lives in the hosting dashboard rather than in this
  repository, which records that it exists and is deliberate. Ruled 2026-09-01.
- **An erased referee's name on a past fixture is to be replaced by a neutral label spelled
  "anonym"** — not by a first name, and not by the word "Schiedsrichter", which would read oddly
  in a column already headed with it. A first name with a date and a club still identifies one
  person in a league this size. Today the anonymisation clears the contact block only
  (`fl_backend/app/api/schiedsrichter/services.py :: ANONYMISED_KONTAKT`) and the name stays on
  every past fixture. Ruled 2026-09-01, wording 2026-09-02.
- **The free-text fields on public pages stay public** — a fixture's note and a withdrawal's
  reason — with the input saying so (`READ-FREETEXT-001`, `READ-FREETEXT-002`). Ruled
  2026-09-01.
- **The privacy notice becomes a static route in this repository**, linked from the footer and
  from the application form, and it is live before the self-signup flow opens, because that flow
  is the moment people consent to a document they must be able to read. Kept in the tree it is
  served, and it is checked by the same gate as everything else. Ruled 2026-09-01.

## 5. Erasure reaches everyone who asks

- **Anyone — player, referee, contact person, administrator — can have their data deleted, with
  the least asymmetry between roles.** The mechanisms today are
  `DELETE /spieler/{spieler_id}/erasure`, `POST /kontakte/erasure` and
  `POST /schiedsrichter/{schiedsrichter_id}/anonymisieren`; what the referee path is to leave on
  past fixtures is section 4's label. Ruled 2026-09-01.
- **An erasure keyed on an email address warns first.** Colleagues sharing a school inbox are one
  subject to the match, so the matched names are shown for confirmation before the write. A
  person id across seasons is not introduced: contact persons are season-scoped by design. Ruled
  2026-09-01.
- **The administrator's own email on every log row stays, outside every redaction.** The log
  exists to say who did what; the asymmetry is deliberate and is stated at the invariant once it
  leaves here (`docs/backend/spec.md :: I42` is the redaction it sits beside). Ruled 2026-09-01.
- **An administrator's erasure includes the sign-in store.** The second database holding
  administrators' addresses, sessions and sign-in tokens is inside the erasure, and tokens and
  sessions expire rather than persisting unredeemed. Ruled 2026-09-01.
- **Backups outlive an erasure by the snapshot window, and the person is told so.** The hosting
  keeps snapshots for about eight days, taken daily, as it stood on 2026-09-01. An erased person
  is gone from the live database at once and from backups within that window, and that sentence
  is what a requester receives. No replay of erasures after a restore is built. Ruled 2026-09-01,
  scope fixed 2026-09-02.
- **A retired row is never removed because of its age.** A player who left a squad, a referee who
  stopped, a club that left and a past season all keep their rows; the one removal is the
  person's own request, and self-service for that request comes with the account tiers. Ruled
  2026-08 (Datenschutzexperte consulted) and re-confirmed 2026-09-02.

## 6. Retention is bounded where a bound was chosen

- **The action log keeps a row for twelve months after it is written, then the row is deleted.**
  The mechanism is a TTL index on the row's timestamp, which the database applies without a
  sweep. This reverses the earlier "kept indefinitely" that `BE-15` records and that
  `docs/backend/spec.md :: I42` and `:: I45` state as the log's shape; what the log stores per row
  is otherwise unchanged by this ruling. Ruled 2026-09-01, the mechanism 2026-09-02.
- **A declined application is kept for one month after the decision, its three people's contact
  details included, then deleted. An accepted application is kept for the season it was accepted
  for and the season after it, then deleted.** The application's own privacy text states both
  periods once it exists. Ruled 2026-09-01, the periods set 2026-09-02.
- **A season's contact persons follow the accepted application's clock**: their contact block is
  cleared when the season after the one they were collected for ends. The consent text scopes
  itself to one season, and the clearing mechanism the erasure uses already exists. Ruled
  2026-09-01, the period set 2026-09-02.
- **Access logs are not shipped off the host — chosen on a reading that is wrong, so the choice
  is recorded and its basis is owed a second look.** The edge log carries the visitor's address,
  user agent and referer. I chose to leave it where it is on the reading that the logs die on
  every deploy; the logging spec says otherwise — nginx's log survives a deploy, and the bound is
  the container runtime's size rotation, as the retention section of `docs/logging/spec.md`
  records. The choice not to
  add a collector stands as given; whether the rotation bound is the retention I want is section
  12's. Ruled 2026-09-01.

## 7. Processors and third parties

The review's premise was that no processor agreement was signed. Read from each provider's own
legal pages on 2026-09-02, that premise is wrong for three of them: the agreement is part of the
terms accepted at sign-up. The table below is what a reviewer asks for first; I saw it and the
gaps it names in the follow-up of 2026-09-02.

| Processor                      | What reaches them                                                              | Agreement                                                                                          | Where the data is                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Resend                         | Applicants' and administrators' email addresses, every decision email in full  | Standard Art. 28 addendum, in force for every account on sign-up; an executed copy is downloadable | United States for all stored data; the EU region changes only where mail is dispatched from; transfer rests on the SCCs |
| Cloudflare                     | Every request in plaintext at the edge: addresses, URLs, headers, form bodies  | Standard addendum incorporated by reference into the self-serve agreement                          | Edge processing worldwide; content not stored for the core services; region pinning is an enterprise-only add-on        |
| MongoDB Atlas                  | Both databases and their backup snapshots                                      | Standard addendum incorporated into the cloud terms, accepted by creating the account              | The chosen deployment region; single-region snapshots stay in the cluster's region                                      |
| Proton (the league's mailbox)  | Every request and reply, correspondence with referees, contacts and applicants | **None on the personal plan in use.** Proton for Business carries one; the upgrade is the fix      | Switzerland                                                                                                             |
| Gmail, via members' forwarding | Whatever league mail a member opens in a personal Gmail account                | **None — a consumer Gmail account has no processing agreement.** Accepted for now, as a known gap  | Not committed                                                                                                           |
| WhatsApp (consumer app)        | Phone numbers and messages of anyone who contacts the league that way          | **None for the consumer app**; the consent text discloses the channel, and I may stop using it     | Not committed                                                                                                           |

What follows from the table, ruled 2026-09-02: for Resend, Cloudflare and MongoDB Atlas nothing is
left to sign — the task is to keep the dated agreement pages and Resend's executed copy with the
account's acceptance date, and to record Resend's United States storage as a transfer. The gaps
are the personal Proton plan, the forwarding to personal Gmail, and the consumer WhatsApp number;
each is accepted for now and named here so the notice can tell the truth about it.

## 8. Two procedures still to be written

- **Rights beyond erasure get one runbook section, not six features.** Access, rectification,
  objection, portability, restriction and withdrawal have no route and no documented handling
  today; at this scale a documented human procedure — who handles a request, what they do, how
  long it may take — answers all of them. It lands in `docs/ops/runbooks.md`. Ruled 2026-09-01.
- **A personal-data breach gets one runbook section**, written before it is needed: the
  authority's form, the 72-hour window, and what can and cannot be established from logs that
  rotate. It lands beside the first. Ruled 2026-09-01.

## 9. A local copy of production expires

- **A local copy of production refuses to be reused after seven days.** `./scripts/local.sh --seed`
  fills the local stack from a production dump (`scripts/local.sh :: take_dump`), and the copy is
  whole. The disk is encrypted and one person holds the connection string; the bound is what
  stops cleanup depending on memory. Today the seeding section of `docs/ops/spec.md` accepts
  reuse of the copy at any age; this ruling narrows that. Ruled 2026-09-01, the bound set
  2026-09-02.

## 10. Adjacent decisions were accepted as recommended

Roadmap items that needed no expert, each accepted on 2026-09-02 as its entry recommends. `BE-26`
was already closed when the round was answered (`docs/_roadmap/closed-items.md`), so its row
records agreement with what was done; for the rest the ranked pages decide what is still to do.

| Entry    | Decision                                                                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BE-26`  | The two swap-rule summaries match the code, which lets a called-off fixture's club be replaced — closed before this round                            |
| `BE-39`  | Narrow the refusal's sentence to the window in which the undraw it recommends is possible                                                            |
| `FE-24`  | The player editor shows the stored consent, read-only; it never gates publication                                                                    |
| `FE-30`  | Relabel the league's own people's page; keep its route                                                                                               |
| `FE-17`  | Replace the §7 clause's first half with the spec's formulation and keep the second half — a `.claude/CLAUDE.md` edit only I authorise, and I do here |
| `FB-16`  | Stays deferred until a rollover is actually missed                                                                                                   |
| `OPS-93` | Authenticated origin pulls are the cheapest real fix; a tunnel is the strongest                                                                      |

## 11. A ruling carried elsewhere is cited, not restated

A ruling above that a repository row already carries is cited from there rather than restated,
and a ruling that contradicts a row today names the row, so the dissolution of this file knows
every destination.

| Ruling                                      | Home or contradiction today                                                                                                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A club's address is public                  | `READ-ADDRESS-002`, and the Known-open row on acceptance publishing a school's address, both in `docs/backend/spec.md`                                                                                        |
| Free text stays public                      | `READ-FREETEXT-001`, `READ-FREETEXT-002`                                                                                                                                                                      |
| A retired row is never purged on age        | `fl_backend/app/core/domain.py :: UNENFORCED`, the Known-open row "Nothing purges a retired row", `REQ-PURGE-001`                                                                                             |
| The consent writer and the backfill         | `BE-23` holds the question this file answers and describes the writer as deferred to an expert; `fl_backend/app/api/spieler/schemas.py :: FLEinwilligung` holds the vocabulary                                |
| The birthdate                               | `BE-48`, decided as optional; section 2 makes it required at sign-up                                                                                                                                          |
| The action log's retention                  | `BE-15` states "kept indefinitely"; `docs/backend/spec.md :: I42` and `:: I45` describe a log no row ever leaves; `docs/glossary.md :: Aktion` says the same; section 6 reverses all of them to twelve months |
| Applications are permanent                  | `docs/glossary.md :: Bewerbung` and the application contract in `docs/backend/spec.md` describe a permanent record; section 6 bounds it                                                                       |
| The age threshold                           | `volljaehrig` in `fl_backend/app/api/spieler/schemas.py :: FLEinwilligung` and `fl_backend/app/core/constraints.py` implies 18; section 2 sets 16 for everyone                                                |
| The local copy's age                        | The seeding section of `docs/ops/spec.md` accepts reuse of the copy at any age; section 9 bounds it                                                                                                           |
| Erasure and redaction                       | `docs/backend/spec.md :: I42` for the redaction, `:: I48` for what a removal records                                                                                                                          |
| The anonymise race                          | `BE-35`, closed: erasure wins                                                                                                                                                                                 |
| The edge's access log carries no credential | `nginx/redaction_test.sh`, run in the gate's ops scope                                                                                                                                                        |

## 12. Open, and owed a decision

- **A serving referee's full name on every fixture.** The review found that a referee is a pupil
  published by full name while a squad pupil is reduced to a forename and an initial. Section 4
  settles the erased case only; whether a serving referee's published name is reduced the same
  way was not decided.
- **The access-log retention itself.** Section 6 records the choice not to ship logs; the bound it
  stands on is the rotation, not the deploy, and whether that bound is acceptable is undecided.
- **Whether the log keeps storing full prior copies of person-bearing rows** under the twelve-month
  bound. The review had rejected dropping them once; the bound was set without revisiting it.
