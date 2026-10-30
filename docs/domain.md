# The domain model

**How the league fits together: what holds which collections true against each other, what a season's data
may become at each stage of its life, and which of the rules governing it belong to the competition rather
than to the code.**

**The competition.** Schools apply to play a season, and the league enters each accepted club into one of that
season's groups. Every group plays a single round robin; the best few of each group carry into a knockout
bracket, which runs to a final. **Almost none of that shape is fixed in code** — how many groups, how big,
how many qualify, what a win is worth, which figure separates two clubs level on points — so a number that
reads like a constant of this league is nearly always one some season chose for itself.

| Section                                                             | Answers                                                        |
| ------------------------------------------------------------------- | -------------------------------------------------------------- |
| [The entities](#the-entities-and-what-holds-them-together)          | What there is, where a fact belongs, and what is held together |
| [The life of a season](#the-life-of-a-season)                       | What each stage opens, what it closes, and the one way back    |
| [The competition's own rules](#the-competitions-own-rules)          | What would be different in another league                      |
| [Stored and computed](#what-is-stored-and-what-is-computed)         | Which facts a document holds and which follow from the matches |
| [What a write is checked against](#what-a-write-is-checked-against) | Why a rule lives in the model, the index or the endpoint       |
| [Where the German misleads](#where-the-german-misleads)             | The trap that belongs to no single term                        |
| [What the model permits](#what-the-model-permits-on-purpose)        | The states no write refuses, and why refusing would be wrong   |

---

## The entities, and what holds them together

**What decides where a fact goes is whether it outlives a season.**

- **Season-independent** — the club, the person, the venue and the referee (`teams`, `spieler`, `spielorte`,
  `schiedsrichter`). Each document is the row as it stands today.
- **Season-scoped** — the season itself (`saisons`), and the two junctions that make a club and a person
  season-scoped at all (`saison_teams`, `saison_spieler`). A club's group, its kit colour, the three people
  the league reaches it through and the name it played one season under are all junction fields, none of them
  on the club.
- **Drawn** — the matchdays and the fixtures (`spieltage`, `spiele`), composed by one operation from a
  season's rules and the clubs entered into it.
- **Standing apart** — one school's application to play one season (`bewerbungen`), one pupil's registration
  to play it (`registrierungen`), one minted registration link (`einladungen`), one party's answer about one
  fixture's Ansetzung (`spielbestaetigungen`), one fixture's report by its referee or an administrator (`spielberichte`),
  one change of the address a person signs in on (`adresswechsel`), one barred address
  (`sperrliste`), one address's access to the administration (`berechtigungen`), what the
  administrators have been told of it (`berechtigungen_angekuendigt`) and a grant waiting on a
  second administrator's approval (`berechtigungen_antraege`), one mail the league owes one
  recipient (`outbox`), and one recorded write (`aktionen`).

A school's kind survives the year and its Trainer does not, which is what puts those two on different
documents.

### What is held true together

An **aggregate** is a consistency boundary: the collections some rule holds true _together_.
Membership never turns
on whether one document points at another — a reference is not a boundary — and three of the boundaries read
wrong at first.

**A match write is a season write.** Entering one result resolves the whole bracket in the same transaction
and rewrites fixtures the request never named, so `PATCH /spiele/{spiel_id}` looks like a single-document
write and is not one. The boundary is the season's entire fixture set.

**A matchday is its own boundary, even though fixtures point at it.** Nothing holds a matchday and its
fixtures true together: its place is unique among the other matchdays of its phase, and its expected match
count comes from the season's rules rather than from the fixtures attached to it. The one operation that
writes both — the season's draw, a confirmed replace of it included — writes them as a season's decision.

**An application, a pupil's registration and a log row are each held true against nothing, and all three are
decisions.** Each states what was true when it was written — what one school submitted, what one pupil
registered, that one write happened — and that stays true however the season, the club or the document it
names changes afterwards, so no invariant holds any of them against another document and nothing has to be
rewritten to keep one true. An application's `status` is a
claim of the same kind: it says a junction row _was written_, not that one still stands. Accepting an
application does write outside its own boundary, creating the club and its `saison_teams` row in one
transaction, and what holds those writes to the season's rules is
`fl_backend/app/api/teams/services.py :: find_entry_refusal`, which belongs to the season's boundary and is
reused rather than restated.

**A fixture confirmation is held true against nothing too, and is NOT in the season's boundary however close it
sits.** A row states what one party answered about one Ansetzung, which stays true however the fixture moves
afterwards. Membership would claim an invariant holding a row and its fixture true together, and the design holds
none on purpose: the answer writes no fixture, no fixture write reaches a row, and the sweep closes a row a move
overtook up to an hour later. What a reader may rely on is a comparison rather than a membership -- the answer
compares the row's `ansetzung.stand` against the fixture's at the press -- and the one rule the collection holds
alone, one open row per party per Ansetzung.

**A boundary is what must be true together; what must not outlive a person is a different question**, and it
is that one which reaches into the log. A row keeps an image of the document a write replaced, so a person's
own details sit in the log too, and a write destroying them redacts the rows holding them in the same
transaction. `aktionen.document_id` is a copied id that **nothing
maintains**: the document it names may since have been edited, retired or removed outright, with no row here
brought up to date.

---

## The life of a season

- **Created** — always `future`. Nothing an admin submits sets `status`, and the activation below is the only
  code path in the system that writes it.
- **Applications** — a school applies while the season's own window is open and the season has not ended
  (`bewerbung_window_closed`). Accepting
  one creates the club where it is new and writes its junction row, held to the same entry rules a direct
  entry meets.
- **Registration** — the season records a second window of its own, `registrierung`, set on the season editor
  and open exactly when its flag is on, the day falls inside its span and the season has not ended. It is judged apart from the
  application window above and from the season's own dates, so the two may run in any order or not at all.
- **Entry** — a club takes a place in a group only while the season is `future` (`entry_saison_not_future`), only in a
  group the season runs (`entry_gruppe_not_offered`), and only while that group has room (`entry_gruppe_full`).
- **The draw** — `POST /saisons/{saison_id}/spielplan` composes every matchday and every fixture of the
  season in one operation, from the rules and the clubs entered. Nothing it writes carries a date; dating a
  matchday is a separate write afterwards.
- **Activation** — `POST /saisons/{saison_id}/activate` is the only path to `active`. It refuses a season
  holding no fixtures (`activate_target_undrawn`) and one whose matchdays are not all dated
  (`activate_spieltage_undated`), and demotes the incumbent to `past`, which is refused while that incumbent still
  has fixtures neither played nor cancelled (`activate_saison_unfinished`).
- **`past`** — the end, and there is no way out of it. A finished season's points, its groups and the table
  derived from them are the record of what happened, and activating it again would reopen all three
  (`saison_past`). A season closed by mistake is repaired at the database.

**A season is never deleted, and neither is a club's place in one.** No endpoint removes a `saisons`
document, which would orphan every `saison_id` in the database, and none removes a `saison_teams` row: a club
leaves a season by an `austritt` record, or by a replacement repointing that row at another club, and the row
survives both.

**Retirement everywhere else is a date and never a delete, and it never cascades.** `inactive_since` retires
a row and clearing it revives one; a played fixture keeps the team name it recorded at the time. What a
retired row loses is NEW work — a retired club is entered into no season (`team_retired`), and a retired
venue or referee is assigned to no fixture that does not already hold it, nor kept on one a save makes unplayed
again (`booking_unknown_resource`). Both judge the reference being made — and reopening a fixture makes its references
again — rather than one merely stored, which is what lets a venue retire while played or called-off fixtures
still name it. A bracket resolution, or a side emptied for a Spieltag clash, reopening such a fixture is no save and refuses nothing: the retired row stays booked and is reported, the ghost every erased referee's fixtures point at being one such
retired row. `retire_blocked`, `spielort_still_booked` and `schiedsrichter_still_assigned` are every refusal a retirement meets.

**Where a document really is removed, the removal is what the operation is for.** A confirmed **replace** of
a season's draw takes its matchdays and fixtures away and writes fresh ones; an **undraw** takes the same two
sets away and writes nothing back, and what it is for is [the rules
below](#a-seasons-rules-are-the-interesting-case). A pupil's **erasure** removes the person, every one of
their squad rows and their values in the action log, as one transaction over all three, and asks no
retirement first — any one of the three alone would leave the erasure defeated
while reporting success, the squad read joining from the person outward and a log row holding what was erased
being exactly the record the erasure exists to remove.

### A season's rules are the interesting case

**What freezes the season's shape is the draw, never `status` alone** (`rules_shape_after_spielplan`). Once a season holds
fixtures, the three numbers those fixtures were drawn from move only with the fixtures they produced, because
the shape and the draw are ONE fact. An `active` season is held to its shape and so is a `future` one.

**The route back is an undraw, and it closes with the window below** — past that window there is no
route back at all, and the three shape rules are fixed for the season's life. It is the whole reason
`DELETE /saisons/{saison_id}/spielplan` exists:
undraw, patch the rules, change the entries, draw again — with the group moves a drawn season locks
(`entry_gruppe_locked`) open again in between. **Changing the entries can only mean adding them.** No endpoint
takes a club back out of a season and an `austritt` leaves its row occupying the place, so a group's
occupancy never falls: an undraw reopens the group count and the group size upward alone, and either of them
below what the groups already hold is refused whatever is undrawn (`rules_gruppen_in_use`, `rules_capacity_below_use`). **Not
every bound over stored rows behaves that way**: `max_kadergroesse` is held above the largest squad, counted
over rows no retirement has taken out (`rules_kader_below_use`), so retiring players lowers that cap where nothing
lowers a group's occupancy. Only the qualifier count can skip the whole route, moving on a confirmed
replace's own payload (`spielplan_replace_outside_its_window`) because it leaves every group as it stands. Both operations are
held to a `future` season with nothing recorded against a fixture (`spielplan_undraw_outside_its_window`), so what they destroy
is a schedule nobody has played.

One freeze sits outside that one:

- **A started season's scoring and seeding are frozen** (`rules_saison_started`) — from the day of its earliest
  group-phase fixture (`fl_backend/app/api/saisons/crud.py :: has_started`), the points, the qualifiers per
  group and the tie-break order hold: the table is derived from them on every read, and the bracket was
  seeded from the placings the order decides. A `past` season stays frozen whatever its fixtures' dates.

**Every one of these judges the step and not the state it arrives in**, which is what keeps a season
repairable: a date-only edit resubmits the whole `rules` object and passes whatever the stored values already
say. The dates themselves sit outside `rules` and stay editable even on a
finished season, correcting a mistyped one changing nothing anybody competed for.

---

## The competition's own rules

- **Nothing about scoring is a constant.** What a win and a draw are worth is the season's, there is no
  points value for a loss at all, and the only bound on the pair is that a season may not make a draw the
  better result (`rules_unentschieden_outvalues_win`).
- **A season runs a prefix of a closed group set**, whose members are [`glossary.md`](glossary.md)'s `Gruppe`
  entry. The count and the size are the season's (`fl_backend/app/api/saisons/schemas.py :: NumberOfGroups`,
  `:: TeamsPerGroup`), and each is bounded as one field. What keeps a whole season inside one page of a
  season-scoped read (`fl_backend/app/shared/schemas/bounds.py :: LIST_LIMIT_DEFAULT`) is `rules_spiele_over_one_read`,
  which weighs every group and the bracket together; past that page those reads truncate and the refusals
  computed from them cannot be trusted.
- **Every group plays one round robin, and the groups play in step.** Round _k_ of every group is matchday
  _k_, which is what keeps a club from standing twice on one matchday and makes every group finish together.
  An odd-sized group leaves one club on a bye each round rather than shortening the phase.
- **The bracket has to have a shape.** Groups times qualifiers-per-group must be a power of two the round set
  can hold (`rules_bracket_impossible`), because a knockout ladder halves each round down to one final; the rounds are
  `fl_backend/app/api/spiele/schemas.py :: KNOCKOUT_PHASES`, declared in playing order, and each of them is
  one matchday.
- **A bracket fixture is drawn naming its sources rather than its teams.** A side is fed by a group placing,
  or by which side came out of an earlier fixture — so the whole season is drawn end to end before anybody has
  qualified for anything, and entering a result is what fills the slots downstream.
- **A level knockout fixture is settled by a shoot-out**, whose own scoreline is stored beside the result and
  never inside it. A no-show is awarded a scoreline the season configures, and a season that plays a knockout
  round may not configure that award level (`rules_forfeit_unentschieden_in_a_knockout`) — a drawn forfeit would leave the round with
  nobody to advance.
- **A club leaves one season, never the league.** An `austritt` record says which of the two routes out it
  took, and the club's own document is untouched by it.

---

## What is stored, and what is computed

**The league table is stored nowhere and cached nowhere.** It is aggregated from the season's matches on
every read, using that season's own points, so there is no figure to fall out of date and none to rebuild
after a correction.

**A club's group and its `austritt` are joined from the junction rather than copied onto the club**, so
recording either reaches every surface at once instead of needing a fan-out.

**A match embeds a display copy of its team, its venue and its referee beside the id**, so a fixture card
renders without a join. The copy is never accepted from a client: the patch composes it from the row each id
names, so an editor left open across a rename cannot resubmit the old text and undo the fan-out. A rename
then travels into what already holds it — but **a club's rename stops at a `past` season**, and that is the
competition's rule rather than a caching one: a finished season is the record of the name it was played
under, which is what makes the copy in its fixtures true rather than merely old. A venue's rename and a
referee's carry no such boundary, neither being season-scoped.

**Two figures deliberately stay on the match payload while the names beside them are composed** — what this
fixture paid for its venue, and what it paid its referee. Each is what _this fixture_ agreed rather than a
copy of a current default, so fanning one out would rewrite history and composing one would replace an agreed
figure with a price nobody agreed to.

**A field the server composes is still stored; a derived one is on no document at all.** A match's result
string is stored, composed from the two goal counts so the string cannot disagree with them; a matchday's
match count follows from the season's rules and is held nowhere.

---

## What a write is checked against

| Layer                          | Enforces                                                                        | Why not elsewhere                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Pydantic models**            | Types, required keys, closed sets, ranges, patterns, lengths, cross-field shape | Every write passes its payload model, and every served read its response model, so a wrong value is loud |
| **Unique indexes**             | One document per key (`fl_backend/app/core/constraints.py :: UNIQUE_INDEXES`)   | Only the database sees two writes racing for one key                                                     |
| **`find_*_refusal` functions** | Everything spanning more than one document                                      | No model sees more than one document                                                                     |
| **The pages that offer**       | Offering only legal choices, and reporting permitted states                     | A page may never be the only enforcement — a direct API call bypasses it                                 |

Nothing in the database refuses a document of another shape, so a migration paste is followed by
`python -m app.readback` (`fl_backend/app/readback.py`), which reads every stored document back through its
record model and names each one it refuses. **The pages narrow the offer and name what they cannot narrow; they never
replace the refusal** — the entry form disables a group it can see is full, and the endpoint still judges the
entry, because a stale form and a direct request each reach it, and on a public page the direct request is
anyone's.

Every refusal reaches a client as a **code** and never as a message, the frontend writing every word a person
reads; `fl_backend/app/core/codes.py :: Code` is each code's one spelling, and `fl_backend/openapi.json` lists
them all once, as the failure body's `error_code`.

**The table above is about validity — may this value exist? Read visibility is a different question: may
this caller see a value that legitimately does?** Neither the models nor the refusal functions can settle
it, both judging a document and never a caller: the guard on the router decides who may make a read at all,
and the response model decides what that read serves. Which tier is served which field is
therefore the response models' to decide — a base-tier fixture read is served neither money
figure, though the document holds both.

---

## Where the German misleads

Each term's own trap is [`glossary.md`](glossary.md)'s. One trap belongs to no single term and so lives here:
**German compounds a term into a longer word meaning something else, so searching for a term as a substring
attributes its facts to a different concept — and the hit count looks convincing while it does it.**

- `spiel` is a match, and it sits inside `spieler`, `spielort`, `spieltag` and `spielplan` — a person, a
  venue, a matchday and a season's whole draw, four different things.
- `stufe` is a level on a squad row, and it sits inside `oberstufengymnasium` and `stufengroesse` —
  a `schulform` value describing the school rather than any pupil in it, and an application's count
  of one whole Abi-Jahrgang, two different things.

**Search for the whole word, and classify every hit by the whole word around it.** A count of substring
matches is evidence about nothing.

---

## What the model permits on purpose

**Each state below is reachable and refused by no write, because refusing it would block a legitimate act
rather than a mistake.** Where a page reports one, the report is computed on the read and never stored, so
no later feature can come to depend on a flag.

- **A matchday whose fixtures differ from the count its phase implies.** The draw writes every phase at that
  count and `rules_shape_after_spielplan` holds the shape to the fixtures drawn from it, so only a stored row no current
  write produces holds the gap; refusing it on the rules patch would latch such a season shut, its dates
  included. The matchday editor names both counts.
- **Two players of one squad wearing the same number.** A number is worn rather than assigned, and a squad
  fields several keepers wearing 1. The two squad reads a team's representative is served report it, comparing
  the number as typed, because `07` is a printed shirt and not `7`.
- **A bracket slot the resolution filled with a club that later left.** `eligibility_disqualified` judges a side a
  request fields; a slot no request touched is reported as a fault, since only a person chooses between a
  forfeit and a replacement.
- **A fixture still to be played booked onto a retired venue or referee.** `booking_unknown_resource` judges what a save
  books, and a bracket resolution reopening a fixture books nothing; refusing it would refuse the correction
  upstream. The booking is reported as a fault, the ghost an erased referee leaves among them.
- **One venue or referee claimed by two fixtures under four hours apart.** `spiel_double_booked` refuses only a claim
  a save newly makes. A lifted no-show reclaiming its slot is reported, because which fixture moves is a
  competition call.
- **A Spieltag on which a club already stands twice.** The swap, `spieltag_occupied` and `spieltag_occupied_by_the_resolution`
  refuse only a pair the write would create, since refusing over a standing fault would block its repair;
  each standing appearance is reported.
- **A departed club holding drawn fixtures.** It keeps its group place and its opponents need a fixture to
  record the walkover on; `eligibility_disqualified` refuses only a request disturbing one.
- **A group phase in which every club qualifies.** A seeding-only group stage is a real format, so
  `rules_qualifiers_above_gruppe` bounds the qualifiers from above alone.
- **A matchday of a later phase dated before one of an earlier phase.** `spieltag_beginn_out_of_order` finds its neighbour on
  the indexed `(saison_id, saison_phase, position)`, and no stored key orders the phases. The matchday list
  sections a season by phase in played order, so such dates read as running backwards.
- **A `future` season holding recorded results.** Binding a result to the status would make the one-way
  activation a precondition for recording a match already played, so both windows that destroy a draw judge
  the recorded count and the status apart.
- **An abandoned fixture carrying any result, or none.** An abandonment has two lawful outcomes, the score
  awarded or the match replayed, and this competition names no rule between them; the editor warns that a
  decided score counts for the table.
- **A pupil whose age no squad rule judges.** The age is judged once, at the registration's confirmation
  (`confirmation_age`); entering, moving or bringing back a squad row judges none.
- **A person holding no squad row, and a person retired while holding a live one.** The first is reachable only
  by a database edit, and `GET /spieler/saisons` serves such a person with an empty list, which is the
  surface that repairs it. The two retirements are independent, so retiring a person never asks for every squad
  they played in to be emptied, and the list badges both.
- **A retired row kept indefinitely.** No sweep selects on `inactive_since`, which records when a row retired
  and never when it may go; every admin list badges the day it retired.
- **A stored action-log image no current model accepts.** An image is what a document looked like when it was
  written, so validating it against today's models would make every row older than a migration unreadable.

---

## See also

- **[`backend/overview.md`](backend/overview.md)** — the backend's slices, routers and guards
- **[`glossary.md`](glossary.md)** — the German vocabulary, which is not optional
