# Workflows

**Verified against:** `e73cc01`, 2026-08-02
**Scope:** how work gets from an idea to production, and the recurring operational tasks

Cross-cutting, like the glossary — this belongs to no single surface. Its sibling
[`message-templates.md`](message-templates.md) holds the copy-paste forms for everything this page
argues about; keep the reasoning here and the shapes there.

Everything below the "Assessment" heading is **observed from git history and the scripts**, not invented.
Where something is a recommendation rather than current practice, it says so.

---

## The shape of the work

```mermaid
graph LR
    b["branch off main"] --> c["commit"]
    c --> v["./scripts/verify.sh"]
    v --> pr["pull request"]
    pr --> m["merge to main"]
    m --> p["./scripts/publish.sh<br/>(dev machine)"]
    p --> d["./scripts/deploy.sh<br/>(server)"]
```

Two properties of this pipeline are deliberate and worth stating up front:

- **Images are built on the development machine, never on the server.** A server that builds is a
  server that can fail a build — at the worst moment, with the site down.
- **Merging does not deploy.** Publishing and deploying are separate manual steps. There is no
  automation between `main` and production.

---

## The cycle, command by command

The whole loop, in the order you actually type it. Everything below is dev (Windows, Git Bash)
except where marked; the sections after this one explain _why_ each step is shaped as it is.

```bash
# 1 — start from a current main, always
git checkout main
git pull --ff-only origin main
git checkout -b short-kebab-name
```

```bash
# 2 — work, then commit. Small commits, each with a real body (see Commits below)
git add -A
git commit          # opens the editor; a one-line -m loses the part that matters
```

```bash
# 3 — the gate, before pushing. Not --quick if you touched config, auth,
#     instrumentation or packaging
./scripts/verify.sh
```

```bash
# 4 — push and open the PR
git push -u origin short-kebab-name
```

`gh` is deliberately not installed, so the pull request is created in the browser — the push prints
a `pull/new/…` link straight to the form. Title and body follow
[`message-templates.md`](message-templates.md). Merge it there with the **merge commit** button, and
delete the remote branch when GitHub offers.

```bash
# 5 — bring the merge back down and clean up
git checkout main
git pull --ff-only origin main
git branch -d short-kebab-name
```

**`--ff-only` is the point of step 5.** Because every change reaches `main` through GitHub, your
local `main` is only ever strictly behind — a fast-forward is always possible. If it somehow is not,
`--ff-only` refuses instead of silently inventing a merge commit, which is exactly the moment you
want to stop and look. `git pull` without it would paper over the surprise.

`git fetch` followed by `git reset --hard origin/main` reaches the same place and is what you want
only when local `main` has drifted and you are certain it holds nothing of value. It discards
without asking; prefer `--ff-only` and let it fail.

### When a push to `main` is rejected

```
! [remote rejected] main -> main (push declined due to repository rule violations)
```

That is the ruleset working, not a problem: `main` takes changes only through a pull request with a
passing `verify`. If you have already committed to local `main`, nothing is lost — move the commits
onto a branch and rewind:

```bash
git branch short-kebab-name        # mark the commits
git reset --hard origin/main       # rewind main to the remote
git push -u origin short-kebab-name
```

Then open the PR as usual. The commits are intact on the branch; only the branch pointer moved.

---

## Branching

`main` is the only long-lived branch. There is no `develop`, no release branches, and no long-running
feature branches.

Work happens on **short-lived topic branches cut from `main`**, named in kebab-case for the change
itself:

```
wave-8c-config
prettier-allowlist-scope
publish-prune-local-sha-tags
ledger-fix-part6-section-lists
```

**No prefix taxonomy** — no `feature/`, `fix/`, `chore/`. The name describes what the branch does.

That works because branches are short-lived and there is one maintainer; a prefix scheme earns its keep
when many people scan a long branch list, which is not this repo.

---

## Commits

The convention is consistent across the whole history and is **not** Conventional Commits.

### Subject

```
Scope: what changed
```

Sentence case after the scope. The scope is a real area of the codebase — `Frontend`, `Backend`,
`Ops`, `Docs`, `Repo`, `Brand`. Real examples:

```
Frontend: named component exports, and one folder rule for all of them
Backend: pick up the resolved dependency upgrades
Brand: the header mark gets the full treatment, not the clean one
Ops: ghcr publishing needs a classic token, and the failure is misleading
```

Note the frequent two-clause subject joined by ", and" — one commit, two related changes, both named.

