# Decisions

What this project decided, where no tool or comment holds it. Each line names what is never done,
each clause after its key a separate never; a semicolon joins clauses that stand or fall together. A
line looks like a mistake to someone who does not know it was chosen, and changes only by a new
decision that replaces it, in the commit that makes the change. The argument for a line is at the
code it governs, or in the commit that first wrote its words, which `git log -S '<its words>'
--reverse` finds.

## The whole project

- **table** — Store or cache team statistics; hardcode 3/1/0; score or sort on `sonderereignis`
- **saisons** — Cache a season projection; remove its write-path drop or its TTL
- **structure** — Add a barrel file, an unrequired default export, a second nesting level below a
  slice's `components/<category>/`
- **images** — Merge the two images into one package; make either package private
- **migrations** — Add a one-off database migration to the tree, to a test or to a runbook

## The gate and CI

- **tests** — Move db-marked tests out of the gate
- **ci** — Run a CI job, on any event, on fewer than every scope
- **format** — Let the gate write a formatted file
- **exit codes** — Collapse a refusal into a failure; move one half of the exit contract alone

## The frontend

- **cache** — Make base tags conditional
- **spiele** — Move the Spiel write path to `admin`; let its form read `useAdmin()`
- **spiele** — Merge the three `SpielCard` variants
- **pages** — Remove an `await connection()` before a page fetch
- **lint** — Scope a cross-feature import lint to anything but `core` and `shared`
- **cache** — Cache an admin-scoped API read
- **build** — Enable the React Compiler
- **forms** — Judge a typed field between keystrokes; return the editor to a dialog
- **spiele** — Guess a voided result rather than dry-running it; scope the undo offer to the
  destructive save
- **admin** — Hide a triage tab on a zero count; order sections off anything but the label table
- **finalrunden** — Write from `/bereich/admin/finalrunden`; render its wiring as cards
- **admin** — Give a shell page a second `h1`; make a sidemenu `hint` optional
- **undo** — Send an undo through anything but its slice's server action
- **saisons** — Fetch the season list inside `resolveSaisonId` when `?saison_id=` is absent; drop
  `resolveSaisonId`'s redirect or `SaisonSelector`'s fallback
- **auth** — Carry a return destination on the sign-in redirect without the allowlist first
- **forms** — Confirm a clean save; raise the dialog on `info`; drop the undo when the dialog appears
- **swap** — Make the club editor the swap's home; grade a swap pair separately in each component
- **heroui** — Import HeroUI's CSS as one entry point, or out of HeroUI's order
- **toast** — Add a new `.toast*` rule to a stylesheet rather than building the appearance in
  `AppToaster`; call `toast` at a call site rather than `appToast`
- **css** — Leave a vendored overlay's zoom in place; write the app's scale override inside a
  `@layer`
- **motion** — Stop a loading indicator under reduced motion; freeze an ornament that rests visible

## The backend

- **models** — Give `saison_id` a Pydantic field default
- **db** — Swallow a failed validator or index; widen one past types and enums
- **db** — Generate the `$jsonSchema` validators from the models
- **routing** — Move a guard onto an endpoint; merge the two routers; delete `GET /{id}`
- **placings** — Recurse the tiebreak chain; seed a placing the group can still change
- **draw** — Store `anzahl_spiele`; hardcode the qualifier cap
- **db** — Spell a collection name as a literal; enumerate the field names too
- **routing** — Answer 422 for a malformed path id, or 404 for a query one
- **spiele** — Merge the cancellation count into the scoring lookup
- **tests** — Mark a test `db` for a decision the default tier reaches

## The seams between frontend and backend

- **db** — Add a second direct `MongoClient`
- **openapi** — Generate the Zod mirror; compare past presence, required, nullable, type, enum or a
  published ceiling
- **system** — Remove the system key
- **cache** — Add a second invalidation endpoint beside `fl_frontend/src/app/api/revalidate/route.ts`,
  a tag past its base-tag allowlist, or an edge location forwarding it; fault sub-24h staleness
- **csp** — Disable `react/no-danger`; add a second enforcing CSP
- **logging** — Let nginx honour a client's traceparent; log outside the envelope
- **bracket** — Store the bracket's German label; flag an override beside `quelle`
- **bracket** — Store a bracket fault; report a merely undecided placing; wrap a card without moving
  its role
- **table** — Move the league table's default scope off `gruppenphase`
- **saisons** — Offer in the form wiring the write path refuses
- **spiele** — Treat `mietpreis` / `payment` as stale copies of the defaults; denormalise
  season-scoped state into `spiele`
- **spiele** — Put the shoot-out in `ergebnis`; store its winner; let the table read it
- **spiele** — Refuse a `sonderereignis` that would overwrite a stored result; keep it out of the dry
  run's report
- **spiele** — Add a POST or a DELETE to `/spiele`
- **spiele** — Make `ausstehend` a partition, or `computeSpielStatus` a filter
- **saisons** — Make `inactive_since` a boolean; revive a retired row by creating it
- **saisons** — Add an austritt boolean beside the record
- **saisons** — Write `status` outside the activate endpoint; DELETE a season row; drop the rollover
  guard
- **spieltage** — Refuse a manual pick as unqualified; field a team twice in a Spieltag
- **spieltage** — Derive a `Spieltag`'s position rather than reading it; write one outside the draw;
  store or serve its German label
- **spieltage** — Add a reorder endpoint for `spieltage`; move the rollover off its page; re-sort its
  list
- **spieler** — Widen a squad row's `position` or `stufe` past their `Literal`s; drop `E2`
- **swap** — Split the group swap into two writes; relax the move lock to serve it
- **swap** — Reach the swap's disqualification refusal backwards; refuse a club standing on its own
  fixture

## Operations

- **nginx** — Disable origin compression; precompress brotli at build time
- **nginx** — Send `immutable` for a URL with no content hash
- **ci** — Pin `type=gha`'s version; share one cache scope; re-add `actions/cache` for an image
