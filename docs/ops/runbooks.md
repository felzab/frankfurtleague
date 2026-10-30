# Ops — runbooks

**Purpose:** the recurring procedures that are run rather than read, and the operational facts no file in this repository states

The contracts these depend on — the services, the scripts, the gate scopes and the registry — are
[`spec.md`](spec.md).

**A section number is spent once taken**: a gap in the run below is a number whose procedure left,
and renumbering what stands would repoint every citation of it, the scripts' own messages among them.

| Section                                                                                                                        | Answers                                                        |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| [1. The server](#1-the-server)                                                                                                 | What a deploy does, and what a failed one leaves running       |
| [2. Before deploying a change to a stored shape or an index](#2-before-deploying-a-change-to-a-stored-shape-or-an-index)       | The order a shape or index change runs in, then the read-back  |
| [3. Granting or revoking admin access](#3-granting-or-revoking-admin-access)                                                   | Who can sign in, and what revoking actually ends               |
| [4. When the application queue has been flooded](#4-when-the-application-queue-has-been-flooded)                               | What the triage page still shows, and what stops new rows      |
| [5. When somebody asks for their data, or asks us to change it](#5-when-somebody-asks-for-their-data-or-asks-us-to-change-it)  | Where each role's data is read, and how a request is answered  |
| [6. When personal data has been exposed](#6-when-personal-data-has-been-exposed)                                               | The authority, the clock, and what the logs can establish      |
| [7. The logs' age bounds, and the copies a deploy leaves behind](#7-the-logs-age-bounds-and-the-copies-a-deploy-leaves-behind) | The host files that bound them, and where a deploy's copies go |
| [8. Taking the tunnel back out](#8-taking-the-tunnel-back-out)                                                                 | What reverses the tunnel, and the half no commit reaches       |
| [9. Checking that the hourly passes have run](#9-checking-that-the-hourly-passes-have-run)                                     | What answers each, and what each answer means                  |
| [10. The mail provider's dashboard](#10-the-mail-providers-dashboard)                                                          | The six steps no code can carry, and what breaks without them  |
| [11. A contact seat's birthdate that no confirmation stamped](#11-a-contact-seats-birthdate-that-no-confirmation-stamped)      | What finds the rows, and why no save clears one                |
| [13. After a restore from a snapshot](#13-after-a-restore-from-a-snapshot)                                                     | Who is re-erased, and what the restore took the record of      |
| [14. The `auth` database's indexes](#14-the-auth-databases-indexes)                                                            | What builds them, and what a boot that could not leaves        |
| [15. When a sign-in code does not arrive](#15-when-a-sign-in-code-does-not-arrive)                                             | What the person cannot tell apart, and the line that can       |
| [16. The secret files](#16-the-secret-files)                                                                                   | What each holds, and how each machine makes its own            |
| [17. Clearing an address's code lock](#17-clearing-an-addresss-code-lock)                                                      | Who meets it, when it lifts, and what clearing it costs        |
| [18. The Node a checkout runs](#18-the-node-a-checkout-runs)                                                                   | What `pnpm install` fetches, and what a bare `node` still runs |
| [19. The database's storage alert](#19-the-databases-storage-alert)                                                            | What fills the tier unseen, and the two alerts that show it    |
| [20. After a hand edit in MongoDB](#20-after-a-hand-edit-in-mongodb)                                                           | What a hand edit leaves cached, and for how long               |

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
  2 before compose is asked anything**, giving each line by file, number and the name as the list
  spells it, never by anything the line holds
  (`scripts/lib/_lib.sh :: refuse_credential_lines`): delete it, a credential being its file's (§16)
  and the administrator list read by nothing.
- **A line of either `.env` that is not blank, a line opening with `#`, or `NAME=VALUE` refuses the
  deploy at exit 2 before compose is asked anything**, each line listed
  as `file:line` alone, never by anything the line holds. Rewrite it with nothing
  around the `=` and a value of letters, digits and `_ - . ~ : / ? [ ] @ ! & ( ) * + , ; = %` alone:
  no quote, no space, no comment after the value, a URL writing `#`, `$` and `'` as `%23`, `%24` and
  `%27`. No line, a comment included, may hold a carriage return before its end, U+2028, U+2029 or a
  NUL byte.
- **`./scripts/ops/deploy.sh --check-env` runs the three checks above and below that ask Docker
  nothing** — the credential lines, the line shape and compose's own `.env` — and nothing else, so
  run it after the pull and before the deploy: it changes nothing and ends 0 where none refuses.
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
  accept, refuses the deploy at exit 2 with nothing recreated**, and the printed line names a
  variable the backend declares, gives each line declaring any other name by its number alone, and
  prints no value — so the remedy is read off the names and the numbers: **correct a named
  variable's value; open a numbered line, then delete it or declare its name in the settings
  class**. A check that could not be made at all is an advisory the deploy goes on
  past. It does not catch a misspelling whose value is EMPTY, which the settings reader drops before
  the check judges it; a line the two parsers
  could read differently was refused before either image was asked.
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
- **Both application containers are stopped for their logs' copy just before the recreate** (§7),
  and a run ending in between puts them back on its way out, a failed copy, an interrupt and a
  dropped SSH session alike: it starts them, reloads nginx and waits for each to be
  healthy (`scripts/ops/deploy.sh :: start_stopped_again`). **A failed copy ends the run at exit 2,
  and at 1 where the start, the reload or a health wait answered badly**: a bad start or health
  wait leaves the site out of service, and a refused reload leaves nginx on a configuration not this
  checkout's. Killed outright, or interrupted again while it puts them back, the run leaves them
  stopped, which `./scripts/ops/deploy.sh --status` reports as not running, and
  `restart: unless-stopped` never starts a container `stop` stopped, not even after the daemon
  restarts
  ([Docker's restart policies](https://docs.docker.com/engine/containers/start-containers-automatically/),
  which move without us; read 2026-10-16). **Start them and reload the edge by hand, never with
  `up`**, which would recreate them from the build the pull fetched, with no copy taken; the reload
  prints nginx's reply, then `200` once applied:

  ```bash
  docker compose -f docker-compose.yml start frontend backend
  docker compose -f docker-compose.yml exec -T nginx curl -s -w '\n%{http_code}\n' -X PATCH --unix-socket /run/nginx-control/control.sock http://localhost/1/control/config
  ```

- **Only the application containers are recreated**, and nginx is reloaded once they are healthy
  (`scripts/ops/deploy.sh :: serve_through_nginx`), through nginx's Control API, which answers whether
  the reload applied. The edge keeps running across the swap and finds the new containers by name
  , so from the stop before the copy until the new pair answers a deploy
  that succeeds answers 502 rather than refusing the connection: an estimated 10 to 30 seconds on an
  idle site, and about eleven minutes where the stop runs to the grace periods
  (`docker-compose.yml :: stop_grace_period`), each copy to its bound
  (`scripts/ops/deploy.sh :: copy_streams`) and each health wait to its last poll
  (`scripts/ops/deploy.sh :: HEALTH_WAIT_BACKEND`, `:: HEALTH_WAIT_FRONTEND`). The reload is what
  applies a file the pull changed
  under `nginx/prod/` or `nginx/shared/`, both mounted as directories so the running container reads
  what the pull wrote ([`spec.md`](spec.md) §1.2); a pull that changed nginx's own service definition
  makes the same `up` recreate it instead. **A reload nginx refuses ends the run in a finding carrying
  nginx's own lines**: fix what they name, then recreate nginx. **The deploy then compares every file
  under `nginx/prod/` and `nginx/shared/`, as nginx holds it in memory, with the checkout's, and a
  difference ends the run in a finding** naming the recreate that repairs it
  (`scripts/ops/deploy.sh :: edge_reads_checkout`). A file there that nginx
  never loads, a README among them, reads as absent and fails every deploy.
- **A build that fails the health wait is put back automatically** — to the images the application services
  were running when the deploy began, by image id rather than by tag (`scripts/ops/deploy.sh :: roll_back`) —
  and the script names the build now serving. **That path is not seconds**: the 502 runs until the restored
  pair answers, up to about twenty-two minutes where the deploy's
  stop, copies and health waits and the rollback's own all run to their bounds. **The failed build's
  own two streams are copied off first** (`scripts/ops/deploy.sh :: copy_streams`), under the deploy's stamp and a `-failed` suffix in
  `/var/log/frankfurtleague/` (§7); that copy warns rather than refusing where it cannot be made, the site
  being down by then. **An interrupt during that copy leaves the failed build stopped and nothing put
  back**, the failed build not being started again after failing its health wait: finish the rollback
  by deploying the build preflight printed as its rollback target, `./scripts/ops/deploy.sh <tag>`,
  whose own copy takes the stopped pair's streams. Nothing is put back where preflight recorded no target,
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
- **Never deploy by tag a build declaring no
  `fl_backend/app/core/sentinels.py :: GHOST_SPIELER_ID` once a later build has erased a pupil or an
  administrator; roll forward instead.** Each erasure writes a row such a build mishandles, and
  nothing refuses the deploy:
  - a pupil's, the season-after deletion's among them, writes the erased pupils' sentinel with no
    name, so that build's player list in the administration answers 500, and its public
    `GET /spieler`, asked for neither a team nor a season, serves the sentinel as a player with no
    name;
  - an administrator's queues a grant notice withheld as `geloescht`, and that build's hourly grant
    pass writes its claim on the row before reading anything, a write that build's validator refuses
    with code 121, so every pass fails and no change of access is mailed again, where the row is
    still queued as that build boots;
  - that build's boot attaches its own validators again (§2), which refuse any write over either row.
- **Never deploy by tag a build published before `sha-3eebe79`, the first build requiring the
  records as the deletion of every pupil and referee row and the emptying of the action log left
  them; roll forward instead.** Such a build's returning pupil's page stamps a consent label
  the current registry does not hold (`fl_backend/app/shared/einwilligung.py :: FASSUNGEN`), so a
  record it confirms cites words nobody can produce, and no check compares a stored label with the
  registry.
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
  healthy pair is no statement about whether the edge in front of it reaches the pair or what it
  loads.

## 2. Before deploying a change to a stored shape or an index

**What a stored document may hold is its record model** — the model `fl_backend/app/core/readback.py ::
RECORD_MODELS` maps its collection to — and nothing in the database refuses a document of another
shape: the boot builds the indexes alone (`fl_backend/app/core/constraints.py`). So a change to a
stored shape lands with the Playground paste that moves every stored document into it, and the
read-back command is what says they all moved:

```bash
docker compose -f docker-compose.yml exec -T backend python -m app.core.readback
```

On the server, from the checkout. It reads every document through its record model, writes nothing,
prints each refused document's collection, id and error location and never a value, and exits 0 when
every document validates, 1 when any is refused, and 2 when the database could not be read. Its last
line names the collections it does not read.

**Run it after the paste and the deploy, never before**: it judges stored documents against the
models of the image it runs in, so a run inside the old image reads the old shape clean.

**A field that is RENAMED cannot be renamed before the deploy.** The still-serving image reads and
writes the old name, so a rename pasted first breaks every read of the field until the new image
is up. **This repository holds no migration runner and no migration**: the command belongs to the
change that needs it and is run by hand as a MongoDB Playground paste against the cluster, as every
migration here is, so what is written here is the order alone.

1. Deploy. Every read of the renamed field fails from here until step 2 lands.
2. **At once**, the rename, written as every paste is: a count of the rows still holding the old
   name, the rename, and the same count again, which must read 0.
3. The read-back: exit 0.
4. Drop any index the previous name held, by a `dropIndex` line in the same paste —
   `create_index` refuses a name already held at different options and creates nothing under a
   name it does not declare, so the boot leaves the old one standing forever.

**Three things decide whether the command pasted at step 2 is the right one.**

- **`$rename` is atomic per document**, so no row is ever seen holding both names or neither.
- **A filter on the old name's `$exists`** skips every row already moved, which is what makes the
  command re-runnable rather than a thing to get right once.
- **A dotted path through a nullable block is renamed ONE PATH AT A TIME.** `$rename` refuses the
  whole document where a segment has to traverse a null —
  `cannot use the part (…) to traverse the element ({trainer: null})` — so one update naming the
  three `kontakte` seats moves rows until it meets the first club holding one seat and not another
  and then stops, the earlier rows moved and the later ones not, inside the window step 2 exists to
  keep short. One update per path, each filtered on its own `$exists`, cannot traverse a null at all,
  a document matching that filter necessarily holding the segment. Measured against a copy of
  production, 2026-09-08.

**Where the renamed field sits inside `kontakte`, step 1's window is wider than it says.**
`fl_backend/app/api/teams/schemas.py :: FLKontaktKenntnisnahme` requires the block's names, and
`fl_backend/app/api/bewerbungen/schemas.py :: FLBewerbung` declares the same block, so the contacts
editor, a club's season panel and the whole application queue answer 500 on every stored row until
the rename lands. Every public club read keeps working, the junction join withholding the block from the base tier.

**A change that only adds an index has nothing for the read-back to answer**: no stored document can
be in breach of a read index (`fl_backend/app/core/constraints.py :: SupportIndex`). The next boot
builds it, and fails loudly if it cannot. A new unique index is the exception: one Playground
aggregate grouping the collection by its keys, counting the groups holding more than one document,
says before the deploy whether its build will meet a duplicate, which fails the boot.

**Two index changes stop the deploy, and both for one reason.** `create_index` refuses a name already
held at different options rather than moving it, so `apply_constraints` raises and
`fl_backend/app/core/db.py :: lifespan` fails the boot — the old index still serving, which the
refusal does not say. **A changed RETENTION bound** is moved first by a paste on the owner's
checklist, setting the `aktionen_retention` index's `expireAfterSeconds` to the new bound, which must
equal `fl_backend/app/shared/schemas/bounds.py :: AKTION_RETENTION_SECONDS` in the checkout about to
deploy, or the boot raises on the difference that is left.

**A uniqueness rule narrowed or widened by a `partial_filter`** is a different index rather than a
changed one, so the live index is dropped by a `dropIndex` line, and the boot that follows builds the
new one from `fl_backend/app/core/constraints.py :: UNIQUE_INDEXES`. The drop belongs in the deploy's
own window, between the stack coming down and the new build coming up, because the refusal above is
what the boot answers with while the old index stands. A widening also lets rows the narrow rule
excused fall inside the wide one, so any that would collide move first, by a paste keyed on a state
the previous statement leaves, so that one dying partway is repaired by pasting it again.

**A rolled-back deploy can put the narrow index back.** Where the build being rolled back to declares
it, that build's own boot rebuilds it narrowed, and the retry's boot then meets the same refusal —
dropping it again before the retry is what clears it. Where the earlier build declares no index of
that name, nothing rebuilds it and the retry needs only the rows.

## 3. Granting or revoking admin access

One thing admits an administrator: a grant in the `berechtigungen` collection, which the backend
reads on every admin-tier request and the frontend on every request, through the lookup its sign-in
gate and its guards share. A grant or a revoke takes hold on the next request of both, and nothing
restarts ([`spec.md`](spec.md) §4). A backend that cannot answer admits nobody, so the
administration is shut while it is down. Each of these is easy to get wrong:

- **An `administration` grant is made on the „Administratoren“ page, and only an `owner` is offered
  its revoke there**. Both ask a passkey confirmation of the last
  five minutes, a grant outliving the session making it.
- **A grant waits as a request wherever another administrator could approve it, and a promotion
  wherever another owner could**: it takes effect once that person
  approves it on the same page, someone who held their own grant since before the request. Only an administrator, or an owner, nobody else could stand beside acts alone. Tell the
  colleague: a request nobody decides lapses after the days
  `fl_backend/app/shared/schemas/bounds.py :: GENEHMIGUNG_TAGE` counts,
  and one whose requester was revoked, demoted or barred since is approved by nobody and waits for a
  refusal.
- **An `owner` is made, and steps down, only through the tier change an `owner` makes**
  (`PATCH /berechtigungen/{berechtigung_id}`): it mails every
  administrator and is logged, and the last live, unbarred `owner` is demoted by nobody. The person made an owner signs in once more before acting as
  one: an older sign-in keeps administering and is offered no owner's control. A demotion takes the tier at once. An `owner` is revoked only once made an administrator, and in
  the application only an `owner` revokes; an erasure of the
  holder's own data removes the grant whatever its tier, the last
  live owner's own erasure refused (`REQ-PURGE-004`).
- **The database is written directly for two things alone: the first owner, before anybody can sign
  in, and recovery when no owner can sign in.** Write in MongoDB Playground, never
  `mongosh`, into the `berechtigungen` collection of the application database (`DB_BASE_NAME`,
  which `fl_backend/.env` names). The row holds four fields, each typed by the validator: `adresse`,
  the address in the form the sign-in stores it (`fl_backend/app/shared/folding.py ::
sign_in_identifier`) — trimmed, the letters of both halves lower-case, the domain in punycode —
  which the application then reads as typed; `verwaltung`, `owner` or `administration`; `erteilt_von`, a marker naming the
  paste, such as `PLAYGROUND`; and `erteilt_am`, a date rather than a string. Removing the row by its
  folded address revokes it. A paste asks nobody's approval, which is why it serves these two cases
  alone. The statement itself is kept off this public repository.
- **Paste only into a database a boot of the release carrying `berechtigungen` has reached.** That
  boot creates the validator and the unique index; a paste before it creates the collection with
  neither, and a duplicate address in it then fails the next boot's index build (`SRV-BOOT-004`).
  Until the paste lands no address holds a grant, so the site admits no administrator; the public
  site is untouched.
- **Keep two grants standing, an `owner` grant among them.** The revoke route refuses to leave fewer, the tier change to leave no owner, and the Playground refuses nothing: the boot warns with
  `SRV-BOOT-005` where no grant is left and `SRV-BOOT-006` where no owner is, and serves the public
  site either way. An erasure refuses neither short of the last owner's own, and the same two
  warnings follow its commit; nothing warns where one grant is left.
- **A barred address is granted nothing, and a granted one is banned by nothing**: lift the ban first, or revoke the grant first. A grant the
  Playground writes onto a barred address is refused by nothing and admits nobody, neither to the
  site nor to the admin tier while the ban stands, and the reconciliation flags it.
- **Every change is announced, a Playground one naming no administrator**. A Playground change undone again before the next claim is
  announced by nothing, and deleting a row of `berechtigungen_angekuendigt` or
  `berechtigungen_postausgang` by hand announces that grant again as new, or silences its notice.
  The first also shuts its holder out until the pass finds the grant again, and asks them to sign in
  once more after it.
- **The session row is not the grant.** It stays in the `auth` database after a revocation and authorizes
  nothing, so deleting it by hand is tidying rather than revocation.
- **A grant to an address the sign-in library will not take admits nobody**: that person is mailed
  no code. The grant page refuses such an address; the Playground
  refuses nothing. An umlaut before the at sign is the case that turns up: the sign-in box takes no
  such address, so that person needs a mailbox it will accept before a grant is worth writing. An umlaut domain is stored in punycode,
  which the sign-in box converts either spelling to.
- **A grant admits every passkey the address already holds.** A person enrols passkeys with a mailed
  code, or brings them along on an address change the new mailbox confirmed while nothing named it
  and no grant was asked for it, the same authority an
  administrator's first passkey rests on, so one enrolled before the grant
  admits once the address is granted, though only on a passkey sign-in made after the grant: a
  session older than the grant administers nothing. Grant an
  address only where its mailbox is trusted as an administrator's.
- **A Playground grant is dated twice, so whoever it admits signs in once more.** Until the
  reconciliation's next pass (`fl_frontend/src/features/berechtigungen/abgleich.ts ::
ABGLEICH_INTERVAL_MS`) finds the row, it is dated by its own `erteilt_am`, or by the moment its
  `_id` was generated where that is later — so leave `_id` to the Playground, write `new Date()` for
  `erteilt_am`, and any sign-in after the paste admits. Once found, it is dated by that moment instead: a session signed in between the paste and the find is sent back to
  the sign-in, and the next passkey sign-in admits.
- **A row the pass has read is no fresh paste: edit it and it admits nobody until the pass finds the
  edit**, and then only on a sign-in after the find. That holds for
  an address changed in place, a spelling the boot named folded to the stored form, and a removed
  row put back with its `_id`; the pass marks every row it reads `gesehen_am`, so leave that field
  as it stands. To hand a grant to another mailbox at once, paste a new row and remove the old one.
- **A promotion to `owner` written in the Playground holds once the pass finds it, and then on a
  sign-in after the find**: until then its holder is answered as the
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
  previous image** (§1's deploy by tag, never past the floors §1 sets on it), which authenticates
  against the store that build carries —
  so it works only while that store is still there, and dropping it is what closes this route.
- **A removal is not a recovery route, and no control offers one to a session a mailed code alone
  made**: such a session could otherwise swap the administrator's passkey for a stolen mailbox's,
  which is the attack the passkey sign-in exists against, the administration admitting only a session
  a passkey signed in.
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
(`= /api/v0/system/is_live`), so it would have to be made on the server against
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
minutes. It does nothing about a flood spread across many allocations, and no concurrency ceiling reaches
this path: `limit_conn 50` sits on the catch-all and the link pages' blocks alone — a backstop rather than a
per-visitor control, and the one figure in that section never exercised against a real page load.

## 5. When somebody asks for their data, or asks us to change it

Access, rectification, objection, restriction and portability all arrive the same way and are
answered by one person by hand. The withdrawal of a consent is the person's own write on their
account page, and a request for one by mail is answered by pointing them there (below). Erasure has its own mechanisms and is
[`../datenschutz.md`](../datenschutz.md#5-erasure-reaches-everyone-who-asks)'s; everything else is
this section.

**Every request arrives at the league's address**
(`fl_frontend/src/core/brand.ts :: KONTAKT_EMAIL`, the address the notice and every message send a
reader to), which Cloudflare forwards to the personal mailboxes of the organisers who answer it, and
the answer goes back from the answering organiser's own address
([`../datenschutz.md`](../datenschutz.md#7-processors-and-third-parties)). There is no ticket system: the mail thread is the
record, and the action log records the writes you make rather than the request that asked for them.

**Establish who is asking and in which role, because the data sits somewhere different for each.**
One person can hold several — a referee is a pupil, and a contact person can be both.

| Role           | Where their data is read                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pupil          | `/bereich/admin/spieler/{spieler_id}`, and the squad rows under each season; `/bereich/admin/registrierungen` for a registration still awaiting its team; plus every match report entry naming them, a goal or a card with its colour, its minute and, until the season-end strip, its reason (`spielberichte.bericht.torschuetzen.spieler_id`, `spielberichte.bericht.karten.spieler_id`), which no page lists by person and a read-only Playground query on those two fields finds; plus every remark describing them by shirt number (`spielberichte.bericht.bemerkungen`), which their erasure does not reach and which stands until the season-end strip, read in the reports on their team's fixtures of each season they played for it, against their number then                                                                                                                                                                                                                                                                             |
| Referee        | `/bereich/admin/schiedsrichter/{schiedsrichter_id}`, plus every past fixture that embeds the name; plus a fixture confirmation row for every fixture they were booked on and asked about (`spielbestaetigungen.partei.schiedsrichter_id`), which no page renders and a read-only Playground query on that field finds; plus the remarks, until the season-end strip, of every match report they first sent (`spielberichte.bericht.eingereicht_von.schiedsrichter_id`) and of every report on a fixture booked to them (`spiele.schiedsrichter.schiedsrichter_id`), which they may have written over another writer's: a report's page shows it to the referee booked now alone, so a read-only Playground query on those two fields finds them whole                                                                                                                                                                                                                                                                                                |
| Contact person | `/bereich/admin/kontakte/{team_id}` for the season's block, and `/bereich/admin/bewerbungen/{bewerbung_id}` for the application it was collected on; plus their address on every registration they declined for their team (`registrierungen.entscheidung.von`), which no page renders and a read-only Playground query on that field finds; plus the fixture confirmations their seats were asked, which no page renders either (below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Administrator  | The sign-in store — the `auth` database, holding the address, the sessions, the sign-in codes and the passkey — plus their address as the actor of every log row they wrote (`aktionen.actor.email`, `/bereich/admin/aktionen`) and as the author of every ban, invite and application decision they made (`sperrliste.erstellt_von`, `einladungen.erstellt_von`, `bewerbungen.entscheidung.von`), and the grants: their own in `berechtigungen` and `berechtigungen_angekuendigt`, `erteilt_von` on every grant they made, and each queued notice naming them in `berechtigungen_postausgang`; plus every request for a grant they asked or one is asked for them (`berechtigungen_antraege.genehmigung.gestartet_von`, `berechtigungen_antraege.adresse`), listed under „Offene Anträge“ on `/bereich/admin/administratoren`, and every address change of a grant holder they started or approved (`adresswechsel.genehmigung.gestartet_von`, `adresswechsel.genehmigung.genehmigt_von`), which a read-only Playground query on those fields finds |
| Anyone else    | The `auth` database's `verification` collection, where the address of whoever typed it into the sign-in form is held until the retention index removes the row (§14); plus a pending address change someone typed it into as the new address (`adresswechsel.email`), found as the holder of a pending new address below, and a request for a grant typed for it (`berechtigungen_antraege.adresse`), listed under „Offene Anträge“                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**Whatever the role, a pending change of their address and its owed notices are read apart.** Type
the address on file into the address tool, `/bereich/admin/adresswechsel`
(`POST /adresswechsel/ansicht`), the one read serving a live change's new address and reason; the
editors show only that a change waits. A notice an ended change still owes either address sits in
`adresswechsel_postausgang` (`bisherige_email`, `email`, and on some rows the first name), which no
page renders and a read-only Playground query on those two fields finds.

**Anybody who has signed in is in the sign-in store too, and no erasure leaves their account
behind.** A person's first sign-in writes their `user` row and a session in the `auth` database, a
pupil's, referee's or contact person's as an administrator's is. Their own deletion from the account
page and an administrator's erasure each delete the account in the same request as the records, its
sessions, passkeys and waiting codes with it (`fl_frontend/src/core/auth.ts :: deleteOwnAccount`,
`:: deleteAccountFor`); after any other erasure the account sweep deletes it within the hour once
nothing references the address ([section 9](#9-checking-that-the-hourly-passes-have-run)).
**A ban keeps no account**
([`../datenschutz.md`](../datenschutz.md#6-retention-is-bounded-where-a-bound-was-chosen)): the
account sweep deletes a barred address's as any other's once nothing references the address. While
a record still does, a barred person cannot sign in to delete it, so an administrator's erasure on
their request is what deletes it then. Read the store for an access request: the `user` row whose `email` is the
address as the sign-in box folds it, in lower case
(`fl_frontend/src/core/emailAddress.ts :: asSignInIdentifier`), and the `session`, `account` and
`passkey` rows whose `userId` is that row's `_id`.

**A contact person's fixture confirmations are found from their address only through its digest.**
A seat's answer stores neither the address nor a name: the reason its holder typed
(`antwort.begruendung`) sits beside a keyed digest of the holder's address (`antwort.von.halter`),
so compute that address's digest under `secrets/sperrliste_schluessel` — the same derivation
`fl_backend/app/api/spielbestaetigungen/services.py :: halter_of` performs, label and fold included
— and look it up against `spielbestaetigungen.antwort.von.halter`, which finds every answer they
gave from any seat. The paste belongs in the operator's own checklist, as the ban's does (below).
Their seats' links and the delivery records of the messages that carried them sit under
`kontakte.<seat>` on their club's rows of each season in which they hold a seat now (`saison_id`,
`partei.team_id`), read beside that season's contact block, which says whose seat it is: a seat they
have left took its entries off every row of that team and season, answered and closed ones too. Send the fixture, the answer, its day and the
reason, and never the digest, the value that identifies them.
**Once the season's contact block is cleared, its rows keep the answers alone**: the reasons, the
digests, the links and the delivery records go with the block
([`../datenschutz.md`](../datenschutz.md#6-retention-is-bounded-where-a-bound-was-chosen)), so an
answer for that season names nobody to send.

`/bereich/admin/aktionen` answers what was written about them and by whom, and is the only place that
question is answered at all. Each of its rows is gone twelve months after the write it recorded, which is the period an answer gives for it.

**There is no export route, so an access request is answered by composing what those pages show.**
Send the categories, the values, where each came from, who receives them
([`../datenschutz.md`](../datenschutz.md#7-processors-and-third-parties)'s processor table), how long
they are kept, and the address for a complaint to the supervisory authority. Point at the published
notice (`fl_frontend/src/features/meta/components/views/DatenschutzView.tsx`) for the standing text
rather than restating it in the mail. A contact seat's WhatsApp evidence may be a copy a hand paste
made from its confirmation's log row before the log was emptied
([`../datenschutz.md`](../datenschutz.md#11-open-and-owed-a-decision)): say so where an answer sends
it as the proof of that consent.

**A ban is the one record no search finds from the address it is about.** The row holds a keyed hash
and nothing else of the person, so `/bereich/admin/sperrliste` cannot be asked whether a given address is on
it: the question is answered by computing that address's hash under `secrets/sperrliste_schluessel` — the
same derivation `fl_backend/app/api/sperrliste/services.py :: adresse_hash` performs, label and fold
included — and looking the value up against `sperrliste.adresse_hash`. The paste that does it belongs
in the operator's own checklist and in no file here. What the answer then says is the row's reason,
its day, its administrator and the season it runs to; the hash itself is not sent to the person, it
being the value that identifies them.

**How long a record is kept is answered by its own clock rather than by hand.** A declined
application, an accepted one and a season's contact block are each removed by the retention sweep; an application nobody confirmed is deleted after its deadline, its
submitter told first; an application nobody decided is deleted once
the season it applied for has ended, whatever its seats answered; and a log row expires after twelve months.

**A rectification is the ordinary admin edit**, made on the page above. Two carry a trap worth
reading before you save: a club rename fans out into the matches of every season that is not `past`
([`../glossary.md`](../glossary.md#spiel--one-match)), and a referee rename fans out into every
season's matches, a referee not being season-scoped.

**An email address is not an ordinary rectification: it is who can sign in as the person.** A
change of an address moves, in one step, every pupil row, confirmed referee row, confirmed contact
seat, registration and grant the address holds, so one sign-in stays whole.

- **The person can still sign in.** Point them to their account page, `/bereich/konto`, „E-Mail-Adresse
  ändern“. They confirm it is them by passkey or by a code to the address on file, a holder of
  access to the Verwaltung by passkey alone, type the new address, and confirm it from its own
  mailbox within `fl_backend/app/shared/schemas/bounds.py :: ADRESSWECHSEL_GUELTIG_STUNDEN` hours; the address on
  file is told, with a
  link that stops the change. Never start a change for a
  person who can sign in: a request arriving by mail proves nothing about who sent it.
- **They say they cannot sign in.** Ask the address on file first: start the change in the address
  tool with both addresses and no reason (`POST /adresswechsel`). Nothing goes to the new address
  until the address on file signs in and approves the change on its account page within
  `fl_backend/app/shared/schemas/bounds.py :: ADRESSWECHSEL_GUELTIG_STUNDEN` hours. Where the mailbox in fact still works, its holder approves or
  stops it, so a request sent in somebody else's name reaches the real person; where nobody
  approves, the change lapses and the next bullet applies.
- **The address on file is gone**: the approval lapsed unanswered, or the school or the provider
  says the mailbox was deleted. This is the one route on which the league hands records to a new
  mailbox without the old one's consent, so establish who is asking through a channel the league
  already holds and the request did not arrive through, never by replying to the requesting mail:
  for a pupil, a confirmed contact person of their current team, the Trainer or the Ansprechperson
  on the season row, confirming in writing from their own confirmed address; for a referee, a call
  to the telephone number on their record, or in person at a fixture. Where neither is possible,
  refuse and say why. Record how you checked as the reason, naming nobody and no address: the reason
  stays twelve months in the log, and nothing checks it for a name. Start the change in the address tool
  with it. The new address confirms
  by link within `fl_backend/app/shared/schemas/bounds.py :: ADRESSWECHSEL_GUELTIG_STUNDEN` hours,
  and the change takes effect `:: ADRESSWECHSEL_WARTEZEIT_TAGE` days later, judged again then; until
  then the address on file, should it still be read, stops it by link or on its account page. A stopped change means the mailbox is not gone: talk to the
  person before starting again.
- **The address holds a grant of access.** The change also waits on another administrator's
  approval on the administrators page, an owner's for an owner's grant, within
  `fl_backend/app/shared/schemas/bounds.py :: GENEHMIGUNG_TAGE` days of its start;
  neither the changed address nor whoever started the change gives it. Revoking the grant while a confirmed change waits needs
  no approval after it: the next hourly pass makes the change take effect, the grant moving nowhere. The tool starts a grant holder's change for an owner
  alone (`REQ-PURGE-005`), and a last owner names another owner before changing their own address. On the effect the grant moves to the new address under the
  approver, announced to every administrator as a revoke and a grant.
- **The mailbox has passed to somebody else**, a school account given to a new pupil say. Whoever
  holds the address on file can sign in as the person, stop every change started here and start one
  of their own, and no administrator's route overrides them. The remedy is outside the site: settle
  it with the school or provider that reassigned the mailbox, and with the person through a channel
  the league already holds.
- **What refuses an administrator's start**: the ban list (`REQ-ADRESSWECHSEL-009`), another pupil
  signing in on the new address where a pupil row moves, an address
  holding nothing a change moves (`REQ-ADRESSWECHSEL-010`), and your own address
  (`REQ-PURGE-003`), which you change on your own account page, and a new address any entry names,
  confirmed or not (`REQ-ADRESSWECHSEL-018`), which the confirmation would refuse too: where the two
  addresses are one person's, the league merges their records by hand.
- **Re-send** a link only while the change waits on the new mailbox
  (`POST /adresswechsel/{adresswechsel_id}/einladen`), and **discard** a change that turns out to be
  wrong (`DELETE /adresswechsel/{adresswechsel_id}`). A change whose step lapses ends within the hour
  ([`../datenschutz.md`](../datenschutz.md#6-retention-is-bounded-where-a-bound-was-chosen)).
- **Once a change takes effect**, the replaced address is told. Where the person started it or the
  address on file approved it, their sign-in account moves to the new address and every session of
  it ends, unless the new address holds an account of its own (`adresswechsel.konto_nicht_umgezogen` at `WARN`), where the
  old account keeps its sessions until the sweep below; after a change started on a recorded reason, or onto such an address, they
  sign in anew, and the account sweep
  deletes the replaced address's account within the hour, its passkeys with it, once nothing else
  references the address ([section 9](#9-checking-that-the-hourly-passes-have-run)).
- **A referee who has NOT confirmed.** Correct `kontakt.email` in the referee editor. The save
  itself kills the link that went to the old mailbox, mints a fresh one and mails the corrected
  address, so nothing further is owed and the old link opens nothing. An address change moves no
  unconfirmed referee row: until they confirm, the save is their address's one route.
- **The holder of a pending new address**, a mailbox a change was started for. Until the change
  takes effect, that address reaches nothing of the person's, and
  only the erasure's own read finds the change from it: type it on „Löschung auf Anfrage“, whose list
  names the pending change and opens it in the address tool, and discard it there, which takes the address out of the change's record and the log's images of it. Where the holder asked for their data to be deleted, the erasure
  itself ends the change alone and leaves the records standing. The
  link's own „Das ist nicht meine Adresse“ does the same as the discard, past its deadline too, and
  the address on file's stop link does it from the other side.
- **A referee who is RETIRED and has not confirmed.** Correct `kontakt.email` in the referee editor.
  The save stores the address, mails nothing and kills the old link, since a retired referee takes
  no booking to consent for; reactivating them later mints a fresh link and mails it to the
  corrected address.
- **A contact seat.** Correct it through
  `fl_backend/app/api/bewerbungen/admin_router.py :: korrigiere_kontakt_email`, which rewrites the
  address and nothing else of the person. It mints the fresh link, voids the old one and restarts the
  confirmation deadline, and where one person holds two seats it corrects both. It refuses a seat its
  person confirmed or answered, and a decided application, and never reaches a season row. A seat
  whose person has stepped out takes a different route, below.

**A person asking to change their own address is pointed to their account page.** Every account's
address changes there, proved by the new mailbox's own link and told to the address on file; an
administrator starts a change only for a lost mailbox, as above. A person holding only contact
seats changes theirs there too. Where they cannot sign in, an administrator may instead seat them
afresh in the contacts editor under the new address: the seat is then a new entry, its consent,
media choice and birthdate asked again through the fresh link, and the old entry's records stay at
the old address.

**Withdrawing a consent is the person's own write on their account page, `/bereich/konto`, and
never an erasure or an edit by hand**. Point a request
arriving by mail at the control for its record, which the person reaches by signing in with the
address that record holds:

- **A referee's publication scope and media consent:**
  `PATCH /schiedsrichter/selbst/{schiedsrichter_id}/einwilligung`.
- **A seat's WhatsApp scope and media consent on a team's season row:**
  `PATCH /teams/{team_id}/saisons/{saison_id}/person/einwilligung`, for every seat the address holds
  on that row.
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
  offering no Widerspruch: its withdrawal reaches the league's
  mailbox and is performed by hand, on „Löschung auf Anfrage“ (`/bereich/admin/loeschung`), which erases everything the
  address holds rather than this seat alone. Once the school has named a replacement, seat them
  from „Neu besetzen“ on that seat's row of the application's Bestätigungen panel, which sends the
  new person their own link and restarts the confirmation deadline for the whole application; it is
  acceptable again once they confirm within that new deadline. An ERASED seat offers no such control,
  and neither does one half of a claimed pair whose other half has not stepped out: that application
  takes only the Absage.
- **The seat has already answered, or the link is over.** A seat that has confirmed or already
  contradicted takes no second answer (`REQ-BEWERBUNG-011`), and a link whose deadline has passed
  (`REQ-BEWERBUNG-017`) or whose application has been decided (`REQ-BEWERBUNG-010`) takes none either —
  each is a refusal the person meets on the page, not something to talk them through. The route is „Löschung auf Anfrage“
  like any other.
- **The application has been decided.** „Löschung auf Anfrage“, as above.
- **The seat is on a team's season row.** Its person's own link takes their Widerspruch while it
  is live, and the Widerspruch empties the seat and mails nobody, an administrator rather than a
  submitter having entered them (`docs/glossary.md :: Bestätigung`). A lost or lapsed link is sent
  again with „Bestätigungslink senden“ on that seat in the team's contacts editor
  (`fl_backend/app/api/teams/admin_router.py :: einladen_kontakt`), which replaces the old link
  whole. It refuses an address the ban list holds (`REQ-KONTAKT-003`) and a row whose season has
  ended or whose team has left it (`REQ-KONTAKT-005`), though a link
  such a row already holds still takes a Widerspruch. Where no live link is left, or the seat has
  already answered, the route is „Löschung auf Anfrage“.

**A pupil withdrawing the consent that publishes their name does it on their account page.**
`PATCH /spieler/selbst/einwilligung` moves the record, and no administrator route writes it. A request arriving
by mail instead has two answers, and which one you give is the person's to choose:

- **They want off the website and out of the league.** „Löschung auf Anfrage“ on the address their
  record holds, which takes the squad rows with the person and asks no retirement first.
- **They want their name withheld and their place kept.** Answer by pointing them to the control
  on their account page, `/bereich/konto`, which they reach by signing in with the address their
  record holds. **Never edit a consent block by hand**, in the console or anywhere else: a choice
  the person did not make is not their consent. The write that
  withholds the name drops the cached
  squad list, and the next read serves the row as a nameless slot; check the public squad page before you answer.

Tell them that the first cannot be undone, and that the second is theirs to change back on the same
page.

**A person whose pupil or referee row went in the deletion
[section 13](#13-after-a-restore-from-a-snapshot)'s cutoff marks has nothing held in that role, and
their fixtures name nobody**; only a snapshot taken before that cutoff still holds them, until the
snapshot window passes it.

**Objection, restriction and portability have no mechanism and need none at this scale.** Answer the
person in writing: say what is held, on what basis, and what you have done. Where a restriction is
agreed, the only reliable form it can take here is removing the data, which is the erasure route.

**Four things belong in every answer that touches a deletion.** Backups outlive it by the snapshot
window and the person is told so
([`../datenschutz.md`](../datenschutz.md#5-erasure-reaches-everyone-who-asks)); every mail the
league sent them outlives it at the mail provider, and in that provider's backups, and Cloudflare
keeps the sender, recipient and subject of every mail they sent the league, each for the period the
notice states, no erasure reaching either
([`../datenschutz.md`](../datenschutz.md#7-processors-and-third-parties)); every organiser deletes
the person's mail from their own personal mailbox, which the notice promises, while what a
provider keeps in its own backups stays beyond reach; and an erasure is
keyed on an email address, so it clears every record that address holds, in every season and every
collection. **The erasure takes the address typed, and reaches a record only where that record's
address folds to the same spelling** once its capitals are lowered
(`fl_backend/app/shared/folding.py :: sign_in_identifier`). **Read the armed panel's list before
pressing**: it names every one of those records, by kind, person and season, and the press stays shut
until that list is on screen and the address is typed a second time
(`fl_frontend/src/features/funktionen/components/forms/AdminLoeschungForm/FormPersonLoeschenSection.tsx`).
Read the result afterwards: it says whether the address's account went too, and an account the
erasure could not delete goes when the address is erased again.

**The page refuses two kinds of address, and says so before anyone confirms**: the
administrator's own, which goes through their account page or an owner; and any holding a grant, to
an administrator who is not an owner. **A referee row whose address a hand edit emptied is reached
once the person's own address stands on it again**
([`../datenschutz.md`](../datenschutz.md#5-erasure-reaches-everyone-who-asks)): on a row the person
has not confirmed, save that address in the referee editor, which on a row still in service mails
them a confirmation link first, then erase it; a confirmed row's editor refuses the save
(`REQ-SCHIEDSRICHTER-011`) and the address tool finds no row by an empty address, so rewrite it by
hand as [section 9](#9-checking-that-the-hourly-passes-have-run) rewrites a pupil's. The page mails
the person nothing. **Erasing an administrator's address tells every
administrator, as a revoke does**: the grant's end goes out with the other changes of access, the
notice naming no address. On the same page „Überall abmelden“ ends
every session of an address without erasing or barring it; past the step-up window its second press
asks the passkey first, as the ban's does.

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
address left anywhere to try again with. **The same write ends every live sign-in of the address**, keeping its account and passkeys, which then stay only while a
record holds the address ([`../datenschutz.md`](../datenschutz.md#6-retention-is-bounded-where-a-bound-was-chosen)); where that fails the
page says so too, every person page refuses the sessions as no session at all, and each is deleted the next time its browser reaches the sign-in
page. **Every later sign-in of the address
is refused as its session would be created**, by a code or a passkey alike. **Beyond that the ban refuses the sign-ups that ask it and the
administration.** A pupil's registration asks it and is refused (`REQ-REGISTRIERUNG-009`), and so do
an application naming the address on any seat (`REQ-BEWERBUNG-018`), an administrator's correction,
reseat or re-send of a seat to it (`REQ-BEWERBUNG-019`) and every referee write that mints a link,
and both sweeps withhold the reminder they would send it, logging per season how many they held
back and never which; nothing marks the row, so each pass counts it again until its deadline. A grant of the address is refused (`REQ-BERECHTIGUNG-003`), a grant the Playground
wrote onto it admits nobody, and no admin read shows it as a grant's holder or as the author of a
grant, a ban, an invitation, a decision or a log row: each reads „Gesperrte Adresse“ there instead. **Every confirmation link
already mailed to the address stops confirming at once**, however long ago it went out: a pupil's
(`REQ-REGISTRIERUNG-012`), a referee's (`REQ-SCHIEDSRICHTER-009`) and a contact seat's
(`REQ-BEWERBUNG-020`) link opens on the ban's sentence alone, with nothing to press, and a press
already under way is refused. A
contact person's Widerspruch then reaches the league's address, as the withdrawal bullet above says.
Nothing of the ban is written on those records, so lifting a mistaken ban lets a link still inside
its deadline open on its form again. Nothing else refuses on the list, so a person reading the
queue is still what keeps a barred address out of everything a sign-up does not cover. **The ban
takes away nothing the address already holds** — a record it confirmed before the ban, and one it
cannot confirm since alike — and the ban's row names none of it: a record stays until you take it
away, a registration excepted, which ends by itself. **The dialog the ban is entered in lists every
such record before the ban goes out**, linking each one a page acts on to that page at the record's
own season, and says beneath them how long the address's sign-in
account stays ([section 9](#9-checking-that-the-hourly-passes-have-run)) and that its log rows and
authorship stay. „Adresse sperren“ reads and shows the list, and „Ja, Adresse sperren“ enters the
ban: closing the dialog in between bans nobody, and an edit of the address takes the list away until
it is read again. **An address the list already holds is refused
at the first press**, on the address box in a second ban's words and with no list shown;
one barred by somebody else after that read is refused the same way at the second. **Past the
step-up window the second press asks the passkey first**, reading „Mit Passkey bestätigen“, as
lifting a ban does. Each link opens in a tab of its own, so the list stays open beside
it; work through it before the second press, since the dialog closes on the ban.

- a referee: „Spiele der Saison … neu besetzen“, one link for each season holding an unplayed
  fixture they are booked on, opens the fixture search at that season to reassign them, then
  „Schiedsrichter stilllegen“ retires them, which `REQ-RETIRE-004` holds to that order across every
  season; a referee retired already is offered „Eintrag ansehen“ instead;
- a pupil's squad row: „Kadereintrag austragen“ retires it, which takes the pupil off the public
  squad list; a row taken out already is offered „Eintrag ansehen“ instead;
- a contact seat: „Kontakte bearbeiten“ replaces or clears it on the team's season;
- a seat on an application: „Bewerbung öffnen“, whose „Neu besetzen“ seats the replacement the
  school names;
- a registration: „Registrierungen ansehen“ shows a pending one, and a declined one has no link;
  no administrator decides either, its team cannot admit a barred address, and the clock erases
  both;
- another address's pending change to it, one item for each: „Adressänderung ansehen“ opens that
  change in the address tool, whose „Änderung verwerfen“ removes it;
- a pupil holding no squad row: „Eintrag ansehen“ opens their record.

Where the dialog says the list could not be loaded, it bans nobody until a later read shows the list.

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
disarms every ban in silence, the one
sign being a second ban of an address already on the list admitted rather than refused. It keys the
action log's pseudonyms of signed-in people too, so a replacement leaves one person's rows under two
pseudonyms and the older can never be recomputed; the erasure journal's hashes, so every line
written before a replacement matches no address a restore holds and its erasure cannot be run again
after the restore (§13); and the digests naming who answered a fixture confirmation, so an erasure
after a replacement finds none of the reasons its person typed before it. Treat it as
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
taken ([`../logging/overview.md`](../logging/overview.md)). The edge's own two logs are host files
under `/var/log/frankfurtleague/nginx`, which no recreate reaches.

**What those logs can and cannot answer.** How far back each reaches is bounded
([section 7](#7-the-logs-age-bounds-and-the-copies-a-deploy-leaves-behind)): a running container's
stream by the runtime's size rotation (`docs/logging/overview.md`), so a busy period rotates its
own oldest lines away and the window is set by traffic rather than chosen; a deploy's copy by the
thirty days after the deploy wrote it; and the edge's two logs by eight days at most. The edge's
access line carries the visitor's address, user agent and referer with the credential arms redacted
(`nginx/shared/http.conf :: map $request_uri $credential_free_uri`), so no confirmation token is in it, and a sign-in code travels in a
request body rather than a URL; the
same request line reached Cloudflare unredacted, and what Cloudflare keeps is settled in its
dashboard rather than here.

**The durable answer to "what was changed, and by whom" is the action log rather than a container
log.** Every recorded write appends a row carrying the actor, the route, the collection, the
operation and the image of what the write replaced or removed
([`../glossary.md`](../glossary.md#aktion--one-recorded-write-and-what-it-replaced-or-removed)), read
at `/bereich/admin/aktionen`. An erasure overwrites the values it destroys inside each image and
stamps the row, so what survives it is that the write
happened and what it held of anybody else.

**Then, in this order:** contain it; establish which people and which categories are affected, from
the two records above; report inside the 72 hours with what is established and what is not — a report
may be completed later, and a late one may not; and tell the people affected wherever the risk to
them is high. Write down what you established and when you established it: the authority asks, and
no log above outlives its bound.

## 7. The logs' age bounds, and the copies a deploy leaves behind

**Every deploy stops both application containers and copies their streams to
`/var/log/frankfurtleague/` before it recreates them** (`scripts/ops/deploy.sh :: copy_streams`), one
file per service stamped to the second, so a line written in the seconds before the recreate — an
erasure's journal line among them (§13) — is in the copy. A container already stopped, a failed
build's backend that exited among them, is copied as well and left stopped; one that keeps
restarting is running to the engine, and is stopped and copied with the other.
A directory it cannot write refuses at exit 2 before anything is stopped; a copy failing after the
stop puts back the containers it stopped, as §1 says, nothing recreated either way.
**A deploy that rolls back
recreates the pair twice and so copies twice**, the failed build's streams taking the same stamp and a
`-failed` suffix, so a failed deploy leaves four files that sort together (§1). The same step creates
`/var/log/frankfurtleague/nginx`, which `docker-compose.yml` bind-mounts for the edge's access log
and error log — host files rather than a container's stream, because every line naming a visitor
is in one of the two. Both directories are created
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

**The erasure journal's lines are copied into a file per day,
`/var/log/frankfurtleague/<day>-erasure-journal.log`, by a pair of units of their own.** Every
erasure a person or an administrator asks for leaves one line in the backend's stream, and so does
every consent a person withdraws on their own record, every Widerspruch made through a seat's link,
every address change declined, stopped or discarded and every one taking effect, and every request
for a grant refused, withdrawn or ended by its address changing; a restore runs each erasure
again and replays each of those choices from those lines (§13). The stream loses them at the next recreate, or sooner once its size cap
rotates them away; the day files keep them for this directory's thirty days, counted from each
file's last change, which is what the published notice states: a pass that adds nothing to a day
leaves its file untouched, or every day the logs still hold would start its thirty days again each
hour. **Every
pass reads every day of those thirty that the stream or a deploy copy above still holds**
(`scripts/ops/export_journal.sh :: JOURNAL_DAYS`) and unions each day's lines into what its file
already holds, so no pass drops a line an earlier one copied, and a line a pass missed — the stream
unreadable for a day, the timer installed after the first erasure — reaches its file at the first
pass reading a source that still holds it. **It runs hourly rather than once a day because the size
cap can rotate a busy day's lines away before a daily pass reads them**; a line still goes unread
where the cap rotates it away before any pass reads the stream and no deploy copied it, as more than
the cap's worth of backend log written inside one hour does. Substitute `<checkout>` as above, and
`<user>` with the user owning the checkout and `/var/log/frankfurtleague`, a member of the `docker`
group: the script reads the stream through `docker compose` and needs nothing of root.

```text
# /etc/systemd/system/frankfurtleague-journal.service
[Unit]
Description=Copy the Frankfurt League erasure journal into its day files

[Service]
Type=oneshot
User=<user>
ExecStart=<checkout>/scripts/ops/export_journal.sh
```

```text
# /etc/systemd/system/frankfurtleague-journal.timer
[Unit]
Description=Hourly copy of the Frankfurt League erasure journal

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now frankfurtleague-logrotate.timer frankfurtleague-journal.timer
systemctl list-timers frankfurtleague-logrotate.timer frankfurtleague-journal.timer systemd-tmpfiles-clean.timer
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
nothing written there may name a visitor.

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

## 9. Checking that the hourly passes have run

**The heartbeat answers it.** After every hourly pass the scheduler
(`fl_frontend/src/instrumentation-node.ts :: armScheduler`) pings Better Stack's heartbeat monitor,
and pings it with `/fail` where a job threw, left owed deletions or erasures, or the drain gave a
mail up, its output naming each: `konto failed`, `loeschung left 3`, `postausgang gave up 2`. The
monitor alerts on a failing ping and on a missing one, so an alert names the job whose lines to read
in the frontend's log, and `scheduler.job_failed` names a job that threw. **A missing ping means no
pass finished**: the frontend process holds the timer, so the container can be up while the timer
inside it is not, and a `scheduler.pass_skipped` line in every hour says a pass is stuck. Recreating
the frontend service arms a fresh timer, and the jobs select on dates, lapses and season statuses
rather than on the hour that ran them, so the pass that follows does whatever the missed hours owed.

**Each hourly pass writes one line for each half of the retention sweep**, `bewerbung.sweep_pass`
and `registrierung.sweep_pass`:

```bash
docker compose logs --since 2h frontend | grep -E 'bewerbung.sweep_pass|registrierung.sweep_pass'
```

**A half that did not finish says why in the frontend's log.** Each files its own failure line,
`bewerbung.sweep_failed` and `registrierung.sweep_failed`, so the event name is what names the half.

**A row either pass cannot write is passed over and named, and the pass goes on.** The
backend's line names the application, the registration or the season row by id, the error's class
and what locates it, never a person's values: `DB-FAIL-001` is a write the database refused, with
the properties its validator refused; `SRV-VAL-001` a stored value the answer cannot carry, such as
a hand-edited deadline or an empty first name, with the fields refused; and `SRV-FAIL-001` any other
failure, with the file, line and function it was raised in. The rest of that clock's rows go, and
the named one stays due: every later pass names it again until its record is repaired. **An application whose
announcement stamp is passed over is mailed its deletion notice again each day**, and stands past
its fourteen days until the stamp lands or its season is `past`. **The confirmation strip clock
names the season**, as it takes an ended season's fixture confirmations whole: its line says what of
theirs the season's end could not strip, the contact blocks clear all the same, and every later pass
tries again.

**A `bewerbung.sweep_pass` or `registrierung.sweep_pass` warning is a clock passing rows over, not a
pass that ran clean.** A clock failing on every row still finishes its pass, so this count is the
only sign of it. Each pass writes one line for each half, its `fehlgeschlagen` summing the rows that
half's clocks passed over across every season: `INFO` at zero, and a warning above it. The
backend's lines then name each row, as above.

**A clock owing a message answers what it had done when the deadline stops it taking rows apart;
every other clock fails the call.** The clocks owing one are the two reminder clocks and the
registrations' season's end. For them a warning that the database deadline passed, or that it held
no further attempt, is the call answering every half that committed, and the next pass goes on;
where the warning names a commit unanswered, under `DB-FAIL-002`, the rows it names may have been
written with nobody told, and a later pass meets again only those it did not write. Any other clock
the deadline stops there fails its call, as the failure lines above report.

**The half after the seasons stamps no day, so its own line is the record.** Every pass ends by
ending the address changes whose step lapsed and making the due ones take effect, then draining the
outbox those ends wrote: each replaced address gets its completion notice and the new address of a
confirmed change refused at its due time or lapsed unapproved a notice naming nobody. It writes one line per pass holding its
counts and no person, `adresswechsel.sweep_pass`, at `INFO` where the pass left no row due, and as a
warning where it left rows due; a half that threw files `adresswechsel.sweep_failed` besides.

**A notice the drain could not send stays owed, and goes out again at a later drain** — behind the
next confirmation or approval, or after the next pass — once its lease
(`fl_backend/app/api/berechtigungen/services.py :: BEANSPRUCHUNG_DAUER`) lapses. A drain that failed
files `adresswechsel.postausgang_failed`; a refused send a line of its own; a sign-in account the store failed to carry
`adresswechsel.konto_nicht_umgezogen`, at `ERROR`, and its completion notice waits for the carry. After the hand-outs
`:: VERSUCHE_HOECHSTENS` allows, the notice is given up as `adresswechsel.notice_abandoned`, the account left at the
replaced address, and nobody can be named afterwards, so repair the refusal while those lines stand:

```bash
docker compose logs --since 2h frontend | grep -E 'adresswechsel\.(postausgang_failed|stempel_failed|notice_abandoned|wirksam_failed|nicht_wirksam_failed|konto_nicht_umgezogen)'
```

A `konto_nicht_umgezogen` line at `WARN` needs no repair: reading `grund: "belegt"`, the new address
held an account of its own, and the person signs in there anew.

**The pupils' deletion runs on every pass**
(`fl_frontend/src/features/saisons/sweep.ts :: runLoeschungSweep`). It stamps no day either: each
pass deletes the pupils the season-after rule makes due, drops the squad cache after its last call,
and writes one `loeschung.sweep_pass` line, at `INFO` where it left no pupil due and as a warning
where it left pupils it failed or passed over; a pass whose call threw files `loeschung.sweep_failed`
besides:

```bash
docker compose logs --since 2h frontend | grep loeschung.sweep_
```

**Activating a season runs the same deletion first, inside the press, but only as far as the
press's own deadline reaches** (`fl_frontend/src/core/requestScope.ts :: REQUEST_DEADLINE_MS`): the
press sends no deletion call it could not wait out to its answer. Wherever more pupils are due than
that, the run stops there: the press files the warning `loeschung.umstellung_cut_short`, which
needs nothing from you, and its message tells the administrator the hourly pass finishes the rest.
`loeschung.umstellung_failed`, an error, is a call that failed rather than ran
out of time. The caches the press drops as it answers hold none of the pupils it deleted. **A call
can still be deleting once the press has answered only where it outlasted the backend's own deadline
and the margin the press allows past it**, and a pupil such a call deletes stays on a cached squad
page for at most the lifetime [section 20](#20-after-a-hand-edit-in-mongodb) states.

**A pupil counted `fehlgeschlagen` stays due, and every later pass meets them again.** The
backend's line names that pupil's id, the error's class and what locates it, never an address:
under `DB-FAIL-001` the properties a validator refused the erasure's write on, under `SRV-VAL-001`
the fields a model refused, and under `SRV-FAIL-001` the file, line and function a failure the
database did not raise came from. Find the record it points to and repair it, and the pass after
deletes the pupil. A warning saying the database deadline
passed at a pupil or at an address change is the call stopping in time rather than a refusal: the
pass goes on from the next call, and it needs nothing from you. Where it adds that the erasure, the
removal or the effect went unanswered, under `DB-FAIL-002`, that one's outcome is unknown: one that
did not commit is judged afresh by the next pass, and an effect or a refusal that did is told by
the outbox's drain, its notice queued in the same transaction.

**A `SRV-VAL-001` warning naming pupils left out of the deletion is a stored address no request
matches** — empty, not in the form sign-in folds it to, or refused by the address rule, which only
a hand edit of the record leaves.
The run passes those pupils over on every pass until their address is stored in that form. **No
route repairs one**: the address tool and the account page find a pupil by the folded address alone
(`fl_backend/app/api/spieler/services.py :: build_selbst_pupil_filter`), so a change started for it
finds nothing to move (`REQ-ADRESSWECHSEL-010`), and the tool takes no address the rule refuses.
Rewrite it by hand as a MongoDB Playground paste kept in the operator's checklist (§2): a spelling
that differs from its fold only in case, surrounding spaces or the domain's form to that fold, and
an empty one or one the rule refuses to the folded address the person is established to hold, as
[section 5](#5-when-somebody-asks-for-their-data-or-asks-us-to-change-it) establishes a lost
mailbox's.

**Two promises rest on the retention sweep's pass**
(`fl_frontend/src/features/bewerbungen/sweep.ts :: sweepAdresswechsel`): the privacy notice's word
that a change whose step lapsed ends „innerhalb einer Stunde“, and the word, in the notice and in
both mails the change sends (`fl_frontend/src/core/adresswechselEmail.ts`), that a change an
administrator started with a reason takes effect its waiting time after its confirmation. While no
pass runs neither is kept: a lapsed change keeps its new address and its reason, and a change past
its waiting time takes effect only where an approval it still owed is pressed after it. **The
activation press's message that the next hourly pass deletes what it left („Was noch aussteht,
löscht der nächste stündliche Durchlauf“) rests on the pupils' deletion running every pass**, and
with it the squad cache's drop after it.

**Read the season page's count before pressing the rollover.** Beside the press it says at most
how many pupils activating the season deletes, and which season it closes. It is a bound because it
counts the pupils the run passes over too (`SRV-VAL-001` above). A figure naming more people than
the league lost is the signal to hold the press and ask why, and a line saying the count is not
available is a read that failed: reload the page until it gives a figure.

**The fixture confirmations run on every pass**
(`fl_frontend/src/features/spielbestaetigungen/sweep.ts :: runSpielSweep`).

**Each pass that could list the seasons writes one `spielbestaetigung.sweep_pass` line**, the
record of what it did, counting the rows it closed, the first requests and Einteilungen
it stamped as asked, the reminders the backend stamped for it to mail, whether or not each then
went, the notices it stamped out, told or given up, the notices given up and the rows it passed over, at `INFO`,
and as a warning where it passed rows over or gave a notice up. A notice of a
move, a referee taken off or a call-off is answered on every pass until its stamp lands, and given
up after the attempts `fl_backend/app/api/spielbestaetigungen/services.py :: MITTEILUNG_VERSUCHE_HOECHSTENS`
allows or once its day has passed, a move's once both the slot it left and the fixture's new one have.
Each notice given up writes a `spielbestaetigung.mitteilung_aufgegeben` warning naming its
`spiel_id` and its `partei`, a club's contacts or the referee nobody told: open that fixture's
confirmations panel in the match editor and tell them by hand. The line is written before the
notice's stamp, so it repeats every hour until a stamp lands. A season it could not sweep files `spielbestaetigung.sweep_failed` besides, and a listing
that failed files that line and no pass line. A request or an Einteilung whose stamp never landed
is asked again on every pass until one does or the row stops taking an answer (a club's after its
deadline, a referee's after the fixture's day), each address whose last
mail the provider refused passed over, so a stamp call failing hour after hour mails those seats
and referees hourly until it is repaired. Every link such a mail
carried stays live until the deadline beside the later ones:

```bash
docker compose logs --since 2h frontend | grep spielbestaetigung.sweep_
```

**The first passes to meet a running season's unasked fixtures are a burst**: they ask about every
dated fixture of the running season inside the answer window
(`fl_backend/app/shared/schemas/bounds.py :: SPIEL_BESTAETIGUNG_FRIST_TAGE` plus
`:: SPIEL_ANFRAGE_VORLAUF_TAGE` days ahead), every mailbox of both clubs' seats and each booked
referee, spread over as many hourly passes as the per-pass share needs, and a fixture inside the
deadline's own days is due the day it is asked.

**The account sweep stores no date, so its own line in the frontend's log is the answer**
([`spec.md`](spec.md) §1.1). Every pass that completes writes one `konto.sweep_completed` line,
counting the accounts it listed, those answered unreferenced, deleted, already gone, and those a
failure left for the next pass, never naming an address:

```bash
docker compose logs --since 2h frontend | grep konto.sweep_
```

**No `konto.sweep_completed` line in two hours means no pass completed, or the line went
unwritten.** A `konto.sweep_failed` line says the sign-in store could not be listed. Every failure
inside a pass is a line of its own, and the next pass asks again.

**A `konto.referenzen_failed` line carrying `REQ-REFERENZEN-001` means the backend reads no live
`owner` grant**, so it refuses every batch and the sweep deletes nothing, every pass alike. Such a pass still writes its
`konto.sweep_completed` line, its `fehlgeschlagen` equal to its `gelistet`, so a completion line
alone does not say the sweep works. Either the backend reads another database than the league's,
which `DB_BASE_NAME` in `fl_backend/.env` names, or the `owner` grant is gone; the backend's boot warns
`SRV-BOOT-005` or `SRV-BOOT-006` in both cases. Repair the setting, or write the `owner` grant as
[section 3](#3-granting-or-revoking-admin-access) says.

**The erasure journal's export answers in its unit's status and its file names** (§7): the status
says when the last pass ran and how it ended, and every pass writes a file for each day of the last
thirty that the backend's logs hold a line of, an empty one where no erasure fell. The backend logs
every request at `INFO`, its own health probe's among them, so every
day it ran has a file, today's from that day's first pass, and a day missing among them is one no
pass read while the stream or a deploy copy still held it:

```bash
systemctl status frankfurtleague-journal.service
ls -l /var/log/frankfurtleague/*-erasure-journal.log
```

**A run that ended at 2 says why in its status, and only one of its reasons wrote anything.** Where
the backend's stream alone could not be read, the deploy copies' lines reached the day files all the
same, and the stream's own lines reach theirs at the next pass that reads it, whichever day they fall
on, unless the size cap rotates them away first. Where the directory could not be written or the
logs could not be read at all, no day file was written, and the next pass that can writes every line
the stream and the copies still hold (`scripts/ops/export_journal.sh :: export_days`).

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
every delivery record this database holds, and a record has one home per kind. So the signature is the same at
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
and no validator expresses the pairing either, so `--check` reports nothing about it.

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
- **The `null` half matches the stored null every unconfirmed seat holds**, the key being
  required (`fl_backend/app/core/constraints.py :: _KONTAKT_KENNTNISNAHME`), and the `$ne: null`
  half a stored value alone, so an empty seat and an already-clear one match neither.
- **Null rather than `$unset`**, which is the shape every write path stores and every read answers
  as none (`fl_backend/app/api/bewerbungen/services.py :: compose_kontakte`).
- **One update per seat, each carrying its own seat's term**, for the reason §2's rename gives: a
  dotted path cannot traverse a null, and a document the term matched necessarily holds that seat.

Then `--check` again.

## 13. After a restore from a snapshot

**The published notice promises that nothing comes back from a backup without the person's erasure
being run again** (`fl_frontend/src/features/meta/components/views/DatenschutzView.tsx`), and this is
how that promise is kept ([`../datenschutz.md`](../datenschutz.md#5-erasure-reaches-everyone-who-asks)).
Two things a restore is contemplated for: a hand-run migration that succeeded against a mistyped path
(§2), and a mistaken erasure, for which the snapshot window is the only route back. Write down the
moment the restored snapshot was taken, and once the restore has completed, that moment too: the
replay below reads the journal between the two, and an act after the second is the restored site's
own, which stands as its person made it.

**Never restore a snapshot taken before 2026-10-28 08:25 (Europe/Berlin)**, the moment by which
every pupil and referee row had been deleted and the action log emptied. It brings back those rows
and that log, holding addresses nobody asked to keep, and records citing consent labels the
registry does not hold, which §2's `--check` never reads. The rule lapses once the hosting holds no
snapshot taken before that moment, its snapshot window being about eight days
([`../datenschutz.md`](../datenschutz.md#5-erasure-reaches-everyone-who-asks)); delete it then.

**Before restoring, switch `LOESCHUNG_SWEEP` off (§9), and switch it on again only once every step
below is done:** until then nothing may call `POST /identitaet/loeschung/lauf`. The run deletes each
pupil the season-after rule makes due under the restored state, a returning pupil whose admission
the snapshot predates among them, and nothing brings one back. Re-enter the squad rows and
registrations written since the snapshot, and activate again a season whose activation it predates,
the switch still off. Its deletions are re-derived rather than replayed: it journals none, so the steps below never list them.

**Before restoring, switch `SPIEL_SWEEP` off as well (§9), and on again only once every step below
is done:** the restore brings back every seat holder and referee erased since the snapshot, still
seated or booked and holding their address, and a pass before their erasure runs again below mails
them a request or a booking.

**Switched on again, it asks once more about what the window asked**, the restore having taken back
every confirmation row minted and every answer given since the snapshot:

- **A request mailed inside the window** names a row that is gone, so its link answers nothing; the
  first pass mints the fixture again and mails a fresh request.
- **An answer given inside the window** is gone, and the fixture reads unconfirmed again. The link
  of a first request mailed before the snapshot answers again; a reminder's mailed inside the
  window does not.
- **A referee's answer given inside the window** is gone with their row. Their decline also took
  them off the fixture, so the restore books them onto it again with no row, and the first pass
  mails them a fresh Einteilung; until they agree again the fixture names no referee.

Write to each club mailed inside the window, which the mail provider's list of sent messages names
by subject, that a link from those days answers nothing and an answer given then is to be given
again. Write to each referee booked onto a fixture still to come, at the address their record
holds, that an answer given on their panel in those days is to be given again there, a decline
included: no record the restore keeps says which of them answered.

**A match report sent or corrected inside the window is gone, and nothing tells its referee**: the
fixture reads as the snapshot left it, open on the referee's panel where no report stood then. No
record names whose report went, the log being rolled back too, and a report can be sent or
corrected on any day from the match day until its season ends, so write to the referees booked on
every fixture played by the restore day in a season the restore leaves running, which the fixture
list names, to look at their panel and enter again what it lacks; an administrator's correction
made inside the window is gone too.

**The action log cannot be the list, because the restore rolls it back too; the erasure journal is.**
Everything written between the snapshot and the restore is gone, the log's own rows about it
included. Every erasure a person or an administrator asked for left one line in the backend's
stream, and so did every consent a person withdrew, every Widerspruch made through a seat's link,
every address change declined, stopped or discarded (by an administrator, by a later start replacing it, by
finding nothing left to move, or by the hourly pass refusing it when due) and every one taking effect, and every
request for a grant refused, withdrawn or ended by its address changing, each naming its person by a keyed hash
and never by an address, an erasure's line also by the pseudonym the log keys their signed-in rows by and by
the digest their fixture answers carry, whether its commit landed or lost its answer. §7's day files keep those lines outside the database for thirty days. **Once the restore has
completed, run the export once more**, which reads every journal line the backend's stream and the
deploy copies of those thirty days still hold into the day files:

```bash
sudo systemctl start frankfurtleague-journal.service
```

A pass before the restore's end can have left its last hour's lines in the stream alone, so the
replay below refuses until a pass has read the stream since. Each pass that read it stamps
`/var/log/frankfurtleague/erasure-journal.last-pass` with the second it began reading, which the
replay compares with the restore's end, so a pass already reading as the restore ended does not
count; the day files cannot say it, since a pass rewrites one only where it found a new line. The
hourly passes keep the stamp's mtime inside §7's age bound, so only thirty days with no pass reading
the stream remove it, and the replay refuses then as well.

**Then list what the lines ask for, giving both moments written down above, each with its offset:**

```bash
./scripts/ops/replay_journal.sh 2026-10-15T03:00:00Z 2026-10-15T09:40:00Z
```

It hands the day files from the snapshot's day on to the backend's container, which reads every line
written after the first moment and no later than the second, and matches it against the restored
database under the journal's key (`fl_backend/app/api/identitaet/wiederherstellung.py`), so **the key
is never typed, and no address, no hash and no key is printed**. Before the container is asked, it
refuses a moment naming no offset, a restore's end no later than the snapshot, and a snapshot's day
the export wrote no file for. Each line is listed by its act and its record, never by its person:

- **An erasure** is followed by every collection, document and field holding its address, or by
  "held nowhere". Every stored spelling is matched, folded as the sign-in folds it. The `auth`
  database is not read, an account whose
  address no league record holds going with the account sweep within the hour (§5). Held nowhere,
  the address leaves its pseudonym and its holder digest: where the pseudonym still marks log rows,
  or the digest still finds a confirmation or a log image holding a reason of theirs,
  which a restore brings back with the snapshot, the listing says how many, with the log rows' ids,
  and reads `to replay`; a line naming
  neither a pseudonym nor a holder digest reads `nothing to run`.
- **An address change that took effect before its person's erasure**, where the restored database
  holds the new address nowhere, is listed as an erasure, at the address it replaced: a snapshot from
  before the change holds the person's records there.
- **A choice** reads `to replay`; `already done` where the restored record already stands as the
  choice left it, or the restored site set it since: the choice granted again by evidence later than
  the line, the seat sent a link or the address a change on a day after the snapshot's; `left for
review` where none of the record's addresses matches the line's hash, a pupil's address changed
  since the snapshot or a seat filled by somebody else, or where that link or change went out on the
  day both the snapshot and the restore fell on, which its day alone cannot place; `no such record`
  where the restore holds no record of that id, which then needs nothing; or `its person's erasure
has run` where the same person's erasure, held nowhere, is in the same listing.

It exits 0 once nothing is left; 1 while an erasure is to run, a line to replay, a record to review,
a replay that failed or a line it could not read is left, each counted on its closing `Left:` line;
2 where it judged no line, a moment refused, the container's settings or the restored database
unreadable, naming files and never a value; and 3 or more where it crashed, a 1 ending without that
`Left:` line among them, as Compose answers for a backend that is not running.

**Then replay them: the same command with `--apply`.** Each line standing to be replayed is judged
again in a transaction of its own. A choice is written as its person's own press wrote it, the same
update and the same log redaction, its evidence stamped with the instant on its line, the moment the
person acted and never the replay's.
An erasure held nowhere has its pseudonym's log rows marked and every reason
its holder digest finds nulled with the digest, on the rows and in the log's images, as the erasure
did; the log keeps one row under „Pseudonyme“ for the marks. The action log records each under
the system, its call reading `REPLAY` and the line's act, record and journalling instant, never its
person nor the journal's token, and a second run writes nothing. **An end that told somebody
queues its notice again**: a request's refusal or its end by an address change tells its requester,
and the hourly pass's or an approval's discard of a confirmed change tells its new mailbox, so a
notice the lost database had already mailed goes out a second time. **A record left for review is
written by nothing**: read it beside the person's mail thread and settle it by hand, the listing
going on to name it since its hash matches nothing the record holds. Four things a line restores in part or not at all:

- **A grant made after a journalled withdrawal and before the restore's end** is in no journal, so
  the choice stays withdrawn, the safe side, until its person grants it again on the account page.
- **A Widerspruch's replay mails nobody**, its submitter having been told when it was made.
- **An address change that took effect inside the window, started before the snapshot**, replays
  from its line, moving every record again; **one started inside the window** reads `left for
review`, the restored database holding no change to move: ask the person to start it again on their
  account page ([section 5](#5-when-somebody-asks-for-their-data-or-asks-us-to-change-it)). **The
  sign-in store comes back with the cluster** (the last bullet below), so the account and its
  passkeys stand at the replaced address again beside the records: the person signs in there to
  start again, and the new change's effect moves the account with the records, as a replayed one does,
  unless the new address holds records or an account of its own (`adresswechsel.konto_nicht_umgezogen`). A
  grant holder's effect whose approval came after the snapshot also reads `left for review`: the
  restored change waits on an approval again, and where its week is past an approval is refused
  (`REQ-ADRESSWECHSEL-003`), so discard it and have the person start again. A change started,
  confirmed or approved inside the window and not yet in effect is in no journal: its person starts
  it again too.
- **An address an administrator corrected inside the window**: a referee's who had not confirmed,
  retired or not, in the referee editor, or a contact seat's through
  `fl_backend/app/api/bewerbungen/admin_router.py :: korrigiere_kontakt_email`. No line records an
  administrator's correction, so the tool cannot list these either: the restored record holds the
  replaced address again, and the link the correction voided, which the mailbox it went to can
  answer again until its deadline. The mail thread that asked for each correction is its record:
  correct the address again as [section 5](#5-when-somebody-asks-for-their-data-or-asks-us-to-change-it)
  says, which voids that link once more.

A line whose commit lost its answer may name an act that never landed, and running it again wrongs
nobody, the person having asked for it. **Read the mail thread beside the journal** for every request
that arrived by mail: a line the stream's size cap rotated away before any pass read it, and no deploy
copied, is in no day file (§7). **The key can never be rotated**: it is the ban list's, and a
replacement leaves every journal line matchable by nothing (§5).

**Then run each listed erasure again on „Löschung auf Anfrage“, with the address one of its
listed records shows** on the page §5's table names for that collection: keyed on the address, the
erasure reaches every other record listed. A restored row does not look erased, and each role's
guard reads something the restore took away:

- **A referee.** The whole row is back, with its name, school and contact members, and every fixture
  the erasure had repointed names them again in place of the ghost, so nothing reads as erased and
  they are editable and bookable. The erasure does all of it again.
- **A pupil.** The person and their squad rows are back and standing, and the erasure takes them
  again, asking no retirement first.
- **A contact seat.** Every seat that address held is back and filled. The erasure is keyed on the
  address, so the matched address is the whole input — and the armed panel's list now names records
  written since the snapshot as well, which is why section 5 says to read it before pressing.
- **An administrator.** Every grant the address held, an `owner` grant included, is back and admits
  them, and so is their address on every grant, ban, invitation and decision they made. The erasure
  removes the grants and marks the rest again, where a `DELETE` of the grant would not do: it refuses
  an `owner` grant, and the floor of
  two live grants may refuse any. **An owner runs it again, confirmed by passkey within the
  enrolment window**: the page refuses a grant holder's address to anyone else
  ([section 5](#5-when-somebody-asks-for-their-data-or-asks-us-to-change-it)), and the erasure ending
  a grant takes a passkey sign-in that recent.
- **A record holding no address.** No erasure reaches one
  ([`../datenschutz.md`](../datenschutz.md#5-erasure-reaches-everyone-who-asks)), so no line names
  it.
- **Anybody who had signed in, whatever their role.** The `auth` database is on the same cluster
  , so a restore of the cluster brings back their `user`, `session`,
  `account` and `passkey` rows with everything else. Once the erasure above has run again, the
  account sweep deletes each within the hour, a barred address's included (section 5).

**The log's redactions came back as well**, so re-running each erasure is also what redoes the
redactions it had stamped.

**Then re-run every grant and ban change made inside the window**, which the restore undid as it
undid the erasures, and which nothing re-runs:

- **A grant revoked, or a tier changed, after the snapshot is back as it was.** The grant and its
  announced row return together, so the reconciliation mails nobody, and the grant admits its
  holder again; an erased administrator's goes with their erasure above. Revoke any other again with
  `DELETE /berechtigungen/{berechtigung_id}`, or repeat the tier change
  ([section 3](#3-granting-or-revoking-admin-access)). A grant made after the snapshot is gone and
  is made again. The record of each is the mail every change sent every administrator.
- **A request refused, withdrawn or ended by a change of its address inside the window replays from its line** and is removed again. One approved inside the window is back as a request beside the
  grant the restore took: approve it again, or refuse it. One asked inside the window is gone and is
  asked again.
- **A ban entered after the snapshot is gone, and one lifted after it is back.** Enter each again
  at `/bereich/admin/sperrliste`, which mails the person again, and lift the others there; the mail
  thread that asked for each is the record, the log having rolled back with it.

**One consequence more.** The retention sweep repairs itself, its clocks being stored dates — but a
deletion notice already sent whose stamp the restore took back is sent a second time, that sweep
mailing before it erases.

**Then list once more**: nothing may be left but the records for review you settled by hand,
and with none of those it exits 0.

**Nothing needs running for the caches.** A restore clears no cache tag, so the public pages serve
what they cached before it, the people erased again and the publication consents withdrawn again
above among them, for at most the lifetime [section 20](#20-after-a-hand-edit-in-mongodb) states.

## 14. The `auth` database's indexes

**Every production boot of the frontend builds them, and serves the site whether or not each is
built** (`fl_frontend/src/core/authIndexes.ts :: AUTH_INDEXES`). An
index the boot could not build is one `auth.index_unbuilt` line naming it, and only a store that did not answer is built again before the next boot, so read the frontend's log for that event after every deploy:

| The line's `code` | What stands                                                       | What to do                                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `85`              | An index on the same key under another name, which keeps serving  | Give the list's entry the name the Atlas console shows, in a release                                                                                                     |
| `11000`           | Rows sharing a value the index keeps unique; no index on that key | Group the collection on the key in the Atlas console to find them. Which row stays is a judgement about those accounts, and the next boot builds the index once one does |
| `13`              | Nothing: the sign-in store's database user may not build an index | Grant that user `readWrite` on `auth` in the Atlas console, which carries `createIndex`, then restart the frontend container                                             |
| none              | Nothing: the store did not answer the boot                        | Nothing: the frontend builds them again when the store answers, and logs `auth.index_unbuilt` again for any still refused                                                |

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
carries the address. Ask when they tried and read that window:

- `auth.sign_in_gate_failed`: the send gate could not read what the backend
  holds for the address, its ban included, so it sent nothing — the backend unreachable, failing,
  or answering unreadably.
- `auth.sign_in_gate_address_refused`: the backend refused the address as none
  its own rule accepts, though the sign-in form took it; the two address rules disagree.
- `auth.code_send_failed` or `auth.sign_in_failed`: the gate admitted the
  address, and the send or the library call around it failed; `mail.send_failed` under the same trace id
  is the provider refusing the message.
- `auth.code_mail_capped`, an info line: five codes had been asked for the address inside the
  hour, so this one was sent nothing. The five count every request,
  a stranger's and one the gate refused included, so an address can be capped with nothing mailed;
  retries during a backend outage spend a person's hour the same way.
- `auth.deletion_link_capped`, an info line carrying `bound`: a signed-in person asked for an account
  deletion link past their address's five mails of the hour, codes and links counted together
  (`address`), or past every address's hundred (`total`), so nothing was minted or mailed and the
  press read as sent. A link they already hold stands for its day.
- `auth.code_mail_total_capped`: a hundred codes had been mailed across every
  address inside the hour, so nobody was sent one; a code a
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
host, at `/run/secrets/` in its container and in development ([`spec.md`](spec.md) §1.2).
Which service reads which, and each file's owner and mode on the server, is that section's table.
**A file holds its value and nothing else**: no `NAME=`, no quotes, no comment. Both readers drop a
trailing newline and surrounding blanks, and everything else in the file is part of the value.

**Each machine has its own.** The internal keys, the ban list's key and the sign-in secret
authenticate one machine's processes to each other, so a development machine
generates fresh ones and never copies production's. **A development machine holds no production
login at all**: its two database URI files name the local stack's database through the port that
stack publishes on loopback, the local stack itself hands its services an inline config naming its
own database, and the one production file a development machine holds is `secrets/dump_mongodb_uri` below.

On a development machine, in Git Bash at the checkout root, this writes every file `pnpm dev`,
`fastapi dev` and the local stack read, each readable by its writer alone, and prints nothing:

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
keys never meet the old. **After a suspected leak of `internal_api_key_admin`**, generate all three
the same way: its holder, reaching the backend on the private network, can act as any administrator,
so rotating is not finished until `aktionen` has been read for every `berechtigungen` write since the
leak, and every grant nobody can account for is revoked in the Playground. **`sperrliste_schluessel` is never replaced**: every ban is stored under it,
and a new one disarms them all in silence (§5). **A new `auth_secret` signs everybody out.**

## 17. Clearing an address's code lock

An address that has failed ten codes in a row, with no sign-in between them, is refused every code
until the oldest of those failures is a day old, the right code included; the person is
told there were too many tries with this address. Anyone who knows an address can bring it on, and
the rows counting it carry a keyed hash rather than the address, so no row can be picked
out for one person:

- **A person holding a passkey needs nothing**: a passkey sign-in never meets the lock, and clears it.
- **Otherwise it lifts by itself**, each failure's row expiring a day after it was written, removed
  by the `verification` index in §14.
- **To lift it sooner, lift every address's at once**: in the Atlas console, delete from the `auth`
  database's `verification` collection every row whose `identifier` starts with
  `sign-in-attempt-`. Every address then has its ten tries back, which is the price of an
  identifier nobody can compute by hand.

The five-an-hour mail cap keeps rows of the same shape under
`sign-in-mail-`, the every-address total among them as `sign-in-mail-every-address`;
they lift within the hour. During a flood the total can be lifted sooner the same way, by deleting
every row whose `identifier` starts with `sign-in-mail-`, which gives every address its hour back.

**Twenty member addresses are enough to close code sign-in for everyone, and to close it again every
hour.** Only mailed codes count toward the total, and a person's address is mailed up to five an
hour, so anyone who knows twenty addresses the gate admits can ask for the hundredth code alone;
while the total is full nobody is mailed a code, and a passkey still signs its holder in. `auth.code_mail_total_capped` lines
that come back hour after hour, or soon after a sweep, are that case rather
than a busy evening. The sweep above reopens code sign-in only until the requests come again, since
it clears the per-address rows too; while it recurs, point the people who sign in by code at a
passkey, and repeat the sweep when it closes again.

## 18. The Node a checkout runs

**`pnpm install` in `fl_frontend/` downloads the exact Node release
`fl_frontend/package.json :: devEngines` names, which `fl_frontend/pnpm-lock.yaml` records, and
every `pnpm run` and `pnpm exec` in that checkout runs it**, whatever Node the machine has
installed; `pnpm exec node --version` there prints the pinned release. The same release is the
frontend image's `FROM node:` tag, so a new Node is one branch editing `devEngines`, that tag and
its digest together, then running `pnpm install` to rewrite the lockfile:
`scripts/tests/test_image_pins.py` refuses a manifest, lockfile and tag naming different releases.
Once it merges, a machine needs nothing more than the next `pnpm install`.

**A bare `node` still runs the machine's own**, and the Claude Code hooks under `.claude/hooks/`
that read their payload with it call it bare. Install the pinned release machine-wide from
<https://nodejs.org/en/download>, and again whenever the pin moves: a machine left on an older release
of the line keeps every security flaw fixed since.

## 19. The database's storage alert

**Nothing in this repository watches how full the database is, and the production tier has a hard
limit**: 5 GB of documents and indexes together. What a write meets past it is unverified: MongoDB's
page on the limit states the size and not the behaviour, so plan for every save failing at once.
Nothing bounds how much one signed-in person writes: the alerts below show one person writing far
past any legitimate day as surely as many people at once or the action log's own growth, and the log
page shows which records that person's pseudonym wrote, which name the seat, the pupil or the referee
record they act through, whose address a ban then stops.

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

- the conditions and what each measures: <https://www.mongodb.com/docs/atlas/reference/alert-conditions/>
- the limit and what it counts: <https://www.mongodb.com/docs/atlas/reference/flex-limitations/>
- the alerts a new project gets: <https://www.mongodb.com/docs/atlas/configure-alerts/>

**When either fires, find the collection that grew**, from the cluster's collection and index sizes
in the Atlas console. Indexes larger than the documents put step 1's alert behind step 2's:
lower its threshold below 4 GB times the documents' share of documents and indexes.

## 20. After a hand edit in MongoDB

**A hand edit reaches the site within Next's `minutes` lifetime**, and nothing needs running. Every
cached league read keeps that lifetime: the first visit a minute or more after an entry was filled
still gets the entry and refills it behind its answer, and an entry nobody visits for an hour
expires, so the next visit waits for a fresh read. A save made on the site clears every
cached entry at once; a hand edit, a restore and the hourly passes clear none.