### Body

**This is where the real documentation lives, and it is unusually good.** Bodies are prose, wrapped at
roughly 76 characters, organised into paragraphs each led by the area it concerns:

```
Cache tags (D2). Twenty granular tags were constructed across eight query
modules and not one was ever invalidated -- the code read as though targeted
invalidation worked, and nothing used it. The two that a mutation can actually
reach are kept and now wired up: ...

Client boundaries. Three view components dropped a "use client" that bought
nothing -- none has a hook or a handler, and their interactive children declare
their own boundaries ...
```

What makes them work, and what to keep doing:

- They explain **why**, not what. The diff shows what.
- They record **what was verified and how** — "Verified in the browser: six items with correct hrefs,
  three labelled sections, and ArrowDown moves focus."
- They record **where a prior assumption turned out to be wrong** — "R3a warned this might not work
  because the collection API could need client-rendered descendants. It does work ..."
- They name the rejected alternative when there was one.

No issue-closing keywords and no emoji. No trailers either, with one exception: assistant-authored
commits carry a `Co-Authored-By:` line as their last line.

**Copy-paste form: [`message-templates.md`](message-templates.md).** That page holds the shape; this
one holds the reasoning.

> **Since 2026-08-01, one rule constrains commits:** a change that invalidates a documented claim
> updates the doc **in the same commit**. That is the only mechanism preventing documentation drift, and
> it lives in CLAUDE.md §10.

---

## Pull requests

Every change reaches `main` through a PR, merged with a **merge commit** — `Merge pull request #46 from
felzab/wave-8b-naming`. Not squash, not rebase.

That is the right choice here **because the commit bodies are the documentation**. Squashing would
collapse several carefully-written bodies into one and lose the structure; rebasing would discard the
merge point that groups them.

### Titles and bodies

> **Not directly verifiable from the repository.** PR titles and bodies live on GitHub, and `gh` is not
> installed on this machine. What follows is derived from the commit convention, which the PR should
> match — treat it as the standard rather than as an observation.

**Title:** the same shape as a commit subject — `Scope: what changed`. For a single-commit PR, use the
commit subject verbatim.

**Body:** for a single-commit PR, the commit body already says it; a short pointer is enough. For a
multi-commit PR, summarise at the level the commits do not — what the branch achieves as a whole, and
anything a reviewer should check first.

Worth including, because this repo's history shows they matter:

- **What was verified, and how.** Especially for anything the type checker cannot see: RSC boundaries,
  cache invalidation, rendered output.
- **Anything deliberately left undone**, and why.
- **A link to the ADR** if the change touches a ratified decision.

Do not restate the diff.

**A PR body must stand alone.** `docs/audit/` is gitignored, so a reviewer sees none of it — never
point at anything under it from a body. Open items live in [`docs/roadmap/open-items.md`](../roadmap/open-items.md).

**Copy-paste form: [`message-templates.md`](message-templates.md)**, which also covers issues.

---

## The verification gate

```bash
./scripts/verify.sh
```

Runs cheapest-to-fail first: script self-checks, then `pnpm verify` (types, lint, formatting,
`next build`, unit tests), then `pnpm audit:prod`, then **ruff and pytest for the backend**, then both
image builds, then a check that `instrumentation.js` survived into the frontend image.

`--quick` skips the image builds and is **not sufficient** before a merge touching
`src/core/config.ts`, `src/core/auth.ts` or `src/instrumentation.ts` — those are where packaging
problems live.

CI runs the same script — `.github/workflows/verify.yml`, `--quick` on pull requests and the full gate
on pushes to `main`.

That workflow carries a **second job**, `backend-db`, running the backend tests that need a real
`mongod` ([ADR-0030](../_decisions/0030-a-real-mongod-behind-a-deselected-marker.md)). It is not part
of `verify.sh` and runs concurrently, so it adds nothing to how long a pull request waits.

> **`pnpm format` reaches outside `fl_frontend`, via a hardcoded list of paths.** It currently covers
> `../docs`, `../scripts`, `../.claude`, `../.github`, `../README.md`, `../SECURITY.md`,
> `../CONTRIBUTING.md` and both compose files. Moving, renaming or adding a root-level file therefore
> requires editing `fl_frontend/package.json` — and a path that no longer exists makes Prettier exit 2,
> which fails the whole gate. Moving `CLAUDE.md` into `.claude/` broke `main` exactly this way.
>
> **Verify with `./scripts/verify.sh --quick`, never with a hand-written `prettier` command.** Running
> Prettier directly on the paths you happen to remember is what let that breakage through.

