# ADR-0022 — The league table counts the Gruppenphase, and that is what an omitted scope means

**Status:** Accepted\
**Date:** 2026-08-02\
**Surface:** backend, frontend\
**Supersedes:** —\
**Superseded by:** —\
**Source:** Open item FB-1, my item of 2026-08-02: "the Saisontabelle currently tracks all
games, not only the ones from the Gruppenphase — this is wrong."

## Context

The Saisontabelle is a **group** standing: four tables, A to D, each ranking the teams of one group by
points and goal difference. Until this decision it was built from **every** match of the season,
playoff matches included.

That was live, not theoretical. Measured against the database on 2026-08-02: 24 Gruppenphase matches,
all played; 4 Viertelfinale, 2 played; 2 Halbfinale and 1 Finale, none played. The two quarter-final
results were in the group table, and five more would have joined them as the playoffs finished — so
the defect grows on its own, with nothing to announce it. Helmholtz showed 4 matches, 2-1-1, 27:14 and
7 points where its group row held 3 matches' worth of football.

Two facts about the surrounding code shape what was available.

**The statistics are derived, not stored** ([ADR-0019](0019-team-statistics-are-derived-from-spiele.md),
built the same day). `build_statistik_lookup_stage` recomputes the seven numbers from the `spiele`
documents on every read, so narrowing the table is one `$match` inside a `$lookup` — not a schema
change, a second stored object and a backfill, which is what FB-1's original XL rating assumed.

**The all-games figures still have to be visible somewhere.** They are the only place a reader can see
what a team actually did across the season, and the timeline on a team's own page already lists every
phase — a Gruppenphase-only header above cards that include a Viertelfinale contradicts itself. So
this is not "narrow the table" but "there are two tables, and something has to say which one is
wanted."

## Decision

**There are exactly two statistics scopes, and `GET /teams` takes them as a parameter with the group
table as the default.**

- `FLTeamsFilterParams` gains `statistik_scope: Literal["gruppenphase", "gesamt"]`, defaulting to
  **`"gruppenphase"`**. `"gruppenphase"` is spelled exactly as the stored `FLSpiel.saison_phase` value
  it filters on; `"gesamt"` counts every phase.
- The scope changes the `$match` inside the statistics `$lookup` and **nothing else** — same
  projection, same fallback, same sort, same stage count. One pipeline serves both tables.
- Under `"gesamt"` the `saison_phase` key is **absent** from the `$match`, not negated or enumerated.
  There is no stored value meaning "any", and an `$in` over all four phases would have to be widened by
  hand the day a fifth exists.
- `/dashboard/saisontabelle` asks for `"gruppenphase"` explicitly even though it is the default, and
  `/dashboard/teams/[team_id]` asks for `"gesamt"`. Both pages carry one line of German saying which
  they show, because the two now disagree by design.

**The default is the decision.** Both scopes return the same seven fields, so a caller that forgets the
parameter gets a table that looks entirely plausible either way. The plausible-but-wrong one is the
table that counts playoff results as league results, so that is the one that must be asked for.

## Consequences

**What it costs.**

- **An omitted parameter now means the narrower answer**, which is the less obvious reading of an API
  default. It is the same trade [ADR-0002](0002-omitted-season-means-current.md) already made for
  `saison_id` — omission means the specific thing, not everything — so the surprise is at least
  consistent within this API.
- **Two cache entries per season instead of one.** `statistik_scope` is part of `getTeams`' cache key,
  so the group table and the season figures are cached separately. The `teams` tag clears both, which
  is what a result edit needs: a Gruppenphase result moves both tables and a playoff result moves only
  one, and the coarse tag is right in each case.
- **The same team now shows two different numbers on two pages**, and that is a genuine cost, not a
  presentational detail. It is mitigated by a line of copy on each page and by nothing else; a reader
  who ignores both will read it as a bug.
- **The pipeline encodes a product rule two test files share.** `test_teams_pipeline.py` asserts that
  the `$match` carries the phase and that the two scopes differ in nothing else; since
  [ADR-0023](0023-a-real-mongod-behind-a-deselected-marker.md),
  `test_teams_pipeline_execution.py` runs it against a real `mongod` and reproduces this decision's
  own measurement from a fixture — Helmholtz at 3 matches and 4 points under `"gruppenphase"`, 4 and
  7 under `"gesamt"` — so the hand check against the live database is not the only evidence.

**What it enables.**

- The Saisontabelle is a group table again, and stays one as the remaining five playoff results land.
- **FE-3 gets its data for free.** The rework of `TeamDetailsView` inherits a page already fetching the
  all-games figures; it is a visual item, with no data question left in it.
- `FLSaisonPhase` becomes a dimension the table can be read along at all, which is the machinery any
  future per-phase view would need.

**A constraint this creates.** A new surface that renders `statistik` gets the **group** table unless
it says otherwise. That is deliberate, and it means a page wanting season-wide figures must be written
knowing this ADR exists — the wrong answer will not fail, it will merely be wrong. Cite this ADR at the
call site, as `/dashboard/teams/[team_id]` does.

## Alternatives considered

**Default to `"gesamt"` and let the Saisontabelle narrow.** The less surprising API: omitting a filter
returns everything, which is what a filter usually means. Rejected because it puts the burden in the
wrong place. Every future table-shaped surface — a widget on the landing page, a group panel in an
admin view — would silently reproduce exactly the defect this ADR closes, and the failure is invisible:
the numbers render, the sort works, and only somebody who counts a team's matches by hand notices. A
default is a bet on what a forgetful caller should get, and the group table is the safer bet.

**A general `saison_phase` filter on `/teams`,** mirroring the one `GET /spiele` already has, including
its `"playoffs"` alias. More expressive at no extra implementation cost, and it would reuse a literal
that already exists on both sides of the boundary. Rejected because expressiveness is the problem: a
standing computed over the Halbfinale alone is two matches ranked by points, which is not a table
anybody wants and which the API would be advertising. The closed set of two says what the product
actually has — a group table and a season total — and a third value would be a deliberate addition
rather than a combination falling out of the design.

**Two endpoints, or a second response `format`.** Rejected as duplicating a shape that is identical in
all seven fields. The `format` discriminator exists to distinguish _shapes_ (list, compact, grouped);
scope is not a shape, and adding it there would make the discriminator mean two unrelated things.

**Compute both scopes in one response** — `statistik` and `statistik_gesamt` side by side — so no
caller has to choose. Rejected because it doubles the lookup on every read for the benefit of exactly
one page, and puts a field on `FLTeam`, `FLTeamCompact` and both Zod mirrors that four of the six call
sites would never read. It also reintroduces, at the response level, the two-objects-to-keep-in-step
shape ADR-0019 removed from the database.
