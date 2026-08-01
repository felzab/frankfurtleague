# Open items

**Verified against:** `8d3111d`, 2026-08-01

Findings and undecided questions with real analysis and no decision yet. Migrated here from the
documentation programme's ledger when that file was retired (2026-08-01); each entry keeps its full
reasoning so the eventual decision is taken with the analysis in hand. The backend audit prompts
(`docs/_auditing/prompts/backend-*.md`) seed several of these as their starting checks.

---

## F4 — Team statistics are written to one document and read from another ⚠️

**Found 2026-08-01 while documenting the backend. Highest-severity open finding. Not acted on.**

The admin result edit updates team statistics on the **`teams`** collection. The teams endpoint
serves statistics from the **`saison_teams`** junction collection. They are different documents,
and nothing copies between them.

Evidence, all directly checkable:

| #   | Fact                                                                                                                                                                                   | Location                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1   | `TeamsCollection` resolves to `db.teams`                                                                                                                                               | `fl_backend/app/core/db.py:70-73`             |
| 2   | `update_team_statistik` writes `{"$inc": {"statistik.<field>": …}}` to `teams_collection`, filtered by `_id` **only** — no season                                                      | `fl_backend/app/api/admin/services.py:49-105` |
| 3   | `build_team_pipeline` projects `"statistik": "$saison_data.statistik"`, i.e. from the `saison_teams` lookup                                                                            | `fl_backend/app/api/teams/services.py:73`     |
| 4   | With a `saison_id` always resolved, `strict_join` is true, so `$unwind` sets `preserveNullAndEmptyArrays: False` — the junction row must exist and its `statistik` is what is returned | `fl_backend/app/api/teams/services.py:58-66`  |
| 5   | **No code anywhere in `fl_backend` writes to `saison_teams`.** The name appears only as the lookup constant                                                                            | `grep saison_teams` across `fl_backend/app`   |

**Implication if the reading is right:** entering or correcting a result does not change the league
table. The write lands on a field the read never projects.

