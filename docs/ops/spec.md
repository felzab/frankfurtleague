# Ops — spec

**Scope:** `docker-compose*.yml`, `nginx/`, `scripts/`, both Dockerfiles, `.github/workflows/`

| Section                                                       | Answers                                                                 |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [1.1 Service inventory](#11-service-inventory)                | What runs in production, and what each service is trusted with          |
| [1.2 Mounts and secrets](#12-mounts-and-secrets)              | What the host provides, and who owns each secret file                   |
| [1.3 nginx routing](#13-nginx-routing)                        | Which location serves which path, and what meters it                    |
| [1.4 Security headers](#14-security-headers)                  | What is set, and why `'unsafe-inline'` survives                         |
| [1.5 The environments](#15-the-environments)                  | Which stack to reach for, and what each one's database holds            |
| [1.6 The verification gate](#16-the-verification-gate)        | Which scopes exist, what each runs, and the CI jobs that run them       |
| [1.7 Script conventions](#17-script-conventions)              | What a path says, what every script shares, and what its exit code says |
| [1.8 The edge's declared state](#18-the-edges-declared-state) | What is set at Cloudflare, which no file here can hold to it            |
| [2. Invariants](#2-invariants)                                | The rules that must hold, and what holds each                           |
| [3. Violation → remedy](#3-violation--remedy)                 | A symptom, its cause, and what to do about it                           |
| [4. Known-open](#4-known-open)                                | The accepted gaps                                                       |

The procedures, the deploy among them, are in [`runbooks.md`](runbooks.md).

---

## 1. Contract

### 1.1 Service inventory

**Production's four services, `frontend`, `backend`, `nginx` and `cloudflared`, publish no port.**
`cloudflared` dials out to Cloudflare and carries every request back to nginx over
`frankfurtleague-net`. It holds the static address `172.30.0.250` there, because
`nginx/shared/http.conf` trusts it by address (§1.3). It reads its credential with `--token-file`,
which no process listing and no `docker inspect` shows. The tunnel's public hostnames and its origin
are dashboard state (§1.8).

**The connector reaches nginx and nothing else.** nginx alone joins both `frankfurtleague-net`,
which it shares with the connector, and `frankfurtleague-app`, which it shares with `frontend` and
`backend`. A dashboard origin naming `backend:8000` therefore resolves to nothing, where on one
network it would publish the whole API past nginx.

**Each service's image, resource limits and healthcheck are `docker-compose.yml`'s own.** Three
services declare a healthcheck:

- `frontend`: Node answers a `HEAD` of `/favicon.ico`, which renders no route and reads no backend.
- `backend`: `/api/v0/system/is_live`, which reads no database.
- `cloudflared`: `cloudflared tunnel ready`, healthy while the connector holds a connection to
  Cloudflare, so a refused token restarting in a loop is never counted healthy.

nginx declares none, so Compose counts it healthy while it runs.

**Every image this repository does not build is pinned by tag and digest** (`name:tag@sha256:…`):
each Dockerfile's `FROM`, each compose file's `image:`, and the images `scripts/gate/selfcheck.sh`,
`scripts/gate/verify.sh`, `fl_backend/tests/conftest.py` and `.github/workflows/verify.yml` run. A
pull fetches the digest, so a tag rebuilt upstream changes nothing here until a pull request moves
it. **Each tag names the exact release its digest is**, since a series tag (`mongo:8`) is a label no
reader can hold to one release. Dependabot compares the tag to propose the next pair; the pins
`.github/dependabot.yml` lists move by hand, no ecosystem reading a shell string. Both database test
tiers run the local stack's own mongo. `scripts/tests/test_image_pins.py` holds every reference to
that form, and the two tiers to the stack.

**The toolchain an image bakes in is the one the checkout declares**, so what CI tested is what
production runs:

- the frontend base's Node is the exact release `fl_frontend/package.json :: devEngines` names,
  which `pnpm/setup` installs for every CI job and `fl_frontend/pnpm-lock.yaml` records;
- the backend base's Python lies inside the series `fl_backend/.python-version` pins, which every
  CI job's interpreter comes from;
- the backend image's uv is the release `.github/actions/backend-toolchain/action.yml` installs.

Dependabot's `docker` ecosystem moves a tag alone, so its pull request for a new Node, Python series
or uv is refused by `scripts/tests/test_image_pins.py` until the pin moves on the same branch. **For
uv that refusal is the only wait a new release meets**: `ghcr.io` publishes no date, so the
ecosystem's cooldown holds nothing back.

**The digest alone decides what runs, and nothing checks the tag against it.** An official image is
rebuilt under the same tags whenever its own base is refreshed
([the Official Images FAQ](https://github.com/docker-library/faq/blob/ce1a70af72a522f8638d6bffd930ef3252de7837/README.md#why-does-my-security-scanner-show-that-an-image-has-cves),
read 2026-09-25), so a correct pin's digest and its tag's current one routinely differ. A hand edit
moving one without the other goes unnoticed.

**A recreated nginx needs no connector restart.** The connector resolves its origin on every new
connection and holds no address between them, so only the sockets it had pooled to the old container
fail, once each. This was read from cloudflared's source at an earlier pin, 2026-09-07; nothing here
observes it.

**Every service restarts `unless-stopped` and logs to the host's journal**, each line tagged with
its container's name (`docker-compose.yml :: x-logging`). The journal's age limit is a host setting
([`runbooks.md`](runbooks.md) §7).

**Every service drops every capability and runs under `no-new-privileges:true`, and nginx alone
adds any back**: three, each one its master, starting as root, fails to start without. `CHOWN` hands
the workers their temp directories, and `SETUID` and `SETGID` make the workers their own user.
`NET_BIND_SERVICE` is not among them: a container's `net.ipv4.ip_unprivileged_port_start` is 0,
which lets every user bind below 1024 (read 2026-09-27, on engine 29.8.0). With `NET_RAW` in no
container, none can read the traffic crossing `frankfurtleague-app` (§4).

**The frontend container also runs the background jobs, from one scheduler.**
`fl_frontend/src/instrumentationNode.ts :: registerOnNode` arms `:: armScheduler` under a production
build, which runs one pass a minute after start and then hourly, in the process that serves the site.
A pass runs each job in turn:

- the retention sweep (`fl_frontend/src/features/bewerbungen/sweep.ts :: runBewerbungSweep`);
- the account sweep (`fl_frontend/src/features/roles/sweep.ts :: runAccountSweep`);
- the pupils' deletion (`fl_frontend/src/features/saisons/sweep.ts :: runErasureSweep`);
- the fixture confirmations (`fl_frontend/src/features/spielbestaetigungen/sweep.ts ::
runSpielSweep`);
- the handover pass (`fl_frontend/src/features/grants/sweep.ts :: runHandoverPass`).

Then the Postausgang's drain (`fl_frontend/src/core/mail.ts :: drainOutbox`) sends what they owed;
a write that owes a mail drains at once besides. **No switch holds one job back**: every job runs
wherever a production build runs, the local stack included, and `next dev` arms nothing.
**`RESTORE_HOLD=on` in `fl_frontend/.env` holds them all**, while the data is not yet what the
jobs may act on, as during a restore ([`runbooks.md`](runbooks.md) §13): read once at the boot,
it arms no pass and makes a write's drain send nothing
(`fl_frontend/src/core/afterResponse.ts :: drainSoon`), the mail waiting in the Postausgang.

Production declares no replicas, so one process arms one timer, and an hour finding the previous
pass still running is skipped with one line. Every job selects on dates, lapses or season statuses
and is idempotent, so a redeploy, a restart and a missed hour each cost nothing, and a job that
throws stops none of the others. The deletion notice is idempotent to one floor: a crash between a
delivery and its stamp repeats that one notice once. The backend judges each pupil of a deletion
again in a transaction of their own, and the account sweep counts an account already gone as such.

**After every pass the scheduler pings Better Stack's heartbeat**, at the address
`secrets/betterstack_heartbeat_url` holds. It appends `/fail` and names each job where a job threw,
left owed deletions or erasures, or the drain gave a mail up. The monitor alerts on a failed ping
and on a missing one ([`runbooks.md`](runbooks.md) §9). The ping never fails the pass.

**`API_VERSION` is a constant of the code rather than a setting**, so bumping it is a code change,
and the version is spelled again at sites a commit does not all reach (§4).

### 1.2 Mounts and secrets

| Host path                       | Container path        | Mode      |
| ------------------------------- | --------------------- | --------- |
| `./nginx/prod`                  | `/etc/nginx/conf.d`   | read-only |
| `./nginx/shared`                | `/etc/nginx/shared`   | read-only |
| `./secrets/<name>`, each secret | `/run/secrets/<name>` | read-only |

**Each must exist before the stack starts, and nothing checks them before a deploy.** Docker mounts
a missing directory empty, so nginx serves none of this site or refuses its includes. A missing
secret file fails that service's start, which the deploy's wait reports.

**nginx's configuration is mounted as directories, never as a file.** A bind-mounted file stays the
inode it was created with, and a `git pull` writes a changed file as a new one, so a container
mounting the file would reload the old one. A directory mount shows what the checkout holds, and the
reload the deploy sends applies it with no restart, the old workers finishing the requests in
flight.

**Every credential the stack holds is a Compose file secret, and none is an environment variable**:
`docker inspect` prints a container's environment, and never the contents of a mount. Each file has
one name on the host, at `/run/secrets/` and in development, so the two database logins are two
files. Who holds which is `scripts/checks/check_compose_model.py :: SECRET_HOLDERS`.
**`./secrets/` is `.gitignore`d**, which keeps the credentials uncommittable from a checkout that
has to hold them.

**Compose mounts a file secret as a bind mount and ignores its `uid`, `gid` and `mode`**, so the
host file's own owner and mode are what the container sees (Docker's Compose file reference,
`services` · `secrets`, read 2026-09-27). Each file therefore belongs to the user that reads it:

| Files                                                                                                                                  | Owner                            | Mode  |
| -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----- |
| `tunnel_token`                                                                                                                         | uid and gid 65532, the connector | `400` |
| `frontend_mongodb_uri`, `auth_secret`, `auth_resend_key`, `resend_webhook_secret`, `turnstile_secret_key`, `betterstack_heartbeat_url` | uid and gid 1001, the frontend   | `400` |
| `backend_mongodb_uri`                                                                                                                  | uid and gid 1002, the backend    | `400` |
| `internal_api_key_base`, `internal_api_key_system`, `internal_api_key_admin`                                                           | root, group 1003                 | `440` |

**The three internal keys are one file each, read by both application services**, which run as
different users: both take group 1003 through `group_add`, the documented answer for containers of
different users sharing one file, so neither service's copy can drift from the other's. A file
readable by the wrong user leaves that service refusing to boot, and the connector restarting in a
loop.

**A key is printable ASCII without the space**: `secrets.compare_digest` raises on anything else,
so a key outside the class would boot and then answer every internal request 500. Its file is its
only reader, so `"`, `#`, `$`, `'`, `\` and the backtick are part of the class. A key from
`openssl rand -hex 32`, as [`runbooks.md`](runbooks.md) §16 generates one, is one every build takes.

**`internal_api_key_admin` is what names an actor**: the backend believes the actor headers on a
request carrying it (`fl_backend/app/core/security.py :: get_session_actor`), so its holders are the
two application services alone, and only the private network reaches the backend
([`runbooks.md`](runbooks.md) §16).

### 1.3 nginx routing

Both edges serve `nginx/shared/site.conf`, wrapped by `nginx/prod/prod.conf` for production and
`nginx/local/local.conf` for the local stack. nginx picks an exact match first and then the longest
prefix; order in the file decides nothing.

| Location                            | Upstream   | Meter                                           | Body cap |
| ----------------------------------- | ---------- | ----------------------------------------------- | -------- |
| `= /signin/continue`                | `frontend` | `authapi`                                       | 1m       |
| `= /api/client-error`               | `frontend` | `form`                                          | 32k      |
| `= /api/auth/sign-in/email-otp`     | `frontend` | `authapi`, and `form`                           | 8k       |
| `= /api/mail/delivery`              | `frontend` | none                                            | 8k       |
| `/api/auth`                         | `frontend` | `authapi`                                       | 1m       |
| `= /api/v0/system/is_live`          | `backend`  | none                                            | 1m       |
| `= /api/v0/system/is_ready`         | `backend`  | `authapi`                                       | 1m       |
| `/_next/static/`                    | `frontend` | `action`                                        | 1m       |
| `/confirm/`                         | `frontend` | `linkpage`, `action` and the connection ceiling | 1m       |
| `= /registrierung` and `= /erasure` | `frontend` | `linkpage`, `action` and the connection ceiling | 1m       |
| `/`                                 | `frontend` | `action` and the connection ceiling             | 1m       |

**The four zones each price one kind of work, per visitor network** (`nginx/shared/http.conf`):

- `form`, 6 a minute, POST alone: the two public writes a route handler answers, a typed sign-in
  code's check and a crash report.
- `authapi`, 30 a minute, every method: the sign-in library's routes, its landing and the readiness
  probe, each reading a database. The code check spends it too, so a GET there meets a meter.
- `linkpage`, 30 a minute, every method: every page a mailed or shared link opens.
- `action`, 60 a minute: every server action, which Next 16.4.2 runs for a POST carrying a
  `Next-Action` header or either form content type, at any path. Every other request's key is empty,
  so it meters no page load, asset or JSON post.

**A zone is named in every limited location, never once at server level.** nginx inherits
`limit_req` only where a level declares none, so a server-level zone would be dropped by each
location naming one of its own: the rule `add_header` follows too. **A zone keyed on the method map
limits no GET**, an empty key being exempt from `limit_req`, so the zones over a GET key on the
network map alone; keyed otherwise they would read as limited and be unlimited.

**Every refusal is a `429`**, a zone's and the connection ceiling's alike, so one access line's
`status` means the same thing whichever refused.

**`$remote_addr` is the visitor rather than the connector**: nginx takes `CF-Connecting-IP` from the
one address it trusts, the connector's, and from nothing else (`nginx/shared/http.conf ::
set_real_ip_from`). Cloudflare's published ranges could never serve here, being every customer's
egress rather than this account's. Where the header is absent or does not parse, the connector's own
address stands, and every visitor shares one key.

**The key is a network rather than an address**: the whole address on IPv4 and the /64 on IPv6
(`nginx/shared/http.conf :: map $remote_addr $client_net`), since a /64 is the smallest block anyone
is allocated. nginx compresses the longest run of zero groups wherever the host bits put it, so the
map enumerates every shape a /64 can render in. A holder of a routed /48 holds 65,536 keys: the
zones bound a household or a school, never such a holder.

**`location /` takes a connection ceiling rather than a rate zone on every request**:
`limit_conn conn 50` per network, which nginx counts from a request's header until its answer. A
zone on every request would stall page loads, which fan out; behind a single connector, whose sockets
no visitor controls, the ceiling is a backstop rather than a per-visitor control. `/_next/static/`
takes none, the files every page load fetches at once
(`scripts/checks/check_public_routes.py :: UNCEILINGED`).

**No location raises the action burst.** Next runs a server action by its header at any page's path,
so a block declaring a higher burst would raise every action's per-network ceiling, the sign-in's
among them; `scripts/checks/check_public_routes.py :: loosened` finds one. The registration's send
stays bounded by its Turnstile check and the confirmation's by its single-use token.

**Every page a mailed or shared link opens is metered on every request and every method**, on
`linkpage`: each request renders a page reading the database, or is the proxy's redirect into one
(`fl_frontend/src/core/mailedLink.ts`). No page links to one, so a visit is one request or two, never
a navigation's fan-out. **`/confirm/` is a prefix because every page under it is a link page**, so a
page added there is metered the day it exists; a link page anywhere else needs an exact match, as
`/registrierung` and `/erasure` have. **The burst of 440 is sized for the largest squad a season may
set**, 50 (`fl_backend/app/shared/schemas/bounds.py :: KADER_SIZE_MAX`), behind one school's address
in one break: each pupil opens the team's invite and their own link and sends each page's form, a
retry each, 10N requests passing within two minutes at the zone's rate. That squad's 4N sends on the
action key pass at `location /`'s burst in about three minutes, a send past it refused and sent
again. `scripts/checks/check_public_routes.py :: unsized_links` holds the burst to that maximum.

**A link page's location writes no error line at all** (`error_log /dev/null`). nginx writes every
error line with the request line whole, the query and the referrer with it, and the open-source
build has no switch over what a line carries, so a failing frontend or a body past the cap would
write a live token. Its access line still carries the path, the status, both durations and the
trace id. **A refusal writes no error line anywhere**, `limit_req_log_level` and
`limit_conn_log_level` sitting below the error log's own level. **Every other error line repeats
its request line**, an upstream failure's among them.

**A link page withholds the referrer**: `Referrer-Policy` is `no-referrer` there and
`strict-origin-when-cross-origin` elsewhere (`nginx/shared/http.conf :: map $uri $referrer_policy`).
The header binds from the response's first byte, where the page's own meta tag arrives after the
shell has asked for its assets.

**The mail provider's webhook is metered by no zone**: its events land at once from a handful of the
provider's addresses, and a refusal starts a retry schedule that, sustained, disables the endpoint.
Its signature check is the gate (`scripts/checks/check_public_routes.py :: UNMETERED`). **The
liveness probe carries no zone either**, which would throttle the uptime monitor before anything
else; the readiness probe, a database round trip each, spends `authapi`.

**Every route handler is accounted for against these locations, public or not**
(`scripts/checks/check_public_routes.py`): an exact match metering it, a prefix recorded at
`:: REASONS`, or a handler recorded unmetered at `:: UNMETERED`. No predicate selects the public
handlers, since nothing a handler imports or exports says whether it answers a stranger. A handler
under a dynamic segment is unmeterable unless a prefix covers it. Next's code-generated metadata
routes are accounted for at `:: METADATA` and reach Next through `location /`. A location serving
pages writes every meter line of the location it is carved out of.

**The body cap is nginx's default 1m wherever no location sets one**, which is Next's own bound on a
server action's body (`serverActions.bodySizeLimit`, left at its default in
`fl_frontend/next.config.ts`). A server action is posted at any path, so the bound holds everywhere.
A route handler bounding its body tighter takes its own cap at its location, its reason at the line.

**Every `429` the edge answers itself is one ASCII sentence under exactly `Content-Type: text/plain`,
but a page load's.** The server block's `error_page 429` sends a refusal by what the request asks
for (`nginx/shared/http.conf :: $edge_refusal_target`): a request naming `text/html` gets a page
with its way back to the site, written inline in `nginx/shared/site.conf`, and anything else the
sentence. Next 16.4.2 hands a server action's caller a failed answer's body as the error only under
exactly that type, and the frontend reads the sentence as a press that wrote nothing
(`fl_frontend/src/kit/edgeRefusal.ts`); a `charset` would make every refused press read as an
unclear save. The page withholds the referrer, its URL possibly carrying a link's token, and its
colours are the site's, copied by hand from `fl_frontend/src/app/tokens.css`, which
`nginx/edge_test.sh` holds them to name by name.

**The edge reaches each upstream by its service name as it serves**, never by an address read at
load: each `proxy_pass` names a variable, and nginx asks Docker's DNS again once its answer is ten
seconds old (`nginx/shared/http.conf :: resolver`). A recreated container comes back at another
address with no reload; until the cached answer lapses, a request sent to the old address answers
`502`.

**Every `/api/...` path but the two probes reaches Next**, some through a location naming it and the
rest through `location /`, which answers Next's 404 where nothing routes the path. The two probes are
exact matches so that nothing joins them. nginx merges slashes and resolves dot segments before it
picks a location, then forwards the request line as written, so `/api/v0//system/is_live` is
answered by FastAPI's own not-found body: no further route opens, but the body names the framework.

**A location declaring any `proxy_set_header` replaces the whole inherited set rather than extending
it.** That set mints the `traceparent` every upstream receives, a visitor's own discarded, so no
location declares one, and `nginx/edge_test.sh` fails a frontend location handing Next a visitor's
`traceparent`. **No upstream is handed the visitor's address**: neither application reads one, so the
set sends `X-Forwarded-For` and `CF-Connecting-IP` empty, which nginx drops.

**Production's edge holds three server blocks**, all plain HTTP on port 80: the connector carries
the visitor's HTTPS from Cloudflare, so no certificate is held here (§1.8). An unknown `Host` is
answered `421`. `www.frankfurtleague.de` redirects to the apex with the security headers, since
HSTS's `includeSubDomains` makes a returning browser ask for it over HTTPS, which Cloudflare answers
and the connector hands here. The apex tells Next its visitor's protocol is `https`, this hop's own
being plain HTTP. Both named blocks keep an idle connection 100 seconds, past the 90 the
connector keeps by Cloudflare's default, so nginx never closes one in the instant the connector writes a request onto it.

**A rule at Cloudflare may challenge a top-level navigation and never a server action's POST.** A
server action is a `fetch()` POST carrying a `Next-Action` header, and a `fetch()` renders no
interstitial: the challenge's HTML reaches React where a Flight stream was expected, and the throw
lands on the error boundary before any application code runs. The browser posts an action to the
address of the page it is on, and an action resolves from a process-wide module map with no
reference to that address, so an action is metered wherever it lands, by the action zone and on a
link page by `linkpage` besides. **A rate limit is the control that fits**, a status code being an
answer the caller can read.

### 1.4 Security headers

Every response carries four, each sent with `always`, from `nginx/shared/security_headers.conf`:

- `Strict-Transport-Security`, two years with `includeSubDomains` and no `preload`
- `X-Content-Type-Options`
- `Referrer-Policy`, by the page asked for (§1.3)
- `Content-Security-Policy`

**The policy is written once.** `nginx/shared/site.conf` includes the file at server level and again
in each location adding a header of its own, because `add_header` in a location replaces the
inherited set, and `nginx/prod/prod.conf`'s www redirect includes it too. The file also drops an
upstream's copy of each header, so a response carries the edge's alone and never a second enforcing
policy. `nginx/edge_test.sh` asks every location and the www redirect for each header, and compares
its value with the file's.

**`frame-ancestors 'none'` is the one framing rule.** CSP3 has it override `X-Frame-Options`, which
a browser enforcing the policy ignores, so the edge sends no `X-Frame-Options`.

**The one enforced policy keeps `'unsafe-inline'` on `script-src`, because Next cannot put a nonce
or a hash on the inline hydration scripts of a prerendered shell**, and every page here is one
(`cacheComponents` in `fl_frontend/next.config.ts`). Next's guide calls Partial Prerendering, which
`cacheComponents` turns on, "incompatible" with a nonce-based CSP, and its experimental SRI puts
`integrity` on script files alone: the installed release's copy,
`fl_frontend/node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`, and a Next
maintainer's open correction to it, <https://github.com/vercel/next.js/pull/96281>, both read
2026-09-25. A nonce for the stream beside build-time hashes for the shell and `'self'` for its chunks
would cover every script, and is refused: three mechanisms is a patchwork rather than a rule. The
compensating control is the `react/no-danger` rule in `fl_frontend/eslint.config.mjs`, which keeps
every HTML sink out of the application. **Revisit when the application renders user-supplied markup,
or when Next ships inline-script hashing that covers prerendered shells**, and at the first,
reconsider the policy, never the lint rule.

**`style-src` keeps `'unsafe-inline'` too, because two libraries every page loads inject a
`<style>` element at runtime**: React Aria's `usePress` adds its touch rule, which spares a tap the
browser's double-tap-zoom delay, and `next-themes` adds the rule that suspends transitions while it
applies the theme. Several components also set a runtime-computed inline `style` attribute, for
which CSP offers no nonce or hash. A strict `style-src 'self'` drops both elements with nothing
visibly broken and logs a violation on every page, and Next's own `_global-error` fallback would
render unstyled. A nonce is refused (2026-10-28): both libraries take it from a per-request value,
which a prerendered shell cannot carry. So is a hash of their style text, which changes with each
library's release.

**Cloudflare's `https://challenges.cloudflare.com` stands in `script-src` and in `frame-src`, and in
no other directive**: the bot check on the sign-in and the two public forms loads its script from
there and renders its widget in a frame of that origin. `nginx/edge_test.sh` fails a response whose
policy loses it from either. Cloudflare's own list for the check adds `connect-src 'self'` for
pre-clearance alone, which the widget does not use
(<https://developers.cloudflare.com/turnstile/reference/content-security-policy/>, read
2026-10-04).

**The rest of the policy is load-bearing and does not depend on `script-src`:** `frame-ancestors
'none'` blocks framing, `object-src 'none'` blocks plugin content, `base-uri 'self'` blocks base-tag
hijacking, and `form-action 'self'` blocks exfiltration through a form post.

### 1.5 The environments

`scripts/README.md` lists the scripts; each script's own header carries its usage and prints it with
`--help`.

| Environment | What it is                                             | Database                                                                       | Entry point                                                                                             |
| ----------- | ------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| **dev**     | source with hot reload, no Docker                      | the one the URI files under `secrets/` name ([`runbooks.md`](runbooks.md) §16) | `pnpm dev` in `fl_frontend/` · `SECRETS_DIR=../secrets uv run fastapi dev app/asgi.py` in `fl_backend/` |
| **local**   | the production images built from your tree, with nginx | its own, inside the stack (`docker-compose.local.yml :: mongo`)                | `./scripts/ops/local.sh`                                                                                |
| **e2e**     | the local stack again, for the Playwright journeys     | its own, with the made-up seed, new on every start (`docker-compose.e2e.yml`)  | `./scripts/ops/local.sh --e2e`                                                                          |
| **prod**    | published images on the server, never built there      | the managed cluster                                                            | `./scripts/ops/deploy.sh`                                                                               |

**local is the only place a packaging problem is visible before a deploy**: a missing standalone
file, a failing startup gate, a header nginx does not set. dev exercises none of that machinery, and
prod only pulls. `local.sh` refuses to start anywhere but Windows, and `deploy.sh` anywhere but
Linux.

**Each application service reads its own package's `.env` and no other**, and every credential is a
file under `secrets/` (§1.2). **On the server, the `.env` beside the compose file holds the deploy's
pin alone** ([`runbooks.md`](runbooks.md) §1). Compose reads it for every command, and refuses to
parse `docker-compose.yml` without a `TAG`. **The frontend's `dev` script sets `SECRETS_DIR` itself**,
to the checkout's `secrets/`, because `fl_frontend/.env` also reaches the frontend container, where
a path written there would turn the frontend away from the secret's mount.

**The local stack is `docker-compose.local.yml` merged over `docker-compose.yml`**, so only what the
override writes differs, and each difference is argued at its key. It builds both images from the
tree, adds a `mongo` service publishing 27017 on loopback, serves nginx on `127.0.0.1:3000`, never
starts the connector, and logs to `json-file`, Docker Desktop having no journald. **Both application
services read its own database through one inline config**,
`docker-compose.local.yml :: local_mongodb_uri`, which names the stack's `mongo` and holds no
credential, so no machine needs a login to run it. It sets `APP_ENV` to `local` and hands the
frontend no key to the mail provider, so every mail lands in the sink, `.tmp-mail/`, which each
start empties of what earlier runs filed.

**The local database starts empty, and `--seed-made-up` fills it with the made-up league**
(`scripts/ops/seed/seed.js`): three seasons, ten clubs, venues, referees and grants, every one
invented and every date relative to today, replacing the records of every collection of the
application database and leaving `auth` as it is. `--fresh` deletes the volume, and the database
with it.

**A seed is in place before anything renders a page**, so no empty read is cached. The made-up seed
loads once the backend's boot has built every index, and `python -m app.readback` then reads every
document it wrote back through its record model; only then do the frontend and nginx start.

**The local stack starts with an empty `auth`, and a sign-in builds it.** The grants deciding which
administrator may sign in arrive with the made-up seed, so a `--fresh` stack admits nobody until
one is written, and anybody else is offered a sign-in only where the local backend holds records
for their address (`fl_frontend/src/core/signInGate.ts :: mayReceiveSignIn`). **A sign-in alone does
not reach `/admin` there**: the code stamps its session `code` where the admin guard wants `passkey`
(`fl_frontend/src/core/auth/guards.ts :: isAdminSession`), so `/signin/passkey` offers an enrolment
first, bound to this machine's own authenticator and to `localhost`, the relying party the local
`AUTH_URL` gives. Every machine, and every `--fresh`, enrols again.

**`./scripts/ops/local.sh --e2e` starts the end-to-end stack instead** (`docker-compose.e2e.yml`,
merged over the local stack's two files):

- a Compose project of its own, `frankfurtleague-e2e`, so its volume and its sign-in store are
  never the local stack's;
- its settings written in that file rather than read from either package's `.env`;
- its keys generated under `.tmp-e2e/` on every start rather than read from `secrets/`;
- the made-up seed on an empty volume every start;
- the local edge with every rate and connection limit counting and refusing nothing
  (`nginx/e2e/e2e.conf`), since every journey arrives from one address. `nginx/edge_test.sh` proves
  the limits instead.

Both stacks publish ports 3000 and 27017, so one runs at a time. `--e2e --down` deletes the volume
and `.tmp-e2e/`. The journeys run against it with `pnpm run e2e` in the `fl_frontend` of the checkout
that started it, which reads that checkout's `.tmp-e2e/`, or from another checkout with `E2E_DIR`
naming that folder (`fl_frontend/e2e/support/journey.ts :: E2E_DIR`); `E2E_BASE_URL` names an origin
other than `http://localhost:3000` (`fl_frontend/playwright.config.ts`).

**The checkers are Python, and one kernel makes their answers comparable**,
`scripts/lib/checker_kernel.py` (§1.7). **The interpreter floor is bash's**
(`scripts/lib/_lib.sh :: PYTHON_FLOOR`), asked at every entry point before a checker is handed a
file: below it a checker dies compiling and Python exits 1, which this scale reads as a finding
about the change.

**Registry pruning stays manual and optional**, a botched delete destroying the builds a hand
rollback pulls ([`runbooks.md`](runbooks.md) §1). When pruning, keep roughly the last five `sha-`
tags per package, never the one the server's `.env` pins, and never an **untagged version created
alongside a tag still in use**: BuildKit provenance attestations the tagged image references by
digest, so deleting one corrupts the tag it belongs to.

### 1.6 The verification gate

`./scripts/gate/verify.sh --help` lists the scopes and their flags; a bare run starts every scope
side by side and replays each one's output in the order below. `--quick` runs the scripts, backend
and frontend scopes alone, none of which needs Docker.

| Scope              | Runs                                                                                                                                                                                                               | Needs                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `--scripts`        | `selfcheck.sh`, `ruff` and `pyright` over the Python in `scripts/`, and the pytest suite in `scripts/tests/`                                                                                                       | the backend venv, `pytest` included; shellcheck and actionlint at their pinned releases from PATH, else Docker                                 |
| `--docs`           | no conflict marker, whitespace error or invisible character in any tracked file; and lychee, offline, over every link and fragment inside the repository                                                           | Docker for lychee                                                                                                                              |
| `--backend`        | `uv lock --check` alone and first, then `ruff`, `pyright`, `pytest` (default tier) and `deptry` over `app/`                                                                                                        | the backend venv, and for the lockfile check a uv inside `fl_backend/pyproject.toml`'s `required-version` range; any other refuses at start-up |
| `--format`         | Prettier in check mode over the whole repository, then markdownlint over every Markdown file                                                                                                                       | pnpm install                                                                                                                                   |
| `--frontend-units` | the unit tests `fl_frontend/package.json`'s `test` script finds under `fl_frontend/`                                                                                                                               | pnpm install                                                                                                                                   |
| `--frontend`       | the frozen lockfile, peer and dedupe checks, `next typegen`, tsc, eslint, both knip runs and `next build`, then the dependency audit, an advisory that never fails the scope                                       | pnpm install                                                                                                                                   |
| `--ops`            | zizmor audits `.github/`; both stacks parse; `check_compose_model.py` judges both models; `check_public_routes.py` accounts for every route; nginx accepts `prod.conf`; `nginx/edge_test.sh` drives a running edge | Docker, `uv` for zizmor at `scripts/gate/zizmor/requirements.txt`'s pin, and the backend virtualenv                                            |
| `--db`             | the contract and its client generated into an ignored scratch folder and compared with the committed ones, then `pytest -m db` over the backend and `pnpm run test:db` over `*.db.test.ts`                         | venv + pnpm install + Docker                                                                                                                   |
| `--images`         | both `docker build`s, then what a build does not prove: `instrumentation.js` present, neither image running as uid 0, neither holding a file its dockerignore excludes                                             | Docker                                                                                                                                         |

**CI runs every scope on every event**, one job per scope in `.github/workflows/verify.yml`, each
running `./scripts/gate/verify.sh` with that scope's flag. Beside them:

- **`journeys`** runs the Playwright journeys against the end-to-end stack, raised from the images
  the `images` job built, in two legs, each on a runner and a stack of its own: `desktop` with
  `first-pass`, and `phone`.
- **`verify`**, the required check, fails on a job that failed, was cancelled or was skipped, and on
  a job missing from its `needs:`.
- **`publish`**, on a push to `main` that `verify` passed, pushes the two images the `images` job
  built and checked under their `sha-` tags, building nothing again.

**Every CI job that needs the backend virtualenv creates it through
`.github/actions/backend-toolchain/action.yml`**, on the uv the backend image copies in (§1.1).

**knip runs twice and refuses what nothing reads, then what only tests read**, so what a change
leaves unused is removed in that change. The default run (`fl_frontend/knip.json`) refuses a file,
an export or a dependency nothing imports, a test included. The production run
(`fl_frontend/knip.production.json`) drops the tests and refuses a file or an export no production
code reads; a value a test compares on purpose carries `@internal`. Each file names, beside each
ignore, the reader knip cannot see, and a configuration hint fails either step as a finding does.

**An editor formats earlier still**: `.vscode/settings.json` names the module, the configuration and
the ignore file the gate itself reads. `.editorconfig` carries the same conventions to the files
Prettier never opens, and stays clear of every setting `.prettierrc.json` decides.

**Every untracked file a run leaves is gitignored where it lands**, the caches of `tsc` and Prettier
among them. eslint runs uncached: its typed rules read other files' types, which its per-file cache
never keys on. **Outside CI the two Next commands install as well as write**: handed a missing
`typescript` or `@types/*` package, `next typegen` and `next build` add it to `node_modules` rather
than failing, where a runner takes the refusing branch, keyed off Next's own `isCI`.

**One tracked file a gate run writes is not a formatter's doing**: `next typegen` and `next build`
each rewrite `fl_frontend/tsconfig.json` where a `compilerOptions` key is absent (Next's
`writeConfigurationDefaults`), so the frontend job diffs that one path after the scope and fails on
it.

**A manifest is compared against its lockfile before anything reads the installed tree**: the
frontend scope resolves the lockfile against `package.json` and the backend scope runs
`uv lock --check`, both cheap.

**Nothing reads the diff to choose a scope**, so only the bare run is sure to cover a change, and it
is the run a pull request is called ready to merge on.

**The scripts scope lints and type-checks its own Python through configurations at the top of
`scripts/`**: a root configuration would become the nearest one for `fl_backend/` too, and a copy
inside one of the five directories would reach that directory alone. `scripts/ruff.toml` `extend`s
the backend's configuration and adds nothing; `scripts/pyrightconfig.json` pins the Python version
rather than letting pyright infer one per machine. **A checker resolves `scripts/lib/` for itself**,
each entry point inserting it at its own top, and `pyrightconfig.json`'s `extraPaths` is the second
listing of that fact.

**The ops scope exists because the compose files and the nginx configuration have no compiler.**
`nginx -t` parses and sees no response, so `nginx/edge_test.sh` starts the checkout's own edge as
`docker-compose.yml` starts it and grades what it wrote, sent and answered:

- no mailed link's query in an access line;
- a visitor's `traceparent` replaced;
- each security header sent once;
- a link page writing no error line;
- every zone and the connection ceiling refusing past their figure;
- both body caps it drives.

`scripts/checks/check_compose_model.py` reads the models `docker compose config` renders,
production's alone and the merged local pair, and holds each to §2's rows. A model it cannot read is
a refusal rather than a verdict (§1.7).

**The images scope exists because code that compiles can still fail to build inside the image**, or
be left out of the standalone output. **Both test tiers run**: the `db`-marked tests need a real
`mongod`, so they are a scope of their own.

### 1.7 Script conventions

Every script sources `scripts/lib/_lib.sh`, which applies strict mode, installs the error and
interrupt traps, and carries the guards and the output verbs below. A script resolves the
repository root itself, so it behaves the same from any working directory, and parses its arguments
before any environmental check, so a typo fails at once rather than after a Docker probe.

**A path answers what a file is before the file is opened**: the directory names the category, the
prefix names the class, the stem names the subject, and the extension names the harness.

| Part        | Reads as                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check_`    | A checker: it judges one subject and exits on `scripts/lib/checker_kernel.py`'s contract                                                          |
| `_`         | Sourced by another script and never run on its own                                                                                                |
| no prefix   | Run directly, by a person, by CI or by another script as a subprocess                                                                             |
| `.sh` `.py` | bash, and Python at the version `fl_backend/.python-version` pins: the backend virtualenv's, or a CI job's own where no step needs the virtualenv |
| `.mjs`      | node, taken only where the subject needs a parser bash and Python do not have                                                                     |

`scripts/lib/checker_kernel.py` is the one name the scheme does not classify: it is imported rather
than run, so the `_` marking a sourced script would say the wrong thing about it.

**The output standard.** One vocabulary, one verb per meaning, and no script writes formatting of its
own:

| Verb          | Means                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------- |
| `section`     | Opens a phase group, closing the one before it, and one fold in the Actions log          |
| `end_section` | Closes the open group without ending the run, for a line that belongs outside every fold |
| `step`        | Opens a step and starts its timer                                                        |
| `ok`          | The step passed, with the time it took                                                   |
| `info`        | Neutral detail                                                                           |
| `warn`        | An advisory: a problem the run is meant to survive, on stderr                            |
| `fail`        | A finding recorded, the run continuing, for a caller collecting several before it ends   |
| `die`         | A finding that ends the run, on stderr                                                   |
| `refuse`      | The check ran and its answer cannot stand as a verdict, so the run ends without one      |
| `detail`      | Supporting output belonging to the line above it, from arguments or from stdin           |
| `finish`      | Ends a run that reached its end, printing the closing table and statement                |

| Helper    | Answers                                                                                                          |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| `verbose` | True where `--verbose` was passed; called bare in a condition, where a false answer is a status `set -e` acts on |
| `quietly` | Runs a command with both streams captured into `QUIETLY_OUTPUT`, replayed only where the command fails           |
| `usage`   | Prints the calling script's own header block as its help, so a script's help cannot drift from the script        |

**A run has exactly one ending, and its exit code names which.** A caller that cannot tell "the
change needs work" from "the check never ran" acts on the wrong one.

| Ending        | Exit      | What it says                                                                           |
| ------------- | --------- | -------------------------------------------------------------------------------------- |
| `green`       | 0         | Everything that ran passed; a run covering every scope adds that it is safe to merge   |
| `findings`    | 1         | The change needs work, and each finding names what, in the section it came from        |
| `refused`     | 2         | A check declined to judge its input, so nothing here stands as a verdict on the change |
| `crashed`     | 3 or more | The script itself failed, so nothing past that line ran                                |
| `interrupted` | 130       | Ctrl-C or a hangup: the sections that had opened are all there is, none a verdict      |

The checkers answer on the same scale: `scripts/lib/checker_kernel.py` fixes 0 for a pass, 1 for
findings, 2 for a check that could not judge its input and 3 or more for a broken environment, in
one place. `deploy.sh` keeps the scale's meaning for a deploy: 1 a failed deploy, 2 a refusal with
the stack unchanged ([`runbooks.md`](runbooks.md) §1).

**Colour is decided centrally, through `FL_GATE_COLOR` ahead of everything else**: the gate's own
variable, how `verify.sh` hands each scope's run its answer without exporting one every tool would
take as an instruction.

**`--verbose` streams each tool's own output instead of capturing it**, the one thing a captured run
cannot give back afterwards; `verify.sh` and `nginx/edge_test.sh` take it.

### 1.8 The edge's declared state

Every setting below is made in the Cloudflare dashboard or the mail provider's, and no gate check,
deploy step or test here can read one: a change made there is invisible until something breaks (§4).
[`overview.md`](overview.md#the-cloudflare-proxy) carries the performance settings that are
deliberately off.

- **A remotely managed tunnel is the only route to the origin**, its public hostnames
  `frankfurtleague.de` and `www.frankfurtleague.de`. Each routes to `http://nginx:80` over
  `frankfurtleague-net`, plain HTTP, since nginx holds no certificate and listens on port 80 alone
  (`nginx/prod/prod.conf`). **The dashboard is where its token is issued**, and the server holds the
  issued value at `./secrets/tunnel_token` (§1.2). Each hostname's DNS record is the tunnel's own,
  so the zone holds no record naming the origin's address.
- **Cloudflare answers every plain-HTTP request itself** with a `301` to `https://` on the same host
  (observed 2026-10-20 as `Server: cloudflare` on that answer for both hostnames). Which setting
  answers is inferred rather than read: Always Use HTTPS fits, and a redirect rule would answer the
  same. A browser ignores HSTS sent over plain HTTP, so this redirect is what moves a first visit
  typed as `http://` onto HTTPS.
- **Email Routing receives every message sent to the domain and only forwards it**: the zone's MX
  records name Cloudflare's routing servers, and each league address forwards to the personal
  mailboxes of the organisers who answer it, the league holding no mailbox. The published privacy
  notice at `/datenschutz` says exactly that, so a route aimed at a hosted mailbox changes that notice
  in the same step.
- **The AI-bot controls admit an agent and refuse a trainer**: AI training blocked, AI agents
  allowed, AI search allowed. An agent fetching a page for a person is a visitor; a crawler filling
  a training set is not.
- **The managed `robots.txt` declares the training opt-out, and it is off until the owner switches
  it on.** Cloudflare prepends its list of AI-training crawlers to the origin's `/robots.txt`
  (<https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/>), and
  `fl_frontend/src/app/robots.ts` writes one rule for every crawler alike, so while the setting is
  off the block above enforces the opt-out and nothing declares it.
- **A Turnstile widget serves the bot check**, in Managed mode, on the hostname
  `frankfurtleague.de` alone, `www` redirecting before any form renders. Its site key is the
  server's `TURNSTILE_SITE_KEY` and its secret `./secrets/turnstile_secret_key` (§1.2); that the
  widget shows only when Cloudflare asks for a click is the page's own `appearance`
  (`fl_frontend/src/kit/useBotCheck.tsx`), and the mode the dashboard's.
- **The mail provider's sending domain carries a delivery webhook**, whose endpoint the provider's
  dashboard holds, **and it points at production alone**: no other deployment holds the webhook's
  signing key (`fl_frontend/src/core/config.ts :: PRODUCTION_ONLY_REQUIRED`), so an endpoint aimed
  anywhere else has every event refused unverified.

## 2. Invariants

| Invariant                                                                                                                                  | Enforced by                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production publishes no port, and the local stacks publish on loopback alone                                                               | `scripts/checks/check_compose_model.py :: production` and `:: local`, over the models `docker compose config` renders                                                                  |
| Production declares exactly `frontend`, `backend`, `nginx` and `cloudflared`, and no database                                              | `scripts/checks/check_compose_model.py :: PRODUCTION_SERVICES`                                                                                                                         |
| Only nginx shares a network with the connector, and only nginx with the application pair, in both stacks                                   | `scripts/checks/check_compose_model.py :: networks`                                                                                                                                    |
| Every service drops every capability and sets `no-new-privileges`; nginx alone adds any back, `CHOWN`, `SETUID` and `SETGID`               | `scripts/checks/check_compose_model.py :: privileges`; `nginx/edge_test.sh` starts nginx with them                                                                                     |
| Every credential reaches a service as a Compose file secret, held by exactly the services that read it, from its own file under `secrets/` | `scripts/checks/check_compose_model.py :: secret_holders` over `:: SECRET_HOLDERS`, and `:: secrets_directory`                                                                         |
| No service's environment names a value a secret file holds, in any letter case                                                             | `scripts/checks/check_compose_model.py :: moved_names`                                                                                                                                 |
| Each application service reads its own package's `.env` and no other                                                                       | `scripts/checks/check_compose_model.py :: env_files`, over the models rendered from the gate's stand-ins                                                                               |
| The frontend's `APP_ENV` is each stack's own, written above the package's file                                                             | `scripts/checks/check_compose_model.py :: deployment_name`                                                                                                                             |
| Both edges mount their configuration from `nginx/` by directory, and trust the connector's rendered address alone                          | `scripts/checks/check_compose_model.py :: edge_mounts` and `:: trusted_connector`                                                                                                      |
| Each security header is sent once, as `nginx/shared/security_headers.conf` writes it, on every location and the www redirect               | `nginx/edge_test.sh`                                                                                                                                                                   |
| No mailed link's query reaches an access line, and every access line holds its request's trace id                                          | `nginx/edge_test.sh`                                                                                                                                                                   |
| A visitor's `traceparent` never reaches an upstream                                                                                        | `nginx/edge_test.sh`                                                                                                                                                                   |
| Each upstream is named through a variable and found through Docker's DNS, so a recreated container needs no reload                         | `nginx/edge_test.sh`                                                                                                                                                                   |
| Each zone and the connection ceiling refuse past their figure with the edge's `429`                                                        | `nginx/edge_test.sh`, which reads each figure off the configuration it judges                                                                                                          |
| Every route handler, link page and metadata convention is metered or accounted for at the edge                                             | `scripts/checks/check_public_routes.py`, its rules driven red in `scripts/tests/test_check_public_routes.py`                                                                           |
| A link page's location writes no error line, withholds the referrer, and takes a burst sized for the largest squad                         | `scripts/checks/check_public_routes.py :: unlogged_links`, `:: referring_links` and `:: unsized_links`; `nginx/edge_test.sh`                                                           |
| Every image this repository does not build is pinned by tag and digest                                                                     | `scripts/tests/test_image_pins.py`                                                                                                                                                     |
| The frontend image's Node, the backend image's Python series and its uv are the ones the checkout and CI run                               | `scripts/tests/test_image_pins.py`                                                                                                                                                     |
| Every gate scope has one CI job, and every job but `journeys`, `verify` and `publish` runs one scope                                       | `scripts/tests/test_gate_jobs.py`; the `verify` job holds every job to its `needs:`                                                                                                    |
| Scripts carry the git executable bit                                                                                                       | `scripts/gate/selfcheck.sh`, its second step                                                                                                                                           |
| Production never builds                                                                                                                    | unenforced: `docker-compose.yml` declares no `build:`, and `deploy.sh` only pulls                                                                                                      |
| The builder stage has no reachable backend and no real environment                                                                         | `fl_frontend/Dockerfile`'s `SKIP_ENV_VALIDATION=true`, with no secrets directory and no `API_URL`                                                                                      |
| The three API keys are 64 printable ASCII characters without the space, one file each that both sides read                                 | `fl_frontend/src/core/config.ts :: INTERNAL_API_KEY` and `fl_backend/app/core/config.py :: INTERNAL_API_KEY_CHARACTERS`                                                                |
| A startup refusal names the failing variables or secret files, or a failure type, and never a value                                        | `fl_backend/app/core/config.py :: get_config`, held by `fl_backend/tests/core/test_config.py`; the frontend's `fl_frontend/src/core/config.ts :: refuseInvalidEnvironment`, unenforced |
| A stopped backend container lets every request it accepted end inside its bound before the engine kills it                                 | `fl_backend/Dockerfile`'s `CMD` and `docker-compose.yml`'s `stop_grace_period`; `fl_backend/tests/core/test_request_deadline.py :: TestAStoppedContainerOutlastsEveryRequest`          |
| A stopped frontend container lets every request it accepted, and the work behind each answer but the mail drain, end inside its bound      | unenforced: `docker-compose.yml`'s `stop_grace_period` is set against `fl_frontend/src/core/requestScope.ts :: REQUEST_DEADLINE_MS` and `:: AFTER_RESPONSE_DEADLINE_MS`                |
| The catch-all makes a route handler reachable the moment it exists, its own authorization the only guard in front of it                    | unenforced: nothing sweeps a new route handler for its guard                                                                                                                           |
| FastAPI's `/docs`, `/redoc` and `/openapi.json` are served by nothing; the committed `fl_backend/openapi.json` is the one document         | unenforced: `fl_backend/app/main.py` builds the app with `openapi_url=None`                                                                                                            |
| One `frontend` service and no replica count, so each job holds one timer per process with no lease                                         | unenforced: nothing refuses a second service or a `deploy.replicas`                                                                                                                    |
| A Cloudflare challenge may meet a top-level navigation and never a server action's POST or an `/api/*` route                               | unenforced: nothing in this repository can read a Cloudflare rule                                                                                                                      |

## 3. Violation → remedy

| Symptom                                                                                                                                                                            | Cause                                                                                                                                         | Remedy                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Invalid environment variables: <NAMES>` then no traffic                                                                                                                           | The startup gate                                                                                                                              | Fix those names in the package's `.env`, then recreate the service ([`runbooks.md`](runbooks.md) §16)                                                                                                                |
| `Invalid secret files: <FILES>` then no traffic                                                                                                                                    | A secret file is missing, or holds a value the gate refuses                                                                                   | Write the file named; its value is never printed                                                                                                                                                                     |
| `Unreadable secret files: <PATH> (<ERRNO>)` then no traffic                                                                                                                        | The service's user cannot read the file or `SECRETS_DIR`: `EACCES` its owner or mode, `EISDIR` a directory at its path, `ENOENT` no directory | Give it the user and mode §1.2 names, or write the file                                                                                                                                                              |
| `docker compose` refuses: `deploy through scripts/ops/deploy.sh, which sets TAG`                                                                                                   | No `.env` pins a tag in this checkout, and the shell names none                                                                               | On the server, deploy; to reach a build by hand, prefix the command with `TAG=sha-…` ([`runbooks.md`](runbooks.md) §1)                                                                                               |
| A deploy reports live but the site is unreachable                                                                                                                                  | nginx, or the connector in front of it                                                                                                        | `docker compose logs nginx`, then `docker compose logs cloudflared`                                                                                                                                                  |
| No tunnel registers, or the connector restarts in a loop                                                                                                                           | The token file is missing, unreadable by uid 65532 or not this tunnel's                                                                       | `docker compose logs cloudflared`, then give the file the owner and mode §1.2 names                                                                                                                                  |
| The tunnel is up and Cloudflare answers 502 or 1033                                                                                                                                | The dashboard routes a hostname to nothing, or to anything but `http://nginx:80` (§1.8)                                                       | `docker compose logs cloudflared` names the origin it dialled. The route is dashboard state, so nothing here can be edited to fix it                                                                                 |
| An `up` fails: `Pool overlaps with other one on this address space`                                                                                                                | Another Docker network on this host holds `172.30.0.0/24`, which `docker-compose.yml` declares so the connector's address is fixed            | Find it with `docker network inspect`, then remove or re-subnet it; moving this stack's subnet moves the connector's address                                                                                         |
| A deploy fails: nginx's running master refused the configuration `nginx -t` passed                                                                                                 | A change nginx takes only at a start, such as a zone keyed anew under its old name                                                            | The run prints nginx's line. Restart nginx, `docker compose restart nginx`, which loads the checkout's files afresh                                                                                                  |
| `failed to connect to the docker API at npipe:...`                                                                                                                                 | Docker Desktop is not running                                                                                                                 | Start it and wait for it to settle                                                                                                                                                                                   |
| The publish job in `.github/workflows/verify.yml` fails at the push with `denied` or `permission_denied`                                                                           | The package does not grant this repository's workflows write access                                                                           | Package settings → Manage Actions access → add this repository with the Write role, then re-run the job                                                                                                              |
| `EBUSY`, or `.next` locked during a build                                                                                                                                          | A `pnpm dev` is still running, or the folder is open in an editor                                                                             | Stop the dev server; nothing else may hold port 3000 while the local stack runs                                                                                                                                      |
| `./scripts/ops/local.sh` reports `mongo` unhealthy                                                                                                                                 | The local database has not elected itself primary, so no transaction opens                                                                    | Read the lines the script prints under `mongo`'s step                                                                                                                                                                |
| A db-tier run reports a wall of failures naming unique indexes                                                                                                                     | A second `pytest -m db` ran beside it on the same machine                                                                                     | Trust neither verdict, the green one included. Re-run with nothing else on the tier                                                                                                                                  |
| Container unhealthy, health log empty, `FailingStreak: 0`                                                                                                                          | The app died before the first probe                                                                                                           | Read `docker compose logs <service>`; a malformed `.env` value is the usual cause                                                                                                                                    |
| A directory appeared named `something;C`                                                                                                                                           | MSYS rewrote a POSIX-looking path in a hand-typed `docker run -v`                                                                             | Delete it, and prefix the command with `MSYS_NO_PATHCONV=1`                                                                                                                                                          |
| `UnicodeEncodeError: 'charmap' codec` from `fastapi dev`                                                                                                                           | Windows only, when the output is piped or redirected                                                                                          | The CLI banner needs UTF-8. Prefix the command with `PYTHONUTF8=1`                                                                                                                                                   |
| A response without the security headers                                                                                                                                            | A `location` block set a header and dropped the inherited set                                                                                 | Include `nginx/shared/security_headers.conf` in that block                                                                                                                                                           |
| Backend healthcheck fails after an API version bump                                                                                                                                | The healthcheck spells the API version itself                                                                                                 | Move the path in `docker-compose.yml`'s backend healthcheck, and in `nginx/shared/site.conf`'s two probe locations with it (§4)                                                                                      |
| The uptime monitor 404s while the backend container reports healthy                                                                                                                | The liveness location still spells the old version, so the probe matches `location /` and Next answers it                                     | Move the path in `nginx/shared/site.conf`'s probe locations, then re-point the monitor (§4)                                                                                                                          |
| Uptime monitor shows green during a backend outage                                                                                                                                 | The error page streams after headers, so the edge status is 200                                                                               | Monitor `GET https://frankfurtleague.de/api/v0/system/is_live` at the apex host: a trailing slash redirects and reads green, a `HEAD` is answered 405 (`fl_backend/app/api/system/router.py :: check_is_live`, §1.3) |
| Sign-in or a link page answers `429`                                                                                                                                               | Working as intended: one network spent its zone (§1.3)                                                                                        | Nothing. A retry once the zone refills passes, a link's token still in the address bar                                                                                                                               |
| Reference data stale after a hand edit: the first visit a minute past an entry's fill still gets that entry, and one nobody visits expires after one hour (`cacheLife("minutes")`) | Working as intended: a change no save makes clears no cached entry                                                                            | Nothing: wait out the lifetime ([`runbooks.md`](runbooks.md) §20)                                                                                                                                                    |
| League table or fixtures stale after a season edit                                                                                                                                 | Same cause: a season decides the default season and the points                                                                                | Same remedy                                                                                                                                                                                                          |

## 4. Known-open

| Item                                                              | State                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The API version is spelled outside `API_VERSION`                  | Open: `fl_frontend/src/core/api.ts :: BASE_FETCH_PATH`, which the generated client's paths must start with, `docker-compose.yml`'s backend healthcheck, `nginx/shared/site.conf`'s two probe locations and `nginx/edge_test.sh`; §3 carries two symptoms |
| A deploy's verdict reads no page                                  | Accepted: health is each container's healthcheck and nginx's reload, so a site whose every page errors can pass ([`runbooks.md`](runbooks.md) §1)                                                                                                        |
| Going back moves the images alone                                 | Accepted: the compose file and `nginx/` stay as pulled, so the newer configuration fronts the older build                                                                                                                                                |
| Registry tag pruning is manual                                    | Accepted: a botched delete destroys the builds a hand rollback pulls (§1.5)                                                                                                                                                                              |
| Revoking admin access ends no session                             | Accepted: both processes read the grant on every request, so a revoked one admits nothing from the next and nothing restarts                                                                                                                             |
| Nothing announces that a season rollover is due                   | Accepted: nothing in the running application watches the season clock; the trigger to revisit is a rollover actually missed, which serves last season silently                                                                                           |
| Traffic between containers is plain HTTP                          | Accepted: the admin key and the actor headers cross `frankfurtleague-app` unencrypted, a bridge on one host no container can read, none holding `NET_RAW`                                                                                                |
| The local database runs unauthenticated                           | Accepted: authentication on `--replSet` wants a keyfile whose permissions `mongod` checks, which a Windows host does not reliably give it (`fl_backend/tests/conftest.py :: _replica_set_mongod`)                                                        |
| The linter behind §1.4's compensating control is past end of life | Open: `fl_frontend/package.json` holds eslint at a line taking no further fix, and both §1.4's `react/no-danger` control and `--frontend`'s lint step run on it                                                                                          |
| Cloudflare may rewrite the edge's own 429                         | Open: whether the tunnel passes the sentence, the page and their `Content-Type` unchanged shows only in production, on a refusal (§1.3)                                                                                                                  |
| The edge's declared state is enforced by nothing here             | Accepted: §1.8 records what the Cloudflare dashboard holds, and no gate check, deploy step or test can read any of it                                                                                                                                    |
| The journal's age limit is enforced by nothing here               | Accepted: it is a host drop-in ([`runbooks.md`](runbooks.md) §7), which no deploy reads                                                                                                                                                                  |
| CI's Python can be another patch release than the image's         | Accepted: uv takes every CI job's interpreter from the series `fl_backend/.python-version` names, while the image holds the release its tag names until Dependabot moves it                                                                              |
| A runtime's security release waits for Dependabot's schedule      | Accepted: Dependabot has no base-image security updates, so a Node or Python fix waits for the weekly run and cooldown, eight days at worst                                                                                                              |
| An unread `*Schema` passes both knip runs                         | Open: the production run counts its inferred type's `typeof` as its module's use, and both runs ignore that type: reading alone finds it                                                                                                                 |
