# Frankfurt-League — assistant rules

You are a senior full-stack engineer on a soccer league site. Response style comes from the
machine-local `~/.claude/CLAUDE.md` and this file does not change it.

**Be 95 % sure of the design and the process before you implement, and reach that by checking
rather than recalling** — the file at `HEAD` rather than a working tree another agent is editing,
what the virtualenv or `node_modules` holds rather than what a manifest declares, what a commit
recorded rather than what you remember of it, whether the thing you are about to argue against
still exists, the official documentation, or the owner's answer. An unchecked premise is built on,
briefed onward, and paid for in full when it is finally caught.

**Precedence, highest first:** §1 security · §2 branch-before-edit · an explicit owner instruction
given this session · §7 ratified decisions · every other rule here.

- **Check §7 before calling anything a violation.** Every clause there reads as a defect and is
  deliberate.
- **Resolve a disagreement between written sources with PRE-1's ladder** — the code, then the spec
  sheet, then this file, then an overview. Correct the loser in the same commit (PRE-2). Where no
  written source settles it, ask rather than pick a side.

Corpus entry point: [`docs/README.md`](../docs/README.md). **The domain vocabulary is German and
load-bearing** — `Saison`, `Spieltag`, `sonderereignis`, `austritt`, `quelle` — and §7 and the spec
sheets assume [`docs/glossary.md`](../docs/glossary.md), which carries the trap in each term.

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

`.claude/settings.json` denies the file tools on the common secret paths, and a `permissions.deny`
entry never reads a shell command line. Of the guards that do (§9), one refuses on credential
grounds and it refuses one command — the compose subcommand that renders every `env_file` — and the
branch guards' credential-name refusal stands down off `main`, which is where the work happens.
**On a shell route this section is the control.**

## 2. Branch before you edit — the first action of any task that writes

**The trigger is the task, not the write. If the task could end in an edit, branch before the first
read.** Nobody disputes the rule; the drift is starting out "just looking", judging each read
harmless, and being three edits deep on `main` before it occurs to you.

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
  `scripts/check_commits.py` refuses one, but only at the gate — by then a reword means a rebase.

Commit shape, the merge method, the full table of which `gh` invocations are yours, and the pull
request form are in [`docs/_git/spec.md`](../docs/_git/spec.md) and
[`templates.md`](../docs/_git/templates.md) — read them rather than recalling them.

**Every task ends the same way:** branch, implement, run the gate at its scope, commit to
`docs/_git/templates.md`'s form, `git push -u origin <name>`, open the draft pull request. Reviewing
it, marking it ready and merging are the owner's, and so is the `git checkout main && git pull`
after. **Work is finished when it is committed, pushed, and the draft pull request's link is in the
response.** Not when it compiles.

### The gate

**Run `./scripts/verify.sh` before pushing, at a scope covering every surface the branch touched.**
Never derive that scope by hand. Ask:

```bash
python scripts/check_scope.py --ran ""
```

It reads the branch's diff through `scripts/ci_scopes.sh`, applies the comment-only carve-out
itself, names the files driving each requirement, and prints every scope the diff asks for.
`verify.sh` runs the same check against whatever you did run, so asking first is how you avoid
paying for a wrong run. A bare `verify.sh` is the full form and runs every scope;
[`docs/ops/spec.md`](../docs/ops/spec.md) §1.6 holds what each one runs and needs.

- **The image build is the expensive scope and the only hard refusal.** A Dockerfile, a lockfile,
  `fl_backend/pyproject.toml`, `fl_backend/.python-version`, `next.config.ts`, `src/core/config.ts`,
  `src/core/auth.ts` and `src/instrumentation.ts` each pull it in. Budget for it before you start.
- **A comment-only edit is a documentation change, whatever file holds it** — but the carve-out
  reaches only as far as a parser does, so a `#` in a Dockerfile, a workflow or a shell script is
  code. The scope check draws that line from the real diff; never draw it from a file's name.
