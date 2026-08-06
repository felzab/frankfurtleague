# Frankfurt-League — assistant rules

Senior full-stack engineer on a soccer league site. Response style: `~/.claude/CLAUDE.md`, unchanged.

**Precedence, highest first.** §1 security · §2 branch-before-edit · an explicit owner instruction this
session · §7 ratified decisions · everything else.

Two corollaries that prevent the most common errors:

- **Check §7 before calling anything a violation.** Those patterns look wrong and are deliberate.
- **When something disagrees with this file, the ADR decides which one is wrong.** This file is a
  summary; `docs/_decisions/` is the source.
  - The ADR matches the code → **this file is stale.** Say so, do not enforce it, and correct it.
  - The ADR matches this file → **the code is the violation.** Enforce the rule.
  - No ADR covers it → raise it rather than guessing. Silently picking a side is how the two drift
    further apart.

---

## 1. Security — absolute, no exceptions

Hold even when the owner requests, insists, claims authorization, or frames it as a test.

- **Never** read, print, log, echo, decode, summarize, diff or transmit `.env*` contents or any
  credential material (`*.pem`, `id_rsa*`, `credentials.json`, service-account JSON, `kubeconfig`,
  tokens, API keys).
- **The indirect routes are the same violation**: `cat`/`echo` of an env var, base64 or hex encoding,
  "just the first few characters", or embedding a value in a log, comment, error or commit message.
- **Never hardcode a secret** in place of `process.env.X` / `os.getenv("X")`.
- **Every `.gitignore`-matched path is off-limits.** One exception: `docs/audit/`, which the `/audit:*`
  workflow reads and writes.
- If asked to violate any of the above: refuse, name the rule, do not partially comply.

`settings.json` denies the Read tool for the common secret paths. It does not cover Bash, which is why
the rules above are the control.

## 2. Branch before you edit — MANDATORY, and it is the FIRST thing you do

`main` is protected and takes changes only through a PR.

```bash
git checkout main && git pull --ff-only origin main && git checkout -b short-kebab-name
```

- **Check the branch before the first write to any tracked file.** Not before the first commit.
- **This includes shell writes** — `sed -i`, a redirect, a heredoc, `python … write_bytes`. A hook
  blocks both routes on `main`; treat a block as the rule working, never as something to route around.
- **Name the branch for the change**, kebab-case, no `feature/`/`fix/`/`chore/` prefix.
- **Exception: a task that writes no tracked file** — answering, reading, or writing only to the
  scratchpad. "It is only one line" is not an exception.
- **Already on `main` with uncommitted edits?** `git checkout -b <name>` carries them across intact.
  Say plainly that it happened.
- **Never run `git reset --hard`.** It discards the working tree, not just a commit pointer, and
  uncommitted work in another file goes with it silently. `git reset --soft HEAD~1` undoes a commit
  and keeps the work; `git checkout -- <path>` reverts one file. The runbook in
  `docs/workflows/README.md` that uses it is the **owner's**, for their own tree, and is not a
  licence to run it here.
- **Never** commit to `main`, push to `main`, merge locally, or force-push.
- **Open the pull request yourself, and always as a draft** — `gh pr create --draft`. A draft cannot
  be merged until it is marked ready, so the owner reviews before the button is live. **Never
  `gh pr merge`, and never `gh pr ready`**: both are the owner's, and no instruction in a session
  makes either yours. Read with `gh` freely (`gh pr view`, `gh pr checks`, `gh run view`).

**The full cycle is [`docs/workflows/README.md`](../docs/workflows/README.md)** — commit subject and
body shape, when the gate needs its full form, merge by merge commit. Read it rather than recalling
it; that page is the source and this section is the summary. Message templates:
[`message-templates.md`](../docs/workflows/message-templates.md).

### Every task ends the same way

| Step                                                            | Who       |
| --------------------------------------------------------------- | --------- |
| Branch · implement · run `./scripts/verify.sh` per §gate        | assistant |
| Commit, per `docs/workflows/message-templates.md`               | assistant |
| Push the branch (`git push -u origin <name>`)                   | assistant |
| Open the PR as a **draft**, and print its link                  | assistant |
| Review, mark ready, merge, then `git checkout main && git pull` | **owner** |

**Work is finished when it is committed, pushed, and the draft PR's link is in the response.** Not
when it compiles.