> **When bumping an action version, verify the tag exists by fetching
> `https://raw.githubusercontent.com/<owner>/<repo>/<tag>/action.yml`.** A 404 means the tag is not
> there. Release _pages_ render dynamically and summarise unreliably; the raw file is unambiguous.
> This is not hypothetical — the first CI run failed instantly on `astral-sh/setup-uv@v9`, a version
> that has never existed, taken from a bad reading of a release page.

Full detail: [`../scripts/README.md`](../../scripts/README.md).

---

## Repository settings

**Configured 2026-08-01, and written down because nothing else records them.** Repository settings
live only in GitHub's UI: they are unversioned, invisible in a checkout, and **deleting a repository
destroys them** — which is not hypothetical here, since recreating the repo during the history
rewrite reset every one of them to its default. This section is the checklist that restores them.

### Merging

Only **merge commits** are enabled; squash and rebase merging are switched off in
Settings → General → Pull Requests. That is not a preference — squashing collapses the carefully
written commit bodies that are this repository's most valuable artifact, and a single accidental
squash-merge destroys them irreversibly. Disabling the option is what makes the convention
enforceable rather than merely documented.

### Ruleset on `main`

Settings → Rules → Rulesets, one branch ruleset targeting the default branch, enforcement **Active**.

| Rule                                  | Setting                        |
| ------------------------------------- | ------------------------------ |
| Restrict deletions                    | on                             |
| Block force pushes                    | on                             |
| Require a pull request before merging | on, **required approvals `0`** |
| Require status checks to pass         | on, check: **`verify`**        |
| Require linear history                | **off**                        |
| Bypass list                           | **empty**                      |

Three of those are counter-intuitive and must not be "corrected":

- **Required approvals stays at `0`.** A single maintainer cannot approve their own pull request, so
  any value above zero blocks every merge permanently.
- **Linear history stays off.** It forbids merge commits, and with squash and rebase already
  disabled, enabling it would leave no permitted merge method at all.
- **The bypass list stays empty.** The accident this guards against — a force-push to `main` — is
  the maintainer's own. To perform a deliberate history rewrite, set the ruleset to **Disabled**, do
  it, and re-enable; that two-step is the intended escape hatch.

`verify` is the only required check. CodeQL deliberately is **not** required: it reports two checks
and an upstream query-pack problem would block merges for a reason unrelated to the change.

### Actions

Settings → Actions → General:

- **Actions permissions** — GitHub-authored actions allowed, plus an allowlist for the two
  third-party ones in use: `pnpm/action-setup@*` and `astral-sh/setup-uv@*`.
- **Every action is pinned to an exact version**, never a floating major tag. A `@v7` tag moves
  under you: what CI executed last week is not necessarily what it executes today, and the window
  where a repointed tag changes your build is exactly the supply-chain risk pinning closes. The
  trade accepted in return is that upstream patches no longer arrive on their own — they arrive as
  a Dependabot pull request, which is what makes the pins sustainable rather than a thing that
  rots. **When adding an action, pin it and verify the tag exists** by fetching its raw
  `action.yml` (see the note under the verification gate).
- **Fork pull request workflows** — _require approval for all outside collaborators_. On a public
  repository anyone can fork and open a pull request; without this, a stranger's first PR runs
  workflows unreviewed. Both workflows trigger on `pull_request` rather than `pull_request_target`,
  so a fork's run receives no secrets and no write token — keep it that way.
- **Default workflow permissions** — read-only, and Actions may not create or approve pull requests.
  Both workflows declare their own `permissions:` block, but a future one that forgets inherits this.

### Security

Settings → Security → Advanced Security:

- **Secret scanning** and **push protection** — on. Note the limit: these match known provider token
  formats, so they will not catch `INTERNAL_API_KEY_*` or `AUTH_SECRET`, which are arbitrary
  strings. What protects those is `.env*` being gitignored and excluded from both Docker build
  contexts.
- **Dependabot alerts** and **Dependabot security updates** — on. These are separate from
  `.github/dependabot.yml`, which governs only routine monthly version updates; without these
  toggles a published advisory produces no notification at all.
- **Code scanning** — configured entirely by `.github/workflows/codeql.yml` (advanced setup). **Do
  not use the "Set up" button**: it writes a second, competing default configuration through the web
  editor. The workflow file is the enablement.