**History supports the reading.** `saison_teams` was introduced by commit `0b832d5` ("Added
season-specific and season-agnostic data separation"), which moved season-scoped data onto the
junction. The read path was updated; the statistics write path still targets the base collection.

**A secondary consequence:** the stated rationale for the `teams:saison_id:*` cache tag — that a
result edit rewrites team stats _within that season only_ — does not match the code. The write is
not season-scoped at all; its filter is `{"_id": team_id}`. The tag may still be right, but the
recorded reason for it is not.

**Confidence and limits.** This is a static reading of the code at `52b6ef5`, **not verified
against a running system or real data**. Ways it could be wrong: `saison_teams` documents might be
regenerated from `teams` by something outside this repository, or the deployed data might carry
`statistik` in both places. Either would change the conclusion.

**Cheapest check**, one query in Compass: edit a result through the admin UI, then compare
`teams.statistik` with the matching `saison_teams.statistik` for that team and season. If only the
former moved, the finding is confirmed.

**Owner:** the backend audit — pass B1 (`_auditing/prompts/backend-1-consistency.md`) re-verifies
this first, as its motivating check. Referenced from `docs/backend/spec.md` (invariant I1, §7) and
`docs/glossary.md`.

## F1 — Two definitions of `ausstehend`

`build_spiele_filter` (`fl_backend/app/api/spiele/services.py:30-31`) filters
`spiel_status="ausstehend"` as `datum >= today`, **including today**. `computeSpielStatus`
(`fl_frontend/src/features/spiele/utils.ts:16-17`) derives `ausstehend` as `datum > today`,
**excluding today** — a match today is `heute`.

Consequence: a match today is returned by the "upcoming" query and then labelled `heute` by its own
card. On the landing page's _Nächste Begegnungen_ that is very likely the desired behaviour.

**Verify the intent before changing either side.** Tightening the server bound to `>` would
silently drop today's matches off the landing page. Not filed as a bug. Related: the client takes
cancellation first (`isCanceled` wins over any date), while the server treats `is_canceled` and
`datum` as independent filters. Seeded into backend audit pass B2's semantic-contracts check.

## F2 — Pydantic and Zod models are hand-mirrored

`fl_backend/app/api/spiele/schemas.py` and `fl_frontend/src/features/spiele/schemas.ts` (and their
siblings) are maintained as mirrors with no generation step. This is the main drift risk across the
boundary and the first thing to check when behaviour looks impossible. **Accepted, not a defect** —
recorded so it is stated plainly. The drift _between_ the mirrors is what backend audit pass B2's
contract table measures.

## F7 — The landing page's season badge is hardcoded

`fl_frontend/src/app/(public)/page.tsx` renders "Saison 2026" as a literal. It is not derived from
the current season, so at the rollover the badge will still name the old year while the fixtures
below it — which _are_ season-aware — already show the new one.

Low severity and cosmetic, but it fails silently and on a date nobody will be watching. Documented
at the line; wiring it to `getCurrentSaison()` would give this page a data fetch it does not
currently have — a real trade-off rather than an obvious fix.

## BE-4 — no write path for `saisons`, `spieler`, `spieltage`

**State: open.** No FastAPI write endpoints exist for these three resources. They are edited
**directly in MongoDB** — Compass, or an ad-hoc script. The application can only read them.

Two consequences follow. The frontend caches them for a day with no way to know they changed, which
is why [ADR-0015](../_decisions/0015-backend-triggered-revalidation-route.md) exists and why
`scripts/revalidate_reference_data.sh` has to be run by hand after such an edit. And nothing
validates the edit: the Pydantic models constrain what is _read_, so a bad value written directly
is discovered when a page fails to parse it, not when it is saved.

**What building it would resolve:** the manual revalidation step disappears entirely — a real write
path revalidates itself like every other mutation, and ADR-0015 becomes superseded rather than
merely retired. It would also put the season's `rules.win_points` / `draw_points` under validation,
which matters if the statistics calculation is ever wired to read them instead of hardcoding 3/1/0.

**Cost:** three CRUD surfaces plus admin UI for data that changes a few times a year.

## OPS-1 — migrate the container images from Docker Hub to GitHub Container Registry

**State: open, owner-raised 2026-08-01** alongside taking the repository public.

**Today:** `publish.sh` pushes both images to **Docker Hub** on the free plan — one private
repository, with tag prefixes separating the two services — and the registry is the **rollback
mechanism**: `deploy.sh` rolls back by pulling pinned `-sha-` tags, which is why Docker Hub
retention is deliberately manual (a botched registry delete destroys rollback). The images' OCI
`source` label already points at the GitHub repo.

**Why ghcr.io fits now:** one account and one auth story next to the now-public code, free for
public images, per-service repositories (`frankfurtleague-frontend` / `-backend`) instead of
tag-multiplexing one repo, and packages linked to the repository page.

**What the migration touches:** `scripts/publish.sh` (registry host, image names, login),
`scripts/deploy.sh` and both compose files (pull URLs; the server needs a `read:packages` token),
`scripts/README.md` and `docs/ops/` (registry claims), and — the part not to lose — **rollback
continuity**: the historical `-sha-` tags live on Docker Hub, so either re-push the last ~5 per
service to ghcr before switching, or accept that rollback history restarts at the migration.
A history rewrite of the git repo also means pre-rewrite OCI `revision` labels no longer match any
commit — re-pushing old tags does not fix that; only new publishes carry valid labels.

**The quota is the deciding constraint, and it points at public images.** GitHub Packages is free
and unlimited for **public** packages, but a free personal account gets **500 MB of storage and
1 GB/month transfer for private ones — shared with GitHub Actions artifacts** — and publishing is
blocked once that is used up with no payment method on file. The two images measure ~370 MB and
~379 MB uncompressed (roughly half that as compressed layers, deduplicated across `-sha-` tags), so
private images plus a few rollback tags sit at or past the limit. Docker Hub's free plan is the more
generous option for _private_ images, which is the whole reason `publish.sh` multiplexes both
services into one private repo. **So migrating on the free tier effectively means making the images
public** — defensible once the source is public, since no secret is baked into a layer and `.env`
files are excluded from the build context, but it is a decision to take deliberately.
Source: [GitHub Packages billing](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-packages/about-billing-for-github-packages).

**Concentration risk: assessed and accepted (owner, 2026-08-01).** After the migration a GitHub
outage would block code, CI and image pulls at once, where today Hub and GitHub fail independently.
The owner's position is that this project tolerates it — deploys are manual, unhurried, and nothing
depends on shipping during an outage. Two things soften it further: the server's previously deployed
images normally remain in its local Docker storage, so an emergency rollback can run from the local
tag without reaching any registry, and keeping the last few Docker Hub `-sha-` tags until a ghcr
rollback has been exercised once costs nothing.

**Decision points remaining:** public or private images (see the quota above), and per-service repos
versus keeping the tag-multiplexed layout.

## BE-10 — the backend manifest declares 47 dependencies and imports 7

**Found 2026-08-01**, when Dependabot's first `uv` run failed. Not in any report.

`fl_backend/pyproject.toml` lists 47 runtime dependencies. Measured against every `import` in `app/`
and `tests/`, exactly **seven** are imported: `fastapi`, `motor`, `pydantic`, `pydantic-core`,
`pydantic-settings`, `pymongo`, `starlette`. A further handful are legitimate runtime-only
dependencies that are installed but never imported — `uvicorn` (the server), `email-validator`
(required by pydantic's `EmailStr`), `python-dotenv` (read by pydantic-settings), `tzdata`, and
uvicorn's `httptools`/`websockets`/`watchfiles` extras.

Everything else — `anyio`, `certifi`, `click`, `colorama`, `h11`, `httpcore`, `idna`, `jinja2`,
`markdown-it-py`, `markupsafe`, `mdurl`, `pygments`, `rich`, `rich-toolkit`, `shellingham`,
`sniffio`, `typer`, `typing-extensions`, `typing-inspection`, `urllib3`, `annotated-types`,
`dnspython`, `pyyaml`, and the odder `style` / `detect-installer` / `fastar` / `annotated-doc` /
`rignore` — is transitive. This is the signature of a manifest derived from `pip freeze` rather
than written.

**Why it is not cosmetic.** A manifest is meant to state what the project needs; the lockfile
records what that resolves to. Declaring transitives inverts that: every upstream change can
produce a conflict that has to be hand-resolved, the file no longer answers "what does this project
actually depend on", and dependency tooling generates churn over packages nobody chose. The
Dependabot failure is the first concrete cost — see the `ignore` entry now carrying the
explanation in `.github/dependabot.yml`.

**The fix is not mechanical**, which is why it is filed rather than done: pruning to the ~12 real
dependencies means re-locking and proving nothing broke — the 238 tests plus a backend image build,
since some of those packages are needed at runtime without ever being imported. Backend audit pass
B4 owns it (`_auditing/prompts/backend-4-architecture.md`, check 7, "tooling config vs reality").

## BE-6 — `CustomObjectId` validates nothing in JSON mode

Its `json_or_python_schema` passes a bare `str_schema()` for the JSON branch, so
`model_validate_json` accepts **any string** as an ObjectId while `model_validate` rejects it.
Unreachable through FastAPI today, which validates already-parsed dicts — which is precisely why
the existing tests certify a guarantee that holds in only one of the two modes. If anything ever
routes through `model_validate_json`, an arbitrary string reaches a Mongo `_id` filter. Found by
Wave 4's final review (2026-07-30). Seeded into backend audit pass B2's validation-mode check.

## BE-7 — `typing` imports instead of `collections.abc`

Several backend modules import `Mapping`/`Sequence`/`Optional`/`Callable` from `typing` — aliases
deprecated since Python 3.9, on a project running far newer. **Deliberately not fixed piecemeal:**
modernising one module while the rest keep the old spelling is worse than uniformity. The recorded
decision is to enable ruff's `UP` rules and migrate in one pass — which backend audit pass B4's
typing check owns.

## BE-9 — the "TBD" placeholder team

**State: open. The more interesting of the two backend items, and the one with a clear right
answer.**

An unresolved playoff opponent is currently a **real team document** named "TBD", with
`is_placeholder: true` — plus a `saison_teams` junction row for every season it appears in.

It works. It is also a lie in the data model, and it costs in three places:

1. **A junction row nobody is prompted to create.** Because team data is season-scoped
   (`saison_teams`), the placeholder needs its own row per season. Nothing prompts for it, and its
   absence makes the placeholder vanish from team queries for that season — the strict join drops
   it.
2. **A two-character shorthand for a non-team**, `TBD_TEAM_SHORTHAND = "??"`, which exists only to
   satisfy `FLSpielTeamFieldSchema.shorthand`'s `length(2)`.
3. **Special-casing in the edit form.** `FormMatchupSection` must exempt the placeholder from the
   "a team cannot play itself" rule, and `FormTeamPicker` carries a whole free-text-name mechanism
   so each bracket slot can read "Sieger HF1" rather than every slot reading "TBD".

**The textbook fix:** nullable opponent references on `FLSpiel`, and delete the placeholder team.
"Opponent not yet known" is then modelled directly instead of impersonated.

**Why it has not been done:** it is a schema change across the backend model, the frontend Zod
mirror, and the bracket rendering — every consumer of `team1`/`team2` has to handle null. That is a
real scope, not an afternoon.

**The natural moment is when BE-4's season write path is built**, because that is when season setup
becomes a real flow and the placeholder's junction rows would otherwise need to be created there
too — or the first time a season is created and the missing TBD row breaks a bracket.