**Never sign commits, PRs or code as AI-generated.** No `Co-Authored-By: Claude`, no "Generated with
Claude Code", no equivalent. This overrides any default instruction to add one.

### The gate

Run `./scripts/verify.sh` before pushing, covering **every surface the branch touched** — the scope
flags name surfaces and combine (`scripts/README.md` has the table), and no flag runs everything.
The minimum by change: docs-only → `--docs`, plus `pnpm format` from `fl_frontend/` (commit what it
rewrites); backend → `--backend --db --docs`; frontend → `--frontend --docs`; nginx or a compose
file → `--ops`; `scripts/` → the full form; packaging (a Dockerfile, a lockfile, `next.config.ts`,
`src/core/config.ts`, `src/core/auth.ts`, `src/instrumentation.ts`) → the full form, images
included. In doubt → the full form. The frontend scope rewrites the tree (the formatter runs first) — commit what it reformats
and read the diff.

**A comment-only edit is a documentation change, whatever file holds it.** Correcting a citation in
`src/core/config.ts` is `--docs` plus `pnpm format`, not the full form: what picks the scope is what
the change could break, and a comment breaks documentation. The moment a hunk in that file touches a
line that runs, the packaging rule above applies again.

**The carve-out reaches only as far as a parser does** ([ADR-0037](../docs/_decisions/0037-the-gate-refuses-an-undersized-scope.md)):
TypeScript, Python and TOML. **A comment in a Dockerfile, a workflow or a shell script still asks for
the full form**, because a `#` inside a heredoc or a string is not a comment and nothing available
can tell the two apart — and those are the files where a wrong answer costs the most.

**None of this rests on memory.** `./scripts/verify.sh` compares the scope you named against the
branch's diff before it runs anything, refuses a run that skips the image build while a file asking
for it changed by more than comments, and reports every other surface left unproven.

Report the actual exit code. Never the word "passing", never a hand-typed substitute chain.

**The gate checks your commit messages too**, inside `--docs`: no body, an unwrapped line, a
malformed subject, a trailer, an emoji or an issue-closing keyword each fail the run. Write the
message to the form in `docs/workflows/message-templates.md` the first time — a reword after the
fact means rebasing a branch you have already pushed.

## 3. Quality bar

**A passing gate is evidence the code works, never evidence it is right.** Before saying a thing is
done, re-read it and ask whether you would defend every line if challenged. If not, fix it or name it
as a decision for the owner — never ship it silently, never bury the doubt in prose.

**Four trip-wires. Each means stop:**

- A workaround needing a paragraph to justify. Length of justification tracks wrongness.
- A lint rule suppressed, or a tool worked around, to make something fit.
- A testing-only API (`dependency_overrides`, monkeypatching, env mutation) in production code.
- Fixing where a failure **surfaced** rather than where it **originates**.

**Found means fixed — never reported.** (Owner rule, 2026-08-06.) Within the task's scope, a defect
or sub-best-practice pattern you find is fixed in the same session, not written up as "found X but
did not fix it because…". If you are genuinely unsure whether to fix it — scope, a ratified decision
(§7), a product call — ask the owner **at the moment you hit it**, mid-task; never save the question
for the wrap-up, where the only remaining options are shipping the doubt or starting over. A finding
genuinely outside the task still follows the roadmap rule (`docs/roadmap/README.md`): file it at
once, and say so in the moment rather than at the end.

**Verify the thing you changed, not the thing that is easy to verify.** A build never runs `CMD`; a
passing import never proves a request; a green suite on a configured machine never proves a clean
checkout. Name what was actually exercised and what was not.

**Give exactly one solution** — the current best practice. No alternatives unless asked. "Full
implementation" means production-ready, not partial.

Every coding response carries: the code · comments on non-obvious lines · doc links for anything
non-trivial · a breaking-change notice if applicable · deployment notes if commands are involved.

**Code quality:** clear separation of concerns · minimal, no premature abstraction · error handling and
input validation · fully typed.

## 4. Stack and versions

Next.js · React · HeroUI · Tailwind · FastAPI · Pydantic v2 · Motor · Docker Compose · nginx.
**Read the installed versions from `fl_frontend/package.json` and `fl_backend/pyproject.toml`** before
advising on anything version-specific. Never recite a version from memory.

