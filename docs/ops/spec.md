# Ops — spec

**Scope:** `docker-compose*.yml`, `nginx/`, `scripts/`, both Dockerfiles

| Section                                                       | Answers                                                                      |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [1.1 Service inventory](#11-service-inventory)                | What runs in production, and where its limits and health checks are set      |
| [1.2 Mounts](#12-mounts)                                      | Which host paths must exist before `up`                                      |
| [1.3 nginx routing](#13-nginx-routing)                        | Which upstream serves which path                                             |
| [1.4 Security headers](#14-security-headers)                  | What is set, and why `'unsafe-inline'` survives                              |
| [1.5 The scripts](#15-the-scripts)                            | Which script to reach for, and which environment it belongs to               |
| [1.6 The verification gate](#16-the-verification-gate)        | Which scopes exist, what each runs, and what each needs                      |
| [1.7 Script conventions](#17-script-conventions)              | What a path says, what every script shares, and what its output goes through |
| [1.8 The edge's declared state](#18-the-edges-declared-state) | What is set at Cloudflare, which no file here can hold to it                 |
| [2. Invariants](#2-invariants)                                | The rules that must hold                                                     |
| [3. Violation → remedy](#3-violation--remedy)                 | A symptom, its cause, and what to do about it                                |
| [4. Known-open](#4-known-open)                                | The accepted gaps                                                            |

The recurring procedures are in [`runbooks.md`](runbooks.md).

---

## 1. Contract

### 1.1 Service inventory

**Production's four services, `frontend`, `backend`, `nginx` and `cloudflared`, publish no port at
all**: `cloudflared` dials out to Cloudflare and carries every
request back over `frankfurtleague-net`, so nginx needs no host port to be reached from the
internet, and the connector holds a static address on that network because `nginx/shared/http.conf` trusts
it by address (§1.3). It reads its credential with `--token-file` from a host file no environment
variable and no command line carries (§1.2), and the tunnel's own public hostnames and origin
settings are dashboard state (§1.8).

**The connector reaches nginx and nothing else**: nginx alone joins both
`frankfurtleague-net`, which it shares with the connector, and `frankfurtleague-app`, which it
shares with `frontend` and `backend`. An origin set in the dashboard is read by nothing in this
repository, so without the split a hostname pointed at `backend:8000` would publish the whole API
past nginx, its routing and its blanking of `X-FL-Actor`; with it, that origin does not resolve.

Each service's image, resource limits and health check are `docker-compose.yml`'s own, at its
`image:`, its `deploy.resources` and its `healthcheck:`.

**Every base image in a Dockerfile's `FROM`, every image either compose file names, and every image
`scripts/gate/selfcheck.sh` and `scripts/ops/local.sh` run is pinned by tag and digest**
(`name:tag@sha256:<digest>`), this repository's two own images excepted: a build or a pull fetches
the digest, the registry's multi-platform index, so a tag rebuilt or repointed upstream changes
nothing here until a pull request moves it, while the tag is what `.github/dependabot.yml`'s
`docker` and `docker-compose` ecosystems compare to propose the next pair; the two scripts' pins
move by hand, no ecosystem reading a shell string. **Each tag names the exact release its digest
is**, the runtime bases included: a series tag (`mongo:8`) is a label no reader can hold to one
release. `local.sh`'s
copy and both database test tiers run the local stack's own mongo, digest included, so a
`docker-compose` update moving the stack alone fails. `scripts/tests/test_image_pins.py` holds every
such reference to that form, the copy and the backend's tier to the stack, and the frontend's tier
to the backend's.

**The toolchain an image bakes in is the one the checkout declares**, so what CI tested is what
production runs. The frontend base's Node lies in the series `fl_frontend/package.json :: devEngines`
declares, whose newest release `pnpm install` records in `fl_frontend/pnpm-lock.yaml` and downloads for every checkout and CI job while the image's install passes
`--no-runtime` and keeps its base's own; the frontend image's pnpm is `packageManager`'s; the backend base's Python lies inside the series `fl_backend/.python-version` pins,
which every CI job's interpreter comes from; and the backend image's uv is the release
`.github/actions/backend-toolchain/action.yml` installs for every CI job,
`fl_backend/pyproject.toml :: "required-version"` being a range that admits Dependabot's own uv
rather than a pin. Dependabot's
`docker` ecosystem moves a tag alone, so its pull request for a new Node or uv, or for a Python
outside that series, is refused by `scripts/tests/test_image_pins.py` until the pin moves on the same
branch — for Node, with the lockfile `pnpm install` rewrites. **For uv that refusal is the only
wait a new release meets**: `ghcr.io` publishes no date, so the ecosystem's cooldown holds nothing
back.

**The digest alone decides what runs, and nothing checks the tag against it.** An official image is
rebuilt under the same tags whenever the image it is built `FROM` is refreshed
([the Official Images FAQ](https://github.com/docker-library/faq/blob/ce1a70af72a522f8638d6bffd930ef3252de7837/README.md#why-does-my-security-scanner-show-that-an-image-has-cves),
read 2026-09-25), so a correct pin's digest and its tag's current one routinely differ, and a
registry comparison would refuse pins that are right. The tag is an unverified label that Dependabot
keeps beside the digest it rewrites, and a hand edit moving one without the other goes unnoticed.

**A recreated nginx needs no connector restart**, so nothing is owed after the manual recreate §3
sends a reader to: the connector resolves its origin on every new connection and holds no address
between them, and only the sockets it had pooled to the container that went fail, once each. Read
from cloudflared's own source at the release `docker-compose.yml` pins, 2026-09-07, and a version
bump moves it; nothing here observes it.

All four: `restart: unless-stopped`, and JSON file logging capped by
`docker-compose.yml :: x-logging`, on their bridge networks. **That cap is the whole bound on a container's own stream**:
the deploy copies both application streams to `/var/log/frankfurtleague/` before the recreate
destroys them (`scripts/ops/deploy.sh :: LOG_DIR`), and host files the deploy cannot install bound
those copies to thirty days, through `systemd-tmpfiles`, and the edge's access and error logs —
host files rather than a container stream (§1.2), holding every line that names a visitor
— to eight, through an hourly `logrotate`
([`runbooks.md`](runbooks.md) §7). An hourly timer there copies the backend's erasure-journal lines
into a host file per day under the same thirty days (`scripts/ops/export_journal.sh`), since a
restore reads them after the stream holding them is gone.

**Every service drops every capability and runs under `no-new-privileges:true`, and `nginx` alone
adds any back**: four, each one its master, starting as root, fails to start without.

- `CHOWN` hands the workers the temp directories they write.
- `SETUID` and `SETGID` make the workers their own user.
- `DAC_OVERRIDE` opens the logs, and the TLS key wherever root does not own it: the log directory
  belongs to the deploying user
  ([`runbooks.md`](runbooks.md) §7), and root is no owner there. Re-owning it to root does not
  replace this capability, because nginx gives each log it reopens to its worker's user, and a
  master started after that cannot write to a file it has given away.

`NET_BIND_SERVICE` is not among them: a container's `net.ipv4.ip_unprivileged_port_start` is 0,
which lets every user bind below 1024 (read 2026-09-27, on engine 29.8.0). With `NET_RAW` in no
container, none can read the traffic crossing `frankfurtleague-app` (§4).

**The frontend container is also what runs the retention sweep.**
`fl_frontend/src/instrumentation-node.ts :: registerOnNode` arms
`fl_frontend/src/features/bewerbungen/sweep.ts :: armBewerbungSweep` under a production build with
`BEWERBUNG_SWEEP` on, and it then runs one pass a minute after start and then hourly, so every
retention clock runs in the process that serves the site and stops when it stops. Production
declares no replicas, so one process arms one timer, and a tick finding the previous pass
still running skips with one line rather than overlapping it. The clocks that write inside the pass
select on dates or on season statuses and are idempotent,
so a redeploy, a restart and a double-arm each cost nothing; the deletion notice is idempotent to one
floor, a crash between a delivery and its stamp repeating that one notice once. Ending an address change whose step lapsed is the
pass's alone, and so, but for an approval pressed after it, is making one take effect once its
waiting time ends: each happens only while `BEWERBUNG_SWEEP` arms the timer
([`runbooks.md`](runbooks.md) §9). `BEWERBUNG_SWEEP` is what turns the
pass off on a production build (§1.5); a `next dev` process arms nothing whatever that switch says,
its default being on. Each of those is a way for the sweep to be absent, and `GET /bewerbungen/sweep`
is what tells one from a pass that found nothing to do: it answers the day the last pass ran, null
where none ever has. The half after the season
loop stamps no day, so its per-pass log line is its record. [`runbooks.md`](runbooks.md) §9 is the
call.

**It runs the account sweep too, on a timer and a switch of its own.**
`fl_frontend/src/instrumentation-node.ts :: registerOnNode` arms
`fl_frontend/src/features/funktionen/sweep.ts :: armKontoSweep` under a production build with
`KONTO_SWEEP` on, on the same schedule, a minute after start and then hourly: an operator stops
account deletion without stopping the retention clocks, and a slow retention pass delays none of
it. A pass deletes the sign-in account of every address no record references, and a pass repeated costs nothing, an
account already gone being counted as such. Nothing stores that a pass ran, so its completion line
in the frontend's log is the answer ([`runbooks.md`](runbooks.md) §9 reads it).

**And it runs the pupils' deletion, on a timer of its own under `LOESCHUNG_SWEEP`.**
`fl_frontend/src/instrumentation-node.ts :: registerOnNode` arms
`fl_frontend/src/features/saisons/sweep.ts :: armLoeschungSweep` under a production build with
`LOESCHUNG_SWEEP` on, off by default, on the same schedule, whatever `BEWERBUNG_SWEEP` reads:
activating a season deletes under that switch first and tells the administrator the next hourly pass
finishes the rest, so no other switch may hold that pass back. Each pass drops the squad cache after
its last call, and a pass beside an
activation's calls deletes nobody twice, the backend
judging each pupil again in a transaction of their own. Its per-pass line is its record
([`runbooks.md`](runbooks.md) §9).

**And the fixture confirmations, on a timer of their own under `SPIEL_SWEEP`.**
`fl_frontend/src/instrumentation-node.ts :: registerOnNode` arms
`fl_frontend/src/features/spielbestaetigungen/sweep.ts :: armSpielSweep` under a production build
with `SPIEL_SWEEP` on, off by default, on the same schedule, whatever any other switch reads. Off is deliberate: the first armed passes
mail every fixture of the running season inside the answer window, so a deploy never starts the
league's fixture mail, and the switch alone stops it for every season at once. A pass mails before
it stamps a first request and drops the fixtures cache after its last call. `GET /spielbestaetigungen/sweep`
answers the day the last pass ran, and its per-pass line is its record
([`runbooks.md`](runbooks.md) §9).

**Note:** `API_VERSION` is a constant of the code rather than a setting, so bumping it is a code change — and the
version is spelled again outside the code, at sites a commit does not all reach. §4 names the sites
where a version left behind breaks something; §3 carries what each failure looks like.

### 1.2 Mounts

| Host path                        | Container path                   | Mode       |
| -------------------------------- | -------------------------------- | ---------- |
| `./nginx/prod`                   | `/etc/nginx/conf.d`              | read-only  |
| `./nginx/shared`                 | `/etc/nginx/shared`              | read-only  |
| `./certs`                        | `/etc/nginx/certs`               | read-only  |
| `/var/log/frankfurtleague/nginx` | `/var/log/frankfurtleague/nginx` | read-write |
| `./secrets/<name>`, each secret  | `/run/secrets/<name>`            | read-only  |

Each must exist before `up`. `deploy.sh` checks the read-only ones, every file under `./nginx/prod`
and `./nginx/shared` and every secret file included, before anything is stopped or pulled, and
creates the log directory itself in the same run ([`runbooks.md`](runbooks.md) §7); a directory it
left to Docker would be root-owned, and the host's `logrotate` file names it. A missing config
directory is mounted empty, so nginx loads no server of this site's or fails on its includes.

**Every credential the stack holds is a Compose file secret, and none is an environment
variable**: `docker inspect` prints a container's environment, and never the contents of a
mount. Each file has one name on the host, at `/run/secrets/` and in development, so the two
database logins are two files. Who holds which is
`scripts/checks/check_compose_model.py :: SECRET_HOLDERS`; no service is handed one of their old
environment names.

**Compose mounts a file secret as a bind mount and ignores its `uid`, `gid` and `mode`**, so the
host file's own owner and mode are what the container sees (Docker's Compose file reference,
`services` · `secrets`, read 2026-09-27). Each file therefore belongs to the user that reads it:

| Files                                                                                                                             | Owner                            | Mode  |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----- |
| `tunnel_token`                                                                                                                    | uid and gid 65532, the connector | `400` |
| `fl_actor_signing_key`, `frontend_mongodb_uri`, `auth_secret`, `auth_resend_key`, `resend_webhook_secret`, `turnstile_secret_key` | uid and gid 1001, the frontend   | `400` |
| `backend_mongodb_uri`, `sperrliste_schluessel`                                                                                    | uid and gid 1002, the backend    | `400` |
| `internal_api_key_base`, `internal_api_key_system`, `internal_api_key_admin`                                                      | root, group 1003                 | `440` |

**The three internal keys are one file each, read by both application services**, which run as
different users: both take group 1003 through `group_add`, the documented answer for containers of
different users sharing one file, so neither service's copy can drift from the other's. A file
readable by the wrong user leaves that service refusing to boot, and the connector restarting in a
loop; the deploy has each service's own container read its files before anything is recreated.

**The actor token's signing key is the frontend's alone**: the private half of the machine's
Ed25519 pair, as PKCS#8 PEM. Any other service holding it could mint an actor the backend trusts.
The public half is not secret and sits in `fl_backend/.env` as `ACTOR_TOKEN_PUBLIC_KEY`
([`runbooks.md`](runbooks.md) §16). **`./secrets/` is `.gitignore`d**, which is what keeps the
credentials uncommittable from a checkout that has to hold them.

**nginx's configuration is mounted as directories, never as a file**. A bind-mounted file
stays the inode it was created with, and a `git pull` writes a changed file as a new one, so a
container mounting the file keeps reading the old one and a reload applies it again. A directory
mount shows what the checkout holds, and the reload `deploy.sh` sends applies it with no restart.
Recreating nginx on every change to its files would apply it too, while refusing connections and
dropping the requests in flight for the length of a start, which a reload leaves the old workers to
finish.

**Every file under `nginx/prod/` and `nginx/shared/` is one nginx loads.** The deploy compares
each with what nginx holds in memory, so a file nothing includes, a README among them, reads as
absent and fails every deploy (`scripts/ops/deploy.sh :: EDGE_CONFIG_DIRS`).

**nginx also takes a tmpfs at `/run/nginx-control`, mode 700**, where it opens the Control API
the deploy reloads through (`docker-compose.yml :: nginx`, `scripts/ops/deploy.sh ::
EDGE_CONTROL_SOCKET`). A tmpfs because a master killed outright leaves its socket behind and the
next start refuses to bind it; mode 700 because Docker's default, 1777, lets every user in the
container into the directory. `scripts/checks/check_compose_model.py :: control_socket` holds
both, and `nginx/edge_test.sh` reads the mode off a running edge.

**The Control API needs nginx 1.31.5 or newer** (nginx's `CHANGES` and command-line page, read
2026-09-24), and an older release refuses the `-l` switch and never starts. So
`docker-compose.yml :: nginx` names an exact release rather than the minor, with its digest (§1.1): the
release is what an update is compared against, and it must stay at 1.31.5 or newer.
`scripts/tests/test_image_pins.py` holds the tag's release to that floor, which fails the scripts
scope. The tag is a label the digest is not checked against (§1.1), so the ops scope's
`nginx/edge_test.sh` starts the pinned image with the `-l` switch too, and a digest below the floor
never publishes its port, which ends that scope refused.

### 1.3 nginx routing

Longest-prefix match. Order in the file is irrelevant; specificity decides.

| Location                              | Upstream        | Notes                                                                                                                                                                                                    |
| ------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/auth`                           | `frontend:3000` | Every path the sign-in library mounts, the passkey ceremony among them, metered on `authapi`/`authapi48` — a PREFIX, so no trailing-slash twin                                                           |
| `= /api/client-error`                 | `frontend:3000` | Next route handler, paired `limit_req` — `zone=clienterr burst=3` and `zone=clienterr48 burst=30` ([`docs/logging/overview.md`](../logging/overview.md))                                                 |
| `= /api/bewerbung`                    | `frontend:3000` | Next route handler, the public application form's submit — paired `limit_req` `zone=bewerbung burst=2` and `zone=bewerbung48 burst=20`, and `client_max_body_size 64k` overriding the server block's     |
| `= /api/bewerbung/kuerzel`            | `frontend:3000` | Next route handler, that form's Kürzel check — paired `limit_req` `zone=kuerzel burst=10` and `zone=kuerzel48 burst=100`                                                                                 |
| `= /api/bestaetigung/kontakt`         | `frontend:3000` | Next route handler, the contact person's confirmation — paired `limit_req` `zone=bestaetigung burst=3` and `zone=bestaetigung48 burst=30`, and `client_max_body_size 8k`                                 |
| `= /api/signin/code`                  | `frontend:3000` | Next route handler, the typed sign-in code's check — paired `limit_req` `zone=bestaetigung burst=3` and `zone=bestaetigung48 burst=30`, and `client_max_body_size 8k`                                    |
| `= /api/signout`                      | `frontend:3000` | Next route handler, the sign-out — the code check's `limit_req` pair and `client_max_body_size 8k`                                                                                                       |
| `= /api/registrierung`                | `frontend:3000` | Next route handler, a pupil's registration through their team's invite — paired `limit_req` `zone=registrierung burst=40` and `zone=registrierung48 burst=400`, and `client_max_body_size 8k`            |
| `= /api/bestaetigung/spieler`         | `frontend:3000` | Next route handler, the pupil's confirmation — paired `limit_req` `zone=spielerlink burst=40` and `zone=spielerlink48 burst=400`, and `client_max_body_size 8k`                                          |
| `= /api/bestaetigung/schiedsrichter`  | `frontend:3000` | Next route handler, the referee's confirmation link — paired `limit_req` `zone=bestaetigung burst=3` and `zone=bestaetigung48 burst=30`, and `client_max_body_size 8k`                                   |
| `= /api/bestaetigung/adresse`         | `frontend:3000` | Next route handler, both mailboxes' links of an address change — paired `limit_req` `zone=bestaetigung burst=3` and `zone=bestaetigung48 burst=30`, never `spielerlink`'s, and `client_max_body_size 8k` |
| `= /api/bestaetigung/spiel`           | `frontend:3000` | Next route handler, a club's answer to a fixture confirmation link — paired `limit_req` `zone=spielbestaetigung burst=10` and `zone=spielbestaetigung48 burst=100`, and `client_max_body_size 8k`        |
| `= /api/mail/zustellung`              | `frontend:3000` | Next route handler, the mail provider's delivery webhook — paired `limit_req` `zone=zustellung burst=300` and `zone=zustellung48 burst=3000`, and `client_max_body_size 8k`                              |
| the `/` twins                         | `frontend:3000` | Each metered exact-match path above has a trailing-slash twin carrying its canonical's zones, and its body cap where the canonical sets one                                                              |
| `= /api/revalidate` and its `/` twin  | none            | Answered `404` at the edge: the league caches' invalidation, a Next route handler this server alone calls over loopback                                                                                  |
| `= /api/v0/system/is_live`            | `backend:8000`  | The liveness probe, and the only backend endpoint the edge exposes — `Cache-Control: no-store` (§3)                                                                                                      |
| `= /signin`                           | `frontend:3000` | Paired `limit_req` — `zone=signin burst=3` and `zone=signin48 burst=30`                                                                                                                                  |
| `/_next/static/`                      | `frontend:3000` | `Cache-Control: public, max-age=31536000, immutable`, and the server-action pair, which meters no GET                                                                                                    |
| `/bestaetigung/`                      | `frontend:3000` | Every link page under it, a PREFIX: paired `limit_req` `zone=linkseite burst=60` and `zone=linkseite48 burst=600` on every request, beside `/`'s ceiling and action pair                                 |
| `= /registrierung` and `= /loeschung` | `frontend:3000` | The two link pages outside that segment, a team's invite and the deletion link: `/bestaetigung/`'s lines, each with its twin                                                                             |
| `/`                                   | `frontend:3000` | Catch-all — `limit_conn conn 50`, and the server-action pair, which meters nothing else                                                                                                                  |

**The edge reaches each upstream by its service name as it serves, never by an address read at
load**. A container compose recreates or starts again comes back under its name at another
address, and nginx asks Docker's embedded DNS again once its cached answer lapses
(`nginx/shared/http.conf :: resolver`), so a restart outside a deploy needs no reload. Until that
answer lapses, a worker that cached the old address still sends requests there, and each waits out
nginx's connect timeout and answers 504 (measured 2026-10-18 on Docker Desktop's engine).

**Every `/api/...` path but the liveness probe and the refused invalidation reaches Next** — some
through a block naming it, the rest through the catch-all, which answers Next's HTML 404 where
nothing routes the path (§3). The
liveness location is exact-match precisely so that nothing can join it there; nothing in the
application meets that 404, every application read of the API being a server-side fetch to `API_URL`
([`../frontend/overview.md`](../frontend/overview.md)), so a browser or anything off this host is
what meets it.

**Every route handler in the App Router tree is accounted for against these locations, public or
not**: an exact-match location carrying `limit_req`, a prefix location covering it with a reason
recorded at `scripts/checks/check_public_routes.py :: REASONS`, `/api/auth` for the sign-in
library's catch-all, or, for a handler `scripts/checks/check_public_routes.py :: INTERNAL` records
as this server's alone, an exact match and its twin refusing it with a bare client error. **That
row and the refusal hold each other**: a recorded handler some location forwards is a finding, and
so is a refused one no row records, a public route refused by mistake answering every visitor 404.
`nginx/edge_test.sh` posts each refused path as its caller would, under a double slash, a dot
segment, a percent-encoded letter and a query, and fails any that reaches Next. **A handler under a dynamic segment is unmeterable unless a prefix covers it**, an exact match being unable to name the
URLs a catch-all answers. The accounting is total rather than aimed at the public handlers alone because no predicate
selects those: `fl_frontend/src/app/api/client-error/route.ts` is public and does not go through
`fl_frontend/src/shared/utils/publicRoute.ts :: handlePublicRequest`. A
recorded reason covering no handler is a finding, as is a metered exact match standing without its
trailing-slash twin, and a location construct the checker cannot place refuses rather than reading
as coverage — a path two exact matches declare included, which nginx refuses outright and which
would otherwise leave one of the two standing for both. A named location an `error_page` of the same
level sends to answers no request URI, so it is read as no route; one nothing sends to refuses, and so
does an `error_page` naming a location nobody declares. **An exact-match location names something
this repository answers or it is a finding too**: a route handler's URL, a page's, a metadata
convention's, or a path recorded at `scripts/checks/check_public_routes.py :: ELSEWHERE`, which the
liveness probe is the one entry of — a block the walk cannot place otherwise outlives the file that
answered it, still metering a URL nothing serves. **That recorded path rots both ways** and either
is a finding: it is named by no exact-match location, or a file in the tree has started answering
it, so the row records what the accounting already reads. Pages are read for that direction and
for the link pages' pair below, and a dynamic segment at the top level excuses nothing: its static
head is the root, which would cover every exact match there is.

**Next's code-generated metadata conventions are accounted for beside the handlers and taken
unmetered**: `/sitemap.xml`, `/robots.txt` and `/manifest.webmanifest` reach Next through the
catch-all, and each exports a function reading no request and no live value, so Next prerenders it
and a flood costs a static response rather than a render or a backend call. That decision is
recorded at `scripts/checks/check_public_routes.py :: METADATA`; a reserved metadata name the
checker cannot place refuses, the image conventions among them, whose generated URL carries a hash
Next mints at build.

**Exact-match binds the path nginx matched, not the URI FastAPI is handed**: nginx merges slashes
and resolves dot segments before choosing a location, then `proxy_pass` with no URI part forwards
the request line as written, so `/api/v0//system/is_live` is answered by FastAPI's own
`{"detail":"Not Found"}` rather than by Next (measured 2026-08-28). No further route opens up — a
URI this block matches decodes either to the probe or to nothing — but the error body fingerprints
the framework the origin runs.

**`$remote_addr` is the visitor rather than the tunnel's connector**, and every zone keys on what
that rewrite produced (`nginx/shared/http.conf :: real_ip_header`, `:: set_real_ip_from`); the access line
records it ([`docs/logging/overview.md`](../logging/overview.md)). **The trusted set is one address,
the connector's, on both edges** — nothing else reaches this origin (§1.1) — which is what
Cloudflare's published ranges could never be, being every customer's egress rather than this
account's; the local edge serves the same set, inert with no connector in front of it. **A
fallback to the connector's own address is marked rather than silent**: the access line carries
`realip_fallback`, `1` where the rewrite did not take (each case measured 2026-08-31 against a
running nginx: recovered `0`, absent `1`, malformed `1`). The marker costs a second copy of that
address in `nginx/shared/http.conf`, the `geo` beside `set_real_ip_from`, and the two change together.

**A zone keyed on the POST map limits no GET on its path** — an empty key is exempt from
`limit_req` — so every zone over `$signin_limit_key` or `$signin_limit_key48` reaches POSTs alone.
**The zones over a GET key on the network maps unconditionally**: the Kürzel check, the pair
under `/api/auth` and the link pages' pair would otherwise read as limited and be unlimited.

**Underneath both, the key is a NETWORK rather than an address, and there are two of them** —
`nginx/shared/http.conf :: map $remote_addr $client_net` for the /64 and `:: map $remote_addr
$client_net48` for the /48, the whole address on IPv4 either way. A /56 key is not expressible from
these strings at all, nginx stripping a group's leading zeros.

**Both maps were verified against a RUNNING nginx** — their bodies extracted into a throwaway
`nginx:1.31-alpine` answering with what it rendered, driven across every zero/non-zero group
pattern and address class: no prefix split across two keys, no two prefixes shared one, no address
reached the fail-open `default`, and no two addresses shared a /64 while differing in /48 (measured
2026-08-30), and both edges serve the one copy in `nginx/shared/http.conf`.

**Both zones are repeated inside every limited location rather than declared once at server
level**: nginx inherits `limit_req` only where the level declares none — the
replace-rather-than-extend rule `add_header` follows (§1.4), reaching a third directive.
`limit_conn` inherits the same way, and `location /` and the link pages' blocks alone declare it.

**Each metered path has a trailing-slash twin carrying the same zones.** An exact match is exact,
so the slashed form fell to the catch-all and reached Next unmetered before the twins existed. Next
answers it with a 308 and no handler runs, so the twins change nothing a visitor sees; they proxy
rather than `return 308`, which would be nginx deciding a trailing-slash policy that is Next's.
Percent-encoded, double-slash and dot-segment forms need no twin: nginx decodes, merges and
resolves each before matching, all three measured reaching their zone (measured 2026-08-30).

**Each pair is one narrow zone and one wide one, the wide at ten times the rate and the burst**, and
the pairs are held apart per unit of WORK rather than pooled — two paths reaching the same work
share one pair. `bewerbung48` is the one deliberate exception to the multiplier, and it is on the
RATE alone: three times rather than ten, on a count of applications per season rather than a ratio.
What decides that number, and what it risks, is at the zone in `nginx/shared/http.conf`.

**`location /` takes a connection ceiling rather than a rate zone keyed on every request**,
`limit_conn conn 50` on the narrow key, sized for HTTP/2 where nginx counts each concurrent request
as a connection. **Its one rate zone pair keys on server actions alone**, `action`/`action48` over
`nginx/shared/http.conf :: $action_limit_key`: a POST carrying a `Next-Action` header or either
form content type, which is every post Next 16.4.2 runs as an action. Next takes an empty header for
an action too, which nginx cannot tell from none, so the edge passes the header only where it holds
a value (`nginx/shared/site.conf :: Next-Action`). Every other request's key is
empty, so no page load or asset is metered by it; the pair is rated above any administrator's run of
saves. `/_next/static/` carries it too, where a POST reaches no action (a 405 whose render fails as
a 500, driven against Next 16.3.6 on 2026-09-27) but costs that render. **That
makes one directive count differently on the two stacks**: `nginx/local/local.conf` serves HTTP/1.1, so
the one line in `nginx/shared/site.conf` bounds whole connections locally.

**Every page a mailed or shared link opens, its token in the query, is metered on every request
and every method**, on `linkseite`/`linkseite48`: each GET renders a page reading the database,
through the backend or the sign-in store, so one network reloading a link page spends database
operations the whole league shares. No page links to one, so a visit is one request rather than a
navigation's fan-out, which is what a zone at `location /` would refuse. **`/bestaetigung/` is a
prefix because every page under it is a link page**, so a page added there is metered the day it
exists; a link page added anywhere else needs an exact match and its twin, as `/registrierung` and
`/loeschung` have. **`scripts/checks/check_public_routes.py :: LINK_ZONES` holds every link page to a
location naming that pair, at its URL and at its twin's, each zone on one `limit_req` line in every
block naming it**: a link page is one whose own module reads `token` from its search parameters, or
one a module under `fl_frontend/src` mints a `?token=` link to, so a page reading the token through
another module is found by its minter, and a `?token=` the checker cannot place refuses the run. Each block restates
`location /`'s ceiling and action pair, sets `$linkseite`, and declares no `proxy_set_header`,
`add_header` or `error_page`, each of which would replace an inherited set. `nginx/edge_test.sh` floods one link
page past the burst, then fails any link page, twin, double slash, dot segment, percent-encoded
letter, `HEAD` or JSON post that is not refused with the edge's own `429`, any refused load of a
link page not answered with the edge's page, and any link block whose action pair lets a server
action past the action burst or answers it otherwise than with the sentence.

**A body cap below the server block's `20M` is set at the location it bounds.** The application
form's `64k` cap alone is measured, 2026-08-30: a 100,049-byte POST is refused `413` at the edge,
while a 4,049-byte POST reaches the handler.

**A zone has been observed refusing, and what that establishes is the MECHANISM, not the numbers.**
A burst at the Kürzel check was refused past the burst as `429` (not nginx's `503` default), the
`fl_json` line carrying `"status":429` with an empty `upstream_duration_s` and the headers on the
refusal being what `nginx/edge_test.sh` observes. No rate here is measured — the figures remain judgement calls, and
the `limit_conn` figure is derived from HTTP/2 semantics and never exercised (measured 2026-08-30).

**Every `429` the edge answers itself is one ASCII sentence under exactly `Content-Type: text/plain`,
but a link page's load**, the server block's `error_page 429` sending a zone's refusal and the
connection ceiling's alike to `nginx/shared/site.conf :: @edge_refusal`. A `GET` or `HEAD` of a
link page goes to `:: @edge_refusal_seite` instead (`nginx/shared/http.conf :: $edge_refusal_ziel`):
a branded page with its way back to the site, since a sentence alone, opened from a mail, is a dead
end. The page is written inline in the configuration, because the deploy compares every file under
`nginx/shared/` with what nginx loaded (§1.2) and a page nginx never loads would fail every deploy;
it withholds the referrer, as every link page does, since its URL carries the link's token; and its
colours are the season scheme's, copied by hand. Next 16.4.2 hands a server action's caller the body of a
failed answer that is not RSC as the error's message under that exact type alone, and the frontend
reads that message as a press that wrote nothing. A `charset` makes the header
`text/plain; charset=utf-8`, after which every refused press reads as an unclear save again. A route
handler's caller reads the status alone, and a page load past the connection ceiling shows the
sentence, a link page's the page. `nginx/edge_test.sh` grades a refused action's type, its body byte for byte against the
file, and its security headers, asked with and without `Accept-Encoding: gzip`: nginx's gzip filter
compresses a `200`, `403` or `404` alone, so the `429` leaves the origin plain either way. It
grades a link page's refused load the same way against the page, and that page's referrer tag and its
colours against the scheme `fl_frontend/src/app/globals.css` imports, which a comparison with the
file it was read off cannot hold.

**A refusal writes no record to the error log**, `limit_req_log_level` and `limit_conn_log_level`
both sitting below that log's own level. nginx puts the request line there WHOLE, query string and
`Referer` with it, and no `map` reaches that log — the open-source build has no option over what a
line carries, `error_log`'s `json` and `error_log_tag` being commercial-only
([`docs/logging/overview.md`](../logging/overview.md)). Both records were driven against
`nginx:1.31-alpine` and read back, 2026-09-21. Every minted link's live token travels in the
query of a link page, where a refusal is routine, so this level is what keeps those tokens out of
that log; `nginx/edge_test.sh` fails a token found there after a run of refused link pages. **What the pair does not close is every OTHER line about a request, at any level**, an
upstream failure among them, which repeats the same request line
([`docs/logging/overview.md`](../logging/overview.md)); and what it costs a reader is the name of the
zone that refused, the access line carrying `status` alone.

**The liveness location carries no `limit_req` zone, and that is a decision rather than an
omission**: a zone would throttle the uptime monitor the path is published for (§3) before it
throttled anything else.

**The www block over HTTPS is not redundant with the port-80 redirect**: HSTS carries
`includeSubDomains`, so a browser that has visited once never issues the plaintext request the
port-80 block would have caught — without the block that request has its handshake rejected,
observed 2026-08-01 as a public `525`. **A Cloudflare proxy sits in front of nginx** (see the
[overview](overview.md)), so an origin-side failure can surface as a Cloudflare status code that
names neither nginx nor the block responsible.

**A rule at that proxy may challenge a top-level navigation and never a server action's POST**: a navigation renders the interstitial, where a background POST can render nothing and is
answered with markup the caller cannot read. **No rule checks the POST behind a challenged page**, so
the clearance a navigation earns protects none of the writes there; the bot check judged on the
server at the submit does.
A Next server action is a `fetch()` POST carrying a `Next-Action` header, and a `fetch()` renders no
interstitial: the challenge's HTML reaches React where a Flight stream was expected, and the throw
lands on the error boundary before any application code runs. A page arrives through `location /`
unless a location names it, as `= /signin` and the link pages' blocks do, and the browser posts an
action to the address of the page it is on, so the sign-in form's own POST lands on `= /signin`.
**What that zone bounds is the PATH and never the action**: a server action resolves from a
process-wide module map with no reference to the address it was posted to, so the same action posted
to any other page reaches it, metered there by the server-action pair above and on a link page by
the link pages' pair besides (`fl_frontend/src/features/auth/actions.ts :: handleSignIn`). **A rate limit is the edge
control that fits**, because a status code is an answer the caller can read; `limit_req` on these
paths is that control at the origin.

**A `location` declaring any `proxy_set_header` REPLACES that whole inherited set rather than
extending it** — the mechanism `add_header` follows, and what decides which of the two
edge-controlled headers, `traceparent` and `X-FL-Actor`, reaches an upstream
([`docs/logging/overview.md`](../logging/overview.md)). The liveness location restates the set in full
so that FastAPI is addressed as the upstream `proxy_pass` names and the public hostname needs no
place in `api_trusted_hosts`. It is the only location declaring one, and
`nginx/edge_test.sh` fails any location proxying to the frontend that hands Next either header as
a visitor sent it.

### 1.4 Security headers

Every response carries five, each sent with `always`:

- `Strict-Transport-Security`
- `X-Frame-Options`
- `X-Content-Type-Options`
- `Referrer-Policy`
- `Content-Security-Policy`

**The one enforced policy keeps `'unsafe-inline'` on `script-src`, because Next cannot put a nonce
or a hash on the inline hydration scripts of a prerendered shell**, and every page here is one
(`cacheComponents` in `fl_frontend/next.config.ts`). Next's guide calls Partial Prerendering, which
`cacheComponents` turns on, "incompatible" with a nonce-based CSP, and its experimental SRI puts
`integrity` on script files alone — the installed release's copy,
`fl_frontend/node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`, and a Next
maintainer's open correction to it, <https://github.com/vercel/next.js/pull/96281>, both read
2026-09-25 and moving without us. A nonce for the stream beside build-time hashes for the shell and
`'self'` for its chunks would cover every script, and is refused: three mechanisms is a patchwork
rather than a rule. The compensating control is the `react/no-danger` rule in
`fl_frontend/eslint.config.mjs`, which keeps every HTML sink out of the
application. **Revisit when the application renders user-supplied markup, or when Next ships
inline-script hashing that covers prerendered shells** — and at the first, reconsider the policy,
never the lint rule.

`style-src` carries it for a narrower reason: several components set a runtime-computed inline
`style` **attribute**, for which CSP offers no nonce or hash. Narrowing to `style-src 'self'` with
`style-src-attr 'unsafe-inline'` would cover those and stop admitting an injected `<style>`
element, and what it costs is Next's own `_global-error` fallback, the one prerendered page here
carrying an inline `<style>` — a directive on attributes does not reach an element, so that page
would render unstyled. Every route this application declares carries none.
[Issue #239](https://github.com/felzab/frankfurtleague/issues/239) owns the decision.

**The policy is written once**, in `nginx/shared/security_headers.conf`, which
`nginx/shared/site.conf` includes at server level and again in each location adding a header of
its own, because `add_header` in a location replaces the inherited set, and which
`nginx/prod/prod.conf`'s www redirect includes too. `nginx/edge_test.sh` asks every location and the
www redirect for it, and compares each header's value with that file's. A
restated copy would be a second enforcing policy, which the
`.claude/rules/cross-surface.md` **csp** clause forbids.

**Cloudflare's `https://challenges.cloudflare.com` stands in `script-src` and in `frame-src`, and in
no other directive**: the bot check on the sign-in and the two public forms loads its script from
there and renders its widget in a frame of that origin, so a policy losing it from either breaks all
three while every location still sends the file's value. `nginx/edge_test.sh` fails a response
whose policy does. Cloudflare's own list for the check adds `connect-src 'self'` for pre-clearance
alone, which the widget does not use (<https://developers.cloudflare.com/turnstile/reference/content-security-policy/>,
read 2026-10-04).

**The rest of the policy is load-bearing and does not depend on `script-src`:** `frame-ancestors
'none'` blocks framing, `object-src 'none'` blocks plugin content, `base-uri 'self'` blocks base-tag
hijacking, and `form-action 'self'` blocks exfiltration through a form post.

### 1.5 The scripts

`scripts/README.md` navigates the folder; each script's own header carries its usage and prints it
with `--help`. What spans the scripts lives here.

| Environment | What it is                                            | Database                                                                       | Entry point                                                                                             |
| ----------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| **dev**     | source with hot reload, no Docker                     | the one the URI files under `secrets/` name ([`runbooks.md`](runbooks.md) §16) | `pnpm dev` in `fl_frontend/` · `SECRETS_DIR=../secrets uv run fastapi dev app/asgi.py` in `fl_backend/` |
| **local**   | the production image built from your tree, with nginx | its own, inside the stack (`docker-compose.local.yml :: mongo`)                | `./scripts/ops/local.sh`                                                                                |
| **e2e**     | the local stack again, for the Playwright journeys    | its own, with the made-up seed, new on every start (`docker-compose.e2e.yml`)  | `./scripts/ops/local.sh --e2e`                                                                          |
| **prod**    | published images on the server, never builds          | the managed cluster                                                            | `./scripts/ops/deploy.sh`                                                                               |

**local** is the only place a packaging problem — a missing standalone file, a failing startup env
gate, a header nginx does not set — is visible before a deploy: **dev** exercises none of that
machinery, and **prod** only pulls. Machine-specific scripts will not start on the wrong
platform.

**Each application service reads its own package's `.env` and no other**: every credential
is a file under `secrets/` (§1.2), so the two services share no name an environment file could hold.
**A `.env` beside the compose file is compose's own**, read for interpolation, for a bare
pass-through's value and for compose's `COMPOSE_*` settings, and nothing in this repository writes
or reads one: a line there steers compose itself, a project name aiming every command at another
stack. **The deploy and the local stack refuse to start while one stands there**, naming the file
and printing none of it, since git ignores it and
nothing else shows it. Pinning the project name on each call is no substitute: it answers the name
alone, the file's other settings and pass-through values still reaching compose. **The frontend's `dev` script sets two names of
its own** before `next dev` starts, over the shell and `fl_frontend/.env`: `ACTOR_SIGNING_KEY_FILE`
to the checkout's `secrets/fl_actor_signing_key` and `SECRETS_DIR` to the checkout's `secrets/`,
because `fl_frontend/.env` also reaches the frontend container, where a path written there would
turn the frontend away from the secret's mount and its boot refuses.

**A line naming a value `secrets/` holds, or the retired administrator list `ALLOWED_ADMIN_EMAILS`,
refuses a deploy or a local start before its first compose call**, at exit 2, finding each
such line in any letter case and any form compose reads a name in — `NAME=value`, the YAML-style
`NAME: value` and a bare pass-through name — and giving it by number and the list's own spelling
of the name, never the line's and never its value: compose would hand it to the
container as a variable, which `docker inspect` prints. `deploy.sh --status` and
`local.sh --down` create no container and ask compose without it. This check is the only one such a
line meets: the deploy stops here before the pulled images' own name checks run, and the local stack
runs neither. Each machine holds its own files and keys: they
authenticate one machine's processes to each other, so a development machine generates fresh ones
rather than copying production's ([`runbooks.md`](runbooks.md) §16).

**A key is printable ASCII without the space**: `secrets.compare_digest` raises on anything
else, so a key outside the class would boot and then answer every internal request 500. Its file is
its only reader, which parses no env-file syntax, so `"`, `#`, `$`, `'`, `\` and the backtick are
part of the class. **A build from before the class took those six refuses a key carrying one**, so
such a key also refuses the boot of an older image the automatic rollback restores; a key from
`openssl rand -hex 32`, as [`runbooks.md`](runbooks.md) §16 generates one, carries none of them and
is one every build takes. **The deploy's
preflight judges a key with the pulled backend image's own validator**, in the backend's container, so a key outside the class refuses the deploy at exit 2 before anything is recreated; the
remedy is a new key ([`runbooks.md`](runbooks.md) §16).

**Every line of both packages' `.env` files is blank, a comment opening with `#`, or `NAME=VALUE`
with nothing around the `=` and a value drawn from RFC 3986's URL characters less `#`, `$` and `'`**
(`scripts/lib/_lib.sh :: ENV_LINE_RE`), or a deploy, its `--check-env` and a local start
refuse at exit 2 before their first compose call. Compose, python-dotenv, `@next/env` and
`node:util :: parseEnv` each read such a line literally, and the set holds a spelling of every value
the two settings schemas declare: a list joined without spaces, a path without one, a URL in ASCII
writing `#`, `$` and `'` percent-encoded. Every other form is refused: several are read apart — an
unclosed quote, a quoted escape, `NAME:`, a byte-order mark, an unspaced `#`, a `$` — and the rest so
the check holds one shape rather than a parser chasing each reader's quirks. **No line, a comment
included, holds a carriage return before its end, U+2028, U+2029 or a NUL byte**: python-dotenv
ends a line at the carriage return and `@next/env` at all three, so a comment carrying one declares
a name for them and none for compose, and the shell's own reader drops a NUL unseen. **No refusal
over these files prints anything a line holds**: a pasted key's line may be any shape, an
upper-case `NAME=` or `NAME:` included, so each refused line is given by file and number alone, and
a name is printed only as a settings schema or the credential list spells it — this one, the
credential check and either image's name check alike. The credential check runs first and reads a name in
every form compose does, so a credential's line is refused as a line to delete before this
check would have it rewritten; the two run as one, `scripts/lib/_lib.sh :: judge_env_files`.
**`./scripts/ops/deploy.sh --check-env` runs every check the deploy makes of these files without
Docker** — compose's own `.env`, the credential lines and this shape — after the platform
check and before the daemon is asked anything, ending 0 where none refuses.

**The local stack points both application services at its own database through one inline
config**, `docker-compose.local.yml :: local_mongodb_uri`, mounted where each reads its login: it
names the stack's `mongo` service and holds no credential, so no machine needs a login to run it and
no run is left aimed at the wrong cluster.
The same override sets `BEWERBUNG_SWEEP` and `KONTO_SWEEP` off and `APP_ENV` to `local`, and hands
the frontend no key to the mail provider. The database is a copy of production, so
an armed pass here deletes real applications and stamps real rows, and an armed account sweep
deletes every account signed in here that no record references; `APP_ENV` is what keeps the
notices it raises off the people those rows name, each landing in the sink instead but one to an
address the ban list holds, which is filed nowhere. One checked-in line is what a developer
flips to exercise the sweep (§1.1). **Every start empties the sink of what earlier runs filed**, so
no code there reads as current that is not (`scripts/ops/local.sh :: empty_mail_sink`): the
directory is compose's own bind source for the frontend's sink, refused outside the checkout, and
only a name the sink writes is removed.

**`./scripts/ops/local.sh --seed` fills it from production with a read-only login**, whose URI is
the machine's `secrets/dump_mongodb_uri` and which reads the application database and nothing else:
**no development machine holds production's write login.** Of the two containers only one is
handed that file — a discipline rather than a boundary, its costs written at
`scripts/ops/local.sh :: take_dump`. A copy already on disk is reused however old it is,
`--refresh-db` takes a new one and `--fresh` deletes the volume. The copy lands in `.local-db/`,
which `.gitignore` and `.prettierignore` both cover because it is real data and this repository is
public.

**`./scripts/ops/local.sh --seed-made-up` fills it with the made-up league instead**
(`scripts/ops/seed/seed.js`): two seasons, eight clubs, venues, referees and grants, every one
invented and every date relative to today, replacing the records of every collection of the
application database and leaving `auth` as it is. It needs no login and reads nothing of production's.

**A seed is in place before anything renders a page**, so no empty read is cached for the days the
reference reads hold a value. The copy is restored before the application services exist. The
made-up seed is loaded after the backend's boot has given every collection its validator, so each
insert is judged as it lands, and `python -m app.core.constraints --check` then judges the whole;
only then do the frontend and nginx start, the backend recreated with them.

**`./scripts/ops/local.sh --e2e` starts the end-to-end stack instead** (`docker-compose.e2e.yml`,
merged over the local stack's two files): a compose project of its own, `frankfurtleague-e2e`, so
its volume and with it its sign-in store are never the local stack's; its settings written in that
file rather than read from either package's `.env`; its keys generated under `.tmp-e2e/` on every
start rather than read from `secrets/`; and the made-up seed on an empty volume every start.
`--e2e --down` deletes the volume and `.tmp-e2e/`. **Either start refuses while another stack's
container publishes port 3000 or 27017**, which both publish
(`scripts/ops/local.sh :: refuse_another_stack_on_the_ports`). The journeys run against it from
`fl_frontend` with `pnpm exec playwright test` (`fl_frontend/playwright.config.ts`).

**The copy is the application database and not the sign-in store beside it** — the backend's
credential is scoped to one database (the two-users split in [`overview.md`](overview.md)), so the
local stack starts with an empty `auth` and a sign-in builds it; the grants deciding
which administrator may sign in, and which the backend admits, arrive with the copy
(`berechtigungen`), so a `--fresh` stack admits nobody until one is written, and anybody else is
offered a sign-in only where the local backend holds records for their address (`fl_frontend/src/core/signInGate.ts :: mayReceiveSignIn`). **A sign-in alone does not reach
`/bereich/admin` there**: the code stamps its session `code` where the admin guard wants `passkey`
(`fl_frontend/src/core/auth.ts :: isAdminSession`), so `/signin/passkey` offers an enrolment first —
bound to this machine's own authenticator and to `localhost`, the relying party the local `AUTH_URL`
gives. Every machine, and every `--fresh`, enrols again. A second passkey is added from the
sidemenu's options menu rather than from `/signin/passkey`, and adding or removing one asks for a
passkey the machine already holds.

**The production tier's limitations shape that command**, and they are the fastest-rotting fact on
this page: read from MongoDB's Atlas Flex limitations documentation, 2026-08-27. What each denial
costs the command is written at `scripts/ops/local.sh :: take_dump`; the copy carries no users or
roles, is taken one collection at a time against the tier's rate cap, and is consistent per
collection rather than at one instant. Two things fix the local image's major version — that tier's
MongoDB floor, and the tag the db tier runs against
(`fl_backend/tests/conftest.py :: mongo_replica_set_url`) — and mongorestore refuses a dump whose
source carries a different one.

**`deploy.sh` reads the server's Docker Engine version in preflight, before it stops or pulls
anything**, the compose files' `start_interval` being what needs it
(`scripts/ops/deploy.sh :: ENGINE_MIN`). **It then asks the pulled backend image to read
`fl_backend/.env`**, which is the only place the file is read as a file rather than handed to a
container as variables (`scripts/ops/deploy.sh :: check_env_names`): it is mounted read-only into a
throwaway container with no network, as the whole of what compose hands the service. A name the
backend does not declare, a value it will not accept and a required variable the file omits all
refuse the deploy at exit 2 with nothing recreated, and a check that could not be made is an
advisory ([`runbooks.md`](runbooks.md) §1). Either image's refusal keeps one
rule: an undeclared name goes by the number of each line declaring it, with a count
(`fl_backend/app/core/config.py :: read_environment`,
`fl_frontend/scripts/check-environment-names.mjs :: undeclaredLines`).

**The pulled frontend image is asked the same of `fl_frontend/.env`, and answers about names
alone**
(`scripts/ops/deploy.sh :: check_frontend_env_names`): the image carries the schema's key sets
rather than the schema, emitted at build from
`fl_frontend/src/core/config.ts :: DECLARED_ENVIRONMENT_NAMES` and `:: REQUIRED_ENVIRONMENT_NAMES`,
so a name it does not declare, by line number, and a required name the file omits each refuse at exit 2
with nothing recreated while every value, an empty one included, stays the boot gate's. **The omitted half is the one
no reader over the file's own names can reach**: an undeclared line is one somebody wrote, a missing
one is a line nobody did, so without it a release that makes a new name required deploys green and
the recreated container refuses to boot behind an edge already answering 502. **What
`APP_ENV=production` alone demands is a file and never a variable**
(`fl_frontend/src/core/config.ts :: PRODUCTION_ONLY_REQUIRED`), since a reader would have to open a
value to decide: the mail provider's sending key, its webhook's signing key and the bot check's
secret, which the frontend's boot demands on the deploy, held to `production` below, and never on
the local stack, which sends no mail, is sent no event, and verifies the bot check with Cloudflare's
published test secret. **A bare
pass-through `KEY` would satisfy no required name**: compose resolves that form's
value from the shell that ran it, and failing that from compose's own `.env` beside the compose
file (Docker's environment-variable precedence table, rows 8 and 9, read 2026-09-27). A deploy's
shell holds none and the server's checkout carries no such file, so a pass-through there is never
resolved and is dropped from the container's environment altogether —
which is worse than the empty value, arriving as an empty string; `scripts/lib/_lib.sh :: check_env_spellings` refuses the line before this
reader runs. **3 is each reader's own answer
for a refusal, and the one code each of the three arms grades as one**; the deploy's own exit is
§1.7's 2, and a reader ending any other way leaves the deploy where it stood. Its reader takes
the lines `check_env_spellings` admits and no other (`fl_frontend/scripts/check-environment-names.mjs :: STRICT_LINE`, held to
`scripts/lib/_lib.sh :: ENV_LINE_RE` line for line by `scripts/tests/test_deploy_streams.py`), and
**an unreadable line is an advisory rather than a refusal**, the names it did read being a guess
about the rest.

**The declared set is the whole of what the undeclared half judges**, and not what the container
looks up: Node and Next read `TZ`, `NODE_OPTIONS`, `PORT` and `HOSTNAME` of their own, and
`fl_frontend/src/core/config.ts` reads `SKIP_ENV_VALIDATION`, none of them declared there. So an undeclared name in the file is a line to delete, a spelling to
correct, or a name to declare in the schema — the same three the backend's arm offers for its
settings class.

**What that check accepts is what the container receives.** The preflight parses each package's
file as python-dotenv does, and the running container gets it parsed as Compose does; `check_env_spellings` has
refused, before either runs, every line the two could read apart, so a name and a value the
preflight accepted are the ones the container will see. Compose cuts an unquoted value at its
line's end and at a spaced `#`, trims trailing space and substitutes at a `$` alone, none of which
an admitted line holds (compose-go v2.7.1, the release Docker Compose 2.38 builds on: its dotenv
parser's extractVarValue and its template package, which move without us; read 2026-10-15).

**Each service's own boot then judges its settings and secret files before the recreate**,
in a one-off container `docker compose run` starts as the stack starts the service — its variables,
its mounts, its user and group — and by the image about to run, so a value or a file a release
starts requiring is asked for before the recreate that would meet it. A refusal is 3 from the
container and exit 2 from the script, with nothing recreated; any other ending is an advisory.

- **The frontend's is its boot itself, and no copy of it**
  (`scripts/lib/_lib.sh :: check_frontend_boot_config`): the image's own command, the standalone
  server, started with `BOOT_CHECK` naming the deployment about to start. Next runs the
  instrumentation hook once as the server starts and before it serves; the hook runs every gate a
  serving boot runs — the schema over the variables and the secret files, the signing key — and
  ends on 0, or on 3 at a refusal, its `CRITICAL` line naming the variable, the file or the key's
  path and never a value (`fl_frontend/src/instrumentation-node.ts :: registerOnNode`). A fault of
  the build ends on 1, which is no verdict on the host. `run` publishes no port and no service
  alias, so nothing reaches the server it starts.
- **The boot holds `APP_ENV` to the deployment the script names**, a mismatch refusing `APP_ENV`:
  the schema demands production's own files and refuses the published test keys on that one value,
  so a production host whose file said `local` would otherwise pass holding none of them.
- **The backend's builds its settings as its boot does**
  (`scripts/lib/_lib.sh :: check_backend_boot_config`), so a file it cannot use and a value its
  validators refuse both refuse there, named alike.

**Before either of those reads, and before the pull, compose is asked whether it can parse its own
configuration** (`scripts/ops/deploy.sh :: check_compose_config`): a configuration it cannot read —
an unterminated quote in one of the three environment files is the reachable case — stops the recreate
before a container is touched, so the health read and the rollback behind it fail on that same file
and report a build that broke over a stack nothing stopped. The refusal names the four files and
prints nothing compose itself said: the filter in §1.7 reaches a container's log alone, and a parse
error quotes the line it could not read.

**Before either application image is pulled, the deploy fetches every image the edge runs that the
host lacks** (`scripts/ops/deploy.sh :: fetch_edge_images`), under the `missing` policy `up` itself
applies, so a tag the host holds is never refreshed under a running edge. A failed fetch refuses at
exit 2 with nothing recreated; left to the `up` that reloads nginx, it would arrive once the
application pair was replaced, leaving nginx unreloaded on the configuration it had.

**A pair the deploy refuses leaves the host's `:latest` tags as it found them**: a pinned run moves
them only once `scripts/ops/deploy.sh :: compare_pulled_pair` accepts the pair, and a bare run puts
back what they named before its pull (`:: put_latest_back`), since an `up` reaching the application
recreates it from whatever they name.

**No tag deploys a build from before the frontend's boot check**: its image does not know
`BOOT_CHECK`, so the preflight's one-off frontend would serve rather than end, and the deploy would
wait on it with nothing recreated. Nothing in the script asks an image's age: every such image is
deleted from the registry, so a pin's pull refuses before either tag moves, and the automatic
rollback, which restores the running build by id and runs no preflight, is the one way such a
build is served again ([`runbooks.md`](runbooks.md) §1).

**The checkers are python, and one kernel is what makes their answers comparable** —
`scripts/lib/checker_kernel.py`, whose own header holds the inventory (§1.7). **The interpreter floor
is bash's** (`scripts/lib/_lib.sh :: PYTHON_FLOOR`), asked at every entry point before a checker is
handed a file: below it a checker dies compiling and python exits 1, which this scale reads as a
finding about the change, so no checker's own body is written for an interpreter that cannot compile
it.

**Registry pruning stays manual and optional**, a botched delete destroying rollback history (§4).
When pruning, keep roughly the last five `sha-` tags per package and never delete what is live
(`./scripts/ops/deploy.sh --status`), what `latest` shares a digest with, or an **untagged version
created alongside a tag still in use** — BuildKit provenance attestations the tagged image
references by digest, so deleting one corrupts the tag it belongs to.

**`--status` reads and changes nothing, and it ends green, with findings or refused (§1.7)** —
pruning is decided from what it prints, so which ending it reached is the first thing to read.
**Green is the
only ending a registry may be pruned from**: findings mean something definite is wrong with what is
running, and a refusal means a question the report is built from went unanswered, so the rollback
list it printed may be short by whatever went unread and "never delete what is live" cannot be
applied to it.

**A stopped service is graded as a finding rather than an advisory**, because the edge can still
answer 200 from a worker that outlived it: a green probe over a stopped pair is what a stale nginx
or a stray container looks like, and it is the state that most resembles a healthy one from
outside. **That probe and nginx's own dump of the configuration it holds are the report's two reads
of the edge**, and every other row is read from the application's containers: a healthy pair says
nothing about whether the edge reaches it, nor whether it holds this checkout's files.

**`curl` writing `000`, on the other hand, is an advisory**, because `deploy.sh` runs on the server:
the read is the host asking for its own public hostname, so a host that does not resolve the domain
publicly, or whose network does not route 443 back to it, answers `000` while the site is perfectly
well. The deploy's own probe of the same URL grades it the same way.

### 1.6 The verification gate

`./scripts/gate/verify.sh --help` lists the scopes and their flags; a bare run starts every scope side by
side and replays each one's output in the order below.

**knip runs twice and refuses what nothing reads, then what only tests read**, so what a change
leaves unused is removed in that change rather than found by a later sweep. The default run
(`fl_frontend/knip.json`) refuses a file, an export or a dependency nothing imports, a test
included. The production run (`fl_frontend/knip.production.json`) drops the tests and refuses a
file or an export no production code reads. An export its own module still uses passes there, a
`*Schema` whose inferred type names it among them (§4), and a value a test compares on purpose
carries `@internal`. Each file names, beside each ignore, the reader knip cannot see, and a
configuration hint fails either step as a finding does.

**An editor formats earlier still**: `.vscode/settings.json`
names the module, the configuration and the ignore file the gate itself reads, and a developer
without the extension is held by the format scope and CI alone. `.editorconfig` carries the same
conventions to the files prettier never opens and stays clear of every setting `.prettierrc.json`
decides.

**Every untracked file a run leaves is gitignored where it lands**, the three caches this repository
opts into — `tsc`'s, eslint's and prettier's — among them, so none of it is a tracked file the gate
wrote. **Outside
CI the two Next commands install as well as write**: handed a missing `typescript` or `@types/*`
package, `next typegen` and `next build` add it to `node_modules` rather than failing, where a
runner takes the refusing branch, keyed off Next's own `isCI`.

**One tracked file a gate run writes is not a formatter's doing**: `next typegen` and `next build`
each rewrite `fl_frontend/tsconfig.json` where a `compilerOptions` key is absent (Next's
`writeConfigurationDefaults`), so every reader after typegen measures a config the committed file
does not hold; the frontend job in `.github/workflows/verify.yml` diffs that one path after the
scope and fails on it.

**CI runs every scope on every event**, one parallel job per scope in `.github/workflows/verify.yml`.
**The aggregate `verify` job fails on a failed, cancelled or skipped job**, and on a job missing from
its `needs:`.

**Every CI job that needs the backend virtualenv creates it with `uv sync --locked`**, the dev group
alone where nothing imports the application, on the uv the backend image copies in (§1.1); each
flag's argument is in `.github/actions/backend-toolchain/action.yml`, which every such job calls.

| Scope              | Runs                                                                                                                                                                                                                                                                                                            | Needs                                                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `--scripts`        | `selfcheck.sh`, `ruff` and `pyright` over the python in `scripts/`, and the pytest suite in `scripts/tests/` (§1.5)                                                                                                                                                                                             | the backend venv, `pytest` included; shellcheck and actionlint from PATH, else Docker                                                          |
| `--docs`           | no conflict marker or whitespace error in any tracked file (`git diff --check`); lychee, offline, over every link and fragment inside the repository; `check_public_routes.py`; and `fl_backend/tests/openapi_document.py` in `--check` mode, the published document against the docstrings it is composed from | the backend venv, and Docker for lychee                                                                                                        |
| `--backend`        | `uv lock --check` alone and first, then `ruff`, `pyright`, `pytest` (default tier) and `deptry` over `app/`                                                                                                                                                                                                     | the backend venv, and for the lockfile check a uv inside `fl_backend/pyproject.toml`'s `required-version` range; any other refuses at start-up |
| `--format`         | prettier in check mode over the whole repository, then markdownlint over every Markdown file                                                                                                                                                                                                                    | pnpm install                                                                                                                                   |
| `--frontend-units` | the unit tests `fl_frontend/package.json`'s `test` script finds under `fl_frontend/`                                                                                                                                                                                                                            | pnpm install                                                                                                                                   |
| `--frontend`       | the frozen lockfile, peer and dedupe checks, `next typegen`, tsc, eslint, both knip runs and the dependency audit, then `next build`                                                                                                                                                                            | pnpm install                                                                                                                                   |
| `--ops`            | zizmor audits `.github/`; both stacks parse; `check_compose_model.py` judges both models; nginx accepts `prod.conf`; the edge logs no credential and sends each security header once                                                                                                                            | Docker, `uv` for zizmor at `scripts/gate/zizmor/requirements.txt`'s pin, and the backend virtualenv                                            |
| `--db`             | `pytest -m db` over the backend's db tier, then `pnpm run test:db` over the frontend's `*.db.test.ts` files                                                                                                                                                                                                     | venv + pnpm install + Docker                                                                                                                   |
| `--images`         | both `docker build`s, then what a build does not prove: `instrumentation.js` present, neither image running as uid 0, neither holding a file its dockerignore excludes                                                                                                                                          | Docker                                                                                                                                         |

**The images scope's context probe and both
`.dockerignore` files** hold the same list of credential shapes, and
`scripts/tests/test_image_assertions.py` holds the two to each other.

**A manifest is compared against its lockfile before anything reads the installed tree** — the
frontend scope resolves the lockfile against `package.json` and the backend scope runs
`uv lock --check`, both cheap, where otherwise the breach surfaced only where discovery is
expensive.

**Nothing reads the diff to choose a scope**, so only the bare run is sure to cover a change, and it is the run a
pull request is called ready to merge on.

**The scripts scope lints and type-checks its own python**, through configs that sit at the top of
`scripts/` rather than at the repository root or inside one of its five directories: a root config
would become the nearest one for `fl_backend/` too, moving isort's idea of the source root and
overriding the backend's pyright block, while a copy inside `gate/`, `checks/`, `lib/`, `ops/` or
`tests/` would reach that directory alone. `scripts/ruff.toml` `extend`s the backend's configuration
and adds nothing, so the selection stays in one file; `scripts/pyrightconfig.json` pins the python
version rather than letting pyright infer one, which would answer differently per machine.

**A checker resolves `scripts/lib/` for itself**, each entry point inserting it at its own top, and
`pyrightconfig.json`'s `extraPaths` is the second listing of that fact. A `PYTHONPATH` set by the
caller would be the alternative, and it would have to be spelled again in every workflow `run:`
line, every hook and every test.

The **ops** scope exists because the compose files have no compiler and no test suite, and the
nginx config has no compiler — without it, a typo in either surfaces on the server, at deploy
time. What the nginx half does have is `nginx/edge_test.sh`, which drives a real request
through a real edge started as `docker-compose.yml` starts it, reads the access line back,
asks every location and the www redirect for its security headers,
each compared with `nginx/shared/security_headers.conf`, fails a frontend location handing
Next a visitor's `traceparent` or `X-FL-Actor`, and drives
the Control API the deploy reloads through: an applied reload, a refused one, the dump, and a
worker user it refuses.

**The local stack is `docker-compose.local.yml` merged over `docker-compose.yml`**, so only what
the override writes differs, and each difference is argued at its key. What no merge can hold is
exposure, so `scripts/checks/check_compose_model.py` reads the two models
`docker compose config` renders, production's alone and the merged pair: production publishes no
port and declares exactly `:: PRODUCTION_SERVICES`, and locally only nginx leaves loopback. It also holds every mount the edge takes from `nginx/` to a directory on both stacks,
production's to the pairs `scripts/ops/deploy.sh :: EDGE_CONFIG_DIRS` compares, and the
edge's Control API socket and tmpfs to the deploy's. Over every file either edge mounts, the shared
`nginx/shared/http.conf` among them, it holds both edges to trusting the connector's rendered
address alone and to declaring the real-address header and recursion once. It holds each
application service to reading its package's `.env` and no other, judged off the environment
Compose resolves from the stand-ins the gate writes in place of the two files, and each to
the secret files its own schema reads, so a schema and a compose file that drifted apart fail here
rather than at a host's preflight,
and every service to exactly its networks, so only nginx shares one with the connector or with the
application pair. It holds every secret to exactly the services
`scripts/checks/check_compose_model.py :: SECRET_HOLDERS` names, read from its own file, the actor token's signing key the frontend's alone, with no bind mount or
config reaching `secrets/` beside them and no service handed a moved credential's name in its
environment; and every service to dropping every capability and gaining no
privilege, nginx adding back its master's four. A model it
cannot read, a short-syntax port or volume among them, is a refusal rather than a verdict
(§1.7).

**The backend steps** exist because the frontend's toolchain runs nothing against `fl_backend`;
`pyright` is separate from `ruff` because ruff checks no types. **Both test tiers run**: the
`db`-marked tests need a real `mongod`, so they are their own scope behind `require_docker`, which is
what lets `--quick` skip them. **The image scope** exists because code that compiles can still fail to build inside the image, or
be omitted from the standalone output entirely.

### 1.7 Script conventions

All scripts source `scripts/lib/_lib.sh`, which applies strict mode and installs the error and
interrupt traps, and which carries the guards, `wait_healthy` and the output verbs below. Two
things a caller may rely on across every one of them: a script resolves the repository root itself,
so it behaves the same from any working directory, and arguments are parsed before any
environmental check, so a typo fails instantly rather than after a Docker probe.

**A path answers what a file is before the file is opened**: the directory names the category, the
prefix names the class, the stem names the subject, and the extension names the harness. A new
script goes into that scheme rather than beside it.

| Part        | Reads as                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check_`    | A checker: it judges one subject and exits on `scripts/lib/checker_kernel.py`'s contract                                                          |
| `_`         | Sourced by another script and never run on its own                                                                                                |
| no prefix   | Run directly — by a person, by CI, or by another script as a subprocess                                                                           |
| `.sh` `.py` | bash, and python at the version `fl_backend/.python-version` pins: the backend virtualenv's, or a CI job's own where no step needs the virtualenv |
| `.mjs`      | node, taken only where the subject needs a parser bash and python do not have                                                                     |

`scripts/lib/checker_kernel.py` is the one name the scheme does not classify, and it keeps that
name: it is imported rather than run, so the `_` marking a sourced script would say the wrong thing
about it.

**The output standard.** One vocabulary, one verb per meaning, and no script writes formatting of its
own:

| Verb          | Means                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------- |
| `section`     | Opens a phase group, closing the one before it, and one fold in the Actions log          |
| `end_section` | Closes the open group without ending the run, for a line that belongs outside every fold |
| `step`        | Opens a step and starts its timer                                                        |
| `ok`          | The step passed, with the time it took                                                   |
| `info`        | Neutral detail                                                                           |
| `skip`        | Something was deliberately not run, dim so it can never read as a pass                   |
| `warn`        | An advisory: a problem the run is meant to survive, on stderr                            |
| `fail`        | A finding recorded, the run continuing — for a caller collecting several before it ends  |
| `die`         | A finding that ends the run, on stderr                                                   |
| `refuse`      | The check ran and its answer cannot stand as a verdict, so the run ends without one      |
| `detail`      | Supporting output belonging to the line above it, from arguments or from stdin           |
| `excerpt`     | The first few lines of something long, then a count of what `--verbose` would show       |
| `finish`      | Ends a run that reached its end, printing the closing table and statement                |

**The helpers a script leans on.** Not output verbs — one is a predicate, one wraps a command and
one prints a script's own header — so a table of their own:

| Helper    | Answers                                                                                                          |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| `verbose` | True where `--verbose` was passed; called bare in a condition, where a false answer is a status `set -e` acts on |
| `quietly` | Runs a command with both streams captured into `QUIETLY_OUTPUT`, replayed only where the command fails           |
| `usage`   | Prints the calling script's own header block as its help, so a script's help cannot drift from the script        |

**A run has exactly one ending, and its exit code names which.** Nothing else may be inferred from
the number: a caller that cannot tell "the change needs work" from "the check never ran" acts on the
wrong one.

| Ending        | Exit      | What it says                                                                           |
| ------------- | --------- | -------------------------------------------------------------------------------------- |
| `green`       | 0         | Everything that ran passed; a run covering every scope adds that it is safe to merge   |
| `findings`    | 1         | The change needs work, and each finding names what, in the section it came from        |
| `refused`     | 2         | A check declined to judge its input, so nothing here stands as a verdict on the change |
| `crashed`     | 3 or more | The script itself failed, so nothing past that line ran                                |
| `interrupted` | 130       | Ctrl-C — the sections that had opened are all there is, and none of them is a verdict  |

The checkers answer on the same scale: `scripts/lib/checker_kernel.py` fixes 0 for a pass, 1 for findings,
2 for a check that could not judge its input and 3 or more for a broken environment, in one place, so
a step reading a checker's status has one meaning to route rather than a private convention per
checker.

**Colour is decided centrally, through `FL_GATE_COLOR` ahead of everything else** — the gate's own
variable, how `verify.sh` hands each scope's run its answer without exporting one every tool would
take as an instruction.

**A CONTAINER's own log passes through one filter more before any of those verbs.**
`scripts/lib/_lib.sh :: redact_uri_credentials` replaces the userinfo in every `mongodb://` and
`mongodb+srv://` URI on the line and leaves the host, port and options standing: a driver quotes the
configured connection string back in precisely the failures `wait_healthy` greps a failing service's
log for, and a host truncated as the file was written by hand is what separates a mistyped value
from a cluster that is merely unreachable.
`scripts/tests/test_redaction.py` pins both directions against fixtures.

**What still gets through is accepted**: a credential arriving with no URI around it, which no filter of this shape reaches, and
a URI carrying **no** userinfo that shares its line with a later `@`, whose host is replaced
although nothing on the line was secret. That last one is the fail-safe half of the trade — bounding
the match to spare it is what lets a real credential through.

**Every script a person reads accepts `--verbose`**, which streams each tool's own output instead of
capturing it — the one thing a captured run cannot give back afterwards. **One command discards both
its streams whatever the flag says**: the configuration validation in
`scripts/ops/deploy.sh :: check_compose_config`, whose parse error quotes a line of an environment
file (§1.5).

**A script whose output only a machine reads is exempt, and the interface is what decides, never the
folder.** The assistant hooks answer in JSON, so a heading, a fold marker or a colour code in one is
a corrupt answer rather than a nicer log.

### 1.8 The edge's declared state

Every setting below is made in the Cloudflare dashboard or the mail provider's, and no gate check,
deploy step or test here can read one: a change made there is invisible until something breaks (§4).
[`overview.md`](overview.md#the-cloudflare-proxy) carries the performance settings that are
deliberately off, and what terminating TLS at Cloudflare costs the origin.

- **A remotely managed tunnel is the only route to the origin**, its public hostnames
  `frankfurtleague.de` and `www.frankfurtleague.de`. Each routes to nginx over
  `frankfurtleague-net` with TLS kept, its `Origin Server Name` set to the name the mounted
  certificate carries (§1.2) and `No TLS Verify` off, so the certificates `nginx/prod/prod.conf`
  names and the header set `nginx/shared/security_headers.conf` holds are what a visitor's request
  still meets. **The dashboard is where its token is issued**, and the server holds the issued
  value at `./secrets/tunnel_token` (§1.2). Each hostname's DNS record is the tunnel's own, written
  when the hostname was added, so the zone holds no record naming the origin's address.
- **Cloudflare answers every plain-HTTP request itself** with a `301` to `https://` on the same host
  (observed 2026-10-20 as `Server: cloudflare` on that answer for both hostnames). Which setting
  answers is inferred rather than read: Always Use HTTPS fits, and a redirect rule would answer the
  same. A browser ignores HSTS sent over plain HTTP, so this redirect is what moves a first visit
  typed as `http://` onto TLS; `nginx/prod/prod.conf`'s port-80 block plays no part, the tunnel above
  dialling the origin over TLS whatever Cloudflare does with plain HTTP.
- **Email Routing receives every message sent to the domain and only forwards it**: the zone's MX
  records name Cloudflare's routing servers, and each league address forwards to the personal
  mailboxes of the organisers who answer it, the league holding no mailbox. The published privacy
  notice says exactly that
  (`fl_frontend/src/features/meta/components/views/DatenschutzView.tsx :: EMPFAENGER`), so a route
  aimed at a hosted mailbox changes that notice in the same step.
- **The AI-bot controls admit an agent and refuse a trainer**: AI training blocked, AI agents
  allowed, AI search allowed, and the managed `robots.txt` on. An agent fetching a page for a
  person is a visitor; a crawler filling a training set is not, and the distinction is the whole
  reason the three are set apart rather than by one toggle.
- **A Managed Challenge meets a navigation to `/signin` and to `/bewerbung/*`, and meets nothing
  else** — not `/api/*`, and not a server action's POST, for the reason §2 gives. It
  guards the page load alone: no rule checks the POST behind either page, which the Turnstile
  widget below is for.
- **A Turnstile widget serves the bot check**, in Managed mode, on the hostname
  `frankfurtleague.de` alone, `www` redirecting before any form renders. Its site key is the
  server's `TURNSTILE_SITE_KEY` and its secret `./secrets/turnstile_secret_key` (§1.2); that the
  widget shows only when Cloudflare asks for a click is the page's own `appearance`
  (`fl_frontend/src/shared/hooks/useTurnstile.tsx`), and the mode the dashboard's.
- **The mail provider's sending domain carries a delivery webhook**, whose endpoint the provider's
  dashboard holds, **and it points at production alone**: no other deployment holds the webhook's
  signing key (`fl_frontend/src/core/config.ts :: PRODUCTION_ONLY_REQUIRED`), so an endpoint aimed
  anywhere else has every event refused unverified.
- **The mail provider's plan sets no daily sending limit**, which the sign-in's hourly total of code
  mails (`fl_frontend/src/core/auth.ts :: CODE_MAIL_TOTAL_LIMIT`) assumes: under a daily limit at or
  below that total, one hour of codes would stop every other mail the league sends for the rest of
  the day.

## 2. Invariants

| Invariant                                                                                                                                                                  | Enforced by                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No service but `nginx` publishes a port another host can reach, and production's `nginx` publishes none: the connector reaches it over `frankfurtleague-net` (§1.1)        | `scripts/checks/check_compose_model.py :: production` and `:: local`, over the models `docker compose config` renders                                                                                                                                                                                   |
| Security headers are included in every `location` that sets any header, from `nginx/shared/security_headers.conf`                                                          | `nginx/edge_test.sh`, requesting every location `nginx/shared/site.conf` declares and the www redirect: a missing, doubled or differently valued header fails, an underivable location refuses                                                                                                          |
| A `default_server` block rejects unknown hosts                                                                                                                             | `ssl_reject_handshake on`                                                                                                                                                                                                                                                                               |
| The library's limiter is off: the edge meters sign-in POSTs by network, each in its PATH's zone alone, and the frontend by address                                         | the `map` producing an empty key otherwise; the library's limiter turned off in `fl_frontend/src/core/auth.ts`                                                                                                                                                                                          |
| The builder stage has no reachable backend or real env                                                                                                                     | `SKIP_ENV_VALIDATION=true`, no secrets directory and no `API_URL`                                                                                                                                                                                                                                       |
| Production never builds                                                                                                                                                    | `deploy.sh` only pulls                                                                                                                                                                                                                                                                                  |
| Deploy recreates the application pair in place, leaving nginx running and reloading it; nginx resolves each upstream's name as it serves, never once at load               | `deploy.sh`; `nginx/edge_test.sh`, both edges reaching a backend recreated at a new address without a reload, and failing a literal `proxy_pass`; `scripts/gate/verify.sh`'s prod.conf parse, refusing one                                                                                              |
| Scripts carry the git executable bit                                                                                                                                       | `scripts/gate/selfcheck.sh`, its second step                                                                                                                                                                                                                                                            |
| The three API keys are 64 printable ASCII characters without the space (§1.5), one file each that both sides read                                                          | `fl_frontend/src/core/config.ts :: INTERNAL_API_KEY` and `fl_backend/app/core/config.py :: INTERNAL_API_KEY_CHARACTERS`; one file serves both sides                                                                                                                                                     |
| Exactly one backend endpoint is reachable from the edge — `= /api/v0/system/is_live`, exact-match so nothing joins it, restating the whole `proxy_set_header` set (§1.3)   | partly — both stacks serve `nginx/shared/site.conf`'s one location set; `nginx -t` reads no location and no test requests a backend path                                                                                                                                                                |
| Every `limit_req` zone is PAIRED, one narrow key and one wide, the wide at a multiple of the narrow's rate and burst (§1.3)                                                | `nginx/shared/http.conf`'s paired zones, each declared inside every limited location (§1.3); unenforced by the gate                                                                                                                                                                                     |
| A rate-limit key is the visitor's own network, never the tunnel connector's address, and no prefix splits across two keys (§1.3)                                           | `nginx/shared/http.conf :: map $remote_addr $client_net` and `:: map $remote_addr $client_net48`, `nginx/shared/http.conf :: set_real_ip_from` and `:: real_ip_header`; trust held by `scripts/checks/check_compose_model.py :: trusted_connector`, keys unenforced                                     |
| The catch-all makes a Next route handler reachable the moment it exists, its OWN authorization the only guard in front of it (§1.3)                                        | unenforced — `nginx/shared/site.conf :: location /` is a prefix matching everything, and nothing sweeps a new route handler for its guard                                                                                                                                                               |
| FastAPI's `/docs`, `/redoc` and `/openapi.json` are served by the app but reachable from no edge route, so nothing off this host meets them                                | unenforced — `fl_backend/app/main.py :: create_app` sets no `docs_url`, `nginx/shared/site.conf` names no `/docs` location, and nothing checks either                                                                                                                                                   |
| One `frontend` service, declared once, and no replica count lets each sweep hold one timer per process, with no lease                                                      | unenforced — `docker-compose.yml` declares the service and the local file merges into it; nothing refuses a second or a `deploy.replicas`                                                                                                                                                               |
| Production declares no database service; the managed cluster is the one store, and `mongo` is declared in `docker-compose.local.yml` alone                                 | `scripts/checks/check_compose_model.py :: PRODUCTION_SERVICES`, over the model `docker compose config` renders                                                                                                                                                                                          |
| A Cloudflare challenge may meet a top-level navigation and never a server action's POST or an `/api/*` route, which cannot render an interstitial (§1.3)                   | unenforced — nothing in this repository can read a Cloudflare rule                                                                                                                                                                                                                                      |
| Preflight judges each frontend secret's value by the frontend's own boot, and the signing key's pair besides; the tunnel token, for presence alone                         | `scripts/lib/_lib.sh :: require_file`, `:: check_frontend_boot_config` and `:: check_actor_key`; the frontend's values are `fl_frontend/src/core/config.ts :: validated`'s                                                                                                                              |
| A startup refusal names the failing variables or secret files, an undeclared name by line number, or a failure type, and never a value                                     | `fl_backend/app/core/config.py :: get_config` and `fl_frontend/src/core/config.ts :: refuseInvalidEnvironment`; `fl_backend/tests/core/test_config.py :: TestTheNamesOnlyErrorPath`, `:: TestTheStartupPing`, `:: TestTheSecretFiles` and `fl_frontend/src/core/config.test.ts` assert no value appears |
| The pulled backend image reads `fl_backend/.env` in preflight, refusing at exit 2 what `read_environment` rejects, missing ones included; an undeclared one by line number | `scripts/ops/deploy.sh :: check_env_names`, whose refusal and advisory arms `scripts/tests/test_deploy_streams.py` drives, the snippet run for real                                                                                                                                                     |
| Every file under `fl_frontend/src/app/` answering a URL is accounted for: a handler against the edge's locations, a metadata convention against its recorded decision      | `scripts/checks/check_public_routes.py :: METADATA` and `:: METADATA_IMAGES`, driven red in `scripts/tests/test_check_public_routes.py`; a reserved name it cannot place refuses                                                                                                                        |
| The frontend image refuses `fl_frontend/.env` at exit 2 for a missing required name, or an undeclared one by line number alone; values are the boot's                      | `scripts/ops/deploy.sh :: check_frontend_env_names` over the key sets `fl_frontend/scripts/emit-environment-names.mjs` writes into the image; driven by `scripts/tests/test_deploy_env_names.py`, `fl_frontend/scripts/check-environment-names.test.mjs` and `fl_frontend/src/core/config.test.ts`      |
| Nothing the edge writes to its container's stdout or stderr names a visitor; every line that does lands in a host file `docs/ops/runbooks.md` §7 rotates                   | `nginx/edge_test.sh`, serving `nginx/local/local.conf`, whose logging directives are `nginx/shared/http.conf`'s, which `nginx/prod/prod.conf` includes too                                                                                                                                              |
| nginx loads its configuration through directory mounts, and a deploy or `--status` finding it holding anything but this checkout's files ends in a finding (§1.2)          | `scripts/ops/deploy.sh :: edge_reads_checkout`, over nginx's own dump, after every reload and in `--status`; `scripts/checks/check_compose_model.py :: edge_mounts` holds both stacks' mounts                                                                                                           |
| Every base, stack, script-run and test-tier image this repository does not build is pinned by tag and digest                                                               | `scripts/tests/test_image_pins.py`, over both Dockerfiles, both compose files, `scripts/gate/selfcheck.sh`, `scripts/ops/local.sh` and `fl_backend/tests/conftest.py`, and holding the frontend db tier's image to the backend's                                                                        |
| Each application service reads its own package's `.env` and no other file, the one the deploy's readers are handed                                                         | `scripts/checks/check_compose_model.py :: env_files`, over the models `docker compose config` renders from the gate's stand-ins                                                                                                                                                                         |
| Each application service is handed every secret file its schema requires on that stack, and none it never reads                                                            | `scripts/checks/check_compose_model.py :: frontend_files` over `:: frontend_schema_files`, which reads `fl_frontend/src/core/config.ts`; `scripts/checks/check_compose_model.py :: backend_files` over `:: backend_schema_files`, which reads `fl_backend/app/core/config.py`                           |
| Only nginx shares a network with the connector, and only nginx with the application pair, in both stacks                                                                   | `scripts/checks/check_compose_model.py :: networks`, over the models `docker compose config` renders                                                                                                                                                                                                    |
| The actor token's signing key reaches the frontend alone, at `/run/secrets/fl_actor_signing_key`, read from `./secrets/fl_actor_signing_key`                               | `scripts/checks/check_compose_model.py :: secret_holders` and `:: secrets_directory`, over the models `docker compose config` renders                                                                                                                                                                   |
| Before containers start, both preflights refuse a signing key the frontend cannot read or a mismatched public half, printing no value; an unrunnable check warns           | `scripts/lib/_lib.sh :: check_frontend_boot_config` for the key's read and `:: check_actor_key` for the pair, called by `scripts/ops/deploy.sh` and `scripts/ops/local.sh`; `scripts/tests/test_deploy_streams.py` runs the pair's snippet for real                                                     |
| Each `.env` line compose reads is blank, a `#` comment or `NAME=VALUE` in RFC 3986's characters less `#`, `$`, `'`, and splits for no reader                               | `scripts/lib/_lib.sh :: check_env_spellings`, called by a deploy, its `--check-env` and a local start before their first compose call; `scripts/tests/test_deploy_streams.py`                                                                                                                           |
| Every service in both stacks drops every capability and sets `no-new-privileges`; `nginx` alone adds any back, `CHOWN`, `SETUID`, `SETGID` and `DAC_OVERRIDE`              | `scripts/checks/check_compose_model.py :: privileges`, over the models `docker compose config` renders; `nginx/edge_test.sh` starts both edges with them                                                                                                                                                |
| Every credential reaches a service as a Compose file secret, held by exactly the services that read it, from its own file under `secrets/`                                 | `scripts/checks/check_compose_model.py :: secret_holders` over `:: SECRET_HOLDERS`; the local stack's login-free database URI `:: config_holders`                                                                                                                                                       |
| No service's `environment:` names a value a secret file holds, in any letter case                                                                                          | `scripts/checks/check_compose_model.py :: moved_names`, over the models `docker compose config` renders                                                                                                                                                                                                 |
| Before containers start, each service's own boot builds its settings from its container's variables and secret files, printing no value; an unrunnable check warns         | `scripts/lib/_lib.sh :: check_frontend_boot_config` and `:: check_backend_boot_config`, called by `scripts/ops/deploy.sh` and `scripts/ops/local.sh`; `scripts/tests/test_deploy_streams.py`, `fl_frontend/src/instrumentation.test.ts`                                                                 |
| The frontend image's `FROM node:` tag lies in the series `fl_frontend/package.json :: devEngines` declares, the Node every checkout and CI job runs                        | `scripts/tests/test_image_pins.py :: test_the_frontend_image_runs_the_node_series_pnpm_installs`                                                                                                                                                                                                        |
| The frontend image installs with the pnpm `fl_frontend/package.json :: packageManager` names                                                                               | `scripts/tests/test_image_pins.py :: test_the_frontend_image_installs_the_pnpm_the_manifest_names`                                                                                                                                                                                                      |
| The backend image's `FROM python:` tag lies inside the series `fl_backend/.python-version` pins, which every CI job's interpreter comes from                               | `scripts/tests/test_image_pins.py :: test_the_backend_image_runs_the_python_series_ci_installs`                                                                                                                                                                                                         |
| The backend image's `FROM ghcr.io/astral-sh/uv:` tag names the release `.github/actions/backend-toolchain/action.yml` installs, the uv every CI job runs                   | `scripts/tests/test_image_pins.py :: test_ci_installs_the_uv_the_backend_image_copies_in`                                                                                                                                                                                                               |
| The deploy and the local stack refuse to start while a `.env` stands beside the compose file, printing none of it                                                          | `scripts/lib/_lib.sh :: refuse_compose_dotenv`, called by both scripts before any mode asks compose; `scripts/tests/test_deploy_streams.py`                                                                                                                                                             |
| A stopped backend container lets every request it accepted end inside its bound, aborts included, before the engine kills it                                               | `fl_backend/Dockerfile :: CMD` and `docker-compose.yml`'s `stop_grace_period`; `fl_backend/tests/core/test_request_deadline.py :: TestAStoppedContainerOutlastsEveryRequest`                                                                                                                            |
| A stopped frontend container lets every request it accepted, and the work behind each answer, end inside its bound before the engine kills it                              | `docker-compose.yml`'s `stop_grace_period` against `fl_frontend/src/core/requestScope.ts :: REQUEST_DEADLINE_MS` and `:: AFTER_RESPONSE_DEADLINE_MS`; `fl_frontend/src/core/requestScope.test.ts`                                                                                                       |
| No package's `.env` names a secret file's value or `ALLOWED_ADMIN_EMAILS`, in any letter case or form compose reads a name in                                              | `scripts/lib/_lib.sh :: refuse_credential_lines`, called by a deploy and a local start before their first compose call; `scripts/tests/test_deploy_streams.py`                                                                                                                                          |

## 3. Violation → remedy

| Symptom                                                                                                                                                                                  | Cause                                                                                                                                         | Remedy                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Invalid environment variables: <NAMES>` then no traffic                                                                                                                                 | Startup environment gate                                                                                                                      | Fix those names in the relevant `.env`                                                                                                                                                                               |
| `Invalid secret files: <FILES>` then no traffic                                                                                                                                          | A secret file is missing, or holds a value the gate refuses                                                                                   | Write the file named; its value is never printed                                                                                                                                                                     |
| `Unreadable secret files: <PATH> (<ERRNO>)` then no traffic                                                                                                                              | The service's user cannot read the file or `SECRETS_DIR`: `EACCES` its owner or mode, `EISDIR` a directory at its path, `ENOENT` no directory | Give it the user and mode §1.2 names, or write the file                                                                                                                                                              |
| `The environment could not be read: <TYPE>` then no traffic                                                                                                                              | The backend's settings reader failed before any variable was judged — a `.env` file it cannot decode is the reachable case                    | Read `fl_backend/.env` as utf-8; no variable is named because none was reached                                                                                                                                       |
| Deploy reports healthy but the site is unreachable                                                                                                                                       | nginx, or the connector in front of it (§1.1)                                                                                                 | prod: `docker compose logs nginx` for startup, `/var/log/frankfurtleague/nginx/error.log` for requests, then `docker compose logs cloudflared`                                                                       |
| No tunnel registers, or the connector restarts in a loop                                                                                                                                 | The token file is missing, unreadable by the connector's uid 65532, or not this tunnel's, or the release rejects the run arguments            | `docker compose logs cloudflared`. Preflight refuses a missing `./secrets/tunnel_token` by name, so a loop means its owner and mode, the value or the arguments (§1.2)                                               |
| A container refuses to boot naming a file under `/run/secrets`                                                                                                                           | The host file is missing, owned by another user or blank; compose hands it over with the host's owner and mode (§1.2)                         | Give it the user and mode §1.2's table names, or write it again ([`runbooks.md`](runbooks.md) §16); the deploy's preflight names it first                                                                            |
| An `up` fails: `Pool overlaps with other one on this address space`                                                                                                                      | Another Docker network on this host holds `172.30.0.0/24`, which `docker-compose.yml` declares so the connector's address is fixed            | Find it with `docker network inspect`, then remove or re-subnet it; moving this stack's subnet moves the connector's address                                                                                         |
| The tunnel is up and Cloudflare answers 502 or 1033                                                                                                                                      | The dashboard routes a hostname to nothing, or its `Origin Server Name` names something other than the mounted certificate (§1.8)             | `docker compose logs cloudflared` names the origin it dialled. Both settings are dashboard state, so nothing here can be edited to fix it                                                                            |
| `failed to connect to the docker API at npipe:...`                                                                                                                                       | Docker Desktop is not running                                                                                                                 | Start it and wait for it to settle                                                                                                                                                                                   |
| Deploy stops in preflight naming the Docker Engine version                                                                                                                               | The host's engine is below what the compose files' `start_interval` needs                                                                     | Nothing was stopped or pulled. Upgrade the engine, or drop `start_interval` from both compose files (§1.5)                                                                                                           |
| Deploy refuses in preflight saying compose could not read its configuration                                                                                                              | The compose file or an environment file will not parse — an unterminated quote is the reachable case                                          | Nothing was pulled or recreated. Read the message by hand: `docker compose -f docker-compose.yml config --quiet`, whose output can carry a value (§1.5)                                                              |
| `./scripts/ops/deploy.sh --status` exits 1 naming two different builds                                                                                                                   | A publish moved one package's `:latest` and failed on the other, so this host pulled a pair no build names                                    | Deploy the build both packages have: `./scripts/ops/deploy.sh <tag>`, the tag the report names                                                                                                                       |
| A bare `./scripts/ops/deploy.sh` refuses: a pulled `:latest` image carries no published-tag label                                                                                        | A `:latest` image this repository's publish did not build                                                                                     | Nothing was recreated. Publish a build, or deploy one by tag: `./scripts/ops/deploy.sh <tag>`                                                                                                                        |
| `./scripts/ops/deploy.sh --status` exits 1 over a pair it has just called healthy                                                                                                        | The edge is not reaching them: a probe made before nginx's cached address expired, or a resolution failing, that nginx's error log records    | Re-run `--status` once the cache expires; still failing, read nginx's error log ([`runbooks.md`](runbooks.md) §7), then reload the edge, which the report's detail line names                                        |
| A deploy or `--status` fails: nginx holds a configuration not this checkout's                                                                                                            | It was not reloaded after a pull, mounts something other than `nginx/prod` and `nginx/shared`, or keeps a file mount's replaced file          | `docker compose -f docker-compose.yml up -d --force-recreate nginx`, then `./scripts/ops/deploy.sh --status`                                                                                                         |
| After a recreate, nginx restarts in a loop and the deploy refuses, the edge unanswered                                                                                                   | Its image predates the Control API, so it refuses the `-l` switch its command passes (§1.2)                                                   | `docker compose -f docker-compose.yml logs nginx`: `invalid option: "l"` there means a release older than 1.31.5. Pin one that has the API, then deploy                                                              |
| A deploy fails: nginx refused the reloaded configuration                                                                                                                                 | Applying it failed, so the master rolled it back and kept serving the configuration it had                                                    | The run prints nginx's own lines; fix what they name, then recreate nginx as above                                                                                                                                   |
| The publish job in `.github/workflows/verify.yml` fails at the push with `denied` or `permission_denied`                                                                                 | The package does not grant this repository's workflows write access                                                                           | Package settings → Manage Actions access → add this repository with the Write role, then re-run the job                                                                                                              |
| `EBUSY`, or `.next` locked during a build                                                                                                                                                | A `pnpm dev` is still running, or the folder is open in an editor                                                                             | Stop the dev server; nothing else may hold port 3000 while the local stack runs                                                                                                                                      |
| `./scripts/ops/local.sh` reports `mongo` unhealthy                                                                                                                                       | The local database has not elected itself primary, so no transaction opens and no validator applies                                           | Read the log excerpt the script prints under `mongo`'s health step; it waits on `mongo` by name, so this reports as itself                                                                                           |
| `./scripts/ops/local.sh --seed` dies during the copy from production                                                                                                                     | The production tier throttles past its operations-per-second cap, and anything else querying the cluster shares that budget                   | Nothing was written to the local database. Re-run with nothing else talking to production; the dump already takes one collection at a time (§1.5)                                                                    |
| The local stack's data disagrees with production, in either direction                                                                                                                    | Working as intended — `--seed` reuses the copy already on disk however old it is                                                              | `./scripts/ops/local.sh --refresh-db` takes a fresh one (§1.5)                                                                                                                                                       |
| A db-tier run reports a wall of failures naming validators and unique indexes                                                                                                            | A second `pytest -m db` ran beside it, bare rather than through the gate, whose db step refuses one                                           | Trust neither verdict, the green one included. Re-run with nothing else on the tier; a db-tier figure needs an idle machine (§1.6)                                                                                   |
| Container unhealthy, health log empty, `FailingStreak: 0`                                                                                                                                | The app died before the first probe                                                                                                           | Usually a malformed `.env` value restored by hand. Read `docker compose logs <service>` on the server                                                                                                                |
| A directory appeared named `something;C`                                                                                                                                                 | MSYS rewrote a POSIX-looking path in a hand-typed `docker run -v`                                                                             | Delete it, and prefix the command with `MSYS_NO_PATHCONV=1`                                                                                                                                                          |
| `UnicodeEncodeError: 'charmap' codec` from `fastapi dev`                                                                                                                                 | Windows only, when the output is piped or redirected                                                                                          | The CLI banner needs UTF-8. Prefix the command with `PYTHONUTF8=1`                                                                                                                                                   |
| Static assets served without security headers                                                                                                                                            | A `location` block set a header and dropped the inherited set                                                                                 | Include `nginx/shared/security_headers.conf` in that block                                                                                                                                                           |
| Backend healthcheck fails after an API version bump                                                                                                                                      | The healthcheck spells the API version itself                                                                                                 | Move the path in `docker-compose.yml`'s backend healthcheck, and in `nginx/shared/site.conf`'s liveness location with it (§4)                                                                                        |
| The uptime monitor 404s while the backend container reports healthy                                                                                                                      | The nginx liveness location still spells the old version, so the probe matches `location /` and Next answers it                               | Move the path in `nginx/shared/site.conf`'s liveness location, then re-point the monitor at the apex host with no trailing slash (§4)                                                                                |
| Sign-in returns 429                                                                                                                                                                      | Working as intended — the sign-in POST is rate-limited at the edge                                                                            | Nothing. The limit is `nginx/shared/http.conf`'s `signin` zone, and it applies to POST alone                                                                                                                         |
| A page a mailed link opens answers `429` with „Zu viele Aufrufe“                                                                                                                         | Working as intended — one network opened link pages past the `linkseite` burst (§1.3)                                                         | Nothing. A reload once the zone refills opens the link, its token still in the address bar                                                                                                                           |
| Uptime monitor shows green during a backend outage                                                                                                                                       | The error page streams after headers, so the edge status is 200                                                                               | Monitor `GET https://frankfurtleague.de/api/v0/system/is_live` at the apex host: a trailing slash redirects and reads green, a `HEAD` is answered 405 (`fl_backend/app/api/system/router.py :: check_is_live`, §1.3) |
| Application container logs are empty right after a deploy                                                                                                                                | Working as intended — `json-file` logs live in the container, and the deploy replaces both application containers; nginx keeps its own        | Nothing. The deploy copied them to `/var/log/frankfurtleague/` first (`scripts/ops/deploy.sh :: LOG_DIR`)                                                                                                            |
| Reference data stale after a hand edit: the first visit once the cache's day has passed still gets it, up to its week ([`docs/frontend/overview.md`](../frontend/overview.md#data-flow)) | Working as intended — an out-of-band MongoDB edit invalidates nothing                                                                         | Drop the five league tags ([`runbooks.md`](runbooks.md) §20); waiting takes a day, plus one stale answer to the visit refreshing each entry                                                                          |
| League table or fixtures stale after a season edit                                                                                                                                       | Same cause — a season decides the default season and the points                                                                               | Same remedy, once the backend's own season cache has expired: dropped sooner, the frontend refills from it                                                                                                           |
| The `docs` job is red naming the total's floor or a matrix job's budgets                                                                                                                 | The total's floor rose beside references not all re-stamped from one population, or a matrix job's instances carry unequal budgets (§1.6)     | Re-cut every referenced row from one population with `--stamp`, or give every instance the widest instance's budget (§1.6)                                                                                           |

## 4. Known-open

| Item                                                              | State                                                                                                                                                                                              |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The API version is spelled in tracked files outside the code      | Open — `docker-compose.yml`'s backend healthcheck, `nginx/shared/site.conf`'s liveness location, `nginx/edge_test.sh` and `scripts/ops/deploy.sh :: PROBE_URL`; §3 carries two symptoms            |
| The frontend's `API_VERSION` is deployed rather than committed    | Open — `fl_frontend/src/core/config.ts :: frontend_config` reads a per-environment value no commit carries, so a stale one sends every fetch to `location /`                                       |
| A rollback moves nothing in the registry                          | Accepted — `scripts/ops/deploy.sh :: roll_back` re-tags this host's local `:latest` and reaches no registry, so a re-deploy pulls the failed build back ([`runbooks.md`](runbooks.md) §1)          |
| An older build put back serves this checkout's edge               | Accepted — `scripts/ops/deploy.sh :: roll_back` and `:: start_stopped_again` restore containers and never the checkout, so the newer `nginx/` configuration fronts the older build                 |
| Registry tag pruning is manual                                    | Accepted — a botched delete destroys rollback history. The retention procedure is in §1.5                                                                                                          |
| Revoking admin access ends no session                             | Accepted — both processes read the grant on every request, so a revoked one admits nothing from the next and nothing restarts                                                                      |
| Nothing announces that a season rollover is due                   | Accepted — nothing in the running application watches the season clock; the trigger to revisit is a rollover actually missed, which serves last season silently                                    |
| Traffic between containers is plain HTTP                          | Accepted — the admin key and actor token cross `frankfurtleague-app` unencrypted, a bridge on one host no container can read, none holding `NET_RAW`                                               |
| Certificate renewal is outside this repository                    | Accepted — they are mounted from `./certs`, and nothing here issues or rotates them                                                                                                                |
| The local database runs unauthenticated                           | Accepted — authentication on `--replSet` wants a keyfile whose permissions `mongod` checks, which a Windows host does not reliably give it (`fl_backend/tests/conftest.py :: _replica_set_mongod`) |
| The local database holds real contact records                     | Accepted — a copy no other host can reach; `--fresh` removes volume, copy and access log, every `--down` removes `.tmp-mail/`                                                                      |
| A guard the database tier stays green without                     | Narrowed — dropping `session=` at `judge_and_write_the_rules` turns `--db` (§1.6) red                                                                                                              |
| The linter behind §1.4's compensating control is past end of life | Open — `fl_frontend/package.json` holds eslint at a line taking no further fix, and both §1.4's `react/no-danger` control and `--frontend`'s lint step run on it                                   |
| Cloudflare may rewrite the edge's own 429                         | Open — whether the tunnel passes `@edge_refusal`'s body and `Content-Type` unchanged shows only in production, on the 32nd action POST after a deploy (§1.3)                                       |
| Cloudflare may rewrite the edge's own 429 page                    | Open — whether the tunnel passes `@edge_refusal_seite`'s page unchanged shows only in production, on a link page loaded past its burst (§1.3)                                                      |
| The edge's declared state is enforced by nothing here             | Accepted — §1.8 records what the Cloudflare dashboard holds, and no gate check, deploy step or test can read any of it                                                                             |
| CI's Python can be another patch release than the image's         | Accepted — `actions/setup-python` resolves the series `fl_backend/.python-version` names, while the image holds the release its tag names until Dependabot moves it                                |
| A runtime's security release waits for Dependabot's schedule      | Accepted — Dependabot has no base-image security updates, so a Node or Python fix waits for the weekly run and cooldown: eight days at worst                                                       |
| An unread `*Schema` passes both knip runs                         | Open — the production run counts its inferred type's `typeof` as its module's use, and both runs ignore that type: reading alone finds it                                                          |
