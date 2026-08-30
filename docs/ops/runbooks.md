# Ops — runbooks

**Verified against:** `d666f6c9`, 2026-08-30\
**Purpose:** the recurring procedures that are run rather than read, and the operational facts no file in this repository states

The contracts these depend on — the services, the scripts, the gate scopes and the registry — are
[`spec.md`](spec.md); the pipeline a change travels from a branch to a deploy is
[`../_git/spec.md`](../_git/spec.md) §1.1. Each script's `--help` prints its header, which carries its usage.

---

## 1. The server

**The repository does not record which host this is**, and deliberately holds no credentials. Getting onto
the machine is outside the repository. What it does tell you:

- `deploy.sh` refuses to run anywhere but Linux, and runs from a **checkout of this repository on the
  server** — so putting a merge live is `git pull && ./scripts/deploy.sh`, the pull being what brings the
  compose file and `nginx/prod.conf` up to date before the containers are recreated.
- `./certs/` and `./nginx/prod.conf` must exist beside the compose file.
- After the health wait, `deploy.sh` **confirms the security headers as they are actually served** — the one
  check that reads the running stack rather than a config file.

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

### Renaming the Trainer's second-seat flag on stored contact blocks

`kontakte.trainer_ist_ansprechperson` became `kontakte.trainer_ist_zugleich` on both collections that
hold a contact block. `true` named the Ansprechperson and `false` named nobody, so the mapping is
total and the rewrite loses nothing. It is a one-off, so it is instructions rather than a script: run
them in `mongosh` against the application database.

**It runs AFTER a boot has attached the new validator, and never before.** The rewrite `$unset`s a key
the OLD validator still lists in `required` on both collections, so against that validator every
statement below is refused document by document with error code 121. `apply_constraints` runs at
startup (`fl_backend/app/core/db.py :: lifespan`), so the order is: deploy, let the backend boot,
confirm it is serving, then run these. Until the rewrite reaches a row, that row's next write fails
and every read of it is unaffected — which is the window this ordering keeps as short as it can be.

Read first, and keep the numbers:

```javascript
["saison_teams", "bewerbungen"].forEach((name) => {
  print(name + ": " + db.getCollection(name).countDocuments({ "kontakte.trainer_ist_ansprechperson": { $exists: true } }));
});
```

Then the rewrite, one statement per stored value per collection:

```javascript
["saison_teams", "bewerbungen"].forEach((name) => {
  const collection = db.getCollection(name);

  printjson(
    collection.updateMany(
      { "kontakte.trainer_ist_ansprechperson": true },
      { $set: { "kontakte.trainer_ist_zugleich": "ansprechperson" }, $unset: { "kontakte.trainer_ist_ansprechperson": "" } },
    ),
  );

  printjson(
    collection.updateMany(
      { "kontakte.trainer_ist_ansprechperson": false },
      { $set: { "kontakte.trainer_ist_zugleich": null }, $unset: { "kontakte.trainer_ist_ansprechperson": "" } },
    ),
  );
});
```

Then confirm. **Every line this prints must be `0`:**

```javascript
["saison_teams", "bewerbungen"].forEach((name) => {
  print(
    name + " left with the old key: " + db.getCollection(name).countDocuments({ "kontakte.trainer_ist_ansprechperson": { $exists: true } }),
  );
  print(
    name +
      " missing the new key:  " +
      db.getCollection(name).countDocuments({ kontakte: { $ne: null }, "kontakte.trainer_ist_zugleich": { $exists: false } }),
  );
});
```

The second count excludes a null block rather than the collection: `saison_teams.kontakte` is nullable
as a whole, so a row holding no block at all is not a row missing the field.

**Safe to repeat, and expected to find nothing where it has already run.** A rewritten row does not match
`$exists: true`, so a second pass matches nothing — which is what makes the read pass worth
keeping: a zero there says the environment needed none of this, rather than that the rewrite worked.
Re-run `python -m app.core.constraints --check` afterwards, as every edit to stored documents does.

### Giving `teams.schulform` a value for the clubs that predate it

The property is declared outside the `teams` validator's `required`, so it fails no stored row and the
deploy owes nothing. This fills in what a club's own name already says, so an administrator opens the
editor to decide rather than to transcribe.

Run it in `mongosh` against the application database, after the deploy, on a database whose `--check`
reads clean:

```javascript
db.teams.updateMany({ schulform: null, name: /Gesamtschule/i }, { $set: { schulform: "gesamtschule" } });
db.teams.updateMany({ schulform: null, name: /Oberstufengymnasium/i }, { $set: { schulform: "oberstufengymnasium" } });
```

**Those two are the whole of what a name can settle, and the omission is the point.** A club called
`… Gymnasium` may run G8 or G9 and its name says neither, so writing one of them would be a guess stored
as a fact — and a wrong `schulform` is invisible, because nothing downstream contradicts it. Every club a
name cannot place keeps its null, which the editor shows as unset.

The filter matches on `schulform: null` rather than on the whole collection, so a value somebody has
already set by hand survives a second run and the statements are safe to repeat. Re-run
`python -m app.core.constraints --check` afterwards, as every edit to stored documents does.

## 3. After changing anything about the brand mark

```bash
cd fl_frontend && pnpm brand
```

Regenerates the favicon, app icons, both manifest sets, the Open Graph card and the `FLLogo` component from
one parameterised source. **Re-run it rather than editing any of its outputs**, or the header mark and the
icons drift apart.

## 4. Granting or revoking admin access

Editing `ALLOWED_ADMIN_EMAILS` and restarting is the whole procedure; why a restart is needed and how `role`
is re-derived afterwards are [`spec.md`](spec.md) §4. Two things follow that are easy to get wrong:

- **The session row is not the grant.** It stays in the `authjs` database after a revocation and authorizes
  nothing, so deleting it by hand is tidying rather than revocation.
- **An admin ending their own session needs no restart at all**: the sidemenu's options menu carries a
  sign-out, which arms on the first press and ends the session on the second.
