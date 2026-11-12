# Ops — runbooks

**Purpose:** the recurring procedures that are run rather than read, and the operational facts no file in this repository states

The services, scripts and gate scopes these procedures rest on are [`spec.md`](spec.md)'s.

**A section keeps its number for good**, so a gap in the run below is a number no procedure holds:
renumbering would repoint every citation of a section, the scripts' own messages among them.

| Section                                                                                                                       | Answers                                                          |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [1. Deploying a build, and going back to an earlier one](#1-deploying-a-build-and-going-back-to-an-earlier-one)               | What a deploy does, each way it ends, and how to go back by hand |
| [2. Before deploying a change to a stored shape or an index](#2-before-deploying-a-change-to-a-stored-shape-or-an-index)      | The order a shape or index change runs in, then the read-back    |
| [3. Granting or revoking admin access](#3-granting-or-revoking-admin-access)                                                  | Who can sign in, and what revoking actually ends                 |
| [4. When the application queue has been flooded](#4-when-the-application-queue-has-been-flooded)                              | What the triage page still shows, and what stops new rows        |
| [5. When somebody asks for their data, or asks us to change it](#5-when-somebody-asks-for-their-data-or-asks-us-to-change-it) | Where each role's data is read, and how a request is answered    |
| [6. When personal data has been exposed](#6-when-personal-data-has-been-exposed)                                              | The authority, the clock, and what the logs can establish        |
| [7. The journal's age limit](#7-the-journals-age-limit)                                                                       | The host drop-in that bounds every log line, and how to read one |
| [9. Checking that the hourly passes have run](#9-checking-that-the-hourly-passes-have-run)                                    | What answers each, and what each answer means                    |
| [10. The mail provider's dashboard](#10-the-mail-providers-dashboard)                                                         | The six steps no code can carry, and what breaks without them    |
| [11. A contact seat's birthdate that no confirmation stamped](#11-a-contact-seats-birthdate-that-no-confirmation-stamped)     | What finds the rows, and why no save clears one                  |
| [13. After a restore from a snapshot](#13-after-a-restore-from-a-snapshot)                                                    | Who is re-erased, and what the restore took the record of        |
| [14. The `auth` database's indexes](#14-the-auth-databases-indexes)                                                           | What builds them, and what a boot that could not leaves          |
| [15. When a sign-in code does not arrive](#15-when-a-sign-in-code-does-not-arrive)                                            | What the person cannot tell apart, and the line that can         |
| [16. The secret files](#16-the-secret-files)                                                                                  | What each holds, and how each machine makes its own              |
| [17. Clearing an address's code lock](#17-clearing-an-addresss-code-lock)                                                     | Who meets it, when it lifts, and what clearing it costs          |
| [18. The Node a checkout runs](#18-the-node-a-checkout-runs)                                                                  | What `pnpm install` fetches, and how a new release lands         |
| [19. The database's storage alert](#19-the-databases-storage-alert)                                                           | What fills the tier unseen, and the two alerts that show it      |
| [20. After a hand edit in MongoDB](#20-after-a-hand-edit-in-mongodb)                                                          | What a hand edit leaves cached, and for how long                 |
| [21. The repository's settings](#21-the-repositorys-settings)                                                                 | What must be true in GitHub's settings, and why                  |

---

## 1. Deploying a build, and going back to an earlier one

**The repository records no host and holds no credential**, so getting onto the server is outside
it. `deploy.sh` runs on Linux alone, from the checkout of this repository on the server.

**Before a run, every file [`spec.md`](spec.md) §1.2's table names exists with that owner and
mode.** A service missing one does not start, and a run with no build pinned has nothing to go back
to. This lists them, without their contents:

```bash
sudo find secrets -maxdepth 1 -type f -printf '%u:%g %m %f\n'
```

Each line shows the file's owner, group and mode, which must match the table. §16 writes a missing
one.

**Before the first run on a server, two more things:**

- **The journal's drop-in is in place** ([section 7](#7-the-journals-age-limit)), since every
  service logs to the journal from that run on.
- **The `.env` beside the compose file holds nothing but `TAG`.** The run replaces the file with
  its pin alone. `sed 's/=.*//' .env` lists its names without their values. Where it lists any
  other name, settle where that setting belongs before the run.

**A change to a stored shape deploys in [section 2](#2-before-deploying-a-change-to-a-stored-shape-or-an-index)'s
order**, which holds the background jobs from before the new frontend boots until the read-back has
passed.

**Put a merge live once its `verify` and `publish` jobs on `main` have succeeded**, in the checkout:

```bash
git pull
./scripts/ops/deploy.sh
```

A bare run deploys `sha-` and the first seven hex digits of the checkout's `HEAD`, the tag the
publish job pushed for that commit; `./scripts/ops/deploy.sh sha-1a2b3c4` deploys a tag named. The
pull is what brings the compose file and `nginx/` up to date. A run does this, in order:

1. **It prunes every image no container references**, so the running build stays and the one before
   it goes. The build this run replaces stays on the host until the next deploy.
2. **It pulls every image the tag runs with**, taking an image already on the host as it is. A pull
   that fails refuses with the stack unchanged: a tag CI never pushed, the registry or the network.
3. **It starts the build and waits up to 180 seconds for every service's healthcheck**
   (`docker compose up --wait`). Compose recreates a service only where its definition or image
   moved, so a deploy moving only the application images recreates those two, and nginx keeps
   serving across the swap.
4. **It tests nginx's configuration in the running container and reloads it**, then waits up to 15
   seconds for nginx's own line `start worker processes`. An `[emerg]`, `[alert]` or `[crit]` line,
   or no line at all, fails the deploy, the line shown.
5. **It pins the tag as `TAG=` in the `.env` beside the compose file**, and names the build now live
   and the build before it.

**A healthy verdict is container health and the reload, never a page.** The frontend answers a
static file, the backend its liveness probe, the connector holds a tunnel connection, and nginx is
running. A site whose every page errors can pass. So once the run ends:

1. **Open the site.** Where it answers 502 or 1033 and the run said live, the tunnel routes
   somewhere else (below).
2. **Read the frontend's index builds**: `docker compose logs frontend | grep auth.index_unbuilt`
   prints nothing, or each line is [section 14](#14-the-auth-databases-indexes)'s.

**The tunnel's two routes name `nginx:80`.** In the Cloudflare dashboard, the tunnel's published
application routes for `frankfurtleague.de` and `www.frankfurtleague.de` each have the service type
HTTP and the URL `nginx:80` ([`spec.md`](spec.md) §1.8). A route naming anything else fails every
visitor while the run says live: the connector's healthcheck reads its connection to Cloudflare,
never one to nginx. `docker compose logs cloudflared` names the origin it dialled. Change a route
only after the run has ended. Until then the edge serving is the one the run replaces, and an edge
from before this stack answers plain HTTP with a redirect to HTTPS, which Cloudflare would send back
through the same route.

**The pin is the stack's own memory.** Compose reads `.env` for every command, so
`docker compose ps`, `logs` and `exec` typed in the checkout reach the build that runs, and a later
run that fails goes back to the build it names. A pinned value that is not a `sha-` tag is warned
about and counts as no pin.

| Ending                             | Exit      | What stands afterwards                                                                                      |
| ---------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------- |
| Deployed                           | 0         | The new build, pinned; the replaced build's images still on the host                                        |
| Live, but the pin unwritable       | 1         | The new build; `.env` pinning the previous one, and the line to write                                       |
| Failed, and went back              | 1         | The previous build's images, pinned; nginx not reloaded                                                     |
| Failed, with no other build pinned | 1         | The stack as Compose left it; the pin unmoved                                                               |
| Failed, and going back failed too  | 1         | The stack as Compose left it; `.env` pinning the previous build                                             |
| Failed under `--no-rollback`       | 1         | The stack as it stands; `.env` pinning the new build                                                        |
| Refused                            | 2         | The stack unchanged; unused images pruned where the run reached that                                        |
| Crashed                            | 3 or more | The stack as far as the run got; its last lines name the command that failed                                |
| Interrupted                        | 130       | The stack as far as Compose took it; the pin unmoved, or the new build's under `--no-rollback` once started |

**A refusal is a wrong argument, a `HEAD` git cannot read, a machine that is not Linux, a failed
pull, or a `--no-rollback` run whose pin could not be written.** The run names which.

**Going back moves the images alone.** The compose file and `nginx/` stay as the pull left them,
and nginx is not reloaded, so it keeps the configuration it had before the run unless the start
recreated it. **Where `nginx -t` refused the configuration**, the checkout still holds the refused
files, which any later start of nginx, a reboot included, loads and fails on: pull a commit whose
configuration nginx takes and deploy it.

**`--no-rollback` is for a build the one before it must never run after**, such as one whose
migration has already changed the data. It pins the new build before starting it, so a failure
leaves the stack as it stands and no later run goes back past it.

**A first run finds no pin and goes back to nothing**, so a failed first run leaves the site down
until a run ends 0. Write down the tag it pins once it does: no build published before that one
serves again (below).

### When a run fails

1. **Read the run's last lines.** A failed start lists every service's state, then the last 60
   lines of each service that is not running and healthy. A refused nginx configuration shows
   nginx's own line, and a crash names the command and its exit status.
2. **Find the line among [`spec.md`](spec.md) §3's symptoms and do its remedy.** A line naming a
   secret file is [section 16](#16-the-secret-files)'s; one naming a variable is that package's
   `.env`.
3. **Run the deploy again with the same tag**, `./scripts/ops/deploy.sh sha-1a2b3c4`. A run that
   went back left the previous build serving meanwhile. After `--no-rollback`, or on a first run,
   the site stays down until a run ends 0.
4. **Where the fault is in the build itself**, merge its fix and deploy the fix's tag. Going back
   is the section below, never past its floor.

### Going back by hand

**`./scripts/ops/deploy.sh <older tag>` needs the registry**: its prune removes the older build's
images, which no container references, and its pull fetches them again. **Without the registry**,
start the build the last deploy replaced, whose images are still on the host, then pin it:

```bash
docker image ls ghcr.io/felzab/frankfurtleague-backend
TAG=sha-1a2b3c4 docker compose up -d --wait
printf 'TAG=%s\n' sha-1a2b3c4 > .env
```

The first command lists the tags on the host, and the second starts the one named. The third pins
it once it is up, so every later Compose command, and a later deploy that fails, reach it.

**No build published before the first run on this server can serve again, so roll forward
instead.** Each asks for secret files this compose file does not mount, and none can read a match
report entry naming nobody, which an erasure leaves.

## 2. Before deploying a change to a stored shape or an index

**What a stored document may hold is its record model** — the model `fl_backend/app/readback.py ::
RECORD_MODELS` maps its collection to — and nothing in the database refuses a document of another
shape: the boot builds the indexes alone (`fl_backend/app/core/constraints.py`). So a change to a
stored shape lands with the migration that moves every stored document into it, and the
read-back command is what says they all moved:

```bash
docker compose exec -T backend python -m app.readback
```

On the server, from the checkout. It reads every document through its record model, writes nothing,
prints each refused document's collection, id and error location and never a value, and exits 0 when
every document validates, 1 when any is refused, and 2 when the database could not be read. Its last
line counts the documents read and refused.

**It reads only the collections `RECORD_MODELS` names**, so a collection left behind under an old
name is read by nothing, and the new name, never written, reads as an empty collection with nothing
refused. Only the migration's own counts prove that a rename ran.

**Run it after the migration and the deploy, never before**: it judges stored documents against the
models of the image it runs in, so a run inside the old image reads the old shape clean.

**A stored name is renamed by a migration file the owner runs with `mongosh --file` in an outage,
after the old release stops and before the new one boots.** The old release reads and writes the
old name, so a rename run beside it breaks every read of the field. A new release booted first
reads the old name as missing. **This repository holds no migration runner and no migration**: the
files belong to the change that needs them, and every migration here is run by hand against the
cluster as a few generated files, each counting what it changes before and after. What is written
here is the order, on the server in the checkout:

1. **Hold the background jobs**: add the line `RESTORE_HOLD=on` to the server's `fl_frontend/.env`.
   The new frontend reads it as it boots at step 4 ([below](#what-the-hold-stops)).
2. **Stop the old release**, before pulling anything:
   `docker compose stop frontend backend`. Every page answers an error from here until step 4
   ends.
3. **Run the change's migration files** with `mongosh --file`, in their order, each ending on its
   own check. A rename is written as a count of the rows still holding the old name, the rename,
   and the same count again, which must read 0. The same file drops any index the old name held,
   by a `dropIndex` line: `create_index` refuses a name already held at different options and
   creates nothing under a name it does not declare, so the boot would leave the old index
   standing forever.
4. **Deploy**: `git pull`, then `./scripts/ops/deploy.sh --no-rollback`, since the build before it
   cannot read the renamed data (§1).
5. **The read-back**: `docker compose exec -T backend python -m app.readback`, exit 0, then any
   check the change's files hold for after the boot.
6. **Lift the hold**: delete the line `RESTORE_HOLD=on` from `fl_frontend/.env`, then run
   `docker compose up -d --wait --force-recreate frontend`. The first hourly pass runs a minute
   after that boot.

**Where a file stops at step 3, boot nothing.** What it changed before stopping may be what the
old release cannot read, so run it again once its stop is understood: a migration file is written
to be run again, as below. Only where the stop says nothing was changed may the old release start again,
with `docker compose start frontend backend`, nothing having been pulled yet. That starts the
stopped containers as they were created, so the hold's line does not reach them. Delete the line
before the next deploy, which would otherwise boot held.

### What the hold stops

**The frontend reads `RESTORE_HOLD` once, as it boots**, so the line takes effect at the
frontend's next start and not before: a deploy's, or the recreate step 6 runs. Without it, the
frontend's first hourly pass runs a minute after its boot
(`fl_frontend/src/instrumentationNode.ts :: FIRST_PASS_DELAY_MS`), on data no read-back has judged
yet. While it holds:

- **No hourly pass runs**: no sweep, no pupils' deletion, no fixture confirmation and no handover.
  The frontend logs `scheduler.held` at its boot instead, so
  `docker compose logs frontend | grep scheduler.held` printing that line is the hold taking.
- **No mail leaves, a sign-in code included.** Every mail a write owes waits in the Postausgang
  for the first drain after the hold (`fl_frontend/src/core/afterResponse.ts :: drainSoon`). Sign
  in by passkey meanwhile.
- **The heartbeat alerts**, no pass pinging it (§9). That alert is expected until the hold lifts.
- **Nothing else stops**: the site serves, and every write a page or a form makes is stored.

**Three things decide whether a rename file is the right one.**

- **`$rename` is atomic per document**, so no row is ever seen holding both names or neither.
- **A filter on the old name's `$exists`** skips every row already moved, which is what makes the
  command re-runnable rather than a thing to get right once.
- **A dotted path through a nullable block is renamed ONE PATH AT A TIME.** `$rename` refuses the
  whole document where a segment has to traverse a null —
  `cannot use the part (…) to traverse the element ({trainer: null})` — so one update naming the
  three `kontakte` seats moves rows until it meets the first club holding one seat and not another
  and then stops, the earlier rows moved and the later ones not. One update per path, each filtered
  on its own `$exists`, cannot traverse a null at all, a document matching that filter necessarily
  holding the segment. Measured against a copy of production, 2026-09-08.

**A change that only adds an index has nothing for the read-back to answer**: no stored document can
be in breach of a read index (`fl_backend/app/core/constraints.py :: SupportIndex`). The next boot
builds it, and fails loudly if it cannot. A new unique index is the exception: one
aggregate grouping the collection by its keys, counting the groups holding more than one document,
says before the deploy whether its build will meet a duplicate, which fails the boot.

**Two index changes stop the deploy, and both for one reason.** `create_index` refuses a name already
held at different options rather than moving it, so `apply_constraints` raises and
`fl_backend/app/core/db.py :: lifespan` fails the boot — the old index still serving, which the
refusal does not say. **A changed RETENTION bound** is moved first by a migration file on the owner's
checklist, setting the `action_log_retention` index's `expireAfterSeconds` to the new bound, which must
equal `fl_backend/app/shared/schemas/bounds.py :: ACTION_LOG_ENTRY_RETENTION_SECONDS` in the checkout about to
deploy, or the boot raises on the difference that is left.

**A uniqueness rule narrowed or widened by a `partial_filter`** is a different index rather than a
changed one, so the live index is dropped by a `dropIndex` line, and the boot that follows builds the
new one from `fl_backend/app/core/constraints.py :: UNIQUE_INDEXES`. Drop it just before the
deploy, because the refusal above is what the new build's boot answers with while the old index
stands; the running build serves without the rule until then, and a restart of it would build the
old index again. A widening also lets rows the narrow rule
excused fall inside the wide one, so any that would collide move first, by a file keyed on a state
the previous statement leaves, so that one dying partway is repaired by running it again.

**A rolled-back deploy can put the narrow index back.** Where the build being rolled back to declares
it, that build's own boot rebuilds it narrowed, and the retry's boot then meets the same refusal —
dropping it again before the retry is what clears it. Where the earlier build declares no index of
that name, nothing rebuilds it and the retry needs only the rows.

## 3. Granting or revoking admin access

One thing admits an administrator: a grant in the `grants` collection, which the backend
reads on every admin-tier request and the frontend on every request, through the lookup its sign-in
gate and its guards share. A removal takes hold on the next request of both, an addition at its date, and nothing
restarts ([`spec.md`](spec.md) §4). A backend that cannot answer admits nobody, so the
administration is shut while it is down. Each of these is easy to get wrong:

- **Only the `owner` adds an administrator, removes one or hands the role over, on the
  „Administratoren“ page, each behind the passkey touch.** An addition holds
  `fl_backend/app/shared/schemas/bounds.py :: GRANT_WAIT_HOURS` hours after it, a removal at once,
  and a handover at the first hourly pass `:: OWNER_WAIT_DAYS` days after it. Every holder in effect
  and the person named are mailed when a wait starts or stops, when a handover completes and at any
  removal; an addition's wait
  ends with no mail, no pass running then. Only the `owner` stops a wait, on
  the same page: the mail tells the others to reach the owner.
- **Exactly one `owner` stands**, by `uniq_grant_owner`. A handover names a current administrator,
  never a row still waiting, and one at a time; the pass demotes then promotes in one transaction.
  The owner stays the owner until then. The new owner signs in once more before acting: a session
  older than the handover holds nothing. An erasure removes an administrator's grant; the owner's
  own erasure is refused until a handover (`owner_erasure`).
- **The database is written directly for two things alone: the first owner, before anybody can sign
  in, and recovery when the owner cannot sign in.** Write it with a file run by
  `mongosh --file` in a terminal, into the `grants` collection of the application database (`DB_BASE_NAME`,
  which `fl_backend/.env` names). The row holds three fields: `address`,
  the address in the form the sign-in stores it (`fl_backend/app/shared/folding.py ::
sign_in_identifier`) — trimmed and lower-case, ASCII throughout —
  which the application then reads as typed; `admin_tier`, `owner` or `administration`; and `effective_from`, `new Date()`, which any sign-in after the write passes.
  A recovery first clears every waiting handover's `owner_from` and deletes every addition still
  waiting, or a thief's handover stays armed; it then demotes any other `owner` row, which
  `uniq_grant_owner` otherwise refuses, and
  writes a new row rather than repointing the old one, whose sign-in account stays at the old address. Removing the row by its
  folded address removes the grant. A hand write mails nobody, which is why it serves these two cases
  alone. The statement itself is kept off this public repository.
- **Write only into a database a boot of the release carrying `grants` has reached.** That
  boot creates the unique indexes; a write before it creates the collection without them, and a duplicate in it then fails the next boot's index build (`db.indexes_failed`).
  Until the write lands no address holds a grant, so the site admits no administrator; the public
  site is untouched.
- **Keep the `owner` grant standing.** The application removes it by no route, and a hand write refuses nothing: the boot warns with
  `grants.no_grant` where no grant is left and `grants.no_owner` where no owner is, and serves the public
  site either way.
- **A banned address is added by nobody, and a holder is banned by nobody, a waiting row included**: lift the ban, or withdraw or remove the grant, first. A grant written
  by hand onto a banned address is refused by nothing and admits nobody, the sign-in refusing it.
- **The session row is not the grant.** It stays in the `auth` database after a revocation and authorizes
  nothing, so deleting it by hand is tidying rather than revocation.
- **A grant to an address the sign-in library will not take admits nobody**: that person is mailed
  no code. The grant page refuses such an address; a hand write
  refuses nothing. An umlaut is the case that turns up: the sign-in box takes no address outside
  ASCII, so that person needs a mailbox it will accept before a grant is worth writing. A domain
  already spelled in punycode (`xn--`) is taken as typed.
- **A grant admits every passkey the address already holds.** A person enrols a first passkey with a
  mailed code and every later one with a passkey sign-in of the last minute, or brings them along
  on an address change the new mailbox confirmed while nothing named it,
  the same authority an
  administrator's first passkey rests on, so one enrolled before the grant
  admits once the address is granted, though only on a passkey sign-in made after the grant: a
  session older than the grant administers nothing. Grant an
  address only where its mailbox is trusted as an administrator's.
- **The grant is the access; the person's own next sign-in enrols the passkey.** An address holding
  a grant and no passkey is answered the enrolment page and reaches no admin route until one stands,
  so there is nothing to prepare for them and nothing to hand over.
- **A lost passkey is the administrator's own to replace while they still hold another**: Konto's
  „Sicherheit“ page, `/account/security`, lists what they hold, and adds one and removes one each
  behind a passkey sign-in of the last minute
  (`fl_frontend/src/core/sessionLifetimes.ts :: PASSKEY_TOUCH_SECONDS`), and their last row cannot
  be removed.
  Removing one signs out the devices that passkey signed in, and no other.
- **An administrator who has lost every passkey is recovered in the Atlas console**, by deleting
  their rows in the `passkey` collection of the `auth` database; their next sign-in by mailed
  code enrols anew. **Until those rows are gone a code sign-in enrols nothing**, their own
  included, so a deletion against the wrong database reads to them as the step never being offered.
- **A device that cannot enrol a passkey is no way in, and no setting here relaxes it.** An
  administrator who enrolled a second device in advance still has one; one who did not is in the
  case below. The enrolment asks for a discoverable credential and for the person to be verified
  (`authenticatorSelection` in `fl_frontend/src/core/auth/library.ts`), so the browser offers
  nothing where the machine has no platform authenticator and no security key supporting both — an
  older desktop with no biometric and no PIN is the case that turns up. Give them a FIDO2 key with
  resident-key and user-verification support, or a second device they can enrol from; there is no
  password and no code to fall back to.
- **A removal is not a recovery route, and no control offers one to a session a mailed code alone
  made**: such a session could otherwise swap the administrator's passkey for a stolen mailbox's,
  which is the attack the passkey sign-in exists against, the administration admitting only a session
  a passkey signed in.
- **An admin ending their own session needs no restart at all**: the account menu every frame carries
  holds „Abmelden“ (`fl_frontend/src/kit/FrameNav.tsx :: AccountMenu`), which ends the session on its
  press.

## 4. When the application queue has been flooded

**The state announces itself, and the read degrades rather than refusing.** `GET /bewerbungen/list/admin` serves at
most `LIST_LIMIT_DEFAULT` rows and reads one row past that to answer whether more exist, so it never counts the
filtered set (`fl_backend/app/api/bewerbungen/admin_router.py :: get_bewerbungen_admin`). Where more do exist it answers
`complete: false` and the Bewerbungen list stands under a warning, „Nicht alle Bewerbungen sind geladen.“, that cannot
be dismissed, its search and filters then reading the rows served: the newest, and past them every application with a
confirmed seat. Answering short and saying so is the
deliberate choice over refusing past a threshold: these rows are written by an anonymous public form, so a hard failure would hand whoever writes
them the power to decide when the page stops working.

**What truncation costs is the oldest unconfirmed rows, which is where applications submitted before a flood sit.** The
list is newest first, so a cut-short answer keeps the newest rows, and past them every application with a confirmed
seat, read apart because a flood naming strangers confirms nothing; one whose sender holds the mailboxes can, a link at a
time (`fl_backend/app/api/bewerbungen/services.py :: build_confirmed_seat_filter`). The Sammel-Zusage takes complete
applications alone, so a cut costs it nothing. The page offers no way to the other rows: its filters narrow the rows
it holds. A marked Dublette keeps its mark, the collision being decided on the
server over every open application of the season, never over the rows served
(`fl_backend/app/api/bewerbungen/services.py :: build_duplicates_pipeline`), but its partner is not always among the
rows. Unconfirmed rows clear by themselves: the sweep deletes an application a day after its earliest outstanding
seat's deadline, which is what shortens a flood of addresses nobody answers.

**A mailbox past the bound is mailed nothing, and nobody is refused.** A press naming a mailbox, its plus-tagged forms
among them, that already holds `OPEN_LINKS_PER_MAILBOX` unanswered links of the season stores like any other and is answered
alike, so its answer tells a stranger nothing about the address
(`fl_backend/app/api/bewerbungen/public_router.py :: post_bewerbung`). That seat is owed no link, no reminder and no notice, it
reads „Nicht gesendet“ on its application and on the list's row, and „Link senden“ reaches it. **Read the list for that chip
within the 15 days:** a real school's seat can stand behind a stranger's three presses, and the sweep erases the application on
its day with nobody told. An answer frees its link, each form counts its own and each season its own. The count holds for
presses at once as for presses in sequence: a press with room to mail writes that mailbox's `mailbox_anchors` document, so its
rivals retry and read its row. A press finding the mailbox full writes nothing, so a burst contends only until the third link,
about five seconds at production's round trip, and a press naming another mailbox meets none of it. On a development machine
some 300 presses at once on one mailbox pass the request's deadline, the time going on conflict retries in one process, which
a larger pool hardly shortens: most answer 500 having stored and mailed nothing, and a few commit with the answer lost, which
the same key replays. Whether production's one process reaches that deadline is not measured. A registration counts the same way
(`fl_backend/app/api/registrierungen/public_router.py :: post_registrierung`), reads the same on its list and has no „Link
senden“: its row lapses on its deadline, and a press after that is mailed.

**Declining does not shrink the working set.** A decided application stays listed, the record being what the
decision was taken against (`fl_backend/app/api/bewerbungen/admin_router.py :: get_bewerbungen_admin`), so an operator who declines down the queue and sees the
notice unchanged has not found a fault. Removal is not an alternative either: the collection's whole write
surface is the two decisions (`fl_backend/app/api/bewerbungen/admin_router.py :: accept_bewerbung` and
`:: decline_bewerbung`) plus the public submission, so a flooded row stays.

**Closing the window is what stops new rows**, and it is the season's own edit rather than anything here. The
window's span is the season editor's „Bewerbungsfenster“ box (`fl_frontend/src/app/admin/(editor)/saisons/[saison]/settings/SaisonEditor.tsx`),
reaching `PATCH /saisons/{saison_id}`; closing early is moving its end to today or pausing it (`bewerbung.open`), and the
window guard reads both on every submission, so a closed window refuses the next one without touching a row already written.

**The bot check is the gate, and the rate limit buys minutes.** The submission is a server action, so the edge
meters it by the action pair alone, 30 at once and 60 a minute per network ([`spec.md`](spec.md) §1.3), and
what stops a script is the bot check before the input is read (`fl_frontend/src/core/action.ts`). Past that
check, the pair does nothing about a flood spread across many allocations, and `limit_conn 50` on the catch-all
is a backstop rather than a per-visitor control, the one figure in that section never exercised against a real
page load.

## 5. When somebody asks for their data, or asks us to change it

Access, rectification, objection, restriction and portability all arrive the same way and are
answered by one person by hand. The withdrawal of a consent is the person's own write on their
account page, and a request for one by mail is answered by pointing them there (below). Erasure has its own mechanisms and is
[`../datenschutz.md`](../datenschutz.md#5-erasure-reaches-everyone-who-asks)'s; everything else is
this section.

**Every request arrives at the league's address**
(`fl_frontend/src/core/brand.ts :: KONTAKT_EMAIL`, the address the notice and every message send a
reader to). Its mailbox is the league's at Google Workspace, which a board member reads and which
passes each message on to a board member
([`../datenschutz.md`](../datenschutz.md#7-processors-and-third-parties)). There is no ticket system: the mail thread is the
record, and the action log records the writes you make rather than the request that asked for them.

**Establish who is asking and in which role, because the data sits somewhere different for each.**
One person can hold several — a referee is a pupil, and a contact person can be both.

| Role           | Where their data is read                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pupil          | `/admin/saisons/{saison}/spieler/{spieler}` in each season the person holds a squad row; `/admin/saisons/{saison}/registrierungen` for a registration still awaiting its team; plus every match report entry naming them, a goal or a card with its colour and its minute (`spielberichte.bericht.scorers.spieler_id`, `spielberichte.bericht.cards.spieler_id`), which no page lists by person and a read-only query on those two fields finds, run with `mongosh --file`; plus every remark describing them by shirt number (`spielberichte.bericht.remarks`), which their erasure does not reach and which stands until the season-end strip, read in the reports on their team's fixtures of each season they played for it, against their number then |
| Referee        | `/admin/schiedsrichter/{schiedsrichter_id}`, plus every past fixture that embeds the name; plus a fixture confirmation row for every fixture they were booked on and asked about (`spielbestaetigungen.party.schiedsrichter_id`), which no page renders and a read-only query on that field finds, run with `mongosh --file`; plus the remarks, until the season-end strip, of every report on a fixture booked to them (`spiele.schiedsrichter.schiedsrichter_id`), which a referee booked before them may have written: a report names no writer and its page shows it to the referee booked now alone, so a read-only query on that field finds them whole, while a report they wrote on a fixture booked to somebody else since is found by no field   |
| Contact person | `/admin/saisons/{saison}/teams/{team_id}` for the season's seats, and `/admin/saisons/{saison}/bewerbungen/{bewerbung_id}` for the application it was collected on; plus the fixture confirmations their seats were asked, which no page renders either (below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Administrator  | The sign-in store — the `auth` database, holding the address, the sessions, the sign-in codes and the passkey — plus their address on every log row they wrote (`action_log.by`, `/admin/log`) and, on a grant's, as the grantee (`action_log.label`), and the grants: their own in `grants`, and each notice naming them still owed in `outbox` (`data.address`), which a read-only query on those fields finds, run with `mongosh --file`                                                                                                                                                                                                                                                                                                                |
| Anyone else    | The `auth` database's `verification` collection, where the address of whoever typed it into the sign-in form is held until the retention index removes the row (§14); plus a pending address change someone typed it into as the new address (`address_changes.email`), found as the holder of a pending new address below                                                                                                                                                                                                                                                                                                                                                                                                                                 |

**Whatever the role, a pending change of their address and its owed notices are read apart.** The address tool,
`/admin/address-changes` (`GET /address_change`), lists every running change with its new address, a
holder's to the owner alone, and is the one read serving it; the editors show only that a change waits. A notice an ended change still owes either address sits in `outbox` (`to`), and an effect's owed account carry on the change itself (`address_changes.move.old`,
`address_changes.move.new`); no page renders any of these, and a read-only query on those
fields finds them, run with `mongosh --file`.

**Anybody who has signed in is in the sign-in store too, and no erasure leaves their account
behind.** A person's first sign-in writes their `user` row and a session in the `auth` database, a
pupil's, referee's or contact person's as an administrator's is. Their own deletion from the account
page and an administrator's erasure each delete the account in the same request as the records, its
sessions, passkeys and waiting codes with it (`fl_frontend/src/core/auth/accounts.ts :: deleteOwnAccount`,
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

**A contact person's fixture confirmations are found from the seats they hold.**
A seat's answer stores neither the address nor a name, only the seat it came from
(`answer.by.rolle`) beside the reason typed from it (`answer.reason`).
Their seats' answers are their club's rows of each season in which they hold a seat now (`saison_id`,
`party.team_id`, `answer.by.rolle`), read beside that season's contact block, which says whose seat it
is; a row records the seat and never its holder, so an answer given before they took the seat reads
alike, and an erasure or a Widerspruch of an earlier holder took the reasons typed from the seat
(`fl_backend/app/api/kontakte/crud.py :: remove_the_seats_reasons`). Send the fixture, the answer,
its day and the reason.
**Once the season's contact block is cleared, its rows keep the answers alone**: the reasons go with
the block
([`../datenschutz.md`](../datenschutz.md#6-retention-is-bounded-where-a-bound-was-chosen)), so an
answer for that season names nobody to send.

`/admin/log` holds no person's name or address but an administrator's and a grantee's, so it answers those two people's
requests alone: the who filter finds the rows they wrote (`action_log.by`), and the search over `label` the rows naming them as
grantee, the one way to a person who wrote no row, whom the who filter does not offer. Each of its rows is gone twelve months after the act it recorded, which is the period an answer gives for it.

**There is no export route, so an access request is answered by composing what those pages show.**
Send the categories, the values, where each came from, who receives them
([`../datenschutz.md`](../datenschutz.md#7-processors-and-third-parties)'s processor table), how long
they are kept, and the address for a complaint to the supervisory authority. Point at the published
notice at `/datenschutz` for the standing text
rather than restating it in the mail. A contact seat's WhatsApp evidence may be a copy made by hand
from its confirmation's log row before the log was emptied
([`../datenschutz.md`](../datenschutz.md#11-open-and-owed-a-decision)): say so where an answer sends
it as the proof of that consent.

**A ban is read on its own list.** `/admin/ban-list` shows each barred address, and an answer
says the row's reason, its day and the last season it covers.

**How long a record is kept is answered by its own clock rather than by hand.** A declined
application, an accepted one and a season's contact block are each removed by the retention sweep; a season row's unconfirmed seat is emptied on the first pass past its day; an application with a seat unconfirmed past its deadline is deleted, everyone who confirmed a seat
told; an application nobody decided is deleted once
the season it applied for has ended, whatever its seats answered; and a log row expires after twelve months.

**A rectification is the ordinary admin edit**, made on the page above. Two carry a trap worth
reading before you save: a club rename fans out into the matches of every season that is not `past`
([`../glossary.md`](../glossary.md#spiel--one-match)), and a referee rename fans out into every
season's matches, a referee not being season-scoped.

**An email address is not an ordinary rectification: it is who can sign in as the person.** A
change of an address moves, in one step, every pupil row, confirmed referee row, confirmed contact
seat, registration and grant the address holds, so one sign-in stays whole.

- **The person can still sign in.** Point them to Konto's „Anmeldung“ page, `/account/signin`, and
  its box „E-Mail-Adresse“. They type the new address under „Neue E-Mail-Adresse“ and press „Link
  senden“, a person holding a passkey touching it first, confirm the
  change by the link mailed to the address on file, and then by the link that confirmation mails the
  new address, each within `fl_backend/app/shared/schemas/bounds.py :: ADDRESS_CHANGE_VALID_HOURS`
  hours; declining at either link ends it. Never start a change for a
  person who can sign in: a request arriving by mail proves nothing about who sent it.
- **The address on file is gone**: the school or the provider
  says the mailbox was deleted. This is the one route on which the league hands records to a new
  mailbox without the old one's consent, so establish who is asking through a channel the league
  already holds and the request did not arrive through, never by replying to the requesting mail:
  for a pupil, a confirmed contact person of their current team, the Trainer or the Ansprechperson
  on the season row, confirming in writing from their own confirmed address; for a referee, a call
  to the telephone number on their record, or in person at a fixture. Where neither is possible,
  refuse and say why. Record how you checked as the reason, naming nobody and no address: nothing
  checks it for a name. Start the change in the address tool
  with it. The new address confirms
  by link within `fl_backend/app/shared/schemas/bounds.py :: ADDRESS_CHANGE_VALID_HOURS` hours,
  and the change takes effect `:: ADDRESS_CHANGE_WAITING_PERIOD_DAYS` days later, judged again then: nothing left to move ends it, and so does any
  entry naming the new address, confirmed or not, a grant and an account still owed its carry among them,
  a holder's change taking the next bullet's rule; until
  then the address on file, should it still be read, stops it by link or on its account page. A stopped change means the mailbox is not gone: talk to the
  person before starting again.
- **The address holds a grant of access.** The change waits whole:
  `fl_backend/app/shared/schemas/bounds.py :: GRANT_WAIT_HOURS` hours after the new mailbox confirmed, `:: OWNER_WAIT_DAYS`
  days for the owner and for an administrator a handover names, and `:: ADDRESS_CHANGE_WAITING_PERIOD_DAYS` days on a lost
  mailbox, the old address working until the
  hourly pass switches it. That pass judges it on less, an entry nobody confirmed joining no two people: nothing left to
  move ends it, and so do another pupil signing in on the new address where a pupil row moves, a grant of the new address,
  an entry a person confirmed and an account still owed its carry. Every holder in effect is mailed when the wait starts, when it is stopped or withdrawn and when
  it completes, the new address masked. The tool starts a holder's change for the owner alone (`admin_address`). The owner
  discards it there; the holder withdraws it on Konto; the old address's stop link ends it too. At the switch the grant row
  keeps its id and moves, dated by the switch, so a session older than the switch holds nothing.
- **The mailbox has passed to somebody else**, a school account given to a new pupil say. Whoever
  holds the address on file can sign in as the person, stop every change started here and start one
  of their own, and no administrator's route overrides them. The remedy is outside the site: settle
  it with the school or provider that reassigned the mailbox, and with the person through a channel
  the league already holds.
- **What refuses an administrator's start**: another pupil
  signing in on the new address where a pupil row moves, an address
  holding nothing a change moves (`address_change_nothing`), and your own address
  (`own_address`), which you change on your own account page, and a new address any entry names,
  confirmed or not (`address_change_occupied`), which the confirmation would refuse too: where the two
  addresses are one person's, the league merges their records by hand. A banned new address is refused
  nothing: its link stops at the hand-out.
- **The owner's own mailbox, lost or hijacked.** The address on file answers an owner's own change, so
  whoever holds it can decline or stop every attempt, and this tool refuses it: the way out is §3's
  recovery write.
- **Re-send** a link only while the change waits on the new mailbox
  (`POST /address_change/{address_change_id}/invite`); a new address taken since the start refuses the
  re-send (`address_change_new_taken`). **Discard** a change that turns out to be
  wrong (`DELETE /address_change/{address_change_id}`). A change whose step lapses ends within the hour
  ([`../datenschutz.md`](../datenschutz.md#6-retention-is-bounded-where-a-bound-was-chosen)).
- **Once a change takes effect**, the replaced address is told where an administrator started it or
  a holder's own change waited, and every holder in effect too where the address held a grant; any
  other own change mails nothing past its two links. Where the person started it,
  their sign-in account moves to the new address and every session of
  it ends, unless the new address holds an account of its own (`address_change.account_not_moved` at `WARN`), where the
  old account keeps its sessions until the sweep below; after a lost-mailbox change, or one onto such an address, they
  sign in anew, and the account sweep
  deletes the replaced address's account within the hour, its passkeys with it, once nothing else
  references the address ([section 9](#9-checking-that-the-hourly-passes-have-run)).
- **A referee who has NOT confirmed.** Correct `kontakt.email` in the referee editor. The save
  itself kills the link that went to the old mailbox, mints a fresh one and mails the corrected
  address, so nothing further is owed and the old link opens nothing. An address change moves no
  unconfirmed referee row: until they confirm, the save is their address's one route.
- **The holder of a pending new address**, a mailbox a change was started for. Until the change
  takes effect, that address reaches nothing of the person's. `/admin/address-changes` names it as the
  change's new address: discard the change there, which takes the address out of the change's record. Where the holder asked for their data to be deleted, the erasure
  itself ends the change alone and leaves the records standing, the holders told where it was a
  holder's confirmed change. The
  link's own „Das ist nicht meine Adresse“ does the same as the discard, past its deadline too, and
  the address on file's own link does it from the other side.
- **A referee who is RETIRED and has not confirmed.** Correct `kontakt.email` in the referee editor.
  The save stores the address, mails nothing and kills the old link, since a retired referee takes
  no booking to consent for; reactivating them later mints a fresh link and mails it to the
  corrected address.
- **A contact seat.** Correct it through
  `fl_backend/app/api/bewerbungen/admin_router.py :: post_kontakt_seat`, which writes the person the
  seat holds. It mints the fresh link, voids the old one and restarts that seat's deadline, and where
  one person holds two seats it writes both. A confirmed seat's answer goes with the old entry, and the
  person is asked again. It refuses a seat an erasure emptied and a decided application, and never
  reaches a season row.

**A person asking to change their own address is pointed to their account page.** Every account's
address changes there, confirmed by the address on file's link and then by the new mailbox's; an
administrator starts a change only for a lost mailbox, as above. A person holding only contact
seats changes theirs there too. Where they cannot sign in, an administrator may instead seat them
afresh in the contacts editor under the new address: the seat is then a new entry, its consent,
media choice and birthdate asked again through the fresh link, and the old entry's records stay at
the old address.

**Withdrawing a consent is the person's own write on Konto's „Deine Einträge“,
`/account/entries`, and never an erasure or an edit by hand**. Point a request
arriving by mail at the control for its record, which the person reaches by signing in with the
address that record holds:

- **A referee's publication scope and media consent:**
  `PATCH /schiedsrichter/account/{schiedsrichter_id}/einwilligung`.
- **A seat's WhatsApp scope and media consent on a team's season row:**
  `PATCH /teams/{team_id}/saisons/{saison_id}/account/einwilligung`, for every seat the address holds
  on that row.
- **A seat's WhatsApp scope and media consent on a pending application:**
  `PATCH /bewerbungen/{bewerbung_id}/account/einwilligung`, which withdraws them and never grants
  either.
- **A pending registration's publication scope and media consent:**
  `PATCH /registrierungen/account/{registrierung_id}/einwilligung`, which withdraws them and grants
  neither. The admission deletes the registration, and its choices then move on the pupil's own
  control above.
- **A pupil's:** the paragraph below.

**Taking a contact person off their seat is an erasure, unless the seat's own link still takes
their Widerspruch.** On an application, which of the three cases below you are in is decided by
that seat's own link, not by the person's role; a seat on a team's season row is the fourth:

- **The seat is unanswered and its link still works.** Their own Widerspruch, on the confirmation
  page the link opens, empties the seat at once and tells the Ansprechperson, where one stands, was
  mailed and is not the person objecting, so the school can name somebody else
  (`fl_backend/app/api/bewerbungen/public_router.py :: post_einwilligung`).
  Send them the link again rather than erasing for them; the record then says the person refused
  rather than that an administrator removed them. **A second link to a barred address does not leave**: the hand-out settles it `barred`, and the link
  the address already holds still opens on its form. Once the school has named a replacement, seat them
  with „Sitz bearbeiten“ on that seat's row of the application's review page, which sends the
  new person their own link and restarts that seat's 14 days alone: the application goes once any other
  unconfirmed seat's own day passes, so re-send those too where they need longer. It is acceptable again
  once every seat has confirmed. An ERASED seat offers no such control: that application takes only the
  Absage.
- **The seat has already answered, or the link is over.** A seat that has confirmed or already
  contradicted takes no second answer (`bewerbung_seat_already_answered`), and a link whose deadline has passed
  or whose application has been decided (`link_expired`) takes none either —
  each is a refusal the person meets on the page, not something to talk them through. The route is „Löschungen“
  like any other.
- **The application has been decided.** „Löschungen“, as above.
- **The seat is on a team's season row.** Its person's own link takes their Widerspruch while it
  is live, and the Widerspruch empties the seat and mails nobody, an administrator having entered
  them (`docs/glossary.md :: Bestätigung`). A lost link is sent again, and a lapsed one until the
  hourly pass empties its seat, with „Link senden“ on that seat's row in the team's editor
  (`fl_backend/app/api/teams/admin_router.py :: invite_kontakt`), which replaces the old link
  whole; an emptied seat is typed in again, which mails its own link. „Link senden“ refuses a row whose season has
  ended or whose team has left it (`kontakt_row_without_saison`), though a link
  such a row already holds still takes a Widerspruch. Where no live link is left, or the seat has
  already answered, the route is „Löschungen“.

**A pupil withdrawing the consent that publishes their name does it on their account page.**
`PATCH /spieler/account/einwilligung` moves the record, and no administrator route writes it. A request arriving
by mail instead has two answers, and which one you give is the person's to choose:

- **They want off the website and out of the league.** „Löschungen“ on the address their
  record holds, which takes the squad rows with the person and asks no retirement first.
- **They want their name withheld and their place kept.** Answer by pointing them to the control
  on Konto's „Deine Einträge“, `/account/entries`, which they reach by signing in with the address
  their record holds. **Never edit a consent block by hand**, in the console or anywhere else: a choice
  the person did not make is not their consent. The write that
  withholds the name drops the cached
  squad list, and the next read serves the row as a nameless slot; check the public squad page before you answer.

Tell them that the first cannot be undone, and that the second is theirs to change back on the same
page.

**Objection, restriction and portability have no mechanism and need none at this scale.** Answer the
person in writing: say what is held, on what basis, and what you have done. Where a restriction is
agreed, the only reliable form it can take here is removing the data, which is the erasure route.

**Four things belong in every answer that touches a deletion.** Backups outlive it by the snapshot
window and the person is told so
([`../datenschutz.md`](../datenschutz.md#5-erasure-reaches-everyone-who-asks)); every mail the
league sent them outlives it at the mail provider, and in that provider's backups, for the period
the notice states, no erasure reaching it
([`../datenschutz.md`](../datenschutz.md#7-processors-and-third-parties)); every mail they sent the
league is deleted on request from the league's mailbox and from the board member's mailbox it was
passed on to, while Google keeps it restorable for its own period and a private provider's backups
stay beyond reach; and an erasure is
keyed on an email address, so it clears every record that address holds, in every season and every
collection. **The erasure takes the address typed, and reaches a record only where that record's
address folds to the same spelling** once its capitals are lowered
(`fl_backend/app/shared/folding.py :: sign_in_identifier`). **Read the counts before the final press**: „Löschen“ on `/admin/erasures` asks over a count of each
kind of record the address holds, the account and its passkeys among them, and names nobody
(`fl_frontend/src/app/admin/(liste)/erasures/erasureActs.ts :: readErasureCounts`); „Eingeteilte
Spiele“ above zero is the fixtures that need a new referee afterwards, and a note in the dialog that
the account may stand means pressing „Löschen“ again, which deletes an account left standing.

**The page refuses two kinds of address, and says so before anyone confirms**: the
administrator's own, which goes through their account page or the owner; and any holding a grant, to
anyone but the owner. An address another address's pending change would move to is refused at the final
press alone, where that address holds a grant and the administrator is not the owner
(`foreign_address_change`). **A referee row whose address a hand edit emptied is reached
once the person's own address stands on it again**
([`../datenschutz.md`](../datenschutz.md#5-erasure-reaches-everyone-who-asks)): on a row the person
has not confirmed, save that address in the referee editor, which on a row still in service mails
them a confirmation link first, then erase it; a confirmed row's editor refuses the save
(`schiedsrichter_address_only_per_change`) and the address tool finds no row by an empty address, so rewrite it by
hand as [section 9](#9-checking-that-the-hourly-passes-have-run) rewrites a pupil's. The page mails
the person only where an account went, the deletion notice
(`fl_frontend/src/core/auth/accounts.ts :: deleteAccountFor`). **Erasing an administrator's address tells every
administrator, as a revoke does**: the grant's end goes out with the other changes of access, the
notice naming no address.

**Answer as soon as what you need is gathered, and where it will take longer say so in the first
reply rather than after it.** Where the answer needs the Datenschutzexperte, the person is told that
in the same reply.

**A false birthdate is found by a person, and the answer is a decision and a ban rather than a
rule.** The one date anybody enters for themselves is a contact person's, at their own confirmation,
and nothing verifies it: what surfaces is somebody recognising the person or the school saying so.
Decline the application and bar the address at `/admin/ban-list` with the reason in your own words
and no person named in it, the row outliving that person's erasure
([`../glossary.md`](../glossary.md#sperrliste--ban_list--the-addresses-barred-from-signing-in-and-from-the-leagues-mail)). An
address holding a grant, in effect or waiting, or named as the new address of a holder's running
change, is refused (`ban_list_admin`) until the grant or the change is ended
([section 3](#3-granting-or-revoking-admin-access)). **The write
mails the person itself where the address holds a sign-in account**, naming the reason you typed and
the last season the ban covers, so there is nothing to send by hand; an address that never signed in
is mailed nothing. Where the send fails, or the sign-in store could not say
whether an account holds the address, the page says the notice did not go. **The same write ends every live sign-in of the address**, keeping its account and passkeys, which then stay only while a
record holds the address ([`../datenschutz.md`](../datenschutz.md#6-retention-is-bounded-where-a-bound-was-chosen)); where that fails the
page says so too, and a session left standing lasts until it lapses, no request reading the list. **Every later sign-in of the address
is refused as its session would be created**, by a code or a passkey alike. **Beyond the sign-in the ban stops one thing, the league's mail.**
The Postausgang's drain settles every mail to the address `barred` at its hand-out, the ban's own notice excepted, so no link reaches it.
A form takes a barred address and stores it, and a link already mailed still opens and confirms, so a person reading the
queue is still what keeps a barred address out of everything. A grant of the address is refused (`grant_barred`), and a grant written onto it by
hand admits nobody. **The
ban takes away nothing the address already holds**, and the ban's row names none of it: a record stays until you take it
away, a registration excepted, which ends by itself. Read what the address holds first, on „Löschungen“: a
referee is retired once their unplayed fixtures are reassigned, which `schiedsrichter_still_assigned`
holds to that order across every season; a pupil's squad row is taken out; a contact seat is replaced
or cleared on the team's season; a seat on an application is replaced on the application's page; and
another address's pending change to it is discarded at `/admin/address-changes`. **An address the list
already holds is refused**, on the address box. Entering a ban and lifting one each take the passkey
touch.

**A ban lapses five full seasons after the one it was entered under, and the row is removed at the
activation that runs past it.** The season it was entered in does not count, so a ban entered while
2026 is active covers through 2031 and goes when 2032 is activated. There is no window between the
two: the
activation that makes a ban lapse is the same write that removes its row, so a ban on this page is
always one that still bars. Lift a ban earlier from the page itself: a ban entered because somebody lied about their age loses its purpose the
day they reach the floor their seat asks for, and the page is where somebody notices. A lift mails nobody, so a lift on
a request is answered in that mail thread.

## 6. When personal data has been exposed

A personal-data breach is reported to **Der Hessische Beauftragte für Datenschutz und
Informationsfreiheit** in Wiesbaden, through its Art. 33 form at datenschutz.hessen.de, **within 72
hours of becoming aware of it** — requesting the upload link does not stop that clock. That is
mirrored from the authority's own pages, which move without us and were read on 2026-09-02.

The clock starts when a person becomes aware, and nothing here raises an alert, so the first minutes
are yours to spend on the steps below rather than on looking for one.

**The fix can ship at once: a deploy loses no log line.** Every service logs to the host's journal,
which keeps a replaced container's lines ([section 7](#7-the-journals-age-limit)).

**What those logs can and cannot answer.** A line lives between eight and nine days, and a flood can
take one sooner (section 7). The edge's access line carries the visitor's address, the path without
its query and the browser identifier (`nginx/shared/http.conf :: log_format fl_json`), so no mailed
link's token is in it, and a sign-in code travels in a request body rather than a URL. **nginx's
error line repeats the request line whole, its query with it**, on an upstream failure among other
causes; a link page's location writes no error line at all (`nginx/shared/site.conf`). The same
request reached Cloudflare whole, and what Cloudflare keeps is settled in its dashboard rather than
here.

**The durable answer to "what was changed, and by whom" is the action log rather than a container
log.** Every recorded act appends a row carrying who acted, what they did and to which record
([`../glossary.md`](../glossary.md#aktion--action_log_entry--one-recorded-act)). A row names nobody
but an administrator, so an erasure leaves it standing and takes that address out.

**Then, in this order:** contain it; establish which people and which categories are affected, from
the two records above; report inside the 72 hours with what is established and what is not — a report
may be completed later, and a late one may not; and tell the people affected wherever the risk to
them is high. Write down what you established and when you established it: the authority asks, and
no log above outlives its bound.

## 7. The journal's age limit

**Every production service logs to the host's journal** (`docker-compose.yml :: x-logging`): the
edge's access lines, which name each visitor's address, the application logs and the backend's
`journal.act` lines. **The published notice gives them nine days**
(`fl_frontend/src/core/serverCopy.ts`), and journald ages nothing by default, so the limit is a
drop-in on the host that no file in this repository can install. **It is in place before the first
deploy on a server**, since every service logs to the journal from that deploy on. This writes it,
creating its directory where the host has none:

```bash
printf '%s\n' '[Journal]' 'Storage=persistent' 'MaxFileSec=12h' 'MaxRetentionSec=204h' | sudo install -D -m 644 /dev/stdin /etc/systemd/journald.conf.d/frankfurtleague.conf
```

**Both age settings are needed.** journald deletes an archived file only once its first entry is
older than `MaxRetentionSec`, and never touches the file it is still writing, so `MaxFileSec`
archives that file every twelve hours. Together they give a line between eight and nine days of
life. `Storage=persistent` keeps the journal on disk across a reboot, where a `journal.act` line has
to outlast one ([section 13](#13-after-a-restore-from-a-snapshot)).

Apply it, then read back the drop-in and the oldest line the journal holds:

```bash
sudo systemctl restart systemd-journald
systemd-analyze cat-config systemd/journald.conf
sudo journalctl --output=short-iso | head -n 1
```

`cat-config` prints the drop-in last, under its own path, with its four lines. Once the drop-in
has stood nine days, the oldest line the last command prints is at most nine days old.

**Two other bounds can take a line sooner, and neither can keep one longer.** journald deletes the
oldest files once the journal fills its share of the disk, by default a tenth of the file system and
at most 4 GB. It also drops lines one service writes past its rate limit, by default 10,000 in 30
seconds, and every container logs through `docker.service`, so all four share that budget. A flood
of access lines can therefore cost `journal.act` lines, which is why a restore reads the mail
threads beside them.

### Reading a service's lines

**Read a service's lines with Compose in the checkout**, which the `.env` pin points at the build
that runs, or with `journalctl` by the container's name, which outlives a recreate:

```bash
docker compose logs --since 2h backend
sudo journalctl -t "$(docker compose ps --format '{{.Name}}' backend)" --since "2 hours ago" --output=cat
```

`docker compose logs` reads the current container alone; `journalctl` reads every container that
held the name, so it is the one reaching back past a deploy.

## 9. Checking that the hourly passes have run

**The heartbeat answers it.** After every hourly pass the scheduler
(`fl_frontend/src/instrumentationNode.ts :: armScheduler`) pings Better Stack's heartbeat monitor,
and pings it with `/fail` where a job threw, left owed deletions or erasures, or the drain gave a
mail up, its output naming each: `account failed`, `erasure left 3`, `outbox gave up 2`. The
monitor alerts on a failing ping and on a missing one, so an alert names the job whose lines to read
in the frontend's log, and `scheduler.job_failed` names a job that threw. **A missing ping means no
pass finished**: the frontend process holds the timer, so the container can be up while the timer
inside it is not, and a `scheduler.pass_skipped` line in every hour says a pass is stuck. Recreating
the frontend service arms a fresh timer, and the jobs select on dates, lapses and season statuses
rather than on the hour that ran them, so the pass that follows does whatever the missed hours owed.

**The monitor is made by hand in Better Stack, and production's frontend refuses to boot without
its address** (`fl_frontend/src/core/config.ts :: PRODUCTION_ONLY_REQUIRED`). So before the first
deploy that reads it:

1. In Better Stack, create a heartbeat monitor expecting a ping every hour, with a grace period of
   15 minutes, which a slow pass stays inside.
2. Set its alerts to the owner's personal address alone, as every monitor's are
   ([`spec.md`](spec.md) §1.9).
3. Copy its address, which begins `https://`.
4. On the server, in the checkout, run
   `sudo install -o 1001 -g 1001 -m 400 /dev/stdin secrets/betterstack_heartbeat_url`, paste the
   address, then press Ctrl-D.
5. Where the stack runs already, recreate the frontend
   ([section 16](#16-the-secret-files)).

**Each hourly pass that did anything writes one line**, `scheduler.pass`, every job's counts in
it:

```bash
docker compose logs --since 2h frontend | grep scheduler.pass
```

**A half of the retention sweep that did not finish, the applications' or the registrations', says
why in the frontend's log.** Each files its own failure line,
`bewerbung.sweep_failed` and `registrierung.sweep_failed`, naming the season, so the event name is what names the
half. Every other half and season still runs, and the job then fails, which `scheduler.job_failed` names as
`bewerbungen` and the heartbeat as `bewerbungen failed`. A pass that ran but passed rows over reaches the heartbeat
as `bewerbungen left <n>`.

**A row either pass cannot write is passed over and named, and the pass goes on.** The
backend's line names the application, the registration or the season row by id, the error's class
and what locates it, never a person's values: `database_failed` is a write the database refused;
`stored_data_invalid` a stored value the answer cannot carry, such as
a hand-edited deadline or an empty first name, with the fields refused; and `unhandled_crash` any other
failure, with the file, line and function it was raised in. The rest of that clock's rows go, and
the named one stays due: every later pass names it again until its record is repaired. **An application the fourteen-day clock passes over is owed no notice**: the notice is owed in the erasure's own
write, so the application stands past its fourteen days, nobody told, until the erasure lands or its season is
`past`. Every reminder and deletion notice the sweep owes leaves through the Postausgang's drain, whose own lines
report a mail that did not go. **The confirmation strip clock
names the season**, as it takes an ended season's fixture confirmations whole: its line says what of
theirs the season's end could not strip, the contact blocks clear all the same, and every later pass
tries again.

**A `bewerbung_failed` or `registrierung_failed` above zero is a clock passing rows
over, not a pass that ran clean.** A clock failing on every row still finishes its pass, so this
count, summing the rows that half's clocks passed over across every season, is the only sign of it.
The backend's lines then name each row, as above.

**A clock owing a message answers what it had done when the deadline stops it taking rows apart;
every other clock fails the call.** The clocks owing one are the two reminder clocks and the
registrations' season's end. For them a warning that the database deadline passed, or that it held
no further attempt, is the call answering every half that committed, and the next pass goes on;
where the warning names a commit unanswered, under `unknown_outcome`, the rows it names may have been
written with nobody told, and a later pass meets again only those it did not write. Any other clock
the deadline stops there fails its call, as the failure lines above report.

**The half after the seasons stamps no day, so its counts are the record.** Every pass ends by
ending the address changes whose step lapsed and making the due ones take effect, each end owing its
notice to the Postausgang: each replaced address gets its completion notice and the new address of a
confirmed change refused at its due time a notice naming nobody. The pass ends
by carrying each sign-in account an effect still owes
(`fl_frontend/src/features/address-change/moves.ts :: runAddressChangeMoves`). Its counts and no person
are the pass line's `address_change_` ones, `address_change_remaining` the rows it left due. A half that threw fails the applications' job once the seasons have run, which
`scheduler.job_failed` names as `bewerbungen`.

**A notice the drain could not send stays owed in the Postausgang**, which retries it as it retries
every owed mail, and a notice it gives up is counted on the pass's line and reported to
the heartbeat. **An account's carry the pass could not
make stays owed on the change**, and the account sweep keeps the replaced address's account until it
is made: the next pass, or the next confirmation, tries it again, and a pass whose carry threw
rejects, for the heartbeat to name. A confirmation whose own carry threw files
`address_change.carry_failed` at `ERROR` and still shows the person the done page, the pass owing
the carry. A carry the new address refused files `address_change.account_not_moved`:

```bash
docker compose logs --since 2h frontend | grep -E 'address_change\.(account_not_moved|carry_failed)|scheduler\.job_failed'
```

An `account_not_moved` line at `WARN` needs no repair: reading `reason: "occupied"`, the new address
held an account of its own, and the person signs in there anew.

**The pupils' deletion runs on every pass**
(`fl_frontend/src/features/saisons/sweep.ts :: runErasureSweep`). It stamps no day either: each
pass deletes the pupils the season-after rule makes due, drops the squad cache after its last call,
and counts on the pass's line what it erased and the pupils it failed or passed over; a pass whose
call threw fails the job, its counts on that line all the same, which `scheduler.job_failed` names
as `erasure`.

**Activating a season deletes nobody**: the first pass after it deletes the pupils the new season
makes due.

**A pupil counted `failed` stays due, and every later pass meets them again.** The
backend's line names that pupil's id, the error's class and what locates it, never an address:
under `database_failed` the write the database refused, under `stored_data_invalid`
the fields a model refused, and under `unhandled_crash` the file, line and function a failure the
database did not raise came from. Find the record it points to and repair it, and the pass after
deletes the pupil. A warning saying the database deadline
passed at a pupil or at an address change is the call stopping in time rather than a refusal: the
pass goes on from the next call, and it needs nothing from you. Where it adds that the erasure, the
removal or the effect went unanswered, under `unknown_outcome`, that one's outcome is unknown: one that
did not commit is judged afresh by the next pass, and an effect or a refusal that did is told by
the outbox's drain, its notice queued in the same transaction.

**A `stored_data_invalid` warning naming pupils left out of the deletion is a stored address no request
matches** — empty, not in the form sign-in folds it to, or refused by the address rule, which only
a hand edit of the record leaves.
The run passes those pupils over on every pass until their address is stored in that form. **No
route repairs one**: the address tool and the account page find a pupil by the folded address alone
(`fl_backend/app/api/spieler/services.py :: build_self_pupil_filter`), so a change started for it
finds nothing to move (`address_change_nothing`), and the tool takes no address the rule refuses.
Rewrite it by hand with a file run by `mongosh --file`, kept in the operator's checklist (§2): a spelling
that differs from its fold only in case, surrounding spaces or the domain's form to that fold, and
an empty one or one the rule refuses to the folded address the person is established to hold, as
[section 5](#5-when-somebody-asks-for-their-data-or-asks-us-to-change-it) establishes a lost
mailbox's.

**Two promises rest on the retention sweep's pass**
(`fl_frontend/src/features/bewerbungen/sweep.ts :: sweepAddressChange`): the privacy notice's word
that a change whose step lapsed ends „innerhalb einer Stunde“, and the word, in the notice and in
both mails the change sends (`fl_frontend/src/core/addressChangeEmail.ts`), that a change an
administrator started takes effect its waiting time after its confirmation. While no
pass runs neither is kept: a lapsed change keeps its new address, and a change past
its waiting time stands until the next pass.

**The fixture confirmations run on every pass**
(`fl_frontend/src/features/spielbestaetigungen/sweep.ts :: runSpielSweep`).

**Each pass that could list the seasons counts on the pass's line**, the record of what it did:
the rows it closed, the rows it asked and reminded, the mails it owed and the rows it passed over. Every mail
it owes, a request, a reminder, an Einteilung, the notice of a move, a referee taken off or a
call-off, or a club's line-up reminder, is a Postausgang row written in the transaction that writes
its confirmation row or, for the line-up, under its own keys, so a row reads as asked exactly where
its mail is owed; the drain after the pass sends them and retries
each, and a mail it gives up is counted on the pass's line and reported to the
heartbeat. A notice about a match already kicked off is owed nobody. A listing or a season's pass that fails
ends the job, which the scheduler logs and the heartbeat reports; the next pass repeats nothing
that committed. No mail of the pass carries a link: a club answers on its Übersicht and a referee on
theirs, signed in. The pass's line holds its counts under the key `spielbestaetigungen`, and
`scheduler.job_failed` names that job where it threw:

```bash
docker compose logs --since 2h frontend | grep -E 'scheduler\.(pass|job_failed)'
```

**The first passes to meet a running season's unasked fixtures are a burst**: they ask about every
dated fixture of the running season inside the answer window
(`fl_backend/app/shared/schemas/bounds.py :: SPIEL_CONFIRMATION_DEADLINE_DAYS` plus
`:: SPIEL_REQUEST_LEAD_TIME_DAYS` days ahead), every mailbox of both clubs' seats and each booked
referee, spread over as many hourly passes as the per-pass share needs, and a fixture inside the
deadline's own days is due the day it is asked.

**The account sweep stores no date, so its counts on the pass's line are the answer**
([`spec.md`](spec.md) §1.1): the accounts answered unreferenced, deleted, already gone, and those a
failure left for the next pass, never naming an address. A pass whose sign-in store could not be
listed rejects, which `scheduler.job_failed`
names as `account` and the heartbeat as `account failed`. Every other failure inside a pass is a line of
its own, and the next pass asks again.

**An `account.references_failed` line carrying `no_owner` means the backend reads no live
`owner` grant**, so it refuses every batch and the sweep deletes nothing, every pass alike. Such a pass still counts, its
`failed` every account the store listed, so a pass's line alone does not say the sweep works. Either the backend reads another database than the league's,
which `DB_BASE_NAME` in `fl_backend/.env` names, or the `owner` grant is gone; the backend's boot warns
`grants.no_grant` or `grants.no_owner` in both cases. Repair the setting, or write the `owner` grant as
[section 3](#3-granting-or-revoking-admin-access) says.

## 10. The mail provider's dashboard

**None of this is in the repository**, and the webhook is inert until it is done. Steps 1, 2 and 4
are taken by hand in the mail provider's own console; step 3 is a file on the server, and it is
the one that stops the frontend booting.

1. Create an endpoint at `https://<the league's domain>/api/mail/delivery`.
2. Subscribe exactly six events — `email.delivered`, `email.bounced`, `email.complained`,
   `email.suppressed`, `email.failed` and `email.delivery_delayed` — and **neither `email.opened`
   nor `email.clicked`**, which the published notice promises are not measured
   ([`../datenschutz.md`](../datenschutz.md#6-retention-is-bounded-where-a-bound-was-chosen)).
3. Copy the signing secret into the server's `secrets/resend_webhook_secret`, owned as §16 says. **It begins
   `whsec_` and must be pasted with that prefix**: the verifier accepts the value either way, and
   the boot check does not, deliberately — refusing at start beats answering 400 to every event.
   The frontend reads it once it is recreated (§16).
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

**The state is a seat holding a date beside no `confirmed_at`**, and nothing in the product clears
one: the date arrives with a person's own confirmation and rides with their address through every
later edit (`fl_backend/app/api/teams/services.py :: _birth_date_held_by`), so no save reaches it,
and no record model expresses the pairing either, so the read-back (§2) reports nothing about it.

**It sits on TWO collections, three seats each, and clearing one leaves the other.** One pair of
declarations builds the block on a `saison_teams` row and on the `bewerbungen` document the people
were collected on
([`../glossary.md`](../glossary.md#kontakte--the-three-people-the-league-reaches-a-team-through)),
so an accepted school holds each date twice. **The clear is run by hand against the cluster, as every
migration here is** (§2): a file run with `mongosh --file` in a terminal, the backend image
carrying no database shell. Four things decide whether that file is right:

- **Count before clearing, per seat and per collection, on the term the clear will use** — a date
  that is not null beside a `confirmed_at` that is null — and read the number of documents each
  update reports as modified against its count.
- **The `null` half matches the stored null every unconfirmed seat holds**, the key being
  required (`fl_backend/app/api/teams/schemas.py :: FLKontaktKenntnisnahme`), and the `$ne: null`
  half a stored value alone, so an empty seat and an already-clear one match neither.
- **Null rather than `$unset`**, which is the shape every write path stores and every read answers
  as none (`fl_backend/app/api/bewerbungen/services.py :: compose_kontakte`).
- **One update per seat, each carrying its own seat's term**, for the reason §2's rename gives: a
  dotted path cannot traverse a null, and a document the term matched necessarily holds that seat.

Then the read-back (§2): exit 0.

## 13. After a restore from a snapshot

**The published notice promises that nothing comes back from a backup without the person's erasure
being run again** (`/datenschutz`), and this section is how that promise is kept
([`../datenschutz.md`](../datenschutz.md#5-erasure-reaches-everyone-who-asks)). A restore is
contemplated for two things: a hand-run migration that succeeded against a mistyped path (§2), and
a mistaken erasure, for which the snapshot window is the only route back. The steps, in the order
they are done, each explained below:

1. **Write down the moment the snapshot to restore was taken.**
2. **Hold the frontend**: add the line `RESTORE_HOLD=on` to the server's `fl_frontend/.env`, then
   run `docker compose up -d --wait --force-recreate frontend` in the checkout.
   `docker compose logs frontend | grep scheduler.held` prints one line once the hold has taken.
3. **Where the snapshot predates a deploy whose migration files changed stored data, stop the
   application services too**: `docker compose stop frontend backend`.
4. **Restore the snapshot in the Atlas console**, onto the cluster it was taken from, and write
   down the moment the restore completed. Atlas deletes the cluster's data before it restores, and
   the cluster answers nothing meanwhile.
5. **Where step 3 stopped them**, run the migration files of every deploy the snapshot predates, in
   their order, as §2 runs them. Then start the services with `docker compose up -d --wait`, and run
   §2's read-back: exit 0.
6. **List the `journal.act` lines between the two moments.**
7. **Set each withdrawal again, then run each erasure again**, a former owner's only after §3's
   recovery.
8. **Re-enter the squad rows and registrations written since the snapshot.**
9. **Re-run every grant and ban change made inside the window.**
10. **Activate again each season whose activation the snapshot predates.**
11. **Lift the hold**: delete the line from `fl_frontend/.env`, then run
    `docker compose up -d --wait --force-recreate frontend`.
12. **Write to the clubs and referees the window reached.**

**The two moments bound what the restore undid.** The lines between them are acts the restore took
back, and an act after the second is the restored site's own, which stands as its person made it.

**A migration the snapshot predates is run again before anything reads the restored data.** The
snapshot holds the shape from before that deploy, which the running release cannot read, so the
application services stay stopped until its files have run, as §2's order keeps them. Those files
are the ones the owner kept for that deploy, each written to be run again.

**The hold keeps every hourly pass off the restored state until the steps are done.** The steps run
on the admin pages, so the frontend serves throughout, and what the hold stops is §2's
([What the hold stops](#what-the-hold-stops)). Unheld, a pass would do harm nothing undoes:

- **The pupils' deletion** would delete each pupil the season-after rule makes due, a returning
  pupil whose squad row the snapshot predates among them, and nothing brings one back.
- **The fixture confirmations** would mail seat holders and referees whose erasure has not run
  again, and the retention sweep would remind the seats of erased people.
- **The drain** would send what the snapshot held unsent.

The heartbeat alerts until step 11, and no sign-in code is mailed meanwhile: sign in by passkey,
which every administrator holds and which the owner's steps ask for anyway.

**The action log cannot be the list, because the restore rolls it back too; the backend's
`journal.act` lines are.** Everything written between the snapshot and the restore is gone, the log's
own rows about it included. Every erasure a person or an administrator asked for left its lines in the
backend's stream, and so did every consent a person withdrew and every Widerspruch made through a
seat's link or a referee's, whether its commit landed or lost its answer. A line names its act and, by id and with no address or name, where its person stood:
`records`, as `collection/id`, on an erasure's line each record one address alone holds, and on a
withdrawal's or a Widerspruch's the record the act landed on, which on a seat's row or an application
holds other people too; `seats`, a seat's withdrawal's or Widerspruch's slots by
name, an erasure's as `collection/id/slot`, its row holding other people, and a confirmed slot's with
that slot's `einwilligung.confirmed_at` as a fourth part; `rows`, an erasure's every
other field that named the address, as `collection/id/path`, so a row naming two people says which
of them this is; and a withdrawal's `choices`. The season rule's deletions write none, the rule deleting the same pupils again on its own.

**List the lines between the two moments** from the host's journal (§7), each in the
`journal.act` message, every value in a field of its own. Docker cuts a line at 16 KiB, so
an act naming more than a line holds, as a former owner's can, takes several: each carries the same
`act_id` and its `part` of `parts`, and every step below reads the parts of one `act_id` as one line.
A part the command does not find leaves that act's list short, so read the mail thread for it. The
times are UTC, and the name is every backend container's, across deploys:

```bash
sudo journalctl -t "$(docker compose ps --format '{{.Name}}' backend)" --since "2026-10-15 03:00:00 UTC" --until "2026-10-15 09:40:00 UTC" --output=cat | grep '"journal.act"'
```

**A line outlives its act only as long as the journal keeps it** (§7), so read the mail thread
beside the lines for every request that arrived by mail. A line whose commit lost its
answer may name an act that never landed, and running it again wrongs nobody, the person having asked
for it.

**A withdrawal is set again on its record, on a seat's in the `einwilligung` of each slot its `seats`
name and no other, a seat's Widerspruch's seats emptied again, and a referee's stamped again in
`confirmation.declined_at` with the line's German day**, each by a file run with
`mongosh --file`, from the fields of its line, the person's evidence having gone with the lost window.
A line names the choice and no value, and each choice withholds by one value on each kind of record:
`scope` is set to `internal` on a pupil, a referee or a registration and to `kontakt_data` on a seat,
and `media` to `false`. A choice granted since by evidence later than the line stands. A person who made one of these acts
and whose record the restore does not hold needs nothing.

**Then run each erasure again on „Löschungen“, with the address its line shows**: keyed on the
address, the erasure reaches every other record it names. Read it in the restored rows, in this order,
never elsewhere on the row, since a seat's row and another person's change hold other people:

- a `records` entry: the address on that record, as §5's table names it;
- a `seats` entry, `collection/id/slot`: `kontakte.<slot>.email` on that row. A seat passes from one
  person to another, so the slot may hold someone else:
  - An entry with a fourth part, the slot's confirmation day, whose day the restored slot's
    `einwilligung.confirmed_at` differs from: read past it, the slot holding someone else. An empty
    stamp is no such difference: the person may have confirmed after the snapshot, so read that
    entry as an unconfirmed one.
  - An entry without one, or read as such: all of a line's entries must give one address, and an
    address they disagree on is read past. A line of unconfirmed seats alone has nothing to agree
    with, so ask the club who sat there first;
- a `rows` entry, `collection/id/path`: the field at that path on that row.

The entries a restored row no longer holds, written after the snapshot, are read past. An address
with no entry the snapshot holds left nothing the restore brought back. A line naming nothing at all
took a sign-in account alone, which goes with the account sweep's first pass after the hold, and needs
nothing. A restored row does not look erased,
and each role's guard reads something the restore took away:

- **A referee.** The whole row is back, with its name, school and contact members, and every
  booking the erasure had left naming nobody or taken off names them again, so nothing reads as
  erased and they are editable and bookable. The erasure does all of it again.
- **A pupil.** The person and their squad rows are back and standing, and every line-up entry, goal
  and card the erasure had left naming nobody names them again. The erasure takes them and clears
  the entries again, asking no retirement first.
- **A contact seat.** Every seat that address held is back and filled. The erasure is keyed on the
  address, so the matched address is the whole input — and its counts take in records written since
  the snapshot as well, which is why section 5 says to read them before pressing.
- **An administrator.** Every grant the address held, an `owner` grant included, is back and admits
  them. The erasure
  removes the grants again, where a `DELETE` of the grant would not do: it refuses
  an `owner` grant. **The owner runs it again, behind the passkey touch**: the page refuses a grant
  holder's address to anyone else ([section 5](#5-when-somebody-asks-for-their-data-or-asks-us-to-change-it)). **A former
  owner** who handed the role over and was then erased comes back as the `owner` row, the handover being
  undone with everything else, and the person the role passed to is an administrator again or holds
  nothing. Nobody who holds no owner's power can erase that address, and the row's holder is the erased
  person. So §3's recovery write runs first: it demotes that row and writes the true owner's, as §3's
  recovery says; only then does the owner run the erasure. The same applies to a handover the restore
  undid with the old owner still present: that person is the owner again until it is started afresh.
- **A record holding no address.** No erasure reaches one
  ([`../datenschutz.md`](../datenschutz.md#5-erasure-reaches-everyone-who-asks)), so no line names
  it.
- **Anybody who had signed in, whatever their role.** The `auth` database is on the same cluster
  , so a restore of the cluster brings back their `user`, `session`,
  `account` and `passkey` rows with everything else. Once the erasure above has run again, the
  account sweep's first pass after the hold deletes each, a barred address's included (section 5).

**Then re-enter the squad rows and registrations written since the snapshot**, from the clubs'
mail threads: the pupils' deletion runs on the state the last steps leave, so a returning pupil
whose row is back by then is no longer due.

**Then re-run every grant and ban change made inside the window**, which the restore undid as it
undid the erasures, and which nothing re-runs:

- **A grant removed, or a handover completed, after the snapshot is back as it was.** A restore mails
  nobody, and the grant admits its holder again; an erased administrator's goes with their erasure above.
  Remove any other again with `DELETE /grants/{grant_id}`, or hand over again
  ([section 3](#3-granting-or-revoking-admin-access)). A grant added after the snapshot is gone and
  is added again, its wait starting anew. The record of each is the mail every change sent every holder.
- **A ban entered after the snapshot is gone, and one lifted after it is back.** Enter each again
  at `/admin/ban-list`, which owes the person its notice again, sent once the hold is
  lifted, and lift the others there; the mail thread that asked for each is the record, the log
  having rolled back with it.

**Then activate again each season whose activation the snapshot predates**, last of all: the first
pass after the hold runs the pupils' deletion over the state the steps above re-entered. Its
deletions are re-derived: it writes no line.

**Once the hold lifts, the first pass runs a minute after the boot**, pinging the heartbeat, and the
drain sends what waited, so these follow:

- **The Postausgang came back with the snapshot**, so every mail open in it then goes out with the
  first drain, a second time where the lost window had sent it already, beside the mails the steps
  above owed.
- **The retention sweep repairs itself**, its clocks being stored dates, but a deletion notice
  already sent whose stamp the restore took back is sent a second time, that sweep mailing before
  it erases.
- **The fixture confirmations ask once more about what the window asked**, the restore having taken
  back every confirmation row minted and every answer given since the snapshot:
  - **A request mailed inside the window** names a row that is gone; the first pass mints the
    fixture again and mails a fresh request.
  - **An answer given inside the window** is gone, and the fixture reads unconfirmed again: the club's
    Übersicht asks for it once more, from the row the snapshot holds or the one the first pass
    mints.
  - **A referee's answer given inside the window** is gone with their row. Their decline also took
    them off the fixture, so the restore books them onto it again with no row, and the first pass
    mails them a fresh Einteilung; until they agree again the fixture names no referee.

**Write to each club mailed inside the window**, which the mail provider's list of sent messages
names by subject, that an answer given on its Übersicht in those days is to be given again there. Write
to each referee booked onto a fixture still to come, at the address their record holds, that an
answer given on their Übersicht in those days is to be given again there, a decline included: no
record the restore keeps says which of them answered.

**A match report sent or corrected inside the window is gone, and nothing tells its referee**: the
fixture reads as the snapshot left it, open on the referee's Übersicht where no report stood then. No
record names whose report went, the log being rolled back too, and a report can be sent or
corrected at any time from the match's kick-off until its season ends, so write to the referees booked on
every fixture played by the restore day in a season the restore leaves running, which the fixture
list names, to look at their Übersicht and enter again what it lacks; an administrator's correction
made inside the window is gone too.

**Nothing needs running for the caches.** A restore clears no cache tag, so the public pages serve
what they cached before it, the people erased again and the publication consents withdrawn again
above among them, for at most the lifetime [section 20](#20-after-a-hand-edit-in-mongodb) states.

## 14. The `auth` database's indexes

**Every production boot of the frontend builds them, and serves the site whether or not each is
built** (`fl_frontend/src/core/authIndexes.ts :: AUTH_INDEXES`). An index the boot could not build
is one `auth.index_unbuilt` line naming it, and only a store that did not answer is built again
before the next boot. So after every deploy ([section 1](#1-deploying-a-build-and-going-back-to-an-earlier-one)),
read the frontend's log for that event:

```bash
docker compose logs frontend | grep auth.index_unbuilt
```

| The line's `code` | What stands                                                       | What to do                                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `85`              | An index on the same key under another name, which keeps serving  | Give the list's entry the name the Atlas console shows, in a release                                                                                                     |
| `11000`           | Rows sharing a value the index keeps unique; no index on that key | Group the collection on the key in the Atlas console to find them. Which row stays is a judgement about those accounts, and the next boot builds the index once one does |
| `13`              | Nothing: the sign-in store's database user may not build an index | Grant that user `readWrite` on `auth` in the Atlas console, which carries `createIndex`, then restart the frontend (below)                                               |
| none              | Nothing: the store did not answer the boot                        | Nothing: the frontend builds them again when the store answers, and logs `auth.index_unbuilt` again for any still refused                                                |

**A name in the list is the one production's index carries.** Three of them — the `passkey`
collection's unique `credentialID` and both expiry indexes — were made in the Atlas console before
the frontend built any, and a same-key index under another name is the code-85 line above.

**For a release changing an index's key or options, drop the old one in the Atlas console as it
deploys, then restart the frontend**: `createIndex` refuses a name already held at other options
and builds nothing in its place, so the old index would otherwise stand for good. A restart boots
the frontend again, which builds every index:

```bash
docker compose restart frontend
```

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
  guards in `fl_frontend/src/core/auth/guards.ts` would refuse anyway.

**An index dropped by hand after a boot is reported by nothing until the next one.**

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
  address, and the send or the library call around it failed; the code's own Postausgang row
  (`kind: "sign_in_code"`) reading `abandoned` is the provider refusing it, its `delivery_reason` the provider's own
  name for the refusal.
- `auth.code_mail_capped`, an info line: five codes had been asked for the address inside the
  hour, so this one was sent nothing. The five count every request,
  a stranger's and one the gate refused included, so an address can be capped with nothing mailed;
  retries during a backend outage spend a person's hour the same way.
- `auth.deletion_link_capped`, an info line: a signed-in person asked for an account deletion link
  past their address's five mails of the hour, codes and links counted together, so nothing was
  minted or mailed and the press read as sent. A link they already hold stands for its day.
- A stack that is not production mails nothing: the code's Postausgang row reads `held`,
  and the message is in its sink. On the local stack that is `.tmp-mail/`, which
  every `./scripts/ops/local.sh` start empties of what earlier runs filed, so a code there is this
  run's.

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

**Each machine has its own.** The internal keys and the sign-in secret
authenticate one machine's processes to each other, so a development machine
generates fresh ones and never copies production's. **A development machine holds no production
login at all**: its two database URI files name the local stack's database through the port that
stack publishes on loopback, and the local stack itself hands its services an inline config naming
its own database.

On a development machine, in Git Bash at the checkout root, this writes every file both dev servers
and the local stack read, each readable by its writer alone, and prints nothing:

```bash
(umask 077 && mkdir -p secrets && for name in internal_api_key_base internal_api_key_system internal_api_key_admin auth_secret; do openssl rand -hex 32 | tr -d '\r\n' > "secrets/$name"; done && printf 'mongodb://localhost:27017/?directConnection=true' | tee secrets/frontend_mongodb_uri > secrets/backend_mongodb_uri)
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

**No line in either package's `.env` holds a value a secret file holds**: Compose hands every line
to the container as a variable, which `docker inspect` prints. Delete such a line in an editor,
never with `cat`.

**On the server, each file is owned by the user that reads it** ([`spec.md`](spec.md) §1.2): a new
value is written without ever existing under another owner or mode, and without passing through the
shell's history. For a value that exists only in the password manager, run the line for its owner
and paste the value, then Ctrl-D:

```bash
sudo install -o 65532 -g 65532 -m 400 /dev/stdin secrets/tunnel_token
sudo install -o 1001 -g 1001 -m 400 /dev/stdin secrets/<a frontend file>
sudo install -o 1002 -g 1002 -m 400 /dev/stdin secrets/<a backend file>
sudo install -o root -g 1003 -m 440 /dev/stdin secrets/<an internal key>
```

**Each service reads its files once, as it boots**, and Compose recreates a container for a
changed definition or image, never for a file's new content. So a value replaced on a running stack
takes effect only once the services reading it are recreated, which [`spec.md`](spec.md) §1.2's
table names. A wrong `secrets/turnstile_secret_key` fails every bot check until then. Run this in
the checkout, naming those services; `--wait` reports their healthchecks:

```bash
docker compose up -d --wait --force-recreate frontend backend
```

- **The three internal keys** are read by both application services, so recreate `frontend backend`
  together.
- **A frontend file** recreates `frontend`, and **`backend_mongodb_uri`** recreates `backend`.
- **`tunnel_token`** is read by the connector alone, so recreate `cloudflared`.

**Where a service refuses to boot naming a file**, its last lines say which fault, and a failed
deploy prints them: a missing file is written, an unreadable one is given the user and mode above,
and a blank one is written again. **Where it names an `INTERNAL_API_KEY_*`, that key carries a
character outside the class** ([`spec.md`](spec.md) §1.2): generate all three again on the server,
each with
`openssl rand -hex 32 | tr -d '\r\n' | sudo install -o root -g 1003 -m 440 /dev/stdin secrets/<key>`,
and update the password-manager entry. Both containers are recreated by the command above, so the
new keys never meet the old. **After a suspected leak of `internal_api_key_admin`**, generate all three
the same way: its holder, reaching the backend on the private network, can act as any administrator,
so rotating is not finished until `action_log` has been read for every `grants` write since the
leak, and every grant nobody can account for is removed on the „Administratoren“ page. **A new `auth_secret` signs everybody out.**

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

The five-an-hour mail cap keeps rows of the same shape under `sign-in-mail-`; they lift within the
hour. They can be lifted sooner the same way, by deleting every row whose `identifier` starts with
`sign-in-mail-`, which gives every address its hour back.

## 18. The Node a checkout runs

**`pnpm install` in `fl_frontend/` downloads the exact Node release
`fl_frontend/package.json :: devEngines` names, which `fl_frontend/pnpm-lock.yaml` records, and
every `pnpm run` and `pnpm exec` in that checkout runs it**, whatever Node the machine has
installed; `pnpm exec node --version` there prints the pinned release. The same release is the
frontend image's `FROM node:` tag, so a new Node is one branch editing `devEngines`, that tag and
its digest together, then running `pnpm install` to rewrite the lockfile:
`scripts/tests/test_image_pins.py` refuses a manifest, lockfile and tag naming different releases.
Once it merges, a machine needs nothing more than the next `pnpm install`.

## 19. The database's storage alert

**Nothing in this repository watches how full the database is, and the production tier has a hard
limit**: 5 GB of documents and indexes together. What a write meets past it is unverified: MongoDB's
page on the limit states the size and not the behaviour, so plan for every save failing at once.
Nothing bounds how much one signed-in person writes: the alerts below show one person writing far
past any legitimate day as surely as many people at once or the action log's own growth, and the
log page shows which team's seats or which referee wrote it, whose address a ban then stops.

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

## 21. The repository's settings

**GitHub holds them and no file here can read them**, so this is a check the owner makes in the
repository's settings, after any change there:

- **Rules, Rulesets: one ruleset targets the default branch, its enforcement Active.**
  - It requires a pull request, with zero approvals: a sole maintainer cannot approve his own.
  - It requires one status check, `verify`, which fails on any other job's failure
    ([`spec.md`](spec.md) §1.6). A required check no job reports blocks every merge.
  - It blocks force pushes and restricts deletions: every published `sha-` tag names a commit of
    `main`, which a rewrite would leave behind.
  - Its bypass list is empty, since an exemption would exempt the force push it refuses.
- **General, Pull Requests: merge commits alone, squash and rebase off.** A merge keeps each commit
  and its body, which carries what the diff cannot ([`../writing.md`](../writing.md#commit-messages)).
