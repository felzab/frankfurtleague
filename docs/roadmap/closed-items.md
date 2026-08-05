# Closed items

**Verified against:** `aebf43d`, 2026-08-05

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
number in their prefix, **counting retired ids too** — so the next ops item is **OPS-8**, because
OPS-6 and OPS-7 are both retired here.

## The log

| #   | ID    | Item                                                                                        | Surfaces    | Effort | Depended on              | Closed in                                                             |
| --- | ----- | ------------------------------------------------------------------------------------------- | ----------- | ------ | ------------------------ | --------------------------------------------------------------------- |
| 1   | F5    | A backend module that was empty and imported by nothing                                     | BE          | S      | —                        | [`6535247`](https://github.com/felzab/frankfurtleague/commit/6535247) |
| 2   | F6    | A comment deferring a granular cache tag to a route that already existed                    | FE          | S      | —                        | [`6535247`](https://github.com/felzab/frankfurtleague/commit/6535247) |
| 3   | OPS-1 | Container images published to Docker Hub, and where they should live                        | Ops         | M      | —                        | [`b2e80f2`](https://github.com/felzab/frankfurtleague/commit/b2e80f2) |
| 4   | DB-1  | Review the database structure against the models, and decide what is stored                 | DB, BE      | L      | —                        | [`75c0ce4`](https://github.com/felzab/frankfurtleague/commit/75c0ce4) |
| 5   | F4    | Team statistics were written to `teams` and read from `saison_teams`                        | BE, DB      | M      | DB-1                     | [`65be39a`](https://github.com/felzab/frankfurtleague/commit/65be39a) |
| 6   | FB-1  | The Saisontabelle counted playoff results as league results                                 | FE, BE      | M      | —                        | [`3a460d7`](https://github.com/felzab/frankfurtleague/commit/3a460d7) |
| 7   | BE-11 | Nothing executed the derived league table's pipeline against a database                     | BE          | S      | —                        | [`e506762`](https://github.com/felzab/frankfurtleague/commit/e506762) |
| 8   | DB-3  | Seventeen `saison_teams` rows still carried the `statistik` the derivation orphaned         | DB          | S      | —                        | [`1acfc49`](https://github.com/felzab/frankfurtleague/commit/1acfc49) |
| 9   | DB-2  | Nine collections with no validator and no index beyond `_id_`, hand-edited daily            | DB, BE, Ops | M      | —                        | [`5c017f8`](https://github.com/felzab/frankfurtleague/commit/5c017f8) |
| 10  | BE-4  | Six reference collections could only be read; edits went straight into MongoDB              | BE, FE, Ops | L      | —                        | [`3d7f701`](https://github.com/felzab/frankfurtleague/commit/3d7f701) |
| 11  | OPS-4 | Script terminal output varied by script, with no recorded standard                          | Ops         | M      | — (batched with OPS-5)   | [`f4b99ae`](https://github.com/felzab/frankfurtleague/commit/f4b99ae) |
| 12  | OPS-5 | Every pull request ran the full gate and both CodeQL analyses, whatever it touched          | Ops         | M      | — (batched with OPS-4)   | [`f4b99ae`](https://github.com/felzab/frankfurtleague/commit/f4b99ae) |
| 13  | OPS-6 | Whether a pull request body should index its commits, when their bodies say it              | Ops         | S      | —                        | [`e31d187`](https://github.com/felzab/frankfurtleague/commit/e31d187) |
| 14  | OPS-7 | Nothing checked the gate scope a run was given against the diff it was given                | Ops         | S      | —                        | [`501e450`](https://github.com/felzab/frankfurtleague/commit/501e450) |
| 15  | LOG-1 | Logging was surveyed, then standardised: one correlation id, one stream per service         | FE, BE, Ops | L      | —                        | [`87ce77c`](https://github.com/felzab/frankfurtleague/commit/87ce77c) |
| 16  | F2    | The Pydantic models and their Zod mirror were hand-maintained with nothing comparing them   | FE, BE      | M      | —                        | [`a9bbc71`](https://github.com/felzab/frankfurtleague/commit/a9bbc71) |
| 17  | BE-9  | An unresolved playoff opponent was a real team document named "TBD"                         | BE, FE      | L      | —                        | [`ca63cd9`](https://github.com/felzab/frankfurtleague/commit/ca63cd9) |
| 18  | FB-4  | The playoff bracket had no seeding check and advanced no winner when a result was entered   | FE, BE      | M      | — (slot model: ADR-0041) | [`f023414`](https://github.com/felzab/frankfurtleague/commit/f023414) |
| 19  | FB-10 | The first knockout round could not be seeded, because nothing could say who finished second | FE, BE, DB  | L      | — (batched with FE-4)    | [`aebf43d`](https://github.com/felzab/frankfurtleague/commit/aebf43d) |
| 20  | FE-4  | The Saisontabelle marked nobody as holding a playoff place                                  | FE, BE      | M      | — (batched with FB-10)   | [`aebf43d`](https://github.com/felzab/frankfurtleague/commit/aebf43d) |

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
- **BE-11** → [ADR-0030](../_decisions/0030-a-real-mongod-behind-a-deselected-marker.md), a real
  `mongod` behind a `db` marker the default suite deselects. It handed the backend audit a container
  fixture it no longer has to design, and handed OPS-5 a CI job explicitly marked provisional.
- **BE-4** → three ADRs: [0032](../_decisions/0032-soft-deletion-is-a-date-not-a-flag.md) (soft
  deletion is a date, and creating never revives), [0033](../_decisions/0033-one-active-season-and-one-path-to-it.md)
  (one active season, one path to it) and [0034](../_decisions/0034-the-write-path-is-resource-first-in-a-second-router.md)
  (resource-first URLs in a second router per slice). It also produced **DS14 and DS15** in
  [`../_standard/6-decisions.md`](../_standard/6-decisions.md), and opened **FB-6** (admin pages for
  seasons and matchdays, plus the rollover control) and **BE-12** (the purge `inactive_since` is a
  date for). It unblocked FB-3 and left ADR-0015 standing: the endpoints exist, no UI calls one.
- **DB-2** → [ADR-0031](../_decisions/0031-the-third-copy-of-the-schema-is-checked-not-generated.md),
  the rule that the `$jsonSchema` validators are hand-written and compared to the Pydantic models by a
  test rather than generated from them. It opened nothing. Two findings that were not decisions left
  it for permanent homes instead: the two scoped database users in `docs/ops/overview.md`, and the
  rule that a data change is ordered against the **deployed** image in `docs/workflows/README.md`.
- **OPS-6** → [ADR-0036](../_decisions/0036-a-pull-request-body-summarises-the-branch.md), the rule
  that a body summarises the branch and never indexes its commits, plus the orientation sentence a
  multi-commit body opens with. It opened nothing. One finding that was not a decision left it for a
  permanent home instead: the forty-five merged bodies were read on GitHub and do follow the
  template, so the Titles-and-bodies section of `docs/workflows/README.md` now states a dated
  reading rather than a caveat.
- **OPS-7** → [ADR-0037](../_decisions/0037-the-gate-refuses-an-undersized-scope.md), the rule that the
  gate refuses a run skipping the image build while the branch changes a file asking for it by more
  than comments, and reports every other unproven surface. It opened nothing. Two findings that were
  not decisions left it for permanent homes instead: CI's path mapping already enforced that floor,
  which is why no second CI check was built and is recorded in the ADR's alternatives; and the
  comment-only carve-out reaches only as far as a parser does, so CLAUDE.md's gate section now says
  that a Dockerfile comment still asks for the full form.
- **LOG-1** → [ADR-0039](../_decisions/0039-one-correlation-id-per-request-one-document-per-line.md)
  (one correlation id per request, one JSON document per line) and **`docs/logging.md`**, the
  maintained convention: the correlation-id design, the shared stream field set, and the full
  error-code table both services follow. It opened nothing and unblocked FE-6, whose affordance can
  now quote real coordinates instead of a class-level digest.
- **F2** → [ADR-0040](../_decisions/0040-the-zod-mirror-is-checked-against-the-published-document.md),
  the rule that the mirror is checked against a committed `fl_backend/openapi.json` rather than
  generated from it, on the wire contract only. It opened nothing. Three drifts it found on its first
  run were fixed in the same commit rather than filed, and one finding that was not a decision left it
  for a permanent home instead: backend audit pass B2's prompt now names what the check deliberately
  omits — ranges, patterns, lengths, formats — as that pass's subject.
- **BE-9** → [ADR-0041](../_decisions/0041-a-bracket-slot-carries-its-own-provenance.md), a nullable
  fixture side with its provenance label in an independent sibling field. It opened nothing and
  unblocked FB-4's part 2. Two findings that were not decisions left it for permanent homes instead:
  the slot vocabulary is `Quelle` in `docs/glossary.md`, and the two fields' independence is
  invariant I22 in `docs/backend/spec.md`.
- **FB-10** and **FE-4** →
  [ADR-0043](../_decisions/0043-a-group-placing-is-ranked-by-one-chain-and-seeded-only-when-final.md),
  one tiebreak chain that both orders the displayed table and seeds the bracket, a
  `rules.qualifiers_per_group` saying how many advance, one rule for who may hold a placing at all, and
  a placing written into a slot only when no combination of a group's remaining results could change
  it. Worked as one item because they ask the same question from opposite ends, and separately the
  season rule would have shipped with nothing reading it. They opened nothing. Two findings that were
  not decisions left them for permanent homes instead: that nothing edits `FLSaison.rules` is recorded
  in `docs/glossary.md` §`Saison` and in FB-6's entry, and the chain and its certainty rule are
  invariants I24–I24c in `docs/backend/spec.md`.
- **FB-4** → [ADR-0042](../_decisions/0042-a-result-entry-resolves-the-whole-bracket.md), the rule that a
  bracket slot stores a structural reference to what feeds it, the German label is derived from that
  reference and stored nowhere, and a result entry resolves the whole of its season's bracket. Its part
  1 was concluded by the owner rather than by research: the seeding is predefined and correct, the first
  knockout round is always group-seeded, and every later round is fed by two matches of the round
  before. It opened **FB-8** (a level knockout cannot record how it was decided), **FB-10** (seeding the
  first knockout round from the standings, which the `gruppe` variant exists for) and **OPS-9** (nothing
  lints or tests the repository's own hooks). It unblocked nothing — FE-4 never depended on the
  pairings, only on who qualifies.