**Dependabot version updates need no toggle** — the presence of `.github/dependabot.yml` on the
default branch is what enables them, which is why that settings entry links to the file instead of
offering a switch.

---

## Deployment

Three commands, two machines.

| Step                         | Where         | Command                           |
| ---------------------------- | ------------- | --------------------------------- |
| See it as production sees it | dev (Windows) | `./scripts/local.sh`              |
| Build, tag, push both images | dev (Windows) | `./scripts/publish.sh`            |
| Pull and restart             | prod (Linux)  | `git pull && ./scripts/deploy.sh` |

`local.sh` runs the **production image** behind nginx on your machine. It is the only place a packaging
problem — a missing standalone file, a failing startup env gate, a header that nginx does not set — is
visible before a deploy.

`publish.sh` **builds both images before pushing either**, so a failed backend build cannot leave
production able to pull a frontend that expects it. It refuses a dirty working tree by default: a tag
naming a commit must be rebuildable from that commit.

`deploy.sh` never builds. It checks the files nginx mounts, pulls, records the currently-live commit,
recreates the containers **in place** so the interruption is seconds rather than a full outage, waits
for health, and confirms the live security headers. nginx waits on the frontend's health, so an
unhealthy deploy is never served.

### Rolling back

```bash
./scripts/deploy.sh --status        # what is live, and from which commit
./scripts/deploy.sh sha-1a2b3c4     # go back to a published build
```

The `commit` line comes from the image's own OCI label, not the tag name — a tag can be moved, a label
cannot. Rollback works by pulling a pinned `:sha-<commit>` tag, so **the registry is the rollback
mechanism**; keep roughly the last five `sha-` tags in each package (ADR-0017).

### The server

**The repository does not record which host this is**, and deliberately holds no credentials. What it
does tell you: `deploy.sh` refuses to run anywhere but Linux, runs from a checkout of this repo on the
server, and expects `./certs/` and `./nginx/prod.conf` to exist beside the compose file. Getting onto
the machine is outside the repo.

---

## Operational workflows

### After editing seasons, players or matchdays directly in MongoDB

```bash
./scripts/revalidate_reference_data.sh saisons
```

Those three resources have no write path, are cached for a day, and nothing invalidates them
automatically. Forgetting is not harmful — the cache expires within 24 hours regardless.
See [ADR-0015](../_decisions/0015-backend-triggered-revalidation-route.md).

### Before any hand edit that a code change depends on

```bash
./scripts/deploy.sh --status        # what is LIVE, and from which commit
```

**Order a data change against the deployed image, never against `main`.** Merging is not deploying
here — the two are separated on purpose — so `main` routinely describes a service that is not running,
and a migration reasoned about from the checkout can be correct in the repository and destructive in
production.

That is not hypothetical. On 2026-08-02 the `statistik` field was `$unset` from all 17 `saison_teams`
rows, which was safe because the league table had become a derivation
([ADR-0026](../_decisions/0026-team-statistics-are-derived-from-spiele.md)) — safe in `main`. The live
image was a day older and still projected `$saison_data.statistik`, so every team document lost a
required field and `GET /teams` returned 422 until the pending deploy was made.

The direction differs per change, which is why the status command matters more than a rule of thumb:

| The edit                                | Order                                                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Removes something the old code reads    | **Deploy first**, then edit — as `statistik` should have been                                                          |
| Must be true before the new code starts | **Edit first**, then deploy — as DB-2's constraints were, since a unique index cannot build over data that violates it |

### Before deploying a change to the database's constraints

```bash
cd fl_backend && .venv/Scripts/python -m app.core.constraints --check
```

Dev (Windows; on the server it is `python -m app.core.constraints --check` inside the backend
container). Writes nothing. It reports every document the validators would reject, every key group that
would stop a unique index building, and whether the database user may run `collMod` at all — which
`readWrite` and `readWriteAnyDatabase` do not grant, though both grant `createIndex`.

Run it whenever `fl_backend/app/core/constraints.py` changes, because the constraints are reapplied on
**every boot** and **a failure is fatal**
([ADR-0027](../_decisions/0027-the-database-enforces-its-own-invariants.md)). A validator that no longer
matches the data does not degrade the service; it stops the container coming up, and nginx then waits
on a health check that never passes. Exit 0 means clean.

`--apply` does the same work startup does, which is how to put a corrected constraint in place without
waiting for a deploy.

### After changing anything about the brand mark

