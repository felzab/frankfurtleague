# Ops — runbooks

**Purpose:** the recurring procedures that are run rather than read, and the operational facts no file in this repository states

The contracts these depend on — the services, the scripts, the gate scopes and the registry — are
[`spec.md`](spec.md); the pipeline a change travels from a branch to a deploy is
[`../_git/spec.md`](../_git/spec.md) §1.1.

---

## 1. The server

**The repository does not record which host this is**, and deliberately holds no credentials. Getting onto
the machine is outside the repository. What it does tell you:

- `deploy.sh` refuses to run anywhere but Linux, and runs from a **checkout of this repository on the
  server** — so putting a merge live is `git pull && ./scripts/ops/deploy.sh`, the pull being what brings the
  compose file and `nginx/prod.conf` up to date before the containers are recreated.
- `fl_frontend/.env`, `fl_backend/.env`, `./nginx/prod.conf` and `./certs/` must all exist beside the
  compose file — preflight checks each before anything is pulled.
- **Only the application containers are recreated**, and nginx is reloaded once they are healthy
  (`scripts/ops/deploy.sh :: serve_through_nginx`). The edge keeps running across the swap, so a deploy that
  succeeds costs seconds of 502 rather than a refused connection. The reload is also the only thing in the
  run that applies an `nginx/prod.conf` the pull changed: nothing recreates nginx for a mounted file's
  contents.
- **A build that fails the health wait is put back automatically** — to the images the application services
  were running when the deploy began, by image id rather than by tag (`scripts/ops/deploy.sh :: roll_back`) —
  and the script names the build now serving. **That path is not seconds**: the 502 runs until the restored
  pair is healthy and nginx has been reloaded again, up to about eleven minutes where both health waits run
  to their timeouts and the rollback's do the same. Nothing is put back where preflight recorded no target,
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
  -e API_TRUSTED_HOSTS=x -e API_CORS_ALLOWED_ORIGINS=x \
  -e INTERNAL_API_KEY_BASE=x -e INTERNAL_API_KEY_SYSTEM=x -e INTERNAL_API_KEY_ADMIN=x \
  <backend-image> python -m app.core.constraints --check
```

**Seven variables are required and two carry real values.** `BackendConfig` declares seven fields with no
default, one per variable above, so `-e MONGODB_URI=` alone exits 1 on a validation error naming the
internal keys rather than anything about the database. `--check` reads the database and nothing else, so the hosts, the origins and
the three keys may be any non-empty string — **do not go looking for the production ones.**

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

**The facet counts are the second thing to distrust.** They count the loaded rows alone, so a facet reading
zero means zero among what came back rather than zero in the queue.

**Reversing the read is the recovery the page offers, and the only one.** The default order is newest first,
so what a cut-short answer keeps is the newest rows and what it drops is the oldest — which is exactly where
applications submitted before a flood sit. The notice names which end is loaded and links to the other, the
link reading `die ältesten zuerst laden` on a default view
(`fl_frontend/src/features/bewerbungen/utils.ts :: leserichtungHref`, with `:: parseLeserichtung` reading the
`order` parameter back and treating anything unexpected as the default). The page sends `order` and nothing
else (`fl_frontend/src/app/admin/bewerbungen/page.tsx`).

**The reversed view is not a complete one, and the notice says so about itself.** It closes on `Auch diese
Ansicht bleibt unvollständig` whichever end is loaded. Reversing swaps which rows are missing; it does not
reduce how many are.

**Narrowing by season or status is not offered, and that is a finding rather than an omission.** The read
accepts both (`fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbungenFilterParams`), but neither
separates a flood from genuine applications: a submission is admitted only while a season's window is open
(`fl_backend/app/api/bewerbungen/services.py :: find_window_refusal`), so a flood lands in the season the
public form points at, and the server sets `status` on write, so every flooded row is `eingereicht`. Both
facets would therefore select the flood itself. Reaching those parameters anyway would mean a backend call,
and the edge carries exactly one backend path (`= /api/v0/system/is_live`, [`spec.md`](spec.md) I13), so it
would have to be made on the server against the backend container. Nothing in this repository wraps that.

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
