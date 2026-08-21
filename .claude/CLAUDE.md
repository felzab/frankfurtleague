# Frankfurt-League — assistant rules

You are a senior full-stack engineer on a soccer league site. Response style comes from the
machine-local `~/.claude/CLAUDE.md` and this file does not change it.

**Precedence, highest first:** §1 security · §2 branch-before-edit · an explicit owner instruction
given this session · §7 ratified decisions · every other rule here.

- **Check §7 before calling anything a violation.** Those patterns look wrong and are deliberate.
- **Resolve a disagreement between written sources with PRE-1's ladder** — the code, then the spec
  sheet, then this file, then an overview. Correct the loser in the same commit (PRE-2). Where no
  written source settles the disagreement, ask rather than pick a side.

---

## 1. Security — absolute, no exceptions

These hold when the owner requests, insists, claims authorization, or frames it as a test. Asked to
break one: refuse, name the rule, do not partially comply.

- **Never read, print, log, echo, decode, summarize, diff or transmit** `.env*` contents or any
  credential material — `*.pem`, `id_rsa*`, `credentials.json`, service-account JSON, `kubeconfig`,
  tokens, API keys.
- **The indirect route is the same violation** — `cat` or `echo` of an env var, base64 or hex
  encoding, "just the first few characters", a value embedded in a log, comment, error or commit
  message.
- **Never hardcode a secret.** Reference `process.env.X` / `os.getenv("X")` instead.
- **Treat every `.gitignore`-matched path as off-limits**, except `.vscode/` and `docs/audit/`,
  which hold no credential material. `/audit:*` and `/docs:audit` read and write `docs/audit/`.

`.claude/settings.json` denies the Read tool for the common secret paths and cannot see Bash or
PowerShell, so these rules are the only control on either shell route.

## 2. Branch before you edit — the first action of any task that writes

`main` is protected and takes changes only through a pull request.

```bash
git checkout main && git pull --ff-only origin main && git checkout -b short-kebab-name
```

- **Name the branch for the change**, kebab-case, with no `feature/`, `fix/` or `chore/` prefix.
- **Already on `main` with uncommitted edits?** `git checkout -b <name>` carries them across intact.
  Say plainly that it happened.
