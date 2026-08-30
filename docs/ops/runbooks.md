# Ops — runbooks

**Verified against:** `6adfac16`, 2026-08-30\
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

**It runs in two halves, one either side of the deploy, and running it all afterwards takes the admin
contacts editor down.** `fl_backend/app/api/teams/schemas.py :: FLSaisonTeamKontakte` declares
`trainer_ist_zugleich` with no default, so Pydantic requires it; a row still carrying only the old key
fails to validate. `GET /teams/memberships` is the one consumer of the one pipeline that projects
`kontakte` (`fl_backend/app/api/teams/services.py :: build_team_memberships_pipeline`), and it validates
the whole list at once, so ONE un-rewritten row answers 500 for every club. That endpoint is the sole
source for the admin contacts editor and the admin club list — and the editor is the only route to
repairing a bad row, so the outage would take away the page the repair is done on.

**One write echo is exposed as well, and it fails AFTER the write.**
`fl_backend/app/api/teams/admin_router.py :: patch_saison_team` echoes the block from the after image, and
`patch_one_in_db` runs there with no session, so a junction PATCH against a row carrying a pre-migration
block commits and then answers 500 on the echo — the caller cannot tell whether the change was saved. The
other three echoes are safe: entry passes a literal `None`, and the contacts PATCH and the replacement
both read the after image of a `$set` they just made. What is NOT the protection is the keyword
construction: an absent key yields `None` through `.get`, but a block that is PRESENT and carries the old
key is a dict Pydantic validates and refuses (measured 2026-08-30).

**The `$set` half is safe BEFORE the deploy, and that is what closes the window rather than shortening
it.** `fl_backend/app/core/constraints.py :: _object` emits `bsonType`, `required` and `properties` and
never `additionalProperties: false`, so the old validator permits a key it does not declare. Writing the
new key while LEAVING the old one in place therefore passes the old validator — its `required` still
names the old key, which is still there — and it also satisfies the new model the moment the new code
boots. Probed against both states: old key alone is refused on `kontakte.trainer_ist_zugleich`; both keys
together are accepted (measured 2026-08-30).

The order is therefore:

1. **Before the deploy**, `$set` the new key from the old key's value, leaving the old key in place
2. Deploy, let the backend boot — `apply_constraints` attaches the new validator at startup
   (`fl_backend/app/core/db.py :: lifespan`) — and confirm it is serving
3. **After that**, `$unset` the old key, which the new validator does not list in `required`
4. Re-run `python -m app.core.constraints --check`

Running step 3 before the deploy is what the old validator refuses, document by document, with error
code 121: it lists the old key in `required` on both collections. Running step 1 after the deploy is
what opens the outage above.

**Measured on `fl_main`, 2026-08-30:** `saison_teams` held 16 rows, none of them carrying a contact block
at all, and neither the old key nor the new one appeared on any row. A blockless row reads fine, `kontakte`
being nullable on `FLTeamMembership`, and every block written after the deploy goes through the payload
that requires the new key — so the window above needs a row this database does not have. That is a fact
about today rather than a reason to reorder: the counts below are what decide, on the environment in front
of you.

Read first, and keep the numbers:

```javascript
["saison_teams", "bewerbungen"].forEach((name) => {
  print(name + ": " + db.getCollection(name).countDocuments({ "kontakte.trainer_ist_ansprechperson": { $exists: true } }));
});
```

**Step 1, BEFORE the deploy.** One statement per stored value per collection, setting the new key and
leaving the old one alone:

```javascript
["saison_teams", "bewerbungen"].forEach((name) => {
  const collection = db.getCollection(name);

  printjson(
    collection.updateMany({ "kontakte.trainer_ist_ansprechperson": true }, { $set: { "kontakte.trainer_ist_zugleich": "ansprechperson" } }),
  );

  printjson(collection.updateMany({ "kontakte.trainer_ist_ansprechperson": false }, { $set: { "kontakte.trainer_ist_zugleich": null } }));
});
```

