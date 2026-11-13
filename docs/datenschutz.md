# Datenschutz — the record of processing activities and the deletion concept

**Purpose:** the league's record under Art. 30(1) DSGVO and its deletion concept. It holds each
processing activity with its purpose and basis, the people and data it touches, who receives them
and when they go, and the technical and organisational measures around them. A statement the site
performs names the symbol that performs it, and one it does not says so. This page changes in the
commit that changes what it describes. The published notice at `/datenschutz` is written from it.

Nothing here is a legal conclusion. A ruling marked **Datenschutzexperte consulted** was taken after
consulting one; every other is open to a qualified reviewer's correction. The questions put to one
stand in [section 11](#11-open-and-owed-a-decision). Other documents link sections 1, 2, 5, 6, 7 and
11 by heading, and code comments cite sections 4 and 6 by number, so each keeps both.

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
| [11. Open, and owed a decision](#11-open-and-owed-a-decision)                                        | The questions put to a Datenschutzexperte                  |

## 1. Responsibility and the request route

- **The controller is the association**, `fl_frontend/src/core/brand.ts :: VEREIN_NAME` at
  `:: VEREIN_ADDRESS`, reached at `:: KONTAKT_EMAIL`, and represented by its board
  (`:: VORSTAND`). No school and no individual is the controller. The league is run by its pupils as
  an association, and a school-law basis is unavailable. No data protection officer is appointed.
- **A person who signs in changes or withdraws their own consents on the account page.** Each record
  they hold is a box of its own on Konto's „Deine Einträge“, saved by its „Speichern“
  (`fl_frontend/src/app/account/(pages)/entries/EntriesBoxes.tsx :: EntriesBoxes`, each save an
  action of `fl_frontend/src/features/account/personActions.ts`).
- **Every other request goes to the contact address**: access, rectification, erasure, objection
  and a withdrawal by mail.
  [`ops/runbooks.md`](ops/runbooks.md#5-when-somebody-asks-for-their-data-or-asks-us-to-change-it)
  is the procedure that answers one.

## 2. Consent comes from the person, from 16 or 18

- **Taking part rests on legitimate interest, Art. 6(1)(f), for every participant whatever their
  age; publication rests on consent, Art. 6(1)(a).** The interest is running the competition. A
  league of named school teams cannot enter a squad, book a referee, check an age floor, reach a
  team or enforce a ban without knowing who plays, who referees and whom a school put forward. What
  is collected is that and no more, and every record has the end
  [section 6](#6-retention-is-bounded-where-a-bound-was-chosen) names.
- **The interest is weighed against most participants being 16 or 17.** Of a pupil, only the
  nameless slot is published on this basis, in a squad, a line-up or beside a goal or card. It
  carries no name, no number, no position and no record id linking the pupil's seasons. A line-up's
  slot says whether it starts, a goal's its minute, its side and whether it was an own goal, and a
  card's its minute, its side and its colour
  ([section 4](#4-what-is-published-and-on-what-basis)). It is weighed as personal data, since
  teammates and classmates can very probably tell whose it is, and the notice says it stands
  whatever the name's consent. No birthdate reaches a public read, and anyone may object
  under Art. 21 or be erased by a mail. The notice tells each person what is kept and for how long.
- **Contract, Art. 6(1)(b), is the basis refused**: a minor may not be able to conclude alone the
  agreement it would rest on.
- **Every participant answers for themselves, and nobody consents on anybody else's behalf.** A
  pupil registers themselves. A referee is entered by an administrator, and a contact person by
  whoever submits their school's application or by an administrator on a team's season row. Each
  confirms their own entry through their own link and enters their own birthdate there. No
  administrative payload carries a consent choice. The one write creating a player is a team's
  admission of the pupil's own confirmed registration
  (`fl_backend/app/api/registrierungen/person_router.py :: admit`). There is no guardian workflow:
  the record names nobody else as its source
  (`fl_backend/app/api/spieler/schemas.py :: FLEinwilligung`).
- **A contact seat's confirmation is a `Bestätigung` under Art. 6(1)(f), not an Einwilligung**; the
  only consents on its block are the optional WhatsApp scope and the media answer
  ([`glossary.md`](glossary.md#einwilligung--kenntnisnahme--one-stored-key-over-two-vocabularies-a-persons-own-consent-and-what-a-contact-seat-was-told)).
- **The minimum age is 16 for every seat, squad place and referee, and 18 for the Ansprechperson and
  the Stellvertretung**, the two seats that commit the school. That 18 is contractual capacity
  rather than a consent. A grant to the administration judges no age and stores no birthdate
  (`fl_backend/app/api/grants/admin_router.py :: post_grant`). A contact person's date reaches the
  database only through their own confirmation. A stored date no confirmation stamped is judged by
  nothing, and clearing one is
  [a runbook step](ops/runbooks.md#11-a-contact-seats-birthdate-that-no-confirmation-stamped). Each
  confirmation judges the typed birthdate before anything is written:
  - a pupil's, by `fl_backend/app/api/registrierungen/services.py :: find_age_refusal` against
    `fl_backend/app/shared/schemas/bounds.py :: REGISTRIERUNG_MIN_AGE_YEARS`;
  - a referee's, by `fl_backend/app/api/schiedsrichter/services.py :: find_age_refusal` against
    `fl_backend/app/shared/schemas/bounds.py :: SCHIEDSRICHTER_MIN_AGE_YEARS`;
  - a contact person's, by `fl_backend/app/api/bewerbungen/services.py :: find_age_refusal`, the
    floor per seat in `:: SEAT_MIN_AGE_YEARS`.
- **A media consent is taken only from 18**
  (`fl_backend/app/shared/schemas/bounds.py :: MEDIA_MIN_AGE_YEARS`). The switch shows only from
  that age, and each confirmation refuses a `true` from anyone younger
  (`fl_backend/app/api/einwilligung/services.py :: find_self_media_refusal`).
- **Each consent choice keeps its own evidence**: when its person last set it, under which wording's
  label, and on a withdrawal the grant it ended (`fl_backend/app/shared/einwilligung_evidence.py`).
  The labels are `fl_frontend/src/core/consentWordings.ts :: CONSENT_WORDINGS`' keys, each frozen
  with its words. Only the person's own act grants a choice or stamps its evidence. One paste, run
  with the deploy that first serves the current wordings, re-points every label stored before it to
  its consent's current wording. A record stamped before that deploy therefore names words its
  person may not have been shown, which is [section 11](#11-open-and-owed-a-decision)'s first
  question. A label stamped since names the words its person saw.
- **Some refusals are taken by the code alone**, each before anything is written. Whether any meets
  Art. 22 is [section 11](#11-open-and-owed-a-decision)'s question. They are:
  - a birthdate outside a role's span;
  - an address the ban list holds, on a sign-in by any route, refused as its session would be
    created (`fl_frontend/src/core/auth/minting.ts :: refuseUnadmitted`);
  - a full squad;
  - Cloudflare's bot check on the sign-in code request, the application form and the registration
    form (`fl_frontend/src/core/turnstile.ts :: turnstileRefusal`);
  - an address that is not plain ASCII (`fl_backend/app/shared/folding.py :: league_address`), which
    the browser's copy of that rule refuses first, before anything is sent
    (`fl_frontend/src/core/emailAddress.ts :: isDeliverableAddress`, read by
    `fl_frontend/src/kit/TextField.tsx :: judgeOf` and the sign-in form's schema);
  - the code sign-in's limits (`fl_frontend/src/core/signInGate.ts :: mayReceiveSignIn`, the
    per-address counts under `fl_frontend/src/core/auth/signInRows.ts :: boundIdentifier`).
- **A mailbox past the forms' bound is mailed nothing, and nobody is refused.** Once a mailbox holds
  three unanswered links of the season
  (`fl_backend/app/api/bewerbungen/services.py :: OPEN_LINKS_PER_MAILBOX`), its plus-tagged forms
  among them, the next application or registration naming it sends it no link. That press stores as
  any other and is answered alike. Each form counts its own and each season its own, so a mailbox
  named on both forms, or in two running seasons, can hold three of each. The seat stands unmailed,
  owed no reminder and no notice, until an administrator sends its link. Unsent, it goes with its
  application on the application's day, and a registration on its own. A real person's seat can
  stand so behind a stranger's presses, which both administrators' lists say on its row („Nicht
  gesendet“).

## 3. The processing activities

Each activity's controller is the association (section 1), its transfers are section 7's and its
measures section 8's. "Administrators" are the holders of a grant to the administration.

- **Applications and contact seats** (`bewerbungen`; `saison_teams.kontakte`).
  - Purpose and basis: admitting a school's team to a season and reaching it while the season runs;
    Art. 6(1)(f), the WhatsApp scope and the media answer on consent.
  - People and data: a school's three contact persons per application and per season row. Each has
    a name, an address, a telephone number and the birthdate their own confirmation types, their
    confirmation or Widerspruch, and each consent choice with its evidence. Beside them, the
    school's details, its address among them. The persons are named by whoever submits the
    application or by an administrator, so their data is taken from a third party (Art. 14).
  - Recipients: administrators; an application's Ansprechperson, who is told which other seats are
    still open and which objected, by role alone, at an address that may be unconfirmed; every seat
    holder of a season row, who sees on the team's overview each other seat's holder by name and
    whether they confirmed, never their address, telephone number or birthdate
    (`fl_backend/app/api/teams/schemas.py :: FLTeamSeat`).
- **Squads** (`registrierungen`, `spieler`, `saison_spieler`, `invitations`).
  - Purpose and basis: entering a pupil in a team's squad and fielding them; Art. 6(1)(f), the
    name's publication and media on consent.
  - People and data:
    - pupils from 16, with name, address, birthdate, shirt number, position and Stufe;
    - the role of Kapitän or Co-Kapitän, where a team's contact seat sets one;
    - the publication scope and the media answer, with their evidence;
    - the registration link's entry, naming its team and season.
  - Recipients: administrators; the team's seats, who decide an admission; the booked referee, who
    reads both squads for their fixture's report while the fixture takes one and its season runs
    (`fl_backend/app/api/spielberichte/services.py :: takes_a_bericht`); the public, as section 4
    says.
- **Referees** (`schiedsrichter`).
  - Purpose and basis: booking and paying who officiates; Art. 6(1)(f), the name on a fixture and
    media on consent.
  - People and data: referees from 16, with name, address, telephone number, school, fee, birthdate,
    the consent record with its evidence and the link. The address is required, since the link is
    how they learn of their entry (Art. 14(3),
    `fl_backend/app/shared/schemas/kontakt.py :: FLKontaktPayload`).
  - Recipients: administrators; the public, as section 4 says.
- **Fixtures, their confirmations, their line-ups and their reports** (`spiele`,
  `spielbestaetigungen`, `aufstellungen`, `spielberichte`).
  - Purpose and basis: scheduling, confirming and recording matches; Art. 6(1)(f).
  - People and data:
    - a fixture's note (free text), its booked referee and their `payment`;
    - each party's answer with its reason (free text) and, for a club, the seat that gave it and
      never its holder
      (`fl_backend/app/api/spielbestaetigungen/services.py :: compose_answer_update`);
    - each club's line-up by pupil (`aufstellungen`);
    - a report's goals and cards by pupil, and the remarks (free text).
  - Recipients: administrators; the booked referee; the public, as section 4 says.
- **Clubs and seasons** (`teams`, `saison_teams`, `saisons`).
  - Purpose and basis: the league's public record; Art. 6(1)(f).
  - Data: a club's name, school, address and description, and a team's reason for leaving a season,
    all public; free text may name a person.
- **Sign-in and accounts** (the `auth` database: `user`, `session`, `verification`, `passkey`;
  `address_changes`).
  - Purpose and basis: signing a person in to their own records and keeping the account safe; Art.
    6(1)(f).
  - People and data:
    - everyone who signed in;
    - the address of anyone who submits the sign-in form, held in `verification` before the send
      gate is consulted;
    - sessions with their factor, expiry and last use;
    - passkeys with their public key, the reported authenticator model and any name the holder gives
      one, never a private key (`fl_frontend/src/core/auth/library.ts` configures the store);
    - the per-address code counts, under a keyed hash;
    - an address change's two addresses, until it ends and its sign-in account has moved.
  - Recipients: the person; administrators, of a non-holder's running change, both addresses; the
    owner alone, of a holder's; every holder by mail, its old address and its new one masked.
- **Administration access and the ban list** (`grants`, `ban_list`).
  - Purpose and basis: who may administer the league, and refusing an address the league declined;
    Art. 6(1)(f).
  - People and data: a grant's address and tier, in plain, a waiting addition's or handover's date
    among them; a ban's barred address, in plain, its free-text reason and the last season it covers.
  - Recipients: administrators, of a grant's and a ban's rows. Every holder in effect and the person
    named, by mail, of each change of access. That mail names the address it concerns and nobody who
    acted (`fl_frontend/src/core/grantEmail.ts :: buildGrantEmail`).
- **The action log and the privacy lines** (`action_log`; the `journal.act` lines).
  - Purpose and basis: who did what, and repeating what a restore would undo; Art. 6(1)(f).
  - Data:
    - in a log row, each act's who: an administrator by address, anyone else by role and team, or
      the system's mark. Beside it the record's id, a label of league data, a pass's count, a grant
      act's grantee by address and an erasure's typed reference. The row also holds the `trace_id`
      joining it to the edge's line for that request, stored and never served
      (`fl_backend/app/core/recording.py :: record_act`);
    - in a privacy line, its act, the random id joining an act's lines, the request's `trace_id` and
      record ids. An erasure's line adds its seats, a confirmed one with that slot's confirmation
      day, and each other field it took the person off, by row id and field name. A withdrawal's
      line adds its choices, and a seat's withdrawal or objection the slots it took. No line holds
      an address or a name (`fl_backend/app/core/journal.py :: privacy_line`).
  - Recipients: administrators.
- **Mail** (`outbox`; the league's mailbox; WhatsApp).
  - Purpose and basis: telling people what concerns them, and answering them; Art. 6(1)(f),
    WhatsApp on consent.
  - Data: each message's recipient, facts until it is sent, and its delivery state; what anyone
    writes to a league address, which arrives in the league's mailbox; a number and messages on
    WhatsApp.
  - Recipients: Resend, Google, private mailboxes and WhatsApp (section 7).
- **Delivering the website** (the server's journal, the browser).
  - Purpose and basis: serving and protecting the site; Art. 6(1)(f), and § 25(2) Nr. 2 TDDDG for
    what is stored in or read from the browser.
  - Data:
    - each request's access line: the visitor's address, the time, the method, the path without its
      query, the status, the durations, the size and the browser identifier
      (`nginx/shared/http.conf :: fl_json`). A mailed link carries its token in the query, so no
      token reaches the line, which `nginx/edge_test.sh` holds;
    - nginx's error lines. A refusal writes none. An upstream failure's line repeats the request
      line whole, its query and referrer with it
      ([`ops/spec.md`](ops/spec.md#13-nginx-routing));
    - the application's log lines;
    - in the browser, the session cookie, a passkey ceremony's cookie, a mailed link's cookie
      holding its token for an hour (`fl_frontend/src/core/mailedLink.ts`), the theme in local
      storage, Cloudflare's challenge clearance and Turnstile's frame.
  - Recipients: Hetzner and Cloudflare (section 7).
- **Media and the organisers' names.**
  - Purpose and basis: showing the league; consent, from 18 for media.
  - Data:
    - photographs, videos and interviews, on this site and the league's Instagram account;
    - the organisers' first names (`fl_frontend/src/features/meta/constants.ts :: ORGANISERS`),
      each on their own agreement;
    - the board's full names in the Impressum (`fl_frontend/src/core/brand.ts :: VORSTAND`),
      on § 18(1) MStV and, where it reaches this site, § 5 DDG.
  - Recipients: the public; Meta (section 7).

## 4. What is published, and on what basis

- **A club's street address is public, and the application form and the acceptance screen say so**
  (`fl_backend/app/api/teams/schemas.py :: _TeamWritable.address`;
  `fl_frontend/src/app/(classic)/bewerbung/[saison]/BewerbungFields.tsx`,
  `fl_frontend/src/app/admin/(list)/saisons/[saison]/bewerbungen/[bewerbung]/AcceptFields.tsx`).
  **Datenschutzexperte consulted.**
- **A pupil's name is published only on their own consent, given alone from 16.** Every public read
  of a pupil decides by `fl_backend/app/api/spieler/services.py :: name_is_public`, or its
  expression at a join, `fl_backend/app/shared/einwilligung.py :: NAME_IS_PUBLIC`. It asks that the
  record be present, its `scope` `kader_public` and its `confirmed_at` stamped. Every other row is a
  nameless slot, „anonym“, served after the named rows. It carries no number, no position and no
  record id, which would say whose it is or link its seasons
  (`fl_backend/app/api/spieler/services.py :: build_spieler_pipeline`). The gate fails closed. A squad's Kapitän and Co-Kapitän carry a mark after their name on
  the public squad and in a match's line-ups, and a nameless slot carries none. The mark is served
  only where the name is, so it publishes nothing about a pupil whose name is withheld.
- **A referee's name stands on a fixture only on their own consent, and only once they agreed to
  the booking** (`fl_backend/app/api/spiele/schemas.py :: _withheld_unless_agreed`, through the same
  predicate). No fixture carries the referee's record id
  (`:: FLSpielSchiedsrichterFieldPublic`).
- **A match's page publishes the clubs' line-ups and, on an adopted report, each goal's and card's
  minute and pupil and each card's colour.** Every pupil passes the squad's rule above, and the
  remarks are never published
  (`fl_backend/app/api/spielberichte/services.py :: compose_public_bericht`). A report and a line-up
  store a pupil by record id alone, and the read joins the name from the pupil's row. A name
  therefore stands only while that row exists: the season rule or an erasure leaves the slot naming
  nobody, as [section 5](#5-erasure-reaches-everyone-who-asks) says. Whether a card may stand
  beside a named pupil of 16 or 17 is open ([section 11](#11-open-and-owed-a-decision)), and the
  read is served while it is.
- **A photograph, a video or an interview needs its own consent, from 18**, published on this site
  and the league's Instagram account. A withdrawal takes it down from both, which the notice
  promises. No code publishes media, so the takedown is the organisers' step by hand.
- **The organisers' names stand in the public source code**, so a withdrawal takes a name off the
  site and out of the current code, and earlier versions stay in the repository's public history.
- **The free texts on public pages stay public**: a fixture's note, a withdrawal's reason and a
  club's description (`fl_backend/app/api/teams/schemas.py :: _TeamWritable.description`).
- **AI crawlers are blocked at the edge, and asked in the managed `robots.txt` once it is on.** Both
  settings live in the hosting dashboard, and
  [`ops/spec.md`](ops/spec.md#18-the-edges-declared-state) records whether each is on.

## 5. Erasure reaches everyone who asks

- **Anyone can have their data erased, with the least asymmetry between roles.** A signed-in person
  erases by `fl_backend/app/api/identity/person_router.py :: post_account_erasure`, which refuses
  only the owner, who hands over first. Anyone else asks by mail, and an administrator runs
  `fl_backend/app/api/identity/admin_router.py :: post_erasure`. Both run
  `fl_backend/app/api/identity/crud.py :: erase_everything`, and each lists the records it reaches
  for confirmation first, read through the erasure's own selection.
- **One address is one person: enforced among pupils, and assumed across the collections.** Every
  record stored under a folded address (`fl_backend/app/shared/folding.py :: sign_in_identifier`) is
  that one person's, and so is the account the sign-in store keys on it
  (`fl_frontend/src/core/emailAddress.ts :: asSignInIdentifier`). Among pupils `uniq_spieler_email`
  enforces it. An admission writes into the person the address resolves to, asking the team first
  where the name or birthdate differs
  (`fl_backend/app/api/registrierungen/services.py :: find_person_refusal`). Across the collections
  nothing compares names; the registration form and the application's seats tell the person so. A
  mailbox shared anyway is one account, and an erasure keyed on it takes every record under it.
  Every erasure is keyed on a mailbox, so a hand edit emptying a row's address puts it out of reach.
- **What an erasure deletes or leaves naming nobody**, in one transaction:
  - every record the address holds, outright rather than nulled;
  - a referee's bookings of fixtures still to come, removed; a played fixture keeps its booking and
    `payment`, naming nobody
    (`fl_backend/app/api/schiedsrichter/crud.py :: erase_referee_in_session`);
  - a pupil's goals and cards, and their entries on the line-ups of played fixtures, left naming
    nobody; their entries on the line-ups of fixtures still to come are removed
    (`fl_backend/app/api/spielberichte/crud.py :: empty_pupil_entries_in_session`,
    `fl_backend/app/api/aufstellungen/crud.py :: erase_pupil_from_aufstellungen_in_session`);
  - their address wherever the action log names it, replaced by the marker naming nobody
    (`fl_backend/app/api/action_log/crud.py :: reattribute_administrator_in_session`);
  - every reason typed in a fixture answer from a seat they hold, found by team, season and role
    (`fl_backend/app/api/kontakte/crud.py :: remove_the_seats_reasons`), with their seats' links;
  - every mail owed or sent to them but the deletion link that asked for the erasure and the notice
    telling them of it, and every access notice still owed about them
    (`fl_backend/app/api/identity/crud.py :: erase_the_mails_in_session`);
  - a pending address change of theirs, and another address's change naming theirs as its new one;
    the holders are told where that other address's holder had confirmed one
    (`fl_backend/app/api/address_change/crud.py :: end_the_address_changes_in_session`);
  - every grant the address holds
    (`fl_backend/app/api/grants/erasure.py :: erase_grants_in_session`);
  - the sign-in account at the address. An account at an earlier address goes with the account
    sweep (section 6).
- **What outlives an erasure:**
  - the database's snapshots, about 8 days, taken daily (the provider's console, read 2026-09-01).
    A restore runs every erasure since its snapshot again, found by the ids its lines name
    ([`ops/runbooks.md`](ops/runbooks.md#13-after-a-restore-from-a-snapshot));
  - Resend's copies of every message, for its own period (section 7);
  - a message the person wrote to the league, deleted from the league's mailbox on request, for
    Google's own period after a deletion (section 7);
  - the copy of it passed on to a board member's mailbox, deleted on request, a private provider's
    backups beyond reach;
  - the access notices already delivered to other holders' private mailboxes, each naming the
    address it concerns, beyond reach as section 7 says;
  - the privacy lines, which name a record's id and a seat's confirmation day and no address or
    name, for their own bound (section 6);
  - a ban's row, holding the address and a reason possibly naming the person, until its bound
    (section 6);
  - a reason they typed in a fixture answer from a seat they have since left, the answer recording
    the seat and never its holder, until that season's contact seats are cleared (section 6);
  - free text typed about others and keyed on no address. Only a name search could find it, and a
    name search would take a namesake's text with it. It covers:
    - a fixture's note;
    - an application's wished opponent and decision reason;
    - a team's leaving reason;
    - a registration's decision reason;
    - a club's description;
    - a reason another seat's holder or an administrator typed in a fixture answer;
    - a report's remarks naming a pupil by name or by shirt number;
    - an erasure's typed reference;
  - the deletion link's Postausgang row, until its secret lapses with the link, 24 hours after it
    was minted (`fl_backend/app/api/outbox/services.py :: row_of`,
    `fl_frontend/src/core/erasureEmail.ts :: ERASURE_LINK_VALID_HOURS`);
  - the row of the deletion notice, and of the notice to an address a change replaced, until the
    row's two-day deadline;
  - a registration link's entry, which names no subject, until the log's twelve months;
  - a mailbox's hash in `mailbox_anchors`, for its hour (section 6).
- **A retired row is never removed because of its age**: a confirmed referee who stopped, a club
  that left and a past season keep their rows. A person's row goes only by an erasure or by section
  6's clocks, a pupil's season rule and a referee's unconfirmed entry.
  **Datenschutzexperte consulted.**

## 6. Retention is bounded where a bound was chosen

Each bound is read from the symbol beside it; nothing compares this table with the notice's. A
bound's conditions follow the table.

| Store                                        | Bound                                  | Enforced by                                                                                                                                                            |
| -------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An application not every seat confirmed      | An unconfirmed seat's 14 days          | `fl_backend/app/shared/schemas/bounds.py :: BEWERBUNG_CONFIRMATION_DEADLINE_DAYS`, `fl_backend/app/api/bewerbungen/services.py :: deletion_is_due`                     |
| An application undecided at its season's end | Its season's end                       | `fl_backend/app/api/bewerbungen/services.py :: undecided_erasure_is_due`                                                                                               |
| A declined application                       | 14 days after the decision             | `:: decline_erasure_is_due`                                                                                                                                            |
| An accepted application                      | The end of a later season              | `:: acceptance_erasure_is_due`                                                                                                                                         |
| A season row's contact seats                 | The end of the season after theirs     | `fl_backend/app/api/bewerbungen/system_router.py :: sweep_saison`                                                                                                      |
| A season row's unconfirmed seat              | Its own 14 days                        | `fl_backend/app/api/bewerbungen/services.py :: lapsed_seats`, `fl_backend/app/api/bewerbungen/system_router.py :: sweep_saison`                                        |
| Fixture answers and match reports            | The league's record                    | `fl_backend/app/api/bewerbungen/system_router.py :: strip_the_confirmations`, `:: strip_the_reports`                                                                   |
| An unconfirmed registration                  | 14 days from the link                  | `fl_backend/app/shared/schemas/bounds.py :: REGISTRIERUNG_CONFIRMATION_DEADLINE_DAYS`, `fl_backend/app/api/registrierungen/services.py :: confirmation_erasure_is_due` |
| A registration undecided at its season's end | Its season's end                       | `fl_backend/app/api/registrierungen/services.py :: undecided_erasure_is_due`                                                                                           |
| A declined registration                      | 14 days after the decision             | `:: decline_erasure_is_due`                                                                                                                                            |
| An admitted registration                     | The admission                          | `fl_backend/app/api/registrierungen/person_router.py :: admit`                                                                                                         |
| A pupil                                      | A season after their last squad season | `fl_frontend/src/features/saisons/sweep.ts :: runErasureSweep`                                                                                                         |
| A registration link's entry                  | The link's end                         | `fl_backend/app/api/registrierungen/services.py :: saison_takes_registrierungen`                                                                                       |
| A referee unconfirmed or under a Widerspruch | 14 days from the latest link           | `fl_backend/app/shared/schemas/bounds.py :: SCHIEDSRICHTER_CONFIRMATION_DEADLINE_DAYS`, `fl_backend/app/api/schiedsrichter/system_router.py :: sweep_schiedsrichter`   |
| A confirmed referee                          | A deletion or a request                | `fl_backend/app/api/identity/crud.py :: erase_everything`                                                                                                              |
| A ban                                        | Five full seasons after its own        | `fl_backend/app/shared/schemas/bounds.py :: BAN_DURATION_SAISONS`                                                                                                      |
| A grant                                      | Its removal or an erasure              | `fl_backend/app/api/grants/admin_router.py :: delete_grant`                                                                                                            |
| An address change                            | 30 days after its end                  | `fl_backend/app/shared/schemas/bounds.py :: ADDRESS_CHANGE_VALID_HOURS`, `:: ADDRESS_CHANGE_RETENTION_DAYS`                                                            |
| A sign-in account and its passkeys           | An hour after no record holds it       | `fl_frontend/src/features/roles/sweep.ts :: runAccountSweep`                                                                                                           |
| A session                                    | 14 days after its last use             | `fl_frontend/src/core/sessionLifetimes.ts :: SESSION_EXPIRES_IN_DAYS`, [`ops/runbooks.md`](ops/runbooks.md#14-the-auth-databases-indexes)                              |
| A sign-in code; the code counts              | 10 minutes; a day or an hour           | `fl_frontend/src/core/authEmail.ts :: CODE_VALIDITY_MINUTES`, [`ops/runbooks.md`](ops/runbooks.md#14-the-auth-databases-indexes)                                       |
| A Postausgang row                            | 30 days after it is sent or given up   | `fl_backend/app/api/outbox/services.py :: RETENTION`, `:: row_of`                                                                                                      |
| Mail to the league                           | Six months after it arrives            | Gmail's auto-deletion, a setting of the league's Workspace                                                                                                             |
| A mailbox's document                         | An hour after the last press           | `fl_backend/app/shared/schemas/bounds.py :: MAILBOX_ANCHOR_RETENTION_SECONDS`, `fl_backend/app/core/constraints.py :: TTL_INDEXES`                                     |
| The action log                               | 12 months a row                        | `fl_backend/app/shared/schemas/bounds.py :: ACTION_LOG_ENTRY_RETENTION_SECONDS`                                                                                        |
| The server's journal                         | The journal's own age limit            | `docker-compose.yml :: x-logging`, [`ops/runbooks.md`](ops/runbooks.md#7-the-journals-age-limit)                                                                       |

- **An application not every seat confirmed** goes once an unconfirmed seat's own 14 days end,
  whether or not the Ansprechperson's mail arrived. Each person who confirmed a seat is owed the
  deletion notice in that same write.
- **An application undecided at its season's end** goes then, whatever was confirmed. Each person
  who confirmed a seat is owed the notice in the same write.
- **A declined application or registration** goes 14 days after the decision. The decline's mail
  says so, for a registration to a confirmed pupil.
- **An accepted application** goes once a season after the one it applied for has ended.
- **A season row's contact seats** are cleared once the season after theirs has ended, their links
  with them. **Its unconfirmed seat** is emptied by the first hourly pass past its own 14 days,
  whatever the season's status, its link and any reason typed from it with it.
- **Fixture answers and match reports** stay as the league's record. From that same clearing of the
  contact seats, their reasons and remarks are stripped.
- **An unconfirmed registration** goes the day after its stored deadline, 14 days from the link.
- **An admitted registration** goes in the admission's own transaction, with every other pending
  registration of its address that season.
- **A pupil** goes once the season after their last squad season has ended, by the hourly pass after
  the activation.
- **A registration link's entry** has no clock: the link ends with its season, its team's Austritt,
  or when withdrawn or replaced.
- **A referee unconfirmed or under a Widerspruch** is erased by the first hourly pass past its
  stored deadline's day, 14 days from its latest link. A referee's Widerspruch writes its day alone
  (`fl_backend/app/api/schiedsrichter/public_router.py :: post_decline`). Until the pass, the entry
  stands, shown to administrators as objected, so that no booking takes it and nobody asks the
  person again. A contact seat's Widerspruch empties the seat in the same write.
- **A confirmed referee** is kept until an administrator deletes the row or the referee asks.
- **A ban** is removed by the activation past the fifth full season after the one it was entered
  under.
- **A grant** is kept until removed or erased, a waiting addition until withdrawn too.
- **An address change**'s links each last 24 hours, and a lapsed change is ended within the hour. An
  ended change keeps its two addresses only until its sign-in account has moved to the new one, at
  the confirming press or by the next hourly pass
  (`fl_backend/app/api/address_change/system_router.py :: post_address_change_moves_done`). It then
  keeps no address, and goes 30 days after its end.
- **A sign-in account and its passkeys** go within the hour of no league record or grant holding
  the address; a ban holding it does not count.
- **A session** serves a person's own pages until 14 days unused, 30 at most, and the
  administration until 1 hour unused, 24 at most, each judged on every read
  (`fl_frontend/src/core/sessionLifetimes.ts :: PERSON_LIFETIME`, `:: ADMIN_LIFETIME`). Its row
  goes later, by the TTL index on `expiresAt`, 14 days after the session was last used
  (`:: SESSION_EXPIRES_IN_DAYS`).
- **A sign-in code** lasts 10 minutes. Failed codes are counted for a day and requested codes for
  an hour, under a keyed hash.
- **A Postausgang row** holds no facts once sent or given up, and goes 30 days after that. A row
  carrying a secret goes when the secret lapses.
- **Mail to the league** is deleted from the league's mailbox six months after it arrives, by a
  setting of the league's Workspace that no file in this repository holds. The copy passed on to a
  board member's mailbox keeps that mailbox's own rule.
- **A mailbox's document** holds a hash, never the address, and goes an hour after the last press
  with room to mail it.
- **The server's journal** holds every service's lines, each tagged with its container's name: the
  edge's access and error lines, the application logs and the privacy lines. Its age limit is the
  server's own setting, which no file in this repository holds. The notice publishes nine days
  (`fl_frontend/src/core/serverCopy.ts`).
- **A seat an erasure emptied holds no day**, so it takes nobody else: its application goes once no
  seat's link runs (`fl_backend/app/api/bewerbungen/services.py :: deletion_is_due`).
- **Only a person who confirmed hears of an application's deletion**
  (`fl_backend/app/api/bewerbungen/services.py :: owed_deletion_notices`). A seat never confirmed
  may be a stranger's, and an Ansprechperson a Widerspruch's notice told hears nothing twice. A
  decline's own mail names the deletion, and an application that served ends with no mail.
- **No delivery state has a clock of its own**: each goes with what holds it, the Postausgang row
  its message was sent from or the link entry it went out for. No open or click tracking is
  subscribed ([`ops/runbooks.md`](ops/runbooks.md#10-the-mail-providers-dashboard)).
- **A registration's deadline is stored at the mint**, so a raised bound never moves a link already
  in somebody's inbox. Every link asking a person to confirm being named or registered is ruled to
  live 14 days, and every unconfirmed or declined item to go 14 days after, which the notice states.
  An address change moving an unconfirmed registration mails a fresh link to the new address. It
  stores a deadline 14 days on, which that mail states. A move mailing none keeps the stored
  deadline, so a registration nobody can confirm is kept no day longer for the move
  (`fl_backend/app/api/address_change/crud.py :: _move_the_registrierung_in_session`). A move
  mails none where the new mailbox holds its three links or the registration's link is over.
- **A sent mail's row keeps its key alone once an address change replaces its address**
  (`fl_backend/app/api/outbox/services.py :: TOMBSTONE_UPDATE`). Its recipient, its delivery state
  and the record it was about go at the change. The key a pass decides by stays until the row's 30
  days are out, so the new address is owed nothing twice. A key is built from record ids, seats,
  roles and instants, and never from an address, so the row keeps nothing about the replaced
  mailbox.
- **A ban removes itself on the league's calendar rather than a count of days**: somebody too young
  stays barred until too old. Its row goes with no message. The one sent at the ban goes to an
  address holding a sign-in account alone
  (`fl_backend/app/api/ban_list/schemas.py :: FLPostBanListEntryPayload`,
  `fl_frontend/src/core/banListEmail.ts`), and names its season, its reason, what is kept and how to
  object. A lift mails nobody
  (`fl_backend/app/api/ban_list/admin_router.py :: delete_ban_list_entry`).
- **One deletion notice tells its person once a confirmed account or application is deleted**,
  whoever caused it, and never holds the deletion up (`fl_frontend/src/core/bewerbungEmail.ts`).

## 7. Processors and third parties

Each entry mirrors that provider's own pages as read on the day given, which move without us, but
the host's, which rests on its signed agreement.

- **Hetzner Online, the host.**
  - What reaches it: everything on the server, the edge's logs included.
  - Agreement: an Art. 28 agreement with its technical and organisational measures, concluded; the
    owner holds the signed copy.
  - Where: Nuremberg.
- **Cloudflare.**
  - What reaches it: every request, in plaintext at the edge. Turnstile's signals on three forms,
    in analytics for 7 days: the window the Turnstile dashboard showed on 2026-11-04, rather than a
    period Cloudflare states.
  - Agreement: its standard addendum, every service included (read 2026-10-25). For Turnstile it is
    a processor for the check and a controller of the same signals for its own bot detection (read
    2026-10-04).
  - Where: worldwide at the edge; the Data Privacy Framework, with standard clauses as its fallback.
- **MongoDB Atlas.**
  - What reaches it: the league's database and the `auth` database, and the cluster's daily
    snapshots, each holding what the cluster held on its day for about 8 days.
  - Agreement: its standard addendum, accepted with the account.
  - Where: Frankfurt am Main.
- **Resend (Plus Five Five, Inc.).**
  - What reaches it: every address the league mails and every message in full; a link or a code in
    one is a credential.
  - Agreement: its standard addendum, in force on sign-up. Its executed copy with the standard
    clauses is on file, the owner holding it.
  - Where: the United States for stored data; the Data Privacy Framework and standard clauses.
- **Google Cloud EMEA Limited, Dublin (Google Workspace for Nonprofits), the league's mailbox.**
  - What reaches it: every message to a league address, its attachments included. A member of the
    board reads the mailbox, which passes each message on to a board member. The board also keeps
    the association's own papers there, such as its minutes, and none of the site's data.
  - Agreement: Google's Cloud Data Processing Addendum, accepted in the Workspace admin console on
    2026-11-11. Google names this entity for a Workspace customer in Europe outside France, Italy
    and Poland (<https://cloud.google.com/terms/google-entity>, last modified 2026-06-30, read
    2026-11-12).
  - Where: no data region is chosen, which the Nonprofits edition does not offer. The data may be
    processed in any country where Google or its subprocessors keep facilities (the addendum's
    section 10.1, <https://cloud.google.com/terms/data-processing-addendum>, last modified
    2026-10-30, read 2026-11-12). Data reaches the United States on Google LLC's certification under
    the Data Privacy Framework, and any other third country on the processor-to-processor standard
    clauses of the addendum's Appendix 3, section 4.1
    (<https://cloud.google.com/terms/alternative-transfer-solution>, last modified 2026-09-29, read
    2026-11-12).
- **Private mailboxes.**
  - What reaches them: every access notice to a holder, at the address the grant holds. Every
    message to a league address too, where the board member it is passed on to reads it in one.
  - Agreement: **none**, and no safeguard for a transfer outside an adequacy decision: a gap
    accepted and disclosed (2026-10-25).
  - Where: not committed; Proton (Switzerland) and Gmail on 2026-10-25.
- **WhatsApp (the consumer app).**
  - What reaches it: numbers and messages of the people the league writes to there, one by one.
  - Agreement: **none**: a gap accepted, the consent's line naming the channel.
  - Where: Ireland, onward to the United States on the Framework (read 2026-09-22).
- **Meta (the league's Instagram account).**
  - What reaches it: what the league publishes there, each on its person's consent from 18.
  - Agreement: **none**; Meta is a controller of its own.
  - Where: not committed; Meta Platforms, Inc. is on the Framework list (read 2026-09-22).

Beside the list:

- **Resend keeps every message, its events and its logs for 30 days, its backups up to 7 days
  longer**, on its Free, Pro and Scale plans alike (<https://resend.com/security/gdpr>, read
  2026-10-16); which plan this account is on is recorded nowhere here. No erasure reaches those
  copies.
- **Google keeps a message deleted from the league's mailbox restorable for 30 days, and for 25
  more by an administrator**
  (<https://knowledge.workspace.google.com/admin/support/troubleshooting/restore-a-users-permanently-deleted-email>,
  read 2026-11-12). It deletes what nobody can restore any longer from its systems within 180 days
  at most (the addendum's section 6.1).
- **The agreements are on file**: Resend's executed addendum, Hetzner's Art. 28 agreement with its
  technical and organisational measures, and Cloudflare's and MongoDB's addenda, each saved and held
  by the owner (2026-11-04).
- **Owed, and not yet in hand:** WhatsApp refused the contacts permission on every phone used for
  league messages, so no organiser's address book reaches it.
- **WhatsApp is not a league channel**: the league writes there only to people who chose it, never
  as a requirement, e-mail always standing beside it.

## 8. Technical and organisational measures

- **Access.** An administrator acts only with a passkey session inside both of the administrator's
  figures (`fl_frontend/src/core/auth/guards.ts :: isAdminSession`). A grant is granted and revoked
  as [`ops/runbooks.md`](ops/runbooks.md#3-granting-or-revoking-admin-access) says. A person reaches
  only the records under their own address.
- **The origin.** A remotely managed tunnel is the only route to the origin, so every request
  passes Cloudflare first ([`ops/spec.md`](ops/spec.md#18-the-edges-declared-state)).
- **Hashing.** A mailbox's document holds an unkeyed SHA-256 hash of the address rather than the
  address, which anyone can test against a guessed address, for its hour.
- **Minimisation.** No birthdate reaches a public read; a public row names no record id that links a
  withheld person's seasons; an access line holds a request's path and never its query.
- **Integrity and recovery.** Daily snapshots; the privacy lines naming what a restore undid
  ([`ops/runbooks.md`](ops/runbooks.md#13-after-a-restore-from-a-snapshot)); the breach procedure
  in [`ops/runbooks.md`](ops/runbooks.md#6-when-personal-data-has-been-exposed).

## 9. The deletion concept

Every store of section 6 ends by one of four triggers, each with its mechanism:

- **A clock from a stored day**: the database deletes the row by a TTL index
  (`fl_backend/app/core/constraints.py :: TTL_INDEXES`, the sign-in store's in
  [`ops/runbooks.md`](ops/runbooks.md#14-the-auth-databases-indexes)), or an hourly pass judges it due.
  Mail to the league goes by Gmail's auto-deletion.
- **A condition on the league's calendar**: a season's `status`, judged by the hourly pass or at the
  activation, never a count of days, so a record lasts exactly as long as its purpose can.
- **A person's request**: the erasure of section 5, run at once.
- **The purpose standing**: a confirmed referee, a grant, a club's record, deleted by a decision and
  nothing else.

The hourly scheduler (`fl_frontend/src/instrumentationNode.ts :: armScheduler`) runs every pass. It
pings the heartbeat monitor, naming on `/fail` each job that threw or left a due deletion. A claim
that a period was honoured rests on that and on each job's line in the log
([`ops/runbooks.md`](ops/runbooks.md#9-checking-that-the-hourly-passes-have-run)). One switch
holds every pass back: `RESTORE_HOLD=on` in the server's `fl_frontend/.env`
(`fl_frontend/src/core/config.ts :: RESTORE_HOLD`), set only while a restore or a change to a stored
shape is under way ([`ops/runbooks.md`](ops/runbooks.md#what-the-hold-stops)). While it holds, the
heartbeat monitor alerts, since no pass pings it. A deletion
takes the record outright, never nulling it, so no third state needs a clock. What a deletion
cannot reach is section 5's list, each bounded by its own period.

## 11. Open, and owed a decision

Each question but the last goes to a Datenschutzexperte; the last is a fact this record owes. No
question holds back a deploy: the site serves what each concerns while it is open. Until an answer,
the notice and the procedures in [`ops/runbooks.md`](ops/runbooks.md) stand as they are.

1. **Re-pointing every stored consent's label to the current wording** (ruled 2026-11-04): whether a
   record then still proves, under Art. 7(1), a consent its person gave under words they were not
   shown, and what is owed instead if it does not.
2. **A card beside a named pupil of 16 or 17**: whether a booking's colour and minute may stand on
   the public match page beside the name a pupil's consent publishes (section 4).
3. **What carries a pupil's own consent from 16**: Art. 8(1) or the pupil's own
   Einsichtsfähigkeit, or a guardian's beside it. The EDPB's consent guidelines (05/2020, paragraph 127) read Art. 8 for a service offered directly to a child. Hesse's template for schools asks a
   parent's signature too (both read 2026-09-22).
4. **Whether the name's scope may be preselected**, and **whether one media switch over photographs,
   videos and interviews, on two sites, is specific enough**. And whether the case law on revoking a
   consent to one's image under the KUG changes the notice's promise that a withdrawal takes what is
   published down from this site and the league's Instagram account.
5. **A withdrawal from a page loaded before a wording changed is refused** until the page is loaded
   again: whether that keeps Art. 7(3)'s "as easy to withdraw as to give".
6. **One act per choice as the proof**: whether the latest act and the grant a withdrawal ended
   prove a consent. The log holds no act from before 2026-10-28 08:25 (Europe/Berlin), and a contact
   seat's early WhatsApp grant carries evidence a hand paste copied from its confirmation's log row.
7. **Art. 22**: whether any refusal of section 2 the code takes alone, Cloudflare's bot check
   among them, meets Art. 22(1). If one does, which exception of Art. 22(2) it rests on, contract
   being refused as a basis. The Working Party's WP251 rev.01 reaches access to education and does
   not say whether a school league's place is it (read 2026-09-22). The notice says no automated
   decision is taken.
8. **The refusals the notice does not name**: an address that is not plain ASCII, and the code
   sign-in's limits. Whether each is a limit of the service, named beside the full squad or not at
   all, and whether a refusal the person is not told of can be offered a review.
9. **The 18 for the two seats that commit a school**: whether that is contractual capacity at all.
10. **The ban's surviving row**: the basis for keeping a plain address and a free-text reason past
    the barred person's erasure. And whether up to about six years is proportionate for a pupil of
    16 or 17, with no review on request.
11. **14 days for an unconfirmed registration**
    (`fl_backend/app/shared/schemas/bounds.py :: REGISTRIERUNG_CONFIRMATION_DEADLINE_DAYS`): whether
    it is proportionate.
12. **The referees entered before the confirmation link**, whose names stood on fixtures until their
    rows were deleted whole and who were never informed under Art. 14: whether Art. 14(5)(b) carries
    it, with the notice as its measure.
13. **A delivery state with no bound**, on an invite entry and on a declined seat's link entry:
    whether it may stand, and whether a delivery record the provider can join to an address is still
    that person's data.
14. **A nameless slot**, with no name, number or record id (section 2): whether it is personal
    data, and so needs a basis of its own, and whether section 2's weighing carries it for pupils of
    16 and 17.
15. **The notice's statements**:
    - one legitimate interest for every processing, against Art. 13(1)(d);
    - „als Chronik der Liga“ as a criterion under Art. 13(2)(a);
    - Art. 13(2)(e)'s line on what is required, stated for the application alone;
    - the transfer sentence covering Cloudflare, Resend and Google together;
    - whether the sentence on the data protection officer can go (Art. 13(1)(b));
    - the supervisory authority's postal address, Postfach 3163, 65021 Wiesbaden, read on its own
      site 2026-11-04.
16. **The edge's clearance and Turnstile**: whether each is strictly necessary under § 25(2) Nr. 2
    TDDDG, and whether Cloudflare's own use of Turnstile's signals needs more than the notice naming
    it. The notice's sentence that both are permitted without consent is a legal conclusion that
    stands as written until the answer.
17. **Cloudflare's own record of each request**, bounded by Cloudflare's plan rather than any
    setting here, and the server journal's age limit, a setting on the server that no deploy
    verifies
    ([`ops/runbooks.md`](ops/runbooks.md#7-the-journals-age-limit)).
18. **Instagram**: whether the league shares control of anything Meta records about the account's
    audience (C-210/16 held a Facebook page's operator a joint controller for its statistics), and
    what publishing there counts as under Chapter V.
19. **The board's full names in the Impressum**:
    - whether § 18(1) MStV carries all four, whether § 5 DDG or § 18(2) MStV reaches this site at
      all, and whether „e. V.“ in the name states the legal form;
    - whether e-mail alone meets the duty of a rapid, direct means of contact (C-298/07), or a
      telephone number or a form must stand beside it;
    - whether the interviews the media consent foresees are journalistic-editorial content needing
      a responsible person under § 18(2) MStV;
    - which basis the notice, the page's description and the lead the page opens with should cite,
      each citing § 5 DDG where this record cites § 18(1) MStV first
      (`fl_frontend/src/core/serverCopy.ts :: SERVER_COPY`'s `description.legalNotice`, the page's
      description and its lead alike).
20. **The objection line's place**: whether a footer of 12 px under the Impressum and privacy links
    in each first-contact mail, and not on the confirmation page, is „presented clearly and
    separately from any other information“ under Art. 21(4).
21. **A Widerspruch and naming the person again**: after one, an administrator can seat the same
    person and a new application can name them, which mails them again. Nothing checks it, and only
    a record id stays in a line. Whether a Widerspruch must prevent that, and whether a mark may be
    kept to do so.
22. **An adult contact person's birthdate**: whether the one age check carries storing the date
    until the end of the following season, or a note of the check is enough (Art. 5(1)(c), (e)).
23. **The source under Art. 14(2)(f)**: the form stores nobody as having sent it, the page saying
    „in der Bewerbung von {Schule}“ and the notice „von der Person, die die Bewerbung einreicht“.
    Whether that is enough, recital 61's general information being for various sources.
24. **A Trainer of 16 or 17**: a contact person may be 16, can give the WhatsApp consent and decides
    admissions to a squad, seeing other minors' names to do so. Whether the answers on pupils and on
    the two 18 seats carry that too.
25. **The Ansprechperson and the seat holders as recipients**: whether the mails naming the other
    seats make the Ansprechperson a recipient under Art. 4(9), as section 3 and the notice treat
    them. The same holds for every seat holder of a season row, whom section 3 and the notice name
    as a recipient of the other seats' names and of whether each confirmed.
26. **A seat past the bound and Art. 14**: such a person is stored untold, the first mail being
    where the notice stands. That lasts at most the application's 14 days and one, or a
    registration's deadline, unless an administrator sends the link. Whether that is the reasonable
    period of Art. 14(3)(a), its month being the outer limit.
27. **A referee's entry after a Widerspruch** stands until the midnight after its link's deadline, up
    to 14 days, shown to administrators as objected so that nobody asks the person again (section
    6): whether that keeps Art. 17(1)'s "without undue delay".
28. **Production's data on a development machine**: production's snapshot of 2026-11-11 is on a
    development machine, as the downloaded file and as the local containers that restored it to
    rehearse the migration, with their volumes. It holds every database of the cluster, the sign-in
    store's among them. The owner deletes all three after the deploy it rehearses, and this record
    then says how long the copy was kept and how it was deleted.
