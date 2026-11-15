# Decisions

What this project never does, grouped by subject, a line closing on the harm it prevents in italics
where one is recorded. Each clause after a line's key is a separate never, and a semicolon joins
clauses that stand or fall together. A line changes only by a new decision of the owner, in the
commit that makes the change.

## The league

- **bracket** — Store the bracket's German label; flag an override beside `quelle`. _The frontend
  words every label, and a null `quelle` already marks a side set by hand._
- **bracket** — Store a bracket fault; report a merely undecided placing. _A fault is derived on each
  read, and an undecided placing is a running group's normal state._
- **draw** — Hardcode the qualifier cap. _A knockout round added to the phases would leave a typed
  cap wrong._
- **placings** — Recurse the tiebreak chain; seed a placing the group can still change. _A placing
  seeded early names the wrong team in the bracket once a later result overturns it._
- **saisons** — Drop the rollover guard. _A closed season never reopens, so its unfinished fixtures
  would stay unplayed for good._
- **spiele** — Denormalise season-scoped state into `spiele`. _A copy on each fixture goes stale when
  the season's row changes._
- **spiele** — Store a shoot-out's winner; let the table read the shoot-out. _A stored winner can
  contradict the counts, and kicks after the match are no league result._
- **spiele** — Refuse a `sonderereignis` that would overwrite a stored result; keep it out of the dry
  run's report. _A result a save destroys is named to the administrator before it is lost._
- **spiele** — Add a POST or a DELETE to `/spiele`. _The draw creates every fixture, and the bracket
  is wired to their numbers._
- **spieler** — Widen a squad row's `position` or `stufe` past their `Literal`s. _A value outside
  the set fails every read serving it._
- **spieltage** — Refuse a manual pick as unqualified; field a team twice in a Spieltag. _A manual
  side is usually a deliberate replacement, and no club plays two fixtures at once._
- **spieltage** — Derive a `Spieltag`'s position rather than reading it; write one outside the draw;
  store or serve its German label. _Fixtures are drawn against the stored place, and the frontend
  words every label._
- **spieltage** — Add a reorder endpoint; move the rollover off the season editor; re-sort the
  matchday tabs. _The draw fixes each matchday's place, and a second order would disagree with it._
- **swap** — Split the group swap into two writes; relax the move lock to serve it. _Half a swap, or
  a looser lock, leaves a group's clubs and its fixtures disagreeing._
- **swap** — Refuse a swap for anything beyond its pair, a finished season and the season's start;
  record an exit before the season's start date, or move the start past one. _The start is the
  swap's one lock, and an exit before it would let a swap field a departed club._
- **table** — Score or sort on `sonderereignis`. _A forfeit carries an event and an awarded result,
  and that result counts._
- **table** — Move the league table's default scope off `gruppenphase`. _A caller forgetting the
  scope would count knockout results as league results._

## The frontend

- **admin** — Give a shell page a second `h1`. _A second `h1` names the page twice in the outline a
  screen reader walks._
- **cache** — Fault staleness within the `minutes` lifetime after a change no save makes. _A
  background pass or a hand edit clears no tag, and the lifetime is what bounds it._
- **copy** — Word a field from anything but its patterns; add a pattern the owner did not approve;
  explain why or how on a status line. _Readers learn one approved phrase per job, and longer text
  wraps and shifts the page._
- **forms** — Judge a typed field between keystrokes; return the editor to a dialog. _Judging
  mid-typing raises errors, and a page gives every record an address to return to._
- **forms** — Confirm a clean save; raise the dialog on `info`. _A dialog on every save is clicked
  past, the warnings it exists for included._
- **motion** — Stop a loading indicator under reduced motion. _A frozen indicator tells the reader
  the wait has stopped._
- **pages** — Remove the `await connection()` from a session read, from `runWithIncomingTrace` or
  ahead of a cached read a render reaches before any request value. _The build would read the
  backend, and a prefetched shell would carry what a session decides._
