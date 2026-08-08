# Ops — spec

**Verified against:** `09f903d`, 2026-08-08
**Scope:** `docker-compose*.yml`, `nginx/`, `scripts/`, both Dockerfiles

Operational procedures live in [`../../scripts/README.md`](../../scripts/README.md). This page covers
the contracts and constraints those procedures depend on.

---

## 1. Services

| Service    | Image                                            | Ports published | Resource limits                   | Health check                         |
| ---------- | ------------------------------------------------ | --------------- | --------------------------------- | ------------------------------------ |
| `frontend` | `ghcr.io/felzab/frankfurtleague-frontend:latest` | none            | 1.5 CPU / 2 GB, 512 MB reserved   | `wget` on `/favicon.ico`             |
| `backend`  | `ghcr.io/felzab/frankfurtleague-backend:latest`  | none            | 0.8 CPU / 512 MB, 128 MB reserved | `urllib` on `/api/v0/system/is_live` |
| `nginx`    | `nginx:alpine`                                   | **80, 443**     | 0.5 CPU / 256 MB, 128 MB reserved | none                                 |

All three: `restart: unless-stopped`, `cap_drop: ALL`, `no-new-privileges:true`, JSON file logging
capped at 3 × 10 MB. All on the `frankfurtleague-net` bridge network.

`nginx` declares `depends_on` both services with `condition: service_healthy`.

**Note:** the backend healthcheck hardcodes `/api/v0/...`, and so does the backend — `API_VERSION` in
`app/core/config.py` is a **constant, not an environment variable**. The version is a property of the
code that implements it, so an environment able to set it could serve `/api/v2/` from code
implementing v0. Bumping it is a code change, made in the same commit as this healthcheck.

## 2. Mounts

| Host path           | Container path                   | Mode      |
| ------------------- | -------------------------------- | --------- |
| `./nginx/prod.conf` | `/etc/nginx/conf.d/default.conf` | read-only |
| `./certs`           | `/etc/nginx/certs`               | read-only |

Both are files or directories that must exist before `up`. If a mounted config file is missing, Docker
creates a **directory** at that path and nginx fails with `not a directory` — `deploy.sh` checks for
this before starting.

## 3. nginx routing

Longest-prefix match. Order in the file is irrelevant; specificity decides.

| Location              | Upstream        | Notes                                                                               |
| --------------------- | --------------- | ----------------------------------------------------------------------------------- |
| `/api/auth`           | `frontend:3000` | Auth.js — more specific than `/api`, so it wins                                     |
| `= /api/client-error` | `frontend:3000` | Next route handler, `limit_req zone=clienterr` ([`docs/logging.md`](../logging.md)) |
| `/api`                | `backend:8000`  | Everything else API                                                                 |
| `= /signin`           | `frontend:3000` | `limit_req zone=signin burst=3 nodelay`                                             |
| `/_next/static/`      | `frontend:3000` | `expires max`, `Cache-Control: public, max-age=31536000, immutable`                 |
| `/`                   | `frontend:3000` | Catch-all                                                                           |

Server blocks: port 80 redirects to HTTPS and strips `www.`; a `default_server` block on 443 rejects
unknown hosts with `ssl_reject_handshake`; a second HTTPS block serves `www.frankfurtleague.de` and
301s to the apex; the real server block serves `frankfurtleague.de`.

**The www block over HTTPS is not redundant with the port-80 redirect.** HSTS carries
`includeSubDomains`, so a browser that has visited once forces `https://` on `www` and never issues
the plaintext request the port-80 block would have caught. Without a `www` HTTPS block that request
matches the catch-all and has its handshake rejected — observed 2026-08-01 as a public `525`.

**A Cloudflare proxy sits in front of nginx** (see the [overview](overview.md)), so a visitor's TLS
terminates there and an origin-side failure can surface as a Cloudflare status code that names
neither nginx nor the block responsible.

