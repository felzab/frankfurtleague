# Decisions

Architecture Decision Records. One file per decision, numbered sequentially, **append-only**.

- **How ADRs work, and how to write one:** [`../_standard/3-adr-guide.md`](../_standard/3-adr-guide.md)
- **Template:** [`../_standard/templates/adr.md`](../_standard/templates/adr.md)

## Rules for this folder

1. Filenames are `NNNN-short-slug.md`, zero-padded, **never reused**. The number is the identity that
   code comments cite; the slug is for skimming and may be adjusted.
2. An accepted ADR's reasoning is **never edited**. To reverse a decision, write a new ADR and change
   exactly two lines in the old one: its `Status` and its `Superseded by`.
3. Superseded ADRs stay here, intact and readable. Their status line says what replaced them.
4. Add one line to the index below when you write one.

## Why this folder is flat

The rest of `/docs` is organised per surface (frontend / backend / ops). This folder is not, on
purpose: decisions routinely span surfaces, the number is a permanent identity cited from code so the
path must never move, numbering is global, and the log reads chronologically as the history of the
project's thinking. Full reasoning in
[`../_standard/2-out-of-code.md`](../_standard/2-out-of-code.md#why-adrs-are-not-split-by-surface).

**Browse by surface using the `Surface` column below**, not by directory.

## Index

Twenty-nine decisions. The first sixteen were extracted 2026-08-01 from material that already existed in argued form — CLAUDE.md §9
and the remediation ledger. **The dates are when each decision was taken**, not when the file was
written.

| ADR                                                              | Title                                                              | Surface                | Status         | Date       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------- | -------------- | ---------- |
| [0001](0001-two-granular-cache-tags.md)                          | Keep two granular cache tags, delete twenty                        | frontend, backend      | Accepted       | 2026-07-29 |
| [0002](0002-omitted-season-means-current.md)                     | An omitted `saison_id` means the current season                    | backend, frontend      | Accepted       | 2026-07-31 |
| [0003](0003-no-barrel-files.md)                                  | No barrel files, anywhere                                          | frontend               | Accepted       | 2026-07-29 |
| [0004](0004-optional-slice-modules.md)                           | `utils.ts` and `resolvers.ts` are sanctioned slice modules         | frontend               | Accepted       | 2026-07-29 |
| [0005](0005-spiel-write-path-belongs-to-spiele.md)               | The Spiel write path belongs to `spiele`, not `admin`              | frontend               | Accepted       | 2026-07-31 |
| [0006](0006-component-category-folders.md)                       | Component category folders, one extra level for forms              | frontend               | Accepted       | 2026-07-29 |
| [0007](0007-three-spiel-cards-stay-separate.md)                  | Three Spiel cards stay three components                            | frontend               | Accepted       | 2026-07-29 |
| [0008](0008-named-exports.md)                                    | Named exports; defaults only where Next.js requires                | frontend               | Accepted       | 2026-07-29 |
| [0009](0009-connection-guards-every-data-fetch.md)               | `await connection()` guards every page data fetch                  | frontend, ops          | Accepted       | 2026-07-29 |
| [0010](0010-authjs-owns-a-direct-mongoclient.md)                 | Auth.js owns a direct `MongoClient`                                | frontend               | Accepted       | 2026-07-29 |
| [0011](0011-no-generatestaticparams.md)                          | No `generateStaticParams` on the dynamic segments                  | frontend, ops          | Accepted       | 2026-07-29 |
| [0012](0012-admin-is-an-aggregator-slice.md)                     | `admin` is an aggregator; cross-feature lints must be scoped       | frontend               | Accepted       | 2026-07-29 |
| [0013](0013-admin-action-required-uncached.md)                   | `getAdminSpieleActionRequired` is deliberately uncached            | frontend               | Accepted       | 2026-07-29 |
| [0014](0014-keep-the-system-endpoints.md)                        | Keep the unused system endpoints and their API key                 | frontend, backend, ops | Accepted       | 2026-07-29 |
| [0015](0015-backend-triggered-revalidation-route.md)             | Backend-triggered revalidation through an in-network route         | frontend, ops          | Accepted       | 2026-07-30 |
| [0016](0016-single-enforced-csp.md)                              | One enforced CSP, with `react/no-danger` as the control            | ops, frontend          | Accepted       | 2026-07-30 |
| [0017](0017-ghcr-two-public-packages.md)                         | ghcr.io, two public packages, one per service                      | ops                    | Accepted       | 2026-08-01 |
| [0018](0018-no-meta-keywords.md)                                 | Ship no `keywords` meta tag                                        | frontend               | Accepted       | 2026-08-01 |
| [0019](0019-per-component-heroui-css.md)                         | HeroUI CSS imported per component, not as one entry point          | frontend               | Accepted       | 2026-08-01 |
| [0020](0020-no-react-compiler.md)                                | Do not enable the React Compiler                                   | frontend               | Accepted       | 2026-07-31 |
| [0021](0021-static-assets-reach-the-edge-uncompressed.md)        | Static assets reach the edge uncompressed                          | ops, frontend          | **Superseded** | 2026-08-01 |
| [0022](0022-origin-keeps-compressing.md)                         | The origin keeps compressing; the edge does not do it better       | ops, frontend          | Accepted       | 2026-08-01 |
| [0023](0023-admin-only-css-split.md)                             | Admin-only component CSS ships in its own stylesheet               | frontend               | Accepted       | 2026-08-01 |
| [0024](0024-immutable-only-for-hashed-urls.md)                   | `immutable` is only for content-hashed URLs                        | frontend, ops          | Accepted       | 2026-08-02 |
| [0025](0025-fluid-type-scale-outside-the-text-namespace.md)      | The fluid type scale lives outside Tailwind's `--text-*` namespace | frontend               | Accepted       | 2026-08-02 |
| [0026](0026-team-statistics-are-derived-from-spiele.md)          | Team statistics are derived from `spiele`, never stored            | backend, frontend      | Accepted       | 2026-08-02 |
| [0027](0027-the-database-enforces-its-own-invariants.md)         | The database enforces its own invariants                           | backend, ops           | Accepted       | 2026-08-02 |
| [0028](0028-store-what-was-true-then-derive-what-is-true-now.md) | Store what was true then; derive what is true now                  | backend, frontend      | Accepted       | 2026-08-02 |
| [0029](0029-the-league-table-counts-the-gruppenphase.md)         | The league table counts the Gruppenphase, and that is the default  | backend, frontend      | Accepted       | 2026-08-02 |

`Surface` lists every surface a decision touches. A decision spanning two is normal and is the reason
this folder is flat.

**By surface** — backend: 0001 · 0002 · 0014 · 0026 · 0027 · 0028 · 0029 · ops: 0009 · 0011 · 0014 · 0015 · 0016 · 0017 · 0021 · 0022 ·
0024 · 0027 · frontend: all except 0017 and 0027.

## Considered, and deliberately not made an ADR

Applying this folder's own test — _would someone reasonably propose the opposite next year, and would
you have to re-derive the argument to refuse?_

- **Ledger D3, deleting the unused Krub font.** A finding, not a decision: the font was verified unused
  end to end, and nobody will propose re-adding a font nothing references. Recording it would be the
  "we use Tailwind" failure the guide warns against.
- **BE-5, adding backend schema tests.** No rejected alternative — the constraints had no regression net
  at all. It is history, and it is described in `docs/backend/overview.md`.
- **BE-2, adding `ge=0` to `tore`.** A bug fix.

Open items that _will_ deserve an ADR once decided — **BE-4** (a real write path for the reference
resources) and **BE-9** (the placeholder team) — are not here yet, because they have not been decided.
They live in [`../roadmap/open-items.md`](../roadmap/open-items.md) until they are.
