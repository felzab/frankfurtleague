# Closed items

**Verified against:** `3014d32`, 2026-08-08

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

| #   | ID    | Item                                                                                               | Surfaces    | Effort | Depended on                  | Closed in                                                             |
| --- | ----- | -------------------------------------------------------------------------------------------------- | ----------- | ------ | ---------------------------- | --------------------------------------------------------------------- |
| 1   | F5    | A backend module that was empty and imported by nothing                                            | BE          | S      | —                            | [`6535247`](https://github.com/felzab/frankfurtleague/commit/6535247) |
| 2   | F6    | A comment deferring a granular cache tag to a route that already existed                           | FE          | S      | —                            | [`6535247`](https://github.com/felzab/frankfurtleague/commit/6535247) |
| 3   | OPS-1 | Container images published to Docker Hub, and where they should live                               | Ops         | M      | —                            | [`b2e80f2`](https://github.com/felzab/frankfurtleague/commit/b2e80f2) |
| 4   | DB-1  | Review the database structure against the models, and decide what is stored                        | DB, BE      | L      | —                            | [`75c0ce4`](https://github.com/felzab/frankfurtleague/commit/75c0ce4) |
| 5   | F4    | Team statistics were written to `teams` and read from `saison_teams`                               | BE, DB      | M      | DB-1                         | [`65be39a`](https://github.com/felzab/frankfurtleague/commit/65be39a) |
| 6   | FB-1  | The Saisontabelle counted playoff results as league results                                        | FE, BE      | M      | —                            | [`3a460d7`](https://github.com/felzab/frankfurtleague/commit/3a460d7) |
| 7   | BE-11 | Nothing executed the derived league table's pipeline against a database                            | BE          | S      | —                            | [`e506762`](https://github.com/felzab/frankfurtleague/commit/e506762) |
| 8   | DB-3  | Seventeen `saison_teams` rows still carried the `statistik` the derivation orphaned                | DB          | S      | —                            | [`1acfc49`](https://github.com/felzab/frankfurtleague/commit/1acfc49) |
| 9   | DB-2  | Nine collections with no validator and no index beyond `_id_`, hand-edited daily                   | DB, BE, Ops | M      | —                            | [`5c017f8`](https://github.com/felzab/frankfurtleague/commit/5c017f8) |
| 10  | BE-4  | Six reference collections could only be read; edits went straight into MongoDB                     | BE, FE, Ops | L      | —                            | [`3d7f701`](https://github.com/felzab/frankfurtleague/commit/3d7f701) |
| 11  | OPS-4 | Script terminal output varied by script, with no recorded standard                                 | Ops         | M      | — (batched with OPS-5)       | [`f4b99ae`](https://github.com/felzab/frankfurtleague/commit/f4b99ae) |
| 12  | OPS-5 | Every pull request ran the full gate and both CodeQL analyses, whatever it touched                 | Ops         | M      | — (batched with OPS-4)       | [`f4b99ae`](https://github.com/felzab/frankfurtleague/commit/f4b99ae) |
| 13  | OPS-6 | Whether a pull request body should index its commits, when their bodies say it                     | Ops         | S      | —                            | [`e31d187`](https://github.com/felzab/frankfurtleague/commit/e31d187) |
| 14  | OPS-7 | Nothing checked the gate scope a run was given against the diff it was given                       | Ops         | S      | —                            | [`501e450`](https://github.com/felzab/frankfurtleague/commit/501e450) |
| 15  | LOG-1 | Logging was surveyed, then standardised: one correlation id, one stream per service                | FE, BE, Ops | L      | —                            | [`87ce77c`](https://github.com/felzab/frankfurtleague/commit/87ce77c) |
| 16  | F2    | The Pydantic models and their Zod mirror were hand-maintained with nothing comparing them          | FE, BE      | M      | —                            | [`a9bbc71`](https://github.com/felzab/frankfurtleague/commit/a9bbc71) |
| 17  | BE-9  | An unresolved playoff opponent was a real team document named "TBD"                                | BE, FE      | L      | —                            | [`ca63cd9`](https://github.com/felzab/frankfurtleague/commit/ca63cd9) |
| 18  | FB-4  | The playoff bracket had no seeding check and advanced no winner when a result was entered          | FE, BE      | M      | — (slot model: ADR-0042)     | [`f023414`](https://github.com/felzab/frankfurtleague/commit/f023414) |
| 19  | FB-10 | The first knockout round could not be seeded, because nothing could say who finished second        | FE, BE, DB  | L      | — (batched with FE-4)        | [`aebf43d`](https://github.com/felzab/frankfurtleague/commit/aebf43d) |
| 20  | FE-4  | The Saisontabelle marked nobody as holding a playoff place                                         | FE, BE      | M      | — (batched with FB-10)       | [`aebf43d`](https://github.com/felzab/frankfurtleague/commit/aebf43d) |
| 21  | FB-8  | A knockout that ended level had nowhere to record how it was decided, so the bracket stalled       | FE, BE, DB  | M      | — (clock: the playoffs)      | [`ab20403`](https://github.com/felzab/frankfurtleague/commit/ab20403) |
| 22  | FB-12 | A knockout slot with no team and no source was maintained by nobody and reported by nobody         | FE, BE      | S      | — (clock: the playoffs)      | [`6331791`](https://github.com/felzab/frankfurtleague/commit/6331791) |
| 23  | FB-13 | Two bracket faults lived in one toast and three more were contained without a word                 | FE, BE      | M      | — (surface: ADR-0046)        | [`125f1cc`](https://github.com/felzab/frankfurtleague/commit/125f1cc) |
| 24  | FB-14 | The seeding, advancement, edit and feedback surfaces measured against established practice         | FE, BE, DB  | L      | — (owned FB-9's verdict)     | [`0fae7b4`](https://github.com/felzab/frankfurtleague/commit/0fae7b4) |
| 25  | FE-10 | The match editor was a dialog with no URL, 311px of width and a round-trip per error message       | FE          | L      | — (ADR-0051 landed on it)    | [`efed00a`](https://github.com/felzab/frankfurtleague/commit/efed00a) |
| 26  | FE-11 | A toast could not be dismissed without a hover, and every message shared a four-second clock       | FE          | S      | — (ADR-0051 shaped it)       | [`cc55487`](https://github.com/felzab/frankfurtleague/commit/cc55487) |
| 27  | FE-12 | An eight-section accordion ordered by how the categories happened to be declared                   | FE          | M      | — (its links had a target)   | [`68ac42d`](https://github.com/felzab/frankfurtleague/commit/68ac42d) |
| 28  | FB-2  | A team could only **be** disqualified, with no record of why or from when                          | FE, BE, DB  | M      | —                            | [`3669cc7`](https://github.com/felzab/frankfurtleague/commit/3669cc7) |
| 29  | FB-5  | The Spiel cards were the one surface a disqualification could not reach                            | FE, BE      | S      | — (FB-2 shaped the field)    | [`3287df2`](https://github.com/felzab/frankfurtleague/commit/3287df2) |
| 30  | FB-11 | A season's bracket wiring had no view, and was editable only one match at a time                   | FE, BE      | L      | —                            | [`dfec0fa`](https://github.com/felzab/frankfurtleague/commit/dfec0fa) |
| 31  | FE-13 | Two admin tables still scrolled sideways on a phone                                                | FE          | S      | — (teams table templated it) | in FB-3's teams PR (row 32)                                           |
| 32  | FB-3  | The admin panel could edit no team and no player; both were hand-edited in MongoDB                 | FE, BE      | L      | — (ADR-0050's patterns)      | [`5518774`](https://github.com/felzab/frankfurtleague/commit/5518774) |
| 33  | FB-6  | The rollover was done by hand against endpoints that already existed, with no page calling one     | FE, BE      | L      | — (ADR-0033 settled it)      | [`fa5832a`](https://github.com/felzab/frankfurtleague/commit/fa5832a) |
| 34  | FE-5  | The Spielsuche could only be searched, not narrowed, and Spielhistorie duplicated it               | FE          | M      | — (F1 informed it)           | [`9a0f3b5`](https://github.com/felzab/frankfurtleague/commit/9a0f3b5) |
| 35  | F7    | The landing page's season badge was a literal that no rollover would have moved                    | FE          | S      | — (clock: the rollover)      | [`9cb426d`](https://github.com/felzab/frankfurtleague/commit/9cb426d) |
| 36  | FE-9  | User-facing copy mixed the capitalised Du with lowercase, and no recorded rule said which          | FE          | S      | —                            | [`4ff9af6`](https://github.com/felzab/frankfurtleague/commit/4ff9af6) |
| 37  | BE-10 | The season document was read from Mongo on every request that resolved or scored with it           | BE          | S      | —                            | [`c26c3e3`](https://github.com/felzab/frankfurtleague/commit/c26c3e3) |
| 38  | FE-8  | The compact card's metadata row could not wrap, and crushed its info button on phones              | FE          | S      | — (overlaps FE-3)            | [`b86e282`](https://github.com/felzab/frankfurtleague/commit/b86e282) |
| 39  | FE-7  | The delete confirmation's second step turned the blurred backdrop flat as it animated in           | FE          | S      | —                            | [`69c506f`](https://github.com/felzab/frankfurtleague/commit/69c506f) |
| 40  | FB-9  | A manual knockout slot accepted a disqualified team silently, and a matchday could field one twice | FE, BE      | M      | — (ADR-0052 settled it)      | [`4d35788`](https://github.com/felzab/frankfurtleague/commit/4d35788) |
| 40  | BE-13 | A malformed id answered 404 in a path and 422 in a query, and no rule said the split was meant     | BE          | S      | —                            | [`4fcb250`](https://github.com/felzab/frankfurtleague/commit/4fcb250) |
| 41  | F1    | The server's `ausstehend` included today and the client's excluded it, with the intent unsaid      | FE, BE      | S      | — (latest with FE-1)         | [`2ea28e0`](https://github.com/felzab/frankfurtleague/commit/2ea28e0) |
| 42  | OPS-9 | The assistant hooks gated every session and nothing linted or executed any of them                 | Ops         | S      | —                            | [`1d98034`](https://github.com/felzab/frankfurtleague/commit/1d98034) |
| 43  | FE-2  | A match had nowhere to carry a sentence about itself, and the editor nothing to write one with     | FE (+BE)    | S      | — (batch with FB-7, FE-1)    | [`0efa98e`](https://github.com/felzab/frankfurtleague/commit/0efa98e) |
| 44  | FE-6  | The error page logged everything and offered its reader no way to say what they were doing         | FE          | S      | —                            | [`11497ba`](https://github.com/felzab/frankfurtleague/commit/11497ba) |

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
  (resource-first URLs in a second router per slice). It also produced two documentation-standard
  rules — documentation names only what exists, and a header cites an ADR rather than restating it
  (COR-3 and INC-3 in `../_standard/chapters/`) — and opened **FB-6** (admin pages for
  seasons and matchdays, plus the rollover control) and **BE-12** (the purge `inactive_since` is a
  date for). It unblocked FB-3, and it left the in-network revalidation route standing (retired
  decision 0015; [ADR-0035](../_decisions/0035-reference-data-staleness-is-bounded-by-cache-lifetime.md)
  later removed it) on the reasoning that endpoint would have been redundant with the write path it
  was building.
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
- **BE-9** → the slot model carried by
  [ADR-0042](../_decisions/0042-a-result-entry-resolves-the-whole-bracket.md) (retired number 0041): a
  nullable fixture side with its provenance in an independent sibling field. It opened nothing and
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
- **FB-8** → [ADR-0044](../_decisions/0044-a-shoot-out-is-its-own-scoreline.md), the rule that a
  shoot-out is a scoreline of its own on the match, with its winner derived rather than stored, read by
  the bracket and by nothing else — so the league table counts the fixture as the draw it was and the
  two disagree about it deliberately. It completed the bracket: the first knockout round seeds itself
  from the standings, every later round is fed by the round before, and a level knockout no longer
  empties everything downstream of it. One finding that was not a decision left it for a permanent home
  instead: that a season's fixtures are created once and `/spiele` therefore has no POST and no DELETE
  was written down nowhere at all, and is now
  [ADR-0045](../_decisions/0045-a-seasons-fixtures-are-created-once.md) with invariant I26 beside it.
  **It opened four entries**, from the review that followed it rather than from the work itself — three
  places where the bracket knows something and tells nobody (**FB-11**, **FB-12**, **FB-13**) and one
  standing caution about the seeding walk's cap (**BE-14**).
  **It required a production backfill**, since `elfmeterschiessen` is required with no default and
  every `spiele` document needed the key set before the next deploy; ADR-0044 carries the runbook, and
  `python -m app.core.constraints --check` reported it clean on 2026-08-06.
- **FB-14** → two decisions and one new entry.
  The destructive-edit design (retired 0048, now carried by
  [ADR-0051](../_decisions/0051-a-voided-result-is-named-before-it-is-lost.md)) makes a resolution that
  voids a stored result say so — before the write and after it as a distinct outcome — because
  clearing a semi-final scoreline was reported only as a change of `Paarung`.
  The eligibility design (retired 0049, now carried by
  [ADR-0052](../_decisions/0052-a-team-is-fielded-once-per-spieltag.md)) is **FB-9's
  verdict**: implement as recorded, layered, and the audit found why the rule has to exist here at all
  — bracket platforms drop a disqualified entrant from the entry list, while ADR-0033 keeps the team
  in the season behind a flag. It opened **BE-15** (no admin write is recorded anywhere), rewrote
  **FE-10**, **FE-11**, **FE-12** and **FB-11** into instructions, and moved **FB-9** from a standing
  caution to a specified entry I have deferred. It unblocked nothing that was blocked: the four
  rewritten entries had soft dependencies on it, which is why they were workable throughout.
- **FE-10** → [ADR-0050](../_decisions/0050-a-form-that-outgrows-a-dialog-becomes-a-page.md), four
  decisions in one: a form that outgrows a dialog becomes a page rather than a wider dialog, a field is
  judged when it is left rather than between keystrokes, a form's sections sit in panels on a page and
  flat in a dialog, and a label or hint earns its place only by saying something the others do not. It
  built the destructive-edit design's static half — the warning before the write, since replaced by
  ADR-0051's dry run — and left the response half to the
  FB-5/FB-7/FE-2/FE-1 batch, which changes the patch response shape and regenerates the mirror. It
  opened nothing and unblocked nothing formally: FE-11, FE-12, FB-3 and FB-6 all named it as a soft
  ordering preference, and each of those `Path` lines now names the page as a fact instead.
- **FE-11** → [ADR-0053](../_decisions/0053-a-toast-is-built-in-tsx-not-patched-in-css.md): a toast's
  markup is this app's, supplied through `Toast.Provider`'s render function rather than patched into
  HeroUI's from a stylesheet, and its duration is derived from its text rather than chosen at the call
  site. I widened the entry mid-session from four recorded defects to a full redesign,
  and that is what decided the mechanism — CSS could recolour what the library renders but not move it.
  One recorded defect was deliberately not fixed, with a measurement as the reason: the stacked-toast
  height clamp truncates a queued message, and the visible band of the toast behind is 6.4 px, so
  nothing it cuts was ever on screen. It opened nothing and unblocked nothing formally; FE-12 rebuilds
  the surface these toasts report from and now has one shape to build against.
- **FB-12** → [ADR-0046](../_decisions/0046-the-write-path-refuses-wiring-the-season-cannot-hold.md),
  which reaches past the entry's own scope: an unwired knockout slot became the seventh
  action-required category on both ends, and with it the match write path refuses wiring the season
  cannot hold, the edit form became source-first with an automatic side read-only, and every source is
  picked from the season's legal options rather than typed. It opened nothing and unblocked nothing —
  FB-11's dependency on it was an ordering preference, answered by the ADR's where-is-a-fault-shown
  ruling.
- **FB-13** → [ADR-0047](../_decisions/0047-a-bracket-fault-is-derived-on-demand.md): a bracket fault
  is derived on read and stored nowhere, all five are reported through one tagged model, and they
  surface as an eighth action-required category. It widened past the entry's own scope on the way —
  the entry had two unreported faults and there were three, and the third (`same_team`, two different
  sources resolving to one club) is the only one of the five the write path cannot refuse, because
  ADR-0046's rules key a source by its identity. It opened nothing, and it narrowed FB-11 rather than
  unblocking it: the cheaper half of that item's value is delivered, and reviewing a whole draw is
  what remains.
- **FE-12** → [ADR-0056](../_decisions/0056-a-triage-list-is-ordered-by-what-blocks-play.md): a triage
  list is ordered by what each category blocks, declared once in `ACTION_REQUIRED_LABELS`, and its
  section lives in `?section=` rather than in component state — which is the App Router's preserved-tree
  hazard on a second surface. Two pieces of its own scope did not ship and the ADR says why: the card is
  `SpielCard` unaltered, so there is no per-item anchor to restore and the bracket faults keep the panel
  above the grid ADR-0047 gave them. It opened nothing and unblocked nothing.
- **FB-4** → [ADR-0042](../_decisions/0042-a-result-entry-resolves-the-whole-bracket.md), the rule that a
  bracket slot stores a structural reference to what feeds it, the German label is derived from that
  reference and stored nowhere, and a result entry resolves the whole of its season's bracket. Its part
  1 was concluded by my call rather than by research: the seeding is predefined and correct, the first
  knockout round is always group-seeded, and every later round is fed by two matches of the round
  before. It opened **FB-8** (a level knockout cannot record how it was decided), **FB-10** (seeding the
  first knockout round from the standings, which the `gruppe` variant exists for) and **OPS-9** (nothing
  lints or tests the repository's own hooks). It unblocked nothing — FE-4 never depended on the
  pairings, only on who qualifies.
- **FB-2** → [ADR-0059](../_decisions/0059-a-disqualification-is-a-record-and-its-absence-is-the-null.md),
  the rule that a disqualification is an embedded record on the `saison_teams` junction carrying the
  reason and the effective date, that its absence is the null, and that no boolean records the same
  fact anywhere. The reason is free text and public, because this league publishes no disciplinary
  code a closed set of offence categories could cite. It unblocked **FB-5** (the field shape it was
  waiting on) and **FE-3** (the note it renders), and it left a three-step production data change the
  ADR carries as a runbook. It opened nothing.
- **FB-11** → [ADR-0057](../_decisions/0057-a-draw-is-reviewed-as-a-table-of-provenance.md): a draw is
  reviewed as a table of provenance — `/admin/finalrunden`, one row per knockout fixture, each side
  stating its source over its occupant. The read view shipped alone, which the entry's own evaluation
  had already argued for; the editor half is deliberately unscheduled, because a whole-draw save needs
  a transaction over several fixtures that `PATCH /spiele/{spiel_id}` does not offer. It opened
  nothing and unblocked nothing — FB-3 and FB-6 never depended on it.
- **FB-5** → no ADR: ADR-0028 rule 4 had already settled that the state is joined rather than embedded,
  and ADR-0059 had settled its shape, so what was left was the build. It carried one decision worth
  naming, and the models carry it: `spiele` now has a stored shape and a served shape, because one
  class served the read and the admin payload both, and a joined field on it would have been persisted
  by the next edit. It closed no other item and opened none; it left **FB-3** an obligation, recorded
  in that entry — a junction write now changes what `GET /spiele` returns, so its action must
  invalidate `spiele` as well as `teams`.
- **FB-6** → three ADRs and one new entry.
  [ADR-0063](../_decisions/0063-a-matchday-list-is-the-seasons-skeleton.md) put the rollover control on
  the season's own editor rather than on a row action, and made the matchday list the season's skeleton.
  The entry's own premise turned out to be false and produced the other two:
  [ADR-0064](../_decisions/0064-a-matchdays-position-is-derived-not-stored.md) deleted `order_val`,
  because nothing in the bracket read it and the live season's matchdays did not share dates, and
  [ADR-0065](../_decisions/0065-a-seasons-schedule-is-derived-from-its-rules.md) followed it to
  `anzahl_spiele` — a single round robin per group fixes that number, so it was arithmetic rather than an
  intention. It opened **FB-16**: the rollover's steps all have pages now, and its sequence still has no
  prompt.
- **FE-9** → the copy section of `docs/frontend/overview.md`: the reader is the capitalised Du, the
  scope line separating user-facing strings from developer German, and the boundary between a field
  message's "Bitte" and a banner's refusal register.
- **BE-10** → [ADR-0070](../_decisions/0070-the-season-document-is-cached-in-process.md), the
  in-process season cache: dropped by its own write path, bounded by a ten-minute TTL, and the
  single-worker assumption named as the thing to re-check before adding `--workers`.
- **BE-13** → [ADR-0071](../_decisions/0071-a-path-identifies-a-query-validates.md): a path
  identifies (404), a query validates (422), `REQ-OID-001` stays as the net behind both, and the
  `objectid` convertor is load-bearing for routing and must not be dropped.
- **F1** → [ADR-0072](../_decisions/0072-a-status-filter-is-not-a-status-label.md): a filter
  selects and a label partitions, so the server's `ausstehend` includes today and the client's
  ternary keeps `heute` — FE-1 re-derives both under date ranges.
- **FE-5** → no ADR. The three questions the entry held were answered by building it: a filter runs in
  memory over the season already fetched, the selection goes in the URL beside the search text, and
  Spielhistorie does not stay — the route 308s to `/dashboard/spielsuche?status=vergangen`, because it
  was a server-side filter and a sort order over the same card list. It resolved half of **F1** on the
  way, in the direction that surface could act on: the Status facet reads `computeSpielStatus`, so what a
  card says and what the filter finds cannot disagree, which leaves F1 narrowed to the backend parameter.
  One behaviour was dropped rather than carried over, and the closing commit names it — the
  Spielhistorie's date-descending order, which the Spielsuche has no sort control for.
- **FB-3** → three ADRs and a runbook. [ADR-0050](../_decisions/0050-a-form-that-outgrows-a-dialog-becomes-a-page.md) had already settled
  the editor's shape, so the teams half proved it and the spieler half copied it. What was decided
  here is [ADR-0061](../_decisions/0061-position-and-stufe-are-closed-sets.md) (a player's `position`
  and `stufe` are closed sets, with the runbook that normalises the ten stray rows **before** the
  deploy) and [ADR-0062](../_decisions/0062-every-page-owned-editors-undo-is-a-route-handler.md),
  which moves the undo-as-route-handler boundary from a count to the
  pattern, so every page-owned editor may have one and nothing else may. The assistant recommended
  against that third handler and was overruled; ADR-0062 records the argument that lost.
  It discharged FB-5's obligation, made **BE-12** real for the first time — a squad row can now be
  retired — and left **FB-6** as the last of the admin-surface string.
