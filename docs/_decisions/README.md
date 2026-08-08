# Decisions

Architecture Decision Records. One file per decision, numbered sequentially, **append-only**.

- **How ADRs work, and how to write one:** [`../_standard/4-adr-guide.md`](../_standard/4-adr-guide.md)
- **Template:** [`../_standard/templates/adr.md`](../_standard/templates/adr.md)

## Rules for this folder

1. Filenames are `NNNN-short-slug.md`, zero-padded, **never reused**. The number is the identity that
   code comments cite; the slug is for skimming and may be adjusted.
2. An accepted ADR's reasoning is **never edited**. To reverse a decision, write a new ADR and change
   exactly two lines in the old one: its `Status` and its `Superseded by`.
3. Superseded ADRs stay here, intact and readable. Their status line says what replaced them.
4. Add one line to the index below when you write one.

A one-time consolidation (2026-08-08) absorbed the then-superseded files into their successors and
folded a few non-decisions into the spec sheets. The numbers it retired are permanent gaps, mapped in
[Retired numbers](#retired-numbers) below.

## Why this folder is flat

The rest of `/docs` is organised per surface (frontend / backend / ops). This folder is not, on
purpose: decisions routinely span surfaces, the number is a permanent identity cited from code so the
path must never move, numbering is global, and the log reads chronologically as the history of the
project's thinking. Full reasoning in
[`../_standard/3-out-of-code.md`](../_standard/3-out-of-code.md#why-adrs-are-not-split-by-surface).

**Browse by surface using the `Surface` column below**, not by directory.

## Index

One row per decision. The earliest entries were extracted 2026-08-01 from material that already
existed in argued form — CLAUDE.md §9 and the remediation ledger. **The dates are when each decision
was taken**, not when the file was written.

| ADR                                                                               | Title                                                                        | Surface                | Status   | Date       |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------- | -------- | ---------- |
| [0001](0001-two-granular-cache-tags.md)                                           | Keep two granular cache tags, delete twenty                                  | frontend, backend      | Accepted | 2026-07-29 |
| [0002](0002-omitted-season-means-current.md)                                      | An omitted `saison_id` means the current season                              | backend, frontend      | Accepted | 2026-07-31 |
| [0003](0003-no-barrel-files.md)                                                   | The frontend file layout: no barrels, named exports, categories              | frontend               | Accepted | 2026-07-29 |
| [0005](0005-spiel-write-path-belongs-to-spiele.md)                                | The Spiel write path belongs to `spiele`, not `admin`                        | frontend               | Accepted | 2026-07-31 |
| [0007](0007-three-spiel-cards-stay-separate.md)                                   | Three Spiel cards stay three components                                      | frontend               | Accepted | 2026-07-29 |
| [0009](0009-connection-guards-every-data-fetch.md)                                | `await connection()` guards every page data fetch                            | frontend, ops          | Accepted | 2026-07-29 |
| [0010](0010-authjs-owns-a-direct-mongoclient.md)                                  | Auth.js owns a direct `MongoClient`                                          | frontend               | Accepted | 2026-07-29 |
| [0012](0012-admin-is-an-aggregator-slice.md)                                      | `admin` is an aggregator; cross-feature lints must be scoped                 | frontend               | Accepted | 2026-07-29 |
| [0013](0013-admin-scoped-reads-are-never-cached.md)                               | An admin-scoped API read is never cached                                     | frontend               | Accepted | 2026-08-08 |
| [0014](0014-keep-the-system-endpoints.md)                                         | Keep the unused system endpoints and their API key                           | frontend, backend, ops | Accepted | 2026-07-29 |
| [0016](0016-single-enforced-csp.md)                                               | One enforced CSP, with `react/no-danger` as the control                      | ops, frontend          | Accepted | 2026-07-30 |
| [0017](0017-ghcr-two-public-packages.md)                                          | ghcr.io, two public packages, one per service                                | ops                    | Accepted | 2026-08-01 |
| [0019](0019-per-component-heroui-css.md)                                          | HeroUI CSS imported per component, not as one entry point                    | frontend               | Accepted | 2026-08-01 |
| [0020](0020-no-react-compiler.md)                                                 | Do not enable the React Compiler                                             | frontend               | Accepted | 2026-07-31 |
| [0022](0022-origin-keeps-compressing.md)                                          | The origin keeps compressing; the edge does not do it better                 | ops, frontend          | Accepted | 2026-08-01 |
| [0023](0023-admin-only-css-split.md)                                              | Admin-only component CSS ships in its own stylesheet                         | frontend               | Accepted | 2026-08-01 |
| [0024](0024-immutable-only-for-hashed-urls.md)                                    | `immutable` is only for content-hashed URLs                                  | frontend, ops          | Accepted | 2026-08-02 |
| [0025](0025-fluid-type-scale-outside-the-text-namespace.md)                       | The fluid type scale lives outside Tailwind's `--text-*` namespace           | frontend               | Accepted | 2026-08-02 |
| [0026](0026-team-statistics-are-derived-from-spiele.md)                           | Team statistics are derived from `spiele`, never stored                      | backend, frontend      | Accepted | 2026-08-02 |
| [0027](0027-the-database-enforces-its-own-invariants.md)                          | The database enforces its own invariants                                     | backend, ops           | Accepted | 2026-08-02 |
| [0028](0028-store-what-was-true-then-derive-what-is-true-now.md)                  | Store what was true then; derive what is true now                            | backend, frontend      | Accepted | 2026-08-02 |
| [0029](0029-the-league-table-counts-the-gruppenphase.md)                          | The league table counts the Gruppenphase, and that is the default            | backend, frontend      | Accepted | 2026-08-02 |
| [0030](0030-a-real-mongod-behind-a-deselected-marker.md)                          | Pipelines are tested against a real `mongod`, behind a marker                | backend, ops           | Accepted | 2026-08-02 |
| [0031](0031-the-third-copy-of-the-schema-is-checked-not-generated.md)             | The third copy of the schema is checked by a test, not generated             | backend                | Accepted | 2026-08-02 |
| [0032](0032-soft-deletion-is-a-date-not-a-flag.md)                                | Soft deletion is a date, not a flag, and creating never revives              | backend, frontend      | Accepted | 2026-08-02 |
| [0033](0033-one-active-season-and-one-path-to-it.md)                              | One active season, one path to it; a team leaves only by DQ                  | backend                | Accepted | 2026-08-02 |
| [0034](0034-the-write-path-is-resource-first-in-a-second-router.md)               | The write path is resource-first, in a second router per slice               | backend, frontend      | Accepted | 2026-08-02 |
| [0035](0035-reference-data-staleness-is-bounded-by-cache-lifetime.md)             | Reference-data staleness is bounded by cache lifetime                        | frontend, ops          | Accepted | 2026-08-04 |
| [0036](0036-a-pull-request-body-summarises-the-branch.md)                         | A pull request body summarises the branch, not its commits                   | ops                    | Accepted | 2026-08-05 |
| [0037](0037-the-gate-refuses-an-undersized-scope.md)                              | The gate refuses a run that skips the image build                            | ops                    | Accepted | 2026-08-05 |
| [0038](0038-the-image-cache-is-the-actions-cache-service.md)                      | The image build cache is the Actions cache service                           | ops                    | Accepted | 2026-08-05 |
| [0039](0039-one-correlation-id-per-request-one-document-per-line.md)              | One correlation id per request, one JSON document per line                   | frontend, backend, ops | Accepted | 2026-08-05 |
| [0040](0040-the-zod-mirror-is-checked-against-the-published-document.md)          | The Zod mirror is checked against a committed OpenAPI document               | frontend, backend, ops | Accepted | 2026-08-05 |
| [0042](0042-a-result-entry-resolves-the-whole-bracket.md)                         | A bracket slot stores a reference; a result resolves the bracket             | frontend, backend      | Accepted | 2026-08-05 |
| [0043](0043-a-group-placing-is-ranked-by-one-chain-and-seeded-only-when-final.md) | One tiebreak chain, and a placing is seeded only once it is final            | frontend, backend      | Accepted | 2026-08-05 |
| [0044](0044-a-shoot-out-is-its-own-scoreline.md)                                  | A shoot-out is its own scoreline, read by the bracket alone                  | frontend, backend      | Accepted | 2026-08-05 |
| [0045](0045-a-seasons-fixtures-are-created-once.md)                               | A season's fixtures are created once — `/spiele` has no POST, no DELETE      | backend                | Accepted | 2026-08-05 |
| [0046](0046-the-write-path-refuses-wiring-the-season-cannot-hold.md)              | The write path refuses wiring the season cannot hold                         | frontend, backend      | Accepted | 2026-08-05 |
| [0047](0047-a-bracket-fault-is-derived-on-demand.md)                              | A bracket fault is derived on demand, and all five are reported              | frontend, backend      | Accepted | 2026-08-05 |
| [0050](0050-a-form-that-outgrows-a-dialog-becomes-a-page.md)                      | A form that outgrows a dialog becomes a page, and judges a field on blur     | frontend               | Accepted | 2026-08-06 |
| [0051](0051-a-voided-result-is-named-before-it-is-lost.md)                        | A voided result is named by a dry run, and undone rather than confirmed      | backend, frontend      | Accepted | 2026-08-06 |
| [0052](0052-a-team-is-fielded-once-per-spieltag.md)                               | A team is fielded once per Spieltag; a clash moves or is refused             | backend, frontend      | Accepted | 2026-08-06 |
| [0053](0053-a-toast-is-built-in-tsx-not-patched-in-css.md)                        | A toast is built in TSX, and its duration is derived from what it says       | frontend               | Accepted | 2026-08-06 |
| [0056](0056-a-triage-list-is-ordered-by-what-blocks-play.md)                      | A triage list is ordered by what blocks play; its section is in the URL      | frontend               | Accepted | 2026-08-07 |
| [0057](0057-a-draw-is-reviewed-as-a-table-of-provenance.md)                       | A draw is reviewed as a table of provenance, on a page that writes nothing   | frontend               | Accepted | 2026-08-07 |
| [0058](0058-one-bar-across-the-viewport-owns-every-page-title.md)                 | One bar across the viewport owns every page's title                          | frontend               | Accepted | 2026-08-07 |
| [0059](0059-a-disqualification-is-a-record-and-its-absence-is-the-null.md)        | A disqualification is a record, and its absence is the null                  | backend, frontend      | Accepted | 2026-08-07 |
| [0061](0061-position-and-stufe-are-closed-sets.md)                                | A player's position and stufe are closed sets                                | backend                | Accepted | 2026-08-07 |
| [0062](0062-every-page-owned-editors-undo-is-a-route-handler.md)                  | Every page-owned editor's undo is a route handler, until E592 is fixed       | frontend               | Accepted | 2026-08-07 |
| [0063](0063-a-matchday-list-is-the-seasons-skeleton.md)                           | A matchday list is the season's skeleton, and the rollover is on its page    | frontend               | Accepted | 2026-08-07 |
| [0064](0064-a-matchdays-position-is-derived-not-stored.md)                        | A matchday's position and name are derived, not stored                       | backend, frontend      | Accepted | 2026-08-07 |
| [0065](0065-a-seasons-schedule-is-derived-from-its-rules.md)                      | A season's schedule is derived from its rules, and the rules hold a shape    | backend, frontend      | Accepted | 2026-08-07 |
| [0066](0066-the-domain-model-is-declared-and-conformance-checked.md)              | The domain model is declared as data and conformance-checked, not evaluated  | backend                | Accepted | 2026-08-07 |
| [0068](0068-one-declaration-of-the-collection-names.md)                           | One declaration of the collection names, as a `StrEnum`                      | backend                | Accepted | 2026-08-08 |
| [0069](0069-an-unknown-season-is-stripped-from-the-url.md)                        | A `?saison_id=` naming no season is stripped from the URL                    | frontend               | Accepted | 2026-08-08 |
| [0070](0070-the-season-document-is-cached-in-process.md)                          | The season document is cached in-process, dropped by its writes, TTL-bounded | backend                | Accepted | 2026-08-08 |
| [0071](0071-a-path-identifies-a-query-validates.md)                               | A malformed id is a 404 in a path and a 422 in a query                       | backend                | Accepted | 2026-08-08 |
| [0072](0072-a-status-filter-is-not-a-status-label.md)                             | `ausstehend` includes today as a filter and excludes it as a label           | frontend, backend      | Accepted | 2026-08-08 |

`Surface` lists every surface a decision touches. A decision spanning two is normal and is the reason
this folder is flat.

## Retired numbers

Retired by the consolidation of 2026-08-08, except 0054. Each number is a permanent gap; the content
lives where the row says.

| Number | Where the content went                                                           |
| ------ | -------------------------------------------------------------------------------- |
| 0004   | [ADR-0003](0003-no-barrel-files.md)                                              |
| 0006   | [ADR-0003](0003-no-barrel-files.md)                                              |
| 0008   | [ADR-0003](0003-no-barrel-files.md)                                              |
| 0011   | `docs/frontend/spec.md`, invariant I28 (no `generateStaticParams`)               |
| 0015   | [ADR-0035](0035-reference-data-staleness-is-bounded-by-cache-lifetime.md)        |
| 0018   | `docs/frontend/overview.md`, the metadata rules (no `keywords` tag)              |
| 0021   | [ADR-0022](0022-origin-keeps-compressing.md)                                     |
| 0041   | [ADR-0042](0042-a-result-entry-resolves-the-whole-bracket.md)                    |
| 0048   | [ADR-0051](0051-a-voided-result-is-named-before-it-is-lost.md)                   |
| 0049   | [ADR-0052](0052-a-team-is-fielded-once-per-spieltag.md)                          |
| 0054   | Nowhere — written 2026-08-07 and reverted the same day, before anything cited it |
| 0055   | [ADR-0062](0062-every-page-owned-editors-undo-is-a-route-handler.md)             |
| 0060   | [ADR-0062](0062-every-page-owned-editors-undo-is-a-route-handler.md)             |
| 0067   | [ADR-0064](0064-a-matchdays-position-is-derived-not-stored.md)                   |

## Considered, and deliberately not made an ADR

Applying this folder's own test — _would someone reasonably propose the opposite next year, and would
you have to re-derive the argument to refuse?_

- **Ledger D3, deleting the unused Krub font.** A finding, not a decision: the font was verified unused
  end to end, and nobody will propose re-adding a font nothing references. Recording it would be the
  "we use Tailwind" failure the guide warns against.
- **BE-5, adding backend schema tests.** No rejected alternative — the constraints had no regression net
  at all. It is history, and it is described in `docs/backend/overview.md`.
- **BE-2, adding `ge=0` to `tore`.** A bug fix.

Open items that will deserve an ADR once decided live in
[`../roadmap/open-items.md`](../roadmap/open-items.md) until they are, each with the analysis the
decision will be taken from.
