# Decisions

**Folder purpose:** the Architecture Decision Record log — why the system is built the way it is,
and whether something that looks wrong is deliberate. One file per decision, append-only.

## Folder overview

One row per decision, and one row per file in this folder. **The dates are when each decision was
taken**, not when the file was written; the earliest entries were extracted 2026-08-01 from material
that already existed in argued form. **Browse by surface using the `Surface` column**, not by
directory — the folder is flat and the numbering global, because a number is a permanent identity
cited from code and the path must never move
([OUT-2](../_standard/chapters/3-corpus.md#out-2--the-folder-layout)).

| ADR                                                                               | Title                                                                        | Surface                | Status                 | Date       |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------- | ---------------------- | ---------- |
| [0001](0001-two-granular-cache-tags.md)                                           | Keep two granular cache tags, delete twenty                                  | frontend, backend      | Accepted               | 2026-07-29 |
| [0002](0002-omitted-season-means-current.md)                                      | An omitted `saison_id` means the current season                              | backend, frontend      | Accepted               | 2026-07-31 |
| [0003](0003-no-barrel-files.md)                                                   | The frontend file layout: no barrels, named exports, categories              | frontend               | Accepted               | 2026-07-29 |
| [0004](0004-spiel-write-path-belongs-to-spiele.md)                                | The Spiel write path belongs to `spiele`, not `admin`                        | frontend               | Accepted               | 2026-07-31 |
| [0005](0005-three-spiel-cards-stay-separate.md)                                   | Three Spiel cards stay three components                                      | frontend               | Accepted               | 2026-07-29 |
| [0006](0006-connection-guards-every-data-fetch.md)                                | `await connection()` guards every page data fetch                            | frontend, ops          | Accepted               | 2026-07-29 |
| [0007](0007-authjs-owns-a-direct-mongoclient.md)                                  | Auth.js owns a direct `MongoClient`                                          | frontend               | Accepted               | 2026-07-29 |
| [0008](0008-admin-is-an-aggregator-slice.md)                                      | `admin` is an aggregator; cross-feature lints must be scoped                 | frontend               | Accepted               | 2026-07-29 |
| [0009](0009-admin-scoped-reads-are-never-cached.md)                               | An admin-scoped API read is never cached                                     | frontend               | Accepted               | 2026-08-08 |
| [0010](0010-keep-the-system-endpoints.md)                                         | Keep the unused system endpoints and their API key                           | frontend, backend, ops | Accepted               | 2026-07-29 |
| [0011](0011-single-enforced-csp.md)                                               | One enforced CSP, with `react/no-danger` as the control                      | ops, frontend          | Accepted               | 2026-07-30 |
| [0012](0012-ghcr-two-public-packages.md)                                          | ghcr.io, two public packages, one per service                                | ops                    | Accepted               | 2026-08-01 |
| [0013](0013-per-component-heroui-css.md)                                          | HeroUI CSS imported per component, not as one entry point                    | frontend               | Accepted               | 2026-08-01 |
| [0014](0014-no-react-compiler.md)                                                 | Do not enable the React Compiler                                             | frontend               | Accepted               | 2026-07-31 |
| [0015](0015-origin-keeps-compressing.md)                                          | The origin keeps compressing; the edge does not do it better                 | ops, frontend          | Accepted               | 2026-08-01 |
| [0016](0016-admin-only-css-split.md)                                              | Admin-only component CSS ships in its own stylesheet                         | frontend               | Accepted               | 2026-08-01 |
| [0017](0017-immutable-only-for-hashed-urls.md)                                    | `immutable` is only for content-hashed URLs                                  | frontend, ops          | Accepted               | 2026-08-02 |
| [0018](0018-fluid-type-scale-outside-the-text-namespace.md)                       | The fluid type scale lives outside Tailwind's `--text-*` namespace           | frontend               | Accepted               | 2026-08-02 |
| [0019](0019-team-statistics-are-derived-from-spiele.md)                           | Team statistics are derived from `spiele`, never stored                      | backend, frontend      | Accepted               | 2026-08-02 |
| [0020](0020-the-database-enforces-its-own-invariants.md)                          | The database enforces its own invariants                                     | backend, ops           | Accepted               | 2026-08-02 |
| [0021](0021-store-what-was-true-then-derive-what-is-true-now.md)                  | Store what was true then; derive what is true now                            | backend, frontend      | Accepted               | 2026-08-02 |
| [0022](0022-the-league-table-counts-the-gruppenphase.md)                          | The league table counts the Gruppenphase, and that is the default            | backend, frontend      | Accepted               | 2026-08-02 |
| [0023](0023-a-real-mongod-behind-a-deselected-marker.md)                          | Pipelines are tested against a real `mongod`, behind a marker                | backend, ops           | Accepted               | 2026-08-02 |
| [0024](0024-the-third-copy-of-the-schema-is-checked-not-generated.md)             | The third copy of the schema is checked by a test, not generated             | backend                | Accepted               | 2026-08-02 |
| [0025](0025-soft-deletion-is-a-date-not-a-flag.md)                                | Soft deletion is a date, not a flag, and creating never revives              | backend, frontend      | Accepted               | 2026-08-02 |
| [0026](0026-one-active-season-and-one-path-to-it.md)                              | One active season, one path to it; a team leaves only by DQ                  | backend                | Superseded by ADR-0069 | 2026-08-02 |
| [0027](0027-the-write-path-is-resource-first-in-a-second-router.md)               | The write path is resource-first, in a second router per slice               | backend                | Accepted               | 2026-08-02 |
| [0028](0028-reference-data-staleness-is-bounded-by-cache-lifetime.md)             | Reference-data staleness is bounded by cache lifetime                        | frontend, ops          | Accepted               | 2026-08-04 |
| [0029](0029-a-pull-request-body-summarises-the-branch.md)                         | A pull request body summarises the branch, not its commits                   | ops                    | Accepted               | 2026-08-05 |
| [0030](0030-the-gate-refuses-an-undersized-scope.md)                              | The gate refuses a run that skips the image build                            | ops                    | Accepted               | 2026-08-05 |
| [0031](0031-the-image-cache-is-the-actions-cache-service.md)                      | The image build cache is the Actions cache service                           | ops                    | Accepted               | 2026-08-05 |
| [0032](0032-one-correlation-id-per-request-one-document-per-line.md)              | One correlation id per request, one JSON document per line                   | frontend, backend, ops | Accepted               | 2026-08-05 |
| [0033](0033-the-zod-mirror-is-checked-against-the-published-document.md)          | The Zod mirror is checked against a committed OpenAPI document               | frontend, backend, ops | Accepted               | 2026-08-05 |
| [0034](0034-a-result-entry-resolves-the-whole-bracket.md)                         | A bracket slot stores a reference; a result resolves the bracket             | backend, frontend      | Accepted               | 2026-08-05 |
| [0035](0035-a-group-placing-is-ranked-by-one-chain-and-seeded-only-when-final.md) | One tiebreak chain, and a placing is seeded only once it is final            | backend, frontend      | Accepted               | 2026-08-05 |
| [0036](0036-a-shoot-out-is-its-own-scoreline.md)                                  | A shoot-out is its own scoreline, read by the bracket alone                  | backend, frontend      | Accepted               | 2026-08-05 |
| [0037](0037-a-seasons-fixtures-are-created-once.md)                               | A season's fixtures are created once — `/spiele` has no POST, no DELETE      | backend                | Accepted               | 2026-08-05 |
| [0038](0038-the-write-path-refuses-wiring-the-season-cannot-hold.md)              | The write path refuses wiring the season cannot hold                         | backend, frontend      | Accepted               | 2026-08-05 |
| [0039](0039-a-bracket-fault-is-derived-on-demand.md)                              | A bracket fault is derived on demand, and reaches a list an admin reads      | backend, frontend      | Superseded by ADR-0073 | 2026-08-05 |
| [0040](0040-a-form-that-outgrows-a-dialog-becomes-a-page.md)                      | A form that outgrows a dialog becomes a page, and judges a field on blur     | frontend               | Accepted               | 2026-08-06 |
| [0041](0041-a-voided-result-is-named-before-it-is-lost.md)                        | A voided result is named by a dry run, and undone rather than confirmed      | backend, frontend      | Accepted               | 2026-08-06 |
| [0042](0042-a-team-is-fielded-once-per-spieltag.md)                               | A team is fielded once per Spieltag; a clash moves or is refused             | backend, frontend      | Accepted               | 2026-08-06 |
| [0043](0043-a-toast-is-built-in-tsx-not-patched-in-css.md)                        | A toast is built in TSX, and its duration is derived from what it says       | frontend               | Accepted               | 2026-08-06 |
| [0044](0044-a-triage-list-is-ordered-by-what-blocks-play.md)                      | A triage list is ordered by what blocks play; its section is in the URL      | frontend               | Accepted               | 2026-08-07 |
| [0045](0045-a-draw-is-reviewed-as-a-table-of-provenance.md)                       | A draw is reviewed as a table of provenance, on a page that writes nothing   | frontend               | Accepted               | 2026-08-07 |
| [0046](0046-one-bar-across-the-viewport-owns-every-page-title.md)                 | One bar across the viewport owns every page's title                          | frontend               | Accepted               | 2026-08-07 |
| [0047](0047-a-disqualification-is-a-record-and-its-absence-is-the-null.md)        | A disqualification is a record, and its absence is the null                  | backend, frontend      | Accepted               | 2026-08-07 |
| [0048](0048-position-and-stufe-are-closed-sets.md)                                | A player's position and stufe are closed sets                                | backend                | Accepted               | 2026-08-07 |
| [0049](0049-every-page-owned-editors-undo-is-a-route-handler.md)                  | Every page-owned editor's undo is a route handler, until E592 is fixed       | frontend               | Accepted               | 2026-08-07 |
| [0050](0050-a-matchday-list-is-the-seasons-skeleton.md)                           | A matchday list is the season's skeleton, and the rollover is on its page    | frontend               | Superseded by ADR-0072 | 2026-08-07 |
| [0051](0051-a-matchdays-position-is-derived-not-stored.md)                        | A matchday's position and name are derived, not stored                       | backend, frontend      | Accepted               | 2026-08-07 |
| [0052](0052-a-seasons-schedule-is-derived-from-its-rules.md)                      | A season's schedule is derived from its rules, and the rules hold a shape    | backend, frontend      | Accepted               | 2026-08-07 |
| [0053](0053-the-domain-model-is-declared-and-conformance-checked.md)              | The domain model is declared as data and conformance-checked, not evaluated  | backend                | Accepted               | 2026-08-07 |
| [0054](0054-one-declaration-of-the-collection-names.md)                           | One declaration of the collection names, as a `StrEnum`                      | backend                | Accepted               | 2026-08-08 |
| [0055](0055-an-unknown-season-is-stripped-from-the-url.md)                        | A `?saison_id=` naming no season is stripped from the URL                    | frontend               | Accepted               | 2026-08-08 |
| [0056](0056-the-season-document-is-cached-in-process.md)                          | The season document is cached in-process, dropped by its writes, TTL-bounded | backend                | Accepted               | 2026-08-08 |
| [0057](0057-a-path-identifies-a-query-validates.md)                               | A malformed id is a 404 in a path and a 422 in a query                       | backend                | Accepted               | 2026-08-08 |
| [0058](0058-a-status-filter-is-not-a-status-label.md)                             | `ausstehend` includes today as a filter and excludes it as a label           | frontend, backend      | Accepted               | 2026-08-08 |
| [0059](0059-a-restamp-is-not-a-material-change.md)                                | A markdown delta of stamp lines only does not re-arm `branch-impact`         | ops                    | Accepted               | 2026-08-09 |
| [0060](0060-the-branch-guard-compares-canonical-paths.md)                         | The branch guard compares canonical paths, and denies what it cannot answer  | ops                    | Accepted               | 2026-08-08 |
| [0061](0061-the-signin-redirect-carries-no-callbackurl.md)                        | The sign-in redirect carries no `callbackUrl`                                | frontend               | Accepted               | 2026-07-29 |
| [0063](0063-a-cancellation-is-counted-by-a-lookup-of-its-own.md)                  | A cancellation is counted by a `$lookup` of its own                          | backend                | Accepted               | 2026-08-10 |
| [0062](0062-a-group-change-is-a-swap-or-it-is-refused.md)                         | A mid-season group change is a swap of two clubs, in one transaction         | backend, frontend      | Accepted               | 2026-08-10 |
| [0064](0064-a-bot-commit-is-exempted-by-identity.md)                              | A bot commit is exempted by exact identity, from three rules                 | ops                    | Accepted               | 2026-08-10 |
| [0065](0065-formatting-happens-at-commit-time.md)                                 | Formatting happens at commit time; the gate only checks                      | ops, frontend          | Accepted               | 2026-08-10 |
| [0066](0066-a-refusal-is-not-a-failure.md)                                        | A checker answers four exit codes, and a refusal is not a failure            | ops                    | Accepted               | 2026-08-10 |
| [0067](0067-a-command-is-exempted-only-when-every-token-clears.md)                | A command is exempted only when every token clears; the block stays a copy   | ops                    | Accepted               | 2026-08-10 |
| [0068](0068-the-docs-gate-is-a-package-behind-a-shim.md)                          | The documentation gate is a package behind a shim, not called `check_docs`   | ops                    | Accepted               | 2026-08-10 |
| [0069](0069-the-activation-guard-has-an-override.md)                              | The activation guard stays on the endpoint; cancelling is its override       | backend                | Accepted               | 2026-08-13 |
| [0070](0070-a-draft-carrying-a-warning-is-confirmed-before-it-saves.md)           | A draft carrying a warning is confirmed before it saves, and the undo stays  | frontend               | Accepted               | 2026-08-13 |
| [0071](0071-the-swap-gains-a-second-entry-point.md)                               | The group swap gains a second entry point, with one side fixed               | frontend               | Accepted               | 2026-08-13 |
| [0072](0072-the-matchday-editor-becomes-a-page.md)                                | The matchday editor becomes a page, on what a form must say                  | frontend               | Accepted               | 2026-08-13 |
| [0073](0073-a-bracket-fault-is-stated-on-the-card-it-names.md)                    | A bracket fault is derived on demand; its reason is stated on the card       | backend, frontend      | Accepted               | 2026-08-13 |
| [0074](0074-the-group-swap-refuses-a-disqualified-club.md)                        | The group swap refuses moving a disqualified club forward                    | backend                | Accepted               | 2026-08-13 |

## Read next

- [`../_standard/chapters/4-decisions.md`](../_standard/chapters/4-decisions.md) — what earns an
  ADR, an ADR's anatomy, its numbering, and how a reversal is recorded
- [`../_standard/templates/adr.md`](../_standard/templates/adr.md) — the file to copy when writing
  one
- [`../_roadmap/open-items.md`](../_roadmap/open-items.md) and
  [`../_roadmap/tooling-items.md`](../_roadmap/tooling-items.md) — where an undecided question waits,
  with the analysis its decision will be taken from
