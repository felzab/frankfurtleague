# Datenschutz — the record of processing activities and the deletion concept

**Purpose:** the league's record under Art. 30(1) DSGVO and its deletion concept: each processing
activity with its purpose and basis, the people and data it touches, who receives them and when
they go, and the technical and organisational measures around them. A statement the site performs
names the symbol that performs it, and one it does not says so; this page changes in the commit
that changes what it describes. The published notice at `/datenschutz` is written from it, and
states a ruled bound a later session builds as that bound, this page naming the code's figure
beside it.

Nothing here is a legal conclusion. A ruling marked **Datenschutzexperte consulted** was taken after
consulting one; every other is open to a qualified reviewer's correction, and the questions put to
one stand in [section 11](#11-open-and-owed-a-decision). Other files cite sections 2 and 4 to 7 and
11 by number and heading, so those keep both.

| Section                                                                                              | Answers                                                    |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [1. Responsibility and the request route](#1-responsibility-and-the-request-route)                   | Art. 30(1)(a): who the controller is, where a request goes |
| [2. Consent comes from the person, from 16 or 18](#2-consent-comes-from-the-person-from-16-or-18)    | The bases, the ages, and who answers for whom              |
| [3. The processing activities](#3-the-processing-activities)                                         | Art. 30(1)(b) to (d): each activity, its people and data   |
| [4. What is published, and on what basis](#4-what-is-published-and-on-what-basis)                    | What a visitor reads about a person, and why               |
| [5. Erasure reaches everyone who asks](#5-erasure-reaches-everyone-who-asks)                         | What an erasure reaches, and what outlives it              |
| [6. Retention is bounded where a bound was chosen](#6-retention-is-bounded-where-a-bound-was-chosen) | Art. 30(1)(f): each store's bound and what enforces it     |
| [7. Processors and third parties](#7-processors-and-third-parties)                                   | Art. 30(1)(d) and (e): recipients and transfers            |
| [8. Technical and organisational measures](#8-technical-and-organisational-measures)                 | Art. 30(1)(g)                                              |
| [9. The deletion concept](#9-the-deletion-concept)                                                   | How the bounds of section 6 are kept, and checked          |
| [10. The rulings this record rests on](#10-the-rulings-this-record-rests-on)                         | Each ruling with its date                                  |
| [11. Open, and owed a decision](#11-open-and-owed-a-decision)                                        | The questions put to a Datenschutzexperte                  |

## 1. Responsibility and the request route

- **The controller is the association**, `fl_frontend/src/core/brand.ts :: VEREIN_NAME` at
  `:: VEREIN_ADDRESS`, reached at `:: KONTAKT_EMAIL`, and represented by its board
  (`:: VORSTAND`). No school and no individual is the controller; the league is run by its pupils as
  an association, and a school-law basis is unavailable. No data protection officer is appointed.
- **A person who signs in changes or withdraws their own consents on the account page**, each record
  they hold a box of its own on Konto's „Deine Einträge“, saved by its „Speichern“
  (`fl_frontend/src/app/account/(pages)/entries/EntriesBoxes.tsx :: EntriesBoxes`, each save an action of
  `fl_frontend/src/features/account/personActions.ts`).
- **Every other request goes to the contact address**: access, rectification, erasure, objection
  and a withdrawal by mail.
  [`ops/runbooks.md`](ops/runbooks.md#5-when-somebody-asks-for-their-data-or-asks-us-to-change-it)
  is the procedure that answers one.

## 2. Consent comes from the person, from 16 or 18

- **Taking part rests on legitimate interest, Art. 6(1)(f), for every participant whatever their
  age; publication rests on consent, Art. 6(1)(a).** The interest is running the competition: a
  league of named school teams cannot enter a squad, book a referee, check an age floor, reach a
  team or enforce a ban without knowing who plays, who referees and whom a school put forward. What
  is collected is that and no more, and every record has the end
  [section 6](#6-retention-is-bounded-where-a-bound-was-chosen) names. Weighed against most
  participants being 16 or 17: of a pupil, only the nameless slot is published on this basis, in a
  squad, a line-up or beside a goal or card, keeping team, season, shirt number and position. It
  is weighed as personal data, since teammates and classmates can very probably tell whose it is:
  it carries no name and no record id linking the pupil's seasons
  ([section 4](#4-what-is-published-and-on-what-basis)), and the notice says it stands whatever the
  name's consent. No birthdate reaches a public read, anyone may object under Art. 21 or be erased
  by a mail, and the notice tells each person what is kept and for how long. Contract, Art.
  6(1)(b), is the basis refused: a minor may not be able to conclude alone the agreement it would
  rest on.
- **Every participant answers for themselves, and nobody consents on anybody else's behalf.** A
  pupil registers themselves; a referee is entered by an administrator, and a contact person by
  whoever submits their school's application or by an administrator on a team's season row; each
  confirms their own entry through their own link and enters their own birthdate there. No
  administrative payload carries a consent choice, and the one write creating a player is a team's
  admission of the pupil's own confirmed registration
  (`fl_backend/app/api/registrierungen/person_router.py :: admit`). There is no guardian workflow:
  the record names nobody else as its source
  (`fl_backend/app/api/spieler/schemas.py :: FLEinwilligung`).
- **A contact seat's confirmation is a Kenntnisnahme under Art. 6(1)(f), not an Einwilligung**; the
  only consents on its block are the optional WhatsApp scope and the media answer
  ([`glossary.md`](glossary.md#einwilligung--kenntnisnahme--one-stored-key-over-two-vocabularies-a-persons-own-consent-and-what-a-contact-seat-was-told)).
- **The minimum age is 16 for every role, and 18 for the Ansprechperson and the Stellvertretung**,
  the two seats that commit the school, which is contractual capacity rather than a consent. Each
  confirmation judges the typed birthdate before anything is written: a pupil's
  (`fl_backend/app/api/registrierungen/services.py :: find_alter_refusal`, against
  `fl_backend/app/shared/schemas/bounds.py :: REGISTRIERUNG_MIN_AGE_YEARS`), a referee's
  (`fl_backend/app/api/schiedsrichter/services.py :: find_alter_refusal`, `fl_backend/app/shared/schemas/bounds.py :: SCHIEDSRICHTER_MIN_AGE_YEARS`)
  and a contact person's (`fl_backend/app/api/bewerbungen/services.py :: find_alter_refusal`, the
  floor per seat in `:: SEAT_MIN_AGE_YEARS`). That confirmation is the only route by which a contact
  person's date reaches the database; a stored date no confirmation stamped is judged by nothing,
  and clearing one is
  [a runbook step](ops/runbooks.md#11-a-contact-seats-birthdate-that-no-confirmation-stamped).
- **A media consent is taken only from 18** (`fl_backend/app/shared/schemas/bounds.py :: MEDIA_MIN_AGE_YEARS`): the switch shows only from
  that age, and each confirmation refuses a `true` from anyone younger
  (`fl_backend/app/api/registrierungen/services.py :: find_medien_refusal`,
  `fl_backend/app/api/schiedsrichter/services.py :: find_medien_refusal`,
  `fl_backend/app/api/einwilligung/services.py :: find_self_media_refusal`).
- **Each consent choice keeps its own evidence**: when its person last set it, under which wording's
  label, and on a withdrawal the grant it ended (`fl_backend/app/shared/einwilligung_evidence.py`).
  The labels are `fl_frontend/src/core/consentWordings.ts :: CONSENT_WORDINGS`' keys, each frozen
  with its words, and only the person's own act grants a choice or stamps its evidence. Once, at the
  switch, a paste re-points every stored label to the current wording, so a record stamped before
  it names words its person may not have been shown; that is
  [section 11](#11-open-and-owed-a-decision)'s first question, and from the switch on a label names
  the words its person saw.
- **Some refusals are taken by the code alone**, each before anything is written: a birthdate
  outside a role's span, an address the ban list holds (on a registration, an application's seat, a
  sign-in by any route, refused as its session would be created in
  `fl_frontend/src/core/auth/minting.ts :: refuseUnadmitted`, and a confirmation however old its
  link), a full squad, Cloudflare's bot check on the sign-in code request, the application form and
  the registration form (`fl_frontend/src/core/turnstile.ts :: turnstileRefusal`), an address that
  is not plain ASCII (`fl_backend/app/shared/folding.py :: league_address`), and the code sign-in's
  limits (`fl_frontend/src/core/signInGate.ts :: mayReceiveSignIn`, the per-address counts under
  `fl_frontend/src/core/auth/signInRows.ts :: boundIdentifier`). Whether any meets Art. 22 is
  [section 11](#11-open-and-owed-a-decision)'s question.

## 3. The processing activities

Each activity's controller is the association (section 1), its transfers are section 7's and its
measures section 8's. "Administrators" are the holders of a grant to the administration.

- **Applications and contact seats** (`bewerbungen`; `saison_teams.kontakte`).
  - Purpose and basis: admitting a school's team to a season and reaching it while the season runs;
    Art. 6(1)(f), the WhatsApp scope and the media answer on consent.
  - People and data: a school's three contact persons per application and per season row, each
    with name, address, telephone number and the birthdate their own confirmation types, their
    confirmation or Widerspruch, and each consent choice with its evidence; the school's details,
    its address among them. Named by the submitter or an administrator, so taken from a third party (Art. 14).
  - Recipients: administrators.
- **Squads** (`registrierungen`, `spieler`, `saison_spieler`, `einladungen`).
  - Purpose and basis: entering a pupil in a team's squad and fielding them; Art. 6(1)(f), the
    name's publication and media on consent.
  - People and data: pupils from 16, with name, address, birthdate, shirt number, position, Stufe,
    the publication scope and the media answer with their evidence; the registration link's entry,
    naming the administrator who minted it.
  - Recipients: administrators; the team's seats, who decide an admission; the booked referee, who
    reads both squads for their fixture's report while the fixture takes one and its season runs
    (`fl_backend/app/api/spielberichte/services.py :: nimmt_einen_bericht`); the public, as section 4
    says.
- **Referees** (`schiedsrichter`).
  - Purpose and basis: booking and paying who officiates; Art. 6(1)(f), the name on a fixture and
    media on consent.
  - People and data: referees from 16, with name, address (required, since the link is how they
    learn of their entry, Art. 14(3), `fl_backend/app/shared/schemas/kontakt.py :: FLKontaktPayload`),
    telephone number, school, fee, birthdate, the consent record with its evidence and the link.
  - Recipients: administrators; the public, as section 4 says.
- **Fixtures, their confirmations and their reports** (`spiele`, `spielbestaetigungen`,
  `spielberichte`).
  - Purpose and basis: scheduling, confirming and recording matches; Art. 6(1)(f).
  - People and data: a fixture's note (free text), its booked referee and their `payment`; each
    party's answer with its reason (free text) and, for a seat, a keyed digest of its holder's
    address (`fl_backend/app/api/spielbestaetigungen/services.py :: halter_of`); a report's line-ups,
    goals and cards by pupil, each card's reason and the remarks (free text).
  - Recipients: administrators; the booked referee; the public, as section 4 says.
- **Clubs and seasons** (`teams`, `saison_teams`, `saisons`).
  - Purpose and basis: the league's public record; Art. 6(1)(f).
  - Data: a club's name, school, address and description, and a team's reason for leaving a season,
    all public; free text may name a person.
- **Sign-in and accounts** (the `auth` database: `user`, `session`, `account`, `verification`,
  `passkey`; `address_changes`).
  - Purpose and basis: signing a person in to their own records and keeping the account safe; Art.
    6(1)(f).
  - People and data: everyone who signed in, and the address of anyone who submits the sign-in form,
    held in `verification` before the send gate is consulted; sessions with their factor, expiry and
    last use; passkeys with their public key, the reported authenticator model and any name the holder
    gives one, never a private key (`fl_frontend/src/core/auth/library.ts` configures the store); the
    per-address code counts under a keyed hash; an address change's two addresses until it ends,
    and the reason an administrators' change for a lost mailbox records, until the same end.
  - Recipients: the person.
- **Administration access and the ban list** (`berechtigungen`, `berechtigungen_angekuendigt`,
  `berechtigungen_antraege`, `sperrliste`).
  - Purpose and basis: who may administer the league, and refusing an address the league declined;
    Art. 6(1)(f).
  - People and data: a grant's address, tier and granter (`granted_by`), in plain; a pending
    request's address and its requester's; a ban's keyed hash of the barred address
    (`fl_backend/app/api/sperrliste/services.py :: adresse_hash`), its free-text reason, the
    entering administrator's address (`created_by`) and the last season it covers.
  - Recipients: administrators.
- **The action log and the erasure journal** (`aktionen`; the journal lines).
  - Purpose and basis: who did what, and replaying what a restore would undo; Art. 6(1)(f).
  - Data: each write's actor, an administrator by address and a person by pseudonym
    (`fl_backend/app/core/recording.py :: PersonActor`), the full prior document of the record it
    changed, and an erasure's request (`anlass`); each journal line's keyed hashes of an address
    (`fl_backend/app/core/journal.py :: RECORDS`).
  - Recipients: administrators.
- **Mail** (`outbox`; mail to the league; WhatsApp).
  - Purpose and basis: telling people what concerns them, and answering them; Art. 6(1)(f),
    WhatsApp on consent.
  - Data: each message's recipient, facts until it is sent, and its delivery state; what anyone
    writes to a league address; a number and messages on WhatsApp.
  - Recipients: Resend, Cloudflare, the organisers' private mailboxes and WhatsApp (section 7).
- **Delivering the website** (the edge's logs, the application logs, the browser).
  - Purpose and basis: serving and protecting the site; Art. 6(1)(f), and § 25(2) Nr. 2 TDDDG for
    what is stored in or read from the browser.
  - Data: each request's address, time, page, status, browser identifier and referrer, never a
    credential or a typed search query (`nginx/edge_test.sh` holds that); application log lines;
    in the browser the session cookie, a passkey ceremony's cookie, a mailed link's cookie holding
    its token for an hour (`fl_frontend/src/core/mailedLink.ts`), the theme in local storage,
    Cloudflare's challenge clearance and Turnstile's frame.
  - Recipients: Hetzner and Cloudflare (section 7).
- **Media and the organisers' names.**
  - Purpose and basis: showing the league; consent, from 18 for media.
  - Data: photographs, videos and interviews, on this site and the league's Instagram account; the
    organisers' first names (`fl_frontend/src/features/meta/constants.ts :: ORGANISERS`), each on
    their own agreement; the board's full names in the Impressum
    (`fl_frontend/src/core/brand.ts :: VORSTAND`), on § 18(1) MStV and, where it reaches this site,
    § 5 DDG.
  - Recipients: the public; Meta (section 7).

## 4. What is published, and on what basis

- **A club's street address is public, and the application form and the acceptance screen say so**
  (`fl_backend/app/api/teams/schemas.py :: _TeamWritable.address`;
  `fl_frontend/src/features/bewerbungen/components/forms/BewerbungForm/FormSchuleSection.tsx`,
  `fl_frontend/src/features/bewerbungen/components/forms/AdminBewerbungAnnehmenSection.tsx`).
  **Datenschutzexperte consulted.**
- **A pupil's name is published only on their own consent, given alone from 16.** Every public read
  of a pupil decides by `fl_backend/app/api/spieler/services.py :: name_is_public`, or its expression
  at a join, `fl_backend/app/shared/einwilligung.py :: NAME_IS_PUBLIC`: the record present, its
  `umfang` `kader_oeffentlich` and its `confirmed_at` stamped. Every other row is a nameless slot
  keeping its number and position, and carries no record id that would link its seasons. The gate
  fails closed. The player editor shows the stored consent read-only and gates nothing
  (`fl_frontend/src/features/spieler/components/forms/AdminSpielerEditForm/FormEinwilligungSection.tsx`).
- **A referee's name stands on a fixture only on their own consent, and only once they agreed to
  the booking** (`fl_backend/app/api/spiele/schemas.py :: _withheld_unless_agreed`, through the same
  predicate), and no fixture carries the referee's record id
  (`:: FLSpielSchiedsrichterFieldPublic`).
- **A match's page publishes the clubs' line-ups and, on an adopted report, each goal's and card's
  minute and pupil and each card's colour**, every pupil through the squad's rule above, never a
  card's reason or the remarks
  (`fl_backend/app/api/spielberichte/services.py :: compose_public_bericht`). A report stores a pupil
  by record id alone and the read joins the name from the pupil's row, so a name stands only while
  that row exists: the season rule or an erasure leaves the slot naming nobody, a line-up's entries
  keeping the id an erasure does not repoint
  (`fl_backend/app/api/spielberichte/crud.py :: repoint_pupil_entries_in_session`). Whether a card may stand beside a named pupil of 16 or 17 is open, and
  the deploy shipping the read waits on the answer ([section 11](#11-open-and-owed-a-decision)).
- **A photograph, a video or an interview needs its own consent, from 18**, published on this site
  and the league's Instagram account, and a withdrawal takes it down from both, which the notice
  promises. No code publishes media, so the takedown is the organisers' step by hand.
- **The organisers' names stand in the public source code**, so a withdrawal takes a name
  off the site and out of the current code, and earlier versions stay in the repository's public
  history.
- **The free texts on public pages stay public**: a fixture's note, a withdrawal's reason and a
  club's description (`fl_backend/app/api/teams/schemas.py :: _TeamWritable.description`).
- **AI crawlers are blocked at the edge, and asked in the managed `robots.txt` once it is on**; both
  settings live in the hosting dashboard, and
  [`ops/spec.md`](ops/spec.md#18-the-edges-declared-state) records whether each is on.

## 5. Erasure reaches everyone who asks

- **Anyone can have their data erased, with the least asymmetry between roles**: a signed-in person
  by `fl_backend/app/api/identity/person_router.py :: post_account_erasure`, which refuses only the
  administration's last live owner, and anyone else by mail, through an administrator's
  `fl_backend/app/api/identity/admin_router.py :: post_erasure`. Both run
  `fl_backend/app/api/identity/crud.py :: erase_everything`, and each lists the records it
  reaches for confirmation first, read through the erasure's own selection.
- **One address is one person: enforced among pupils, and assumed across the collections.** Every
  record stored under a folded address (`fl_backend/app/shared/folding.py :: sign_in_identifier`) is
  that one person's, and so is the account the sign-in store keys on it
  (`fl_frontend/src/core/emailAddress.ts :: asSignInIdentifier`). Among pupils `uniq_spieler_email`
  enforces it, and an admission writes into the person the address resolves to, asking the team
  first where the name or birthdate differs
  (`fl_backend/app/api/registrierungen/services.py :: find_person_refusal`). Across the collections
  nothing compares names; the registration form and the application's seats tell the person so. A
  mailbox shared anyway is one account, and an erasure keyed on it takes every record under it.
  Every erasure is keyed on a mailbox, so a hand edit emptying a row's address puts it out of reach.
- **What an erasure deletes or repoints**, in one transaction: every record the address holds,
  outright rather than nulled; a referee's fixtures repointed at the ghost
  (`fl_backend/app/core/sentinels.py :: GHOST_SCHIEDSRICHTER_ID`), which also ends their engagement,
  a fixture played or called off keeping its booking and `payment`; a pupil's goals and cards
  repointed at `:: GHOST_SPIELER_ID`
  (`fl_backend/app/api/spielberichte/crud.py :: repoint_pupil_entries_in_session`); their values in
  the action log's images, and the marker naming nobody in place of their address or pseudonym on
  every row they wrote under that address; every reason they typed in a fixture answer, found by the
  holder digest, with their seats' links; every mail owed or sent to them but the deletion link
  that asked for the erasure
  (`fl_backend/app/api/identity/crud.py :: erase_the_mails_in_session`); a pending address change of theirs; every grant the address
  holds; and the sign-in account at the address, an account at an earlier address going with the
  account sweep (section 6).
- **What outlives an erasure:**
  - the database's snapshots, about 8 days, taken daily (the provider's console, read 2026-09-01);
    a restore runs every erasure since its snapshot again, found by the keyed hashes the journal
    left ([`ops/runbooks.md`](ops/runbooks.md#13-after-a-restore-from-a-snapshot));
  - Resend's copies of every message and Cloudflare's record of every message to the league, for
    their own periods (section 7), and the copies in the organisers' mailboxes, deleted on request,
    their providers' backups beyond reach;
  - a ban's row, pseudonymised personal data under this controller's key, its reason possibly naming
    the person, until its bound (section 6);
  - free text typed about others and keyed on no address, which only a name search could find, and a
    name search would take a namesake's text with it: a fixture's note, an application's wished
    opponent and decision reason, a team's leaving reason, a registration's decision reason, a club's
    description, a reason another seat's holder or an administrator typed in a fixture answer, a
    report's remarks naming a pupil by name or by shirt number, and an erasure's `anlass`;
  - the deletion link's Postausgang row, until its secret lapses with the link, 24 hours after it was
    minted (`fl_backend/app/api/outbox/services.py :: row_of`,
    `fl_frontend/src/core/erasureEmail.ts :: ERASURE_LINK_VALID_HOURS`);
  - a registration link's entry, which names no subject, and the action log's rows written under an
    earlier address's pseudonym, until the log's twelve months.
- **A retired row is never removed because of its age**: a referee who stopped, a club that left and
  a past season keep their rows; a person's row goes only by an erasure or, for a pupil, by section
  6's season rule. **Datenschutzexperte consulted.**

## 6. Retention is bounded where a bound was chosen

Each bound is read from the symbol beside it; nothing compares this table with the notice's.

| Store                                        | Bound                                                                                                                                       | Enforced by                                                                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An application not every seat confirmed      | Deleted 14 days after its last links, the Ansprechperson told first; held past them while that notice is refused                            | `fl_backend/app/shared/schemas/bounds.py :: BEWERBUNG_CONFIRMATION_DEADLINE_DAYS`, `fl_backend/app/api/bewerbungen/services.py :: deletion_is_due`                    |
| An application undecided at its season's end | Deleted then, whatever was confirmed                                                                                                        | `fl_backend/app/api/bewerbungen/services.py :: undecided_loeschung_is_due`                                                                                            |
| A declined application                       | One calendar month after the decision                                                                                                       | `:: decline_loeschung_is_due`                                                                                                                                         |
| An accepted application                      | Once a season after the one it applied for has ended                                                                                        | `:: acceptance_loeschung_is_due`                                                                                                                                      |
| A season row's contact seats                 | Cleared once the season after theirs has ended, their links with them                                                                       | `fl_backend/app/api/bewerbungen/system_router.py :: sweep_saison`                                                                                                     |
| Fixture answers and match reports            | The league's record; from that same clearing, reasons, holder digests, link hashes, delivery records, remarks and card reasons are stripped | `fl_backend/app/api/bewerbungen/system_router.py :: strip_the_confirmations`, `:: strip_the_reports`                                                                  |
| An unconfirmed registration                  | The day after its stored deadline, 7 days from the link, and 14 once session 8 raises the bound                                             | `fl_backend/app/shared/schemas/bounds.py :: REGISTRIERUNG_CONFIRMATION_FRIST_DAYS`, `fl_backend/app/api/registrierungen/services.py :: bestaetigung_loeschung_is_due` |
| A registration undecided at its season's end | Deleted then                                                                                                                                | `fl_backend/app/api/registrierungen/services.py :: undecided_loeschung_is_due`                                                                                        |
| A declined registration                      | One calendar month after the decision                                                                                                       | `:: decline_loeschung_is_due`                                                                                                                                         |
| An admitted registration                     | Deleted in the admission's own transaction                                                                                                  | `fl_backend/app/api/registrierungen/person_router.py :: admit`                                                                                                        |
| A pupil                                      | Once the season after their last squad season has ended, at the activation and its hourly pass                                              | `fl_frontend/src/features/saisons/sweep.ts :: runErasureSweep`                                                                                                        |
| A registration link's entry                  | No clock; the link ends with its season's window, or when withdrawn or replaced                                                             | `fl_backend/app/api/registrierungen/services.py :: saison_nimmt_registrierungen_an`                                                                                   |
| A referee                                    | Until an administrator deletes the row or the referee asks; a link lasts 14 days                                                            | `fl_backend/app/shared/schemas/bounds.py :: SCHIEDSRICHTER_CONFIRMATION_FRIST_DAYS`                                                                                   |
| A ban                                        | Five full seasons after the one it was entered under, removed by the activation past it                                                     | `fl_backend/app/shared/schemas/bounds.py :: BAN_DURATION_SAISONS`                                                                                                     |
| A grant                                      | Until revoked or erased                                                                                                                     | `fl_backend/app/api/berechtigungen/admin_router.py :: delete_grant`                                                                                                   |
| A pending grant request                      | A week after it was asked, unless decided, withdrawn or ended sooner                                                                        | `fl_backend/app/shared/schemas/bounds.py :: APPROVAL_DAYS`, `fl_backend/app/core/constraints.py :: TTL_INDEXES`                                                       |
| An address change                            | Each link 24 hours, a lapsed change ended within the hour; an ended change keeps no address and no reason and goes 30 days after its end    | `fl_backend/app/shared/schemas/bounds.py :: ADDRESS_CHANGE_VALID_HOURS`, `:: ADDRESS_CHANGE_RETENTION_DAYS`                                                           |
| A sign-in account and its passkeys           | Within the hour of no league record or grant holding its address, a ban holding none, with no message                                       | `fl_frontend/src/features/funktionen/sweep.ts :: runAccountSweep`                                                                                                     |
| A session                                    | A person's 14 days unused, 30 at most; an administrator's 1 hour unused, 24 at most                                                         | `fl_frontend/src/core/sessionLifetimes.ts :: PERSON_LIFETIME`, `:: ADMIN_LIFETIME`                                                                                    |
| A sign-in code; the code counts              | 10 minutes; failed codes a day and requested codes an hour, under a keyed hash                                                              | `fl_frontend/src/core/authEmail.ts :: CODE_VALIDITY_MINUTES`, [`ops/runbooks.md`](ops/runbooks.md#14-the-auth-databases-indexes)                                      |
| A Postausgang row                            | No facts once sent or given up; deleted 30 days after that, a row carrying a secret when it lapses                                          | `fl_backend/app/api/outbox/services.py :: RETENTION`, `:: row_of`                                                                                                     |
| The action log                               | 12 months a row                                                                                                                             | `fl_backend/app/shared/schemas/bounds.py :: ACTION_LOG_ENTRY_RETENTION_SECONDS`                                                                                       |
| The edge's access and error logs             | 8 days, host files                                                                                                                          | [`ops/runbooks.md`](ops/runbooks.md#7-the-logs-age-bounds-and-the-copies-a-deploy-leaves-behind)                                                                      |
| The application logs                         | The runtime's size rotation while they run; 30 days as each deploy's copy                                                                   | `scripts/ops/deploy.sh :: LOG_DIR`                                                                                                                                    |
| The erasure journal                          | As the application log, and a file per day deleted 30 days after its last change                                                            | [`ops/runbooks.md`](ops/runbooks.md#7-the-logs-age-bounds-and-the-copies-a-deploy-leaves-behind)                                                                      |

- **No delivery state has a clock of its own**: each goes with what holds it, the Postausgang row
  its message was sent from or the link entry it went out for. No open or click tracking is
  subscribed ([`ops/runbooks.md`](ops/runbooks.md#10-the-mail-providers-dashboard)).
- **The action log keeps the full prior document on every write**, since a restore over the log
  replays it; its twelve months answer the accumulation, and an erasure takes its person's values out
  at once.
- **A registration's deadline is stored at the mint**, so a raised bound never moves a link already
  in somebody's inbox. Every link asking a person to confirm being named or registered is ruled to
  live 14 days, and every unconfirmed or declined item to go 14 days after, which the notice states
  now; the code keeps a registration's link at 7 days until session 8 raises it, and a declined
  application or registration for the calendar month the rows above name.
- **A ban removes itself on the league's calendar rather than a count of days**: somebody too young
  stays barred until too old. Its row keeps only a keyed hash of the address, so no second message
  can be sent about it; the one sent at the ban (`fl_frontend/src/core/sperrlisteEmail.ts`) names
  its season, its reason, what is kept and how to object.
- **A sign-in account is deleted with no message until session 7 builds the one deletion notice**
  (ruled 2026-10-25), which tells its person once a confirmed account or application is deleted,
  whoever caused it, and never holds the deletion up.

## 7. Processors and third parties

Each row mirrors that provider's own pages as read on the day given, which move without us, but
the host's, which rests on its signed agreement.

| Recipient                             | What reaches them                                                                                                                                                                                                                                                                                                            | Agreement                                                                                                                                                                                 | Where                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Hetzner Online (the host)             | Everything on the server, the edge's logs included                                                                                                                                                                                                                                                                           | An Art. 28 agreement with its technical and organisational measures, concluded; the owner holds the signed copy                                                                           | Nuremberg                                                                       |
| Cloudflare                            | Every request in plaintext at the edge; Turnstile's signals on three forms, in analytics for 7 days, the window the Turnstile dashboard showed on 2026-11-04 rather than a period Cloudflare states; every message to a league address, forwarded and not stored, its sender, recipient and subject in analytics for 31 days | Its standard addendum, every service included (read 2026-10-25); for Turnstile a processor for the check and a controller of the same signals for its own bot detection (read 2026-10-04) | Worldwide at the edge; Data Privacy Framework, standard clauses as its fallback |
| MongoDB Atlas                         | Both databases and their snapshots                                                                                                                                                                                                                                                                                           | Its standard addendum, accepted with the account                                                                                                                                          | Frankfurt am Main                                                               |
| Resend (Plus Five Five, Inc.)         | Every address the league mails and every message in full; a link or a code in one is a credential                                                                                                                                                                                                                            | Its standard addendum, in force on sign-up; its executed copy with the standard clauses is on file, the owner holding it                                                                  | United States for stored data; Data Privacy Framework and standard clauses      |
| The organisers' private mailboxes     | Every message to a league address, and every reply, sent from the organiser's own address                                                                                                                                                                                                                                    | **None**, and no safeguard for a transfer outside an adequacy decision: a gap accepted and disclosed (2026-10-25)                                                                         | Not committed; Proton (Switzerland) and Gmail on 2026-10-25                     |
| WhatsApp (the consumer app)           | Numbers and messages of the people the league writes to there, one by one                                                                                                                                                                                                                                                    | **None**: a gap accepted, the consent's line naming the channel                                                                                                                           | Ireland, onward to the United States on the Framework (read 2026-09-22)         |
| Meta (the league's Instagram account) | What the league publishes there, each on its person's consent from 18                                                                                                                                                                                                                                                        | **None**; Meta is a controller of its own                                                                                                                                                 | Not committed; Meta Platforms, Inc. on the Framework list (read 2026-09-22)     |

- **Resend keeps every message, its events and its logs for 30 days, its backups up to 7 days
  longer**, on its Free, Pro and Scale plans alike (<https://resend.com/security/gdpr>, read
  2026-10-16); which plan this account is on is recorded nowhere here. No erasure reaches those
  copies.
- **The agreements are on file**: Resend's executed addendum, Hetzner's Art. 28 agreement with its
  technical and organisational measures, and Cloudflare's and MongoDB's addenda, each saved and held
  by the owner (2026-11-04).
- **Owed, and not yet in hand:** WhatsApp refused the contacts permission on every phone used for
  league messages, so no organiser's address book reaches it.
- **WhatsApp is not a league channel**: the league writes there only to people who chose it, never
  as a requirement, e-mail always standing beside it.

## 8. Technical and organisational measures

- **Access.** An administrator acts only with a passkey session inside both of the administrator's
  figures (`fl_frontend/src/core/auth/guards.ts :: isAdminSession`); a grant is granted and revoked
  as [`ops/runbooks.md`](ops/runbooks.md#3-granting-or-revoking-admin-access) says; a person reaches
  only the records under their own address.
- **The origin.** A remotely managed tunnel is the only route to the origin, so every request
  passes Cloudflare first ([`ops/spec.md`](ops/spec.md#18-the-edges-declared-state)).
- **Pseudonymisation.** A ban, a person's action-log actor, a fixture answer's holder and each
  journal line hold a keyed hash of an address rather than the address, each under a key derived from
  one master secret by its own label (`fl_backend/app/api/sperrliste/services.py :: adresse_hash`;
  [`ops/runbooks.md`](ops/runbooks.md#16-the-secret-files)).
- **Minimisation.** No birthdate reaches a public read; a public row names no record id that links a
  withheld person's seasons; an access line holds no credential and no search query.
- **Integrity and recovery.** Daily snapshots; the action log's prior documents and the journal's
  replay after a restore ([`ops/runbooks.md`](ops/runbooks.md#13-after-a-restore-from-a-snapshot));
  the breach procedure in [`ops/runbooks.md`](ops/runbooks.md#6-when-personal-data-has-been-exposed).
- **A local copy of production refuses to be reused after 7 days**: ruled, and not performed, since
  `scripts/ops/local.sh :: fetch_copy` reuses a copy at any age, its marker file being the whole of
  the test. The disk is encrypted and one person holds the read-only connection string.

## 9. The deletion concept

Every store of section 6 ends by one of four triggers, each with its mechanism:

- **A clock from a stored day**: the database deletes the row by a TTL index
  (`fl_backend/app/core/constraints.py :: TTL_INDEXES`, the sign-in store's in
  [`ops/runbooks.md`](ops/runbooks.md#14-the-auth-databases-indexes)), or an hourly pass judges it due.
- **A condition on the league's calendar**: a season's `status`, judged by the hourly pass or at the
  activation, never a count of days, so a record lasts exactly as long as its purpose can.
- **A person's request**: the erasure of section 5, run at once.
- **The purpose standing**: a referee, a grant, a club's record, deleted by a decision and nothing
  else.

The hourly scheduler (`fl_frontend/src/instrumentation-node.ts :: armScheduler`) runs every pass with
no switch to hold one back, and pings the heartbeat monitor, naming on `/fail` each job that threw or
left a due deletion; a claim that a period was honoured rests on that and on each job's line in the
log ([`ops/runbooks.md`](ops/runbooks.md#9-checking-that-the-hourly-passes-have-run)). A deletion
takes the record outright, never nulling it, so no third state needs a clock. What a deletion
cannot reach is section 5's list, each bounded by its own period.

## 10. The rulings this record rests on

| Date       | Ruling                                                                                                                                                                                                                                              |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08    | A club's address is public (Datenschutzexperte consulted); a retired row is never removed for its age (consulted, confirmed 2026-09-02)                                                                                                             |
| 2026-09-02 | The action log keeps the prior document for 12 months; an application's and a season's contacts' clocks; nothing left to sign for Resend, Cloudflare and Atlas; the player editor shows the consent read-only                                       |
| 2026-09-06 | 16 for every role, 18 for the two seats that commit a school; the edge's logs 8 days (re-ruled 2026-09-07)                                                                                                                                          |
| 2026-09-08 | A pupil's birthdate required; an application held while its notice is refused; a Widerspruch keeps its link entry                                                                                                                                   |
| 2026-09-09 | An application undecided at its season's end is deleted                                                                                                                                                                                             |
| 2026-09-11 | A registration bounded at each of its four ends                                                                                                                                                                                                     |
| 2026-09-20 | A pupil's name and media each on its own consent                                                                                                                                                                                                    |
| 2026-09-21 | A person's own write logged under a pseudonym; a registration link's entry kept without a clock; the ban's mail                                                                                                                                     |
| 2026-09-22 | Legitimate interest for taking part; the code's own refusals disclosed with a review (re-ruled 2026-10-25); a referee's consent record and required address; media only from 18; WhatsApp not a league channel; a referee's row kept until deleted  |
| 2026-09-23 | A pupil consents alone from 16; media on this site and Instagram                                                                                                                                                                                    |
| 2026-09-24 | The edge's error log under the access log's rotation                                                                                                                                                                                                |
| 2026-09-27 | One address is one person; a ban for five seasons, told at its entry                                                                                                                                                                                |
| 2026-09-28 | A grant kept until revoked                                                                                                                                                                                                                          |
| 2026-10-03 | A contact person an administrator seats is mailed a link of their own                                                                                                                                                                               |
| 2026-10-04 | An address change takes effect only once confirmed (re-ruled 2026-10-20 and 2026-11-04); the action log's full emptying stands                                                                                                                      |
| 2026-10-15 | A pupil's data goes on the season rule; the erasure journal; a sign-in account kept while a record holds its address                                                                                                                                |
| 2026-10-16 | The journal replays a choice; a barred address's account kept only while a record holds it                                                                                                                                                          |
| 2026-10-19 | A fixture answer names its answerer by role and digest, stripped at the season's clearing                                                                                                                                                           |
| 2026-10-20 | A referee on a fixture on consent and agreement; the booked referee reads the squads; a report's remarks and card reasons stripped                                                                                                                  |
| 2026-10-25 | Mail to the league forwarded to the organisers' mailboxes, disclosed as a gap; one sentence on automated decisions, replacing 2026-09-22's refusals disclosed with a review; one deletion notice once a confirmed account or application is deleted |
| 2026-10-26 | A delivery state stored on the Postausgang row                                                                                                                                                                                                      |
| 2026-11-04 | One wording per consent, each choice evidenced under its label; a consent's label is its whole sentence; every confirmation link 14 days; a withdrawal by mail; media taken down on withdrawal; Art. 22 before the switch                           |

## 11. Open, and owed a decision

Each question goes to a Datenschutzexperte. The one on a card beside a named minor is answered
before the deploy shipping that read, and the one on re-pointing stored consents and the one on
Art. 22 before the switch; the rest after the text has shipped. Until an answer, the notice and the
procedures in [`ops/runbooks.md`](ops/runbooks.md) stand as they are.

1. **Re-pointing every stored consent's label to the current wording** (ruled 2026-11-04): whether a
   record then still proves, under Art. 7(1), a consent its person gave under words they were not
   shown, and what is owed instead if it does not.
2. **A card beside a named pupil of 16 or 17**: whether a booking's colour and minute may stand on
   the public match page beside the name a pupil's consent publishes (section 4).
3. **What carries a pupil's own consent from 16**: Art. 8(1) or the pupil's own
   Einsichtsfähigkeit, or a guardian's beside it. The EDPB's consent guidelines (05/2020, paragraph 127) read Art. 8 for a service offered directly to a child; Hesse's template for schools asks a
   parent's signature too (both read 2026-09-22).
4. **Whether the name's scope may be preselected**, and **whether one media switch over photographs,
   videos and interviews, on two sites, is specific enough**; and whether the case law on revoking a
   consent to one's image under the KUG changes the notice's promise that a withdrawal takes what is
   published down from this site and the league's Instagram account.
5. **A withdrawal from a page loaded before a wording changed is refused** until the page is loaded
   again: whether that keeps Art. 7(3)'s "as easy to withdraw as to give".
6. **One act per choice as the proof**: whether the latest act and the grant a withdrawal ended
   prove a consent, the log holding no act from before 2026-10-28 08:25 (Europe/Berlin), and a
   contact seat's early WhatsApp grant carrying evidence a hand paste copied from its confirmation's
   log row.
7. **Art. 22**: whether any refusal of section 2 the code takes alone, Cloudflare's bot check
   among them, meets Art. 22(1); if one does, which exception of Art. 22(2) it rests on, contract
   being refused as a basis. The Working Party's WP251 rev.01 reaches access to education and does
   not say whether a school league's place is it (read 2026-09-22). The notice says no automated
   decision is taken, and the answer blocks the switch.
8. **The refusals the notice does not name**: an address that is not plain ASCII, and the code
   sign-in's limits; whether each is a limit of the service, named beside the full squad or not at
   all, and whether a refusal the person is not told of can be offered a review.
9. **The 18 for the two seats that commit a school**: whether that is contractual capacity at all.
10. **The ban's surviving row**: the basis for keeping it about the person barred past their
    erasure, and what an access request reaches when no route finds the row from the address.
11. **14 days for an unconfirmed registration**, the code's 7 until session 8 raises it: whether it
    is proportionate.
12. **The referees entered before the confirmation link**, whose names stood on fixtures until their
    rows were deleted whole and who were never informed under Art. 14: whether Art. 14(5)(b) carries
    it, with the notice as its measure.
13. **An invite entry's administrator address until their erasure, and a delivery state with no
    bound**, there and on a declined seat's link entry: whether either may stand, and whether a
    delivery record the provider can join to an address is still that person's data.
14. **A nameless slot** keeping team, number and position: whether it is personal data, and so needs
    a basis of its own, and whether section 2's weighing carries it for pupils of 16 and 17.
15. **The notice's statements**: one legitimate interest for every processing against Art. 13(1)(d);
    „als Chronik der Liga“ as a criterion under Art. 13(2)(a); Art. 13(2)(e)'s line on what is
    required stated for the application alone; the transfer sentence covering Cloudflare and Resend
    together; whether the sentence on the data protection officer can go (Art. 13(1)(b)); and the
    supervisory authority's postal address, Postfach 3163, 65021 Wiesbaden, read on its own site
    2026-11-04.
16. **The edge's clearance and Turnstile**: whether each is strictly necessary under § 25(2) Nr. 2
    TDDDG, and whether Cloudflare's own use of Turnstile's signals needs more than the notice naming
    it; the notice's sentence that both are permitted without consent is a legal conclusion that
    stands as written until the answer.
17. **Cloudflare's own record of each request**, bounded by Cloudflare's plan rather than any
    setting here, and the host's log rotation, a hand step no deploy verifies
    ([`ops/runbooks.md`](ops/runbooks.md#7-the-logs-age-bounds-and-the-copies-a-deploy-leaves-behind)).
18. **Instagram**: whether the league shares control of anything Meta records about the account's
    audience (C-210/16 held a Facebook page's operator a joint controller for its statistics), and
    what publishing there counts as under Chapter V.
19. **The board's full names in the Impressum**: whether § 18(1) MStV carries all four, whether § 5
    DDG or § 18(2) MStV reaches this site at all, and whether „e. V.“ in the name states the legal
    form. Beside it: whether e-mail alone meets the duty of a rapid, direct means of contact
    (C-298/07), or a telephone number or a form must stand beside it; whether the interviews the
    media consent foresees are journalistic-editorial content needing a responsible person under
    § 18(2) MStV; and which basis the notice and the page's description should cite, they citing
    § 5 DDG where this record cites § 18(1) MStV first.