Proxy headers set globally: `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`,
`X-Forwarded-Host`, `X-Forwarded-Port`, HTTP/1.1 — plus `X-Correlation-ID`, minted from
`$request_id` unconditionally so a client-supplied id never reaches a log
([`docs/logging.md`](../logging.md), ADR-0039). Every server block writes the `fl_json` access
format, which carries the id, `$request_time` and `$upstream_response_time`.

Buffers are enlarged (`proxy_buffer_size 128k`, `proxy_buffers 4 256k`) specifically to stop 502s from
large Auth.js cookies.

## 4. Security headers

Set at server level with `always`:

| Header                      | Value                                                                                                                                                                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload`                                                                                                                                                                                                     |
| `X-Frame-Options`           | `SAMEORIGIN`                                                                                                                                                                                                                                       |
| `X-Content-Type-Options`    | `nosniff`                                                                                                                                                                                                                                          |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                                                                                                                                                                                                                  |
| `Content-Security-Policy`   | `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self';` |

`'unsafe-inline'` remains on `script-src` because a per-request nonce cannot cover build-time
prerendered HTML, and the alternative was three mechanisms plus a permanent framework exception. The
compensating control is the `react/no-danger` ESLint rule, which closes the only realistic injection
entry point in the codebase.

## 5. The verification gate

`scripts/verify.sh` runs seven scopes in cheapest-to-fail order, and the order is the point: the
script self-check and the documentation gate are instant, the backend tier (ruff, pyright, pytest)
takes seconds, the frontend (prettier, tsc, eslint, `next build`, unit tests, then
the advisory dependency audit) takes minutes, and the ops checks (both compose files parse,
`nginx -t` accepts `prod.conf`), the database test tier and both image builds — with the check that
`instrumentation.js` is present in the frontend image — need Docker on top. A bare invocation runs
everything; scope flags name surfaces and combine (`scripts/README.md` has the table). CI runs the
same scopes as parallel jobs mapped from the paths a pull request touches.

**The documentation gate** (`scripts/check_docs.py`) fails on a citation that resolves to nothing — a
dangling ADR number, a dead link, a broken in-page anchor, an anchored citation whose target has gone,
a named path that is not there — across `/docs` and inside source comments alike. It is the one
currency defence that does not depend on somebody remembering (CUR-5, INC-6).

**The backend steps** exist because the frontend's toolchain runs nothing against `fl_backend`, and the frontend
mirrors the backend's validation constraints rather than enforcing them, so those constraints would
otherwise have no regression net. `pyright` is separate from `ruff` because ruff checks no types, and
type errors visible in the editor were reaching `main` without it. All of it needs the backend
virtualenv (`cd fl_backend && uv sync --dev`).

**Both test tiers run.** The `db`-marked tests need a real `mongod`
([ADR-0030](../_decisions/0030-a-real-mongod-behind-a-deselected-marker.md)), so they are their own
scope behind `require_docker` — which means `--quick` skips them and needs no daemon. In CI they are
the `backend-db` job, run concurrently whenever a pull request touches `fl_backend`, so the coverage
costs no extra waiting.

**The image scope** exists because code that compiles can still fail to build inside the image, or be
omitted from the standalone output entirely.

`--quick` skips everything needing Docker: the database tier and both image builds. It is **not
sufficient** before a merge touching `src/core/config.ts`, `src/core/auth.ts`,
`src/instrumentation.ts`, `next.config.ts`, a lockfile or a Dockerfile — those are where packaging
problems live, and CI builds both images on any pull request touching them. An audit remediation
wave runs the full form regardless of what it touched, unless it changed documentation only.

## 6. Invariants

