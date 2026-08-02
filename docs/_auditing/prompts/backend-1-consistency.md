# Backend pass 1 — data consistency and write-path integrity

Paste into a fresh session (or run via `/audit:pass backend 1`).

---

Audit pass 1 of 4 on `./fl_backend`. Lens: DATA CONSISTENCY AND WRITE-PATH INTEGRITY — does every
write land where its readers read, atomically, exactly once, in the right scope.

Read `docs/_auditing/prompts/_shared-protocol.md` and follow it for the whole pass. Write the report
to `docs/audit/b1-consistency.md`.

This pass runs FIRST because its defect class is the worst one: writes that silently do not reach
their readers corrupt data invisibly, forever. **The motivating example is real, and it is closed.**
The admin result edit wrote team statistics to the `teams` collection while the teams endpoint served
them from the `saison_teams` junction, with nothing copying between them — undetected from the commit
that introduced the junction until 2026-08-02. The fix was not a redirected write:
[ADR-0026](../../_decisions/0026-team-statistics-are-derived-from-spiele.md) deleted both stored copies
and made the table derived. **What the pass should take from it is the method, not the finding:** the
field name matched on both sides and the document did not, so a write→read map built from field names
would have shown no gap at all.

CONTEXT — derive, do not assume: enumerate the collections from `app/core/db.py`, the write sites by
grepping for the crud helpers and raw Motor calls (`update_*`, `insert_*`, `delete_*`, `$set`,
`$inc`, `find_one_and_*`, `bulk`), and the read pipelines from each `services.py`. The domain model
splits identity from season-scoped data (`teams`/`saison_teams`, `spieler`/`saison_spieler`) — the
`$lookup`/`strict_join` semantics in `teams/services.py` are load-bearing for several checks. Three
resources (`saisons`, `spieler`, `spieltage`) have **no write path at all** and are edited directly
in MongoDB (ledger item BE-4) — that is a known, accepted state; findings about it are scoped to
what it implies, not to its existence.

THE CHECKS, in priority order:

1. **WRITE → READ MAP.** The required table, one row per write site: write site file:line | the
   collection and fields it writes | the filter it writes under (note especially: is it
   season-scoped?) | every read site that serves those fields | does the read project from the same
   document the write touched? | GAP yes/no. Derive the read side from the aggregation pipelines and
   projections, not from field names — the statistics gap survived for months precisely because the
   field name matched and the document did not. Report the full table, not only gap rows.

