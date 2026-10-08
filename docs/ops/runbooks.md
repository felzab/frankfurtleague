# Ops — runbooks

**Purpose:** the recurring procedures that are run rather than read, and the operational facts no file in this repository states

The contracts these depend on — the services, the scripts, the gate scopes and the registry — are
[`spec.md`](spec.md); the pipeline a change travels from a branch to a deploy is
[`../_git/spec.md`](../_git/spec.md) §1.1.

| Section                                                                                                                                         | Answers                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [1. The server](#1-the-server)                                                                                                                  | What a deploy does, and what a failed one leaves running       |
| [2. Before deploying a change to the database's constraints](#2-before-deploying-a-change-to-the-databases-constraints)                         | The one check to run before a constraint reaches production    |
| [3. Granting or revoking admin access](#3-granting-or-revoking-admin-access)                                                                    | Who can sign in, and what revoking actually ends               |
| [4. When the application queue has been flooded](#4-when-the-application-queue-has-been-flooded)                                                | What the triage page still shows, and what stops new rows      |
| [5. When somebody asks for their data, or asks us to change it](#5-when-somebody-asks-for-their-data-or-asks-us-to-change-it)                   | Where each role's data is read, and how a request is answered  |
| [6. When personal data has been exposed](#6-when-personal-data-has-been-exposed)                                                                | The authority, the clock, and what the logs can establish      |
| [7. The logs' age bounds, and the copies a deploy leaves behind](#7-the-logs-age-bounds-and-the-copies-a-deploy-leaves-behind)                  | The host files that bound them, and where a deploy's copies go |
| [8. Taking the tunnel back out](#8-taking-the-tunnel-back-out)                                                                                  | What reverses the tunnel, and the half no commit reaches       |
| [9. Checking that the retention sweep has run](#9-checking-that-the-retention-sweep-has-run)                                                    | The one call that answers it, and what each answer means       |
| [10. The mail provider's dashboard](#10-the-mail-providers-dashboard)                                                                           | The six steps no code can carry, and what breaks without them  |
| [11. A contact seat's birthdate that no confirmation stamped](#11-a-contact-seats-birthdate-that-no-confirmation-stamped)                       | What finds the rows, and why no save clears one                |
| [12. Deleting this season's player records and resetting the action log](#12-deleting-this-seasons-player-records-and-resetting-the-action-log) | Its two halves, the referee drop, and what is lost with them   |
| [13. After a restore from a snapshot](#13-after-a-restore-from-a-snapshot)                                                                      | Who is re-erased, and what the restore took the record of      |
| [14. The `auth` database's indexes](#14-the-auth-databases-indexes)                                                                             | What builds them, and what a boot that could not leaves        |
| [15. When a sign-in code does not arrive](#15-when-a-sign-in-code-does-not-arrive)                                                              | What the person cannot tell apart, and the line that can       |
| [16. The secret files](#16-the-secret-files)                                                                                                    | What each holds, and how each machine makes its own            |
| [17. Clearing an address's code lock](#17-clearing-an-addresss-code-lock)                                                                       | Who meets it, when it lifts, and what clearing it costs        |
| [18. The Node a checkout runs](#18-the-node-a-checkout-runs)                                                                                    | What `pnpm install` fetches, and what a bare `node` still runs |
| [19. The database's storage alert](#19-the-databases-storage-alert)                                                                             | What fills the tier unseen, and the two alerts that show it    |

---

## 1. The server

**The repository does not record which host this is**, and deliberately holds no credentials. Getting onto
the machine is outside the repository. What it does tell you:

- `deploy.sh` refuses to run anywhere but Linux, and runs from a **checkout of this repository on the
  server** — so putting a merge live is `git pull && ./scripts/ops/deploy.sh`, the pull being what brings the
  compose file, `nginx/prod/` and `nginx/shared/` up to date before the containers are recreated.
- `fl_frontend/.env`, `fl_backend/.env`, `./nginx/prod/`, `./nginx/shared/`, every file under
  `./secrets/` the stack mounts, and `./certs/` must all exist beside the compose file — preflight
  checks each before anything is pulled. What each secret file holds, who owns it and how it is
  made, is §16.
- **A line naming a value a secret file holds, or `ALLOWED_ADMIN_EMAILS`, refuses the deploy at exit
  2 before compose is asked anything**, naming the line and never its value
  (`scripts/lib/_lib.sh :: refuse_credential_lines`): delete it, a credential being its file's (§16)
  and the administrator list read by nothing.
- **A `.env` beside the compose file refuses every run at exit 2 before compose is asked anything**,
  `--status` included (`scripts/lib/_lib.sh :: refuse_compose_dotenv`). Git ignores the name, so
  `git status` never shows it; move it out of the checkout, keeping it only if it holds something
  you still need ([`spec.md`](spec.md) §1.5).
- **Compose is asked whether it can parse its own configuration before anything is pulled**
  (`scripts/ops/deploy.sh :: check_compose_config`). **It refuses at exit 2 with nothing pulled or
  recreated**, and names the compose file and the two environment files without printing what compose
  said, a parse error quoting the line it could not read ([`spec.md`](spec.md) §1.5). To see that
  message, run the same check on the server, where its answer is not being captured:
  `docker compose -f docker-compose.yml config --quiet`.
- **The images the edge runs are fetched next, where the host lacks them, before either application
  image is pulled** (`scripts/ops/deploy.sh :: fetch_edge_images`): a fetch that fails refuses at
  exit 2 with nothing recreated, and compose's own reason is printed above the refusal
  ([`spec.md`](spec.md) §1.5).
- **The pulled backend image is then asked to read `fl_backend/.env`** before anything is recreated
  (`scripts/ops/deploy.sh :: check_env_names`): compose hands the container its keys as variables,
  and the settings class looks up none but its own, so a typo there reads as an omission and the
  shipped default serves production. **A name the backend does not declare, or a value it will not
  accept, refuses the deploy at exit 2 with nothing recreated**, and the printed line names the
  variables and never a value — so the remedy is read off the names: **delete an undeclared line,
  correct a rejected value, or declare the name in the settings class**. A check that could not be made at all is an advisory the deploy goes on
  past. It does not catch a misspelling whose value is EMPTY, which the settings reader drops before
  the check judges it ([`../backend/spec.md`](../backend/spec.md) §1.5); a spelling the two parsers
  read differently was refused before either image was asked ([`spec.md`](spec.md) I487).
- **The pulled frontend image is asked the same of `fl_frontend/.env`**
  (`scripts/ops/deploy.sh :: check_frontend_env_names`), and answers about names alone: **a name the
  frontend does not declare, and a name it requires that the file gives no value, each refuse the
  deploy at exit 2
  with nothing recreated**. The remedy differs by kind — delete an undeclared line, correct its
  spelling, or declare the name in the schema, nothing in that schema reading an undeclared one;
  **write a missing required one into the file WITH a value**, a bare `NAME` line taking its value
  from the shell that ran compose, which holds none for it, and reaching the container as nothing at
  all. That is where a
  release adding a required name meets a host nobody edited. Every VALUE is the frontend's own boot's
  to judge, in the step below. It does catch the misspelling whose value is EMPTY
  that the backend's reader drops, and a line its reader cannot take at all is an advisory rather
  than a refusal ([`spec.md`](spec.md) §1.5).
- **Each application service's own boot then judges its settings and secret files, before anything
  is recreated**, in a one-off container started as the stack starts the service, so with its
  variables, as its own user and in its own group. The frontend's runs the image's own server, which
  runs every boot gate and ends there (`scripts/lib/_lib.sh :: check_frontend_boot_config`): **a value
  the schema refuses, a secret file missing, blank, not a file or unreadable by that user, a signing
  key it cannot read, and an `APP_ENV` naming another deployment than the one being deployed each
  refuse the deploy at exit 2** with nothing recreated — Cloudflare's published test site key under
  production and a sign-in secret below its library's floor of 32 characters among them. The
  `CRITICAL` line above the refusal names the variable, the file or the key's path and never a value:
  correct a variable in `fl_frontend/.env`, and give a file §16's contents, owner or mode. The
  backend's container builds its settings as its boot does
  (`scripts/lib/_lib.sh :: check_backend_boot_config`), so a file it cannot use and a value its
  validators refuse — an internal key outside its alphabet among them — refuse there, naming the
  variable or the file.
- **Only the application containers are recreated**, and nginx is reloaded once they are healthy
  (`scripts/ops/deploy.sh :: serve_through_nginx`), through nginx's Control API, which answers whether
  the reload applied. The edge keeps running across the swap, so a deploy that succeeds costs seconds
  of 502 rather than a refused connection. The reload is also what applies a file the pull changed
  under `nginx/prod/` or `nginx/shared/`, both mounted as directories so the running container reads
  what the pull wrote ([`spec.md`](spec.md) §1.2); a pull that changed nginx's own service definition
  makes the same `up` recreate it instead. **A reload nginx refuses ends the run in a finding carrying
  nginx's own lines**: fix what they name, then recreate nginx. **The deploy then compares every file
  under `nginx/prod/` and `nginx/shared/`, as nginx holds it in memory, with the checkout's, and a
  difference ends the run in a finding** naming the recreate that repairs it
  (`scripts/ops/deploy.sh :: edge_reads_checkout`, [`spec.md`](spec.md) I355). A file there that nginx
  never loads, a README among them, reads as absent and fails every deploy.
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
- **Never deploy by tag a build from before the frontend's boot check.** Its image does not know
  `BOOT_CHECK`, so the preflight's one-off frontend serves instead of ending, and the deploy waits on
  it with nothing recreated until Ctrl-C. Every such image is deleted from the registry, where the
  pull of its tag refuses before anything moves. **The automatic rollback is not a deploy by tag**: it
  restores the running build by image id and runs no preflight, so the first deploy of a build
  carrying the check can still fall back to the build before it. Then publish a fixed build rather
  than deploying the restored one by the tag the script names.
- **After serving a build older than the season-row confirmation links, re-send the link of every
  contact seat that build re-staffed, once the current build is back.** That build's contacts editor
  leaves a row's links standing when it hands a seat to another person, and the confirmation finds a
  seat by its link alone (`fl_backend/app/api/bewerbungen/services.py :: build_saison_token_filter`),
  so the link the seat's earlier person still holds would confirm the new person's seat or empty it.
  The re-send replaces the seat's link (`fl_backend/app/api/teams/admin_router.py :: einladen_kontakt`).
  A row whose season has ended or whose team has left it refuses the re-send: there, empty the seat in
  the contacts editor and save, then enter the person again and save, which voids the old link and
  mints the person a new one.
- After the health wait, what `deploy.sh` checks is the **running stack rather than the checkout alone**:
  that nginx is running, reloaded and holding the checkout's configuration, the security headers as they
  are actually served, and the liveness probe through the edge. `./scripts/ops/deploy.sh --status` reads the
  probe and the configuration nginx holds too — every other row it prints comes from a container, and a
  healthy pair is no statement about what the edge in front of it resolves to or loads.

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
docker run --rm --network <compose-network> --user 0:0 \
  -v "$PWD/fl_backend/app:/app/app:ro" \
  -v "$PWD/fl_backend/.env:/app/.env:ro" \
  -v "$PWD/secrets/backend_mongodb_uri:/run/secrets/backend_mongodb_uri:ro" \
  -v "$PWD/secrets/sperrliste_schluessel:/run/secrets/sperrliste_schluessel:ro" \
  -v "$PWD/secrets/internal_api_key_base:/run/secrets/internal_api_key_base:ro" \
  -v "$PWD/secrets/internal_api_key_system:/run/secrets/internal_api_key_system:ro" \
  -v "$PWD/secrets/internal_api_key_admin:/run/secrets/internal_api_key_admin:ro" \
  <backend-image> python -m app.core.constraints --check
```

**`--user 0:0` is not optional.** The image runs as uid 1002, and the internal keys are root's and
group 1003's (§16), a group a bare `docker run` does not add, so without it the run cannot read them
and exits on a permission error before it checks anything. Root inside the
container reads them; `--check` writes nothing either way. **Each of the backend's five files is
mounted by name, and never `secrets/` whole**, which would hand this container the frontend's
credentials and the signing key besides.

**Every setting given no default is required, and the environment file and the five secret files
are what supply them.** A run reaching none of them exits 1 on a validation error naming each; the
settings class reads the package's file from the image's own working directory
(`fl_backend/app/core/config.py :: model_config`) and the secret files from `/run/secrets`, which is
where the mounts land them.
**Mounted rather than retyped, because the URI carries the cluster's credential**: passing them as
`-e` values instead puts that one in the shell's history and in the process list, and sends the
operator looking up values `--check` never reads — the run touches the database URI and
`DB_BASE_NAME` and nothing else the settings require.

One caveat, untested against the server itself: an SELinux host needs `:z` on each mount.

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

**A field that is RENAMED is the one case where the backfill cannot precede the validator.** The
validator is attached strict (`fl_backend/app/core/constraints.py :: _apply_validator`) and the
previous one lists the old name under `required`, so a `$rename` run under it produces a document
missing a required field and is refused for every row; the same strictness refuses an erasure's
`$set` over a row the NEW validator finds invalid ([`../backend/spec.md`](../backend/spec.md) I42),
which is why the rename cannot wait either. **This repository holds no migration runner and no
migration**: the command belongs to the change that needs it and is run by hand as a MongoDB
Playground paste against the cluster, as every migration here is, so what is written here is the
order alone.

1. `--check` from the new checkout while the old image still serves. Every row is reported as
   missing the new name, which is the confirmation that the rename is owed rather than a finding to
   fix — and it is the count step 3 is read against.
2. Deploy. The boot attaches the new validator before the image serves.
3. **At once**, the rename. Between this step and the previous one every read of the renamed field
   fails and an erasure over such a row is refused, so paste it as the deploy reports healthy.
4. `--check` again: clean.
5. Drop any index the previous name held, by hand — `create_index` refuses a name already held at
   different options and creates nothing under a name it does not declare, so the boot leaves the old
   one standing forever.

**Three things decide whether the command pasted at step 3 is the right one.**

- **`$rename` is atomic per document**, so no row is ever seen holding both names or neither.
- **`updateMany` is ordered**, so a count below what step 1 reported means it stopped at a row the
  new validator refuses for a reason of its own. Repair the row the error names and paste it again:
  a filter on the old name's `$exists` skips every row already moved, which is what makes the command
  re-runnable rather than a thing to get right once.
- **A dotted path through a nullable block is renamed ONE PATH AT A TIME.** `$rename` refuses the
  whole document where a segment has to traverse a null —
  `cannot use the part (…) to traverse the element ({trainer: null})` — so one update naming the
  three `kontakte` seats moves rows until it meets the first club holding one seat and not another
  and then stops, the earlier rows moved and the later ones not, inside the window step 3 exists to
  keep short. One update per path, each filtered on its own `$exists`, cannot traverse a null at all,
  a document matching that filter necessarily holding the segment. Measured against a copy of
  production, 2026-09-08.

The alternative order — `--apply` and the rename from the checkout, THEN the deploy — closes the
window for reads and erasures and opens a worse one: every recorded write of the still-serving old
image is refused until the new image is up, because it writes the old name.

**Where the renamed field sits inside `kontakte`, step 3's window is wider than step 3 says.**
`fl_backend/app/api/teams/schemas.py :: FLKontaktKenntnisnahme` requires the block's names, and
`fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbung` declares the same block, so the contacts
editor, a club's season panel and the whole application queue answer 500 on every stored row until
the rename lands. A junction contacts save over a seat its person keeps is refused too: it writes
that seat's stored record back whole (`fl_backend/app/api/teams/services.py :: _confirmation_held_by`),
under the old name, which the renamed validator refuses. **A
contact person's own confirmation link still OPENS**, serving no contact record
(`READ-BEWERBUNG-002`) — but the answer behind its button is a write over the same block and is
refused with everything else, so a person who confirms or objects in that window is told nothing
landed. Every public club read keeps working, the junction join withholding the block from the base
tier ([`../backend/spec.md`](../backend/spec.md) I50).

**A change that only adds a read index has nothing for `--check` to answer**, and a clean report is not
evidence it landed: those indexes constrain nothing, so no stored document can be in breach of one
(`fl_backend/app/core/constraints.py :: SupportIndex`). `--apply` or the next boot is what builds it, and
either fails loudly if it cannot.

**Two index changes stop the deploy, and both for one reason.** `create_index` refuses a name already
held at different options rather than moving it, so `apply_constraints` raises and
`fl_backend/app/core/db.py :: lifespan` fails the boot — the old index still serving, which the
refusal does not say. **A changed RETENTION bound** is moved at the keyboard first, from the same
shell the `--check` above runs in: a `collMod` on the `aktionen` collection, naming the index
`aktionen_retention` and setting its `expireAfterSeconds` to the new bound.

Dropping the index instead also works, the next boot rebuilding it at the declared bound; `collMod`
is the smaller window, no read losing the index in between. The new bound must equal
`fl_backend/app/shared/schemas/bounds.py :: AKTION_RETENTION_SECONDS` in the checkout about to
deploy, or the boot raises on the difference that is left.

**A uniqueness rule narrowed to a `partial_filter`** cannot be moved that way, because a narrowing
is a different index rather than a changed one: `collMod`'s `index` option reaches four properties —
`expireAfterSeconds`, `hidden`, `prepareUnique` and `unique` — and never the filter deciding which
rows the rule indexes, so an index can be made unique in place and cannot be made to cover fewer
rows. Mirrored from https://www.mongodb.com/docs/manual/reference/command/collMod/, which moves
without us; read 2026-09-09. The live index is dropped by hand while the stack is down, and the boot
that follows builds the narrowed one from `fl_backend/app/core/constraints.py :: UNIQUE_INDEXES`. The
drop is the whole procedure, and it belongs in the deploy's own window rather than ahead of it —
between the stack coming down and the new build coming up, because the refusal above is what the boot
answers with while the old index stands.

**A uniqueness rule WIDENED — a `partial_filter` removed — is the same refusal from the other side,
and the drop is only half the procedure.** `collMod` reaches the filter in neither direction, so the
live index still goes by hand; what the widening adds is that rows the narrow rule excused fall
inside the wide one, so any that would collide have to move before the boot rebuilds it, which fixes
the order: move the rows while the old build still serves, drop the index in the deploy's own window
as above. The moves are a Playground paste as every migration here is, keyed on a state the previous
statement leaves so a paste that dies partway is repaired by pasting it again. **Run the `--check` at
the head of this section only once the rows have moved**: it groups every row against the widened
rule, so before the move it answers about a database the boot will not meet.

**A rolled-back deploy can put the narrow index back.** Where the build being rolled back to declares
it, that build's own boot rebuilds it narrowed, and the retry's boot then meets the same refusal —
dropping it again before the retry is what clears it. Where the earlier build declares no index of
that name, nothing rebuilds it and the retry needs only the rows.

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
are each built on that pipeline. `GET /spiele/action_required` for that season goes down with them once its
knockout slots draw on a group placing, because `fl_backend/app/api/spiele/crud.py :: find_bracket_faults`
resolves those against that same pipeline. Every other season's queue still loads, so a queue failing for one
season alone points at that season's rows — or at a malformed `uhrzeit` on another season's fixture booked
within a day onto one of its venues or referees ([`docs/backend/spec.md`](../backend/spec.md#3-violation--remedy)). The two reports are independent: an orphan row can carry
a perfectly good name, and a row missing its name can name a club that exists.

## 3. Granting or revoking admin access

One thing admits an administrator: a grant in the `berechtigungen` collection, which the backend
reads on every admin-tier request and the frontend on every request, through the lookup its sign-in
gate and its guards share. A grant or a revoke takes hold on the next request of both, and nothing
restarts ([`spec.md`](spec.md) §4). A backend that cannot answer admits nobody, so the
administration is shut while it is down. Each of these is easy to get wrong:

- **An `administration` grant is made on the „Administratoren“ page, and only an `owner` is offered
  its revoke there** (`docs/frontend/spec.md :: I459`). Both ask a passkey confirmation of the last
  five minutes, a grant outliving the session making it (`docs/frontend/spec.md :: I458`).
- **An `owner` is made, and steps down, only through the tier change an `owner` makes**
  (`PATCH /berechtigungen/{berechtigung_id}`, `docs/backend/spec.md :: I436`): it mails every
  administrator and is logged, and the last live, unbarred `owner` is demoted by nobody
  (`docs/backend/spec.md :: I479`). The person made an owner signs in once more before acting as
  one: an older sign-in keeps administering and is offered no owner's control
  (`docs/backend/spec.md :: I534`). A demotion takes the tier at once. An `owner` is revoked only once made an administrator, and in
  the application only an `owner` revokes (`docs/backend/spec.md :: I449`).
- **The database is written directly for two things alone: the first owner, before anybody can sign
  in, and recovery when no owner can sign in.** Write in MongoDB Playground, never
  `mongosh`, into the `berechtigungen` collection of the application database (`DB_BASE_NAME`,
  which `fl_backend/.env` names). The row holds four fields, each typed by the validator: `adresse`,
  the address FOLDED — trimmed, the letters of both halves lower-case, the domain in punycode — or it
  admits nobody, the validator refusing no spelling and the boot counting it as `SRV-BOOT-007`
  without naming it; `verwaltung`, `owner` or `administration`; `erteilt_von`, a marker naming the
  paste, such as `PLAYGROUND`; and `erteilt_am`, a date rather than a string. Removing the row by its
  folded address revokes it. The statement itself is kept off this public repository.
- **Paste only into a database a boot of the release carrying `berechtigungen` has reached.** That
  boot creates the validator and the unique index; a paste before it creates the collection with
  neither, and a duplicate address in it then fails the next boot's index build (`SRV-BOOT-004`).
  Until the paste lands no address holds a grant, so the site admits no administrator; the public
  site is untouched.
- **Keep two grants standing, an `owner` grant among them.** The revoke route refuses to leave fewer
  (`docs/backend/spec.md :: I435`), the tier change to leave no owner
  (`docs/backend/spec.md :: I479`), and the Playground refuses nothing: the boot warns with
  `SRV-BOOT-005` where no grant is left and `SRV-BOOT-006` where no owner is, and serves the public
  site either way.
- **A barred address is granted nothing, and a granted one is banned by nothing**
  (`docs/backend/spec.md :: I437`): lift the ban first, or revoke the grant first. A grant the
  Playground writes onto a barred address is refused by nothing and admits nobody, neither to the
  site (`docs/frontend/spec.md :: I409`) nor to the admin tier while the ban stands
  (`docs/backend/spec.md :: I463`), and the reconciliation flags it.
- **Every change is announced, a Playground one naming no administrator**
  (`docs/backend/spec.md :: I439`). A Playground change undone again before the next claim is
  announced by nothing, and deleting a row of `berechtigungen_angekuendigt` or
  `berechtigungen_postausgang` by hand announces that grant again as new, or silences its notice.
  The first also shuts its holder out until the pass finds the grant again, and asks them to sign in
  once more after it.
- **The session row is not the grant.** It stays in the `auth` database after a revocation and authorizes
  nothing, so deleting it by hand is tidying rather than revocation.
- **A grant to an address the sign-in library will not take admits nobody**: that person is mailed
  no code. The grant page refuses such an address (`docs/frontend/spec.md :: I316`); the Playground
  refuses nothing. An umlaut before the at sign is the case that turns up: the sign-in box takes no
  such address, so that person needs a mailbox it will accept before a grant is worth writing. An umlaut domain is stored in punycode,
  which the sign-in box converts either spelling to.
- **A grant admits every passkey the address already holds.** A person enrols passkeys with a mailed
  code, the same authority an administrator's first passkey rests on, so one enrolled before the grant
  admits once the address is granted, though only on a passkey sign-in made after the grant: a
  session older than the grant administers nothing (`docs/frontend/spec.md :: I470`). Grant an
  address only where its mailbox is trusted as an administrator's.
- **A Playground grant is dated twice, so whoever it admits signs in once more.** Until the
  reconciliation's next pass (`fl_frontend/src/features/berechtigungen/abgleich.ts ::
ABGLEICH_INTERVAL_MS`) finds the row, it is dated by its own `erteilt_am`, or by the moment its
  `_id` was generated where that is later — so leave `_id` to the Playground, write `new Date()` for
  `erteilt_am`, and any sign-in after the paste admits. Once found, it is dated by that moment instead
  (`docs/backend/spec.md :: I525`): a session signed in between the paste and the find is sent back to
  the sign-in, and the next passkey sign-in admits.
- **A row the pass has read is no fresh paste: edit it and it admits nobody until the pass finds the
  edit** (`docs/backend/spec.md :: I529`), and then only on a sign-in after the find. That holds for
  an address changed in place, a spelling the boot named folded to the stored form, and a removed
  row put back with its `_id`; the pass marks every row it reads `gesehen_am`, so leave that field
  as it stands. To hand a grant to another mailbox at once, paste a new row and remove the old one.
- **A promotion to `owner` written in the Playground holds once the pass finds it, and then on a
  sign-in after the find** (`docs/backend/spec.md :: I534`): until then its holder is answered as the
  administrator they were. A demotion written there takes the tier at once.
- **The grant is the access; the person's own next sign-in enrols the passkey.** An address holding
  a grant and no passkey is answered the enrolment page and reaches no admin route until one stands,
  so there is nothing to prepare for them and nothing to hand over.
- **A lost passkey is the administrator's own to replace while they still hold another**: the
  account page, `/bereich/konto`, lists what they hold, adds one and removes one, each behind a
  passkey sign-in or confirmation inside the step-up window, and the last row cannot be removed.
  Removing one signs out the devices that passkey signed in, and no other.
- **An administrator who has lost every passkey is recovered in the Atlas console**, by deleting
  their rows in the `passkey` collection of the `auth` database; their next sign-in by mailed
  code enrols anew. **Until those rows are gone a code sign-in enrols nothing**, their own
  included, so a deletion against the wrong database reads to them as the step never being offered.
- **A device that cannot enrol a passkey is no way in, and no setting here relaxes it.** An
  administrator who enrolled a second device in advance still has one; one who did not is in the
  case below. The enrolment asks for a discoverable credential and for the person to be verified
  (`fl_frontend/src/core/auth.ts :: USER_VERIFICATION`, beside `residentKey`), so the browser offers
  nothing where the machine has no platform authenticator and no security key supporting both — an
  older desktop with no biometric and no PIN is the case that turns up. Give them a FIDO2 key with
  resident-key and user-verification support, or a second device they can enrol from; there is no
  password and no code to fall back to. **Where nobody can get in at all, the way back is the
  previous image** (§1's deploy by tag), which authenticates against the store that build carries —
  so it works only while that store is still there, and dropping it is what closes this route.
- **A removal is not a recovery route, and no control offers one to a session a mailed code alone
  made**: such a session could otherwise swap the administrator's passkey for a stolen mailbox's,
  which is the attack the second factor exists against.
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

**What truncation costs first is the partner of a marked pair, which is why the notice leads on it.** The
collision is decided on the server over every open application the request's season term leaves, never over the
rows served (`fl_backend/app/api/bewerbungen/services.py :: build_dubletten_pipeline`), so a served row is
marked whatever the cut took; a search or a facet cannot take the mark off it either
(`fl_frontend/src/features/bewerbungen/components/views/AdminBewerbungenView.tsx`). What the cut can take is
the other half: the notice says plainly that a marked row's partner is not always on the page, and reversing
the read is how it is reached.

**The Herkunft counts are the second thing to distrust.** That facet counts the loaded rows alone, so a zero
means zero among what came back rather than zero in the queue; the status and season counts come from the
server and hold whatever the read was cut to.

**Reversing the read is the recovery the page offers, and the only one; the page offers it by two
routes.** The default order is newest first, so what a cut-short answer keeps is the newest rows and
what it drops is the oldest — which is exactly where applications submitted before a flood sit. The
filter bar's read-order control paints the loaded end and lists the other on every view, cut short or
not (`fl_frontend/src/shared/components/ui/FilterLeiste.tsx :: LeserichtungSelect`); the notice above
it names that end in a sentence and links the act, reading `Lade die ältesten zuerst` on a default
view. Either route lands on the identical page.

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

Access, rectification, objection, restriction and portability all arrive the same way and are
answered by one person by hand. The withdrawal of a consent is the person's own write on their
account page, and a request for one by mail is answered by pointing them there (below). Erasure has its own mechanisms and is
[`../datenschutz.md`](../datenschutz.md#5-erasure-reaches-everyone-who-asks)'s; everything else is
this section.

**Every request arrives at the league's mailbox**
(`fl_frontend/src/core/brand.ts :: KONTAKT_EMAIL`, the address the notice and every message send a
reader to), and the answer goes back from it. There is no ticket system: the mail thread is the
record, and the action log records the writes you make rather than the request that asked for them.

**Establish who is asking and in which role, because the data sits somewhere different for each.**
One person can hold several — a referee is a pupil, and a contact person can be both.

| Role           | Where their data is read                                                                                                                                                                                                                                                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pupil          | `/bereich/admin/spieler/{spieler_id}`, and the squad rows under each season                                                                                                                                                                                                                                                                                                                     |
| Referee        | `/bereich/admin/schiedsrichter/{schiedsrichter_id}`, plus every past fixture that embeds the name                                                                                                                                                                                                                                                                                               |
| Contact person | `/bereich/admin/kontakte/{team_id}` for the season's block, and `/bereich/admin/bewerbungen/{bewerbung_id}` for the application it was collected on                                                                                                                                                                                                                                             |
| Administrator  | The sign-in store — the `auth` database, holding the address, the sessions, the sign-in codes and the passkey — plus `sperrliste.erstellt_von` on every ban they entered, which no erasure reaches, and the grants: their own in `berechtigungen` and `berechtigungen_angekuendigt`, `erteilt_von` on every grant they made, and each queued notice naming them in `berechtigungen_postausgang` |
| Anyone else    | The `auth` database's `verification` collection alone, where the address of whoever typed it into the sign-in form is held until the retention index removes the row (§14)                                                                                                                                                                                                                      |

**Anybody who has signed in is in the sign-in store too, and an erasure reaches it only by hand.**
A person's first sign-in writes their `user` row and a session in the `auth` database, a pupil's,
referee's or contact person's as an administrator's is, and no erasure route touches that database.
Read it for an access request. **Finish the erasure of anybody who has signed in with one step in the
Atlas console**, after the route's own erasure has run:

1. In the `auth` database's `user` collection, find the row whose `email` is the address as the
   sign-in box folds it, in lower case (`fl_frontend/src/core/emailAddress.ts :: asSignInIdentifier`),
   and do the same for **every address the record held**: a referee whose address moved by its link
   left an account at each earlier one, which the record does not name. Read those
   addresses off the action log's images of the referee before the route's erasure runs, which
   empties them; a decline or a discard of a later change empties them too.
2. Delete every row of `session`, `account` and `passkey` whose `userId` is that row's `_id`, then
   the `user` row itself.
3. Delete the `verification` row whose `identifier` is `sign-in-otp-` followed by that address, a
   code still waiting to be typed.

The rows counting the address's failed and requested codes carry a keyed hash nobody can compute by
hand, and expire within a day on their own (§17); a passkey ceremony's row carries an account id
rather than an address, and expires within five minutes.

`/bereich/admin/aktionen` answers what was written about them and by whom, and is the only place that
question is answered at all. **Two populations sit in that collection and only one has an expiry**:
a row the log stamped is gone twelve months after the write it recorded and a row carrying no stamp
is expired by nothing (`docs/backend/spec.md :: I119`), so an answer promising a period has to say
which it is about — the unstamped rows leave at [section 12](#12-deleting-this-seasons-player-records-and-resetting-the-action-log)'s
reset instead.

**There is no export route, so an access request is answered by composing what those pages show.**
Send the categories, the values, where each came from, who receives them
([`../datenschutz.md`](../datenschutz.md#7-processors-and-third-parties)'s processor table), how long
they are kept, and the address for a complaint to the supervisory authority. Point at the published
notice (`fl_frontend/src/features/meta/components/views/DatenschutzView.tsx`) for the standing text
rather than restating it in the mail.

**A ban is the one record no search finds from the address it is about.** The row holds a keyed hash
and nothing else of the person, so `/bereich/admin/sperrliste` cannot be asked whether a given address is on
it: the question is answered by computing that address's hash under `secrets/sperrliste_schluessel` — the
same derivation `fl_backend/app/api/sperrliste/services.py :: adresse_hash` performs, label and fold
included — and looking the value up against `sperrliste.adresse_hash`. The paste that does it belongs
in the operator's own checklist and in no file here. What the answer then says is the row's reason,
its day, its administrator and the season it runs to; the hash itself is not sent to the person, it
being the value that identifies them.

**How long a record is kept is answered by its own clock rather than by hand.** A declined
application, an accepted one and a season's contact block are each removed by the retention sweep
(`docs/backend/spec.md :: I150`); an application nobody confirmed is deleted after its deadline, its
submitter told first (`docs/backend/spec.md :: I151`); an application nobody decided is deleted once
the season it applied for has ended, whatever its seats answered
(`docs/backend/spec.md :: I220`); and a log row stamped with its write date expires on I119's bound.

**A rectification is the ordinary admin edit**, made on the page above. Two carry a trap worth
reading before you save: a club rename fans out into the matches of every season that is not `past`
([`../glossary.md`](../glossary.md#spiel--one-match)), and a referee rename fans out into every
season's matches, a referee not being season-scoped.

**An email address is not an ordinary rectification, and which procedure applies is decided by the
role the address sits in.** It is what a person signs in as, so changing one changes who can sign in
as them.

- **A pupil.** `spieler.email` is written by the team's admission alone and is on no payload, so no
  screen corrects it. A pupil admitted under an address they cannot read is corrected by hand: set
  `spieler.email` to the new address as `fl_backend/app/shared/folding.py :: sign_in_identifier`
  folds it, in the Playground, and run `python -m app.core.constraints --check` (§2); the unique
  index `uniq_spieler_email` refuses an address another person already holds. Registering again
  from the new address instead writes a second person, which the admission joins to the first only
  where the first holds no address. The address a PENDING registration was typed with is not
  corrected: the answer is to register again through the team's link, the unconfirmed row going
  with the seven-day sweep.
- **A referee who has NOT confirmed.** Correct `kontakt.email` in the referee editor. The save
  itself kills the link that went to the old mailbox, mints a fresh one and mails the corrected
  address, so nothing further is owed and the old link opens nothing.
- **A referee who HAS confirmed, retired or not.** Enter the new address in the referee editor. The
  save keeps the address on file and holds the new one as a pending change with a link of its own;
  the address moves only once its holder confirms there, so until then the referee still signs in,
  and is written to, at the address on file (`docs/backend/spec.md :: I559`). Re-send its
  link when it lapses, or discard it when the request turns out to be wrong; a lapsed change is
  the yearly deletion's to remove, which is not built yet, so until it is the change stands
  ([`../datenschutz.md`](../datenschutz.md#6-retention-is-bounded-where-a-bound-was-chosen)).
  Their consent link is not re-minted — the record is already given. **Once the change confirms,
  the old address's sign-in account stays behind**, the confirmation touching no sign-in row, and
  the referee's passkeys stay on it until its rows are deleted. Delete its sign-in rows by the
  erasure's hand step above, run on the old address, once nothing else holds it, each read by the
  address: no referee, searching `/bereich/admin/schiedsrichter`; no contact seat, searching
  `/bereich/admin/kontakte` and `/bereich/admin/bewerbungen`; no grant, searching
  `/bereich/admin/administratoren`; and no pupil or registration, which no page searches by address,
  so a Playground count of `spieler` rows whose `email` is the address as
  `fl_backend/app/shared/folding.py :: sign_in_identifier` folds it, as the pupil's correction
  above reads it, and of `registrierungen` rows whose `email` matches it in any case, a
  registration storing it unfolded (`docs/glossary.md :: Registrierung`). Those are the records
  the sign-in gate admits an address for (`docs/glossary.md :: Konto`).
- **The holder of a pending new referee address**, a mailbox an administrator's typing reached. No
  read keys on that address, by design (`docs/backend/spec.md :: I560`), so no page search
  finds the referee from it: find the row with a read-only Playground query on `schiedsrichter` for
  `adresswechsel.email` equal to the address, matched in any case and projecting `_id` and `name`
  alone, then open that referee's editor and press „Änderung verwerfen“
  (`DELETE /schiedsrichter/{schiedsrichter_id}/adresswechsel`), which removes the address and the
  log's images of it (`docs/backend/spec.md :: I562`). The link's own „Das ist nicht meine
  Adresse“ does the same, past its deadline too.
- **A referee who is RETIRED and has not confirmed.** Correct `kontakt.email` in the referee editor.
  The save stores the address, mails nothing and kills the old link, since a retired referee takes
  no booking to consent for; reactivating them later mints a fresh link and mails it to the
  corrected address (`docs/backend/spec.md :: I309`).
- **A contact seat.** Correct it through
  `fl_backend/app/api/bewerbungen/admin_router.py :: korrigiere_kontakt_email`, which rewrites the
  address and nothing else of the person. It mints the fresh link, voids the old one and restarts the
  confirmation deadline, and where one person holds two seats it corrects both. A seat whose person
  has stepped out takes a different route, below.

**A person asking to change their own address is answered by performing the procedure above.**
No page lets anybody change the address they sign in as: a confirmed referee's change is the
administrator's save, proved by the new mailbox's own link and told to the address on file, and
every other role's is the administrator's correction.

**Withdrawing a consent is the person's own write on their account page, `/bereich/konto`, and
never an erasure or an edit by hand** (`docs/backend/spec.md :: I613`, `:: I596`). Point a request
arriving by mail at the control for its record, which the person reaches by signing in with the
address that record holds:

- **A referee's publication scope and media consent:**
  `PATCH /schiedsrichter/selbst/{schiedsrichter_id}/einwilligung`.
- **A seat's WhatsApp scope and media consent on a team's season row:**
  `PATCH /teams/{team_id}/saisons/{saison_id}/person/einwilligung`, for every seat the address holds
  on that row (`docs/backend/spec.md :: I599`).
- **A seat's WhatsApp scope and media consent on a pending application:**
  `PATCH /bewerbungen/{bewerbung_id}/person/einwilligung`, which withdraws them and never grants
  either.
- **A pending registration's publication scope and media consent:**
  `PATCH /registrierungen/selbst/{registrierung_id}/einwilligung`, which withdraws them and grants
  neither. The admission deletes the registration, and its choices then move on the pupil's own
  control above.
- **A pupil's:** the paragraph below.

**Taking a contact person off their seat is an erasure, unless the seat's own link still takes
their Widerspruch.** On an application, which of the three cases below you are in is decided by
that seat's own link, not by the person's role; a seat on a team's season row is the fourth:

- **The seat is unanswered and its link still works.** Their own Widerspruch, on the confirmation
  page the link opens, empties the seat at once and tells the submitter so the school can name
  somebody else (`fl_backend/app/api/bewerbungen/einwilligung_router.py :: post_einwilligung`).
  Send them the link again rather than erasing for them; the record then says the person refused
  rather than that an administrator removed them. **An address the ban list holds takes no second
  link** (`REQ-BEWERBUNG-019`), and the link it already holds opens on the ban's sentence alone,
  offering no Widerspruch (`docs/frontend/spec.md :: I516`): its withdrawal reaches the league's
  mailbox and is performed by hand, through `POST /kontakte/erasure`. Once the school has named a replacement, seat them
  from „Neu besetzen“ on that seat's row of the application's Bestätigungen panel, which sends the
  new person their own link and restarts the confirmation deadline for the whole application; it is
  acceptable again once they confirm within that new deadline. An ERASED seat offers no such control,
  and neither does one half of a claimed pair whose other half has not stepped out: that application
  takes only the Absage.
- **The seat has already answered, or the link is over.** A seat that has confirmed or already
  contradicted takes no second answer (`REQ-BEWERBUNG-011`), and a link whose deadline has passed
  (`REQ-BEWERBUNG-017`) or whose application has been decided (`REQ-BEWERBUNG-010`) takes none either —
  each is a refusal the person meets on the page, not something to talk them through. The route is `POST /kontakte/erasure`
  like any other.
- **The application has been decided.** `POST /kontakte/erasure`, as above.
- **The seat is on a team's season row.** Its person's own link takes their Widerspruch while it
  is live, and the Widerspruch empties the seat and mails nobody, an administrator rather than a
  submitter having entered them (`docs/glossary.md :: Bestätigung`). A lost or lapsed link is sent
  again with „Bestätigungslink senden“ on that seat in the team's contacts editor
  (`fl_backend/app/api/teams/admin_router.py :: einladen_kontakt`), which replaces the old link
  whole. It refuses an address the ban list holds (`REQ-KONTAKT-003`) and a row whose season has
  ended or whose team has left it (`REQ-KONTAKT-005`, `docs/backend/spec.md :: I570`), though a link
  such a row already holds still takes a Widerspruch. Where no live link is left, or the seat has
  already answered, the route is `POST /kontakte/erasure`.

**A pupil withdrawing the consent that publishes their name does it on their account page.**
`PATCH /spieler/selbst/einwilligung` moves the record, and no administrator route writes it
(`fl_backend/app/core/domain.py :: FIELD_POLICIES`). A request arriving
by mail instead has two answers, and which one you give is the person's to choose:

- **They want off the website and out of the league.** `DELETE /spieler/{spieler_id}` and then
  `DELETE /spieler/{spieler_id}/erasure`, which is the erasure above and takes the squad rows with
  the person.
- **They want their name withheld and their place kept.** Answer by pointing them to the control
  on their account page, `/bereich/konto`, which they reach by signing in with the address their
  record holds. **Nobody edits a consent block by hand**, in the console or anywhere else: a choice
  the person did not make is not their consent (`docs/backend/spec.md :: I613`). **A pupil whose
  record holds no address cannot sign in**, and the one route the code leaves to keep their place
  takes two writes by their team, in this order. A seat holder first takes the pupil's squad row of
  the season out, since a live row there refuses any admission (`REQ-REGISTRIERUNG-015`); the pupil
  then registers again through the team's link while the season's registration window is open,
  choosing the narrower publication, and a seat holder admits that registration onto the stored
  record the pending list proposes by name (`docs/backend/spec.md :: I581`). The admission writes the address, rewrites the retired
  squad row rather than writing a second (`docs/backend/spec.md :: I583`) and renews the choice from
  the pupil's own answer
  (`fl_backend/app/api/registrierungen/services.py :: compose_person_update`). Where the window is
  shut, the erasure above is the only route. Either write that withholds the name drops the cached
  squad list, and the next read serves the row as a nameless slot
  (`docs/backend/spec.md :: READ-PUPIL-003`); check the public squad page before you answer.

Tell them that the first cannot be undone, and that the second is theirs to change back on the same
page.

**A referee whose row was dropped has nothing left to erase, and their fixtures hold no name**:
[section 12](#12-deleting-this-seasons-player-records-and-resetting-the-action-log)'s drop empties it
as it repoints them at the ghost, which refuses an erasure itself (`REQ-ANONYMISE-004`), and redacts
the log's images of them as an erasure does. Where the
person has registered again since, erase the new row under „Daten löschen“ in that referee's own
editor.

**Objection, restriction and portability have no mechanism and need none at this scale.** Answer the
person in writing: say what is held, on what basis, and what you have done. Where a restriction is
agreed, the only reliable form it can take here is removing the data, which is the erasure route.

**Two things belong in every answer that touches a deletion.** Backups outlive it by the snapshot
window and the person is told so
([`../datenschutz.md`](../datenschutz.md#5-erasure-reaches-everyone-who-asks)); and an erasure is
keyed on an email address, so it clears every seat that address holds, in every season and both
collections. **The erasure takes the address the seat it is pressed on stores, and reaches another
seat only where that one's address folds to the same spelling** once its capitals are lowered
(`fl_backend/app/shared/folding.py :: sign_in_identifier`). **Read the armed panel's list before
pressing**: it names every one of those seats, by
person and by the season or application it sits in, and the press stays shut until that list is on
screen
(`fl_frontend/src/features/kontakte/components/forms/AdminKontakteEditForm/FormKontaktErasure.tsx`).
Read the counts the result reports afterwards —
they are what say how far the write reached.

**Answer as soon as what you need is gathered, and where it will take longer say so in the first
reply rather than after it.** Where the answer needs the Datenschutzexperte, the person is told that
in the same reply.

**A false birthdate is found by a person, and the answer is a decision and a ban rather than a
rule.** The one date anybody enters for themselves is a contact person's, at their own confirmation,
and nothing verifies it: what surfaces is somebody recognising the person or the school saying so.
Decline the application and bar the address at `/bereich/admin/sperrliste` with the reason in your own words
and no person named in it, the row outliving that person's erasure
([`../glossary.md`](../glossary.md#sperrliste--the-addresses-barred-from-signing-up-and-from-the-leagues-mail)). An
address holding a grant is refused (`REQ-SPERRLISTE-003`) until the grant is revoked
([section 3](#3-granting-or-revoking-admin-access)). **The write
mails the person itself where the address holds a sign-in account**, naming the reason you typed and
the last season the ban covers, so there is nothing to send by hand; an address that never signed in
is mailed nothing, and the page says so. Where the send fails, or the sign-in store could not say
whether an account holds the address, the page says the notice did not go, and there is then no
address left anywhere to try again with. **The same write ends every live sign-in of the address**, keeping its
account and passkeys for the day the ban ends (`docs/frontend/spec.md :: I402`); where that fails the
page says so too, every person page refuses the sessions as no session at all
(`docs/frontend/spec.md :: I406`), and each is deleted the next time its browser reaches the sign-in
page (`docs/frontend/spec.md :: I518`). **Every later sign-in of the address
is refused as its session would be created**, by a code or a passkey alike
(`docs/frontend/spec.md :: I403`). **Beyond that the ban refuses the sign-ups that ask it and the
administration.** A pupil's registration asks it and is refused (`REQ-REGISTRIERUNG-009`), and so do
an application naming the address on any seat (`REQ-BEWERBUNG-018`), an administrator's correction,
reseat or re-send of a seat to it (`REQ-BEWERBUNG-019`) and every referee write that mints a link,
and both sweeps withhold the reminder they would send it, logging per season how many they held
back and never which; nothing marks the row, so each pass counts it again until its deadline. A grant of the address is refused (`REQ-BERECHTIGUNG-003`), a grant the Playground
wrote onto it admits nobody, and no admin read shows it as a grant's holder or as the author of a
grant, a ban, an invitation, a decision or a log row: each reads „Gesperrte Adresse“ there instead
(`docs/backend/spec.md :: I452`). **Every confirmation link
already mailed to the address stops confirming at once**, however long ago it went out: a pupil's
(`REQ-REGISTRIERUNG-012`), a referee's (`REQ-SCHIEDSRICHTER-009`) and a contact seat's
(`REQ-BEWERBUNG-020`) link opens on the ban's sentence alone, with nothing to press, and a press
already under way is refused (`docs/backend/spec.md :: I515`, `docs/frontend/spec.md :: I516`). A
contact person's Widerspruch then reaches the league's mailbox, as the withdrawal bullet above says.
Nothing of the ban is written on those records, so lifting a mistaken ban lets a link still inside
its deadline open on its form again. Nothing else refuses on the list, so a person reading the
queue is still what keeps a barred address out of everything a sign-up does not cover. **What the address already
holds stays until you take it away** — a record it confirmed before the ban, and one it can no
longer confirm alike — and the ban names none of it:

- a referee still booked on an unplayed fixture: reassign those fixtures first, then retire the
  referee, which `REQ-RETIRE-004` holds to that order;
- a pupil's squad row: retire it, which takes the pupil off the public squad list;
- a contact seat: replace or clear it on the team's season.

**A ban lapses five full seasons after the one it was entered under, and the row is removed at the
activation that runs past it.** The season it was entered in does not count, so a ban entered while
2026 is active covers through 2031 and goes when 2032 is activated. There is no window between the
two: the
activation that makes a ban lapse is the same write that removes its row, so a ban on this page is
always one that still bars. Lift a ban earlier from the page itself,
which is still one press: a ban entered because somebody lied about their age loses its purpose the
day they reach the floor their seat asks for, and the page is where somebody notices.

**Generating the key is the one command in this section.** A key-generation command is an operator
instruction rather than a database migration, so it stands here; nothing it produces is ever written
into this repository. Dev, on Windows in Git Bash, or on the server — generate it on whichever
machine you will paste from, so the value is not carried between two of them:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Thirty-two random bytes as sixty-four hexadecimal characters. **The boot's floor counts CHARACTERS
and not entropy** (`fl_backend/app/core/config.py :: SPERRLISTE_KEY_MIN_LENGTH`), so sixty-four
repeated letters pass it and are worthless: what makes the value a key is that it came from this
command and not from a keyboard.

**The ban list's key, `secrets/sperrliste_schluessel`, can never be rotated, and losing it costs the whole list**: replacing it
disarms every ban in silence ([`../backend/spec.md`](../backend/spec.md#15-environment)), the one
sign being a second ban of an address already on the list admitted rather than refused. It keys the
action log's pseudonyms of signed-in people too, so a replacement leaves one person's rows under two
pseudonyms and the older can never be recomputed. Treat it as
the one backend secret with no recovery: back it up where the database's own access details are
backed up, and where it is genuinely gone, clear the list and enter the bans again from whatever
record names the addresses.

## 6. When personal data has been exposed

A personal-data breach is reported to **Der Hessische Beauftragte für Datenschutz und
Informationsfreiheit** in Wiesbaden, through its Art. 33 form at datenschutz.hessen.de, **within 72
hours of becoming aware of it** — requesting the upload link does not stop that clock. That is
mirrored from the authority's own pages, which move without us and were read on 2026-09-02.

The clock starts when a person becomes aware, and nothing here raises an alert, so the first minutes
are yours to spend on the steps below rather than on looking for one.

**The fix can ship at once: a deploy keeps both application streams.** Every deploy copies them to
`/var/log/frankfurtleague/` before it recreates either container, and refuses at exit 2 with nothing
recreated where it cannot write there (`scripts/ops/deploy.sh :: copy_streams`); a deploy that
rolls back copies the failed build's streams as well. **Ship it through the deploy and no other route**: a
`docker compose down`, or an `up --force-recreate` typed by hand, discards a stream with no copy
taken ([`../logging/spec.md`](../logging/spec.md) §1.2). The edge's own two logs are host files
under `/var/log/frankfurtleague/nginx`, which no recreate reaches.

**What those logs can and cannot answer.** How far back each reaches is bounded
([section 7](#7-the-logs-age-bounds-and-the-copies-a-deploy-leaves-behind)): a running container's
stream by the runtime's size rotation (`docs/logging/spec.md :: 1.2`), so a busy period rotates its
own oldest lines away and the window is set by traffic rather than chosen; a deploy's copy by the
thirty days after the deploy wrote it; and the edge's two logs by eight days at most. The edge's
access line carries the visitor's address, user agent and referer with the credential arms redacted
(`docs/logging/spec.md :: L11`), so no confirmation token is in it, and a sign-in code travels in a
request body rather than a URL; the
same request line reached Cloudflare unredacted, and what Cloudflare keeps is settled in its
dashboard rather than here.

**The durable answer to "what was changed, and by whom" is the action log rather than a container
log.** Every recorded write appends a row carrying the actor, the route, the collection, the
operation and the image of what the write replaced or removed
([`../glossary.md`](../glossary.md#aktion--one-recorded-write-and-what-it-replaced-or-removed)), read
at `/bereich/admin/aktionen`. A row whose values an erasure destroyed is emptied in place and stamped
(`docs/backend/spec.md :: I42`), so what survives an erasure is that the write happened and not what
it held.

**Then, in this order:** contain it; establish which people and which categories are affected, from
the two records above; report inside the 72 hours with what is established and what is not — a report
may be completed later, and a late one may not; and tell the people affected wherever the risk to
them is high. Write down what you established and when you established it: the authority asks, and
no log above outlives its bound.

## 7. The logs' age bounds, and the copies a deploy leaves behind

**Every deploy copies both application streams to `/var/log/frankfurtleague/` before it recreates a
container** (`scripts/ops/deploy.sh :: copy_streams`), one file per service stamped to the second, and
refuses at exit 2 with nothing stopped where it cannot write there. **A deploy that rolls back
recreates the pair twice and so copies twice**, the failed build's streams taking the same stamp and a
`-failed` suffix, so a failed deploy leaves four files that sort together (§1). The same step creates
`/var/log/frankfurtleague/nginx`, which `docker-compose.yml` bind-mounts for the edge's access log
and error log — host files rather than a container's stream, because every line naming a visitor
is in one of the two ([`spec.md`](spec.md#2-invariants) I352). Both directories are created
by the deploy where it can; on a host whose deploying user is not root, create them once by hand:

```bash
sudo install -d -o "$USER" -g "$USER" /var/log/frankfurtleague /var/log/frankfurtleague/nginx
```

**The age bounds are four host files no file in this repository can install** — written on the
server in the same deployment that ships the published texts stating them
([`../datenschutz.md`](../datenschutz.md) §6): eight days for the edge's two logs, thirty for the
copied application logs. **They are two mechanisms because they are two kinds of file.** The edge's
logs are open and growing, so their bound is a rotation the edge has to be told about; a deploy's
copy is written once and never appended, so its bound is a deletion.

**The edge's two logs, at `/etc/frankfurtleague/access-log.conf`.** **A host carrying an earlier
stanza that names `access.log` alone takes the one below whole**: nginx writes `error.log` from the
first time it loads a configuration naming it, and that file then grows past the eight days with
nothing on the host reporting it. Substitute the server's own checkout path for `<checkout>` —
`docker compose` takes its project name from the directory holding the file `-f` names, so a path
pointing anywhere else finds no `nginx` service and the rotation goes on without the reopen. Spell
`docker` with the path `command -v docker` prints if it is not on systemd's own PATH, which is what
this runs under rather than a login shell's.

```text
# nginx writes these files through a bind mount, so they outlive the container and can be rotated
# by rename: the master reopens every log it holds on USR1 and a renamed file stops growing, the
# lines written in between having gone to the renamed file rather than nowhere.
/var/log/frankfurtleague/nginx/access.log /var/log/frankfurtleague/nginx/error.log {
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
    # One USR1 for both files, which one reopen covers; without it each rotated file sends its own.
    sharedscripts
    postrotate
        docker compose -f <checkout>/docker-compose.yml kill -s USR1 nginx
    endscript
}
```

**Read once with `logrotate -d -s /var/lib/logrotate/frankfurtleague.status /etc/frankfurtleague/access-log.conf`**,
which rotates nothing, before the first real run. It runs no `postrotate` script, so the reopen
stays unproven until the first real rotation.

**A failed reopen leaves each live log empty beside a dated file that keeps growing**: the rename
has happened and nginx still writes through its open descriptor, and nothing on the host says so —
the timer's later runs exit 0. `ls -lt /var/log/frankfurtleague/nginx/` shows it, a live file at
zero bytes under a dated file of its own name with a newer mtime. The next rotation sends USR1
again and recovers, losing only the lines written to the orphaned file between its compression and
the signal.

**That file is deliberately not in `/etc/logrotate.d/`**, and the pair below is what runs it: a size
cap only bites at the moment logrotate runs, and the host's own invocation is daily, so a spike
between two of them is unbounded. One config file read by one scheduler against one state file of
its own is what keeps the two from rotating the same log twice with two ideas of when it last
happened.

```text
# /etc/systemd/system/frankfurtleague-logrotate.service
[Unit]
Description=Rotate the Frankfurt League edge logs

[Service]
Type=oneshot
ExecStart=/usr/sbin/logrotate -s /var/lib/logrotate/frankfurtleague.status /etc/frankfurtleague/access-log.conf
```

```text
# /etc/systemd/system/frankfurtleague-logrotate.timer
[Unit]
Description=Hourly size check on the Frankfurt League edge logs

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
```

**The deploy's copies, at `/etc/tmpfiles.d/frankfurtleague.conf`.** `systemd-tmpfiles-clean.timer`,
which systemd ships enabled and runs daily, is what runs it, so the thirty days need no scheduler of
their own. **The
line ages the directory rather than a name**, so every copy a deploy writes into it is reached
whatever it is called — the `-failed` pair a rollback leaves included, and any suffix a later change
adds. The command below is what confirms it is running on this host.

```text
# Aged by mtime alone: a copy's mtime is the moment the deploy wrote it, while its ctime moves for a
# chown or a relabel, and any of the three being recent is enough to keep a file otherwise.
e /var/log/frankfurtleague - - - m:30d
# The line above reaches every level below it, and the edge's live logs are there: on a quiet month
# the cleaner would delete a file nginx still holds open, and the writes would go nowhere.
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
only age bound over one. The edge's own container stream is bounded by that cap alone, which is why
nothing written there may name a visitor ([`spec.md`](spec.md#2-invariants) I352).

**The rotated file ends up owned by uid 101 rather than root**: nginx's master chowns each log it
reopens to the user its configuration names, which is the image's `nginx`. `create 0640 root root`
is what the rotation leaves, and the first line written after the reopen changes that ownership;
reading the file needs the host's root either way.

## 8. Taking the tunnel back out

**The rollback is `git revert` of the change that put the tunnel in and a redeploy, not
`deploy.sh`'s own.** That path restores IMAGES, and what would be wrong here is the topology: only
the reverted commit puts the `ports:` block back and stops the connector, and re-running the
deploy after it is what applies them. **The edge is the other half, and no commit reaches it**: the
two hostnames come off the tunnel, the address records naming the origin are created again, and
whatever closed the host's inbound 80 and 443 is opened.

## 9. Checking that the retention sweep has run

**One call answers it**, on the system key, from inside the frontend container: the backend publishes
no port on the host, and the container holds the key, so it never passes through your shell.

    docker compose exec frontend node -e "fetch('http://backend:8000/api/v0/bewerbungen/sweep',{headers:{Authorization:'Bearer '+require('fs').readFileSync('/run/secrets/internal_api_key_system','utf8').trim()}}).then(r=>r.text()).then(console.log)"

**`sweep_gelaufen_am` and `registrierung_sweep_gelaufen_am` are the days those two passes last ran,
and both are today or yesterday on a healthy stack.** A pass that reminds nobody and deletes nothing
records its day exactly as a busy one does ([`spec.md`](spec.md) §1.1), so the dates are the answer
and the absence of log lines is not.

**A stale date says its own pass did not finish, and the frontend's log says why.** One hourly tick
runs the two halves of each season independently, and each files its own failure line —
`bewerbung.sweep_failed` and `registrierung.sweep_failed`, both under `FE-SWEEP-001`
([`../logging/error-codes.md`](../logging/error-codes.md)) — so the event name is what names the
half, and the date alone is not: the application's endpoint stamps its day before the calls that
follow it, so a throw after that stamp leaves a fresh application date beside a stale registration
one just as a failed registration call would.

**Null means no pass of that kind has ever run against this database**, which on production is one
of the ways [`spec.md`](spec.md) §1.1 lists: `BEWERBUNG_SWEEP` off,
`fl_frontend/src/instrumentation-node.ts :: registerOnNode` not reached, or a build that is not a production
one. One switch arms both passes, so two nulls point at the frontend container's environment and its
startup rather than at the backend.

**A date more than a day old means the timer stopped**: the frontend process holds it
([`spec.md`](spec.md) I149), so the container is up and the timer inside it is not. Recreating the
frontend service arms a fresh one, and the clocks are date-selected, so the pass that follows does
whatever the missed days owed.

## 10. The mail provider's dashboard

**None of this is in the repository**, and the webhook is inert until it is done. Steps 1, 2 and 4
are taken by hand in the mail provider's own console; step 3 is a line in the server's environment
file, and it is the one that stops the frontend booting.

1. Create an endpoint at `https://<the league's domain>/api/mail/zustellung`.
2. Subscribe exactly six events — `email.delivered`, `email.bounced`, `email.complained`,
   `email.suppressed`, `email.failed` and `email.delivery_delayed` — and **neither `email.opened`
   nor `email.clicked`**, which the published notice promises are not measured
   ([`../datenschutz.md`](../datenschutz.md#6-retention-is-bounded-where-a-bound-was-chosen)).
3. Copy the signing secret into the server's `secrets/resend_webhook_secret`, owned as §16 says. **It begins
   `whsec_` and must be pasted with that prefix**: the verifier accepts the value either way, and
   the boot check does not, deliberately — refusing at start beats answering 400 to every event.
4. Confirm open and click tracking are OFF for the sending domain, which is a second switch from
   step 2.

**The failure mode is silent and then abrupt.** About thirty-two hours of non-200 answers disables
the endpoint and notifies the account; nothing in the product reports it, and re-enabling is done
here by hand. A frontend that boots without the secret crash-loops rather than answering, which is
the boot check doing its job.

**What a disabled endpoint looks like from inside the product.** The six subscriptions above feed
every delivery record this database holds, and a record has one home per kind
([`../backend/spec.md`](../backend/spec.md#2-invariants) I266). So the signature is the same at
each of them: every message sent after the endpoint went quiet stands at the state its own send
wrote — `angenommen`, with no provider event after it — while the messages before it carry a
delivered or refused state as usual. The application's triage queue is the one surface that renders
this today; every other home is read through its own record, so a kind whose page nobody has opened
shows nothing at all. **No bounce rate is aggregated anywhere**, deliberately: nothing in this tree
sums delivery states, and at this volume the records a person already opens answer the same
question.

## 11. A contact seat's birthdate that no confirmation stamped

**The state is a seat holding a date beside no `bestaetigt_am`**, and nothing in the product clears
one: the date arrives with a person's own confirmation and rides with their address through every
later edit (`fl_backend/app/api/teams/services.py :: _geburtsdatum_held_by`), so no save reaches it,
and no validator expresses the pairing either
([`../backend/spec.md`](../backend/spec.md#2-invariants) I141), so `--check` reports nothing about it.

**It sits on TWO collections, three seats each, and clearing one leaves the other.** One pair of
declarations builds the block on a `saison_teams` row and on the `bewerbungen` document the people
were collected on
([`../glossary.md`](../glossary.md#kontakte--the-three-people-the-league-reaches-a-team-through)),
so an accepted school holds each date twice. **The clear is run by hand as a MongoDB Playground
paste against the cluster, as every migration here is** (§2), the backend image carrying no
database shell. Four things decide whether the one pasted is right:

- **Count before clearing, per seat and per collection, on the term the clear will use** — a date
  that is not null beside a `bestaetigt_am` that is null — and read the number of documents each
  update reports as modified against its count.
- **The `null` half is what reaches a record written before `bestaetigt_am` existed**, matching an
  absent key as well as a stored null, which is why that key sits outside `required`
  (`fl_backend/app/core/constraints.py :: _KONTAKT_KENNTNISNAHME`). The `$ne: null` half matches a
  stored value alone, so an empty seat and an already-clear one match neither.
- **Null rather than `$unset`**, which is the shape every write path stores and every read answers
  as none (`fl_backend/app/api/bewerbungen/services.py :: compose_kontakte`).
- **One update per seat, each carrying its own seat's term**, for the reason §2's rename gives: a
  dotted path cannot traverse a null, and a document the term matched necessarily holds that seat.

Then `--check` again.

## 12. Deleting this season's player records and resetting the action log

**Once, at the end of this season, and never again** — the ruling and what it is for are
[`../datenschutz.md`](../datenschutz.md#3-the-current-pupil-records-are-reset-once)'s. Both halves are
database edits: `aktionen` carries no POST and no DELETE route, and no code removes a row from it
([`../backend/spec.md`](../backend/spec.md#2-invariants) I119).

**The log goes LAST whichever route the player half takes**, because every write through
`fl_backend/app/core/crud.py` appends a row to it: taken through
`DELETE /spieler/{spieler_id}/erasure` per person, the player half leaves rows this reset then has to
take, and each of those calls is refused until that person is retired (`REQ-PURGE-001`). Which route
the player half takes is not settled here.

**What the reset reaches that the retention index cannot is the rows carrying no `at_date`**, which
nothing expires (I119), and a count of them says how many are left.

**Nothing here is reversible and the rows are their own record.** A log row IS the image of what a
write replaced ([`../glossary.md`](../glossary.md#aktion--one-recorded-write-and-what-it-replaced-or-removed)),
so nothing survives this to say what the removed writes held. Take the snapshot's timestamp down
first ([section 13](#13-after-a-restore-from-a-snapshot)). Erasing every `aktionen` row is run by
hand as a MongoDB Playground paste, as every migration here is (§2).

**The player half is what lets the old late-entry key go**: once it has run, no stored squad row
carries the marker under its old spelling, and the leniency that reads it is removed in one change
([`../backend/spec.md`](../backend/spec.md#2-invariants) I303).

**The referee rows standing today go at a different moment, not at this season's end**: immediately
before the deploy whose fixture read first consults a referee's own consent record, so that read
never meets a live row nobody asked
([`../datenschutz.md`](../datenschutz.md#3-the-current-pupil-records-are-reset-once)). The rows are
the ones carrying no consent record; a row whose confirmation link went out and is still unanswered
carries none either, so read what the term matches before dropping anything. It is run by hand as a
MongoDB Playground paste as well, and it is **not** a referee's erasure, though it repoints as one
does: every fixture naming one of those rows is repointed at the ghost
(`fl_backend/app/core/sentinels.py :: GHOST_SCHIEDSRICHTER_ID`) with its embedded `name` nulled, the
update `fl_backend/app/api/schiedsrichter/services.py :: build_ghost_repoint` builds. Four things
decide whether the one pasted is right:

- **The ghost exists first.** Only an erasure writes it, inside its own transaction, so a league
  that has had none holds no such row: insert exactly the document
  `fl_backend/app/api/schiedsrichter/services.py :: build_ghost_schiedsrichter` builds, and a repoint
  run without it points every fixture at a document nobody has.
- **Repoint before deleting, counting both** — the fixtures naming the rows, and the rows — and read
  each count the database reports against it. `spiele.schiedsrichter.schiedsrichter_id` is a
  required id, so a null is refused rather than stored.
- **Afterwards no fixture names an id with no referee row behind it, no fixture booked to the ghost
  holds a name, and exactly one ghost stands.** Read one of those fixtures on the site; its referee
  reads „anonym“.
- **The log's images of them go too, as an erasure's do.** Every `aktionen` row holding a dropped
  referee's image, their own rows' and the `spiele` rows' naming them, takes
  `fl_backend/app/core/recording.py :: build_redaction_update` under one stamp, found by
  `fl_backend/app/core/recording.py :: build_redaction_filter` and
  `fl_backend/app/api/schiedsrichter/services.py :: build_booked_image_filter`; otherwise the log
  keeps their contact fields for its twelve months.

A fixture still to be played at that moment sits on the ghost and surfaces as a retired booking
until a referee is assigned
([`../datenschutz.md`](../datenschutz.md#5-erasure-reaches-everyone-who-asks)), so the drop belongs
in a break between match weeks; and the ghost claims no slot
(`fl_backend/app/api/spiele/services.py :: find_slot_claims`), so no double booking among those
fixtures is ever reported.

## 13. After a restore from a snapshot

**The published notice promises that nothing comes back from a backup without the person's erasure
being run again** (`fl_frontend/src/features/meta/components/views/DatenschutzView.tsx`), and nothing
in the product replays one
([`../datenschutz.md`](../datenschutz.md#5-erasure-reaches-everyone-who-asks)), so this is how that
promise is kept. Two things a restore is contemplated for: a hand-run migration that succeeded against
a mistyped path (§2), and a mistaken erasure, for which the snapshot window is the only route back.

**The action log cannot be the list, because the restore rolls it back too.** Everything written
between the snapshot and the restore is gone, the log's own rows about the erasures inside that window
included, so the record is the mail thread — which is the record in any case, there being no ticket
system ([section 5](#5-when-somebody-asks-for-their-data-or-asks-us-to-change-it)). Write down which
snapshot was restored, so which requests fall after it is answerable later.

**`python -m app.core.constraints --check` BEFORE anything else** (§2). A snapshot taken before a
constraint landed restores rows the current validators reject, and the validators are attached strict,
so such a row refuses any erasure below that writes over it rather than removing it.

**Then read every erasure the mailbox answered inside the window, and run each again.** A restored row
does not look erased, and each role's guard reads something the restore took away:

- **A referee.** The whole row is back, with its name, school and contact members, and every fixture
  the erasure had repointed names them again in place of the ghost, so nothing reads as erased and
  they are editable and bookable. `POST /schiedsrichter/{schiedsrichter_id}/anonymisieren` does all
  of it again.
- **A pupil.** The person and their squad rows are back and standing, so the erasure is refused until
  the retirement is stamped again (`REQ-PURGE-001`): `DELETE /spieler/{spieler_id}`, then
  `DELETE /spieler/{spieler_id}/erasure`.
- **A contact seat.** Every seat that address held is back and filled. `POST /kontakte/erasure` is
  keyed on the address, so the address off the thread is the whole input — and the armed panel's list
  now names seats written since the snapshot as well, which is why section 5 says to read it before
  pressing.
- **Anybody who had signed in, whatever their role.** The `auth` database is on the same cluster
  ([`spec.md`](spec.md) I174), so a restore of the cluster brings back their `user`, `session`,
  `account` and `passkey` rows with everything else. Run section 5's hand step in the sign-in store
  again for each of them, after the route's erasure above; for an administrator, after their
  grant's revoke below.

**The log's redactions came back as well**, so re-running each erasure is also what re-empties the
images it had stamped ([`../backend/spec.md`](../backend/spec.md#2-invariants) I42, I212).

**Then re-run every grant and ban change made inside the window**, which the restore undid as it
undid the erasures, and which nothing re-runs:

- **A grant revoked, or a tier changed, after the snapshot is back as it was.** The grant and its
  announced row return together, so the reconciliation mails nobody, and the grant admits its
  holder again, an erased administrator among them. Revoke it again with
  `DELETE /berechtigungen/{berechtigung_id}`, or repeat the tier change
  ([section 3](#3-granting-or-revoking-admin-access)). A grant made after the snapshot is gone and
  is made again. The record of each is the mail every change sent every administrator
  (`docs/backend/spec.md :: I439`).
- **A ban entered after the snapshot is gone, and one lifted after it is back.** Enter each again
  at `/bereich/admin/sperrliste`, which mails the person again, and lift the others there; the mail
  thread that asked for each is the record, the log having rolled back with it.

**Two consequences more.** The retention sweep repairs itself, its clocks being
stored dates — but a deletion notice already sent whose stamp the restore took back is sent a second
time, that sweep mailing before it erases ([`../backend/spec.md`](../backend/spec.md#2-invariants)
I151). And **an erasure with no mail thread behind it is reachable by nothing here**: the log cannot
answer for it and no check finds it, so a request answered outside the mailbox is one this procedure
misses.

## 14. The `auth` database's indexes

**Every production boot of the frontend builds them, and serves the site whether or not each is
built** (`fl_frontend/src/core/authIndexes.ts :: AUTH_INDEXES`, `docs/frontend/spec.md :: I498`). An
index the boot could not build is one `FE-AUTH-011` line naming it, and only a store that did not answer is built again before the next boot, so read the frontend's log for that code after every deploy:

| The line's `code` | What stands                                                       | What to do                                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `85`              | An index on the same key under another name, which keeps serving  | Give the list's entry the name the Atlas console shows, in a release                                                                                                     |
| `11000`           | Rows sharing a value the index keeps unique; no index on that key | Group the collection on the key in the Atlas console to find them. Which row stays is a judgement about those accounts, and the next boot builds the index once one does |
| `13`              | Nothing: the sign-in store's database user may not build an index | Grant that user `readWrite` on `auth` in the Atlas console, which carries `createIndex`, then restart the frontend container                                             |
| none              | Nothing: the store did not answer the boot                        | Nothing: the frontend builds them again when the store answers, and logs `FE-AUTH-011` again for any still refused                                                       |

**A name in the list is the one production's index carries.** Three of them — the `passkey`
collection's unique `credentialID` and both expiry indexes — were made in the Atlas console before
the frontend built any, and a same-key index under another name is the code-85 line above.

**For a release changing an index's key or options, drop the old one in the Atlas console as it
deploys, then restart the frontend container**: `createIndex` refuses a name already held at other
options and builds nothing in its place, so the old index would otherwise stand for good.

**The two expiry indexes are the retention.** The library writes an `expiresAt` on every
`verification` row and every `session` row and deletes neither on a schedule: an expired
verification row goes when some later sign-in reads that collection, and a session row when its own
cookie comes back. With an expiry-after of zero seconds the stored value is the deletion time.

- **`verification` is the one that matters.** The sign-in action is public, reachable by a POST to
  any URL on the site rather than to `/signin` alone, and the library writes the row before the send
  gate is consulted, so the address of anyone who submits the form is held until the index removes
  it.
- **`session` is defence in depth**: a row for anybody who signed in and closed the browser is held
  for the library's full `expiresIn` otherwise, and with the index the store stops serving what the
  guards in `fl_frontend/src/core/auth.ts` would refuse anyway.

**An index dropped by hand after a boot is reported by nothing until the next one**, and
`app.core.constraints --check` (§2) reads the backend's own declared indexes, which these are not.

**A Better Auth release that declares an index of its own on a key the list covers throws on every
write to that collection**, its adapter building the library's name where the list's already
stands. The frontend's sign-in db suites build the list before each case, so such an upgrade fails
them before it ships; the repair is the list's entry taking the library's name.

## 15. When a sign-in code does not arrive

**To the person, every reason a code does not arrive looks alike**: the page answers one sentence
whether a code went or not, so the frontend's log is the only record, and no line on this path
carries the address. Ask when they tried and read that window
([`../logging/error-codes.md`](../logging/error-codes.md) for each code):

- `auth.sign_in_gate_failed` under `FE-AUTH-002`: the send gate could not read what the backend
  holds for the address, its ban included, so it sent nothing — the backend unreachable, failing,
  or answering unreadably.
- `auth.sign_in_gate_address_refused` under `FE-AUTH-002`: the backend refused the address as none
  its own rule accepts, though the sign-in form took it; the two address rules disagree.
- `auth.code_send_failed` or `auth.sign_in_failed` under `FE-AUTH-002`: the gate admitted the
  address, and the send or the library call around it failed; `FE-MAIL-001` under the same trace id
  is the provider refusing the message.
- `auth.code_mail_capped`, an info line: five codes had been asked for the address inside the
  hour, so this one was sent nothing (`docs/frontend/spec.md :: I442`). The five count every request,
  a stranger's and one the gate refused included, so an address can be capped with nothing mailed;
  retries during a backend outage spend a person's hour the same way.
- `auth.code_mail_total_capped` under `FE-AUTH-008`: a hundred codes had been mailed across every
  address inside the hour (`docs/frontend/spec.md :: I447`), so nobody was sent one; a code a
  person already held still stands, bar a send racing the hundredth. Only admitted addresses count,
  so a run of these is a flood over members' addresses or an evening outgrowing the figure; it lifts
  within the hour, or at once by the sweep in §17.
- `mail.withheld`: a stack that is not production mails nothing, and the message is in its sink.
  On the local stack that is `.tmp-mail/`, which every `./scripts/ops/local.sh` start empties of what
  earlier runs filed, so a code there is this run's.

**A refusal by the gate writes no line.** It refuses an address that is barred, or that holds no
record of its own (`docs/glossary.md :: Konto`) and none awaiting its confirmation; an address whose
records all await confirmation is mailed, to be told so once signed in, unless it is barred. So a quiet window means a refusal, or a
message the provider accepted and the mailbox never showed, whose bounce the delivery webhook
reports (§10). An administrator's grant is read on that same call
(`fl_frontend/src/core/signInGate.ts :: mayReceiveSignIn`), so an administrator too is mailed
nothing while the backend does not answer.

## 16. The secret files

**Every credential is a file under `secrets/`, beside the compose file**, under one name on the
host, at `/run/secrets/` in its container and in development ([`spec.md`](spec.md) §1.2, I508).
Which service reads which, and each file's owner and mode on the server, is that section's table.
**A file holds its value and nothing else**: no `NAME=`, no quotes, no comment. Both readers drop a
trailing newline and surrounding blanks, and everything else in the file is part of the value.

**Each machine has its own.** The internal keys, the ban list's key, the sign-in secret and the
actor token's key pair authenticate one machine's processes to each other, so a development machine
generates fresh ones and never copies production's. **A development machine holds no production
login at all**: its two database URI files name the local stack's database through the port that
stack publishes on loopback, the local stack itself hands its services an inline config naming its
own database, and the one production file a development machine holds is `secrets/dump_mongodb_uri` below.

On a development machine, in Git Bash at the checkout root, this writes every file `pnpm dev`,
`fastapi dev` and the local stack read but the actor token's key pair, which its own command below
writes, each readable by its writer alone, and prints nothing:

```bash
(umask 077 && mkdir -p secrets && for name in internal_api_key_base internal_api_key_system internal_api_key_admin sperrliste_schluessel auth_secret; do openssl rand -hex 32 | tr -d '\r\n' > "secrets/$name"; done && printf 'mongodb://localhost:27017/?directConnection=true' | tee secrets/frontend_mongodb_uri > secrets/backend_mongodb_uri)
```

`openssl rand -hex 32` is the 64 characters every key's floor or length demands. Neither of the
provider's keys is written: nothing outside production sends mail, and the provider sends its
delivery events to production alone. Nor is `turnstile_secret_key`: outside production the bot
check verifies with Cloudflare's published passing secret, so a development machine's
`fl_frontend/.env` carries the site key that secret passes, `TURNSTILE_SITE_KEY=1x00000000000000000000AA`
([Cloudflare's testing page](https://developers.cloudflare.com/turnstile/troubleshooting/testing/),
read 2026-10-04). **Production holds the widget's own pair**, the site key in `fl_frontend/.env`
and the secret in `secrets/turnstile_secret_key`, both from the Cloudflare dashboard's Turnstile
widget, and refuses to boot on either published test key.

**`secrets/dump_mongodb_uri` is the one exception, and it is production's read-only login**, which
reads the application database and nothing else: `./scripts/ops/local.sh --seed` copies production
with it and with no other login. Copy its URI out of the password manager into the file in an
editor, never through a shell command that echoes it.

**No line in either package file names a value a secret file holds**: the deploy and `local.sh`
refuse one before compose reads the file ([`spec.md`](spec.md) §1.5). Delete such a line in an
editor, never with `cat`.

**On the server, each file is owned by the user that reads it** ([`spec.md`](spec.md) §1.2): a new
value is written without ever existing under another owner or mode, and without passing through the
shell's history. For a value that exists only in the password manager, run the line for its owner
and paste the value, then Ctrl-D:

```bash
sudo install -o 1001 -g 1001 -m 400 /dev/stdin secrets/<a frontend file>
sudo install -o 1002 -g 1002 -m 400 /dev/stdin secrets/<a backend file>
sudo install -o root -g 1003 -m 440 /dev/stdin secrets/<an internal key>
```

**Each service reads its files once, as it boots**, so a value replaced on a running stack — a
wrong `secrets/turnstile_secret_key` among them, which fails every bot check until then — takes
effect only with the next `./scripts/ops/deploy.sh`, which judges it and recreates both containers.

**Where a deploy refuses naming a file**, the refusal says
which fault: a missing one is written, an unreadable one is given the user and mode above, a blank
one is written again. **Where it names an `INTERNAL_API_KEY_*`, that key carries a character outside
the class** ([`spec.md`](spec.md) §1.5): generate all three again on the server, each with
`openssl rand -hex 32 | tr -d '\r\n' | sudo install -o root -g 1003 -m 440 /dev/stdin secrets/<key>`,
and update the password-manager entry. Both containers are recreated by the same deploy, so the new
keys never meet the old. **`sperrliste_schluessel` is never replaced**: every ban is stored under it,
and a new one disarms them all in silence (§5). **A new `auth_secret` signs everybody out.**

**Each machine also has its own actor token key pair** ([`spec.md`](spec.md) I472): an Ed25519
private key the frontend signs with, and its public half the backend verifies with. In Git Bash on a
development machine, or in a shell on the server, at the checkout root, this writes the private half
to a directory of its own that `mktemp -d` makes readable by its writer alone, and appends the public
half to `fl_backend/.env`, printing nothing:

```bash
t="$(mktemp -d)" && (umask 077 && openssl genpkey -algorithm ed25519 | tr -d '\r' > "$t/key") && printf '\nACTOR_TOKEN_PUBLIC_KEY=%s\n' "$(openssl pkey -in "$t/key" -pubout -outform DER | tail -c 32 | basenc --base64url | tr -d '=\r\n')" >> fl_backend/.env
```

The `tr` calls are there because Git Bash's `openssl` ends each line with a carriage return. The
public half is the key's last 32 bytes in DER form, which is the raw Ed25519 key that
`ACTOR_TOKEN_PUBLIC_KEY` holds. The newline before it keeps it off a last line that has none. The
`umask` is what keeps the private half from ever existing under the shell's default mode, which
lets every account on the host read a new file. **The key is written outside `secrets/`** because
the deploying user cannot write there on the server, where the directory is root's.

Then put the private half in place, from the same shell, which still holds `$t`:

- **On the server**, owned by the frontend's user and readable by it alone:
  `sudo install -o 1001 -g 1001 -m 400 "$t/key" secrets/fl_actor_signing_key && rm -rf "$t"`.
  `install` replaces a key the deploying user cannot write, which is what an earlier pair left
  behind. `deploy.sh` warns where the key's mode lets any other account reach it.
- **On a development machine**:
  `(umask 077 && mkdir -p secrets && mv "$t/key" secrets/fl_actor_signing_key) && rm -rf "$t"`.
- **For `pnpm dev`**, write nothing more: the `dev` script names the file itself
  ([`spec.md`](spec.md) §1.5). Never name it in `fl_frontend/.env`, which the frontend container
  reads too: it would look for the key at that path rather than at its mount, and refuse to start.
- **Rotating** is the same two steps and a deploy, after deleting the old `ACTOR_TOKEN_PUBLIC_KEY`
  line from `fl_backend/.env`. A token lives sixty seconds, and the deploy recreates both containers
  together. The pair is kept nowhere else: a lost key is replaced by generating a new pair.
- **After a suspected leak of the signing key together with `internal_api_key_admin`**, the two can
  have minted a grant credited to any administrator, which neither can alone. Rotating both is not
  finished until `aktionen` has been read for every `berechtigungen` write since the leak, and every
  grant nobody can account for is revoked in the Playground.

`deploy.sh` and `local.sh` refuse a missing key file before anything starts. The frontend's boot,
run as §1 says, then refuses a key it cannot read where its environment points it or one that is not
Ed25519, naming the path: where that path is not `/run/secrets/fl_actor_signing_key`, delete the
`ACTOR_SIGNING_KEY_FILE` line from `fl_frontend/.env`. Last, the frontend service's own container,
handed the `ACTOR_TOKEN_PUBLIC_KEY` line alone, judges the pair: an `ACTOR_TOKEN_PUBLIC_KEY` that is
missing, malformed or not the key's public half. Each refusal names the fault and never a value, and
the remedy is to run the command above again.

## 17. Clearing an address's code lock

An address that has failed ten codes in a row, with no sign-in between them, is refused every code
until the oldest of those failures is a day old, the right code included
(`docs/frontend/spec.md :: I441`); the person is
told there were too many tries with this address. Anyone who knows an address can bring it on, and
the rows counting it carry a keyed hash rather than the address (`:: I445`), so no row can be picked
out for one person:

- **A person holding a passkey needs nothing**: a passkey sign-in never meets the lock, and clears it.
- **Otherwise it lifts by itself**, each failure's row expiring a day after it was written, removed
  by the `verification` index in §14.
- **To lift it sooner, lift every address's at once**: in the Atlas console, delete from the `auth`
  database's `verification` collection every row whose `identifier` starts with
  `sign-in-attempt-`. Every address then has its ten tries back, which is the price of an
  identifier nobody can compute by hand.

The five-an-hour mail cap (`docs/frontend/spec.md :: I442`) keeps rows of the same shape under
`sign-in-mail-`, the every-address total (`:: I447`) among them as `sign-in-mail-every-address`;
they lift within the hour. During a flood the total can be lifted sooner the same way, by deleting
every row whose `identifier` starts with `sign-in-mail-`, which gives every address its hour back.

**Twenty member addresses are enough to close code sign-in for everyone, and to close it again every
hour.** Only mailed codes count toward the total, and a person's address is mailed up to five an
hour, so anyone who knows twenty addresses the gate admits can ask for the hundredth code alone;
while the total is full nobody is mailed a code, and a passkey still signs its holder in. Lines
under `FE-AUTH-008` that come back hour after hour, or soon after a sweep, are that case rather
than a busy evening. The sweep above reopens code sign-in only until the requests come again, since
it clears the per-address rows too; while it recurs, point the people who sign in by code at a
passkey, and repeat the sweep when it closes again.

## 18. The Node a checkout runs

**`pnpm install` in `fl_frontend/` downloads the Node `fl_frontend/package.json :: devEngines` pins,
and every `pnpm run` and `pnpm exec` in that checkout runs it**, whatever Node the machine has
installed; `pnpm exec node --version` there prints the pinned release. A pull request moving the pin
needs nothing more on a machine than the next `pnpm install`.

**A bare `node` still runs the machine's own**, and `.claude/hooks/docs-standard.sh`,
`.claude/hooks/implementer-whole-suite.sh` and `scripts/gate/selfcheck.sh` call it bare. Install the pinned release machine-wide from
https://nodejs.org/en/download, and again whenever the pin moves: a machine left on an older release
of the line keeps every security flaw fixed since.

## 19. The database's storage alert

**Nothing in this repository watches how full the database is, and the production tier has a hard
limit**: 5 GB of documents and indexes together. What a write meets past it is unverified: MongoDB's
page on the limit states the size and not the behaviour, so plan for every save failing at once.
What keeps one person from filling it is the daily write ceiling (`docs/backend/spec.md :: I614`,
its numbers `fl_backend/app/shared/schemas/bounds.py :: DROSSELUNG_KONTAKT_PRO_TAG` and its two
siblings), sized so that no one person writing 10 KB a write at their ceiling every day reaches the
first alert below within a year. The alerts show the rest: many people at once, the action log's own
growth, or counts that stopped expiring.

**No alert on a Flex cluster reads the limit's own measure at a threshold we choose.** The one size
condition it takes a threshold on, `DB Data Size is`, reads documents alone, so it is set low enough
to leave the indexes room, and the fixed alert reading both stays on behind it:

1. In the Atlas console's alert settings for the project, add an alert on `DB Data Size is` above
   2 GB, notifying the league's own address. It fires ahead of step 2's alert as long as the
   indexes stay smaller than the documents.
2. Add an alert on `Flex metric outside threshold`, notifying the same address, which Atlas does not
   set for a new project. It reads documents and indexes together and fires past 4 GB: it is the one
   alert on the limit's own measure, so it is the backstop where the indexes outgrow the documents,
   and never the warning, since it leaves a fifth of the limit.
3. Read both back in the console's list of alert settings.

The condition names and figures are copied from MongoDB's Atlas documentation, which moves without
us; read 2026-10-07:

- the conditions and what each measures: https://www.mongodb.com/docs/atlas/reference/alert-conditions/
- the limit and what it counts: https://www.mongodb.com/docs/atlas/reference/flex-limitations/
- the alerts a new project gets: https://www.mongodb.com/docs/atlas/configure-alerts/

**When either fires, find the collection that grew**, from the cluster's collection and index sizes
in the Atlas console. `drosselung` holds one row per person, kind of person and day, which its TTL
index removes (`docs/backend/spec.md :: I619`), so a large one there is the TTL monitor stopping
rather than people writing. Indexes larger than the documents put step 1's alert behind step 2's:
lower its threshold below 4 GB times the documents' share of documents and indexes.
