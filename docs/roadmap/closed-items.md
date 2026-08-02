# Closed items

**Verified against:** `3a460d7`, 2026-08-02

Every item that has left [`open-items.md`](open-items.md), one row each. This is a **log, not a
backlog**: nothing here is waiting for anything, and nothing here is re-opened by editing it — a
regression is a new item with a new ID.

**The row is a pointer, not a record.** The analysis that justified each item, and the reasoning that
concluded it, live in the closing commit's body and in whatever ADR it produced. That is the whole
point of the **Closed in** column: one `git show` recovers everything the entry held.

```bash
git show 65be39a          # the closing commit — its body is the record
```

**Numbers are permanent.** `#` is assigned in closing order and never renumbered, unlike
`open-items.md`, whose ranks are positional and shift whenever the file changes. A number here always
names the same item.

**IDs are never reused.** F4 is closed; nothing else may be called F4. New items take the next free
number in their prefix, counting retired ids too — so the next backend item is **BE-12**, even though
the open file's highest is BE-10.

## The log

| #   | ID    | Item                                                                                | Surfaces | Effort | Depended on | Closed in                                                             |
| --- | ----- | ----------------------------------------------------------------------------------- | -------- | ------ | ----------- | --------------------------------------------------------------------- |
| 1   | F5    | A backend module that was empty and imported by nothing                             | BE       | S      | —           | [`6535247`](https://github.com/felzab/frankfurtleague/commit/6535247) |
| 2   | F6    | A comment deferring a granular cache tag to a route that already existed            | FE       | S      | —           | [`6535247`](https://github.com/felzab/frankfurtleague/commit/6535247) |
| 3   | OPS-1 | Container images published to Docker Hub, and where they should live                | Ops      | M      | —           | [`b2e80f2`](https://github.com/felzab/frankfurtleague/commit/b2e80f2) |
| 4   | DB-1  | Review the database structure against the models, and decide what is stored         | DB, BE   | L      | —           | [`75c0ce4`](https://github.com/felzab/frankfurtleague/commit/75c0ce4) |
| 5   | F4    | Team statistics were written to `teams` and read from `saison_teams`                | BE, DB   | M      | DB-1        | [`65be39a`](https://github.com/felzab/frankfurtleague/commit/65be39a) |
| 6   | FB-1  | The Saisontabelle counted playoff results as league results                         | FE, BE   | M      | —           | [`3a460d7`](https://github.com/felzab/frankfurtleague/commit/3a460d7) |
| 7   | BE-11 | Nothing executed the derived league table's pipeline against a database             | BE       | S      | —           | [`e506762`](https://github.com/felzab/frankfurtleague/commit/e506762) |
| 8   | DB-3  | Seventeen `saison_teams` rows still carried the `statistik` the derivation orphaned | DB       | S      | —           | [`1acfc49`](https://github.com/felzab/frankfurtleague/commit/1acfc49) |
| 9   | DB-2  | Nine collections with no validator and no index beyond `_id_`, hand-edited daily   | DB, BE, Ops | M   | —           | [`5c017f8`](https://github.com/felzab/frankfurtleague/commit/5c017f8) |

## What each one produced

Only where the item left something behind that outlives its commit. An item that was simply fixed has
no row here — its commit is the whole story.

- **OPS-1** → [ADR-0017](../_decisions/0017-ghcr-two-public-packages.md), two public ghcr packages and
  the tag scheme rollback depends on.
- **DB-1** → three ADRs: [0026](../_decisions/0026-team-statistics-are-derived-from-spiele.md)
  (statistics are derived, never stored), [0027](../_decisions/0027-the-database-enforces-its-own-invariants.md)
  (the database enforces its own invariants) and
  [0028](../_decisions/0028-store-what-was-true-then-derive-what-is-true-now.md) (store what was true
  then; derive what is true now). It also opened DB-2, which carries the work ADR-0027 decided.
- **F4** → implemented ADR-0026 and opened BE-11 and DB-3 for the two things the implementation could
  not finish: integration coverage for the derived table, and deleting the field it orphaned.
- **FB-1** → [ADR-0029](../_decisions/0029-the-league-table-counts-the-gruppenphase.md), the two
  statistics scopes and the decision that an omitted one means the group table. It opened nothing, and
  it took the data question out of FE-3, which is now a purely visual item.
- **DB-2** → [ADR-0031](../_decisions/0031-the-third-copy-of-the-schema-is-checked-not-generated.md),
  the rule that the `$jsonSchema` validators are hand-written and compared to the Pydantic models by a
  test rather than generated from them. It opened nothing. Two findings that were not decisions left
  it for permanent homes instead: the two scoped database users in `docs/ops/overview.md`, and the
  rule that a data change is ordered against the **deployed** image in `docs/workflows/README.md`.
- **BE-11** → [ADR-0030](../_decisions/0030-a-real-mongod-behind-a-deselected-marker.md), a real
  `mongod` behind a `db` marker the default suite deselects. It handed the backend audit a container
  fixture it no longer has to design, and handed OPS-5 a CI job explicitly marked provisional.
