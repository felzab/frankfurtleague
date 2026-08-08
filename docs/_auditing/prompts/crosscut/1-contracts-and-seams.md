# Crosscut pass 1 — contracts and seams between surfaces

Paste into a fresh session (or run via `/audit:pass crosscut 1`).

**Run this pass last in every programme**, after that programme's surface passes. The seams exist
whichever surface is being audited, and they belong to none of them.

---

Audit pass 1 of 1 on the seams. Lens: CONTRACTS AND SEAMS BETWEEN SURFACES — every place two
surfaces have to agree, and nothing in either surface can tell that they do not.

Read `docs/_auditing/prompts/_shared-protocol.md` and follow it for the whole pass. Write the report
to `docs/audit/programme/x1-contracts-seams.md`.

**This pass derives both sides from the code and depends on no other report.** Only one surface is
audited at a time, so at most one surface's working reports exist in `docs/audit/programme/`; an
earlier surface's are gone, because that folder is deleted at programme close and a final report preserves
the account, not the join tables. Build every inventory below yourself. **Never treat a report as
the source for one half of a join** — a table read rather than derived is a table one programme out
of date, which is exactly the defect class this pass exists to catch.

Reports are consulted only so this pass cites rather than re-reports. **Consult at most one per
surface, the most recent that exists:** the current programme's working reports in `docs/audit/programme/` if
they are there, otherwise the newest `docs/_auditing/reports/<yyyy-mm>-<surface>.md` by its date
prefix. Read only its summary table and verdict. State in the report header which report you used
per surface, or that none existed.

WHY THIS PASS EXISTS: a per-surface lens finds what its own tree can show it. **A seam defect is
correct on both sides and wrong in between**, so no single-surface pass can see it, and no gate can
either — types pass, lint passes, both test suites pass, and the two halves still disagree at
runtime. This pass owns exactly that class, and it owns it as **join tables**: every check below
produces a row per pair, and a pair with no counterpart is the finding.

DELIVERABLE: five required join tables — route reachability both directions (1), write→invalidation→read across the seam (3), end-to-end authorization (4), the error-class trace (6), and the contract-enforcement map (8). A pair with no counterpart is the finding; report every table in full.

CONTEXT — derive, do not assume. Build these four inventories first, by grep, and state their counts:

- every backend route (method + path) from `app/api/*/router.py` and `app/api/*/admin_router.py`;
- every frontend call site from `src/core/api.ts` and its callers, with the `authType` each passes;
- every server action, from a `"use server"` grep;
- every environment variable named in `core/config.ts`, `app/core/config.py`, both compose files and
  the nginx configs.

THE CHECKS, in priority order:

1. **ROUTE REACHABILITY, BOTH DIRECTIONS.** The required table, one row per frontend call site:
   caller file:line | method + path as constructed | the backend route it resolves to, or NONE |
   path/query parameters sent versus declared | verdict. Then the inverse table, one row per backend
   route: route | callers, or NONE. **A call with no route is a defect that only appears at runtime**
   — resolve the path as it is actually constructed, including any interpolation, not as it is
   written in a template. A route with no caller is not automatically dead: check ADR-0034, which
   ratifies `GET /{id}` existing on every resource with most having no caller.

2. **SCHEMA-TO-ROUTE BINDING.** The field-level comparison of every Pydantic model against its zod
   mirror belongs to backend pass B2 — cite it if its report is the one you consulted for that
   surface, and do not rebuild it. What belongs here is the binding B2 cannot see: **for each route
   with a caller, is the schema that call site parses with the mirror of the model that route
   actually returns?** A correct schema applied to the wrong route
   passes every per-surface check. Report per call site: route | model the handler returns | schema
   the caller passes | same pair, or mismatched. Include every route whose handler returns a raw
   response with no declared `response_model`, since nothing on either side pins those.

3. **WRITE → INVALIDATION → READ, ACROSS THE SEAM.** The required table, one row per server action
   that mutates: action | backend route it calls | **what that route actually writes, read from the
   handler** — including any fan-out into other collections | cache tags the action invalidates |
   the queries those tags serve | does the invalidated set cover everything the backend write
   changed? A backend write with a fan-out the frontend does not know about is invisible to the
   frontend's own invalidation map, which is why this check cannot live in the frontend pass.

4. **AUTHORIZATION, END TO END.** Derive both halves: each call site's `authType`, and each backend
   route's router-level guard. One row per pair: entry point (public page / admin page / route handler) |
   action or call site | `authType` sent | guard the backend route requires | minimum privilege the
   operation actually needs | verdict. **A public entry point that transitively reaches an
   admin-guarded route, or a route whose guard is weaker than its effect, is CRITICAL** with a
   one-sentence exploit. Neither surface's table alone shows this.

5. **DUPLICATED AND DIVERGENT DEFINITIONS.** Sweep for the same concept defined independently on
   both surfaces: enums and literal unions, status and phase vocabularies, date and time formats,
   score formatting, validation rules, and any model defined twice within one surface as well. Per
   pair: do they agree at the boundaries — today, null, empty, zero, the first and last legal value?
   **A divergence here is a wrong answer, not a crash**, so nothing surfaces it except comparison.

6. **ERROR CONTRACT, END TO END.** Trace one representative failure of each class — validation
   error, not-found, unauthorised, backend unavailable, timeout — from the backend handler through
   the API client to what the user actually sees. Per class: shape emitted | shape parsed | boundary
   that catches it | message rendered, in German | what leaks on the way (stack, backend URL, trace
   id, submitted data). A class that renders a generic message where the backend sent an actionable
   one is a finding.

7. **CONFIGURATION AND TOPOLOGY CONTRACT.** Join the four environment inventories: a variable
   consumed by one surface and supplied by neither compose file, a name that differs by surface, a
   value whose format one side assumes and the other does not validate. Then the topology half:
   every control that exists only because of where things sit in the network, cross-checked against
   the nginx configs — the retired revalidation route (ADR-0035) is the pattern. **State what breaks each control**, because that
   list is what a future nginx or compose edit gets checked against.

8. **CONTRACT ENFORCEMENT.** For each seam above, name what would catch a regression today: a test,
   a lint rule, a schema check, or nothing. Produce the table: seam | current enforcement | what a
   regression would look like in production | cheapest control that would catch it. **This table is
   the pass's most durable output** — the seams have no owner, so every one left unenforced will
   drift again, and a control added here is a seam this pass never has to check by hand again. On a
   re-run, start from the previous programme's enforcement decisions in `docs/_decisions/` and the
   controls actually present in the gate: a seam already enforced needs its control verified, not
   its contract re-derived.

CROSS-SURFACE QUESTIONS: at a seam, "which side is right" is frequently a product decision rather
than a technical one, and picking silently produces a fix in the wrong half. Collect and batch every
such question per the shared protocol, each naming both readings and what each would cost.

BOUNDARIES — not this pass: anything visible from inside one surface. Per-surface structure, dead
code, styling, accessibility, performance, and single-surface security all belong to their own
passes. If a check here surfaces a single-surface defect, record it in one line under the verdict's
cross-surface handoffs and name the owning surface — it is a handoff, not a finding of this pass.
