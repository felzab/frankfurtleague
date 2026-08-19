# Backend pass 1 — data consistency and write-path integrity

Audit pass `backend 1` on `./fl_backend`. Lens: DATA CONSISTENCY AND WRITE-PATH INTEGRITY — does
every write land where its readers read, atomically, exactly once, in the right scope.

Read `docs/_auditing/prompts/_shared-protocol.md` and follow it for the whole pass. Write the report
to `docs/audit/programme/b1-consistency.md`.

Run this pass first in the backend surface: a write that silently does not reach its readers corrupts
data invisibly, and does so for as long as nobody looks.

**The method this pass exists to apply: build the write→read map from the aggregation pipelines and
projections, never from field names.** A write and a read can name the same field on different
documents. That gap is invisible to any name-based comparison and can survive indefinitely, because
every individual piece of code reads correctly on its own.

DELIVERABLE: the write→read map (check 1) is required and is reported in full, not only its gap rows.
The denormalisation inventory (check 2) and the out-of-band constraint inventory (check 8) are
required lists.

CONTEXT — derive, do not assume: enumerate the collections from `app/core/db.py`; the write sites by
grepping for the CRUD helpers in `app/core/crud.py` and for raw Motor calls (`update_*`, `insert_*`,
`delete_*`, `$set`, `$inc`, `find_one_and_*`, `bulk`); and the read pipelines from each
`services.py`. The domain model splits identity from season-scoped data (`teams` / `saison_teams`,
`spieler` / `saison_spieler`), and the `$lookup` and strict-join semantics in `teams/services.py` are
load-bearing for several checks below. Every resource has an `admin_router.py` write surface; read it
rather than assuming which operations exist.

THE CHECKS, in priority order:

1. **WRITE → READ MAP.** The required table, one row per write site: write site file:line | the
   collection and fields it writes | the filter it writes under (note especially whether it is
   season-scoped) | every read site serving those fields | does the read project from the same
   document the write touched? | GAP yes/no. Derive the read side from the pipelines and
   projections, not from field names. Report the full table, not only the gap rows.

2. **DENORMALISATION INVENTORY.** Every embedded copy of another collection's data — the `ort`,
   `schiedsrichter` and team fields embedded in `spiele` documents, plus anything else you find.
   Per copy: which writes to the source fan out to it (the patch endpoints do, via
   `patch_many_in_db`), which deliberately do not (read the `admin_router.py` files for the recorded
   reasons, and the store-what-was-true rule below), and for each non-fan-out, is the resulting
   staleness recorded and intended, or silent? **A copy that can drift with no record of the decision
   is a finding.**

3. **MULTI-DOCUMENT WRITE ATOMICITY.** Enumerate every endpoint performing more than one write. What
   happens when write N succeeds and write N+1 fails? Are Motor sessions or transactions used
   anywhere? Is the partial state reachable, observable, repairable? Do not prescribe transactions
   reflexively — state the actual partial states and what each costs, and present the remedies
   (transaction, ordering that fails safe, a recompute endpoint) as options with trade-offs.

4. **STATISTICS DERIVATION INTEGRITY.** The league table is computed by an aggregation on every read,
   which removes one defect class and introduces a read-time one. Audit the pipeline in
   `teams/services.py` against the season's real data: does a match land on exactly one side of
   exactly one team; is a team with no counting match served zeros rather than dropped; can a
   malformed `spiel` document break `GET /teams`, which the derivation makes depend on `spiele`; and
   does the `$match` actually express the `ergebnis`-present rule, with `is_canceled` deliberately
   not consulted? Measuring it read-only against live data is the available evidence.

5. **QUERY AND FILTER CONSTRUCTION.** Every `model_dump(include=…)` must name real _fields_, never
   aliases — Pydantic's `include` silently matches nothing on an unknown name and raises nothing, so
   a filter builder can quietly emit the wrong query. `tests/api/test_filter_builders.py` is the
   pattern for pinning this. Per filter builder: does each declared filter option actually reach the
   emitted query? Per `$lookup`: what happens to a row whose junction document is missing (a strict
   join drops it — where is that right, and where does it hide data)?

