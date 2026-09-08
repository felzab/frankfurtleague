# Ops — runbooks

**Purpose:** the recurring procedures that are run rather than read, and the operational facts no file in this repository states

The contracts these depend on — the services, the scripts, the gate scopes and the registry — are
[`spec.md`](spec.md); the pipeline a change travels from a branch to a deploy is
[`../_git/spec.md`](../_git/spec.md) §1.1.

| Section                                                                                                                        | Answers                                                        |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| [1. The server](#1-the-server)                                                                                                 | What a deploy does, and what a failed one leaves running       |
| [2. Before deploying a change to the database's constraints](#2-before-deploying-a-change-to-the-databases-constraints)        | The one check to run before a constraint reaches production    |
| [3. Granting or revoking admin access](#3-granting-or-revoking-admin-access)                                                   | Who can sign in, and what revoking actually ends               |
| [4. When the application queue has been flooded](#4-when-the-application-queue-has-been-flooded)                               | What the triage page still shows, and what stops new rows      |
| [5. When somebody asks for their data, or asks us to change it](#5-when-somebody-asks-for-their-data-or-asks-us-to-change-it)  | Where each role's data is read, and how a request is answered  |
| [6. When personal data has been exposed](#6-when-personal-data-has-been-exposed)                                               | The authority, the clock, and what the logs can establish      |
| [7. The logs' age bounds, and the copies a deploy leaves behind](#7-the-logs-age-bounds-and-the-copies-a-deploy-leaves-behind) | The host files that bound them, and where a deploy's copies go |
| [8. Putting the tunnel in front of the origin](#8-putting-the-tunnel-in-front-of-the-origin)                                   | The one deploy that has steps of its own, and its rollback     |
| [9. Checking that the retention sweep has run](#9-checking-that-the-retention-sweep-has-run)                                   | The one call that answers it, and what each answer means       |
| [10. The mail provider's dashboard](#10-the-mail-providers-dashboard)                                                          | The six steps no code can carry, and what breaks without them  |

---

## 1. The server

**The repository does not record which host this is**, and deliberately holds no credentials. Getting onto
the machine is outside the repository. What it does tell you:

- `deploy.sh` refuses to run anywhere but Linux, and runs from a **checkout of this repository on the
  server** — so putting a merge live is `git pull && ./scripts/ops/deploy.sh`, the pull being what brings the
  compose file and `nginx/prod.conf` up to date before the containers are recreated.
- `fl_frontend/.env`, `fl_backend/.env`, `./nginx/prod.conf`, `./secrets/tunnel_token` and `./certs/`
  must all exist beside the compose file — preflight checks each before anything is pulled.
- **Compose is asked whether it can parse its own configuration before anything is pulled**
  (`scripts/ops/deploy.sh :: check_compose_config`), a file it cannot read failing the recreate, the
  health read and the rollback in turn, none of which stopped a container. **It refuses at exit 2
  with nothing pulled or recreated**, and names the compose file and both environment files without
  printing what compose said, a parse error quoting the line it could not read
  ([`spec.md`](spec.md) §1.5). To see that message, run the same check on the server, where its
  answer is not being captured: `docker compose -f docker-compose.yml config --quiet`.
- **The pulled backend image is then asked to read `fl_backend/.env`** before anything is recreated
  (`scripts/ops/deploy.sh :: check_env_names`): compose hands the container its keys as variables,
  and the settings class looks up none but its own, so a typo there reads as an omission and the
  shipped default serves production. **A name the backend does not declare, or a value it will not
  accept, refuses the deploy at exit 2 with nothing recreated**, and the printed line names the
  variables and never a value — so the remedy is read off the names: **delete an undeclared line,
  correct a rejected value, or declare the name in the settings class**. A check that could not be made at all is an advisory the deploy goes on
  past. Two things it does not catch: a misspelling whose value is EMPTY, which the settings reader
  drops before the check judges it ([`../backend/spec.md`](../backend/spec.md) §1.5), and a quoting
  form the two parsers read differently ([`spec.md`](spec.md) §1.5).
- **The pulled frontend image is asked the same of `fl_frontend/.env`**
  (`scripts/ops/deploy.sh :: check_frontend_env_names`), and answers about names alone: the image
  carries the schema's key set rather than the schema, so **a name the frontend does not declare
  refuses the deploy at exit 2 with nothing recreated** and the remedy is one of three — delete the
  line, correct its spelling, or declare the name in the schema, nothing in that schema reading an
  undeclared one. A value it holds is judged at boot and nowhere else. It does catch the misspelling
  whose value is EMPTY that the backend's reader drops, and a line its reader cannot take at all is
  an advisory rather than a refusal ([`spec.md`](spec.md) §1.5).
- **Only the application containers are recreated**, and nginx is reloaded once they are healthy
  (`scripts/ops/deploy.sh :: serve_through_nginx`). The edge keeps running across the swap, so a deploy that
  succeeds costs seconds of 502 rather than a refused connection. The reload is also the only thing in the
  run that applies an `nginx/prod.conf` the pull changed: nothing recreates nginx for a mounted file's
  contents.
- **A build that fails the health wait is put back automatically** — to the images the application services
  were running when the deploy began, by image id rather than by tag (`scripts/ops/deploy.sh :: roll_back`) —
  and the script names the build now serving. **That path is not seconds**: the 502 runs until the restored
  pair is healthy and nginx has been reloaded again, up to about eleven minutes where both health waits run
  to their timeouts and the rollback's do the same. **The failed build's own two streams are copied off
  first** (`scripts/ops/deploy.sh :: copy_streams`), under the deploy's stamp and a `-failed` suffix in
  `/var/log/frankfurtleague/` (§7); that copy warns rather than refusing where it cannot be made, the site
  being down by then. Nothing is put back where preflight recorded no target,
  because nothing was running, because only half the pair was, or because compose could not be asked; nor
  where compose stops answering during the health wait, the run refusing at exit 2 instead, because a
  rollback undoes a build and nothing there reached a verdict on the new one.
- **A rollback is local to the server, and the registry still names the build that failed.** Nothing in
  the deploy path pushes or re-tags anything at ghcr, so `git pull && ./scripts/ops/deploy.sh` afterwards
  pulls the failed build straight back. **After a rollback, deploy by tag** — `./scripts/ops/deploy.sh <tag>`,
  the tag the rollback names — until a good build is published. Nothing is put back where the pull left
  `:latest` naming the images that were already running: restoring them would restore the build that
  just failed, and the script says so instead ([`spec.md`](spec.md) §4).
- After the health wait, what `deploy.sh` checks is the **running stack rather than a config file**: that
  nginx is running and reloaded, the security headers as they are actually served, and the liveness probe
  through the edge. `./scripts/ops/deploy.sh --status` reads that last one too — every other row it prints comes
  from a container, and a healthy pair is no statement about what the edge in front of it resolves to.

## 2. Before deploying a change to the database's constraints

```bash
cd fl_backend && .venv/Scripts/python -m app.core.constraints --check
```

Dev, on Windows; on the server it is `python -m app.core.constraints --check` inside the backend container.
It writes nothing and exit 0 means clean. Run it whenever `fl_backend/app/core/constraints.py` changes —
what it reports, and what a database user without `collMod` produces, are
[`../backend/spec.md`](../backend/spec.md) §4. `--apply` does the same work startup does, which is how to
put a corrected constraint in place without waiting for a deploy.

**Run it BEFORE the deploy, from a checkout carrying the new constraints while the old image is still
serving.** A container built from the previous commit carries the previous validators and reads clean on
the very documents the new ones reject, so the only run that answers the question is the one made against
the constraints that are about to land. Nothing later in the pipeline compares stored documents against a
validator.

**On the server that checkout reaches the container as a bind mount**, the image carrying an `app/` of its
own:

```bash
docker run --rm --network <compose-network> -v "$PWD/fl_backend/app:/app/app:ro" \
  -e MONGODB_URI=<uri> -e DB_BASE_NAME=<base> \
  -e API_TRUSTED_HOSTS=x -e API_CORS_ALLOWED_ORIGINS=http://x \
  -e INTERNAL_API_KEY_BASE=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  -e INTERNAL_API_KEY_SYSTEM=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  -e INTERNAL_API_KEY_ADMIN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  <backend-image> python -m app.core.constraints --check
```

**Seven variables are required and two carry real values.** `BackendConfig` declares seven fields with no
default, one per variable above, so `-e MONGODB_URI=` alone exits 1 on a validation error naming all
seven — an empty value being no URI, and `DB_BASE_NAME` being as much about the database as the URI
is. `--check` reads the database and nothing else, so the hosts,
the origins and the three keys need only take the shape the gate requires — **do not go looking for
the production ones**, and keep the origin's `http://`, which is the one placeholder above that a
constraint reads.

Two caveats, untested against the server itself: the image runs as `uid=100 fl_api_user`, so the mounted
`app/` must be readable by that uid, and an SELinux host needs `:z` on the mount.

**Counting a key's presence is not a substitute for the run.** The report reads each validator back as a
query, so it fails a document whose key is there with the wrong BSON type; a `$exists` count passes that
same document and reports clean.

**A validator that newly REQUIRES a field fails every row written before it.** `--check` is what says how
many and names a few of them, and back-filling those rows belongs to the change that added the field
rather than to a follow-up: `--apply` attaches the validator without touching stored documents, so the
first read that parses one is where the omission surfaces.

**A validator that WIDENS what it accepts can fail no stored row, and owes no backfill.** `--check` reads
clean before such a change lands as well as after, so the run is confirmation rather than the gate the
paragraph above describes. The `spieltage` span is of that kind: `beginn` and `ende` accept a null beside a
string, which every row already holding a date satisfies.

**A property declared OUTSIDE `required` is the weaker case, and only for a key nothing stores yet.** An
absent key passes, which is the whole of what `required` decides; a stored key of the wrong shape fails
exactly as it would inside the list. `saisons.spielplan` is declared that way, and `--check` is what says
whether any season already carries the key — declaring a shape over a key some row already holds is an
ordinary constraint change, and assuming which of the two you are in is what this procedure replaces.

**A collection the change ADDS is the free case, and `--check` says so by counting nothing.** The
namespace does not exist, so `report_violations` answers `0 of 0` and there is no backfill to hunt:
`_apply_validator` creates the collection with the validator already attached
(`fl_backend/app/core/constraints.py :: NAMESPACE_NOT_FOUND`), which either `--apply` or the deploy's
own boot reaches. A `0 of 0` against a collection you expected to hold rows is the case to stop on.

The order does not change either way: `--check` from the new checkout while the old image still serves,
then `--apply` or the deploy's own boot to attach the validators
(`fl_backend/app/core/db.py :: lifespan` applies them before it yields, so a new image attaches before it
serves), then `--check` again.

**A field that is RENAMED is the one case where the backfill cannot precede the validator, and the
`aktionen` column `trace_id` is that case.** The validator is attached strict
(`fl_backend/app/core/constraints.py :: _apply_validator`), and the previous one listed the old name
under `required`, so a `$rename` run under it produces a document missing a required field and is
refused for every row; the same strictness refuses an erasure's `$set` over a row the NEW validator
finds invalid ([`../backend/spec.md`](../backend/spec.md) I42), which is why the rename cannot wait
either. There is no migration runner in this repository; the steps are run by hand, from the same
container recipe as `--check` above, in this order:

1. `--check` from the new checkout while the old image still serves — every `aktionen` row is
   reported as missing `trace_id`, which is the confirmation that the rename is owed rather than a
   finding to fix.
2. Deploy. The boot attaches the new validator before the image serves.
3. **At once**, the rename — between this step and the previous one the log page's read fails on
   every old row and an erasure over one is refused, so type it as the deploy reports healthy:

   ```bash
   docker run --rm --network <compose-network> \
     -e MONGODB_URI=<uri> -e DB_BASE_NAME=<base> \
     <backend-image> python -c 'import os; from pymongo import MongoClient; db = MongoClient(os.environ["MONGODB_URI"])[os.environ["DB_BASE_NAME"]]; print(db.aktionen.update_many({"correlation_id": {"$exists": True}}, {"$rename": {"correlation_id": "trace_id"}}).modified_count, "rows renamed")'
   ```

   The image carries pymongo and no `mongosh`, which is why this is a Python one-liner, and it builds
   no `BackendConfig`, which is why only the two real values are passed; `$rename` is atomic per
   document, so no row is ever seen holding both names or neither. A count below the rows step 1
   reported means the update stopped at a row the new validator refuses for a reason of its own —
   `update_many` is ordered — so repair the row the raised error names and run the same command
   again, whose filter skips every row already renamed.

4. `--check` again: clean.
5. Drop the index the previous name held, by hand — `create_index` refuses a name held at different
   options and creates nothing under a name it does not declare, so the boot leaves it standing
   forever:

   ```bash
   docker run --rm --network <compose-network> \
     -e MONGODB_URI=<uri> -e DB_BASE_NAME=<base> \
     <backend-image> python -c 'import os; from pymongo import MongoClient; MongoClient(os.environ["MONGODB_URI"])[os.environ["DB_BASE_NAME"]].aktionen.drop_index("aktionen_correlation_id")'
   ```

The alternative order — `--apply` and the rename from the checkout, THEN the deploy — closes the
window for reads and erasures and opens a worse one: every recorded write of the still-serving old
image is refused until the new image is up, because it writes the old name.

**The contact seats' `erfasst_von` is that same case at a dotted path inside a fixed block.** The
previous name sits under `required` in
`fl_backend/app/core/constraints.py :: _KONTAKT_KENNTNISNAHME`, so the five steps above govern
unchanged; three things differ, and each changes what is typed or what the window costs.

- **One command covers both collections and reaches inside each seat.** A seat block holds fixed
  keys rather than an array (`fl_backend/app/core/constraints.py :: _KONTAKTE_PROPERTIES`), which is
  what lets `$rename` address one at all. **A null slot, and a `saison_teams` row whose whole
  `kontakte` block is null, are the case to confirm against the staging copy before this is typed at
  production**: the source field does not resolve, which should pass the document over untouched,
  and a `$rename` that instead refused the whole document would stop the ordered update at the first
  retired club.
- **No index holds the previous name**, so step 5 has no counterpart: nothing declares one over this
  field, and the boot builds none.
- **The window costs every ADMIN read of a contact block, which is wider than step 3's warning.**
  `fl_backend/app/api/teams/schemas.py :: FLKontaktKenntnisnahme` requires the new name, so between
  the deploy and the rename the contacts editor, a club's season panel and the whole application
  queue answer 500 on every stored row — `fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbung`
  declares the same block. A junction contacts save over an already-confirmed seat raises too,
  `fl_backend/app/api/teams/services.py :: _confirmation_held_by` indexing the key directly. **A contact person's own confirmation link still OPENS**,
  serving no contact record (`READ-BEWERBUNG-002`) -- but the answer behind its button is a write
  over the same block and is refused with everything else, so a person who confirms or objects in
  this window is told nothing landed. Every public club read keeps working, the junction join withholding the block
  from the base tier ([`../backend/spec.md`](../backend/spec.md) I50).

```bash
docker run --rm --network <compose-network> \
  -e MONGODB_URI=<uri> -e DB_BASE_NAME=<base> \
  <backend-image> python -c 'import os; from pymongo import MongoClient; db = MongoClient(os.environ["MONGODB_URI"])[os.environ["DB_BASE_NAME"]]; moves = {f"kontakte.{s}.einwilligung.erteilt_von": f"kontakte.{s}.einwilligung.erfasst_von" for s in ("ansprechperson", "stellvertretung", "trainer")}; print({c: db[c].update_many({"$or": [{k: {"$exists": True}} for k in moves]}, {"$rename": moves}).modified_count for c in ("saison_teams", "bewerbungen")}, "rows renamed")'
```

Both collections move in one invocation, so the two cannot be left half a deploy apart; the `$or`
filter is what makes a re-run after a raised error skip the rows already moved, as step 3's does.

**A change that only adds a read index has nothing for `--check` to answer**, and a clean report is not
evidence it landed: those indexes constrain nothing, so no stored document can be in breach of one
(`fl_backend/app/core/constraints.py :: SupportIndex`). `--apply` or the next boot is what builds it, and
either fails loudly if it cannot.

**A changed RETENTION bound is the one index change that stops the deploy.** `create_index` refuses a
name already held at different options rather than moving it, so `apply_constraints` raises and
`fl_backend/app/core/db.py :: lifespan` fails the boot — the old bound still serving, which the
refusal does not say. Move it at the keyboard first, from the same shell the `--check` above runs in:

```javascript
db.runCommand({ collMod: "aktionen", index: { name: "aktionen_retention", expireAfterSeconds: <new> } })
```

Dropping the index instead also works, the next boot rebuilding it at the declared bound; `collMod`
is the smaller window, no read losing the index in between. `<new>` must equal
`fl_backend/app/shared/schemas/bounds.py :: AKTION_RETENTION_SECONDS` in the checkout about to
deploy, or the boot raises on the difference that is left. Mirrored from
https://www.mongodb.com/docs/manual/reference/command/collMod/, which moves without us; read
2026-09-04.

**When `every junction row names a club that exists (saison_teams)` reports a group**, it has found a
`saison_teams` row whose `team_id` matches no `teams` document. Nothing on the API produces one now — entry
reads the club and answers 404 for an id `teams` does not hold
(`fl_backend/app/api/teams/admin_router.py :: post_saison_team`), and the acceptance that also writes these
rows either creates the club in the same transaction or takes the id from the club document it resolved
in-session (`fl_backend/app/api/bewerbungen/admin_router.py :: annehmen_bewerbung`) — and nothing on the API
removes one, the junction having no DELETE. **That says nothing about where the row came from.** A row older than that read
arrived through `POST /teams/{team_id}/saisons` itself: entry resolved no club then, so a `team_id` that was
well-formed and wrong inserted a row with nobody touching the database at all. It is invisible from the side
worth checking first: `GET /teams` starts from `teams` and never joins the orphan, so the club list and every
league table read normally.

**Which reading is right is a judgement, and one of the two has a command behind it.** An id mistyped at entry names
a club that never existed, so there is nothing to restore and the row's place belongs to whichever club should
have been entered instead: `POST /teams/{team_id}/saisons/{saison_id}/replace` hands the row over, reseeding
its `name` and `shorthand` from the incoming club and carrying that club into the season's fixtures. It
resolves the INCOMING club alone and never the one the path names, which is exactly what lets it act on a row
whose `team_id` resolves to nothing (`fl_backend/app/core/domain.py :: REFERENCES`). Its own refusals bound how
far it reaches: not a `past` season (`REQ-REPLACE-001`), and not once one of that club's fixtures has left a
record (`REQ-REPLACE-002`). An orphan in a season that was played is therefore still a database edit, and so
is one whose place no club should hold at all: the replacement brings a club in for one going out, and removes
no row.

A club document that went missing is the other reading, and restoring it is that repair — but no route deletes
a club, retirement being soft and leaving the document in place
(`fl_backend/app/api/teams/admin_router.py :: delete_team`), so that history needs a database edit of its own
before it is worth acting on. **Settle which reading applies before running anything**: the replacement writes
a club into the season's record, so run on the second reading it names a club that never played. Only somebody
who knows whether that club played that season can say. Re-run `--check` afterwards.

**The junction failure that does stop the site is the other report**, the validator one: a `saison_teams`
row missing `name` takes `PATCH /spiele/{spiel_id}` down for every fixture in that season, the save and
its `dry_run` preview alike, because `fl_backend/app/api/spiele/crud.py :: pull_saison_membership` indexes
that field directly — and it takes the season's club reads with it: the name is what
`fl_backend/app/api/teams/services.py :: build_team_pipeline` projects, and `GET /teams`, `GET /teams/{team_id}`
and the admin twin `GET /teams/list/admin` (`fl_backend/app/api/teams/admin_router.py :: get_teams_for_admin`)
are each built on that pipeline. **It does not stop at that season's own reads:**
`fl_backend/app/api/spiele/crud.py :: find_bracket_faults` derives the whole archive's faults in one request
and resolves every season whose knockout slots draw on a group placing against that same pipeline, so one
such row fails `GET /spiele/action_required` for the entire league — a `past` season's row
included, which is the one nobody thinks to suspect. The two reports are independent: an orphan row can carry
a perfectly good name, and a row missing its name can name a club that exists.

## 3. Granting or revoking admin access

Editing `ALLOWED_ADMIN_EMAILS` and restarting is the whole procedure; why a restart is needed and how `role`
is re-derived afterwards are [`spec.md`](spec.md) §4. Two things follow that are easy to get wrong:

- **The session row is not the grant.** It stays in the `authjs` database after a revocation and authorizes
  nothing, so deleting it by hand is tidying rather than revocation.
- **An admin ending their own session needs no restart at all**: the sidemenu's options menu carries a
  sign-out, which arms on the first press and ends the session on the second.

## 4. When the application queue has been flooded

**The state announces itself, and the read degrades rather than refusing.** `GET /bewerbungen` serves at most
`LIST_LIMIT_DEFAULT` rows and reads one row past that to answer whether more exist, so it never counts the
filtered set (`fl_backend/app/api/bewerbungen/router.py :: get_bewerbungen`). Where more do exist it answers
`vollstaendig: false` and the triage page raises a standing warning that cannot be dismissed
(`fl_frontend/src/features/bewerbungen/components/ui/BewerbungenUnvollstaendigNotice.tsx ::
BewerbungenUnvollstaendigNotice`). Answering short and saying so is the deliberate choice over refusing past a
threshold: these rows are written by an anonymous public form, so a hard failure would hand whoever writes
them the power to decide when the page stops working.

**What truncation costs first is duplicate detection, which is why the notice leads on it.** Colliding
applications are marked across the rows that came back — derived from the whole loaded list rather than the
filtered one, so a search or a facet cannot take the mark off a pair
(`fl_frontend/src/features/bewerbungen/components/views/AdminBewerbungenView.tsx`). A pair split across the
truncation boundary is not marked, and the notice says plainly that which pair went unmarked is not knowable
from the page. Treat duplicate marking as unreliable for as long as the notice stands.

**The facet counts are the second thing to distrust, the status one excepted.** Every other facet counts the
loaded rows alone, so a zero means zero among what came back rather than zero in the queue; the status counts
come from the server and hold whatever the read was cut to.

**Reversing the read is the recovery the page offers, and the only one.** The default order is newest first,
so what a cut-short answer keeps is the newest rows and what it drops is the oldest — which is exactly where
applications submitted before a flood sit. The notice names which end is loaded and links to the other, the
link reading `die ältesten zuerst laden` on a default view
(`fl_frontend/src/features/bewerbungen/utils.ts :: leserichtungHref`, with `:: parseLeserichtung` reading the
`order` parameter back and treating anything unexpected as the default). The page sends `order` and the status the
bar selects (`fl_frontend/src/features/bewerbungen/facets.ts :: bewerbungenQueueStatus`).

**The reversed view is not a complete one, and the notice says so about itself.** It closes on `Auch diese
Ansicht bleibt unvollständig` whichever end is loaded. Reversing swaps which rows are missing; it does not
reduce how many are.

**Narrowing by status is offered and buys nothing here.** The server sets `status` on write, so every
flooded row is `eingereicht` and the queue's own default already selects them; season narrowing is not
offered and would not separate a flood either, a submission being admitted only while one season's window
is open (`fl_backend/app/api/bewerbungen/services.py :: find_window_refusal`). Reaching `saison_id` anyway
would mean a backend call, and the edge carries exactly one backend path
(`= /api/v0/system/is_live`, [`spec.md`](spec.md) I13), so it would have to be made on the server against
the backend container. Nothing in this repository wraps that.

**Declining does not shrink the working set.** A decided application stays listed, the record being what the
decision was taken against (`fl_backend/app/api/bewerbungen/router.py :: get_bewerbungen`), so an operator who declines down the queue and sees the
notice unchanged has not found a fault. Removal is not an alternative either: the collection's whole write
surface is the two decisions (`fl_backend/app/api/bewerbungen/admin_router.py :: annehmen_bewerbung` and
`:: ablehnen_bewerbung`) plus the public submission, so a flooded row stays.

**Closing the window is what stops new rows**, and it is the season's own edit rather than anything here. The
`offen` flag and the span beside it are the season editor's application section
(`fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/FormBewerbungSection.tsx`), reaching
`PATCH /saisons/{saison_id}`; the window guard reads that flag on every submission, so a closed window
refuses the next one without touching a row already written.

**The rate limit buys time rather than prevention.** `= /api/bewerbung` carries a paired ceiling of 2r/m on
one /64 and 6r/m on one /48 ([`spec.md`](spec.md) §1.3 for why the pair and why the wide half sits below the
others), which puts filling the list from a single /48 at roughly three hours of sustained work rather than
minutes. It does nothing about a flood spread across many allocations, and `limit_conn 50` on the catch-all
is the only ceiling on concurrency — a backstop rather than a per-visitor control, and the one figure in that
section never exercised against a real page load.

## 5. When somebody asks for their data, or asks us to change it

Access, rectification, objection, restriction, portability and the withdrawal of a consent all
arrive the same way and are answered by one person by hand. Erasure has its own three mechanisms and
is [`../datenschutz.md`](../datenschutz.md#5-erasure-reaches-everyone-who-asks)'s; everything else is
this section.

**Every request arrives at the league's mailbox**
(`fl_frontend/src/core/brand.ts :: KONTAKT_EMAIL`, the address the notice and every message send a
reader to), and the answer goes back from it. There is no ticket system: the mail thread is the
record, and the action log records the writes you make rather than the request that asked for them.

**Establish who is asking and in which role, because the data sits somewhere different for each.**
One person can hold several — a referee is a pupil, and a contact person can be both.

| Role           | Where their data is read                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Pupil          | `/admin/spieler/{spieler_id}`, and the squad rows under each season                                                                 |
| Referee        | `/admin/schiedsrichter/{schiedsrichter_id}`, plus every past fixture that embeds the name                                           |
| Contact person | `/admin/kontakte/{team_id}` for the season's block, and `/admin/bewerbungen/{bewerbung_id}` for the application it was collected on |
| Administrator  | The sign-in store — the second database, holding the address, the sessions and the sign-in tokens                                   |

`/admin/aktionen` answers what was written about them and by whom, and is the only place that
question is answered at all. A row past the log's own expiry is gone
(`docs/backend/spec.md :: I119`), so establish the window before promising a period.

**There is no export route, so an access request is answered by composing what those pages show.**
Send the categories, the values, where each came from, who receives them
([`../datenschutz.md`](../datenschutz.md#7-processors-and-third-parties)'s processor table), how long
they are kept, and the address for a complaint to the supervisory authority. Point at the published
notice (`fl_frontend/src/features/meta/components/views/DatenschutzView.tsx`) for the standing text
rather than restating it in the mail.

**How long a record is kept is answered by its own clock rather than by hand.** A declined
application, an accepted one and a season's contact block are each removed by the retention sweep
(`docs/backend/spec.md :: I150`); an application nobody confirmed is deleted after its deadline, its
submitter told first (`docs/backend/spec.md :: I151`); and a log row stamped with its write date
expires on I119's bound.

**A rectification is the ordinary admin edit**, made on the page above. Two carry a trap worth
reading before you save: a club rename fans out into the matches of every season that is not `past`
([`../glossary.md`](../glossary.md#spiel--one-match)), and a referee rename fans out into every
season's matches, a referee not being season-scoped.

**A withdrawal is an erasure, and a contact seat has one case where it is not.** Which of the three
you are in is decided by that seat's own link, not by the person's role:

- **The seat is unanswered and its link still works.** Their own Widerspruch, on the confirmation
  page the link opens, empties the seat at once and tells the submitter so the school can name
  somebody else (`fl_backend/app/api/bewerbungen/einwilligung_router.py :: post_einwilligung`).
  Send them the link again rather than erasing for them; the record then says the person refused
  rather than that an administrator removed them.
- **The seat has already answered, or the link is over.** A seat that has confirmed or already
  contradicted takes no second answer (`REQ-BEWERBUNG-011`), and a link whose deadline has passed or
  whose application has been decided takes none either (`REQ-BEWERBUNG-010`) — both are refusals the
  person meets on the page, not something to talk them through. The route is `POST /kontakte/erasure`
  like any other.
- **The application has been decided.** `POST /kontakte/erasure`, as above.

**Objection, restriction and portability have no mechanism and need none at this scale.** Answer the
person in writing: say what is held, on what basis, and what you have done. Where a restriction is
agreed, the only reliable form it can take here is removing the data, which is the erasure route.

**Two things belong in every answer that touches a deletion.** Backups outlive it by the snapshot
window and the person is told so
([`../datenschutz.md`](../datenschutz.md#5-erasure-reaches-everyone-who-asks)); and an erasure is
keyed on an email address, so it clears every seat that address holds, in every season and both
collections. The confirmation names the person whose panel you started from and lists nothing else
the address matches
(`fl_frontend/src/features/kontakte/components/forms/AdminKontakteEditForm/FormKontaktErasure.tsx`),
so establish yourself whether a school inbox is shared before pressing, and read the counts the
result reports afterwards — they are what say how far the write reached.

**Answer as soon as what you need is gathered, and where it will take longer say so in the first
reply rather than after it.** Where the answer needs the Datenschutzexperte, the person is told that
in the same reply.

## 6. When personal data has been exposed

A personal-data breach is reported to **Der Hessische Beauftragte für Datenschutz und
Informationsfreiheit** in Wiesbaden, through its Art. 33 form at datenschutz.hessen.de, **within 72
hours of becoming aware of it** — requesting the upload link does not stop that clock. That is
mirrored from the authority's own pages, which move without us and were read on 2026-09-02.

The clock starts when a person becomes aware, and nothing here raises an alert, so the first minutes
are yours to spend on the two steps below rather than on looking for one.

**Copy the container logs off the server before you deploy anything, the fix included.** The
application services' logs live inside their containers and every deploy recreates both
([`../logging/spec.md`](../logging/spec.md) §1.2), so a deploy destroys the evidence you are about to
be asked for. nginx is not recreated by a deploy and carries its own across it. On the server:

```bash
docker compose logs --no-color --timestamps backend > backend-$(date +%F).log
docker compose logs --no-color --timestamps frontend > frontend-$(date +%F).log
```

**What those logs can and cannot answer.** Retention is the container runtime's size rotation
(`docs/logging/spec.md :: 1.2`), so a busy period rotates its own oldest lines away
and the window is set by traffic rather than chosen. The edge's access line carries the visitor's
address, user agent and referer with the credential arms redacted
(`docs/logging/spec.md :: L11`), so neither a sign-in token nor a confirmation token is in it; the
same request line reached Cloudflare unredacted, and what Cloudflare keeps is settled in its
dashboard rather than here.

**The durable answer to "what was changed, and by whom" is the action log rather than a container
log.** Every recorded write appends a row carrying the actor, the route, the collection, the
operation and the image of what the write replaced or removed
([`../glossary.md`](../glossary.md#aktion--one-recorded-write-and-what-it-replaced-or-removed)), read
at `/admin/aktionen`. A row whose values an erasure destroyed is emptied in place and stamped
(`docs/backend/spec.md :: I42`), so what survives an erasure is that the write happened and not what
it held.

**Then, in this order:** contain it; establish which people and which categories are affected, from
the two records above; report inside the 72 hours with what is established and what is not — a report
may be completed later, and a late one may not; and tell the people affected wherever the risk to
them is high. Write down what you established and when you established it: the authority asks, and
the container logs outlive a deploy only as the copies [section 7](#7-the-logs-age-bounds-and-the-copies-a-deploy-leaves-behind)
bounds to thirty days.

## 7. The logs' age bounds, and the copies a deploy leaves behind

**Every deploy copies both application streams to `/var/log/frankfurtleague/` before it recreates a
container** (`scripts/ops/deploy.sh :: copy_streams`), one file per service stamped to the second, and
refuses at exit 2 with nothing stopped where it cannot write there. **A deploy that rolls back
recreates the pair twice and so copies twice**, the failed build's streams taking the same stamp and a
`-failed` suffix, so a failed deploy leaves four files that sort together (§1). The same step creates
`/var/log/frankfurtleague/nginx`, which `docker-compose.yml` bind-mounts as the edge's access log —
the one application-visible stream that is a host file rather than a container's. Both are created
by the deploy where it can; on a host whose deploying user is not root, create them once by hand:

```bash
sudo install -d -o "$USER" -g "$USER" /var/log/frankfurtleague /var/log/frankfurtleague/nginx
```

**The age bounds are four host files no file in this repository can install** — written on the
server in the same deployment that ships the published texts stating them
([`../datenschutz.md`](../datenschutz.md) §6): eight days for the access log, thirty for the copied
application logs. **They are two mechanisms because they are two kinds of file.** The access log is
open and growing, so its bound is a rotation the edge has to be told about; a deploy's copy is
written once and never appended, so its bound is a deletion, and a rotation of it renames a file
nothing will ever add a line to.

**The access log, at `/etc/frankfurtleague/access-log.conf`.** Substitute the server's own checkout
path for `<checkout>` — `docker compose` takes its project name from the directory holding the file
`-f` names, so a path pointing anywhere else finds no `nginx` service and the rotation goes on
without the reopen. Spell `docker` with the path `command -v docker` prints if it is not on
systemd's own PATH, which is what this runs under rather than a login shell's.

```text
# nginx writes this file through a bind mount, so it outlives the container and can be rotated by
# rename: the master reopens on USR1 and the renamed file stops growing, the lines written in
# between having gone to the renamed file rather than nowhere.
/var/log/frankfurtleague/nginx/access.log {
    daily
    # Seven dated files plus the live day is the eight days the notice publishes. `maxage` is the
    # backstop for a gap in the timer, and drops a dated file once its last line is eight days old.
    rotate 7
    maxage 7
    # The disk stays bounded whatever the traffic: a day that outgrows this rotates early, so the
    # eight days above are the most an entry lives, never a period a spike can stretch.
    maxsize 100M
    dateext
    # Seconds in the name, because a day can hold more than one rotation: under a bare `-%Y%m%d`
    # the second one lands on the name the first took, and logrotate skips it and exits 1.
    dateformat -%Y%m%d-%H%M%S
    create 0640 root root
    missingok
    # No `notifempty`: after a failed reopen the live file is empty, and skipping empty files would
    # skip every rotation after this one, so nothing would ever send USR1 again.
    compress
    delaycompress
    postrotate
        docker compose -f <checkout>/docker-compose.yml kill -s USR1 nginx
    endscript
}
```

**Read once with `logrotate -d -s /var/lib/logrotate/frankfurtleague.status /etc/frankfurtleague/access-log.conf`**,
which rotates nothing, before the first real run. It runs no `postrotate` script, so the reopen
stays unproven until the first real rotation.

**A failed reopen leaves an empty `access.log` beside a dated file that keeps growing**: the rename
has happened and nginx still writes through its open descriptor, and nothing on the host says so —
the timer's later runs exit 0. `ls -lt /var/log/frankfurtleague/nginx/` shows it, the live file at
zero bytes under a dated file with a newer mtime. The next rotation sends USR1 again and recovers,
losing only the lines written to the orphaned file between its compression and the signal.

**That file is deliberately not in `/etc/logrotate.d/`**, and the pair below is what runs it: a size
cap only bites at the moment logrotate runs, and the host's own invocation is daily, so a spike
between two of them is unbounded. One config file read by one scheduler against one state file of
its own is what keeps the two from rotating the same log twice with two ideas of when it last
happened.

```text
# /etc/systemd/system/frankfurtleague-logrotate.service
[Unit]
Description=Rotate the Frankfurt League access log

[Service]
Type=oneshot
ExecStart=/usr/sbin/logrotate -s /var/lib/logrotate/frankfurtleague.status /etc/frankfurtleague/access-log.conf
```

```text
# /etc/systemd/system/frankfurtleague-logrotate.timer
[Unit]
Description=Hourly size check on the Frankfurt League access log

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
```

**The deploy's copies, at `/etc/tmpfiles.d/frankfurtleague.conf`.** `systemd-tmpfiles-clean.timer`
is what runs it — systemd ships that timer enabled, through its own `timers.target.wants`, a quarter
of an hour after boot and daily after that — so the thirty days need no scheduler of their own. **The
line ages the directory rather than a name**, so every copy a deploy writes into it is reached
whatever it is called — the `-failed` pair a rollback leaves included, and any suffix a later change
adds. The command below is what confirms it is running on this host.

```text
# Aged by mtime alone: a copy's mtime is the moment the deploy wrote it, while its ctime moves for a
# chown or a relabel, and any of the three being recent is enough to keep a file otherwise.
e /var/log/frankfurtleague - - - m:30d
# The line above reaches every level below it, and the live access.log is one of them: on a quiet
# month the cleaner would delete a file nginx still holds open, and the writes would go nowhere.
x /var/log/frankfurtleague/nginx
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now frankfurtleague-logrotate.timer
systemctl list-timers frankfurtleague-logrotate.timer systemd-tmpfiles-clean.timer
sudo systemd-tmpfiles --clean --prefix=/var/log/frankfurtleague
```

**The last of those is also how this host answers whether it reads the age qualifier at all**: one it
cannot parse is an error naming the file and the line, an exit of 65, and nothing deleted — never a
line skipped in silence.

**What each shape refuses, and why the obvious one is not here:**

- **A second `logrotate` stanza over `/var/log/frankfurtleague/*.log`** reaches a copy once. The
  first run renames it out of the glob, and `maxage` prunes what logrotate still finds a source for,
  so nothing looks at the file again. `olddir`, a `postrotate` or `dateext` off each move the name
  around and leave that unchanged.
- **`find -mtime +30 -delete` from cron** deletes the same files, and costs a second scheduler and a
  file stating an age that `tmpfiles.d` already states declaratively.
- **Numbered rotation instead of `dateext`** never collides, because every rotation renames every
  older file. It also takes the date off the names, so a file's age is readable only from its mtime
  and never from the listing an operator is already looking at.
- **`dateformat -%Y%m%d-%s`** sorts identically and reads as a number nobody can date by eye.
- **Leaving the stanza in `/etc/logrotate.d/` and making the host's `logrotate.timer` hourly** is one
  file fewer and changes the cadence for every other package on the machine.

**Two rotations inside one second still collide**, the name carrying seconds and no more: an hourly
timer cannot reach that, and two runs by hand can.

**Nothing here rotates the containers' own `json-file` logs**, whose whole bound is the compose size
cap (`docker-compose.yml :: x-logging`): the only way to rotate a file the runtime holds open is
`copytruncate`, and a truncate landing mid-line leaves a partial JSON document in a file read as one
document per line — which is what `docker compose logs` reads, and what the deploy's own copy-off
above runs. The copies are what carry an application log past a deploy, and their thirty days is the
only age bound over one.

**The rotated file ends up owned by uid 101 rather than root**: nginx's master chowns each log it
reopens to the user its configuration names, which is the image's `nginx`. `create 0640 root root`
is what the rotation leaves, and the first line written after the reopen changes that ownership;
reading the file needs the host's root either way.

## 8. Putting the tunnel in front of the origin

**The deploy that first runs `cloudflared` is the only one with steps of its own**, and every one of
them is either in the Cloudflare dashboard or in front of `deploy.sh`. A later deploy has none.

1. **Issue the tunnel's token in the dashboard and put the value on the server** at
   `./secrets/tunnel_token`, beside the compose file and readable by root alone. `.gitignore` covers
   `secrets/`, so a checkout that holds the credential still cannot commit it, and preflight refuses
   the deploy by name where the file is absent ([`spec.md`](spec.md) §1.2).
2. **Read the two env files against the documented shapes before anything comes down.**
   `fl_backend/.env` against [`../backend/spec.md`](../backend/spec.md) §1.5 and `fl_frontend/.env`
   against [`../frontend/spec.md`](../frontend/spec.md) §1.7 — the key lengths and the origin lists
   especially, since both are pinned exactly and preflight reads the backend's names and values but
   only the frontend's names (`docs/ops/spec.md :: I181`, `:: I183`). A value the frontend's startup
   gate refuses surfaces after step 3 has removed the containers that were serving, inside the dark
   window step 5 is about.
3. **Take the stack down first:** `docker compose -f docker-compose.yml down`. The network on the
   host was created before any subnet was declared and before Compose began recording a
   configuration hash on the networks it creates; a network carrying no such record is reused by
   `up` as it stands, whatever the file now declares (Compose reconciles only a network whose
   recorded hash diverged), so the connector's static address would be refused at container-create
   time — after nginx had already given up its published ports. `down` removes the network with the
   containers, and the next `up` creates it carrying the declared subnet. The old network is left
   behind only where something outside this compose file still holds it.
4. **Deploy, add the two public hostnames in the dashboard, then read
   `./scripts/ops/deploy.sh --status`.** The site is dark from the recreate until those hostnames
   route, because DNS still names an origin that now publishes nothing. Each hostname's origin
   settings are [`spec.md`](spec.md) §1.8's; an ingress pointed at the plain port meets the
   redirect block and loops on its 301 rather than failing.
5. **Expect that run to exit 1 and to put nothing back.** The security-header read and the liveness
   probe both run after the health check and both fail into that dark window, while
   `scripts/ops/deploy.sh :: roll_back` is reached from the not-healthy branch alone — so a `fail`
   naming `/api/v0/system/is_live` there is the window being observed rather than a reason to
   intervene.

**This one deploy's rollback is `git revert` of the change and a redeploy, not `deploy.sh`'s own.**
That path restores IMAGES, and what would be wrong here is the topology: only the reverted commit
puts the `ports:` block back and stops the connector, and re-running the deploy after it is what
applies them. Step 3 leaves preflight no running pair to record besides, so there would be nothing
for it to restore in any case (§1).

## 9. Checking that the retention sweep has run

**One call answers it**, on the system key, against the origin rather than through the tunnel:

    curl -s -H "x-api-key: $INTERNAL_API_KEY_SYSTEM" http://localhost:8000/api/v0/bewerbungen/sweep

**`sweep_gelaufen_am` is the day the last pass ran, and it is today or yesterday on a healthy
stack.** A pass that reminds nobody and deletes nothing records it exactly as a busy one does
([`spec.md`](spec.md) §1.1), so the date is the answer and the absence of log lines is not.

**Null means no pass has ever run against this database**, which on production is one of the ways
[`spec.md`](spec.md) §1.1 lists: `BEWERBUNG_SWEEP` off, `fl_frontend/src/instrumentation.ts :: register` not reached, or
a build that is not a production one. Check the frontend container's environment and its startup
before looking at the backend.

**A date more than a day old means the timer stopped**: the frontend process holds it
([`spec.md`](spec.md) I149), so the container is up and the timer inside it is not. Recreating the
frontend service arms a fresh one, and the clocks are date-selected, so the pass that follows does
whatever the missed days owed.

## 10. The mail provider's dashboard

**None of this is in the repository**, and the webhook is inert until it is done. Every step below
is taken by hand in the mail provider's own console.

1. Create an endpoint at `https://<the league's domain>/api/mail/zustellung`.
2. Subscribe exactly six events -- `email.delivered`, `email.bounced`, `email.complained`,
   `email.suppressed`, `email.failed` and `email.delivery_delayed` -- and **neither `email.opened`
   nor `email.clicked`**, which the published notice promises are not measured
   ([`../datenschutz.md`](../datenschutz.md#6-retention-is-bounded-where-a-bound-was-chosen)).
3. Copy the signing secret into the frontend's environment as `RESEND_WEBHOOK_SECRET`. **It begins
   `whsec_` and must be pasted with that prefix**: the verifier accepts the value either way, and
   the boot check does not, deliberately -- refusing at start beats answering 400 to every event.
4. Confirm open and click tracking are OFF for the sending domain, which is a second switch from
   step 2.

**The failure mode is silent and then abrupt.** About thirty-two hours of non-200 answers disables
the endpoint and notifies the account; nothing in the product reports it, and re-enabling is done
here by hand. A frontend that boots without the secret crash-loops rather than answering, which is
the boot check doing its job.