- **No formatter the gate runs writes a tracked file**; the one write outside that is `next build`'s
  to `fl_frontend/tsconfig.json`. Formatting happens at commit: `.githooks/pre-commit` formats the
  staged files, re-stages them, and names what it changed — read that before you push.
- **Write the commit message to `docs/_git/templates.md`'s form the first time.** `--docs` checks it,
  and a reword afterwards means rebasing a branch you have already pushed.
- **Report the actual exit code, and read it from the command whose code it is.** A status read
  through a pipe is the pipe's status: `verify.sh --docs | tail -5` reports `tail`'s 0 while the
  gate exited 1. Let the command finish, then read `$?`; never pipe a command whose status you
  need. Never the word "passing", and never a substitute chain — `check_docs.py --all` is not the
  `--docs` gate and has reported clean while the gate was red.

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
genuinely outside the task as a roadmap entry at once, and name it in the moment: the product page
is `docs/_roadmap/open-items.md`, the toolchain and corpus page `tooling-items.md`, and
[`protocol.md`](../docs/_roadmap/protocol.md) decides which.

**Verify the thing you changed, not the thing that is easy to verify.** A build never runs `CMD`; a
passing import never proves a request; a green suite on a configured machine never proves a clean
checkout. Name what was exercised and what was not.

## 4. Stack and versions

Next.js · React · HeroUI · Tailwind · FastAPI · Pydantic v2 · PyMongo · Docker Compose · nginx.

**Prefer the pattern the repository already uses** — it compiles and passes the gate, which beats
recall. Verify anything it does not already do against the official docs before writing it, and say
plainly where you could not.

### Consult `llms.txt` first, wherever a qualifying one exists

**Before answering anything about a library's API, and before writing a line that depends on one,
grep that library's `llms.txt`** — ahead of the prose docs and long before recall. An API claim made
without checking an available one is unverified; say so if that is what you are doing.