```bash
cd fl_frontend && pnpm brand
```

Regenerates the favicon, app icons, both manifest sets, the Open Graph card and the `FLLogo` component
from one parameterised source. **Re-run it rather than editing any of its outputs**, or the header mark
and the icons drift apart.

### Granting or revoking admin access

Admin is an **email allowlist**, not a stored role: `ALLOWED_ADMIN_EMAILS` in `fl_frontend/.env`.
Changing it requires a restart, because the environment is validated at boot.

**Revocation is not immediate.** There is no in-app sign-out, so an existing session survives until it
expires — 8 hours. To revoke now, delete the session row from the `authjs` database.

### Season rollover

> **Derived from the data model, not from an observed rollover.** There is no write path for seasons
> (open item BE-4), so this is done directly in MongoDB and is not covered by any script or validation.

A new season needs, at minimum:

1. A `saisons` document whose `_id` is **exactly four characters** — every `saison_id` referencing it is
   constrained to that length, and a longer id breaks every match and matchday pointing at it.
2. Its `status` set to `active`, and the outgoing season moved off `active`. Exactly one active season
   is assumed; nothing enforces it.
3. A **`saison_teams` junction row per participating team**, carrying `gruppe` and `is_disqualified`.
   A team with no row for the season disappears from that season's results entirely — the join is
   strict. No `statistik`: the league table is derived from the season's matches
   ([ADR-0026](../_decisions/0026-team-statistics-are-derived-from-spiele.md)), so a new season starts
   at zero without anything being written.
4. **A junction row for the "TBD" placeholder team**, which is easy to miss and is one of the reasons
   the placeholder is a known modelling flaw (open item BE-9).
5. `spieltage` documents with `order_val` set — the bracket orders by that, not by date.

Then run the revalidation script for `saisons` and `spieltage`.

### Certificate renewal

Certificates are mounted read-only from `./certs` on the server. **Renewal is outside this repo** and is
not scripted here.

---

## Assessment: is this best practice?

The user-facing question is whether these workflows are _right_, not just what they are. Honestly:

### What is genuinely good

**The commit bodies.** They record why, what was verified, and where an earlier assumption was wrong.
That is better than most commercial repositories manage, and it is the single most valuable artifact in
the history.

**Building on dev, never on the server**, and building both images before pushing either. Both remove a
class of failure that hurts most when you can least afford it.

**In-place container recreation** rather than down/up, so a deploy costs seconds of interruption.

**Rollback by pinned tag, verified from the image's own label.** Reading what is live rather than
recalling it is the correct instinct.

### The gap that was closed, and the one that replaced it

This section used to read "nothing runs the gate": `verify.sh` was thorough and entirely manual, with
no CI of any kind. **That is fixed** — `.github/workflows/verify.yml` runs the same script, `--quick`
on pull requests and the full gate on pushes to `main`, so a tired evening merge that skipped it is
no longer indistinguishable from one that did not.

**The residual is enforcement rather than execution.** CI _runs_ on a PR; nothing _requires_ it to
have passed before the merge button works. That is a branch-protection rule on `main` (require the
status check, and require a PR), and it is worth setting up — particularly now, since the repository
was deleted and recreated during the 2026-08-01 history rewrite, which discards any protection rules
that existed before.

### What is fine as-is, and should not be "fixed"

**No Conventional Commits.** `feat:`/`fix:` prefixes buy automated changelogs and semantic versioning.
This is a website with no released artifact and no consumers to notify. The prose bodies here carry far
more than a machine-readable prefix would, and adopting the convention would add ceremony for nothing.

**No branch prefixes.** See Branching — they earn their keep at a scale this repo is not at.

**Merge commits rather than squash** — and the reason is worth restating whenever it is questioned:
squashing would collapse several carefully written bodies into one.

**Manual deploy rather than continuous deployment.** Deploying on merge would remove the deliberate
gap between "merged" and "live" — and for a site whose owner is also its only operator, that gap is
worth more than the automation.

### One assessment that was reversed

Until 2026-08-01 this page argued **against** message templates: with one maintainer and bodies this
consistent, a template would be filled in from habit rather than read. That reasoning was sound for
a private repository and stopped being sound when this one went public — the audience for an issue
form is people who have never read any of this. [`message-templates.md`](message-templates.md) is
the result. It stays a reference you copy from rather than a form GitHub enforces, which keeps the
original objection answered for the PR case while serving the new audience for the issue case.