- **saisons** — Offer in the form wiring the write path refuses. _A choice the save refuses fails
  only after the form is filled._
- **spiele** — Guess a voided result rather than dry-running it. _A guess can name the wrong fixtures
  whose results a save would delete._
- **spiele** — Write from the „Spiele“ list; save a match outside `saveSpiel`. _Only `saveSpiel` asks
  the dry run before a save deletes a later result._
- **structure** — Add a barrel file, an unrequired default export, a second nesting level below a
  slice's `components/<category>/`. _A barrel pulls a slice into client bundles, a default import
  compiles misnamed, and deeper folders scatter one kind._
- **swap** — Make the club editor the swap's home. _A swap is the season's act on two clubs._

## The backend

- **db** — Swallow a failed index build. _A unique index is the one guard against two writes racing
  for a key._
- **db** — Spell a collection name as a literal; enumerate the field names too. _A literal escapes
  the one declaration, and a field-name layer would be a hand-kept copy of every model._
- **routing** — Move a guard onto an endpoint; merge a slice's routers of different tiers; delete
  `GET /{id}`. _A guard on the router puts a wrong tier in a wrong file, and `GET /{id}` gives every
  resource one address._
- **routing** — Answer 422 for a malformed path id, or 404 for a query one. _A path names a
  resource, which a malformed id cannot, while a query carries input._
- **tests** — Mark a test `db` for a decision the default tier reaches. _A test runs once, at the
  lowest tier that sees it, and the db tier needs Docker._

## Operations and CI

- **ci** — Run a CI job, on any event, on fewer than every scope. _A map choosing scopes from changed
  paths left a scope unrun with every job green._
- **ci** — Re-add `actions/cache` for an image. _buildx fetches only the layers a build needs, where
  a cache step downloads the whole tarball._
- **exit codes** — Collapse a refusal into a failure; move one half of the exit contract alone. _A
  refusal judged nothing, and a code only one half knows passes in silence._
- **format** — Let the gate write a formatted file. _A gate that rewrites the tree reports on a state
  it was not pointed at._
- **images** — Merge the two images into one package; make either package private. _The deploy
  pulls with no registry login, and one package would mix two services' tags._
- **logging** — Log our own lines outside the envelope; patch or rewrite a library's or Next's
  console output into it. _One envelope joins our lines, and rewriting Next's output doubled every
  crash line._
- **nginx** — Precompress brotli at build time. _Stock nginx has no brotli module and proxies static
  files rather than serving them from disk._
- **patches** — Patch a dependency without its upstream issue named beside the entry; key a patch
  past one exact version; carry a patch across a bump unread. _pnpm refuses an exactly keyed patch
  at the next bump, so a reader checks its issue then._
- **tests** — Move db-marked tests out of the gate. _Only a real database proves what a pipeline
  returns._

## Security and data

- **auth** — Carry a return destination on the sign-in redirect without the allowlist first. _An
  unchecked address turns the sign-in into a redirect to any site._
- **austritt** — Ask a passkey touch for an Austritt
- **csp** — Disable `react/no-danger`. _The CSP allows inline scripts, so this rule keeps injected
  markup out._
- **db** — Add a second direct `MongoClient`. _League data reaches the database only through the
  backend, which validates every write._
- **grants** — Hold a second `owner`; make an owner outside the handover; make a removal wait; send a
  wait's notice only to the person who started it. _A wait started from a hijacked session must
  reach people who can raise the alarm._
- **migrations** — Add a one-off database migration to the tree, to a test or to a runbook. _It runs
  once against one database, then stays as code nothing runs again._
- **system** — Remove the system key. _The background passes, the Postausgang's hand-out and the
  sign-in's reads authenticate with it._
- **versions** — Give a part of a document a count of its own; guard a form's save by anything but
  the `version` of the documents it saves; let a person's own press on their own block that moves no
  field a form saves, or a job writing only bookkeeping no form saves, raise a record's `version`.
  _One count answers whether what a form showed has changed, so it moves for nothing else._