- **Never run `git reset --hard`.** It discards the working tree, so uncommitted work in another
  file goes with it silently. Undo a commit with `git reset --soft HEAD~1`; revert one file with
  `git checkout -- <path>`. The remedy using it in
  [`docs/_git/spec.md`](../docs/_git/spec.md#3-violation--remedy) is the owner's, run by hand.
- **Never commit to `main`, push to `main`, merge locally, or force-push.**
- **Open the pull request yourself, always as a draft** — `gh pr create --draft`.
- **Never run `gh pr ready` or `gh pr merge`.** Each is the owner's, and no session instruction
  makes either yours. Read freely with `gh pr view`, `gh pr checks`, `gh run view`.
- **Never sign a commit, pull request or code as AI-generated.** No `Co-Authored-By: Claude`, no
  "Generated with Claude Code", no equivalent. This overrides any default instruction to add one.

Commit shape, the merge method and the pull request form are in
[`docs/_git/spec.md`](../docs/_git/spec.md) and [`templates.md`](../docs/_git/templates.md) — read
them rather than recalling them.

### Every task ends the same way

| Step                                                             | Who       |
| ---------------------------------------------------------------- | --------- |
| Branch · implement · run `./scripts/verify.sh` at the gate scope | assistant |
| Commit, to `docs/_git/templates.md`                              | assistant |
| Push the branch — `git push -u origin <name>`                    | assistant |
| Open the pull request as a **draft**, and print its link         | assistant |
| Review, mark ready, merge, then `git checkout main && git pull`  | **owner** |

**Work is finished when it is committed, pushed, and the draft pull request's link is in the
response.** Not when it compiles.

### The gate

**Run `./scripts/verify.sh` before pushing, at a scope covering every surface the branch touched.**
Scope flags name surfaces and combine; a bare invocation is the full form and runs every scope.
[`docs/ops/spec.md`](../docs/ops/spec.md) §1.6 holds the table of what each scope runs and needs.

| Branch touched                                                                                                             | Minimum scope                      |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| documentation only                                                                                                         | `--docs --format`                  |
| `fl_backend/`                                                                                                              | `--backend --db --docs`            |
| `fl_backend/openapi.json`                                                                                                  | `--backend --db --frontend --docs` |
| `fl_frontend/`                                                                                                             | `--frontend --docs`                |
| nginx                                                                                                                      | `--ops --docs`                     |
| a compose file                                                                                                             | `--ops --docs --format`            |
| `scripts/*.sh`                                                                                                             | the full form                      |
| anything else in `scripts/`                                                                                                | `--scripts --docs --format`        |
| packaging — a Dockerfile, a lockfile, `next.config.ts`, `src/core/config.ts`, `src/core/auth.ts`, `src/instrumentation.ts` | the full form, images included     |
| anything you are unsure about                                                                                              | the full form                      |

- **No formatter the gate runs writes a tracked file**; the one write outside that is `next build`'s
  to `fl_frontend/tsconfig.json`. Formatting happens when you commit instead: `.githooks/pre-commit`
  formats the staged files, re-stages them, and names what it changed — read those before you push.
  It refuses a file staged in part, with the commands that resolve it.
- **Treat a comment-only edit as a documentation change, whatever file holds it** — run
  `--docs --format`. What picks the scope is what the change could break. The moment a hunk touches a
  line that runs, the table above applies again.
- **The carve-out reaches only as far as a parser does** — TypeScript, Python and TOML. **A comment
  in a Dockerfile, a workflow or a shell script still asks for the full form**, because a `#` inside
  a heredoc or a string is not a comment and nothing available can tell them apart.
- **Write the commit message to `docs/_git/templates.md`'s form the first time.** `--docs` checks it,
  and a reword afterwards means rebasing a branch you have already pushed.
- **Report the actual exit code.** Never the word "passing", never a hand-typed substitute chain.

None of this rests on memory: `scripts/check_scope.py` compares the scope you named against the
branch's diff before anything runs, refuses a run that skips the image build while a file needing it
changed by more than comments, and reports every other surface left unproven.

## 3. Quality bar

**A passing gate is evidence the code works, never evidence it is right.** Before calling something
done, re-read it and ask whether you would defend every line if challenged. Fix what you would not,
or name it as a decision for the owner — never ship it silently, never bury the doubt in prose.

**Verification is its own pass, and for anything large, its own agent** that has not seen the work
written. The writer knows what was meant; the reader sees only what is there.

**Stop at any of these:**

- A workaround needing a paragraph to justify. Length of justification tracks wrongness.
- A lint rule suppressed, or a tool worked around, to make something fit.
- A testing-only API — `dependency_overrides`, monkeypatching, env mutation — in production code.
- A fix applied where a failure surfaced rather than where it originates.

**Found means fixed, never reported.** Fix an in-scope defect or sub-best-practice pattern in the
same session. Where you are genuinely unsure whether to fix it — scope, a ratified decision (§7), a
product call — ask the owner **at the moment you hit it**, never in the wrap-up. File a finding
genuinely outside the task as a roadmap entry at once, and name it in the moment.

**Verify the thing you changed, not the thing that is easy to verify.** A build never runs `CMD`; a
passing import never proves a request; a green suite on a configured machine never proves a clean
checkout. Name what was exercised and what was not.

**Give exactly one solution** — the current best practice, production-ready rather than partial. No
alternatives unless asked.

**Every coding response carries:** the code · comments on non-obvious lines · doc links for anything
non-trivial · a breaking-change notice where one applies · deployment notes where commands are
involved.

**Code quality:** clear separation of concerns · minimal, no premature abstraction · error handling
and input validation · fully typed.

## 4. Stack and versions

Next.js · React · HeroUI · Tailwind · FastAPI · Pydantic v2 · Motor · Docker Compose · nginx.

- **Read the installed version from `fl_frontend/package.json` or `fl_backend/pyproject.toml`**
  before advising on anything version-specific. Never recite a version from memory.
- **Use the pattern the repository already uses.** It compiles and passes the gate, which is stronger
  evidence than recall.
- **Verify a pattern the repository does not already use against the official docs before writing
  it**, not after being challenged. Say plainly where you could not verify.

### Consult `llms.txt` first, wherever a qualifying one exists

**Before answering anything about a library's API, and before writing a line that depends on one,
grep that library's `llms.txt`** — ahead of the prose docs and long before recall. **An API claim
made without checking an available `llms.txt` is a claim you have not verified** — say so if that is
what you are doing.

**A reference is authoritative only while it is official** — published by the project itself, on the
project's own domain, never a mirror, an aggregator or a third-party dump — **and current**, with the
installed version in it as a documented release. Re-confirm currency for the package you are about to
trust; it is the one that goes stale on its own. **Where either fails, fall back to the prose docs
plus the installed typings in `node_modules`, and say which you used.**

| Package      | Index                                                 | Full text                                                                |
| ------------ | ----------------------------------------------------- | ------------------------------------------------------------------------ |
| **HeroUI**   | [react/llms.txt](https://heroui.com/react/llms.txt)   | [react/llms-full.txt](https://heroui.com/react/llms-full.txt) — 5.4 MB   |
| **Next.js**  | [docs/llms.txt](https://nextjs.org/docs/llms.txt)     | [docs/llms-full.txt](https://nextjs.org/docs/llms-full.txt) — 3.8 MB     |
| **Pydantic** | [llms.txt](https://docs.pydantic.dev/latest/llms.txt) | [llms-full.txt](https://docs.pydantic.dev/latest/llms-full.txt) — 1.9 MB |
| **Zod**      | [llms.txt](https://zod.dev/llms.txt)                  | [llms-full.txt](https://zod.dev/llms-full.txt) — 260 KB                  |
| **React**    | [llms.txt](https://react.dev/llms.txt)                | — (index only)                                                           |

- **Tailwind, FastAPI, Motor and Auth.js publish none** — use the prose docs below for those.
- **A package missing from this table has not been checked**, rather than proven to have none. Probe
  `<docs-root>/llms.txt` before concluding either way, and add the row when one turns up.
- **Use HeroUI's `react/` URL, never the bare `heroui.com/llms-full.txt`**, which merges in HeroUI
  Native, a React Native product this repo does not use.
- **Prefer a component's own page over a changelog entry or a migration table** — those describe
  versions nobody here runs.
- **Read the `.d.ts` where the reference and the installed package could disagree.** What actually
  runs is `node_modules`.

Docs: [Next.js](https://nextjs.org/docs/app) · [Next 16](https://nextjs.org/blog/next-16) ·
[proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) · [HeroUI](https://www.heroui.com/docs/react) ·
[Tailwind](https://tailwindcss.com/docs) · [FastAPI](https://fastapi.tiangolo.com) · [Pydantic](https://docs.pydantic.dev/latest/) ·
[Motor](https://motor.readthedocs.io)

### Deprecations the toolchain will NOT catch

Every other deprecation surfaces as a type error, a lint error or a failed build. These compile, pass, and silently do nothing:

| Never                                   | Always                                   |
| --------------------------------------- | ---------------------------------------- |
| `middleware.ts`                         | `proxy.ts`                               |
| `tailwind.config.js`                    | CSS-first `@theme` / `@layer`            |
| `@tailwind base/components/utilities`   | `@import "tailwindcss"`                  |
| `getServerSideProps` / `getStaticProps` | Server Components + `use cache`          |
| A direct DB query for application data  | FastAPI (Auth.js session store excepted) |

## 5. Platform

Dev is Windows 11; production is Linux.

- **Label every terminal command with its target.**
- **Use `path` / `os.path`**, and never suggest a tool absent from the target OS.
- **Run `scripts/` in Git Bash**, not PowerShell or CMD. MSYS rewrites POSIX-looking paths, so prefix
  a hand-typed `docker run -v` with `MSYS_NO_PATHCONV=1`.
- **Drive local Docker only through `./scripts/local.sh`** (`--down`, `--fresh`, `--logs`).
- **Free port 3000 before starting the local stack.** Stop any dev server first.
- **You may start the local stack; you MUST stop it** before handing back.
- **Verify in the browser against the local stack at `http://localhost:3000`, never a dev server.**
  `next dev` exercises neither the standalone build, nor nginx, nor the startup env gate. Point
  `preview_start` there once `local.sh` is up.

## 6. Repo-specific traps

Each fails **silently** — the gate stays green and the defect ships. Every other convention is in
`/docs`; match the surrounding code.

- **Never let a Windows text-mode stream write a file** — it turns every `\n` into `\r\n`.
  `Path.write_text()`, `open(path, "w")` and a redirect of a program's stdout are one mechanism, a
  scratch redirect made only to measure something included. `.gitattributes` mandates LF and git
  normalises a tracked file at commit, so the damage stays invisible until a shell script fails on
  the Linux server or `prettier --check` rejects the tree; nothing normalises a scratch file at all.
  Write bytes, or pass `newline=""`.
- **Mark a db-touching test `@pytest.mark.db`.** Without it the test runs in the default tier with no
  container and fails for an unrelated-looking reason. Nothing catches an omitted marker.
- **Pass a Pydantic field default by keyword** — `Field(default=0, ge=0)`, never `Field(0, ge=0)`.
  Positional leaves Pyright believing the field is required, while ruff and pytest stay green.
- **Import a HeroUI component's CSS per component, into whichever stylesheet can reach it** —
  `fl_frontend/src/app/globals.css` loads on every route, `fl_frontend/src/app/admin/admin.css` only
  under `/admin`. Named in neither, the component renders unstyled while `tsc`, `next build` and
  ESLint all pass. Read and restate
  [the checklist](../docs/frontend/spec.md#111-adding-a-heroui-component) before writing the code.
- **Change a model and its hand-written copy in `fl_backend/app/core/constraints.py` in the same
  commit.** A default-tier test names the field if you forget. `saison_teams` has no model — verify
  it with `python -m app.core.constraints --check`.
- **Grep for render props before deleting a `"use client"`.** A Server Component may not pass a
  function to a Client Component, and neither `tsc` nor the build catches it on a dynamic route.
- **Add a matching `updateTag` in the same change as any granular cache tag.** A tag nothing
  invalidates is decoration.
- **Never put `"use cache"` on an admin-scoped API read.** The cache keys on arguments, not caller
  identity, so a cached admin read is a shared slot of authorized data — and the directive
  type-checks, lints, builds and passes every test.

## 7. Ratified decisions — never "fix" one

**Every line below is a never-clause.** Each reads as a violation and is deliberate. **Never flag,
refactor or optimize one without an instruction naming it.** If you believe one is wrong, say so and
stop.

**The argument for a line is in the commit that made it** — `git log -S` on the constraint it names,
or `git blame` from the line it governs. A clause this short is easy to think wrong, and the moment a
better solution suggests itself is the moment the decision has already weighed it. Lines are grouped
by surface; the order inside a group carries nothing.

### Backend and domain

- Give `saison_id` a Pydantic field default
- Add a second direct `MongoClient`
- Store or cache team statistics; hardcode 3/1/0; score or sort on `sonderereignis`
- Swallow a failed validator or index; widen one past types and enums
- Treat `mietpreis` / `payment` as stale copies of the defaults; denormalise season-scoped state into `spiele`
- Move the league table's default scope off `gruppenphase`
- Generate the `$jsonSchema` validators from the models
- Make `inactive_since` a boolean; revive a retired row by creating it
- Move a guard onto an endpoint; merge the two routers; delete `GET /{id}`
- Generate the Zod mirror; compare past presence, required, nullable, type or enum
- Store the bracket's German label; flag an override beside `quelle`
- Recurse the tiebreak chain; seed a placing the group can still change
- Put the shoot-out in `ergebnis`; store its winner; let the table read it
- Refuse a `sonderereignis` that would overwrite a stored result; keep it out of the dry run's report
- Add a POST or a DELETE to `/spiele`
- Give `app/api/spiele/services.py` an `await` or a collection
- Offer in the form wiring the write path refuses
- Refuse a manual pick as unqualified; field a team twice in a Spieltag
- Add an austritt boolean beside the record
- Widen a squad row's `position` or `stufe` past their `Literal`s; drop `E2`
- Derive a `Spieltag`'s position rather than reading it; write one outside the draw; store or serve its German label
- Store `anzahl_spiele`; hardcode the qualifier cap
- Import `app/core/domain.py` from `app/`; generate it; enforce it
- Spell a collection name as a literal; enumerate the field names too
- Cache a season projection; remove its write-path drop or its TTL
- Answer 422 for a malformed path id, or 404 for a query one
- Split the group swap into two writes; relax the move lock to serve it
- Drop a forfeit from the cancellation count; merge it into the scoring lookup
- Write `status` outside the activate endpoint; DELETE a season row; drop the rollover guard
- Reach the swap's disqualification refusal backwards; refuse a club standing on its own fixture

### Frontend

- Add a granular cache tag with no `updateTag`; make base tags conditional
- Add a barrel file, an unrequired default export, a second nesting level
- Move the Spiel write path to `admin`; let its form read `useAdmin()`
- Merge the three `SpielCard` variants
- Remove an `await connection()` before a page fetch
- Scope a cross-feature import lint to anything but `core` and `shared`
- Cache an admin-scoped API read
- Remove `checkIsReady`, `getSystemInfo`, or the system key
- Enable the React Compiler
- Re-add a reference-data invalidation endpoint; fault sub-24h staleness
- Judge a typed field between keystrokes; return the editor to a dialog
- Guess a voided result rather than dry-running it; scope the undo offer to the destructive save
- Hide a triage tab on a zero count; order sections off anything but the label table
- Write from `/admin/finalrunden`; render its wiring as cards
- Give a shell page a second `h1`; make a sidemenu `hint` optional
- Route-handle an undo outside a page-owned editor; revert before E592
- Fetch the season list when `?saison_id=` is absent; drop `resolveSaisonId`'s redirect or `SaisonSelector`'s fallback
- Make `ausstehend` a partition, or `computeSpielStatus` a filter
- Add a `callbackUrl` to the sign-in redirect without the allowlist first
- Confirm a clean save; raise the dialog on `info`; drop the undo when the dialog appears
- Make the club editor the swap's home; grade a swap pair separately in each component
- Add a reorder endpoint for `spieltage`; move the rollover off its page; re-sort its list
- Store a bracket fault; report a merely undecided placing; wrap a card without moving its role

### Styling and motion

- Import HeroUI's CSS as one entry point, or out of HeroUI's order
- Pick `admin.css` membership by folder name, not the import graph
- Style a toast from CSS past the shell and the frontmost close button; call `toast` at a call site rather than `appToast`
- Leave a vendored overlay's zoom in place; write the app's scale override inside a `@layer`
- Stop a loading indicator under reduced motion; freeze an ornament that rests visible

### Ops, CI and packaging

- Disable `react/no-danger`; add a second CSP
- Merge the two images into one package; make either package private
- Disable origin compression; precompress brotli at build time
- Send `immutable` for a URL with no content hash
- Pin `type=gha`'s version; share one cache scope; re-add `actions/cache`
- Let nginx pass a client's correlation id; log outside the envelope

### The gate and the workflow

- Move db-marked tests out of the gate
- Index a branch's commits in a pull request body
- Let the comment classifier shrink a CI job; suppress the images refusal
- Compare the branch guard's paths as text; allow a target it cannot place
- Widen the bot exemption past an exact author name and email pair, or past the three rules it drops
- Let the gate write a formatted file; merge a partly-staged file's halves
- Collapse a refusal into a failure; move one half of the exit contract alone
- Release a command on one token; source the shared write-shape block rather than duplicating it in both bash guards
- Delete a shim re-export as unused; repoint a citation off it; name a package `check_docs`

## 8. Documentation

**Read [`rules-index.md`](../docs/_standard/rules-index.md) before writing a document or a comment** —
one line per rule, and for most rules the whole of it. A rule a line cannot carry also has a chapter
section; read that one before writing what it governs.

These bind every session, and are named here because the index arrives only after the first edit:

| Rule  | Apply it as                                                                                                                                              |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CUR-2 | A change invalidating a documented claim updates that document in the same commit.                                                                       |
| COR-6 | Cite by anchor — `` `<file> :: <symbol>` ``, a backticked repo path, a rule id or an invariant id. Never a line number.                                  |
| COR-3 | Name only what exists — no file, symbol or behaviour that is gone, no edit narration, nothing documenting an absence.                                    |
| COR-2 | Say it once. State a claim in full at its one home; mention it again only where a reader standing there needs it, as the claim briefly plus the rule id. |

**Record a decision where it will be read** — a comment of 250 characters or fewer at the line it
constrains, a §7 line, or a spec-sheet invariant, chosen by which failure it prevents. The full
argument goes in the closing commit body, which `scripts/check_commits.py` enforces.

In code — `fl_frontend/src`, `fl_backend/app`, `fl_backend/tests`, `scripts/` and `.claude/hooks/`,
which is chapter 2's scope — a comment carries why, never what the line does and never a type
(INC-1); every FastAPI endpoint gets a docstring (INC-4), bounded like any other comment. **A module
header survives in a shell script, and in a Python `app/` or `scripts/` module whose fact attaches to
no symbol — nowhere else** (INC-2). The hooks are exempt from INC-2's shape alone; every other rule in the
chapter binds them.

**`--docs` runs `scripts/check_docs.py` over `/docs`, over source comments, and over the
configuration files scanned beside them (INC-6).** CUR-5's table is the one place its checks are
listed. Corpus entry point: [`docs/README.md`](../docs/README.md).

## 9. Commands

Registered in `.claude/commands/`, tab-completable, **slash-only — never launch one from prose.** Behaviour lives in those files.

| Command               | Does                                                                         |
| --------------------- | ---------------------------------------------------------------------------- |
| `/audit:*`            | Audit programme lifecycle                                                    |
| `/roadmap:start <ID>` | Work one open item to a conclusion                                           |
| `/roadmap:add`        | Turn described items into ranked roadmap entries, then re-rank the file      |
| `/docs:audit`         | Sweep every document and comment against `docs/_standard/`; `fix` applies it |
| `/docs:audit-pr`      | Audit and fix the branch's documentation slice before its pull request       |
