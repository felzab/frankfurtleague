# Ops pass 2 — security and topology

Paste into a fresh session (or run via `/audit:pass ops 2`).

---

Audit pass 2 of 2 on the ops surface. Lens: SECURITY AND TOPOLOGY — what the edge exposes, what the
network layout protects, and how secrets move through build and deploy.

Read `docs/_auditing/prompts/_shared-protocol.md` and follow it for the whole pass — the secrets
rule is absolute: reachability and handling only, never values; ignore-rule inspection only, never
file contents. Write the report to `docs/audit/programme/o2-security-topology.md`. Read
`docs/audit/programme/o1-build-deploy.md` first, and the backend b3 report if it exists — its check 8 hands
this pass an inventory of controls that exist only as topology.

DELIVERABLE: two required tables — the exhaustive routing table (check 1) and the topology-only
controls inventory (check 2), merged with the one backend pass B3 hands over. The second is what a
future nginx or compose edit gets checked against.

STANDARDS ANCHOR: the configuration, communications and deployment chapters of **OWASP ASVS**
(<https://github.com/OWASP/ASVS>) cover this pass's edge and transport surface. Per the shared
protocol, fetch the current version, state it in the header, and report a coverage table for those
chapters alongside the checks below; every `gap` becomes a numbered finding. Application-level ASVS
chapters belong to the frontend and backend security passes — do not duplicate their tables here.

CONTEXT — derive from the configs, not from memory: nginx fronts everything; `/api` routes to
FastAPI, everything else to Next; the browser never reaches FastAPI directly; several protections
are deliberate _absences_ (no invalidation endpoint for the reference caches — ADR-0035; FastAPI's
`/docs` unreachable from outside because it sits at the app root, which nginx sends to Next). An
absence-as-control is invisible in a config review unless it is on a list — building that list is
this pass's most important output.

THE CHECKS, in priority order:

1. **THE ROUTING TABLE, EXHAUSTIVELY.** The required table, one row per `location`/`server` block
   across both nginx configs: match | proxies to | auth in front of it (none / app-level / topology)
   | headers applied | notes. Then the inverse: for each service, every path reachable from the
   internet and every path reachable only on the compose network. **Probe the match semantics
   rather than reading them** — prefix versus exact, trailing slash, case, `default_server`
   fallthrough, and what an unmatched Host lands on.

2. **TOPOLOGY-ONLY CONTROLS.** Merge b3's inventory (if present) with your own from check 1: every
   control that is purely an absence or a network boundary, each with — what it protects, what
   breaks it (an added location, a compose network change, a port publish), and where it is
   documented (ADR-0015 is the model; an undocumented one is a finding). This list is the
   deliverable a future nginx edit gets checked against.

3. **HEADER POSTURE.** The served security headers versus the committed configs (on the running
   stack via `local.sh` if available, else static): CSP (one enforced policy retaining
   `'unsafe-inline'` is **ratified** — ADR-0016 with `react/no-danger` as the compensating
   control; do not re-litigate it, but verify the compensating rule is still `error`), HSTS,
   X-Content-Type-Options, Referrer-Policy, frame-ancestors/X-Frame-Options, and per-location
   header inheritance (nginx `add_header` inheritance is per-block-replacing — verify no location
   silently drops the set).

4. **TLS AND CERTS.** Protocol/cipher configuration against current guidance (verify against
   official sources, not memory), cert/key file handling — mounted paths, permissions expectations
   `deploy.sh` checks, renewal story as documented. Never read key material.

5. **RATE LIMITING AND ABUSE SURFACE.** Every `limit_req`/`limit_conn` zone: what it covers, what
   it misses (the sign-in POST limit exists — does anything else deserve one?), body-size limits,
   timeout posture against slow-loris-shaped abuse.

6. **SECRET FLOW THROUGH BUILD AND DEPLOY.** By inspection of rules and args only: `.env*` excluded
   by every `.dockerignore` and `.gitignore` variant; no secret enters an image as a build ARG or
   layer; compose passes secrets by env at run time; CI has no secret it does not need; scripts
   never echo secret values (check their output paths); log files and `docker logs` do not receive
   secrets by construction. The startup env gate names variable _names_ only on failure — verify
   the claim.

7. **CONTAINER POSTURE.** Per service: user (root?), published vs internal ports, restart policy,
   resource limits (absent — is that accepted?), writable filesystem surface, healthcheck commands
   not leaking anything into process lists.

8. **FAIL-CLOSED BEHAVIOUR.** Verify the documented chain: a failing frontend env gate → unhealthy
   container → nginx (depends_on `service_healthy`) never starts / stops serving. What is the
   equivalent story for the backend and for Mongo? What does the stack serve during each partial
   failure — and is any partial state one that serves stale or wrong data silently rather than
   failing visibly?

SEVERITY HONESTY: rate findings for the attacker position that can actually reach them. A
compose-network-only exposure is real but is not an internet-facing CRITICAL. Cite ADRs before
flagging any ratified posture.

BOUNDARIES — not this pass: image contents, script correctness, CI mechanics → O1 · application
auth logic → the surface programmes · FastAPI-side injection/leakage → b3.
