# Crosscut pass 1 — contracts and seams between surfaces

Audit pass `crosscut 1` on the seams. Lens: CONTRACTS AND SEAMS BETWEEN SURFACES — every place two
surfaces have to agree, and nothing in either surface can tell that they do not.

Read `docs/_auditing/prompts/_shared-protocol.md` and follow it for the whole pass. Write the report
to `docs/audit/programme/x1-contracts-seams.md`.

**A seam defect is correct on both sides and wrong in between**, so no single-surface pass and no
gate can see it — types pass, lint passes, both test suites pass, and the two halves still disagree
at runtime. This pass owns that class as **join tables**: every check below produces a row per pair,
and a pair with no counterpart is the finding.

**Derive both sides from the code, and never treat a report as the source for one half of a join** —
a table read rather than derived is a table one programme out of date, which is exactly the defect
class this pass exists to catch. Reports are consulted only so this pass cites rather than
re-reports: **at most one per surface, the most recent that exists** — the current programme's working
reports in `docs/audit/programme/` if they are there, otherwise the newest
`docs/audit/<yyyy-mm>-<surface>.md` by its date prefix — and only its summary table and
verdict. State in the header which you used per surface, or that none existed.

DELIVERABLE: required join tables — route reachability both directions (1), write→invalidation→read
across the seam (3), end-to-end authorization (4), duplicated definitions (5), the error-class trace
(6), and the contract-enforcement map (8). Report every table in full.

CONTEXT — derive, do not assume. Build these inventories first, by grep, and state their counts:

- every backend route (method + path) from `app/api/*/router.py` and `app/api/*/admin_router.py`;
- every frontend call site from `src/core/api.ts` and its callers, with the `authType` each passes;
- every server action, from a `"use server"` grep;
- every environment variable named in `core/config.ts`, `app/core/config.py`, both compose files and
  the nginx configs.

THE CHECKS, in priority order:

1. **ROUTE REACHABILITY, BOTH DIRECTIONS.** The required table, one row per frontend call site:
   caller file:line | method + path as constructed | the backend route it resolves to, or NONE |
   path and query parameters sent versus declared | verdict. Then the inverse table, one row per
   backend route: route | callers, or NONE. **A call with no route is a defect that only appears at
   runtime** — resolve the path as it is actually constructed, including any interpolation, not as it
   is written in a template. A route with no caller is not automatically dead: `GET /{id}` is
   ratified as existing on every resource, most of them with no caller.

2. **SCHEMA-TO-ROUTE BINDING.** The field-level comparison of every Pydantic model against its zod
   mirror belongs to `backend 2` — cite it where its report is the one you consulted, and do not
   rebuild it. What belongs here is the binding that pass cannot see: **for each route with a caller,
   is the schema that call site parses the mirror of the model that route actually returns?** A
   correct schema applied to the wrong route passes every per-surface check. Report per call site:
   route | model the handler returns | schema the caller passes | same pair, or mismatched. Include
   every route whose handler returns a raw response with no declared `response_model`, since nothing
   on either side pins those.

3. **WRITE → INVALIDATION → READ, ACROSS THE SEAM.** The required table, one row per server action
   that mutates: action | backend route it calls | **what that route actually writes, read from the
   handler** — including any fan-out into other collections | cache tags the action invalidates |
   the queries those tags serve | does the invalidated set cover everything the backend write
   changed? A backend write with a fan-out the frontend does not know about is invisible to the
   frontend's own invalidation map, which is why this check cannot live in the frontend pass.

4. **AUTHORIZATION, END TO END.** Derive both halves: each call site's `authType`, and each backend
   route's router-level guard. One row per pair: entry point (public page / admin page / route
   handler) | action or call site | `authType` sent | guard the backend route requires | minimum
   privilege the operation actually needs | verdict. **A public entry point that transitively reaches
   an admin-guarded route, or a route whose guard is weaker than its effect, is CRITICAL** with a
   one-sentence exploit. Neither surface's table alone shows this.

5. **DUPLICATED AND DIVERGENT DEFINITIONS ACROSS THE SEAM.** The required table, one row per pair:
   concept | its definition on each surface, as `<file> :: <symbol>` | do they agree at the boundaries —
   today, null, empty, zero, the first and last legal value? | which side is the source, and what the
   other becomes | verdict. Sweep for enums and literal unions, status and phase vocabularies, date
   and time formats, score formatting, and validation rules. **A divergence here is a wrong answer,
   not a crash**, so nothing surfaces it except comparison. Two constraints on the fix column:
   `.claude/rules/cross-surface.md` forbids generating the zod mirror, and every other row names which
   definition dies rather than proposing a third home for both.

6. **ERROR CONTRACT, END TO END.** Trace one representative failure of each class — validation error,
   not-found, unauthorised, backend unavailable, timeout — from the backend handler through the API
   client to what the user actually sees. Per class: shape emitted | shape parsed | boundary that
   catches it | message rendered, in German | what leaks on the way (stack, backend URL, trace id,
   submitted data). A class that renders a generic message where the backend sent an actionable one
   is a finding.

7. **CONFIGURATION AND TOPOLOGY CONTRACT.** Join the environment inventories: a variable consumed by
   one surface and supplied by neither compose file, a name that differs by surface, a value whose
   format one side assumes and the other does not validate. Then the topology half: every control
   that exists only because of where things sit in the network, cross-checked against the nginx
   configs. **State what breaks each control**, because that list is what a future nginx or compose
   edit gets checked against.

8. **CONTRACT ENFORCEMENT.** For each seam above, name what would catch a regression today: a test, a
   lint rule, a schema check, or nothing. The required table: seam | current enforcement | what a
   regression would look like in production | cheapest control that would catch it. A failure class
   one surface's gate could catch belongs to ops 1's coverage map; a row sits here only when no
   single surface can see the regression. The seams have no owner, so every one left unenforced
   will drift again. On a re-run, start from the enforcement
   decisions in `.claude/CLAUDE.md` §7 and the `.claude/rules/` files it indexes, and the controls
   actually present in the gate: a seam already
   enforced needs its control verified, not its contract re-derived.

CROSS-SURFACE QUESTIONS: at a seam, "which side is right" is frequently a product decision rather
than a technical one, and picking silently produces a fix in the wrong half. Every such question
names both readings and what each would cost.

BOUNDARIES — not this pass: anything visible from inside one surface. Per-surface structure, excess,
dead code, styling, accessibility, performance, single-surface gate coverage (→ `ops 1`), and
single-surface security all belong to their own passes — including a definition duplicated twice
within one surface, which is that surface's architecture pass. Where a check here surfaces a single-surface defect, record it in one line under
the verdict's cross-surface handoffs and name the owning surface.
