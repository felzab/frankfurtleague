# Datenschutz — the rulings, held here until each reaches its home

**Purpose:** every data-protection decision I have taken for the league site, recorded once, so
none is lost before the code, a spec sheet or a runbook carries it. A ruling leaves only when its
text has reached its destination, and it moves rather than copies (`docs/_standard/standard.md` COR-2).
**A section number is spent once taken**: a gap in the run below is a number that left with its
ruling, and renumbering what stands would repoint every citation of it.

Nothing here is a legal conclusion. A ruling marked **Datenschutzexperte consulted** was taken after
consulting one; every other ruling is mine, dated where it stands, and each stands open to a
qualified reviewer's correction. **A ruling the
site performs names the symbol that performs it, and one it does not says what stands between the
two** — which is what a reviewer needs before reading the published notice
(`fl_frontend/src/features/meta/components/views/DatenschutzView.tsx`) against this page.

| Section                                                                                                    | Answers                                                      |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [1. Responsibility and the request route](#1-responsibility-and-the-request-route)                         | Who the controller is, and where a request goes              |
| [2. Consent comes from the person, from 16 or 18](#2-consent-comes-from-the-person-from-16-or-18)          | The sign-up flow every ruling on consent assumes             |
| [3. The current pupil records are reset once](#3-the-current-pupil-records-are-reset-once)                 | What happens to the backfilled consents                      |
| [4. What is published, and on what basis](#4-what-is-published-and-on-what-basis)                          | Addresses, names, the organisers' page, crawlers, the notice |
| [5. Erasure reaches everyone who asks](#5-erasure-reaches-everyone-who-asks)                               | Who can be erased, what erasure reaches, what it does not    |
| [6. Retention is bounded where a bound was chosen](#6-retention-is-bounded-where-a-bound-was-chosen)       | The action log, applications, contacts, access logs          |
| [7. Processors and third parties](#7-processors-and-third-parties)                                         | Who receives data, under which agreement, and the gaps       |
| [9. A local copy of production expires](#9-a-local-copy-of-production-expires)                             | The development practice the rulings bound                   |
| [10. Adjacent decisions were accepted as recommended](#10-adjacent-decisions-were-accepted-as-recommended) | Roadmap items that needed no expert                          |
| [11. Open, and owed a decision](#11-open-and-owed-a-decision)                                              | What the rulings above do not settle                         |

## 1. Responsibility and the request route

- **The controller is the association.** `fl_frontend/src/core/brand.ts :: VEREIN_NAME` is the one
  spelling the notice, the Impressum and every message's close read, and it carries the
  association's registered legal form, so no page spells that form for itself. No school and no
  individual is the controller; the league is run by its pupils as an association, and a school-law
  basis is unavailable.
- **A person who signs in changes or withdraws their own consents on the account page**, each record
  they hold a control of its own (`fl_frontend/src/features/konto/components/views/EinwilligungSection.tsx :: EinwilligungSection`).
- **Every other request — access, rectification, erasure, objection, and a withdrawal by e-mail —
  goes to kontakt@frankfurtleague.de.** The published notice gives that route a section of its own
  (`DatenschutzView.tsx :: 2. Wohin Deine Datenschutzanfrage geht`), the confirmation page repeats
  it beside every right it names (`fl_backend/app/shared/einwilligung.py :: FASSUNGEN`),
  and [`ops/runbooks.md`](ops/runbooks.md#5-when-somebody-asks-for-their-data-or-asks-us-to-change-it)
  is the procedure that answers one.

## 2. Consent comes from the person, from 16 or 18

Every ruling below is the sign-up flow as it stands for the next season.

- **Every participant answers for themselves through the website, and nobody consents on anybody
  else's behalf.** A pupil registers themselves; a referee is entered by an administrator and a
  contact person by whoever submits their school's application or by an administrator on a team's
  season row, and each of them confirms their own entry through their own link. No administrative
  route creates a player and no administrative payload carries a consent choice, so an administrator
  can neither create one nor assume, enter or transcribe a consent on anybody's behalf
  (`docs/backend/spec.md :: I869`). The one write that creates a player is a team's admission of a
  pupil's own confirmed registration, which carries that pupil's own answer onto the person
  (`fl_backend/app/api/registrierungen/person_router.py :: aufnehmen`, `docs/backend/spec.md :: I951`,
  `:: I953`).
  **A contact person is the one seat where that consent is not the record kept:** what such a person
  answers is a Kenntnisnahme of a notice, the basis being Art. 6(1)(f) rather than an
  Einwilligung, and the only consents their block holds are the optional WhatsApp scope and the media
  answer, both of which that person takes back on the account page
  ([`glossary.md`](glossary.md#einwilligung--kenntnisnahme--one-stored-key-over-two-vocabularies-a-persons-own-consent-and-what-a-contact-seat-was-told)).
  **No such flow exists for organisers or
  administrators:** an organiser is listed on their own word to me
  ([section 4](#4-what-is-published-and-on-what-basis)), and an administrator is a grant another
  administrator or the database entered (`docs/glossary.md :: Berechtigung`).
- **The minimum age is 16 for every role, and 18 for the two seats that sign for the school.**
  A registration below 16 is refused as `REQ-REGISTRIERUNG-007`, judged against the birthdate the
  pupil enters on their own confirmation page and before anything is written
  (`fl_backend/app/api/registrierungen/services.py :: find_alter_refusal`); the refusal stands there
  and nowhere else, the submission itself collecting no birthdate at all. The floor is
  `fl_backend/app/shared/schemas/bounds.py :: REGISTRIERUNG_MIN_ALTER_JAHRE`, the pupil's own rather
  than a contact seat's, so raising one does not silently raise the other. A referee's own
  confirmation judges the same sixteen against a floor of its own, as `REQ-SCHIEDSRICHTER-005`
  (`fl_backend/app/api/schiedsrichter/services.py :: find_alter_refusal`,
  `fl_backend/app/shared/schemas/bounds.py :: SCHIEDSRICHTER_MIN_AGE_YEARS`). Sixteen is my ruling
  rather than a figure a law hands the league: one floor for every role replaces three, the basis for
  taking part is legitimate interest (below), and a pupil consents to their name being published on
  their own from sixteen ([section 4](#4-what-is-published-and-on-what-basis)). **The Ansprechperson and the Stellvertretung are held
  to 18** because those two seats commit the school — they are the people a fixture, a withdrawal
  and the entry itself are agreed with — and committing a school is contractual capacity rather than
  a consent anybody gives for themselves. Ruled 2026-09-06.
  For a contact person one write judges either number: their own confirmation, where they type
  their date and
  `fl_backend/app/api/bewerbungen/services.py :: find_alter_refusal` judges it against the floor
  `:: mindestalter_for` answers for the seats that person holds, before anything is written.
  **That confirmation is also the only route by which the date reaches the database**: the
  junction contacts editor accepts no birthdate, refusing the key outright rather than taking a null
  (`docs/backend/spec.md :: I141`, `:: I142`), and a save there carries a date forward only where the
  stored seat holds the same person — the same address and the same name, folded for case and inner
  spacing (`fl_backend/app/api/teams/services.py :: _seat_held_by`). A renamed seat therefore keeps
  nothing of whoever sat in it, a corrected typo costing that person a fresh confirmation because no
  write can tell the two apart. An acceptance copies a seat's date into the season's junction row only
  where that seat's own confirmation stamped it
  (`fl_backend/app/api/teams/services.py :: compose_kontakte_at_entry`), which is what keeps an
  application stored before the confirmation flow from carrying its applicant's answer into a second
  collection. **A stored date no confirmation stamped is therefore judged by nothing**, and clearing
  one is the remedy [`backend/spec.md`](backend/spec.md#3-violation--remedy) carries rather than
  something a write can refuse. The consent vocabulary's `volljaehrig`
  (`fl_backend/app/api/spieler/schemas.py :: FLEinwilligung`, and
  `fl_backend/app/core/constraints.py`) pins no age in code and reads as 18, so reading the enum as
  the rule gets a Trainer's threshold wrong by two years; the two numbers the tree commits to for a
  contact person are
  (`fl_backend/app/shared/schemas/bounds.py :: BEWERBUNG_KONTAKT_MIN_AGE_YEARS`) and
  (`:: VERTRETUNG_MIN_AGE_YEARS`), one per seat in
  `fl_backend/app/api/bewerbungen/services.py :: SEAT_MIN_AGE_YEARS`.
- **A pupil's birthdate is optional until the sign-up flow exists, and required from it.** Ruled
  2026-09-08. The alternative weighed and refused was requiring it now: that means inventing data in
  the one field whose purpose is the age floor, a validator that invalidates every standing pupil
  row until a backfill is run by hand, and an administrator making a date up at every squad entry
  until the flow ships. `fl_backend/app/core/domain.py :: UNENFORCED` carries the standing state and
  names what ends it — the next season's registration, at which the pupil rows standing today are
  dropped ([section 3](#3-the-current-pupil-records-are-reset-once)). **What the field is FOR is checking an age when a
  question about one arises.** On a pupil's own row it gates no read and no publication and nothing
  judges it; the date a pupil types on their confirmation page is judged against the floor before
  anything is written (`fl_backend/app/api/registrierungen/services.py :: find_alter_refusal`),
  which is what the published notice tells a reader. Ruled 2026-09-08.
- **What taking part needs rests on legitimate interest, Art. 6(1)(f), for every participant
  whatever their age, and only publication rests on consent, for the Datenschutzexperte.** I ruled
  so on 2026-09-22 for pupils, referees and contact persons alike; the interest is running the
  competition. The test as I weighed it:
  - **The interest:** a league of named school teams cannot run without knowing who plays, who
    referees and whom a school has put forward — to enter a squad, book a referee, check the age
    floor, reach a team and enforce a ban.
  - **Necessity:** what is collected is that and nothing more — a name, an address the person
    confirms as their own, a birthdate judged against the floor and never published, and the
    contact details a role needs — and every participant's record has an end
    [section 6](#6-retention-is-bounded-where-a-bound-was-chosen) names: an application and a
    registration a clock, a pupil's own row a condition, and a referee's row the deletion an
    administrator or the referee asks for. The one record reaching a participant with no end is the
    delivery state an invite entry keeps of the message that carried its link, past the erasure of
    the contact person it was mailed to, which [section 11](#11-open-and-owed-a-decision) puts to the
    Datenschutzexperte.
  - **Reasonable expectations:** a pupil registers themselves, a referee is entered to officiate
    and confirms it, and a contact person is named by their own school or entered by the league's
    administration, on their team's season row or in an application's seat somebody stepped out of,
    and is told at once by mail through a link of their own that also takes their Widerspruch;
    each expects the league to hold what running the competition takes, a person the
    administration entered reading on their own confirmation page who entered them
    (`docs/backend/spec.md :: I861`).
  - **Safeguards, weighed against most participants being sixteen or seventeen**, which Art.
    6(1)(f) weighs heavier: nothing of a pupil is published on this basis, a pupil's name appearing
    only on their own consent ([section 4](#4-what-is-published-and-on-what-basis)); a referee's
    name on a fixture is published on this basis, and when the referee rows standing today are
    dropped their past fixtures read „anonym“
    ([section 3](#3-the-current-pupil-records-are-reset-once)); no birthdate reaches
    any public read; anyone may object under Art. 21 or have their data erased by a mail; and each
    person is told by the notice and by their own confirmation page what is kept and for how long.

  Contract, Art. 6(1)(b), is the basis refused: a minor may not be able to conclude alone the
  agreement it would rest on, and Art. 8 (3) leaves that to national contract law.

- **Some refusals are taken by the code alone, and the published notice names the two below, with
  what a person can do about each, for the Datenschutzexperte.** I ruled on 2026-09-22 that the
  notice discloses these rather than argue that none of them is a decision under Art. 22, and that
  it offers a human review of each; it does both
  (`DatenschutzView.tsx :: Von dem, was Du auf dieser Website eintragen kannst`,
  `:: Beide Zurückweisungen`). Each is judged before anything is written:
  - a birthdate outside the span a role allows — below its floor, or past the ceiling that catches a
    mistyped century — on the person's own confirmation page, for a pupil
    (`REQ-REGISTRIERUNG-007`), a referee (`REQ-SCHIEDSRICHTER-005`) and a contact person
    (`REQ-BEWERBUNG-012`), so a mistyped date costs nothing and the same link takes the right one
    while it runs;
  - an address the ban list holds, for a registration (`REQ-REGISTRIERUNG-009`), for any of an application's
    three contact persons (`REQ-BEWERBUNG-018`), for a sign-in
    by any route, refused as its session would be created
    (`fl_frontend/src/core/auth.ts :: refuseUnadmitted`), and for the confirmation on a person's own
    page, however long ago its link was mailed (`REQ-REGISTRIERUNG-012`, `REQ-SCHIEDSRICHTER-009`,
    `REQ-BEWERBUNG-020`), the link's page showing that person the refusal and nothing else, so a
    contact person's Widerspruch goes by mail to the address it names
    (`docs/frontend/spec.md :: I516`); the notice's „eine
    E-Mail-Adresse, die gesperrt ist“ names no route, so it covers all four, and the ban's own mail
    tells a person whose address holds an account that the sign-in is barred.

  **Two more refusals are taken by the code alone, and the notice names both with the way through
  each leaves** (`DatenschutzView.tsx :: Zwei weitere Grenzen setzt die Website`):
  - Cloudflare's bot check on the sign-in code request, the application form and the pupil's
    registration form, which refuses a submission carrying no token or one Cloudflare judged against, before
    anything is written or mailed, and asks the person to confirm they are human
    (`fl_frontend/src/core/turnstile.ts :: turnstileRefusal`), a check Cloudflare cannot answer
    letting the submission through (`docs/frontend/spec.md :: I822`);
  - the daily write ceiling, which refuses a signed-in person's counted writes past their
    Funktion's bound until German midnight (`REQ-DROSSELUNG-001`, `docs/backend/spec.md :: I831`)
    and never refuses a withdrawal (`:: I833`).

  The notice offers a person's review of both on request by mail, as the ruling above has it for
  every refusal the code takes alone; whether that ruling reaches these two is not yet confirmed.

  What the review can change is bounded by the rule each refusal applies: a person reads the case
  and answers, a mistyped date is corrected through the same link, an administrator can lift a ban
  (`DELETE /sperrliste/{sperrliste_id}`), and a date truly below a floor stays refused, the league
  giving no role below its floor. A full squad refuses a registration as well
  (`REQ-REGISTRIERUNG-008`), and the notice names it as a limit of the squad rather than a judgement
  about the person. **The notice leaves out the refusals nothing the person enters can meet:**
  - a media consent from someone below its floor, on a pupil's confirmation
    (`REQ-REGISTRIERUNG-010`) and a referee's (`REQ-SCHIEDSRICHTER-008`), reachable only by a request
    the pages never send, the switch showing only from that age
    ([section 4](#4-what-is-published-and-on-what-basis));
  - a Stufe the season does not offer (`REQ-REGISTRIERUNG-003`), which the form's picker never
    lists;
  - the ban refusing a referee's link (`REQ-SCHIEDSRICHTER-007`), which falls on an administrator's
    write rather than on anything the person enters: the administrator sees the refusal and can lift
    the ban, and the ban's own mail tells a barred person whose address holds an account that they
    cannot be entered as a referee (`fl_frontend/src/core/sperrlisteEmail.ts :: EINLEITUNG`), an
    address holding none being mailed nothing;
  - the ban refusing an administrator's correction, reseat or re-send of an application's contact
    seat (`REQ-BEWERBUNG-019`), which falls on that administrator's write in the same way.

  **Five refusals a person's own entry meets are not named among them.** Every box that stores an
  address refuses one whose part before the @ is not plain ASCII
  (`fl_frontend/src/shared/schemas.ts :: KontaktEmailSchema`,
  `fl_backend/app/shared/folding.py :: league_address`). The code sign-in refuses four more:
  - an address that failed ten codes in a row is refused the next, the right one included, until the
    oldest of those failures is a day old or a sign-in clears the count, and the refusal says so and
    offers a passkey (`docs/frontend/spec.md :: I441`);
  - an address that asked for five codes in the hour is mailed no further one that hour, answered as
    a mailed code is (`docs/frontend/spec.md :: I442`);
  - once every address together has been mailed the hour's total of codes, no address is mailed one
    until the oldest of those mails is an hour old, answered the same way: a limit of the service
    rather than a judgement about the person, keeping a flood of codes from spending the mail
    provider's quota that every other message of the league's needs (`docs/frontend/spec.md :: I447`);
  - an address holding neither a grant, nor a record of its own, nor only records awaiting its
    confirmation is mailed no code at all, answered the same way: the gate's `holds-nothing` verdict
    (`fl_frontend/src/core/signInGate.ts :: mayReceiveSignIn`). A record of its own is one its person
    confirmed, whose consent the account page offers back: a contact seat of any season or of a
    pending application, a pupil or referee row retired or not, and a pending registration carrying
    a choice (`fl_backend/app/api/identitaet/services.py :: eigene_eintraege`). So a decided
    application, a declined registration, and an application or registration nobody has confirmed
    admit nobody.

  The last three answer as a mailed code does so that no answer tells a member from a stranger, and
  the person meeting any of them is not told of it.

  The notice's retention table names the two per-address counts and how long each lasts
  (`DatenschutzView.tsx :: FRISTEN`), and none of the five as a refusal. Whether any belongs beside
  the two the notice names is [section 11](#11-open-and-owed-a-decision)'s question.

- **There is no guardian workflow.** No code composes a consent on a guardian's word; a pupil's own
  registration is what records one, and what the vocabulary still expresses beyond that is a
  carried-over record. `erziehungsberechtigt` stays in the stored enum for the rows that already
  carry it (`fl_backend/app/core/constraints.py :: _EINWILLIGUNG_QUELLEN`), and
  `fl_backend/tests/core/test_consent_writers.py` is what holds the value to having no writer.
- **Nothing about a person is published without that person's recorded consent.** Both public reads
  of a pupil decide through `fl_backend/app/api/spieler/services.py :: name_is_public`, which
  publishes a name only where the consent record is present, its `umfang` is `kader_oeffentlich` and
  its `bestaetigt_am` is stamped (`docs/backend/spec.md :: READ-PUPIL-003`); every other row is
  served as a nameless slot keeping its `nummer` and `position`. **The gate fails closed**, so a
  record nobody confirmed withholds the name rather than publishing it — the state
  `fl_backend/app/core/constraints.py :: _EINWILLIGUNG` admits by taking a null `bestaetigt_am`, and
  the one a scope read on its own would publish. The board's full names in the Impressum stand
  outside this rule, published because § 18 (1) MStV and, where it reaches this site, § 5 DDG
  require them (`fl_frontend/src/core/brand.ts :: VORSTAND`, [section 11](#11-open-and-owed-a-decision)).
- **Referees give their own consent record**, on the same terms as a pupil rather than a contact
  person: a referee's name is published on every fixture they officiate, so the record is
  `fl_backend/app/api/spieler/schemas.py :: FLEinwilligung` — the publication scope, the media
  answer beside it, the wording they were shown and the day they answered. Entering a referee mails
  them a one-time link, which lasts fourteen days and can be re-sent; the person enters their own date
  of birth on that page and nobody answers for them. No fixture read consults that record yet: a
  fixture serves the name its own copy of the referee holds whether or not that person has
  answered, and only an erased referee reads as „anonym“
  (`fl_backend/app/api/spiele/services.py :: _composed_schiedsrichter`,
  [section 11](#11-open-and-owed-a-decision)).
- **A referee's email address is required on every write, because an administrator enters the
  referee and the link is how that person learns of it** (Art. 14 (3)); the telephone number stays
  optional (`fl_backend/app/shared/schemas/kontakt.py :: FLKontaktPayload`). Ruled 2026-09-22. The
  referee rows holding no address are given a placeholder under the reserved `.invalid` domain, by a
  step run at the database rather than by any code here, and they keep it until an administrator
  corrects it to the real address or the row is dropped
  ([section 3](#3-the-current-pupil-records-are-reset-once)); no link is ever minted to a
  placeholder, the mint refusing it as no address
  (`fl_backend/app/api/schiedsrichter/services.py :: find_missing_address_refusal`).
- **A confirmed referee's address changes only once the new mailbox confirms it**, because the
  address is what their sign-in and their account page are keyed on: moved at once, it would hand
  their record to whoever holds a mistyped address. Ruled 2026-10-04. The administrator's save keeps
  the address on file in force and holds the new one beside it with a link of its own, which
  confirms the mailbox and asks no consent again, and tells the address on file that a change was
  asked without naming the new one; until its holder answers, the new address reaches
  nothing of the referee's (`docs/backend/spec.md :: I_NEW_KREF_2`). A referee who has not yet
  confirmed holds no record an address could reach, so theirs is still replaced at once and the
  fresh consent link goes to it (`fl_backend/app/api/schiedsrichter/services.py :: save_moves_the_link`).
- **A contact person an administrator enters on a team's season row is mailed a link of their own,
  because that link is how they learn of the entry** (Art. 14 (3)(a)), on the referee's reasoning
  above. Ruled 2026-10-03. The save mints one for each person it newly seats
  (`fl_backend/app/api/teams/services.py :: links_owed`), on a row whose season has ended or whose
  team has left it too, where the link takes the person's Widerspruch and no confirmation
  (`docs/backend/spec.md :: I935`). An administrator re-sends one to any seat
  still unconfirmed while the season runs and the team is in it, a seat entered before the link
  existed included (`fl_backend/app/api/teams/admin_router.py :: einladen_kontakt`). The link lasts the application's
  fourteen days, and on it the person confirms the seat or makes their Widerspruch, which empties it.
  An address the ban list holds is refused rather than seated, as an application's reseat refuses
  one, so nobody is stored whom the league may not tell
  (`fl_backend/app/api/teams/services.py :: find_kontakt_sitz_gesperrt_refusal`); a person barred
  after their seating keeps the seat, and their link takes no confirmation
  (`docs/backend/spec.md :: I505`).

## 3. The current pupil records are reset once

- **The backfilled consents stand until the end of this season.** The pupil rows that were
  backfilled carry a consent nobody was asked for, marked as carried over
  (`bestandsuebernahme`); the rows registered since through the admin form carry the guardian
  consent an administrator composed. The publication gate reads both populations alike
  (`docs/backend/spec.md :: READ-PUPIL-003`): a carried-over record whose `bestaetigt_am` is stamped
  publishes as before, and one with no stamp withholds the name.
  **Datenschutzexperte consulted.** Ruled 2026-08 and re-confirmed
  2026-09-01 and 2026-09-02.
- **At the end of this season, once, every player row is deleted and the action log is reset in
  full.** From the next season on every player signs up through the website, and from then on
  player records are kept and governed by
  [section 6](#6-retention-is-bounded-where-a-bound-was-chosen); the reset is not repeated. Ruled
  2026-09-02.
- **This reset is what reaches the log rows the retention index cannot.** A row carries the date
  stamp the expiry reads only where `fl_backend/app/core/recording.py :: record_write` wrote it, and
  nothing backfills one, so the rows standing before that writer shipped are expired by nothing and
  leave here instead (`docs/backend/spec.md :: I119`). Ruled 2026-09-04.
- **The full reset stays although it takes the contact persons' earlier consent acts with it.** A
  contact seat keeps one act per choice on its own record, the latest with its evidence
  (`fl_backend/app/shared/schemas/einwilligung.py :: FLEinwilligungNachweise`); every act it
  superseded stands only in the log row its write left, so the reset loses those while each seat's
  current proof stands on the seat. The pupils' and referees' earlier acts would be lost all the
  same, their rows going at the moments recorded here. Ruled 2026-10-04.
- **A referee's record is not on this clock, and the referee rows standing today go at a moment of
  their own.** A referee entered through the confirmation link is bound to no season
  ([section 6](#6-retention-is-bounded-where-a-bound-was-chosen)). The rows standing today carry no
  consent record at all and are dropped once, immediately before the deploy whose fixture read
  consults one, rather than at this season's end
  ([`ops/runbooks.md`](ops/runbooks.md#12-deleting-this-seasons-player-records-and-resetting-the-action-log)).

## 4. What is published, and on what basis

- **A club's street address is public and the application form says so** (`READ-ADDRESS-002`).
  **Datenschutzexperte consulted.** Ruled 2026-08.
- **The address sentence stands on the acceptance screen as well as on the application form.** The
  acceptance screen is where the administrator takes the action that publishes it, which
  `docs/backend/spec.md :: WRITE-CLUB-001` states; the
  sentence sits on the arm that creates the club
  (`fl_frontend/src/features/bewerbungen/components/forms/AdminBewerbungAnnehmenSection.tsx`), and
  the admin club forms need none. Ruled 2026-09-01.
- **A pupil's name is published on their own consent (Art. 6(1)(a)), for the Datenschutzexperte**,
  and the published notice lists the squad lists under a withdrawal rather than an objection; the
  gate is `fl_backend/app/api/spieler/services.py :: name_is_public`
  ([section 2](#2-consent-comes-from-the-person-from-16-or-18)). Ruled 2026-09-20. **A pupil gives that
  consent on their own from sixteen**, with no guardian asked; ruled 2026-09-23. What carries it in
  law is open ([section 11](#11-open-and-owed-a-decision)).
- **A photograph, a video or an interview needs a consent of its own, and only a person of eighteen
  or over may give it, for the Datenschutzexperte.** The consent is separate from the name and
  answered as a yes or a no on a pupil's, a referee's and a contact person's confirmation page
  (`fl_backend/app/api/spieler/schemas.py :: FLEinwilligung`, its `medien`); ruled 2026-09-20. I
  ruled on 2026-09-22 that the switch is offered only from eighteen and that nobody younger is ever
  published in media, the supervisory guidance on minors' photographs disagreeing on whether a
  minor's own consent suffices. The confirmation pages and the notice state that bound as no photograph or video
  in which a younger person can be recognised and no interview with one
  (`fl_backend/app/shared/einwilligung.py :: FASSUNGEN`,
  `DatenschutzView.tsx :: Bist Du jünger als`); each confirmation refuses a
  `true` from anyone younger (`fl_backend/app/api/registrierungen/services.py :: find_medien_refusal`,
  `fl_backend/app/api/schiedsrichter/services.py :: find_medien_refusal`,
  `fl_backend/app/api/einwilligung/services.py :: find_selbst_medien_refusal` for a contact person, against
  `fl_backend/app/shared/schemas/bounds.py :: MEDIEN_MIN_AGE_YEARS`). Such media is published on this
  website and on the league's Instagram account; ruled 2026-09-23.
- **The organisers named on the public Organisation page each fully agreed to be listed**, having confirmed
  it to me directly on 2026-09-02. The page carries a forename apiece
  (`fl_frontend/src/features/meta/constants.ts :: TEAM_MEMBERS`), and the board's full names stand
  in the same public source (`fl_frontend/src/core/brand.ts :: VORSTAND`), so removal is a code
  change plus a deploy, and a name stays in the repository's history regardless. The published notice
  says exactly that, as I ruled on 2026-09-22: a withdrawal takes a name off the site and out of the
  current code, and earlier versions stay in the public history
  (`DatenschutzView.tsx :: steht auch im öffentlich einsehbaren Quellcode dieser Website`). The page's source
  carries this record once it leaves here.
- **AI crawlers are both asked and blocked, and the block is the source of truth.**
  `fl_frontend/src/app/robots.ts` disallows named crawlers, which is a request; the edge's
  crawler block enforces it, and that setting lives in the hosting dashboard rather than in this
  repository, which records that it exists and is deliberate.
- **The free-text fields on public pages stay public** — a fixture's note, a withdrawal's reason and
  a club's description — with the input saying so (`READ-FREETEXT-001`, `READ-FREETEXT-002`,
  `READ-FREETEXT-003`).

## 5. Erasure reaches everyone who asks

- **Anyone — player, referee, contact person, administrator — can have their data deleted, with
  the least asymmetry between roles.** The mechanisms today are
  `DELETE /spieler/{spieler_id}/erasure`, `POST /kontakte/erasure` and
  `POST /schiedsrichter/{schiedsrichter_id}/anonymisieren`; the one-off drop of
  [section 3](#3-the-current-pupil-records-are-reset-once) empties the name on every fixture it
  repoints, so it leaves no name with no row behind it. The referee path deletes the document
  and repoints every fixture that named them at the ghost — one permanent row,
  `fl_backend/app/core/sentinels.py :: GHOST_SCHIEDSRICHTER_ID`, that holds no person — so no
  fixture keeps a name, a school or a contact detail, closed seasons' fixtures included, and nothing
  can be written back onto the person: an edit racing the erasure
  meets the deleted row and is refused as not found. Every erased referee's fixtures share that one
  row, so no set of fixtures singles a person out. The ghost itself may not be erased
  (`REQ-ANONYMISE-004`).
- **A referee's erasure also ends their engagement.** Booking a person after they asked to be erased
  creates fresh personal data about them, with no lawful basis standing for it. The ghost is a
  retired row no list serves and no picker names, so `REQ-BOOKING-001` refuses it every new
  fixture; a booking already standing on a fixture still to be played is repointed like the rest and
  surfaces under `GET /spiele/action_required` as a retired booking until somebody assigns a referee
  to it, so one fixture never vetoes a request to be forgotten and the retirement's own refusal
  (`REQ-RETIRE-004`) has nothing left to refuse. A fixture played or called off keeps its booking
  and its own `payment` under the ghost: that is the league's record of the match, not of the
  person. A person who officiates again is entered as a new referee.
- **A referee's pending new address goes with that referee's erasure, and its own holder's request
  is answered by removing it.** Until it confirms, that mailbox owns nothing of the row, so
  its holder is not the person the referee's erasure is about: the link's own decline or
  `DELETE /schiedsrichter/{schiedsrichter_id}/adresswechsel` removes the address and empties every
  image the action log holds of the referee, since every write on the row while the change stood, a
  re-send included, filed one carrying it (`docs/backend/spec.md :: I_NEW_KREF_4`); the referee's own
  earlier images go with them, the price a contact person's Widerspruch already pays.
  `POST /kontakte/erasure` reaches no referee row, a pending address included.
- **An erasure keyed on an email address names what it reaches.** Every seat the address holds is
  its one person's (the entry below), and each is listed for confirmation before the write — by name
  and by the season it sits in, read through `POST /kontakte/erasure/ansicht` rather than inferred on
  the client
  (`fl_frontend/src/features/kontakte/components/forms/AdminKontakteEditForm/FormKontaktReveal.tsx :: FormKontaktReveal`),
  so a name nobody expected shows a mailbox shared against that entry before anything goes. A person
  id across seasons is not introduced: contact persons are season-scoped by design.
- **One address is one person: enforced among pupils, and assumed across the collections.** Every
  record stored under a folded address (`fl_backend/app/shared/folding.py :: sign_in_identifier`) — a
  contact seat, a squad entry, a referee row, a grant — is that one person's, whatever Funktion it
  gives them, and so is the account the sign-in store keys on it
  (`fl_frontend/src/core/emailAddress.ts :: asSignInIdentifier`). No write compares names to refuse
  a second person across the collections: names typed by different people for one person differ, a
  grant carries none, and no index spans them. Among pupils the rule is enforced: `uniq_spieler_email`
  holds one stored person per address, and the admission writes a registration into the person its
  address resolves to rather than beside them, asking the team first where the stored name or
  birthdate differs and showing it no birthdate
  (`fl_backend/app/api/registrierungen/services.py :: find_person_refusal`); a „Nein“ declines the
  registration with the reason that tells the pupil to register again under an address of their
  own. The assumption is made known where an address is typed — the
  registration form and the application's contact seats — and in the published notice
  (`DatenschutzView.tsx :: Deine E-Mail-Adresse steht bei uns für Dich allein`). A mailbox shared
  anyway is one account: whoever reads it signs in, sees and changes every record under it, and an
  erasure keyed on it takes them all. The registration confirmation still opens the returning
  pupil's page — the stored birthdate and consent shown back, no choice asked again — only where the
  name matches as well and that person confirmed their record
  (`fl_backend/app/api/registrierungen/services.py :: seite_of` over `:: persons_named`), the one
  place a shared mailbox would otherwise show one pupil another's answers and leave their own
  consent unasked. Ruled 2026-09-27.
- **An administrator's address is stored as their grant, in plain, and so is the address of
  whoever granted it.** `berechtigungen` holds the grant and `berechtigungen_angekuendigt` what the
  other administrators were told of it, and every administrator is served both addresses. The outbox
  `berechtigungen_postausgang` holds a changed grant's address, and the acting administrator's,
  until a pass has mailed it, and no barred address at all: a ban withholds it in every row still
  queued (`docs/backend/spec.md :: I462`). Each change is mailed to every holder and to the address
  it names, carrying that address and the administrator who made it; a barred address it names by
  its state alone (`docs/frontend/spec.md :: I455`). A revoke removes the grant and its announced row
  at once (`docs/backend/spec.md :: I451`); the log keeps the removed grant's image, the address in
  it, for its twelve months, as it keeps every administrator's write, and no image of an announced or
  outbox row the revoke or a pass removes (`docs/backend/spec.md :: I465`). No erasure route reaches a
  grant: the revoke is the route, and an `owner` grant is made an administrator's first
  (`docs/backend/spec.md :: I436`). **A restore from a snapshot undoes a revoke made after it**: the
  grant comes back with its announced row, so no notice says it stands again, and the address is
  admitted again until the revoke is run once more
  ([`ops/runbooks.md`](ops/runbooks.md#13-after-a-restore-from-a-snapshot)). **The granter's address outlives both**: `erteilt_von` keeps it on
  every grant they made, through their own revoke and their erasure, served to every administrator
  while those grants stand and the ban list does not hold it (`docs/backend/spec.md :: I452`).
- **The administrator's own email on every log row stays, outside every redaction.** The log
  exists to say who did what; the asymmetry is deliberate and is stated at the invariant once it
  leaves here (`docs/backend/spec.md :: I42` is the redaction it sits beside, and `:: I48` what a
  removal records). The stored row keeps it through a ban too; the log's reads serve it withheld
  while the ban list holds it, as every admin read serves an author (`docs/backend/spec.md :: I452`).
- **The erasure of anybody who has signed in includes the sign-in store.** The `auth` database
  holds the address, sessions and sign-in codes of everyone who has signed in — an
  administrator, and a person the send gate offered one (`fl_frontend/src/core/signInGate.ts :: mayReceiveSignIn`) — and the
  passkeys of anyone who set one up. It is inside the erasure, and it is reached by hand:
  `fl_frontend/src/core/auth.ts` is where that store is configured, and
  [`ops/runbooks.md`](ops/runbooks.md#5-when-somebody-asks-for-their-data-or-asks-us-to-change-it)
  is what names it as the place a signed-in person's own data sits and gives the step that erases it
  there. Its collections are `user`,
  `session`, `account`, `verification` and `passkey`. The last holds a credential's public key, its
  identifier, the counters the browser reports, when it was set up, when it last signed its holder in
  (`fl_frontend/src/core/passkeyLastUse.ts`) and any name its holder gives it on the account page
  (`fl_frontend/src/features/passkeys/actions.ts :: renamePasskeyAction`), and never a secret the person holds, the private
  key staying on their own device. The library also stores what the browser reported of the
  authenticator: the identifier of its model, which the account page turns into its maker's name
  (`fl_frontend/src/features/passkeys/bestand.ts :: passkeyNamenOf`), whether the credential is
  bound to one device or synced, whether it is backed up, and the ways the browser can reach it. A
  `session` row holds the account it belongs to, when it was made, its own
  expiry, which factor made it and, where a passkey did, that passkey's credential identifier,
  where it replaced a session the browser held a keyed digest of that session's cookie
  (`fl_frontend/src/core/auth.ts :: lineageOf`), and neither the address nor the browser the sign-in
  came from. It also records when it was last used, to within the interval a session waits before
  its row is refreshed (`fl_frontend/src/core/auth.ts :: SESSION_UPDATE_AGE_SECONDS`), and the
  account page shows that as „Zuletzt aktiv“ beside each sign-in
  (`fl_frontend/src/features/konto/sicherheit.ts`). A `user` row's `updatedAt` records when that account last changed or last
  had a passkey removed (`fl_frontend/src/core/auth.ts :: claimAccount`), and where a ban
  ended the account's sessions, the row keeps when it did (`fl_frontend/src/core/auth.ts :: endSessionsOfAddress`), so that no session made before it
  is served again once the ban is lifted. **A session and a sign-in code each carry an expiry set at that
  configuration, and the expiry bounds the credential rather than the row**: the library drops a
  session row when its holder presents the stale cookie and leaves it standing where nobody comes
  back, and it consumes a code's row when the code is typed, live or expired, sweeping expired
  `verification` rows only when it next reads one. Per typed address it also keeps rows counting
  failed codes for a day and requested codes for an hour, under a keyed hash of the address rather
  than the address (`fl_frontend/src/core/auth.ts :: boundIdentifier`); both are counted ahead of the
  send gate, so a stranger's address is counted as a member's is. One more row per code mailed counts
  every address together for an hour, and carries no address and no hash of one. What deletes a
  row of either collection at its expiry is an index the frontend builds at every production boot
  ([`ops/runbooks.md`](ops/runbooks.md#14-the-auth-databases-indexes)).
- **The sign-in store holds more than the people it signs in.** The sign-in send is public and the
  library writes its `verification` row before the send gate is consulted, so the address of anyone
  who submits the form is held there — a person the gate admits and a stranger alike — until that
  retention index removes it
  ([`ops/runbooks.md`](ops/runbooks.md#14-the-auth-databases-indexes)). Such a
  person's typed address also leaves the keyed rows of the entry above, a count of the codes it
  asked for and, where a code was typed, of the codes that failed. No `user` row is written until a
  code is typed right, and a code is mailed only to an administrator or to an address the league
  holds records for (`fl_frontend/src/core/signInGate.ts :: mayReceiveSignIn`). A passkey ceremony
  writes a `verification` row as well, for five minutes, on every view of the sign-in page and on
  every step-up: it holds the challenge and, where the visitor is already signed in, the id of their
  account, and nothing about a visitor who is not.
- **A person's own write is recorded under a pseudonym rather than their address.** An address in
  `actor.email` would sit outside the redaction above, an exception taken for administrators and
  for the reason administrators give, so a person's actor carries none: the binder every router of
  `fl_backend/app/main.py :: PERSON_ROUTERS` declares
  (`fl_backend/app/core/security.py :: person_actor_binder`) records a stable pseudonym, a keyed hash
  of the folded address as the ban list takes one, and the kind of person the write was made as,
  and the log refuses a person's row carrying an address (`docs/backend/spec.md :: I384`). Ruled
  2026-09-21. **No erasure reaches the pseudonym yet**: an erasure empties the images of the rows
  naming the documents it removes (`docs/backend/spec.md :: I42`), while every row the person wrote
  keeps their pseudonym until it expires twelve months after the write (`:: I119`), and this
  controller holds the key that recomputes it from the address.
- **A signed-in person's writes are counted per day under the same pseudonym, and the count
  outlives an erasure until that day ends.** The daily write ceiling
  (`docs/glossary.md :: Drosselung`) keeps one row per Funktion, pseudonym and German day, holding a number and no
  address, so that one stolen or misused seat cannot write without bound; the TTL index removes it
  at that day's German midnight, plus the monitor's lag, and no erasure reaches it before then
  (`docs/backend/spec.md :: I837`). **The ceiling's first refusal of a day also leaves one line in
  the application log**, naming the Funktion and the pseudonym's prefix the action-log page shows,
  never an address (`fl_backend/app/core/drosselung.py :: get_drossel`,
  `docs/backend/spec.md :: I835`). That line is kept as every application-log line is, by size while
  the container runs and for thirty days in the copy each deploy takes
  ([section 6](#6-retention-is-bounded-where-a-bound-was-chosen)), and no erasure reaches it; an
  administrator can match the prefix to the person's rows on the log page.
- **Backups outlive an erasure by the snapshot window, and the person is told so.** The hosting
  keeps snapshots for about eight days, taken daily — a figure mirrored from the provider's own
  console, which moves without us, as it stood on 2026-09-01. An erased person is gone from the live
  database at once and from backups within that window, and that sentence is what a requester
  receives, from the published notice and from the runbook alike
  (`DatenschutzView.tsx :: Was eine Löschung erreicht und was nicht`). No replay of erasures after
  a restore is built, so a restore is followed by running each of them again by hand
  ([`ops/runbooks.md`](ops/runbooks.md#13-after-a-restore-from-a-snapshot)).
- **One record outlives an erasure, and it is a record about two people.** An address barred from
  signing up is stored as an HMAC under a key this controller holds, beside the administrator's
  reason, their own address and the day (`docs/glossary.md :: Sperrliste`). The BARRED address is in
  no field and derivable from no row without that key, so the row is neither that person's own
  document to delete nor a shell of nulls left where one stood, which is why it survives a request
  that reaches everything else (`docs/backend/spec.md :: I268`). **The row is pseudonymised personal
  data rather than none** — this controller holds the key that re-identifies it — and two people are
  in it past their own erasure: the person barred, whom the free-text reason may name outright, and
  the administrator, whose own address stands in `erstellt_von` in plain. The basis for keeping
  either is what [section 11](#11-open-and-owed-a-decision) asks the Datenschutzexperte to confirm.
  **It is bounded by the league's own calendar** and removed without anybody asking at the season
  activation [section 6](#6-retention-is-bounded-where-a-bound-was-chosen) names; an administrator
  may lift it earlier. **Either removal keeps a copy in the action log** — the hash, the key label,
  the reason, the administrator and the season it ran to, and no barred address — for the twelve
  months every stamped log row is kept (`docs/backend/spec.md :: I48`, `:: I119`), so a removed ban
  is readable at `/bereich/admin/aktionen` for that period and enforced by nothing from the moment it goes.
- **A retired row is never removed because of its age.** A player who left a squad, a referee who
  stopped, a club that left and a past season all keep their rows; a person's row goes only by an
  erasure or by one of the two one-off removals [section 3](#3-the-current-pupil-records-are-reset-once)
  records, this season's player reset and the drop of the referee rows standing today, and
  self-service for requesting an erasure comes with the account tiers. The
  Known-open row `docs/backend/spec.md :: Nothing purges a retired row` carries this today, naming
  `fl_backend/app/core/domain.py :: UNENFORCED` and `docs/backend/spec.md :: I12`, which holds the
  erasure's own refusal code. An application is not a retired row and does not take this rule: its
  clocks are [section 6](#6-retention-is-bounded-where-a-bound-was-chosen)'s. **Datenschutzexperte
  consulted.** Ruled 2026-08 and re-confirmed 2026-09-02. For a referee I ruled on 2026-09-22 that
  the row is kept until it is deleted, by an administrator's decision or at the referee's own
  request, and by nothing else; outside that one-off drop the referee's erasure above is the one
  route that deletes it, the retirement an administrator can also take keeping the row.

## 6. Retention is bounded where a bound was chosen

- **The log keeps storing the full prior document on every write, person-bearing rows included.**
  That copy is what a restore over the log replays, which is the log's purpose, and the
  twelve-month bound `docs/backend/spec.md :: I119` states is what answers the accumulation. Dropping the copies would remove the
  log's value exactly where writes matter most. A person who asks for erasure still has their log
  rows emptied and stamped inside the transaction that removes them
  (`docs/backend/spec.md :: I42`); what the bound answers is the copies of everyone who never
  asked. The database applies it rather than a sweep in this codebase
  (`fl_backend/app/core/constraints.py :: TTL_INDEXES`), and it reaches a stamped row alone
  ([section 3](#3-the-current-pupil-records-are-reset-once)). Ruled 2026-09-02.
- **An undecided application one of whose contact persons has not confirmed is deleted once its
  confirmation window has run out, those three people's contact details included, and the erasure is
  announced to the Ansprechperson first where that slot still holds one**
  (`docs/backend/spec.md :: I151`). The window is fourteen days
  (`fl_backend/app/shared/schemas/bounds.py :: BEWERBUNG_BESTAETIGUNG_FRIST_TAGE`) from the day the
  links were sent (`fl_backend/app/api/bewerbungen/services.py :: bestaetigungsfrist_from`); an
  administrator's re-send replaces a link and restarts the period for the whole application
  (`:: compose_erneut_update`), while the reminder adds a link and moves nothing
  (`:: compose_erinnerung_update`), so the period runs from the last replacement rather than from
  the submission. This is the period the published notice shows a visitor
  (`DatenschutzView.tsx :: FRISTEN`), and nothing compares that table with this section: every
  figure in it mirrors a clock this page records, read from its constant where the notice
  interpolates one and checked by hand where it does not, apart from the sign-in row's, which are the
  sign-in library's settings (`fl_frontend/src/core/auth.ts`). **An application whose deletion notice the
  provider refuses is held past that window rather than erased** (`docs/backend/spec.md :: I196`):
  the provider accepts a send to a suppressed address and skips it, so erasing on a stamp saying
  the notice went out is erasing somebody who was told nothing. It stands until an administrator
  enters a reachable address or decides the application, and in neither case past the end of the
  season it applied for. Ruled 2026-09-08.
- **A registration is bounded at each of its four ends, and a pupil's own confirmation is what
  starts the longest of them.** The confirmation writes the birthdate and the whole consent record
  in one update (`fl_backend/app/api/registrierungen/services.py :: compose_confirmation_update`), so
  no row ever holds a birthdate nobody consented to the league keeping. Ruled 2026-09-11.
  - **Unconfirmed, it is deleted the day after its stored `frist`**, the pupil's name, address and
    every answer on it included, with no message either way: the confirmation mail named the day,
    and the address is one the league could not confirm. The window is seven days
    (`fl_backend/app/shared/schemas/bounds.py :: REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE`) from the day
    the link was sent, stored on the row at the mint rather than derived, so raising the bound never
    moves the deadline of a link already in somebody's inbox
    (`fl_backend/app/api/registrierungen/services.py :: compose_bestaetigung`). It is shorter than an
    application's fourteen because it is also the window inside which a mistyped address is
    discovered, the only route back being to register again, no administrator being able to edit a
    stored address. One reminder goes out inside it and moves nothing (`:: compose_erinnerung_update`),
    and none goes to an address the mail provider has already refused.
  - **Confirmed but undecided, it is deleted once the season it was made for has ended**, whatever
    the pupil answered (`:: undecided_erasure_is_due`), and a pupil who confirmed is told afterwards
    that it happened and why — never before it, a notice being unable to prolong a row nobody
    decided.
  - **Declined, it goes one calendar month after the decision** (`:: decline_erasure_is_due`), and
    the decision it keeps until then names the seat holder who declined it by their address
    (`entscheidung.von`, written by `:: compose_ablehnung_update`), which every administrator is
    served beside the date and the reason while the ban list does not hold it
    (`:: mit_vorenthaltener_entscheidung`, `docs/backend/spec.md :: I452`).
  - **Admitted, it is deleted at once**, in the admission's own transaction, its values in the log
    redacted with it: its name, birthdate and consent record became the person and its squad
    details the squad row, and only its submission key and the digest taken over what was
    submitted, its address included, move on, onto that squad row, so a replay is still answered
    as one (`docs/backend/spec.md :: I349`,
    `fl_backend/app/api/registrierungen/services.py :: compose_kader_fields`); both go with the squad row,
    which the person's erasure removes.
- **An application still awaiting a decision when the season it applied for has ended is deleted,
  those three people's contact details and every birthdate on it included, whatever its contact
  persons answered and whether or not its deletion notice could be delivered.** The sweep reads the
  season's own `status` rather than counting a period from a day
  (`fl_backend/app/api/bewerbungen/services.py :: undecided_erasure_is_due`), so an application is
  kept exactly as long as a decision could still be taken. This is the bound for every
  application the fourteen-day clock above leaves standing: one every contact person confirmed and
  nobody judged, one whose window no stored deadline bounds, and one held because the notice was
  refused. The confirmation page states the period to the person whose details they are
  (`fl_backend/app/shared/einwilligung.py :: FASSUNGEN`), and the published notice
  tabulates it (`DatenschutzView.tsx :: FRISTEN`). Ruled 2026-09-09.
- **A pupil's own row is bounded by a condition and never by a clock.** It stands while a squad row
  references it, and what ends it is the person's erasure, the one-off reset of
  [section 3](#3-the-current-pupil-records-are-reset-once), or the recurring deletion the next
  programme builds — which is released by a condition too, the next season active and its
  registration window closed, and which selects a person no squad row references. **An erasure
  deletes the document outright** rather than nulling its fields
  (`docs/backend/spec.md :: I12`), so the row either stands whole or is gone and there is no third
  state to write a clock for.
- **A registration link stops working when the season's registration window shuts or the season
  ends, or the moment an administrator withdraws it or replaces it with a new one; the entry
  recording it is kept without a clock.** The link carries no date of its own: what decides whether
  it opens anything is the season's window and its status, judged afresh at every use
  (`fl_backend/app/api/registrierungen/services.py :: saison_nimmt_registrierungen_an`), so a window
  moved after the link was minted moves the link with it. The entry names a team and a season and no
  SUBJECT — an unkeyed hash of the link value, which yields the link itself to nobody, the day it
  was minted, and the administrator who minted it, whose address is held in plain and outlives any
  erasure as the ban list's does. **Nothing deletes one**: no erasure reaches it, no clock removes
  it, and a replaced entry is kept precisely so a delivery event about the message that carried its
  link still has somewhere to land (`docs/glossary.md :: Einladung`). The published notice says the
  same — the link ends, the entry stays (`DatenschutzView.tsx :: FRISTEN`). Ruled 2026-09-21.
- **A referee's confirmation record and link go with the referee's row, which is bound to no season
  and stands until an administrator deletes it or the referee has it deleted**
  ([section 5](#5-erasure-reaches-everyone-who-asks)). The link lasts fourteen days
  (`fl_backend/app/shared/schemas/bounds.py :: SCHIEDSRICHTER_BESTAETIGUNG_FRIST_TAGE`), and each
  new one replaces the whole block, the delivery state of the message the old link went out in
  included (`fl_backend/app/api/schiedsrichter/services.py :: compose_mint_update`).
- **A confirmed referee's pending new address stands until its holder confirms or declines it, an
  administrator replaces or discards it, or the referee is erased with it, and once its link has
  lapsed the yearly deletion removes it** (`fl_backend/app/core/domain.py :: FIELD_POLICIES`): the
  address may be a stranger's, typed in by mistake, who never asked to be stored. Its link lasts
  the confirmation link's fourteen days and a re-send restarts them
  (`fl_backend/app/api/schiedsrichter/services.py :: compose_adresswechsel`). The yearly deletion is
  not built yet, so until it is a lapsed change stands, marked as lapsed to the administrator, who
  can discard it; the published notice already states the removal
  (`DatenschutzView.tsx :: FRISTEN`). Ruled 2026-10-06.
- **A ban on an email address is kept for five full seasons after the one it was entered under, and
  the person it bars is told so at the moment it is entered where the address holds an account; an
  address holding none is mailed nothing** (`docs/frontend/spec.md :: I517`). Ruled 2026-09-27.
  While the ban stands the application sends the address nothing else, that notice being the one
  message its mailer sends without asking the ban list (`docs/frontend/spec.md :: I541`); the league's confirmations to a
  barred address, below, are written by hand. The row records the last season it
  covers and the activation of the season after that removes it
  (`docs/backend/spec.md :: I273`); nothing is counted in days, the bound being the thing the
  ban exists for — somebody too young for the league stays barred until they are too old for it. The
  message sent at the ban names that season, the reason, what is kept and how to object
  (`fl_frontend/src/core/sperrlisteEmail.ts`); the typed address is used for that one send and for
  ending the address's live sign-ins, and the ban's row keeps only a check value of it, so
  no second message can ever be sent about the row. Ruled 2026-09-21. **The account the address
  signs in to keeps it**, frozen until the ban ends, and the message and the notice both say so; a
  copy or a deletion of that person's data is asked for by mail to the league's contact address,
  and the league confirms the request by a mail to the barred address, which cannot sign in to ask.
  Ruled 2026-09-27.
- **A grant of access to the Verwaltung is kept until it is revoked, and the notice of a change to one
  only until it is sent.** A revoke removes the grant and the announced record of it in one
  transaction (`fl_backend/app/api/berechtigungen/admin_router.py :: delete_berechtigung`), and the
  pass that mails a change removes its outbox row once it is sent or given up
  (`fl_backend/app/api/berechtigungen/sweep_router.py :: post_berechtigungen_angekuendigt`,
  `docs/backend/spec.md :: I480`). The announced record and the outbox row leave no image in the log
  (`docs/backend/spec.md :: I465`), while a revoked grant keeps its own under the log's twelve
  months. The published notice tabulates it (`DatenschutzView.tsx :: FRISTEN`). Ruled 2026-09-28.
- **No open tracking and no click tracking is subscribed, and none is read.** The mail provider
  reports what became of a message's DELIVERY and nothing about what its recipient did with it: the
  six delivery events are subscribed and `email.opened` and `email.clicked` are not
  ([`ops/runbooks.md`](ops/runbooks.md#10-the-mail-providers-dashboard) holds the dashboard's own
  half of that). A delivery state is stored beside the record its message was
  sent about and goes with that record: an application's is erased with the application, a
  registration's with the registration at whichever of its clocks takes it, a referee's with
  their row on request or with the link a re-send replaces, and a season contact person's with
  their seat's link, which a re-send replaces and an erasure, the row's clearing or replacement and
  the season-and-one clock below each remove. **A Widerspruch empties the seat and keeps its link
  entry, the delivery state of the message included**, on an application until the application goes
  and on a team's season row until a save fills that seat again or the row is cleared or replaced
  (`fl_backend/app/api/teams/services.py :: compose_bestaetigungen_nach`), because that entry is what lets
  the page answer a second press as already declined
  (`fl_backend/app/api/bewerbungen/services.py :: compose_decline_update`,
  `:: compose_saison_decline_update`); it names no address, and nothing reaches it on the person's
  erasure, their slot holding nobody by then. An invite's stays on the invite entry,
  which nothing deletes (above), past the erasure of the contact person it was mailed to
  ([section 11](#11-open-and-owed-a-decision))
  (`docs/glossary.md :: Zustellstand`, `fl_backend/app/api/zustellung/services.py :: ZIEL_PFADE`).
  **No delivery state has a clock of its own**, so none outlives the record it hangs on and none is
  kept for its own sake. Ruled 2026-09-08.
- **A declined application is kept for one month after the decision, its three people's contact
  details included, then deleted. An accepted application is kept for the season it was accepted
  for and the season after it, then deleted.** The retention sweep runs both clocks
  (`docs/backend/spec.md :: I153` and `:: I154`), the confirmation page states both periods to the
  person whose details they are (`fl_backend/app/shared/einwilligung.py :: FASSUNGEN`),
  and the published notice tabulates them (`DatenschutzView.tsx :: FRISTEN`). This bounds the
  permanent record that `docs/glossary.md :: Bewerbung`
  and `docs/backend/spec.md :: READ-CONTACT-001` describe. Ruled 2026-09-02.
- **A season's contact persons follow the accepted application's clock**: their contact block is
  cleared when the season after the one they were collected for ends, and the confirmation links
  beside it with it (`fl_backend/app/api/bewerbungen/sweep_router.py :: sweep_saison`). The consent text scopes
  itself to one season, and the clearing uses the mechanism the erasure already had. Ruled
  2026-09-02.
- **A timer in the frontend process is what turns those clocks from an intention into a mechanism**
  (`fl_frontend/src/features/bewerbungen/sweep.ts :: armBewerbungSweep`, calling
  `fl_backend/app/api/bewerbungen/sweep_router.py :: sweep_saison` and
  `fl_backend/app/api/registrierungen/sweep_router.py :: sweep_registrierungen` per season). A pass
  that reminds nobody and deletes nothing records the day it ran exactly as a busy one does, and
  `GET /bewerbungen/sweep` answers the day each half last ran (`docs/backend/spec.md :: I189`), so a
  claim that a period was honoured rests on a date rather than on reading the data.
- **Access logs stay on the host and are kept for at most eight days. The application logs are
  bounded by size while they run, and by thirty days as the copy each deploy makes.** The access
  log is a file on the host rather than a stream inside the nginx container — it carries the
  visitor's address, user agent and referer, and it survives a deploy — and its eight days are an
  age bound rather than one traffic volume sets, which a size rotation is: under a size bound alone
  a quiet month would keep addresses far longer than a busy one. **The edge's error log is a host
  file beside it under the same rotation**, every line of it about a request naming the visitor's
  address too, and nothing the edge writes to its container's own size-bounded stream names one
  (`docs/ops/spec.md :: I352`). The published notice tells a visitor that a failed request leaves
  such an entry under the same eight days
  (`fl_frontend/src/features/meta/components/views/DatenschutzView.tsx`); ruled 2026-09-24. The
  application logs keep the container runtime's size rotation as their only live bound
  (`docs/logging/spec.md :: 1.2`), because the only way to rotate a file the runtime holds open
  loses lines, and the thirty days reach the copy the deploy takes of each stream before replacing
  its container (`scripts/ops/deploy.sh :: LOG_DIR`). The host files enforcing both figures are
  installed by hand in the same deployment that publishes them
  ([`ops/runbooks.md`](ops/runbooks.md) §7). The
  eight is the backup window an erased person is told about
  ([section 5](#5-erasure-reaches-everyone-who-asks)), which lets one figure answer both the
  access-log question and the erasure question. Nothing is shipped to a collector: that would
  lengthen retention and add a processor receiving visitors' addresses. That the access line carries
  no credential is a separate guarantee, held by `nginx/edge_test.sh` in the gate's ops scope.
  Ruled 2026-09-06, re-ruled 2026-09-07.

## 7. Processors and third parties

Every row mirrors that provider's own legal pages, which move without us and were read on
2026-09-02 — **except the host's row and the Atlas deployment region, which mirror the published
notice's own recipient list** (`DatenschutzView.tsx :: EMPFAENGER`), what a person asking for access
is answered from. No reading of the host's own pages stands behind its row. The Instagram row mirrors
the Framework list alone, read on 2026-09-22; no reading of Meta's own terms stands behind it. The
WhatsApp row's last cell mirrors WhatsApp's privacy policy for the European region and the
Framework list, both read on 2026-09-22.

| Processor                        | What reaches them                                                                                                                                                                                                                                                    | Agreement                                                                                                                                                                                                                                                                                      | Where the data is                                                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Hetzner Online (the host)        | Everything on the server or reaching it, the access log included                                                                                                                                                                                                     | An Art. 28 agreement, as the notice states                                                                                                                                                                                                                                                     | Nuremberg, Germany                                                                                                       |
| Resend                           | Every address the league mails, and every message in full with the tags that file a delivery event against its record (`fl_frontend/src/core/mail.ts :: sendMail`); a confirmation or registration link, and a sign-in code, is a credential                         | Standard Art. 28 addendum, in force for every account on sign-up; an executed copy is downloadable                                                                                                                                                                                             | United States for all stored data; the EU region changes only where mail is dispatched from; transfer rests on the SCCs  |
| Cloudflare                       | Every request in plaintext at the edge: addresses, URLs, headers, form bodies; and, from the Turnstile frame on the sign-in page, the application form and the pupil's registration form, the visitor's IP address, TLS fingerprint, User-Agent, site key and origin | Standard addendum incorporated by reference into the self-serve agreement; for the Turnstile signals, Cloudflare's Turnstile addendum makes it a processor for the check and a controller of the same signals for improving its own bot detection ([section 11](#11-open-and-owed-a-decision)) | Edge processing worldwide; content not stored for the core services; region pinning is an enterprise-only add-on         |
| MongoDB Atlas                    | Both databases and their backup snapshots                                                                                                                                                                                                                            | Standard addendum incorporated into the cloud terms, accepted by creating the account                                                                                                                                                                                                          | Frankfurt am Main; single-region snapshots stay in the cluster's region                                                  |
| Proton (the league's mailbox)    | Every request and reply, correspondence with referees, contacts and applicants                                                                                                                                                                                       | **None on the personal plan in use.** Proton for Business carries one; the upgrade is the fix                                                                                                                                                                                                  | Switzerland                                                                                                              |
| Gmail, via members' forwarding   | Whatever league mail a member opens in a personal Gmail account                                                                                                                                                                                                      | **None — a consumer Gmail account has no processing agreement.** Accepted for now, as a known gap                                                                                                                                                                                              | Not committed                                                                                                            |
| WhatsApp (consumer app)          | Phone numbers and messages of the people the league writes to there one by one, and of anyone who writes to it that way                                                                                                                                              | **None for the consumer app**; the consent text discloses the channel. Accepted for now, as a known gap                                                                                                                                                                                        | Ireland (WhatsApp Ireland Limited), with its onward transfer to the United States on the Framework                       |
| Instagram (the league's account) | The photographs, videos and interviews the league publishes on its account, each on the pictured person's own consent from eighteen                                                                                                                                  | **None**; Meta runs the platform under its own terms as a controller of its own; whether the league shares control of anything is open ([section 11](#11-open-and-owed-a-decision))                                                                                                            | Not committed; Meta Platforms, Inc. in the United States stands on the Framework list, its re-certification under review |

**Nothing is left to sign for Resend, Cloudflare and MongoDB Atlas.** Ruled 2026-09-02. What is
owed:

- Keep the dated agreement pages, and Resend's executed copy with the account's acceptance date.
- Record Resend's United States storage as a transfer.
- Hold the host's agreement to the same standard as those three, so the row above rests on the
  document rather than on the notice quoting it.
- Leave the gaps in bold accepted, and named so the notice can tell the truth about them.
- Refuse WhatsApp the contacts permission on every phone used for league messages, so no member's
  address book reaches it.

**WhatsApp is not a league channel.** I ruled on 2026-09-22 that the league writes there only to
single people who chose to give their number for it, that it is never required, and that e-mail
always stands beside it; a supervisory authority's warning about the app's upload of a user's
address book is what the last owed step above answers.

**The transfer mechanisms, read again on 2026-09-22.** Cloudflare, Plus Five Five, Inc. (the company
contracting as Resend), MongoDB, Google, WhatsApp's United States parents and Meta Platforms, Inc., Instagram's, each
stand on the EU-US Data Privacy Framework list. Cloudflare's agreement makes the Framework its
transfer mechanism and the Commission's standard clauses the fallback, and Resend's names both.
These mirror the providers' own pages as read that day, which move without us.

## 9. A local copy of production expires

- **A local copy of production refuses to be reused after seven days.** `./scripts/ops/local.sh --seed`
  fills the local stack from a production dump (`scripts/ops/local.sh :: take_dump`), and the copy is
  whole. The disk is encrypted and one person holds the connection string; the bound is what
  stops cleanup depending on memory. Today the copy is reused at any age, the marker file being the
  whole of the reuse test (`scripts/ops/local.sh :: fetch_copy`,
  `docs/ops/spec.md :: 1.5`); this ruling narrows that.

## 10. Adjacent decisions were accepted as recommended

Roadmap items that needed no expert, each accepted on 2026-09-02 as the entry then recommended.
Where an entry is still open, what is left to do is its own `Status` in
[`_roadmap/items.md`](_roadmap/items.md); a closed one's row cites where the decision now lives, and
the `Entry` column carries a token only where one still resolves in that file.

| Entry | Decision                                                                                                                                                                                                            |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —     | Narrow the refusal's sentence to the window in which the undraw it recommends is possible ([`logging/error-codes.md`](logging/error-codes.md#1-backend-codes) on `REQ-RULES-011`)                                   |
| —     | The player editor shows the stored consent, read-only; it never gates publication (`fl_frontend/src/features/spieler/components/forms/AdminSpielerEditForm/FormEinwilligungSection.tsx :: FormEinwilligungSection`) |
| —     | The toast clause's first half is [`frontend/spec.md`](frontend/spec.md) I57's; its second half stands in `.claude/rules/frontend.md`                                                                                |
| —     | Announcing that a season rollover is due stays deferred until one is actually missed ([`ops/spec.md`](ops/spec.md#4-known-open))                                                                                    |
| —     | Authenticated origin pulls are the cheapest real fix; a tunnel is the strongest, and the tunnel is what runs ([`ops/spec.md`](ops/spec.md#18-the-edges-declared-state))                                             |

## 11. Open, and owed a decision

- **No Datenschutzexperte reviews the questions below.** Since 2026-09-21 I decide the legal
  questions myself, and on 2026-09-22 I waived the review
  the rulings above were waiting on. A ruling above marked **for the Datenschutzexperte** is a legal
  characterisation I have decided; that mark stays, as the marks on the entries below do, so a later
  review starts from them. Until I decide an entry, the published notice and the request and breach
  procedures in [`ops/runbooks.md`](ops/runbooks.md) stand as they are.
- **Cloudflare's own record of each request is bounded by Cloudflare rather than by any setting of
  mine, and the host's `logrotate` file is a hand step the deploy cannot verify.**
  [Section 6](#6-retention-is-bounded-where-a-bound-was-chosen) is meant to reach the edge log
  (`docs/logging/spec.md :: Cloudflare logs the request line at its own edge`) as well as the
  host's. Below the Enterprise plan no setting reaches the edge's: raw request logs are neither
  exposed nor configurable there, the dashboard's own datasets keep a fixed period per plan, and
  Cloudflare's privacy policy gives criteria rather than a period — Cloudflare's pages as read on
  2026-09-22, which move without us. Which plan this zone is on is recorded nowhere in this
  repository. The host's bound is a file outside it ([`ops/runbooks.md`](ops/runbooks.md) §7), so a
  claim that it was honoured rests on reading the host rather than on a report.
- **The ban list's surviving row is kept about two people past their own erasure, for the
  Datenschutzexperte**: the person barred, pseudonymised and possibly named by the reason, and the
  entering administrator in plain ([section 5](#5-erasure-reaches-everyone-who-asks)). The basis
  for keeping any of it is legitimate interest in refusing a re-registration the league has already
  declined — a refusal the ban's own create, the public registration, every referee write that
  mints a confirmation link and every confirmation press perform
  ([`backend/spec.md`](backend/spec.md#11-endpoint-inventory)).
  One question to put: what an access request reaches, given that no route finds the row from the
  address it was taken from while the reason beside it may name its subject outright. The bound is
  [section 6](#6-retention-is-bounded-where-a-bound-was-chosen)'s, and the procedure for the lookup
  is [`ops/runbooks.md`](ops/runbooks.md#5-when-somebody-asks-for-their-data-or-asks-us-to-change-it)'s.
- **A referee's withdrawal changes no fixture page until the fixture read joins the record, for the
  Datenschutzexperte.** A pupil and a referee each move their own record on the account page
  (`fl_backend/app/api/spieler/selbst_router.py :: patch_einwilligung`,
  `fl_backend/app/api/schiedsrichter/person_router.py :: patch_einwilligung`), and a pupil's squad
  lists read the record they move; the fixture list still serves the name its own copy of the
  referee holds. The question to put is whether that gap, until the fixture read joins the record,
  needs the e-mail route kept open for referees meanwhile.
- **The Ansprechperson's and the Stellvertretung's eighteen as contractual capacity rather than a
  consent, for the Datenschutzexperte.** [Section 2](#2-consent-comes-from-the-person-from-16-or-18)
  argues it, and `fl_backend/app/api/bewerbungen/services.py :: SEAT_MIN_AGE_YEARS` performs it. The
  question to put: whether signing for a school is contractual capacity at all, and so whether
  eighteen is the floor it asks.
- **Whether a refusal the code takes alone is a decision under Art. 22, for the
  Datenschutzexperte.** [Section 2](#2-consent-comes-from-the-person-from-16-or-18) records the
  disclosure and the human review I ruled, and leaves the threshold aside. The review Art. 22 (3)
  names is a safeguard for the exceptions of Art. 22 (2)(a) and (c), a contract and explicit consent,
  and contract is the basis section 2 refuses: if a refusal meets Art. 22 (1), no exception is shown
  for it, and a review on request does not lift the prohibition. The Article 29 Working Party's
  guidance on automated decisions (WP251 rev.01), which the EDPB endorsed, reaches only a legal effect
  or one similarly serious, its nearest example being a decision affecting access to education, such
  as a university admission, and does not say whether being refused a place in a school league is one
  — read on 2026-09-22. The questions to put: whether any of those refusals meets Art. 22 (1)'s
  threshold, Cloudflare's bot check and the daily write ceiling among them, and if one does, which
  exception of Art. 22 (2) it rests on.
- **An address whose part before the @ is not plain ASCII is refused with nobody deciding, and the
  published notice does not name it, for the Datenschutzexperte.** Every box that stores an address
  refuses one ([section 2](#2-consent-comes-from-the-person-from-16-or-18)), so a person whose only
  mailbox is spelled that way cannot register, apply or be entered under it, and the box asks them
  for another address, while the notice names two refusals, a birthdate outside its span and a
  barred address, and beside them the full squad as a limit of the squad, and the bot check and the
  daily write ceiling as limits it offers a person's review of ([section 2](#2-consent-comes-from-the-person-from-16-or-18)). The questions to put: whether this
  refusal is a limit of what the league can take, as the full squad is, or a judgement about the
  person; and so whether the notice names it beside the full squad or among the refusals it offers
  a review of.
- **The code sign-in's four refusals are named by the notice as counts or not at all, for the
  Datenschutzexperte.** [Section 2](#2-consent-comes-from-the-person-from-16-or-18) lists them: the
  lock after ten failed codes in a row, the five codes an address may ask for in an hour, the hour's
  total across every address, and the gate mailing no code to an address that holds nothing. A
  passkey signs in past the first three, and the last three are not told to the person who meets
  them, which is what keeps the sign-in from telling a member from a stranger. The questions to put: whether each is a limit of the service, as
  the full squad is, and so named beside it or not at all; and whether a refusal the person is not
  told of can be offered a review.
- **What carries a pupil's own consent from sixteen, for the Datenschutzexperte.**
  [Section 4](#4-what-is-published-and-on-what-basis) records that a pupil consents to their name's
  publication on their own from sixteen, with no guardian asked. Art. 8 (1) sets an age only for
  consent to an information society service offered directly to a child, the EDPB's guidelines on
  consent (05/2020, paragraph 127) requiring both conditions; Baden-Württemberg's authority, in its
  2020 guidance for clubs, confines Art. 8 to services aimed at children and outside it asks whether
  the minor can see what the use of their data leads to, their Einsichtsfähigkeit — both read on
  2026-09-22. Whether this site is such a service at all, neither settles. Hesse's authority, the
  one competent for this association, asks more in its template for consent to publishing pupils'
  data, photographs and videos: a parent's signature and, from sixteen, the pupil's beside it — a
  template written for a school, which is a public body, rather than for a club. Bavaria's is
  ambiguous, and about photographs on a website rather than names: for a minor it recommends the
  consent „der Betroffenen bzw. gesetzlichen Vertreter“ „aus Gründen der Rechtssicherheit“, which
  admits the person's own. Both read on 2026-09-22. The question to put: whether the consent
  rests on Art. 8 or on the pupil's own Einsichtsfähigkeit, or whether a guardian's consent is owed
  beside it, and so whether sixteen is the age it asks.
- **A referee's name on a fixture, on their own consent or on legitimate interest, for the
  Datenschutzexperte.** A referee's own confirmation writes a consent record
  (`fl_backend/app/api/schiedsrichter/services.py :: compose_einwilligung`), while the published
  notice rests the name on a fixture on Art. 6 (1)(f) and no fixture read consults the record. The
  question to put: which of the two is the basis.
- **Whether one media switch is specific enough, for the Datenschutzexperte.** One switch answers
  for photographs, videos and interviews together, from eighteen, published on this website and on
  the league's Instagram account ([section 4](#4-what-is-published-and-on-what-basis)). The question
  to put: whether one switch over three kinds and two places is specific enough to be a consent.
- **Instagram as a recipient, for the Datenschutzexperte.** What the league publishes on its account
  reaches Meta, whose platform runs under its own terms
  ([section 7](#7-processors-and-third-parties)). The Court held a Facebook page's operator a joint
  controller with Facebook for the statistics collected about the page's visitors (C-210/16), a
  holding about visitors rather than about what is posted, and one that does not name Instagram. The
  questions to put: whether the league shares control of anything Meta records about the account's
  audience, and what publishing there counts as under Chapter V, given Meta's United States parent.
- **Seven days for an unconfirmed registration, for the Datenschutzexperte.**
  [Section 6](#6-retention-is-bounded-where-a-bound-was-chosen) states the clock and why it is shorter
  than an application's. The question to put: whether seven days is proportionate for a name and an
  address nobody has confirmed belong together.
- **The referees standing today, for the Datenschutzexperte.** Their rows were entered by an
  administrator before the confirmation link existed and carry no consent record, and their names are
  published on every fixture they officiate on the basis the notice gives for every referee; the rows
  are dropped whole, once, their past fixtures go to the ghost with the name emptied, and the drop
  redacts the action log's images of them as an erasure does
  ([section 3](#3-the-current-pupil-records-are-reset-once),
  [`ops/runbooks.md`](ops/runbooks.md#12-deleting-this-seasons-player-records-and-resetting-the-action-log)).
  Nothing informs these people under Art. 14: a placeholder row is
  never mailed ([section 2](#2-consent-comes-from-the-person-from-16-or-18)), and a row holding a
  real address is mailed its link only when an administrator's write mints one
  ([`backend/spec.md`](backend/spec.md#11-endpoint-inventory)). Art. 14 (5)(b) lifts the duty where
  informing would take a disproportionate effort, and asks the controller to take appropriate
  measures instead, making the information publicly available among them. The questions to put:
  whether publishing those names until the drop rests on that basis; and whether that exemption
  carries the unmet duty to inform them, with the published notice as the measure it asks, or the
  rows holding a real address are mailed their link before the drop.
- **An administrator's address on every invite entry, and the delivery state beside it, kept with
  no clock, for the Datenschutzexperte.** An invite entry holds the administrator who minted it in
  plain, and nothing deletes the entry
  ([section 6](#6-retention-is-bounded-where-a-bound-was-chosen),
  `fl_backend/app/api/einladungen/services.py :: compose_einladung`); the delivery state of the
  message that carried its link stays on it too, past the erasure of the contact person it was mailed
  to — the provider's message id and its outcome, and no address. A seat's link entry after a
  Widerspruch is the same kind of record: on an application and on a team's season row it keeps the
  delivery state of the message the person answered, past their leaving the seat, until its
  application or row goes ([section 6](#6-retention-is-bounded-where-a-bound-was-chosen)). The
  questions to put: whether the invite's address and delivery state may be kept without a bound, and
  whether a delivery record the provider can join back to an address, on an invite or on a declined
  seat's entry, is still that person's data.
- **One act per choice as the proof of a consent, for the Datenschutzexperte.** What demonstrates a
  consent under Art. 7 (1) is the stored record: each of its choices, the publication scope and the
  media consent, keeps when its person last set it and under which wording, and a withdrawal keeps
  the grant it ended, for as long as the record stands. Only the person's own answer grants a choice
  or stamps its evidence: their own write, on their confirmation page or their account page, or an
  admission carrying their own registration's answer (`docs/backend/spec.md :: I869`). An act before
  those survives only in the log row its write left, whose image an erasure empties and which
  expires twelve months after the write ([section 6](#6-retention-is-bounded-where-a-bound-was-chosen)).
  The question to put: whether the latest act and the grant a withdrawal ended are proof enough,
  given those two ends of the log.
- **Whether a card's colour and minute may be published against a named minor, for the
  Datenschutzexperte.** No page publishes a card today, and the question is put before one does:
  whether a booking may stand on a public match report beside the name of a player of sixteen or
  seventeen.
- **The edge's clearance after a challenge, and the bot check on three forms, for the
  Datenschutzexperte.** A Managed Challenge meets a navigation to the sign-in page and to the
  application form, and passing it leaves a clearance in the browser that spares the visitor a
  second challenge and is checked by no rule on the form's own submission
  ([`ops/spec.md`](ops/spec.md#18-the-edges-declared-state)). The clearance is Cloudflare's
  `cf_clearance`, kept for the zone's Challenge Passage period, thirty minutes unless it is changed,
  and the challenge reads the browser as well as writing to it — Cloudflare's pages as read on
  2026-09-22, which move without us; this zone's own setting is recorded nowhere in this repository.
  The sign-in page, the application form and the pupil's registration form also run Cloudflare's
  Turnstile check in a frame of Cloudflare's own, which reads the visitor's address, the TLS
  fingerprint and the browser's identification, and whose token the server verifies before any of
  the three sends its mail ([`frontend/spec.md`](frontend/spec.md) I821). Cloudflare's Turnstile
  addendum names it a processor for that check and a controller of the same signals for improving
  its bot detection, on its own legitimate interest — read on 2026-10-04, and moving without us.
  The questions to put: whether each is strictly necessary under § 25 (2) Nr. 2 TDDDG, so that no
  consent is owed for it; and whether Cloudflare's use of the signals for itself needs a basis or a
  disclosure of this controller's beyond the notice naming it.
- **The board's full names in the Impressum, for the Datenschutzexperte.** Every member of the board
  is named in full (`fl_frontend/src/core/brand.ts :: VORSTAND`), outside the rule of
  [section 2](#2-consent-comes-from-the-person-from-16-or-18). § 18 (1) MStV asks every telemedium
  that is not private to name who represents it, while § 5 DDG reaches a digital service offered
  commercially, as a rule for payment, and § 18 (2) MStV one that is journalistic and editorial. The
  questions to put: whether § 18 (1) MStV carries all four names, and whether either of the other
  two reaches this site.
