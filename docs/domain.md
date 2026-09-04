# The domain model

**How the league fits together: what holds which collections true against each other, what a season's data
may become at each stage of its life, and which of the rules governing it belong to the competition rather
than to the code.**

**The competition.** Schools apply to play a season, and the league enters each accepted club into one of that
season's groups. Every group plays a single round robin; the best few of each group carry into a knockout
bracket, which runs to a final. **Almost none of that shape is fixed in code** — how many groups, how big,
how many qualify, what a win is worth, which figure separates two clubs level on points — so a number that
reads like a constant of this league is nearly always one some season chose for itself.

**The authority is `fl_backend/app/core/domain.py`, not this page.** It states the model as data — the
aggregates, the references, the field policies, the refusal rules and the deliberate absences — and
`fl_backend/tests/core/test_domain.py` checks it against the code on every test run. Read it for what the
model holds; read this for the shape those tables are stating.

| Section                                                             | Answers                                                        |
| ------------------------------------------------------------------- | -------------------------------------------------------------- |
| [The entities](#the-entities-and-what-holds-them-together)          | What there is, where a fact belongs, and what is held together |
| [The life of a season](#the-life-of-a-season)                       | What each stage opens, what it closes, and the one way back    |
| [The competition's own rules](#the-competitions-own-rules)          | What would be different in another league                      |
| [Stored and computed](#what-is-stored-and-what-is-computed)         | Which facts a document holds and which follow from the matches |
| [What a write is checked against](#what-a-write-is-checked-against) | Why a rule lives in the validator, the model or the endpoint   |
| [Where the German misleads](#where-the-german-misleads)             | The trap that belongs to no single term                        |
| [Keeping the model honest](#keeping-the-model-honest)               | Permitted states, and what a model change owes                 |

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
- **Standing apart** — one school's application to play one season (`bewerbungen`), and one recorded write
  (`aktionen`).

A school's kind survives the year and its Trainer does not, which is what puts those two on different
documents. A club's league table is on neither, being computed from the matches.

### What is held true together

An **aggregate** is a consistency boundary: the collections some rule holds true _together_.
`domain.py :: AGGREGATES` is the list, each entry stating the invariant that binds it. Membership never turns
on whether one document points at another — a reference is not a boundary — and three of the boundaries read
wrong at first.

**A match write is a season write.** Entering one result resolves the whole bracket in the same transaction
and rewrites fixtures the request never named, so `PATCH /spiele/{spiel_id}` looks like a single-document
write and is not one. The boundary is the season's entire fixture set.

**A matchday is its own boundary, even though fixtures point at it.** Nothing holds a matchday and its
fixtures true together: its place is unique among the other matchdays of its phase, and its expected match
count comes from the season's rules rather than from the fixtures attached to it. The one operation that
writes both — the season's draw, a confirmed replace of it included — writes them as a season's decision.

**An application and a log row are each held true against nothing, and both are decisions.** Each states what
was true when it was written — what one school submitted, that one write happened — and that stays true
however the season, the club or the document it names changes afterwards, so no invariant holds either
against another document and nothing has to be rewritten to keep one true. An application's `status` is a
claim of the same kind: it says a junction row _was written_, not that one still stands. Accepting an
application does write outside its own boundary, creating the club and its `saison_teams` row in one
transaction, and what holds those writes to the season's rules is
`fl_backend/app/api/teams/services.py :: find_entry_refusal`, which belongs to the season's boundary and is
reused rather than restated.

**A boundary is what must be true together; what must not outlive a person is a different question**, and it
is that one which reaches into the log. A row keeps an image of the document a write replaced, so a person's
own details sit in the log too, and a write destroying them redacts the rows holding them in the same
transaction (`docs/backend/spec.md :: I42`). `aktionen.document_id` is a copied id that **nothing
maintains**: the document it names may since have been edited, retired or removed outright, with no row here
brought up to date.

---

## The life of a season

Each stage below narrows what the one before it left open.

- **Created** — always `future`. Nothing an admin submits sets `status`, and the activation below is the only
  code path in the system that writes it.
- **Applications** — a school applies while the season's own window is open (`REQ-BEWERBUNG-004`). Accepting
  one creates the club where it is new and writes its junction row, held to the same entry rules a direct
  entry meets.
- **Entry** — a club takes a place in a group only while the season is `future` (`REQ-ENTER-001`), only in a
  group the season runs (`REQ-ENTER-002`), and only while that group has room (`REQ-ENTER-003`).
- **The draw** — `POST /saisons/{saison_id}/spielplan` composes every matchday and every fixture of the
  season in one operation, from the rules and the clubs entered. Nothing it writes carries a date; dating a
  matchday is a separate write afterwards.
- **Activation** — `POST /saisons/{saison_id}/activate` is the only path to `active`. It refuses a season
  holding no fixtures (`REQ-ACTIVATE-003`), and demotes the incumbent to `past`, which is refused while that
  incumbent still has fixtures neither played nor cancelled (`REQ-ACTIVATE-001`).
- **`past`** — the end, and there is no way out of it. A finished season's points, its groups and the table
  derived from them are the record of what happened, and activating it again would reopen all three
  (`REQ-ACTIVATE-002`). A season closed by mistake is repaired at the database.

**A season is never deleted, and neither is a club's place in one.** No endpoint removes a `saisons`
document, which would orphan every `saison_id` in the database, and none removes a `saison_teams` row: a club
leaves a season by an `austritt` record, or by a replacement repointing that row at another club, and the row
survives both.

**Retirement everywhere else is a date and never a delete, and it never cascades.** `inactive_since` retires
a row and clearing it revives one; a played fixture keeps the team name it recorded at the time. What a
retired row loses is NEW work — a retired club is entered into no season (`REQ-ENTER-005`), and a retired
venue or referee is assigned to no fixture that does not already hold it (`REQ-BOOKING-001`). Both judge the
reference being made rather than the one already stored, which is what lets a venue retire while played
fixtures still name it. The `REQ-RETIRE-*` rows of `domain.py :: RULES` are every refusal a retirement meets.

**Where a document really is removed, the removal is what the operation is for.** A confirmed **replace** of
a season's draw takes its matchdays and fixtures away and writes fresh ones; an **undraw** takes the same two
sets away and writes nothing back, and what it is for is [the rules
below](#a-seasons-rules-are-the-interesting-case). A pupil's **erasure** removes the person, every one of
their squad rows and their values in the action log, as one transaction over all three, and requires the
person to be retired first (`REQ-PURGE-001`) — any one of the three alone would leave the erasure defeated
while reporting success, the squad read joining from the person outward and a log row holding what was erased
being exactly the record the erasure exists to remove.

### A season's rules are the interesting case

**What freezes the season's shape is the draw, never `status` alone** (`REQ-RULES-011`). Once a season holds
fixtures, the three numbers those fixtures were drawn from move only with the fixtures they produced, because
the shape and the draw are ONE fact. An `active` season is held to its shape and so is a `future` one.

**The route back is an undraw**, and it is the whole reason `DELETE /saisons/{saison_id}/spielplan` exists:
undraw, patch the rules, change the entries, draw again — with the group moves a drawn season locks
(`REQ-ENTER-004`) open again in between. **Changing the entries can only mean adding them.** No endpoint
takes a club back out of a season and an `austritt` leaves its row occupying the place, so a group's
occupancy never falls: an undraw reopens the group count and the group size upward alone, and either of them
below what the groups already hold is refused whatever is undrawn (`REQ-RULES-002`, `REQ-RULES-003`). **Not
every bound over stored rows behaves that way**: `max_kadergroesse` is held above the largest squad, counted
over rows no retirement has taken out (`REQ-RULES-009`), so retiring players lowers that cap where nothing
lowers a group's occupancy. Only the qualifier count can skip the whole route, moving on a confirmed
replace's own payload (`REQ-SPIELPLAN-005`) because it leaves every group as it stands. Both operations are
held to a `future` season with nothing recorded against a fixture (`REQ-SPIELPLAN-006`), so what they destroy
is a schedule nobody has played.

Two freezes sit outside that one:

- **A finished season's scoring is frozen** (`REQ-RULES-005`) — its table is derived from those numbers on
  every read, and nothing records what they said before.
- **The tie-break order freezes soonest of all** (`REQ-RULES-012`) — the bracket was seeded from the group
  placings that order decides, so moving it once a knockout fixture has left a record would re-seed a bracket
  that has been part-played. What counts as a record is
  `fl_backend/app/api/teams/services.py :: has_taken_place`, which is wider than a stored result, so a
  fixture called off or struck out leaves the order open.

**Every one of these judges the step and not the state it arrives in**, which is what keeps a season
repairable: a date-only edit resubmits the whole `rules` object and passes whatever the stored values already
say (`docs/backend/spec.md :: I44`). The dates themselves sit outside `rules` and stay editable even on a
finished season, correcting a mistyped one changing nothing anybody competed for.

---

## The competition's own rules

- **Nothing about scoring is a constant.** What a win and a draw are worth is the season's, there is no
  points value for a loss at all, and the only bound on the pair is that a season may not make a draw the
  better result (`REQ-RULES-008`).
- **A season runs a prefix of a closed group set**, whose members are [`glossary.md`](glossary.md)'s `Gruppe`
  entry. The count and the size are the season's (`fl_backend/app/api/saisons/schemas.py :: NumberOfGroups`,
  `:: TeamsPerGroup`), and the size's ceiling is not a competition rule: it keeps the largest legal season
  inside one page of a season-scoped read (`fl_backend/app/shared/schemas/bounds.py :: LIST_LIMIT_DEFAULT`),
  past which those reads truncate and the refusals computed from them cannot be trusted.
- **Every group plays one round robin, and the groups play in step.** Round _k_ of every group is matchday
  _k_, which is what keeps a club from standing twice on one matchday and makes every group finish together.
  An odd-sized group leaves one club on a bye each round rather than shortening the phase.
- **The bracket has to have a shape.** Groups times qualifiers-per-group must be a power of two the round set
  can hold (`REQ-RULES-001`), because a knockout ladder halves each round down to one final; the rounds are
  `fl_backend/app/api/spiele/schemas.py :: KNOCKOUT_PHASES`, declared in playing order, and each of them is
  one matchday.
- **A bracket fixture is drawn naming its sources rather than its teams.** A side is fed by a group placing,
  or by which side came out of an earlier fixture — so the whole season is drawn end to end before anybody has
  qualified for anything, and entering a result is what fills the slots downstream.
- **A level knockout fixture is settled by a shoot-out**, whose own scoreline is stored beside the result and
  never inside it. A no-show is awarded a scoreline the season configures, and a season that plays a knockout
  round may not configure that award level (`REQ-RULES-010`) — a drawn forfeit would leave the round with
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
`fl_backend/tests/core/test_domain.py :: test_a_derived_field_is_on_no_document` holds that difference
against the database validators, so a field declared derived cannot quietly acquire a stored copy.

---

## What a write is checked against

| Layer                          | Enforces                                                    | Why not elsewhere                                                        |
| ------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| **`$jsonSchema` validators**   | BSON types, required keys, closed enums                     | Only these fail _silently_; a bad range fails Pydantic on the next read  |
| **Pydantic models**            | Ranges, patterns, lengths, cross-field shape                | A validator cannot express them, and a wrong value is loud               |
| **`find_*_refusal` functions** | Everything spanning more than one document                  | No validator sees more than one document                                 |
| **The pages that offer**       | Offering only legal choices, and reporting permitted states | A page may never be the only enforcement — a direct API call bypasses it |

The line between the first two is itself tested:
`fl_backend/tests/core/test_constraints.py :: test_no_validator_constrains_a_range_or_a_format` fails a
validator that reaches past it. **The pages narrow the offer and name what they cannot narrow; they never
replace the refusal** — the entry form disables a group it can see is full, and the endpoint still judges the
entry, because a stale form and a direct request each reach it, and on a public page the direct request is
anyone's.

Every refusal reaches a client as a **code** rather than as a message, the English text beside it going only
to the log; [`logging/error-codes.md`](logging/error-codes.md) lists every code with the status it answers.

**The table above is about validity — may this value exist? Read visibility is a different question: may
this caller see a value that legitimately does?** Neither the validators nor the refusal functions can settle
it, both judging a document and never a caller: the guard on the router decides who may make a read at all,
and the response model decides what that read serves. Which tier is served which field is
[`backend/spec.md`](backend/spec.md)'s `READ-*` rules — a base-tier fixture read is served neither money
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

## Keeping the model honest

**An absence looks identical to an omission**, so every state the system permits on purpose is declared:
`domain.py :: UNENFORCED` names the state, says why refusing it would be wrong, and names the page that
reports it where one does. What selects the set is that refusing would block a legitimate act rather than a
mistake — a season being set up passes through several of these on its way to being complete. **Where a state
is reported, the report is a page and never a stored flag**, so nothing about these states is queryable and
no later feature can quietly come to depend on one.

A reason a reader nods at is not evidence, so each entry is checked in full: the refusal codes it claims to
sit near must exist, a state sitting near none surprising nobody; the class of
`fl_backend/tests/core/test_unenforced.py` it pairs with must execute the state, exactly and in **both**
directions, so an entry nothing runs fails and a test class no entry claims fails with it; and the surface it
names is resolved against the frontend tree, so an entry cannot go on claiming a person can see a state after
the page showing it has gone.

**Most of what a model change owes is caught at the gate**, `test_domain.py` resolving what the declaration
names and holding the claims it makes rather than merely the addresses. Three obligations are not, because no
check can see a row nobody wrote:

- **A refusal code the API has not answered with before** owes a row in
  [`logging/error-codes.md`](logging/error-codes.md) and a German message where its feature maps refusals.
  Unmapped, it falls through to what `fl_frontend/src/shared/utils/actionError.ts :: toActionErrorResult`
  answers a bare 409 with, telling an admin the entry conflicts with one that already exists.
- **A new cross-collection reference** owes a `REFERENCES` row stating the constraint on the creating
  direction beside the two triggered actions. Every check walks OUTWARD from a declared row; none walks
  inward from a validator, so an id field nobody declared is invisible.
- **A field that is not plainly editable** owes a `FieldPolicy`. The one place this closes mechanically is
  `inactive_since`, which every collection whose validator declares it must account for; where the
  editability is a judgement, nothing can do the same.

**No module under `app/` may import `domain.py`**, and `test_domain.py` enforces it: the moment production
code reads these tables they stop being a declaration and become an engine a write can forget to consult.

---

## See also

- **[`backend/spec.md`](backend/spec.md)** — the endpoint inventory and the backend's own invariants
- **[`glossary.md`](glossary.md)** — the German vocabulary, which is not optional
- **[`logging/error-codes.md`](logging/error-codes.md)** — every error code either service emits, and the response body and log line that carry it
