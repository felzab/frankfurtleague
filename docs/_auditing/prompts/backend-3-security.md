# Backend pass 3 — security and authorization

Paste into a fresh session (or run via `/audit:pass backend 3`).

---

Audit pass 3 of 4 on `./fl_backend`. Lens: SECURITY AND AUTHORIZATION — who can call what, what
untrusted input can reach, and what leaks out.

Read `docs/_auditing/prompts/_shared-protocol.md` and follow it for the whole pass — the secrets
rule there is absolute. Write the report to `docs/audit/b3-security.md`. Read the b1 and b2 reports
first; where b2 flagged missing validation, treat it here only as an exploitability question.

CONTEXT — derive, do not assume: auth is internal API keys in tiers (base / system / admin),
checked in `app/core/security.py` / `dependencies.py`; the only caller is the Next.js server (the
browser never reaches FastAPI directly), and nginx routes `/api` to FastAPI — so **network topology
is a load-bearing control** (ADR-0015 protects `POST /api/revalidate` this way). That means every
reachability judgment must state which network position the attacker holds: internet via nginx,
compose-network, or a compromised frontend key. Verify the nginx configs (`nginx/*.conf`) before
calling anything unreachable — do not assert topology from memory.

THE CHECKS, in priority order:

1. **PER-ENDPOINT AUTHORIZATION TABLE.** The required table, one row per route in every
   `app/api/*/router.py`: method+path | handler file:line | dependency chain | key tier required |
   tier actually _sufficient_ (does anything downstream assume more?) | reachable from (internet /
   compose-net / frontend-key-holder) | verdict. Every mutating route must require the admin tier;
   every gap is a finding with a one-sentence exploit. Include the key comparison itself:
   constant-time or not, and what a missing/malformed header returns. Check the `system` tier
   branch against ADR-0014 (deliberately kept — never remove the env declaration while the branch
   stays).

2. **QUERY INJECTION SURFACE.** Every place user-influenced input becomes part of a Mongo query or
   pipeline: can an attacker introduce operator keys (`$where`, `$gt`, dict-shaped values where a
   scalar is assumed)? Are ids validated (`CustomObjectId` — note b2's BE-6 JSON-mode finding makes
   this reachable-dependent: state whether any path parses ids via `model_validate_json`)? Regex
   built from input anywhere (ReDoS / pattern injection)? Sort/projection fields taken from input?

3. **RESOURCE-EXHAUSTION SURFACE.** Unbounded or expensive work reachable per request: `limit`
   bounds actually enforced, unindexed scans in the pipelines, `$lookup` fan-out on attacker-chosen
   parameters, response sizes. Rate limiting is nginx's (pass O2 owns the config) — state the
   assumption, do not audit nginx here.

4. **ERROR AND LOG LEAKAGE.** `exception_handlers.py`, `logging.py`, `middlewares.py`: what reaches
   a client on an unhandled exception (stack? Mongo error text? internal paths?), and what lands in
   logs — especially personal data (referee contact details, emails) and secrets. State per
   `logger.*`/`print` call what it emits in production and who can read it.

5. **DATA-EXPOSURE REVIEW.** Which endpoints serve personal data (contact fields) at which tier —
   is anything personal reachable at `base` tier that only the admin UI needs? Is soft-deleted
   (`is_inactive`) data still served anywhere it should not be?

6. **DEPENDENCY AND RUNTIME SURFACE.** Audit the dependency set for known advisories using the
   available tooling (`uv`/`pip-audit` if present — say which ran); check pins in `pyproject.toml`
   are floors that CI actually respects; Python version consistency between `pyproject`, the
   Dockerfile and CI.

7. **STARTUP AND CONFIG HARDENING.** `app/core/config.py` and `main.py`: does the app fail closed
   on missing/malformed configuration, naming variable names only? Are docs endpoints
   (`/docs`, `/openapi.json`) exposed, and to whom given the nginx routing (verify — the
   documentation ledger records Swagger as unreachable from outside; confirm at current configs)?
   CORS configuration versus the actual caller model.

8. **TOPOLOGY-ONLY CONTROLS INVENTORY.** Every control that exists _only_ as network topology (no
   in-band check): list them with what breaks if an nginx location is ever added or the compose
   network changes. ADR-0015 is the pattern — the point is that each such control is _named_, so no
   future nginx edit removes one unknowingly. Hand the list to pass O2, which owns the nginx side.

SEVERITY HONESTY: a finding reachable only by an attacker who already holds an internal API key or
compose-network access is real but must be rated for that position, not for the open internet.
Theoretical risk with no reachable path is INFO at most. Do not soften a genuine CRITICAL because
the app is small.

FIX PRESCRIPTIONS: any fix touching auth flow, config gating, or container runtime must be verified
against the running stack or a built image before being prescribed — four of the frontend security
pass's fixes were unshippable because they reasoned about the deployment instead of measuring it.
If you cannot verify, label the prescription unverified.

BOUNDARIES — not this pass: write→read consistency → B1 · constraint/mirror divergence → B2 ·
module layout, tests, tooling → B4 · nginx/compose/TLS/headers themselves → ops passes (hand them
the topology inventory from check 8).