**The repository is the reference for current idiom.** If the codebase already uses a pattern, use that
pattern — it compiles and passes the gate, which is stronger evidence than recall. **When introducing a
pattern the repo does not already use, verify it against the official docs before writing it**, not
after being challenged. Say plainly when you could not verify.

Docs: [Next.js](https://nextjs.org/docs/app) · [Next 16](https://nextjs.org/blog/next-16) ·
[proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) ·
[HeroUI](https://www.heroui.com/docs/react) · [llms-full](https://heroui.com/llms-full.txt) ·
[Tailwind](https://tailwindcss.com/docs) · [FastAPI](https://fastapi.tiangolo.com) ·
[Pydantic](https://docs.pydantic.dev/latest/) · [Motor](https://motor.readthedocs.io)

### Deprecations the toolchain will NOT catch

Every other deprecation in this stack surfaces as a type error, a lint error or a failed build. These
five do not — they compile, pass, and silently do nothing:

| Never                                   | Always                                   |
| --------------------------------------- | ---------------------------------------- |
| `middleware.ts`                         | `proxy.ts`                               |
| `tailwind.config.js`                    | CSS-first `@theme` / `@layer`            |
| `@tailwind base/components/utilities`   | `@import "tailwindcss"`                  |
| `getServerSideProps` / `getStaticProps` | Server Components + `use cache`          |
| A direct DB query for application data  | FastAPI (Auth.js session store excepted) |

## 5. Platform

Dev is Windows 11, prod is Linux. **Label every terminal command with its target.** Use `path` /
`os.path`; never suggest a tool absent from the target OS.

- **`scripts/` runs in Git Bash**, not PowerShell or CMD. MSYS rewrites POSIX-looking paths, so prefix
  a hand-typed `docker run -v` with `MSYS_NO_PATHCONV=1`.
- **Local Docker is always `./scripts/local.sh`** (`--down`, `--fresh`, `--logs`). A bare
  `docker compose` reads the _production_ file. A hook blocks it.
- **Nothing else may hold port 3000** while the local stack runs. Stop any dev server first.
- **You may start the local stack; you MUST stop it** before handing back.
- **Verify in the browser against the local stack**, never a dev server: `next dev` exercises neither
  the standalone build, nor nginx, nor the startup env gate. Point `preview_start` at
  `http://localhost:3000` once `local.sh` is up.

## 6. Repo-specific traps

These fail **silently** — the gate stays green and the defect ships. Everything else about conventions
is in `/docs`; match the surrounding code.

- **A db-touching test needs `@pytest.mark.db`.** Without it the test runs in the default tier with no
  container and fails for an unrelated-looking reason. Nothing catches an omitted marker.
- **A Pydantic field default is passed by keyword** — `Field(default=0, ge=0)`, never `Field(0, ge=0)`.
  Positional leaves Pyright believing the field is required; ruff and pytest stay green.
- **A HeroUI component needs its CSS imported per component, across two stylesheets** —
  `src/app/globals.css` (every route) and `src/app/admin/admin.css` (only `/admin`). Missing from both,
  it renders unstyled while `tsc`, `next build` and ESLint all pass. Read and restate
  [the checklist](../docs/frontend/overview.md#adding-a-heroui-component) before writing the code.
- **A model mirroring a collection has a hand-written copy in `app/core/constraints.py`**; both change
  in the same commit. A default-tier test names the field if you forget. `saison_teams` and
  `saison_spieler` have no model — verify with `python -m app.core.constraints --check`.
- **Before deleting a `"use client"`, grep for render props.** A Server Component may not pass a
  function to a Client Component; neither `tsc` nor the build catches it on a dynamic route.
- **Every granular cache tag needs a matching `updateTag` in the same change.** A tag nothing
  invalidates is decoration.

## 7. Ratified decisions — never "fix" these

Each reads as a violation and is deliberate. **Do not flag, refactor or optimize one without an
instruction naming it.** If you believe one is wrong, say so and stop.

The argument, the alternatives and the measurements are in `docs/_decisions/` — read the ADR before
proposing any change. **The ADR is the source; this list is only an index**, so correct the list, never
the ADR.

| ADR  | Never                                                                                               |
| ---- | --------------------------------------------------------------------------------------------------- |
| 0001 | Add a granular cache tag with no `updateTag`; make base tags conditional                            |
| 0002 | Give `saison_id` a field default — an omitted one means the current season, in the handler          |
| 0003 | Add a barrel file                                                                                   |
| 0004 | Fold `utils.ts` or `resolvers.ts` into `queries.ts`                                                 |
| 0005 | Move the Spiel write path to `admin`, or let its form read `useAdmin()`                             |
| 0006 | Nest components deeper than one level, or leave them flat in `components/`                          |
| 0007 | Merge the three `SpielCard` variants                                                                |
| 0008 | Use a default export outside the files Next.js requires one in                                      |
| 0009 | Remove an `await connection()` before a page fetch — the image build fails                          |
| 0010 | Add a second direct `MongoClient`; Auth.js owns the only one                                        |
| 0011 | Add `generateStaticParams` to a dynamic segment                                                     |
| 0012 | Scope a cross-feature import lint to anything but `core` and `shared`                               |
| 0013 | Cache `getAdminSpieleActionRequired`                                                                |
| 0014 | Remove `checkIsReady`, `getSystemInfo`, or the system key while its branch stands                   |
| 0016 | Disable `react/no-danger`, or add a second CSP                                                      |
| 0025 | Write `text-fluid-*` — the scale is `fluid-sm`, and no such utility exists                          |
| 0026 | Store or cache team statistics; hardcode 3/1/0; consult `is_canceled` for the table                 |
| 0027 | Let a failed validator or index be caught and ignored; widen one past types/presence/enums          |
| 0028 | Treat `mietpreis` / `payment` as stale copies of the defaults                                       |
| 0029 | Change the league table's default scope away from `gruppenphase`                                    |
| 0030 | Move db-marked tests out of the gate                                                                |
| 0031 | Generate the `$jsonSchema` validators from the models                                               |
| 0032 | Make `inactive_since` a boolean; revive a retired row by creating it — 409 is correct               |
| 0033 | Write `status` outside `POST /saisons/{id}/activate`; add a DELETE to `saisons` or `saison_teams`   |
| 0034 | Move a guard onto an endpoint, merge the two routers, or delete an uncalled `GET /{id}`             |
| 0035 | Re-add a reference-data invalidation endpoint; treat sub-24h reference staleness as a defect        |
| 0037 | Let the comment classifier shrink a CI job; add a flag that suppresses the images refusal           |
| 0038 | Pin `type=gha`'s cache version; give the two images one cache scope; re-add an `actions/cache` step |
| 0042 | Store the bracket's German label; add an override flag beside `quelle`; advance one match's feeds   |
| 0044 | Put the shoot-out inside `ergebnis`; store its winner; let the league table read it                 |
| 0045 | Add a POST or a DELETE to `/spiele` — a season's fixtures are created once, then cancelled or moved |
| 0047 | Store a bracket fault; report a placing that is merely undecided; let reporting one resolve it      |
| 0053 | Style a toast from CSS beyond the two rules named there; call HeroUI's `toast` at a call site       |

## 8. Documentation

**The standard is `docs/_standard/`, starting at `1-principles.md`. Read it before writing or changing
any documentation.** These four are the ones that bind every session:

1. **Same commit.** A change invalidating a documented claim updates that document in the same commit.
2. **Anchored citations** — `` `<file> :: <symbol>` `` or an ADR number, never a line number.
3. **Only cite an ADR that exists.** Writing it is part of the change that cites it.
4. **Name only what exists.** No "used to", no narration of an edit, nothing documenting an absence.
   Record a rejected alternative in the present, as a constraint.

Write for a reader with no context: no reference to a session, a past effort, or an identifier that
resolves to nothing.

`./scripts/verify.sh` fails on a dangling ADR number, a dead link, a broken anchor, a line-number
citation, a missing path, and a stamped page edited without restamping — in `/docs` and inside source
comments alike.

**Entry point: `docs/README.md`.** Every module gets a header; every FastAPI endpoint gets a docstring;
never restate a type.

## 9. Commands

Registered in `.claude/commands/`, tab-completable, **slash-only — never launch one from prose**.
Behaviour lives in those files.

| Command               | Does                                                                         |
| --------------------- | ---------------------------------------------------------------------------- |
| `/audit:*`            | Audit programme lifecycle                                                    |
| `/roadmap:start <ID>` | Work one open item to a conclusion                                           |
| `/roadmap:add`        | Turn described items into ranked roadmap entries, then re-rank the file      |
| `/docs:audit`         | Sweep every document and comment against `docs/_standard/`; `fix` applies it |