| Package      | Index                                                            | Full text                                                                           |
| ------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **HeroUI**   | [react/llms.txt](https://heroui.com/react/llms.txt)              | [react/llms-full.txt](https://heroui.com/react/llms-full.txt) — 5.4 MB              |
| **Next.js**  | [docs/llms.txt](https://nextjs.org/docs/llms.txt)                | [docs/llms-full.txt](https://nextjs.org/docs/llms-full.txt) — 3.8 MB                |
| **Pydantic** | [llms.txt](https://pydantic.dev/docs/validation/latest/llms.txt) | [llms-full.txt](https://pydantic.dev/docs/validation/latest/llms-full.txt) — 1.9 MB |
| **Zod**      | [llms.txt](https://zod.dev/llms.txt)                             | [llms-full.txt](https://zod.dev/llms-full.txt) — 260 KB                             |
| **React**    | [llms.txt](https://react.dev/llms.txt)                           | — (index only)                                                                      |

- **A reference is authoritative only while it is official and current** — the project's own domain,
  never a mirror or an aggregator, with the installed version in it as a documented release. Where
  either fails, fall back to the prose docs plus the installed typings in `node_modules`, and say
  which you used. `node_modules` is what actually runs, so read the `.d.ts` wherever the reference
  and the installed package could disagree.
- **Use HeroUI's `react/` URL, never the bare `heroui.com/llms-full.txt`**, which merges in HeroUI
  Native, a React Native product this repo does not use.
- **Tailwind, FastAPI and Auth.js publish none**; PyMongo's is a topic index of unconfirmed
  conformance, so treat its prose docs as authoritative. **A package missing from this table has not
  been checked** rather than proven to have none — probe `<docs-root>/llms.txt`, and add the row when
  one turns up.

Prose docs where no `llms.txt` qualifies: [Tailwind](https://tailwindcss.com/docs) ·
[FastAPI](https://fastapi.tiangolo.com) · [PyMongo](https://www.mongodb.com/docs/languages/python/pymongo-driver/current/)

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
- **Drive local Docker only through `./scripts/local.sh`** (`--down`, `--fresh`, `--logs`). A bare
  compose invocation reads the production definition and comes up wired to the production database;
  a guard refuses it (§9).
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
- **A backend refusal and its German are two sites, and the second is easy to forget.** The backend
  declares a rule and its code in `fl_backend/app/core/domain.py`; a feature slice turns that code
  into words in its own `actions.ts`. A code no slice maps falls through to the 409 fallback in
  `fl_frontend/src/shared/utils/actionError.ts`, which tells the admin an equivalent entry already
  exists — a cause unrelated to the rule that fired. Most slices are held to this by a test reading
  `fl_frontend/src/core/refusalRegister.ts :: declaredCodes`; `spiele` and `spielorte` have no such
  test, so there the gate stays green and the wrong message ships.
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

**Read the group for the surface you are touching, in full, before you propose a change there** —
about half these clauses name no greppable identifier, so searching for one misses them. The order
inside a group carries nothing, and a semicolon joins clauses that stand or fall together.

**The argument for a line is in the commit that made it** — `git log -S` on the constraint it names,
or `git blame` from the line it governs; several rest on a measurement paid for once and recorded
there. A clause this short is easy to think wrong, and the moment a better solution suggests itself
is the moment the decision has already weighed it.

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

**Read [`docs/standard.md`](../docs/standard.md) before writing a document or a comment** — a rule
is one list line or one section, and COR-2 says each is stated in full once; read the section
governing what you are about to write. A hook emits the standard in full after the session's first
documentation-shaped edit, so the rules below are here for the edit before that one:

| Rule  | Apply it as                                                                                                             |
| ----- | ----------------------------------------------------------------------------------------------------------------------- |
| CUR-2 | A change invalidating a documented claim updates that document in the same commit.                                      |
| COR-6 | Cite by anchor — `` `<file> :: <symbol>` ``, a backticked repo path, a rule id or an invariant id. Never a line number. |
| COR-3 | Name only what exists — no file, symbol or behaviour that is gone, no edit narration, nothing documenting an absence.   |

**This file is inside the corpus `--docs` scans**, so CUR-2 binds it like any spec sheet: a change to
a hook, a scope mapping or a guarded path lands here in the same commit that makes it.

**Record a decision where it will be read** — a comment of 250 characters or fewer at the line it
constrains, a §7 line, or a spec-sheet invariant, chosen by which failure it prevents. The full
argument goes in the closing commit body, which `scripts/check_commits.py` enforces.

In code — `fl_frontend/src`, `fl_backend/app`, `fl_backend/tests`, `scripts/` and `.claude/hooks/` —
a comment carries why, never what the line does and never a type (INC-1), within one bound for every
shape (INC-9); every FastAPI endpoint gets a docstring (INC-4); a module header survives only where
INC-2 says. **`--docs` runs `scripts/check_docs.py` over `/docs`, over source comments, and over the
configuration files scanned beside them (INC-6)**, its checks registered in
`scripts/docs_gate/kernel.py :: CHECKS`.

## 9. Commands, and the guards that run without being asked

Commands are registered in `.claude/commands/`, tab-completable, and **slash-only — never launch one
from prose.** What each does lives in its own file: `/audit:*` for the audit programme lifecycle,
`/roadmap:start` and `/roadmap:add` for the ranked pages, `/docs:audit` and `/docs:audit-pr` for the
documentation sweep.

`.claude/settings.json` registers the hooks in `.claude/hooks/`, which act on their own before or
after a tool call. **A refusal or a question from one is a rule in this file arriving mechanically —
read it, comply with it, and never route around it.** Its text names the rule it enforces and the
route it allows, and that text is what binds; nothing about them is restated here, because you
receive it at the moment it applies. A guard that cannot parse a command refuses rather than guesses
— a heredoc whose text merely mentions what the guard watches for included — so **a multi-line file
goes through the `Write` tool, never a heredoc.**

The guards cite §1 and §2 by number, as do the commands, the audit prompts and the corpus for §6 and
§7, so **every section keeps its number.**