2. **DENORMALISATION INVENTORY.** Every embedded copy of another collection's data (the `ort`,
   `schiedsrichter` and team fields embedded in `spiele` documents, and anything else found): which
   writes to the source fan out to the copies (the patch endpoints do, via `patch_many_in_db`),
   which do not (soft delete deliberately does not — that is settled, see ADR-provenance in the
   ledger's Q1 answer if `docs/audit/` still holds it, else re-derive from `admin/router.py`), and
   for each non-fan-out: is the resulting staleness recorded and intended, or silent? A copy that
   can drift with no record of the decision is a finding.

3. **MULTI-DOCUMENT WRITE ATOMICITY.** Enumerate every endpoint performing more than one write —
   the venue and referee patches fan out into `spiele`, and the result edit is now single-document.
   What happens when write N succeeds and write N+1 fails? Are Motor sessions/transactions used
   anywhere? Is the partial state reachable, observable, repairable? Do not prescribe transactions
   reflexively — state the actual partial states and their cost, and present remedies (transaction,
   ordering that fails safe, recompute endpoint) as options with trade-offs.

4. **STATISTICS DERIVATION INTEGRITY.** The table is now computed by an aggregation on every read
   (ADR-0026), which removes the delta class of defect and introduces a read-time one. Audit the
   pipeline in `teams/services.py` against the season's real data: does a match land on exactly one
   side of exactly one team; is a team with no counting match served zeros rather than dropped; does
   a malformed `spiel` document now break `GET /teams`, which was independent of it before; and is
   the `ergebnis`-present rule (`is_canceled` deliberately not consulted) actually what the `$match`
   expresses. There is no integration test executing this pipeline — see the known-open row in
   `docs/backend/spec.md` — so measuring it read-only against live data is the available evidence.

5. **QUERY AND FILTER CONSTRUCTION.** Every `model_dump(include=…)` names real _fields_ (never
   aliases) — Pydantic's `include` silently matches nothing on an unknown name; this shipped as
   BE-8, and `tests/api/test_filter_builders.py` is the pattern for pinning it. Every filter
   builder: does each declared filter option actually reach the emitted query? Every `$lookup`:
   what happens to a row whose junction document is missing (strict join drops it — where is that
   the right behaviour and where does it hide data)?

6. **SOFT-DELETE SEMANTICS.** `is_inactive` — is it filtered consistently on every read path that
   should exclude inactive entities? Can a soft-deleted Schiedsrichter/Spielort still be assigned
   to a match by id? What does the frontend see for a match whose embedded entity was soft-deleted?

7. **REFERENTIAL INTEGRITY AT THE BOUNDARIES.** For every id accepted by a write endpoint
   (`team_id`, `spielort_id`, `schiedsrichter_id`, …): is existence validated before the id is
   written or embedded? What does a read path do with an orphaned reference — drop the row, 500, or
   serve it wrong? Include the placeholder-team mechanism ("TBD", `is_placeholder`) — its junction
   row is created by hand per season and its absence makes it vanish from team queries (ledger
   BE-9 context); report reachable failure states, not the modelling question itself, which is
   BE-9's open decision.

8. **OUT-OF-BAND WRITE SURFACE.** For the three collections with no API write path: enumerate every
   constraint the Pydantic read models enforce that a direct Mongo edit can violate, and what the
   violation does at read time (a constraint existing data violates 500s the endpoint serving that
   row). This is the concrete cost of BE-4 staying open — report it as a measured inventory, not a
   recommendation to build BE-4, which is the owner's decision with its own recorded analysis.

ALREADY DECIDED — report against these rather than re-litigating them. Checks 2 and 4 land squarely
on questions the database structure review settled on 2026-08-02:

- [ADR-0026](../../_decisions/0026-team-statistics-are-derived-from-spiele.md) — statistics are
  derived from `spiele`, never stored, and this is **built**, not planned. A match counts when it has
  an `ergebnis`; a cancelled match with a result is a forfeit and counts; points come from the
  season's `rules`. A table recomputed per request reads as an obvious thing to cache — proposing that
  is the ADR reversed, not a finding.
- [ADR-0028](../../_decisions/0028-store-what-was-true-then-derive-what-is-true-now.md) — the rule
  check 2's denormalisation inventory should measure against. Embedded names are display copies owed
  a fan-out; `mietpreis` and `payment` are point-in-time records and are _not_ stale copies of
  `default_mietpreis` / `default_payment`. Report a missing fan-out, never a proposal to normalise.
- [ADR-0027](../../_decisions/0027-the-database-enforces-its-own-invariants.md) — every collection now
  carries a `$jsonSchema` validator and the four uniqueness rules are unique indexes, declared in
  `app/core/constraints.py` and applied on every boot. **The absence of any other index is deliberate**
  and not a finding: at this size a query index would be theatre. Two more non-findings, both ratified:
  the validators assert types, presence and enums only — a missing `minLength` is the recorded scope,
  not a gap — and they duplicate the Pydantic models **by hand**, which
  [ADR-0031](../../_decisions/0031-the-third-copy-of-the-schema-is-checked-not-generated.md) settles
  with measurements. A default-tier test already compares the two copies, so drift between them is a
  test failure rather than an audit finding.

SEEDED PRIOR FINDINGS to re-verify and place, not re-derive from scratch: **F1** (the two definitions
of `ausstehend` — server includes today, client excludes it; a cross-surface _semantic_ divergence:
verify current state and report under check 5 as a decision to confirm, since the landing-page
behaviour may be intended), **BE-8** (fixed — confirm the regression net still pins it).

CROSS-SURFACE QUESTIONS: whether a given consistency gap is a defect or an accepted workflow
(Compass edits, seasonal setup rituals) is owner knowledge. Collect such questions per the shared
protocol instead of resolving them by assumption — this exact lens produced the frontend audit's
only two inverted HIGH findings by assuming instead of asking.

BOUNDARIES — not this pass: field-level constraint/mirror divergence with the frontend → pass B2 ·
authorization, injection, key tiers → pass B3 · module layout, dead code, test strategy, tooling →
pass B4. Runtime verification against live data is welcome where read-only (counts and `_id`s only,
never contact values); say plainly what was reasoned statically versus measured.
