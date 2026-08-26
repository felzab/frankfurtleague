# The domain model

**Verified against:** `d1fc5f37`, 2026-08-26

**What the league's data is, what depends on what, when each thing may be edited, and what a write has to do
about its neighbours.**

**The authority is `fl_backend/app/core/domain.py`, not this page.** It states the model as data — the
aggregates, the references, the field policies, the refusal rules and the deliberate absences — and
`fl_backend/tests/core/test_domain.py` checks it against the code on every test run. Where a declaration
names a symbol the test resolves it, and where a declaration makes a claim about that symbol the test holds
the claim rather than the address — [Keeping this true](#keeping-this-true) is which is which. This page
carries only what a table cannot: the readings that catch people out.

**If you read one section, read [Aggregates](#aggregates).** Several of those boundaries are
counter-intuitive and every one of the mistakes is expensive.

| Section                                                                       | Answers                                                      |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [The facts that shape everything else](#the-facts-that-shape-everything-else) | What to hold in your head before the rest makes sense        |
| [Aggregates](#aggregates)                                                     | Which collections are held true together, and which point    |
| [What depends on what](#what-depends-on-what)                                 | What a rename reaches, what a retirement leaves alone        |
| [When a field may be edited](#when-a-field-may-be-edited)                     | Which fields freeze, which narrow, which are on no payload   |
| [What a write must do](#what-a-write-must-do)                                 | The refusals, their order, and what they hand back           |
| [What is deliberately not enforced](#what-is-deliberately-not-enforced)       | The states the system permits, and where each is reported    |
| [Where each layer enforces what](#where-each-layer-enforces-what)             | Why a rule lives in the validator, the model or the endpoint |
| [Keeping this true](#keeping-this-true)                                       | What a change to the model obliges you to change with it     |

---

## The facts that shape everything else

| Fact                                                         | Consequence                                                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| A `Team` and a `Spieler` document are **season-independent** | Everything season-scoped about a club or a squad lives on the `saison_teams` and `saison_spieler` junctions                    |
| A season's `rules` **decide the shape of the competition**   | Narrowing one below what already exists strands data, and is refused                                                           |
| A **match write is a season write**                          | Entering a result resolves the whole bracket in the same transaction                                                           |
| Retirement is **a date, never a delete**                     | `inactive_since` is a date string; a retirement never removes a row, and the operations that do remove one are not retirements |

The German vocabulary is load-bearing and is defined in [`glossary.md`](glossary.md).

---

## Aggregates

An **aggregate** is a consistency boundary: a root collection plus the collections whose invariants are
checked against that root. Membership turns on one question — _does a rule hold this collection and the root
true together?_ — and **not** on whether one document points at another. `domain.py :: AGGREGATES` is the
list, each entry stating the invariant that binds it.

**`spiele` is one aggregate per SEASON, not per match.** Entering a result resolves the season's bracket in
the same transaction and rewrites fixtures the request never named, so the boundary of a match write is
_every fixture in that season_ — `PATCH /spiele/{spiel_id}` looks like a single-document write and is not
one.

**`teams` is NOT inside `Saison`.** The practical test: a club's address, website and the name it carries
today are on `teams`; its group, its `austritt` and the name and shorthand a given season was played under
are on `saison_teams`; its league table is on neither, being derived from the matches.

**`spieltage` is its own aggregate even though `spiele` points at it.** Its `position` is unique among the
other matchdays of its phase and its expected match count comes from the season's rules, so no invariant
holds a matchday and its fixtures true together. A reference is not a boundary — and the one operation that
does write both, the season's draw, writes them as a `Saison` decision rather than as a matchday one — a
confirmed replace of that draw included.

**`aktionen` is in a boundary with nothing, and that is the decision rather than an oversight.** It is its own
aggregate in `domain.py :: AGGREGATES` with no members, because a row states that a write happened, and that
stays true however the document it names changes afterwards — so nothing has to be rewritten to keep a log row
true, and no invariant holds one and another document in agreement. What binds a row to the write it records is
the **transaction they share**, not a reference.

**A boundary is what must be true together; what must not outlive a person is a different question**, and it is
that question which reaches in here. A row keeps an image of the document a write replaced, so a person's own
details sit in the log too, and a write destroying them redacts the rows holding them in the same transaction —
`docs/backend/spec.md :: I42` is that contract, and a pupil's
[erasure](#deletion-is-rare-and-each-one-is-its-own-decision) is one write held to it.

`aktionen.document_id` is the id a write touched, copied: **a redaction resolves it and nothing maintains it**.
The document it names may since have been edited, retired or removed outright with no row here brought up to
date, and the redaction is not the exception — it empties what a row recorded rather than matching it to what
its subject now says.

---

## What depends on what

`domain.py :: REFERENCES` carries every cross-collection reference with the **referential actions** it is held
to, and the reason for each. The vocabulary is SQL's because **MongoDB enforces none of it** — naming the
intended behaviour is the only way the intention is written down at all.

**The constraint and the triggered actions are separate columns**, because SQL packs into one `FOREIGN KEY`
what has to be written down separately here. `Reference.on_reference_created` is the constraint — whether the
write refuses a target it cannot resolve — and `on_target_change` and `on_target_removed` are the actions
riding on it. Model only the triggered actions and there is no slot for the constraint itself, which is how
half a referential check gets written and the other half never noticed.

**A `NO_ACTION` on the creating direction is a statement that nothing looks at the target**, and it covers
situations the notes keep apart. **Nothing reads the target at all**: a `saison_spieler` row may name a
person `spieler` does not hold, the path parameter naming them and no handler resolving it. **No REQUEST
creates the reference**: `spiele.spieltag_id` is on no payload and `/spiele` has no POST, so the one writer
that sets it — the season's draw — mints the matchday and the fixture pointing at it in the same
transaction and carries the check itself. **Or something is
checked and it is not the target** — a fixture's side and a squad row are both held to the season's
`saison_teams` entrants rather than to `teams`, and it is the junction's own entry that resolves the club —
`fl_backend/app/api/teams/admin_router.py :: post_saison_team` reads `teams` and 404s on an id it does not
hold — so either can carry a `team_id` no club document holds only through a junction row older than that
read. `fl_backend/app/core/constraints.py :: report_relations` is what surfaces such a row.

That last case is the one most easily misread as a constraint, and it is why those rows carry `NO_ACTION`
with the check they _do_ perform named in the note. A `RESTRICT` there would say the write itself resolves
the club, which these two do not — they lean on the entry that did.

**`aktionen` appears in `REFERENCES` in neither direction, on purpose** — nothing refuses a `document_id` it
cannot resolve, nothing rewrites one when its document changes, and nothing acts when that document goes, which
is the whole of what a row here would state. A write that reads the field is not a reference either;
[Aggregates](#aggregates) carries that reading.

### The fan-outs, and what they deliberately leave alone

A match embeds a **display copy** of its team, venue and referee beside the id, so a card renders without a
join. **No display copy rides on the match payload**: `PATCH /spiele/{spiel_id}` reads the row each id
names and composes the copy from it, so an editor left open across a rename cannot resubmit the old text
and undo the fan-out for that one fixture. A side's `name` and `shorthand` come from the season's
`saison_teams` row, a venue's `name` and `maps_link` and a referee's `name` from their own documents. The
bracket resolution is the one write that composes nothing — it moves a side that is already stored, and
carries that side's copy with it.

Each write path also fans a rename out into what already embeds it. A venue's and a referee's reach every
match, neither being season-scoped. **A club's reaches its `saison_teams` rows and its matches in the seasons
that are not `past`** — a finished season is the record of the name it was played under, which is what makes
the copy in its fixtures true rather than merely old.

What none of that touches is the point:

- a venue's **`mietpreis`** and a referee's **`payment`** do not fan out, and they are the fields that **stay
  on the match payload** while the names beside them are composed. Each is what _this fixture_ agreed to pay
  rather than a copy of a default, so fanning one out would rewrite history and composing one would replace an
  agreed figure with a current price nobody agreed to. **On the payload is not the same as on a read**: a
  base-tier fixture read serves neither figure, and which tier is served what is
  [`backend/spec.md`](backend/spec.md)'s `READ-*` rules.
- an **`austritt`** is not embedded at all. It is joined from the junction on every read, so recording
  one reaches every surface at once instead of needing a fan-out. How much of it a read serves is a separate
  question: a fixture's side and a league-table row carry which way the club left, and the record behind that
  stays on the club's own read — another of those `READ-*` rules.

### Retirement never cascades

Retiring a club, a person or a squad row touches nothing that points at it: a played fixture's
embedded team name is what that fixture said at the time. Retirement is _refused_ only where it would take
something live down with it, and the `REQ-RETIRE-*` rows of `domain.py :: RULES` are every such refusal there
is.

**What a retired row does lose is NEW work**, and that is the half easily missed: entering a retired club
into a season is refused (`REQ-ENTER-005`), and so is assigning a retired venue or referee to a fixture that
does not already hold it (`REQ-BOOKING-001`). Both judge the reference being made rather than the one already
stored, which is what keeps `REQ-RETIRE-003` and `REQ-RETIRE-004` able to let a venue or a referee retire
while played fixtures still name them.

### Deletion is rare, and each one is its own decision

Removal is normally a date rather than a delete: `inactive_since` retires a row and clearing it revives one.
Where a document is removed outright, the removal is what the operation is for rather than a side effect of
something else.

A confirmed **replace** of a season's draw removes that season's `spiele` and `spieltage` rows and writes
fresh ones, in one transaction. `REQ-SPIELPLAN-005` holds it to a season that is `future` and has nothing
recorded, so it destroys a schedule nobody has played. Neither collection is removed without the other, which
is why a `spiele.spieltag_id` still cannot dangle — not because nothing takes the matchday away, but because
nothing takes it away without the fixtures that point at it.

An **undraw** of a season's draw removes the same two sets and writes nothing back: it takes the season's
`spiele` and `spieltage` rows away and clears the `spielplan` watermark in one transaction, returning the
season to undrawn. `REQ-SPIELPLAN-006` holds it to the replace's window, so what it destroys is a schedule
nobody has played, and it judges that window on the OPERATION rather than on what there is to remove —
a season nobody has drawn is answered rather than refused, the state asked for being the state it is
already in. What it is FOR is [the rules below](#a-seasons-rules-are-the-interesting-case) rather than
tidiness.

A pupil's **erasure** removes the person and every one of their squad rows, and redacts that person's values
in the action log, as one transaction over all three. `REQ-PURGE-001` requires the person to be retired
first. Any one of the three alone would leave the erasure defeated while reporting success: the squad read
joins from the person outward, so an orphaned row is invisible, and a log row holding what was erased is
exactly the record the erasure exists to remove.

The absences that remain are decisions too. No endpoint removes a `saisons` document, because that
would orphan every `saison_id` in the database. No endpoint removes a `saison_teams` row either: a club
leaves a season by an `austritt` record, or by a replacement repointing that row at another club, and the row
survives both.

---

## When a field may be edited

`domain.py :: FIELD_POLICIES` answers this per field, wherever the answer is not plainly "whenever you like";
`domain.py :: Editability` defines the values it answers with. Who may READ a field is a separate axis neither
of them touches — [Where each layer enforces what](#where-each-layer-enforces-what).

**`COMPOSED` versus `DERIVED` is not a hair-split.** `spiele.ergebnis` is never accepted from a client and
_is_ stored, composed server-side so the string cannot disagree with the goals it formats.
`spieltage.anzahl_spiele` is on no document at all, and
`fl_backend/tests/core/test_domain.py :: test_a_derived_field_is_on_no_document` asserts the difference
against the `$jsonSchema` validators.

### A season's rules are the interesting case

There are three answers here, and a field can be under more than one of them.

- **Frozen once the season is `past`** (`fl_backend/app/api/saisons/services.py :: FROZEN_RULES_FIELDS`,
  `REQ-RULES-005`) — the league table is scored from these on every read and nothing records what they said
  before.
- **Frozen once the season's fixtures are drawn** (`:: SHAPE_RULES_FIELDS`, `REQ-RULES-011`) — the numbers
  the fixture list was generated from, fixed in either direction from the moment the season holds a fixture
  at all. Raising one of them is what nothing else refuses, and it would leave every matchday expecting
  matches nobody drew. **The freeze does not lift, and it is not a dead end**: a season's shape rules and its
  draw are ONE fact, so the numbers move only with the fixtures they produced — the draw's own payload carries
  them, and the transaction that removes the old fixtures writes the new numbers and draws from them together
  (`REQ-SPIELPLAN-005`). A patch is simply not the verb. **What the freeze turns on is the draw, never `status`
  alone**: an `active` season is held to its shape and so is a `future` one, and a finished season is told it is
  finished first. **What a replace can move is `qualifiers_per_group`**, which leaves the groups as they
  stand. It reaches neither of the other two: `REQ-SPIELPLAN-004` asks every offered group to hold exactly
  `teams_per_group`, and after a legal draw each of them does — so RAISING either number needs clubs entered
  first, and a drawn season refuses an entry, the group being full (`REQ-ENTER-003`) or not offered at all
  (`REQ-ENTER-002`). **That is what an undraw opens**: undraw, patch the rules, enter the clubs, draw again,
  with the group moves a drawn season locks (`REQ-ENTER-004`) open again in between. LOWERING either stays
  refused while the clubs stand (`REQ-RULES-002`, `REQ-RULES-003`), no endpoint taking a club back out of a
  season.
- **Never narrowed below what already exists**, because the data below would be stranded. What decides
  membership here is what the field bounds: `max_kadergroesse` caps stored squad rows and so may not drop
  below the largest squad a season holds, while `erlaubte_stufen` narrows freely even on a finished season,
  bounding what a **form offers** rather than what a stored squad row holds.

**Every one of these checks judges the step, not the endpoint and not the state it arrives in**, so a
date-only edit resubmits the whole `rules` object and passes whatever the stored values already say — which
is what keeps the dates repairable, and `docs/backend/spec.md :: I44` is the general form of it. `start_date`
and `end_date` sit on the season document rather than inside `rules` and stay editable on a finished season,
correcting a mistyped date changing nothing anybody competed for.

---

## What a write must do

`domain.py :: RULES` lists every refusal a write path performs, with its code, the operations that perform
it, the symbol that implements it and the test that covers it. What the table cannot show is what those
symbols have in common:

- each is a **pure function** — no I/O, so every one is tested without a database, in the default tier
- each is called by **the endpoint that owns the write**, never by a shared evaluator
- each refusal reaches the client as a **code**, with an English `detail` that goes only to the log; every
  code and the status it answers with is [`logging/error-codes.md`](logging/error-codes.md), and the German
  a person reads is written per feature in the frontend's actions
  (`fl_frontend/src/features/teams/actions.ts :: mapEntryRefusal` is one)

**A rule returns one shape**, `fl_backend/app/core/exceptions.py :: WriteRefusal` or `None`, and
`DocumentConflictException.from_refusal` is the only route from one to a response.
`judge_spieltag_occupancy` is the one signature that differs: it returns a `SpieltagVerdict` carrying a
refusal beside the moves it plans, because a clash against a manual side is resolved rather than refused. A
uniform `is_valid(operation) -> bool` cannot express that outcome, which is why there is no central
evaluator.

**`RULES` is not the whole list of what a match write does.** The bracket resolution backs no row in it and
**rewrites** fixtures the request never named.

### The checks run in the order somebody can act on

Within a rules edit the two freezes are reported first — the `past` one ahead of the draw one, so a finished
season is told it is finished rather than told to redraw fixtures it will never play — and the check
computing the season's whole schedule runs last.
`fl_backend/app/api/saisons/services.py :: find_rules_refusal` carries the sequence and the reason for each
position at the line;
`fl_backend/tests/api/test_rules_refusal.py :: test_the_freeze_is_reported_before_a_narrowing` and
`:: TestADrawnSeasonKeepsTheShapeItWasDrawnFrom` pin both halves.
Telling an admin their group count strands a team, watching them fix it, and _then_ saying the season is
closed anyway is a puzzle rather than an answer.

---

## What is deliberately not enforced

**An absence looks identical to an omission**, so `domain.py :: UNENFORCED` names each permitted state with
its reason and, where there is one, the surface that reports it instead. What selects the set: refusing would
block a legitimate act rather than a mistake — a season being set up passes through several of these states
on its way to being complete.

Where a state is reported, the report is a page and never a stored flag. Where an entry names no surface,
nothing reports the state.

### An entry has to earn its place, and then prove it

A reason a reader nods at is not evidence, so `domain.py :: Unenforced` carries the fields a check can act
on and `test_domain.py` acts on each:

- **`near`** is the entry bar. It names the refusal codes a reader would expect to cover this state and does
  not find, and an entry that can name none is not surprising anybody — the observation belongs as a comment
  at the line it concerns. Each code it names must be one the application actually defines.
- **`proven_by`** names a class of `fl_backend/tests/core/test_unenforced.py`, and the pairing is exact in
  **both** directions: an entry nothing executes fails, and a test class no entry claims fails with it. That
  is what keeps a declaration from decaying into the oversight it exists to be distinguishable from.
- **`surfaced_by`** is an address rather than a description — an `/admin` route or a repo path to the
  component — and it is resolved against the frontend tree, so an entry cannot go on claiming a person can
  see the state after the page showing it has gone. What that surface shows is `reason`'s to say.

---

## Where each layer enforces what

| Layer                          | Enforces                                                    | Why not elsewhere                                                        |
| ------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| **`$jsonSchema` validators**   | BSON types, required keys, closed enums                     | Only these fail _silently_; a bad range fails Pydantic on the next read  |
| **Pydantic models**            | Ranges, patterns, lengths, cross-field shape                | A validator cannot express them, and a wrong value is loud               |
| **`find_*_refusal` functions** | Everything spanning more than one document                  | No validator sees more than one document                                 |
| **The admin pages**            | Offering only legal choices, and reporting permitted states | A page may never be the only enforcement — a direct API call bypasses it |

The line between the validators and the models is itself tested:
`fl_backend/tests/core/test_constraints.py :: test_no_validator_constrains_a_range_or_a_format` fails a
validator that reaches past it. And **the pages narrow the offer and name what they cannot narrow; they
never replace the refusal** — the entry form disables a group it can see is full, the season editor raises an
illegal ratio beside the field that holds it
(`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/banners.ts :: buildSaisonBanners`),
and `find_rules_refusal` still runs either way, because a stale form and a direct request each reach the
endpoint.

**The table above is about validity — may this value exist? Read visibility is a different question: may
this caller see a value that legitimately does?** Neither the validators nor the refusal functions can settle
who may see it, both judging a document and never a caller: the guard on the router decides who may make a
read at all, and the response model decides what that read serves. Which tier is served which field is
[`backend/spec.md`](backend/spec.md)'s `READ-*` rules.

---

## Keeping this true

| If you                                                  | You must also                                                                                                                                                                                                                                       | Caught by                                                                                                                                                                                            |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add a `REQ-*` refusal under `app/api/`                  | Add its row to `RULES`, with an `implemented_by` that reaches the code and a `tested_by` that asserts on it                                                                                                                                         | `test_domain.py`                                                                                                                                                                                     |
| Answer with a code the API has not answered with before | Give it a row in [`logging/error-codes.md`](logging/error-codes.md) with the status it carries and restamp that page (CUR-3), and write its German where its feature maps refusals — [What a write must do](#what-a-write-must-do) names both sites | Nothing — an unmapped code falls through to what `fl_frontend/src/shared/utils/actionError.ts :: toActionErrorResult` answers a bare 409 with, telling an admin the entry duplicates one that exists |
| Move a refusal out from under the row that claims it    | Repoint `implemented_by`, or move the code with it                                                                                                                                                                                                  | `test_domain.py`                                                                                                                                                                                     |
| Rewrite a test class to assert on the message instead   | Leave the code in it, or repoint `tested_by` at a class that asserts on the code                                                                                                                                                                    | `test_domain.py`                                                                                                                                                                                     |
| Add a collection                                        | Place it in exactly one aggregate                                                                                                                                                                                                                   | `test_domain.py`                                                                                                                                                                                     |
| Give a collection an `inactive_since`                   | Declare when that field may be written                                                                                                                                                                                                              | `test_domain.py`                                                                                                                                                                                     |
| Add any other field that is not plainly editable        | Add its `FieldPolicy`                                                                                                                                                                                                                               | Nothing — the test resolves the policies that are declared and cannot see one nobody wrote                                                                                                           |
| Decide _not_ to enforce something                       | Add it to `UNENFORCED` with its reason, its `near` codes, its `proven_by` class and, where a page shows the state, its `surfaced_by`                                                                                                                | Every field of the entry, once the entry exists; nothing catches a state nobody declared                                                                                                             |

**What the test holds is the claim, never the address.** A callable at `implemented_by` is not enough: it has
to reach the constant holding that rule's code, same-module helpers followed, so a refusal that moved out
from under its row fails instead of passing on the strength of the function still being there. `tested_by` is
held the same way — the class it names must reach a name **imported** from the application that holds the
code. A string literal is refused on purpose, every code being bound to a named constant, so a test asserting
on the literal carries a second copy of it; and a class asserting on message substrings alone proves the
wording rather than the contract a client maps.

**`FIELD_POLICIES` is closed in its other direction at the one place that is mechanical**: every collection
whose validator declares `inactive_since` must say when that field may be written, and none of them can be
forgotten. Nothing can do the same where the editability is a judgement, which is why a field whose policy is
a judgement is the one row above with no check against it.

`fl_backend/tests/core/test_domain.py` runs in the default tier, so the rows it covers hold without anybody
remembering. It also enforces the invariant that keeps this a declaration — **no module under `app/` may
import `domain.py`** — because the moment production code reads these tables they stop being a declaration
and become an engine a write can forget to consult.

---

## See also

- **[`backend/spec.md`](backend/spec.md)** — the endpoint inventory and the backend's own invariants
- **[`glossary.md`](glossary.md)** — the German vocabulary, which is not optional
- **[`logging/error-codes.md`](logging/error-codes.md)** — every error code either service emits, and the response body and log line that carry it
