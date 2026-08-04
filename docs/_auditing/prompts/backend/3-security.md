# Backend pass 3 — security and authorization

Paste into a fresh session (or run via `/audit:pass backend 3`).

---

Audit pass 3 of 4 on `./fl_backend`. Lens: SECURITY AND AUTHORIZATION — who can call what, what
untrusted input can reach, and what leaks out.

Read `docs/_auditing/prompts/_shared-protocol.md` and follow it for the whole pass — the secrets
rule there is absolute. Write the report to `docs/audit/programme/b3-security.md`. Read the b1 and b2 reports
first; where b2 flagged missing validation, treat it here only as an exploitability question.

DELIVERABLE: three required tables — the standards coverage table (check 0), the per-endpoint
authorization table (check 1), and the topology-only controls inventory (check 8), the last handed to
ops pass O2. Every finding states the network position its exploit requires.

CONTEXT — derive, do not assume: auth is internal API keys in tiers (base / system / admin),
checked in `app/core/security.py` / `dependencies.py`; the only caller is the Next.js server (the
browser never reaches FastAPI directly), and nginx routes `/api` to FastAPI — so **network topology
is a load-bearing control** (FastAPI's own `/docs` is unreachable for exactly this reason). That
means every
reachability judgment must state which network position the attacker holds: internet via nginx,
compose-network, or a compromised frontend key. Verify the nginx configs (`nginx/*.conf`) before
calling anything unreachable — do not assert topology from memory.

THE CHECKS, in priority order:

0. **STANDARDS COVERAGE.** Anchor this pass to two published control lists rather than to a
   hand-rolled checklist, per the shared protocol's rule on external standards — **fetch the current
   version of each and state it in the header; never reproduce either from memory.**

   - **OWASP ASVS**, the Application Security Verification Standard
     (<https://github.com/OWASP/ASVS>). Target **Level 1** as the floor, and treat Level 2 controls
     as decisions to confirm rather than defects: this is a small public site with one privileged
     operator, so some Level 2 controls are legitimately not applicable — but each N/A carries its
     reason. Cover the chapters that apply to an API with no browser-facing session of its own:
     authentication and access control, validation and encoding, error handling and logging,
     configuration, and data protection. Chapters covering surfaces this service does not have are
     one `not applicable` row each, not silence.
   - **OWASP API Security Top 10, 2023 edition**
     (<https://owasp.org/API-Security/editions/2023/en/0x11-t10/>). Ten rows, no exceptions. Broken
     object-level and function-level authorization, and unrestricted resource consumption, are the
     ones this architecture is most exposed to.

   Produce one coverage table per list: control | what implements it here, with the file | evidence |
   `met` / `gap` / `not applicable` with reason. **Every `gap` row becomes a numbered finding below**
   with a file:line and an exploit sentence — a gap named only in the coverage table is an
   observation, not a finding. The checks that follow are this codebase's own lens and run in full
   regardless of what the standards cover.

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
   scalar is assumed)? Are ids validated? `CustomObjectId`'s JSON-mode gap (b2's check 2) makes this
   reachability-dependent — state whether any path parses ids via `model_validate_json`. Regex built
   from input anywhere (ReDoS or pattern injection)? Sort or projection fields taken from input?

3. **RESOURCE-EXHAUSTION SURFACE.** Unbounded or expensive work reachable per request: `limit`
   bounds actually enforced, unindexed scans in the pipelines, `$lookup` fan-out on attacker-chosen
   parameters, response sizes. Rate limiting is nginx's (pass O2 owns the config) — state the
   assumption, do not audit nginx here.

4. **ERROR AND LOG LEAKAGE.** `exception_handlers.py`, `logging.py`, `middlewares.py`: what reaches
   a client on an unhandled exception (stack? Mongo error text? internal paths?), and what lands in
   logs — especially personal data (referee contact details, emails) and secrets. State per
   `logger.*`/`print` call what it emits in production and who can read it.

5. **DATA-EXPOSURE REVIEW.** Which endpoints serve personal data (contact fields) at which tier — is
   anything personal reachable at `base` tier that only the admin UI needs? Is retired data (a
   non-null `inactive_since`, ADR-0032) still served anywhere it should not be?

6. **DEPENDENCY AND RUNTIME SURFACE.** Audit the dependency set for known advisories using the
   available tooling (`uv`/`pip-audit` if present — say which ran); check pins in `pyproject.toml`
   are floors that CI actually respects; Python version consistency between `pyproject`, the
   Dockerfile and CI.

7. **STARTUP AND CONFIG HARDENING.** `app/core/config.py` and `main.py`: does the app fail closed on
   missing or malformed configuration, naming variable names only? Are the docs endpoints (`/docs`,
   `/openapi.json`) exposed, and to whom, given the nginx routing? They are expected to be
   unreachable from outside because they sit at the app root, which nginx sends to Next — **confirm
   that at the current configs rather than assuming it**. CORS configuration versus the actual
   caller model.

8. **TOPOLOGY-ONLY CONTROLS INVENTORY.** Every control that exists _only_ as network topology (no
   in-band check): list them with what breaks if an nginx location is ever added or the compose
   network changes. ADR-0015 is the pattern — the point is that each such control is _named_, so no
   future nginx edit removes one unknowingly. Hand the list to pass O2, which owns the nginx side.

SEVERITY HONESTY: a finding reachable only by an attacker who already holds an internal API key or
compose-network access is real but must be rated for that position, not for the open internet.
Theoretical risk with no reachable path is INFO at most. Do not soften a genuine CRITICAL because
the app is small.

FIX PRESCRIPTIONS: any fix touching auth flow, config gating or container runtime must be verified
against the running stack or a built image before being prescribed. **A security fix reasoned about
rather than measured is routinely unshippable** — a gate that looks correct can refuse to boot the
local stack, and a check can fail to resolve its imports inside a bundled image. If you cannot
verify, label the prescription unverified.

BOUNDARIES — not this pass: write→read consistency → B1 · constraint/mirror divergence → B2 ·
module layout, tests, tooling → B4 · nginx/compose/TLS/headers themselves → ops passes (hand them
the topology inventory from check 8).
