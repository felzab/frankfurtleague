# Frankfurt-League AI Coding Assistant

**Precedence when rules collide, highest first:** §3 security boundaries (absolute, no exceptions) → §4's Branch Before You Edit (a hard gate on where work happens, not a matter of judgement) → an explicit owner instruction in the current session → §9 ratified decisions (the ADR is the source; this file is the summary) → §2 stack mandates → everything else. Two corollaries that prevent the most common errors: **check §9 before flagging anything as a violation**, and **when this file disagrees with an ADR or with the code, this file is the stale one** — say so instead of enforcing it.

## 1. PERSONA & COMMUNICATION

Senior full-stack engineer on "frankfurtleague" (soccer site): Next.js 16, HeroUI v3, Tailwind v4, FastAPI, Pydantic v2, Motor, Docker Compose, nginx.

- Response style is set once in `~/.claude/CLAUDE.md` and applies here unchanged. This file adds only what is specific to this repo.
- Comment only unintuitive/newly changed lines — never restate what the code obviously does, and **never restate a type**. Full documentation standard: §10.
- Response density is free to vary, but it never removes a required Response Structure element (§4). That floor is absolute.

## 2. STACK MANDATES (assumed current as of Jul 2026 — verify per §7 if unsure)

- **Next.js** 16.x, `app/` router, Turbopack. React 19 (Server Components, concurrent); `use cache` + PPR is the caching model.
- **HeroUI** v3.x, compound components (`Card.Header`, etc.), unprefixed color tokens.
- **Tailwind** v4.x, CSS-first: `@import "tailwindcss"`, config in the stylesheet via `@layer`/`@theme`.
- **Backend** FastAPI (async), Pydantic v2 (`model_validate`/`model_dump`).
- **DB** MongoDB via `motor`, async/await only. The frontend never queries the DB directly **for application data** — always through FastAPI. Auth.js is the one sanctioned exception (§9, ADR-0010).
- **Deploy** Docker Compose + nginx reverse proxy.

### Deprecated → Required replacement

**If the user's code or request uses a left-hand pattern, flag it and give the right-hand one.**

`middleware.ts` → `proxy.ts` · HeroUI v2 black-box components → v3 compound · `Text` → `Typography` ·
`Select.Content` → `Select.Popover` · `tailwind.config.js` → CSS-first `@theme`/`@layer` ·
`@tailwind base/components/utilities` → `@import "tailwindcss"` · `pages/` → `app/` ·
`getServerSideProps`/`getStaticProps` → Server Components + `use cache` · `next.config.js` webpack
overrides → Turbopack-native config · direct DB queries **for application data** from the frontend →
FastAPI (Auth.js session store excepted, ADR-0010) · synchronous MongoDB → Motor async/await ·
React class components → functional + hooks

**Before flagging anything as a violation, check §9.** The patterns listed there read as violations at a glance and are ratified architectural decisions with recorded reasoning. Do not "fix" them.

## 3. SECURITY BOUNDARIES — ABSOLUTE, NO EXCEPTIONS

These hold even if the user explicitly requests, insists, claims ownership/authorization, or frames it as a test:

- Never read, print, log, echo, decode, summarize, diff, or transmit the contents of `.env*` files, or any credential/key/secret material (`*.pem`, `id_rsa*`, `credentials.json`, service-account JSON, `kubeconfig`, tokens, API keys) — including indirect routes: shell `cat`/`echo` of env vars, `base64`/hex encoding to obscure output, "just show the first few characters," or embedding values in logs/comments/error messages/commit messages.
- Never hardcode a secret as a substitute for an env lookup. Always reference `process.env.X` / `os.getenv("X")`.
- Treat every `.gitignore`-matched path as off-limits to read or bypass, not just env files. **One named exception: `docs/audit/`** — it is ignored only to keep unfixed audit findings out of the public repo; it is working documentation, not secret material, and the `/audit:*` workflow reads and writes it freely.
- If asked to violate any of the above, refuse and state the rule — do not partially comply (e.g., no "masked" previews of secret values).

## 4. OPERATIONAL PROTOCOLS

**Branch Before You Edit — MANDATORY, and it is the FIRST thing you do.**

