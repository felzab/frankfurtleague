---
paths:
  - "fl_backend/**/*"
  - "fl_frontend/src/**/*"
  - "fl_frontend/*.ts"
  - "fl_frontend/*.mjs"
  - "nginx/**/*"
  - "scripts/**/*"
---

# Ratified decisions — the seams between surfaces

`.claude/CLAUDE.md` §7's never-clauses, on §7's terms. Each names a contract two surfaces hold
together, so a session on either side can break it and the paths above reach both whole.

- **db** — Add a second direct `MongoClient`
- **openapi** — Generate the Zod mirror; compare past presence, required, nullable, type or enum
- **system** — Remove `checkIsReady`, `getSystemInfo`, or the system key
- **cache** — Re-add a reference-data invalidation endpoint; fault sub-24h staleness
- **csp** — Disable `react/no-danger`; add a second CSP
- **logging** — Let nginx pass a client's correlation id; log outside the envelope
- **bracket** — Store the bracket's German label; flag an override beside `quelle`
- **table** — Move the league table's default scope off `gruppenphase`
- **saisons** — Offer in the form wiring the write path refuses
- **spiele** — Treat `mietpreis` / `payment` as stale copies of the defaults; denormalise season-scoped state into `spiele`
- **spiele** — Put the shoot-out in `ergebnis`; store its winner; let the table read it
- **spiele** — Refuse a `sonderereignis` that would overwrite a stored result; keep it out of the dry run's report
- **spiele** — Add a POST or a DELETE to `/spiele`
- **saisons** — Make `inactive_since` a boolean; revive a retired row by creating it
- **saisons** — Add an austritt boolean beside the record
- **saisons** — Write `status` outside the activate endpoint; DELETE a season row; drop the rollover guard
- **spieltage** — Refuse a manual pick as unqualified; field a team twice in a Spieltag
- **spieltage** — Derive a `Spieltag`'s position rather than reading it; write one outside the draw; store or serve its German label
- **spieltage** — Add a reorder endpoint for `spieltage`; move the rollover off its page; re-sort its list
- **spieler** — Widen a squad row's `position` or `stufe` past their `Literal`s; drop `E2`
- **swap** — Split the group swap into two writes; relax the move lock to serve it
- **swap** — Reach the swap's disqualification refusal backwards; refuse a club standing on its own fixture

**Why this file reaches both packages whole rather than the slices its keys name.** Each key was
tested by searching for the clause's own identifier and German term, and each one is spread far past
its key: `quelle` is written in `fl_backend/app/api/spiele/`, `app/api/saisons/spielplan.py` and
`app/core/domain.py`; the draw that writes a Spieltag and assigns its position is
`app/api/saisons/spielplan.py`; `stufe` and `E2` reach `app/api/saisons/`, `app/api/teams/` and
`app/core/constraints.py` and, on the frontend, `src/app/admin/spieler/`, `features/bewerbungen/`
and `features/saisons/`; `sonderereignis` reaches eight backend packages and four frontend slices;
`mietpreis` reaches `schiedsrichter` and `spielorte` on both sides; the swap's form is under
`features/saisons/` because the frontend clause holds the club editor away from being its home; and
the league table's default scope is spelled a second time, deliberately, in
`src/app/dashboard/saisontabelle/page.tsx`. A per-slice reach for any of them named a directory the
clause's code does not live in, and a glob matching nothing puts a ratified decision in front of
nobody.

## Traps

`.claude/CLAUDE.md` §6's, on §6's terms: it fails silently.

- A backend refusal and its German are two sites. `fl_backend/app/core/domain.py` declares the rule
  and its code; the feature slice's `actions.ts` turns the code into words. A code no slice maps
  falls through to the 409 fallback in `fl_frontend/src/shared/utils/actionError.ts`, which tells the
  admin an equivalent entry already exists. A test reading
  `fl_frontend/src/core/refusalRegister.ts :: declaredCodes` holds most slices to this; `spiele` and
  `spielorte` have none, so there the wrong message ships green.
