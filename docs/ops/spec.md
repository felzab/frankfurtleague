# Ops — spec

**Verified against:** `e340056`, 2026-08-01
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

**Note:** the backend healthcheck hardcodes `/api/v0/...`. It does not read `API_VERSION`, so bumping
the API version silently breaks the healthcheck.

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

| Location         | Upstream        | Notes                                                               |
| ---------------- | --------------- | ------------------------------------------------------------------- |
| `/api/auth`      | `frontend:3000` | Auth.js — more specific than `/api`, so it wins                     |
| `/api`           | `backend:8000`  | Everything else API                                                 |
| `= /signin`      | `frontend:3000` | `limit_req zone=signin burst=3 nodelay`                             |
| `/_next/static/` | `frontend:3000` | `expires max`, `Cache-Control: public, max-age=31536000, immutable` |
| `/`              | `frontend:3000` | Catch-all                                                           |

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
`X-Forwarded-Host`, `X-Forwarded-Port`, HTTP/1.1.

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

## 5. Invariants

| #   | Invariant                                                              | Enforced by                                                         | Breaks how                                                                                                     |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| I1  | Only nginx publishes ports                                             | `docker-compose.yml`                                                | Application containers become directly reachable; `/api/revalidate` loses its only protection                  |
| I2  | **No nginx location for `/api/revalidate`**                            | absence in `nginx/*.conf`                                           | An internal, key-authenticated endpoint becomes internet-facing                                                |
| I3  | Security headers are repeated in every `location` that sets any header | `/_next/static/` block                                              | `add_header` in a location **replaces** the inherited set — the location silently loses HSTS, CSP and the rest |
| I4  | A `default_server` block rejects unknown hosts                         | `ssl_reject_handshake on`                                           | Any `Host` header reaches Next, forwarded verbatim by the proxy                                                |
| I5  | Sign-in rate limiting applies to POST only                             | the `map` producing an empty key otherwise                          | An empty key is exempt from `limit_req`; without the map, GET `/signin` would be throttled too                 |
| I6  | The builder stage has no reachable backend or real env                 | `SKIP_ENV_VALIDATION=true`, placeholder `MONGODB_URI`, no `API_URL` | Anything fetching the API or parsing `AUTH_URL` at module scope fails the image build                          |
| I7  | Production never builds                                                | `deploy.sh` only pulls                                              | A failed build on the server is an outage                                                                      |
| I8  | Both images build before either is pushed                              | `publish.sh`                                                        | Production could pull a frontend whose backend does not exist                                                  |
| I9  | Publishing refuses a dirty tree by default                             | `publish.sh`                                                        | A tag naming a commit must be rebuildable from that commit                                                     |
| I10 | Deploy recreates containers in place                                   | `deploy.sh`                                                         | `down`/`up` turns a seconds-long interruption into a full outage                                               |
| I11 | Scripts use LF line endings and carry the git executable bit           | `selfcheck.sh` checks 2 and 3                                       | Windows hides both; the script works locally and fails on the server                                           |
| I12 | The three API keys are 64 characters and match on both sides           | frontend env schema; backend config                                 | Every request 401s with `REQ-AUTH-00x`                                                                         |

## 6. Violation → remedy

| Symptom                                                  | Cause                                                            | Remedy                                                                 |
| -------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `not a directory` from nginx                             | A mounted config file was missing, so Docker created a directory | `git pull`, remove the stray directory                                 |
| `Invalid environment variables: <NAMES>` then no traffic | Startup environment gate                                         | Fix those names in the relevant `.env`                                 |
| Deploy reports healthy but the site is unreachable       | nginx                                                            | `docker compose logs nginx`                                            |
| Static assets served without security headers            | A `location` block set a header and dropped the inherited set    | I3 — repeat every header in that block                                 |
| Backend healthcheck fails after an API version bump      | The check hardcodes `/api/v0/`                                   | Update the healthcheck path in `docker-compose.yml`                    |
| Sign-in returns 429                                      | Rate limit, 5/min per IP on POST                                 | Expected under repeated attempts                                       |
| Reference data stale for up to a day                     | Out-of-band MongoDB edit                                         | `./scripts/revalidate_reference_data.sh <saisons\|spieler\|spieltage>` |

## 7. The verification gate

`scripts/verify.sh` runs, cheapest-to-fail first: script self-checks, `pnpm verify` (types, lint,
formatting, `next build`, unit tests), `pnpm audit:prod`, then **ruff and pytest for the backend**, then
both image builds, then a check that `instrumentation.js` is present in the frontend image.

The backend step exists because `pnpm verify` runs nothing against `fl_backend`, and the frontend
mirrors roughly forty backend validation constraints rather than enforcing them — so those constraints
had no regression net at all. It needs the backend virtualenv (`cd fl_backend && uv sync --dev`).

The image steps exist because code that compiles can still fail to build inside the image, or be
omitted from the standalone output entirely.

`--quick` skips the image builds and is **not sufficient** before a merge touching
`src/core/config.ts`, `src/core/auth.ts` or `src/instrumentation.ts` — those are where packaging
problems live.

## 8. Known-open

| Item                                          | State                                                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Backend healthcheck hardcodes `/api/v0/`      | Works today; breaks silently on an API version bump                                                 |
| Registry tag pruning is manual                | Deliberate — a botched delete destroys rollback history. Keep ~5 `sha-` tags per package (ADR-0017) |
| Local sha tags accumulate ~750 MB per publish | Handled: `publish.sh` deletes local sha tags after a successful push                                |
| No in-app sign-out                            | Session lifetime (8h) is the only revocation mechanism                                              |
| Certificates                                  | Mounted from `./certs`; renewal is outside this repo                                                |