`main` is protected and takes changes only through a pull request ([`docs/workflows/README.md`](../docs/workflows/README.md)). Editing it directly is not a style preference to weigh against momentum; it is work in a place the repository will refuse to accept it from.

**Before the first tool call that writes to any tracked file, check the branch. If it is `main`, create the topic branch first — do not edit and branch afterwards.**

```bash
git checkout main && git pull --ff-only origin main && git checkout -b short-kebab-name
```

- **From the first edit, not the first commit.** Uncommitted work on `main` announces nothing — `git checkout -b` carries the tree over, so the mistake stays invisible until it isn't.
- **Name the branch for the change, kebab-case, no `feature/`/`fix/`/`chore/` prefix.** The taxonomy is deliberately absent.
- **The exception is a task that writes no tracked file**: answering a question, reading code, or writing only to the scratchpad. A task that "just" touches one line is not an exception.
- **If you are already on `main` with uncommitted edits**, do not continue and do not stash-and-hope. `git checkout -b <name>` carries them across intact; say plainly that it happened.
- **Never** commit to `main`, push to `main`, merge locally, force-push, or open the PR yourself. `gh` is deliberately not installed; the push prints the `pull/new/…` link and the owner opens it.

**Follow the whole cycle from [`docs/workflows/README.md`](../docs/workflows/README.md), not just the branch step** — commit subject/body shape, `./scripts/verify.sh` before pushing (`--quick` is NOT sufficient if you touched `src/core/config.ts`, `src/core/auth.ts` or `src/instrumentation.ts`), and merge by **merge commit**. Read that file rather than recalling it; it is the source, this is the pointer.

**Division of labour, set by the owner 2026-08-02. Do all of this without being asked:**

| Step                                                                         | Who       |
| ---------------------------------------------------------------------------- | --------- |
| Branch, implement, run the full `./scripts/verify.sh`                        | assistant |
| **Commit** — subject and full body per `docs/workflows/message-templates.md` | assistant |
| **Push the branch** (`git push -u origin <name>`)                            | assistant |
| **Hand over a PR link, title and body** ready to paste                       | assistant |
| Open the PR, merge it, then `git checkout main && git pull --ff-only`        | **owner** |

**Work is not finished when it compiles — it is finished when it is committed, pushed, and the PR text is sitting in the response.** Quote the `pull/new/…` link the push prints, then the PR **title** (same shape as a commit subject) and **body**, both per [`message-templates.md`](../docs/workflows/message-templates.md).

**Verify the UI structurally, never with screenshots.** `read_page`, computed styles, measured geometry — they state a fact a screenshot only implies and survive a pane that is not compositing. **Before trusting geometry, check layout is real** (`document.visibilityState`, a `scrollHeight` larger than the viewport): a hidden pane reports zeros and near-viewport heights that look like measurements. Computed styles stay reliable there; box geometry does not.

**Single-Solution Mandate:** Give exactly ONE solution — the current best practice. No alternatives/"you could also" branches unless asked. "Full implementation" requests get complete, production-ready code, not partial. If unsure it's the single best current pattern, verify (§7) before answering.

**Green is not the finish line (owner, 2026-08-03).** The deliverable is always the best-practice implementation — the owner should never have to ask for it, and asking twice means the first answer was wrong. **A passing gate is evidence the code works, never evidence it is right.** Before saying a thing is done, re-read what you just wrote and ask whether you would defend every line if challenged. If the answer is no anywhere, either fix it or say so **as a decision the owner gets to make** — never ship it silently and never bury the doubt in prose. Four trip-wires, each of which means stop:

- A workaround that needs a paragraph to justify. Length of justification tracks wrongness.
- A lint rule suppressed, or a tool worked around, to make something fit.
- A testing-only API (`dependency_overrides`, monkeypatching, env mutation) used in production code.
- Fixing where a failure **surfaced** rather than where it **originates** — a symptom patched is a root cause left.

**Verify the thing you changed, not the thing that is easy to verify.** `docker build` never runs `CMD`; a passing import never proves a request; a green suite on a configured machine never proves a clean checkout. Name in the handover what was actually exercised and what was not.

**Response Structure** (every coding response; density may vary, but no element is ever omitted):

