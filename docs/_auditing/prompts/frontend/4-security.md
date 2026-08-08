# Frontend pass 4 — security and authorization

Paste into a fresh session (or run via `/audit:pass frontend 4`).

---

Audit pass 4 of 6 on `./fl_frontend`. Lens: SECURITY AND AUTHORIZATION.

Read `docs/_auditing/prompts/_shared-protocol.md` and follow it for the whole pass — the secrets
rule is absolute. Write the report to `docs/audit/programme/f4-security.md`. Read the f1–f3 reports first;
where f3 flagged missing input validation, treat it here only as exploitability.

DELIVERABLE: three required tables — the ASVS coverage table (S0), the per-export server-action
authorization table (S1), and the per-segment protected-route table (S3). Every finding carries a
concrete exploit sentence.

CONTEXT — derive, do not assume: auth is next-auth via `src/core/auth.ts` with a proxy matcher on
`/admin/:path*` **plus** an in-layout `getAdminSession()` guard (defence in depth — verify both
still exist rather than assuming either); the frontend holds tiered internal API keys used by
`src/core/api.ts`. Ratified postures to check conformance against, not to re-litigate: the single
enforced CSP with `react/no-danger` as compensating control (ADR-0016), the kept system tier
(ADR-0014), and the absence of a reference-data invalidation endpoint (ADR-0035).

THE CHECKS, in priority order:

S0. **ASVS coverage.** Anchor this pass to **OWASP ASVS**, the Application Security Verification
Standard (<https://github.com/OWASP/ASVS>), rather than to a hand-rolled checklist. Follow the
shared protocol's rule on external standards: **fetch the current version and state it in the
header; never reproduce the control list from memory.** Target **Level 1** as the floor; Level 2
controls are decisions to confirm, not defects, and every `not applicable` carries its reason.
Cover the chapters that apply to a browser-facing application with a session: authentication and
session management, access control, validation and encoding, error handling and logging, and the
browser security chapter covering headers, CSP and cookies. One coverage table: control | what
implements it here, with the file | evidence | `met` / `gap` / `not applicable` with reason.
**Every `gap` becomes a numbered finding below** with a file:line and an exploit sentence; a gap
named only in the coverage table is an observation. The checks that follow run in full regardless
of what ASVS covers — the standard is a floor, not the lens.

S1. **Server-action authorization.** The required table, one row per exported function in every
`"use server"` module — **derive the module list by grep, never from a written list**, because
code moves between slices and a written list goes stale silently: export file:line | mutates
what | session check | role check |
the exact guard line or NONE | verdict. Server actions are directly invocable RPC endpoints;
the proxy gates page navigation only. Every unguarded mutating action is CRITICAL, with a
one-sentence exploit.

S2. **Secret reachability into the client bundle.** Two independent methods, both reported:
(a) static — the import graph outward from `core/config.ts`, with the full chain per hit into
any `"use client"` module (including via props); confirm the `server-only` imports still guard
the secret-holding core modules; (b) empirical — build, then grep `.next/static` for variable
NAMES and structural markers only, never widening a grep in a way that could print a value.
A finding requires a shown chain or a named bundle file.

S3. **Protected route coverage.** The required table per route segment: intended protection |
proxy-matcher coverage | in-layout/page guard | gap. Probe the matcher for holes (variants,
redirects evaluated before the proxy, route handlers and actions that layout guards do not
protect).

S4. **Privilege escalation via key tiers.** Per `apiClient` call site: authType | routes it is
reachable from | minimum privilege actually required. A public page transitively invoking an
admin-key call is CRITICAL.

S5. **Auth configuration.** Session strategy/lifetime, cookie flags and what derives them, CSRF,
role assignment provenance (user-controllable?), account linking, sign-out revocation, the
magic-link flow (validity window, email content source), and the pinned-beta risk if the pin
still exists — check the installed version's own documented behaviour, not stable-version
assumptions.

S6. **Enumeration and side channels.** For every authentication-adjacent flow: does _any_
observable — response body, **navigation target, timing, status code** — distinguish a valid
from an invalid principal? **Compare the full observable behaviour, never the payload alone:**
equalising a response body leaves the address bar a perfect membership oracle when the
underlying call navigates differently per branch. Plus redirect and navigation safety: every
destination derived from input is validated against an allowlist or a same-origin check.

S7. **Error and log leakage.** Error boundaries, the logger, instrumentation, every `console.*` in
`src`: what each emits in a production build and who can see it — stack traces, backend URLs,
zod trees, trace ids, submitted user data.

S8. **Injection surface.** `dangerouslySetInnerHTML` (the compensating lint rule must still be at
`error` — ADR-0016 depends on it), URL-bearing attributes fed from backend/user data (every
such sink on the shared external-URL schema, never bare `z.url()`), searchParams flowing into
fetch paths unencoded, unbounded params forwarded to the backend.

S9. **Transport and headers.** Served headers versus the nginx configs (check the configs before
calling a header missing — header ownership is split between Next and nginx), and conformance
to ADR-0016 rather than a re-argument of it.

S10. **Dependency and build surface.** `pnpm audit --prod` (it is gate-enforced — verify), any
resolution overrides against the ranges their dependents declare (the `sharp` override
deliberately floats — re-check against the current framework version), Dockerfile/dockerignore
secret hygiene by rule inspection only.

FIX PRESCRIPTIONS: any fix touching auth config, CSP, cookies or container runtime must be verified
against a built image or the running stack before being prescribed, or explicitly labelled
unverified. **A security fix reasoned about rather than measured is routinely unshippable** — a
stricter CSP requiring a per-request nonce disables every script on prerendered routes, and a gate on
`NODE_ENV === "production"` refuses to boot the local stack, which deliberately runs the production
image over plain-HTTP localhost. Severity honesty: no reachable path means INFO at most, and never
soften a real CRITICAL because the app is small.

BOUNDARIES — not this pass: caching/validation shape → f3 · structure → f2 · a11y/UX → pass 5 ·
styling/performance → pass 6 · nginx/compose/TLS as such → the ops passes · **whether the tier a
call site sends matches the guard the backend route requires** → crosscut pass X1, which joins S4's
table against the backend's per-route guard table.
