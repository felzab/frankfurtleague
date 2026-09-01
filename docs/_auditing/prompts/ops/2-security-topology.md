# Ops pass 2 — security and topology

Audit pass `ops 2` on the ops surface. Lens: SECURITY AND TOPOLOGY — what the edge exposes, what the
network layout protects, and how secrets move through build and deploy.

Read `docs/_auditing/prompts/_shared-protocol.md` and follow it for the whole pass — the secrets rule
is absolute here in both directions: reachability and handling only, never values; ignore-rule
inspection only, never file contents. Write the report to
`docs/audit/programme/o2-security-topology.md`. Read `docs/audit/programme/b3-security.md` if it
exists — its topology-only controls inventory is an input to check 2.

DELIVERABLE: required tables — the exhaustive routing table (check 1) and the topology-only controls
inventory (check 2), merged with the one `backend 3` hands over. The inventory is what a future nginx
or compose edit gets checked against.

STANDARDS ANCHOR: the configuration, communications and deployment chapters of **OWASP ASVS**
(<https://github.com/OWASP/ASVS>), per the shared protocol's rule on external standards.
Application-level ASVS chapters belong to the frontend and backend security passes — do not duplicate
their tables here.

CONTEXT — derive from the configs, not from memory: nginx fronts everything; one exact-match path
routes to FastAPI and everything else to Next, so no browser reaches a route that reads or writes
application data. Two protections are deliberate _absences_: `.claude/CLAUDE.md` §7 forbids
re-adding a reference-data invalidation endpoint, and FastAPI's `/docs` is unreachable from outside
because nginx carries no route to it. An absence-as-control is invisible in a config review unless it is on a list;
building that list is this pass's most important output.

THE CHECKS, in priority order:

1. **THE ROUTING TABLE, EXHAUSTIVELY.** The required table, one row per `location` and `server` block
   across both nginx configs: match | proxies to | auth in front of it (none / app-level / topology)
   | headers applied | notes. Then the inverse: for each service, every path reachable from the
   internet and every path reachable only on the compose network. **Probe the match semantics rather
   than reading them** — prefix versus exact, trailing slash, case, `default_server` fallthrough, and
   what an unmatched Host lands on.

2. **TOPOLOGY-ONLY CONTROLS.** Merge `backend 3`'s inventory, where present, with your own from
   check 1: every control that is purely an absence or a network boundary, each with what it
   protects, what breaks it (an added location, a compose network change, a port publish), and where
   it is documented. An undocumented one is a finding.

3. **HEADER POSTURE.** The served security headers versus the committed configs (on the running stack
   via `local.sh` if available, else static): CSP (one enforced policy retaining `'unsafe-inline'` is
   **ratified**, with `react/no-danger` as the compensating control; do not re-litigate it, but
   verify the compensating rule is still `error`), HSTS, X-Content-Type-Options, Referrer-Policy,
   frame-ancestors and X-Frame-Options, and per-location header inheritance — nginx `add_header`
   inheritance is per-block-replacing, so verify no location silently drops the set.

4. **TLS AND CERTS.** Protocol and cipher configuration against current guidance (verify against
   official sources, not memory), cert and key file handling — mounted paths, permissions
   expectations `deploy.sh` checks, renewal story as documented. Never read key material.

5. **RATE LIMITING AND ABUSE SURFACE.** Every `limit_req` and `limit_conn` zone: what it covers, what
   it misses (the sign-in POST limit exists — does anything else deserve one?), body-size limits,
   timeout posture against slow-loris-shaped abuse.

6. **SECRET FLOW THROUGH BUILD AND DEPLOY.** By inspection of rules and args only: `.env*` excluded by
   every `.dockerignore` and `.gitignore` variant; no secret enters an image as a build ARG or layer;
   compose passes secrets by env at run time; CI has no secret it does not need; scripts never echo
   secret values (check their output paths); log files and `docker logs` do not receive secrets by
   construction. The startup env gate names variable _names_ only on failure — verify the claim.

7. **CONTAINER POSTURE.** Per service: user (root?), published versus internal ports, restart policy,
   resource limits (absent — is that accepted?), writable filesystem surface, healthcheck commands
   not leaking anything into process lists.

8. **FAIL-CLOSED BEHAVIOUR.** Verify the documented chain for a stack coming up from nothing: a
   failing frontend env gate → unhealthy container → nginx (depends_on `service_healthy`) never
   starts. Then verify the deploy separately, where that chain does not hold — `scripts/deploy.sh`
   recreates the application pair alone and leaves the edge running, so the same failing gate is a
   502 and an automatic rollback ([`docs/ops/spec.md`](../../../ops/spec.md) I9). What is the
   equivalent story for the backend and for Mongo? What does the stack serve during each partial
   failure — and is any partial state one that serves stale or wrong data silently rather than
   failing visibly?

SEVERITY HONESTY: rate findings for the attacker position that can actually reach them. A
compose-network-only exposure is real but is not an internet-facing CRITICAL. Cite the
`.claude/CLAUDE.md` §7 row or the spec-sheet invariant before flagging any ratified posture.

BOUNDARIES — not this pass: image contents, script correctness, CI mechanics and pipeline excess →
`ops 1` · application auth logic → the surface programmes · FastAPI-side injection and leakage →
`backend 3`.