| #   | Invariant                                                              | Enforced by                                                         | Breaks how                                                                                                     |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| I1  | Only nginx publishes ports                                             | `docker-compose.yml`                                                | Application containers become directly reachable from the host network                                         |
| I2  | Security headers are repeated in every `location` that sets any header | `/_next/static/` block                                              | `add_header` in a location **replaces** the inherited set — the location silently loses HSTS, CSP and the rest |
| I3  | A `default_server` block rejects unknown hosts                         | `ssl_reject_handshake on`                                           | Any `Host` header reaches Next, forwarded verbatim by the proxy                                                |
| I4  | Sign-in rate limiting applies to POST only                             | the `map` producing an empty key otherwise                          | An empty key is exempt from `limit_req`; without the map, GET `/signin` would be throttled too                 |
| I5  | The builder stage has no reachable backend or real env                 | `SKIP_ENV_VALIDATION=true`, placeholder `MONGODB_URI`, no `API_URL` | Anything fetching the API or parsing `AUTH_URL` at module scope fails the image build                          |
| I6  | Production never builds                                                | `deploy.sh` only pulls                                              | A failed build on the server is an outage                                                                      |
| I7  | Both images build before either is pushed                              | `publish.sh`                                                        | Production could pull a frontend whose backend does not exist                                                  |
| I8  | Publishing refuses a dirty tree by default                             | `publish.sh`                                                        | A tag naming a commit must be rebuildable from that commit                                                     |
| I9  | Deploy recreates containers in place                                   | `deploy.sh`                                                         | `down`/`up` turns a seconds-long interruption into a full outage                                               |
| I10 | Scripts use LF line endings and carry the git executable bit           | `selfcheck.sh` checks 2 and 3                                       | Windows hides both; the script works locally and fails on the server                                           |
| I11 | The three API keys are 64 characters and match on both sides           | frontend env schema; backend config                                 | Every request 401s with `REQ-AUTH-00x`                                                                         |

## 7. Violation → remedy

| Symptom                                                  | Cause                                                                  | Remedy                                                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `not a directory` from nginx                             | A mounted config file was missing, so Docker created a directory       | `git pull`, remove the stray directory                                                             |
| `Invalid environment variables: <NAMES>` then no traffic | Startup environment gate                                               | Fix those names in the relevant `.env`                                                             |
| Deploy reports healthy but the site is unreachable       | nginx                                                                  | `docker compose logs nginx`                                                                        |
| Static assets served without security headers            | A `location` block set a header and dropped the inherited set          | I2 — repeat every header in that block                                                             |
| Backend healthcheck fails after an API version bump      | The check hardcodes `/api/v0/`                                         | Update the healthcheck path in `docker-compose.yml`                                                |
| Sign-in returns 429                                      | Rate limit, 5/min per IP on POST                                       | Expected under repeated attempts                                                                   |
| Uptime monitor shows green during a backend outage       | The error page streams after headers, so the edge status is 200        | Monitor `GET /api/v0/system/is_live` through the edge instead ([`docs/logging.md`](../logging.md)) |
| Container logs are empty right after a deploy            | `json-file` logs live in the container; `--force-recreate` replaces it | Expected. Copy them off before deploying ([`docs/logging.md`](../logging.md))                      |
| Reference data stale for up to a day                     | Out-of-band MongoDB edit                                               | Bounded by design (ADR-0035): wait for the daily expiry, or recreate the frontend container        |
| League table or fixtures stale after a season edit       | Same cause — a season decides the default season and the points        | Same remedy; recreation drops every cached page at once                                            |

## 8. Known-open

| Item                                          | State                                                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Backend healthcheck hardcodes `/api/v0/`      | Works today; breaks silently on an API version bump                                                 |
| Registry tag pruning is manual                | Deliberate — a botched delete destroys rollback history. Keep ~5 `sha-` tags per package (ADR-0017) |
| Local sha tags accumulate ~750 MB per publish | Handled: `publish.sh` deletes local sha tags after a successful push                                |
| Revoking admin access needs a restart         | The allowlist is validated at boot; after it, `role` is re-derived per request and the session dies |
| Certificates                                  | Mounted from `./certs`; renewal is outside this repo                                                |