6. **SOFT-DELETE SEMANTICS.** Soft deletion is the nullable `inactive_since` date, never a boolean.
   Is it filtered consistently on every read path that should exclude retired entities?
   Can a retired Schiedsrichter or Spielort still be assigned to a match by id? What does a consumer
   see for a match whose embedded entity was retired after the match was written? Note that
   `saisons`, `saison_teams` and `spiele` deliberately have no such field.

7. **REFERENTIAL INTEGRITY AT THE BOUNDARIES.** For every id accepted by a write endpoint
   (`team_id`, `spielort_id`, `schiedsrichter_id`, …): is existence validated before the id is
   written or embedded? What does a read path do with an orphaned reference — drop the row, 500, or
   serve it wrong? Include the unresolved bracket slot: `team1` and `team2` are nullable and their
   `teamN_quelle` siblings are not paired with them by any rule, so report what each read path does
   with all four combinations rather than only the two that read well.

8. **OUT-OF-BAND WRITE SURFACE.** Every collection can still be edited directly in MongoDB, and
   Pydantic validates on the way **out**, so a stored document violating a read model produces a 500
   on the endpoint serving it. The `$jsonSchema` validators in `app/core/constraints.py` assert
   types, presence and enums only, which leaves every other Pydantic constraint unprotected against a
   direct edit. This pass owns the resulting inventory, for the whole backend:
   the constraint | the read model carrying it | what a violating document does at read time.
   `saison_teams` and `saison_spieler` have no Pydantic model to mirror, so verify those against
   live data with `python -m app.core.constraints --check`.

ALREADY DECIDED — report against these, do not re-litigate them:

- **Statistics are derived from `spiele`**, never stored, and this is **built**, not planned. A match
  counts when it has an `ergebnis`; a cancelled match with a result is a forfeit and counts; points
  come from the season's `rules`. A table recomputed per request reads as an obvious thing to cache —
  proposing that reverses a ratified decision rather than reporting a finding.
- **Store what was true then, derive what is true now** — the rule check 2 measures against. Embedded
  names are display copies owed a fan-out; `mietpreis` and `payment` are point-in-time records and
  are **not** stale copies of `default_mietpreis` / `default_payment`. Report a missing fan-out;
  never propose normalising these away.
- **The database enforces its own invariants** — every collection carries a `$jsonSchema` validator,
  and the uniqueness rules are unique indexes, declared in `app/core/constraints.py` and reapplied on
  every boot. **The absence of any other index is deliberate** and not a finding: at this data size a
  query index would be theatre. Two further non-findings: the validators assert types, presence and
  enums only, so a missing `minLength` is the recorded scope rather than a gap; and they duplicate
  the Pydantic models **by hand**, deliberately rather than by generation. A default-tier test
  compares the two copies, so drift between them is a test failure, not an audit finding.
- **Soft deletion is a date, not a flag, and one season is active by one path** — creating never
  revives a retired row, and a natural-key collision on create is a **409**, which is correct rather
  than a bug. `saison_teams` has no DELETE and `saisons` has no DELETE; neither is an incomplete CRUD
  surface to complete.
- **The two definitions of `ausstehend`** — the server's filter includes today, the client's label
  excludes it — are ratified. Verify the code still matches; the divergence itself is not a finding.

KNOWN OPEN ITEMS to place rather than re-derive: `docs/_roadmap/open-items.md` tracks the backend items
that are open by decision. Verify each at the current code and cite the roadmap entry instead of
re-analysing it.

CROSS-SURFACE QUESTIONS: whether a given consistency gap is a defect or an accepted manual workflow
(direct database edits, seasonal setup rituals) is knowledge only I have. Collect such questions per
the shared protocol instead of resolving them by assumption. **This lens produces inverted findings
more readily than any other** — a write that looks lost is frequently a workflow that is deliberate.

BOUNDARIES — not this pass: field-level constraint and mirror divergence with the frontend → b2 ·
authorization, injection, key tiers → b3 · module layout, excess, dead code, test strategy, tooling →
b4. Runtime verification against live data is welcome where read-only (counts and `_id`s only, never
contact values); say plainly what was reasoned statically and what was measured.