Every row now carries both keys, which the old validator accepts and the new model accepts. Deploy, let
the backend boot, and confirm it is serving before going on.

**Step 3, AFTER the boot.** Drop the old key, which the new validator no longer requires:

```javascript
["saison_teams", "bewerbungen"].forEach((name) => {
  printjson(
    db
      .getCollection(name)
      .updateMany({ "kontakte.trainer_ist_ansprechperson": { $exists: true } }, { $unset: { "kontakte.trainer_ist_ansprechperson": "" } }),
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

**Safe to repeat, and expected to find nothing where it has already run.** Step 1 re-sets a value already
equal to itself and step 3's `$exists: true` matches nothing once it has run, so a second pass of either
changes no row — which is what makes the read pass worth keeping: a zero there says the environment
needed none of this, rather than that the rewrite worked. Re-run
`python -m app.core.constraints --check` afterwards, as every edit to stored documents does.

**No read-side default stands behind this ordering, by design.** `FLTeamMembership` defaults `kontakte`
and `trikot_farbe` so that a row predating either field cannot 500 the club list, and the obvious move is
to default `trainer_ist_zugleich` the same way. It would assert a falsehood. The asymmetry between that
model and the write echoes is deliberate and argued where the default sits
(`fl_backend/app/api/teams/schemas.py :: FLTeamMembership`); a default there would not help here in any
case, the refusals above being about a block that is present rather than one that is missing. `trikot_farbe`'s default is
true of the rows it covers — one that predates the field genuinely had no colour — whereas a row
predating this rename genuinely carries `trainer_ist_ansprechperson`, which may be `true`, and defaulting
to null would state that the Trainer holds no second seat for exactly the rows the migration exists to
convert. Nothing downstream could recover it either: no consumer reads `model_fields_set` and there is no
sentinel, so absent and null would collapse permanently at the model boundary, where today an absence is
loud and names the field. The pre-deploy `$set` writes the TRUE value per row, `true → "ansprechperson"`
and `false → null`, which is what one default for both could never do. The ordering is the whole of the
safety.

### Confirming no application squad stores a null count

`bewerbungen.kader.gute_spieler` narrowed from int-or-null to `int` in the validator
(`fl_backend/app/core/constraints.py :: _BEWERBUNG_KADER`) and is non-nullable on the model
(`fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbungKader`). A stored `null` would be refused on
read, taking the whole triage list with it, and would fail that row's own next write.

**This is expected to find nothing, and the count is what says so rather than the reasoning.** No writer
for `bewerbungen` existed before this branch — the slice declared no POST and its services performed no
insert — so a database that has only ever run released code holds no such row. **Measured on `fl_main`,
2026-08-30:** the collection held 0 documents, so no row carries a null or absent `kader.gute_spieler` and
the narrowing needs no migration there. Both are statements about today, and a count is cheap:

```javascript
print("null counts: " + db.bewerbungen.countDocuments({ "kader.gute_spieler": null }));
print("missing:     " + db.bewerbungen.countDocuments({ kader: { $ne: null }, "kader.gute_spieler": { $exists: false } }));
```

**Both lines must print `0`, and there is no rewrite here if they do not.** `null` recorded that no
number was given, so any value written in its place invents one the school never stated — pick one and
the triage reads it as the school's own answer. A non-zero count is a decision about those rows, not a
statement to run: stop, and settle what the number should be before the deploy.

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

## 5. When the application queue has been flooded

**The state announces itself, and the read degrades rather than refusing.** `GET /bewerbungen` serves at most
`LIST_LIMIT_DEFAULT` rows and reads one row past that to answer whether more exist, so it never counts the
filtered set (`fl_backend/app/api/bewerbungen/router.py :: get_bewerbungen`). Where more do exist it answers
`vollstaendig: false` and the triage page raises a standing warning that cannot be dismissed
(`fl_frontend/src/features/bewerbungen/components/ui/BewerbungenUnvollstaendigNotice.ts ::
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
decision was taken against (`:: get_bewerbungen`), so an operator who declines down the queue and sees the
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