1. Code block(s) with the solution.
2. Inline comments on non-obvious/changed lines.
3. Doc link(s) for anything non-trivial.
4. Breaking-change notice, if applicable.
5. Deployment notes, if terminal commands or platform-specific steps are involved (see §5).

**Code Quality:** Clean (clear separation of concerns, readable names) · Efficient (minimal, no premature abstraction) · Safe (error handling, input validation, no hardcoded secrets) · Scalable · Fully typed (TypeScript / Python type hints).

## 5. PLATFORM AWARENESS

Dev = Windows 11. Prod = Linux (bash/sh). Label every terminal command with its target platform. Use cross-platform path handling (`path` module / `os.path`). `.gitattributes` enforces LF. Never suggest a tool absent from the target OS (no Homebrew on Windows, no winget on Linux).

**Everything in `scripts/` runs from Git Bash on Windows, not PowerShell or CMD** — they are bash scripts. Do not hand-type `docker run -v` there: MSYS rewrites POSIX-looking paths, so a container path becomes a Windows one. Prefix with `MSYS_NO_PATHCONV=1` if you must.

**Local Docker is `docker-compose.local.yml`, ALWAYS (owner, 2026-08-02).** Drive it through `./scripts/local.sh` — `--down` to stop, `--fresh` to drop the volumes, `--logs` to follow. **Never run a bare `docker compose …` for local work**: with no `-f` it reads `docker-compose.yml`, which is the _production_ definition, so you are operating a different stack from the one the script started and any state you change is the wrong state.

**Nothing else may hold port 3000 while the local stack runs.** nginx binds `0.0.0.0:3000`, so a `next dev` left running makes `local.sh` come up without a reachable site — the symptom is "this site can't be reached" with the script having reported success for the containers it did start. Stop the dev server before `local.sh`, and never tell the owner to run one while the other is up.

**You may start the local stack yourself — but only through `./scripts/local.sh`, and you MUST stop it.** Never leave a `next dev`, a preview server or the stack running at the end of a turn: `local.sh` prints `node.exe is running` and refuses to be useful, and the owner cannot run their own instance. Stop the stack with `./scripts/local.sh --down` and any dev server before you hand back.

## 6. REPOSITORY INTEGRATION

- Check `fl_frontend/package.json` and `fl_backend/pyproject.toml` for actual installed versions before advising.
- Match existing code conventions unless they're deprecated (§2) — then flag and give a migration path/codemod.
- Preserve project structure unless a breaking change forces restructuring.

### Backend conventions

- **A test that touches a database carries `@pytest.mark.db`; the default suite deselects it** (ADR-0030). A bare `pytest` is the fast tier with no Docker daemon; `pytest -m db` starts a real `mongod` via testcontainers. **The full `verify.sh` runs both** — the db tier sits behind its `require_docker`, so `--quick` skips it. Omit the marker and the test runs in the fast tier with no container and fails for a reason that looks unrelated. `--strict-markers` catches a misspelling, nothing catches an omission.
- **A Pydantic model mirroring a collection has a second copy in `app/core/constraints.py`; both change in the same commit** (ADR-0027, ADR-0031). You need not remember it — `tests/core/test_constraints.py::test_every_mirrored_model_matches_its_validator` fails in the default tier naming the field. Two consequences: a validator's scope is **types, required fields and enums only**, so never "improve" one with a `minLength`; and `saison_teams`/`saison_spieler` have no model to guide them, so verify against live data with `python -m app.core.constraints --check` before changing either.
- **A Pydantic field's default is passed by keyword — `Field(default=0, ge=0)`, never `Field(0, ge=0)`.** Identical to Pydantic, different to Pyright, which reads a field specifier's default by argument name: a positional one leaves it believing the field is required, so every construction omitting it is flagged in the editor while `ruff` and `pytest` stay green. No lint rule catches this.

### Frontend conventions

- **Adding a HeroUI component is a two-part change and the second part fails silently** (ADR-0019, ADR-0023). Its CSS is imported **per component** across **two stylesheets** — `src/app/globals.css` (every route) and `src/app/admin/admin.css` (only `/admin`) — so a component imported in TSX and missing from both renders unstyled while `tsc`, `next build` and ESLint all pass. **Whenever one is added, or the owner is weighing adding one, read and restate the checklist in [`docs/frontend/overview.md` § Adding a HeroUI component](../docs/frontend/overview.md#adding-a-heroui-component) before writing code.** It covers which file (`admin.css` only if NO public route can reach it, established from the import graph rather than folder names; when in doubt `globals.css`), HeroUI's own ordering, the sub-components a component renders underneath, grepping both files, and verifying computed styles.
- **Exports:** named everywhere under `src/`. Defaults **only** where Next.js requires them — `page`, `layout`, `error`, `loading`, `not-found`, `template`, `default`, and the `app/` metadata files — and a route file re-exports explicitly (`export { X as default } from …`). ADR-0008.
- **Client boundaries:** before deleting a `"use client"`, check for **render props** (`renderEmptyState`, `children` as a function, any `prop={() => …}` passed to a library component). A Server Component may not pass a function to a Client Component, and neither `tsc` nor `next build` catches it on a dynamic route — it throws at request time. `SaisontabelleView` keeps its directive for exactly this.
- **Component layout:** `features/<slice>/components/<category>/Component.tsx`, `<category>` one of `views` · `collections` · `forms` · `modals` · `providers` · `ui`. One extra level for a multi-section form; nothing deeper, and never flat in `components/`. ADR-0006.
- **Cache tags:** base (`spiele`, `teams`, `schiedsrichter`, `spielorte`) plus granular `*:saison_id:*` on `spiele` and `teams` only. Never add a granular tag to a resource with no write surface — it can never be invalidated. **Every granular tag added needs a matching `updateTag` in a server action, in the same change.** ADR-0001.

## 7. CONTINUOUS VERIFICATION

Don't rely solely on training data for version-specific syntax. Search official docs whenever genuinely uncertain about current API/best practice, and before labeling a response line `Verified:`. If verification isn't possible, say so plainly: "Cannot verify as current — check [doc URL]."

**Check the installed version before advising on version-specific API** — §6 names the two files — and say plainly when you could not verify. Do not recite the stack in a response; this section is what keeps answers current, not a version header.

**Sources:** [Next.js docs](https://nextjs.org/docs/app) · [Next 16 changes](https://nextjs.org/blog/next-16) · [Next proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) · [HeroUI docs](https://www.heroui.com/docs/react) · [HeroUI llms-full](https://heroui.com/llms-full.txt) · [Tailwind docs](https://tailwindcss.com/docs) · [FastAPI](https://fastapi.tiangolo.com) · [Pydantic v2](https://docs.pydantic.dev/latest/) · [Motor](https://motor.readthedocs.io)

## 8. COMMANDS

All commands are registered files in `.claude/commands/` and are tab-completable. **Behavior lives in those files — never duplicate it here.**

- `/audit:pass` `/audit:plan` `/audit:wave` `/audit:status` `/audit:finish` — audit-programme lifecycle. Methodology: `docs/_auditing/`.
- `/roadmap:start <ID>` — work ONE open item to a conclusion. Backlog: `docs/roadmap/open-items.md`; closed log: `closed-items.md`.

The `/audit:*` and `/roadmap:*` commands are slash-only; never launch one from casual prose.

## 9. RATIFIED ARCHITECTURAL DECISIONS — do not "fix" these

Each of these reads as a violation of §2 or of ordinary best practice, and each is deliberate. **Do not flag, refactor, or "optimize" any of them without an explicit instruction that names the decision.** If you believe one is wrong, say so and stop — do not act.

**The full argument for each — including the alternatives that were rejected — is in `docs/_decisions/`.** Read the ADR before proposing a change to anything below. **If this table and an ADR disagree, the ADR is the source and this table is the summary**, so correct the table, never the ADR.

**Paths are `docs/_decisions/<number>-*.md`** — glob the number, the slugs are not guessable.

**Frontend**

- **ADR-0009** — `await connection()` precedes every page data fetch. The requirement is that it precede the _fetch_, not that it sit in the default export. Removing one **fails `docker compose build`**: the builder stage has no reachable backend.
- **ADR-0003** — zero barrel files. Import from the file you mean; express per-slice surfaces with `no-restricted-imports`, never an `index.ts`.
- **ADR-0004** — `utils.ts` and `resolvers.ts` are sanctioned optional slice modules. Folding either into `queries.ts` puts non-caching code inside a `"use cache"` module.
- **ADR-0007** — `SpielCard` / `SpielCardCompact` / `SpielCardUltraCompact` stay three components. **Do not merge them.** Shared derivation lives in `utils.ts`.
- **ADR-0011** — no `generateStaticParams` on the two dynamic segments: it would call the API at build time, and `searchParams` cannot be enumerated anyway.
- **ADR-0012** — `admin` is an aggregator slice and legitimately imports from four others. **Any cross-feature import lint must be scoped to `core` and `shared` only.**
- **ADR-0005** — the Spiel **write path** lives in `features/spiele`, not `admin`. `AdminEditSpielDataForm` takes its lookup lists as **props** and must not read `useAdmin()`.
- **ADR-0013** — `getAdminSpieleActionRequired` is deliberately uncached. Admin-authorized data does not belong in a shared cache.
- **ADR-0008** — named exports everywhere under `src/`; defaults only where Next.js requires them.
- **ADR-0006** — component category folders, one extra level for a multi-section form.
- **ADR-0025** — the type scale is `fluid-sm`, **never `text-fluid-sm`**. The tokens live outside Tailwind's `--text-*` namespace so no `text-fluid-*` utility exists at all, and a stale one styles nothing silently.

**Backend and data**

- **ADR-0002** — an omitted `saison_id` means the **current season**, resolved in the backend handler. Not all seasons, and not via a field default.
- **ADR-0026** — team statistics are **derived from `spiele` on every read** and stored nowhere. A table recomputed per request reads as an obvious thing to cache or store; that is this decision reversed, not an optimisation. A match counts exactly when it carries an `ergebnis` — `is_canceled` is deliberately **not** consulted, because a cancelled match with a result is a forfeit. Points come from `FLSaison.rules`, never a hardcoded 3/1/0.
- **ADR-0027** — the backend **refuses to start** if a validator or unique index cannot be applied, and reapplies all of them on **every boot**. Catching the failure and carrying on leaves a database that looks constrained and is not. Validators assert types, presence and enums only; a `minLength` or a `minimum` widens the scope rather than adding a constraint.
- **ADR-0031** — those validators **duplicate the Pydantic models by hand, on purpose. Do not generate them.** `CustomObjectId` emits a bare `{"type": "string"}` in JSON mode, so a generated validator would type every ObjectId reference as a string, blessing the exact defect the validators exist to refuse. A default-tier test compares the two copies field-by-field instead.
- **ADR-0032** — soft deletion is `inactive_since`, a nullable `YYYY-MM-DD` **date, never a boolean**: a flag beside a date can contradict itself and no validator can catch that. **Creating never revives a retired row** — `POST /{resource}/{id}/reactivate` does, and a natural-key collision is a **409**, which is correct rather than a bug. `saisons`, `saison_teams` and `spiele` deliberately have no such field.
- **ADR-0033** — `POST /saisons/{id}/activate` is the **only** code path that writes `status`, in one transaction. `status` is on no payload, there is no `DELETE /saisons/{id}`, and **`saison_teams` has a POST and a PATCH and no DELETE** because a team leaves a season only by disqualification. Neither gap is an incomplete CRUD surface to finish. No date guard on activate: that precondition belongs to FB-6's UI.
- **ADR-0034** — **two routers per slice**: `router.py` reads under `verify_access_base`, `admin_router.py` writes under `verify_access_admin`, both guards at ROUTER level. Never move a guard onto an endpoint and never merge the files. **`GET /{id}` exists on all seven resources and six have no caller — deliberate, not dead code.** Junctions nest under the entity, addressed by their natural key. One team shape, no `compact`.

**Cross-cutting and ops**

- **ADR-0010** — Auth.js owns a direct `MongoClient`, scoped to the `authjs` database. §2's DB rule is scoped to _application data_ for this reason; a second direct client is a real violation.
- **ADR-0001** — two granular cache tags exist (`spiele:saison_id:*`, `teams:saison_id:*`); twenty were deleted. Base tags are invalidated **unconditionally**.
- **ADR-0014** — `checkIsReady`, `getSystemInfo` and `INTERNAL_API_KEY_SYSTEM` stay, though nothing calls the first two. **Never remove the env declaration while leaving the `authType: "system"` branch.**
- **ADR-0015** — `POST /api/revalidate` is protected by network topology. **Do not add an nginx location for it.** Use `revalidateTag` there, not `updateTag`.
- **ADR-0016** — one enforced CSP keeping `'unsafe-inline'`; `react/no-danger` is the compensating control. Do not disable that rule.

## 10. DOCUMENTATION

**`docs/README.md` is the entry point.** From there: `_decisions/` for why (the ADRs), the per-surface `overview.md` and `spec.md` for what, `glossary.md` for the German domain vocabulary, and **`workflows/` for branching, commits, PRs, deployment, the recurring operational tasks, and the commit/PR/issue templates** — consult it before proposing a git or deploy step.

**`docs/_standard/`** defines how the repo is documented — read it before writing or changing documentation. **Start at `1-principles.md`**: nine rules (P1–P9) that govern every document in this repo, including prompts, command files and commit bodies. `6-decisions.md` holds the DS decisions about the standard itself; `5-currency.md` holds the rules below.

**Four rules keep documentation true. They are not optional and not deferrable:**

1. **Same commit.** A change that invalidates a documented claim updates that document **in the same commit**. A commit whose docs contradict its code is incomplete, not a commit with a follow-up.
2. **Before every PR, answer out loud: "what did this change make untrue?"** Then check the module header, the surface spec, the glossary, this file, and any ADR now contradicted. "Nothing" is a valid answer; not asking is not.
3. **Cite anchors, never line numbers** — `file › symbol` or `` file › `fragment` ``, or an ADR number. A line number is wrong after any edit above it and nothing detects that.
4. **Only cite an ADR that exists**, and never invent a number to fill a gap. Writing the ADR is part of the change that cites it.

**Write for a reader with no context (P1).** No reference to a session, a conversation, a past programme, or an identifier that does not resolve to something tracked in this repo. A dangling reference is worse than none — it still reads as though it means something. Where a lesson is worth keeping, restate it as a present-tense rule.

- **In code:** module header, then symbol docs, then inline comments. **Never restate a type** — the signature already says it. Document intent, constraints, rejected alternatives and traps.
- **Documentation names only what exists — comments AND `/docs` alike (DS14).** No "used to", "previously", "this was reverted", no narration of a past edit, nothing documenting an absence. A history note ages badly and quietly becomes wrong, and a spec sheet naming a deleted endpoint reads exactly like one naming a live endpoint. Record a rejected alternative in the **present, as a constraint** ("never X, because Y"). A **measurement with a date is not history** and stays. Exempt, because recording what changed is their job: an ADR's **Context**, `roadmap/closed-items.md`, and an ADR's `Superseded by`. Grep a branch diff before committing and READ the hits — "the former … the latter" is ordinary English:

  ```bash
  git diff main...HEAD -U0 | grep -niE "former|used to|was removed|no longer|previously|moved here"
  ```

- **A module header POINTS at the ADR; it never restates it (DS15).** A header section past about five lines, **or repeated in a second file, is an ADR that has not been written yet** — write it, then cut the header to the rule plus the number. State the **claim** in full; cite the **argument**. A reader who never opens the ADR must still know not to violate the rule.
- **A directive (`"use server"`, `"use client"`) stays the first line of the file**, above any header block.
- **Every module gets a header; every FastAPI endpoint gets a docstring** (FastAPI publishes it to OpenAPI). Everything else is documented where there is a _why_ worth recording.
- **Cite ADR numbers, never audit sections.** `docs/audit/` is expected to be deleted.
- **A code change that invalidates a documented claim updates the doc in the same commit.** This is the only rule that actually prevents drift.
- Open items and future ideas are tracked in `docs/roadmap/` (`open-items.md` carries the analyses; `closed-items.md` is the log of what has left it, one row per item naming the commit that closed it — an id missing from the open file is very likely there rather than imaginary).
