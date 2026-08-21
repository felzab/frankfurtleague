# Tooling items

**Verified against:** `c6d7b8e8`, 2026-08-21\
**Purpose:** what is open on the toolchain, the gate and the documentation corpus, ranked — each entry carrying the analysis its decision needs

| Section                                               | Answers                                                  |
| ----------------------------------------------------- | -------------------------------------------------------- |
| [How this page is ordered](#how-this-page-is-ordered) | What produced the order, and what belongs here at all    |
| [What every entry carries](#what-every-entry-carries) | Which fields an entry states, and what each one may hold |
| [The path at a glance](#the-path-at-a-glance)         | Which items are open, and where each ranks               |
| [The items in rank order](#the-items-in-rank-order)   | Each entry in full, in the working order                 |

**Product work is on [`open-items.md`](open-items.md)**, and which of the two pages an entry belongs
on is [`protocol.md`](protocol.md)'s. **Look in [`closed-items.md`](closed-items.md) before
concluding that an id never existed.**

## How this page is ordered

**Reading top to bottom is the working order** — one ranked run, with nothing banded inside it. The
tests that produce that order, and what must never decide a rank, are in
[`protocol.md`](protocol.md#1-how-a-page-is-ranked): rank by what it costs to leave an item undone,
and let effort break ties toward the cheaper item.

Each entry keeps its full reasoning so the eventual decision is taken with the analysis in hand. Some
entries are seeded into an audit pass under `docs/_auditing/prompts/` as one of its starting checks;
where that holds, the entry's own `Path` line names the pass.

## What every entry carries

An entry is a `### <rank> · <ID> — <the problem, not the solution>` heading, then one metadata line
per field in the order below, then the analysis. **A field with nothing to say is an em dash, never
an absent line**, so an entry can be read down the same way every time.

| Field        | Holds                                                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**   | One value from the closed set derived below                                                                                                          |
| **Surfaces** | Which of FE, BE, DB, Ops and Docs the work would touch, in that order                                                                                |
| **Effort**   | **S** an afternoon · **M** a day or two · **L** a work package across several sessions · **XL** a programme touching data, schemas and UI end to end |
| **Path**     | What the entry blocks, and what blocks it                                                                                                            |

**A status is derived, never chosen**, by the first matching row of
[`protocol.md`](protocol.md#3-re-derive-every-status-not-just-the-one-you-touched) — which is also
where each value's meaning is fixed. A closure re-derives every entry's, not only its own, because
`Blocked` is a claim about another row.

## The path at a glance

| #   | ID     | Item                                                    | Surfaces    | Effort | Status   | Depends on |
| --- | ------ | ------------------------------------------------------- | ----------- | ------ | -------- | ---------- |
| 1   | OPS-64 | The whole API is on the internet, behind static keys    | Ops, Docs   | S      | Open     | —          |
| 2   | OPS-56 | The git stepper reads one `git`, on one line            | Ops         | S      | Open     | —          |
| 3   | OPS-61 | The commit hook's scratch is a path git cannot open     | Ops         | S      | Open     | —          |
| 4   | OPS-62 | A pin bump arms every page citing the workflow          | Ops, Docs   | S      | Open     | —          |
| 5   | OPS-29 | The docs gate is blind inside an embedded one-liner     | Ops, Docs   | S      | Open     | —          |
| 6   | OPS-11 | The compose guard cannot tell an invocation from a name | Ops         | S      | Open     | —          |
| 7   | OPS-63 | A comment claims two files hold one pattern, unchecked  | FE, BE, Ops | S      | Open     | —          |
| 8   | OPS-65 | An unused parameter is reported by no checker here      | FE, Ops     | S      | Open     | —          |
| 9   | OPS-66 | The CSP's style directive is wider than it needs to be  | Ops, Docs   | S      | Open     | —          |
| 10  | OPS-60 | The gate's floor is one scope, and that scope is serial | Ops         | M      | Open     | —          |
| 11  | OPS-12 | Nothing checks a generated file against its generator   | FE, Ops     | S      | Open     | —          |
| 12  | DOC-9  | Pairs of audit checks hunt the same ground              | Docs        | S      | Open     | —          |
| 13  | DOC-2  | An enforcement claim is resolved in one direction only  | Docs        | M      | Open     | —          |
| 14  | OPS-19 | Both repository-wide linters re-read every file         | FE, Ops     | S      | Open     | —          |
| 15  | OPS-10 | The comment-only classifier costs a process per file    | Ops         | S      | Open     | —          |
| 16  | OPS-2  | Nothing validates the contents of a restored `.env`     | Ops         | —      | Standing | —          |
| 17  | OPS-3  | Crawler policy split between robots.txt and Cloudflare  | Ops         | —      | Standing | —          |
| 18  | DOC-3  | A rule pattern reaches less than the rule it enforces   | Docs        | —      | Standing | —          |
| 19  | DOC-4  | A stamp is required by a path and owed by a claim       | Docs        | —      | Standing | —          |

**No entry on this page blocks another**, which is why every `Depends on` cell is an em dash. What
each entry waits on that is _not_ an entry — a page, a decision, a scheduled audit pass — is on its
own `Path` line.

---

## The items in rank order

### 1 · OPS-64 — The whole API is on the internet, and the invariant one file away says it is not

**Status:** Open\
**Surfaces:** Ops, Docs\
**Effort:** S\
**Path:** Independent of every entry here, and **not startable by a session**: two values in `.env`
decide whether the candidate below is safe or fatal, and `.claude/CLAUDE.md` §1 puts that file beyond
reading. I confirm both first. Its own branch, and a watched deploy — the last paragraph says why.
OPS-66 edits the same file and could ride that deploy.

**`nginx/prod.conf` carries `location /api { proxy_pass http://backend:8000; }`, and nothing narrows
it.** No `allow`, no `deny` and no `internal` appears anywhere in that file. `docker-compose.yml`
publishes ports on nginx alone — neither application service carries a `ports:` entry, and that
file's own header states the invariant in terms: only nginx publishes ports, the applications are
reachable solely from inside `frankfurtleague-net`, and "anything nginx does not route simply does
not exist for the internet". Both halves are true at once, and they do not agree. **The block is the
one thing standing between the intended architecture and the deployed one.**

**What it reaches is the whole versioned API, not the read half of it.** `fl_backend/app/main.py`
mounts `READ_ROUTERS` and `WRITE_ROUTERS` under the same `/api/v{API_VERSION}/` prefix, so a prefix
match on `/api` takes both. The reads guard at router level with
`fl_backend/app/core/security.py :: verify_access_base`; every mutation router guards with
`:: verify_access_admin`, `fl_backend/app/api/schiedsrichter/admin_router.py` being the shape they
share; `:: verify_access_system` covers `/system/is_ready` and `/system/info`. Each is one static
shared bearer compared with `secrets.compare_digest`, and all three sit on the public side of this
block. So the exposed surface is every endpoint the service has, **the ones that write included**,
and what separates the internet from them is a shared secret rather than a route that does not exist.

**Nothing the site does needs the block.** `API_URL` is declared in the `server` half of
`fl_frontend/src/core/config.ts :: frontend_config`, whose `client` object is empty, and
`fl_frontend/src/core/api.ts` opens with `import "server-only"` — so no browser is given the URL and
no bundle is given a key. `docker-compose.local.yml` sets `API_URL=http://backend:8000`, the Docker
network name, which is a call that never leaves the network. The three more specific blocks above it
— `= /api/client-error`, `/api/admin/` and `/api/auth` — proxy to Next rather than to FastAPI and are
public by design ([`docs/logging/spec.md`](../logging/spec.md)); a prefix match keeps them ahead of
this one, and none of them is what this entry is about.

**The sharpest consequence is that one key covers data of two different kinds.**
`fl_backend/app/api/schiedsrichter/schemas.py` carries `kontakt: FLKontakt` — an email address and a
telephone number — on a referee, and no public page renders it. It sits behind `verify_access_base`,
the same key as the fixtures and the league table every visitor is already shown. **The base key is
over-scoped**, and this block is what makes that matter: a key that protects nothing across most of
its surface is a key nobody handles as though it protects anything.

**The candidate fix is deleting that one block**, after which the backend has no route from the
internet and the keys become defence in depth rather than the only control. It stays a candidate
rather than a plan for the two reasons that follow, and the first of them is the larger.

**What stops it being a one-line deletion is that a documented remedy uses the block.**
[`docs/ops/spec.md`](../ops/spec.md) §3 answers the symptom "Uptime monitor shows green during a
backend outage" with "Monitor `GET /api/v0/system/is_live` through the edge instead" — and _through
the edge_ is this block. That path is deliberately unguarded:
`fl_backend/app/api/system/router.py` mounts at `/api/v{API_VERSION}/system` and `:: check_is_live`
declares no dependency, because the container healthcheck in `docker-compose.yml` calls it and a
liveness probe must not fail for a reason a restart cannot fix. **So the deletion removes an
operational recommendation, and CUR-2 makes settling that part of the same commit.** Two answers,
neither obviously right:

- **Drop the remedy** from `docs/ops/spec.md` §3. Then the only monitor available watches the edge's
  own status, which returns 200 while the backend is down — the exact failure that section exists to
  explain, restored by the change that closes the exposure.
- **Keep it, with an exact `location = /api/v0/system/is_live` block** ahead of the deletion. Then
  one endpoint stays public, chosen because it answers without a key and touches no database — and
  the version is pinned into `nginx/prod.conf` by hand, a third place after
  `fl_backend/app/core/config.py :: API_VERSION` and the healthcheck in `docker-compose.yml`, where
  §4 of that spec already records the hardcoded `/api/v0/` as open.

**This is the decision the entry is asking for**, and it is the larger half of the work: what the
site is willing to answer from the internet without a key, and what watches the backend once the
route it is watched through is gone.

**Two values decide whether the deletion is safe, and no session may read either.** Both live in
`.env`, which `.claude/CLAUDE.md` §1 puts off-limits to reading, summarising and every indirect route
alike — so this cannot be discharged from inside a session at any point, and **I confirm both before
the work starts**:

- **`API_URL`**, read by `fl_frontend/src/core/config.ts :: frontend_config`. The candidate holds
  only if production sets it to the internal `http://backend:8000`, the way
  `docker-compose.local.yml` does. If it is the public hostname instead, then every server-side read
  leaves the network and comes back through nginx, and deleting the block takes the site down.
- **`api_trusted_hosts`**, read by `fl_backend/app/core/config.py :: BackendConfig` and handed to
  `TrustedHostMiddleware` in `fl_backend/app/main.py`. nginx forwards `Host: $http_host`, so a
  request arriving through this block carries the public hostname while the frontend's own calls
  carry `backend:8000`. Whether that list holds the public hostname decides whether the exposed route
  answers at all today — the difference between an open hole and one already shut by a setting
  nothing records as the control.

**How it has to be worked, whichever way the design question goes.** It is an ops change, so the gate
is the full form with the images built ([`docs/ops/spec.md`](../ops/spec.md) §1.6). And an nginx
fault is not the class that fails a test: the config is mounted read-only, nginx waits on both
upstreams being healthy before it serves anything, and a bad block takes the site down rather than
turning something red. Its own branch, and `./scripts/deploy.sh --status` either side of a deploy
somebody is watching.

### 2 · OPS-56 — The git subcommand stepper reads one `git`, on one line

**Status:** Open\
**Surfaces:** Ops\
**Effort:** S\
**Path:** Independent. One expression carries both halves below, so they are one repair and one
re-measurement of `scripts/selfcheck.sh` step 13.

**The stepper the two bash guards share opens on `${padded#*[ /]git?(.exe) }`, and that one
expression is short on two axes at once.** It strips to the **earliest** occurrence of the program
and reads the word after it, so a second `git` later in the same command is never looked at. And its
delimiter class holds a space and a slash but **no newline**, so a `git` beginning a second line is
not the `git` the strip looks for at all: `tr -s ' \t' ' '` collapses runs of spaces and tabs ahead
of it and leaves every other whitespace byte alone. Either way no subcommand is read, and no other
arm of the shared block has anything to match. That block is byte-identical in
`.claude/hooks/guard-branch-bash.sh` and `.claude/hooks/guard-standard-bash.sh`, so both
guards lose the same thing.

**Measured 2026-08-12 by driving both hooks against a throwaway repository whose HEAD is `main`, and
reproduced independently the same day.** On each axis, all thirteen shapes the stepper's own table
names — its twelve subcommands, plus `checkout` with a pathspec — are released in both the plain and
the `.exe` spelling, twenty-six probes of twenty-six each time. The rows worth reading are the
ordinary ones:

```
allowed   git add -A && git commit -m x
allowed   git status && git reset --hard
allowed   git fetch && git rebase main
allowed   cd fl_backend\ngit commit -am wip
allowed   set -e\ngit reset --hard
allowed   echo one\necho two\ngit commit -am wip
denied    git reset --hard
denied    git commit -am wip && git status
denied    ls && git commit -am wip
denied    git commit -am wip\necho done
```

**The four denials are the controls, and each closes a different explanation.** The write refuses
alone. It refuses when it is the first `git` rather than the second, so what the occurrence axis
moves is which `git` is read. **Only a `git` shadows a `git`** — `ls && git commit -am wip` and
`cat notes.md && git commit -am wip` are both denied, because the strip lands on the real one — so
the leading command has to be git itself carrying a subcommand off the write table, which makes
`git status &&`, `git log &&`, `git diff &&` and `git fetch &&` the reachable prefixes rather than
any chain at all. And with the write on the first line the stepper finds it, so what the delimiter
axis moves is position rather than content.

**What this releases is not an exotic spelling.** `git add -A && git commit -m x` is the most
ordinary two-command shape there is, and `git status && git reset --hard` runs the one command
`.claude/CLAUDE.md` §2 names as never to be run. The branch ruleset is not the control behind it
either: that blocks the _push_, while what escapes here is local destruction of the working tree —
`git reset --hard`, `git clean -fd`, `git stash`, `git checkout -- <path>` — which no ruleset covers.

**A tab does not do this, and the difference says where the delimiter boundary is.** `echo start`, a
tab, and `git commit -am wip` is denied, because `tr` has already turned that tab into a space; a
carriage return is squeezed by nothing and behaves as the newline does. The class is short by
exactly the whitespace `tr` does not reach.

**On the standard guard both shapes hide a write into `docs/_standard/`, and that guard already
disagrees with itself about the newline.** Its interpreter arm is spelled with `[[:space:]]`, which a
newline satisfies, and the stepper above it is not:

```
asked     echo start\npython restamp.py docs/_standard/rules-index.md
allowed   echo start\ngit checkout -- docs/_standard/rules-index.md
allowed   git status && git checkout -- docs/_standard/rules-index.md
```

That guard runs on **every** branch, so neither half of this finding is bounded by `main`.

**Why it is filed rather than already fixed, and why as one entry.** The delimiter half is a
character-class edit, `[ /]` to `[[:space:]/]`, and it makes the standard guard's two arms agree. The
occurrence half is a walk over every occurrence in place of one strip — more code in a block that has
to stay byte-identical across two guards. Both sit inside the sentinel block `scripts/selfcheck.sh`
step 9 byte-compares, so each lands in both guards or in neither, and both move verdicts, so step
13's matrix is a re-measurement afterwards rather than a re-run. **Repairing them apart would measure
that matrix twice for one line of code**, which is why they are one entry.

**A sibling of OPS-29** — each a control reading one spelling of a thing that has several. The
distinction to hold on to is that the subcommand table here is complete and the stepper never
reaches it, which is the opposite of a guard whose vocabulary is genuinely short of a shape.

### 3 · OPS-61 — The commit hook builds its scratch at a path git cannot open

**Status:** Open\
**Surfaces:** Ops\
**Effort:** S\
**Path:** Independent. One line, and the idiom it needs is already written in `scripts/verify.sh` and
`scripts/selfcheck.sh`.

**`.githooks/pre-commit` takes its working directory from `mktemp -d`, which on Git Bash answers
with the MSYS alias `/tmp/tmp.XXXXXX`.** The hook then hands that path to `git hash-object -w`, and
Git for Windows cannot open it from a worktree — so the commit dies after prettier has already
reformatted and re-staged the files, leaving the index written and the commit unmade.

**Measured on 2026-08-12**, committing a merge resolution inside a worktree under
`.claude/worktrees/`:

```
pre-commit hook: prettier reformatted 3 file(s); staging them from the index:
fatal: could not open '/tmp/tmp.ax2X4kHqIt/formatted' for reading: No such file or directory
```

`mktemp -d` answered `/tmp/tmp.dcSn130oAT`; exporting `TMPDIR` to the Windows-native temporary
directory made the same commit succeed on the next attempt with nothing else changed. **That is the
whole diagnosis and the whole fix.**

**It fails loudly, which is the right direction, and it still blocks work** — a commit cannot be
made at all from a worktree until the caller happens to know about `TMPDIR`. The main checkout is
unaffected, which is why the ordinary commit path never shows it.

**The repair is `cygpath -w`**, which resolves the alias, and it is already how `scripts/verify.sh`
spells the pool's own shell and how `scripts/selfcheck.sh` builds its container bind. Every place
that hands a POSIX-looking path to a Windows binary owes the same resolution, so it is worth deciding
whether they should share one helper rather than a spelling each.

### 4 · OPS-62 — A version pin bump arms every stamped page citing that workflow

**Status:** Open\
**Surfaces:** Ops, Docs\
**Effort:** S\
**Path:** Independent. One classifier arm and a fixture pair; arguing the third immateriality test is
the larger half.

**`branch-impact` (CUR-4) fires on any change to a cited file, and a bot cannot answer it.** A
Dependabot pull request bumping a pinned action changes a workflow, so every stamped page citing that
workflow is asked to re-verify and restamp — work Dependabot has no way to do. Measured on
2026-08-12 against PR #108, which moves `github/codeql-action` from v4.37.4 to v4.37.6 and
touches nothing else: **two pages armed, `docs` exits 1, and no author of that change can clear it.**
It recurs on the monthly schedule.

**The pages cite the workflow for what it does, and name no commit.** A SHA moving with its version
comment cannot invalidate a claim neither page makes, so the rule is asking a human to confirm
something that did not change.

**The repository already answers this shape.** A restamp is not a material
change, and `scripts/docs_gate/branch.py :: _material` already dispatches to two immateriality tests
— `scripts/check_scope.py :: is_comment_only` for parseable source, and
`scripts/docs_gate/branch.py :: _stamp_only_delta` for markdown. **A third sibling is the fix**: a
delta where every changed line is a `uses:` pin whose action path is unchanged and whose version
comment moves with the SHA.

**Narrow it, or it is a hole rather than a carve-out.** The action path must be identical on both
sides — a different action is a different thing — and one changed line that is not such a pin makes
the whole delta material again. The fixture net needs both cases: a pin-only delta that is immaterial,
and a pin-plus-one-line delta that is not.

**Not a bot exemption, and the comment on the test should say why.** Deciding by author gets it
wrong in both directions: a human making the identical bump is still blocked, and a bot making a substantive
workflow change passes unchecked. **The question is what changed, not who changed it** — which is
also what keeps a human's identical bump answerable by the same rule.

**The residual risk, stated rather than hidden:** a major-version bump that alters behaviour a page
describes while touching only the pin line. That is the same risk the stamp-only test already
accepts, and it belongs to the review of the version bump rather than to a stamp on an unrelated page.

### 5 · OPS-29 — The documentation gate reads nothing inside an embedded node one-liner

**Status:** Open\
**Surfaces:** Ops, Docs\
**Effort:** S\
**Path:** Independent. **A rider on the next `scripts/docs_gate/` change** rather than a change of
its own, on the measurement below.

**`scripts/docs_gate/kernel.py :: comment_style` picks one comment reader per file, by suffix, and
cannot switch languages inside a file.** A `.sh` file gets the `#` reader and everything downstream
inherits it — `scripts/docs_gate/kernel.py :: comments_only`, `:: _scan_body`, and
`scripts/docs_gate/branch.py :: branch_additions`, which indexes into the scanned body by line
number, so a `//` line lands on an empty position and drops out. The content is not shortened, it is
absent. That same reader takes `.conf`, `.yml`, `.yaml`, `.toml` and any file with no suffix at all,
`Dockerfile` included.

**Measured on 2026-08-19 rather than reasoned.** Thirty-seven tracked files reach the `#` reader;
eleven carry a non-URL `//`; six of those are `.claude/hooks/*.sh` with genuine embedded JavaScript,
and they hold 59 `//` comment blocks no gate check has ever read. **A branch that adds `//`
comments to one of those files adds nothing `branch_additions` returns** — measured against
`.claude/hooks/guard-branch-bash.sh`, where every added `//` comment line is absent from it. No
standing figure goes with that half, because the count is a property of whichever branch is asked:
take it by diffing the file against the fork point and comparing its `//` lines against what
`branch_additions` returns.

**The citation half is the sharper one and has to be named on its own.** `check_added_citations`
(INC-6) sees none of that region, so a citation written inside one of those blocks can dangle
**silently and permanently** — nothing resolves it on a branch, and nothing resolves it in a standing
sweep either. One written there today would resolve or dangle unobserved either way, and nothing
would notice the day it stopped resolving.

**The length half is the quiet one, which is why it ranks under the other.** A breach there is
harmless until it is found and obvious once it is, and every one of those blocks sits inside INC-9's
three lines and 250 characters as of 2026-08-19. What the gap costs is therefore not a live breach
but the next block written over either bound: `check_comment_length` (INC-9) takes it in any other
file and has never measured this region at all. `check_history_phrases` (COR-3) and `check_counts`
(COR-4) are blind in the same region for the same reason.

**This sits outside the scope classifier's accepted boundary, and not marginally.** That boundary is
`scripts/check_scope.py`'s, and every limit it accepts errs toward _more_ checking:
what no parser can prove is code, so the full gate is demanded. Here unreadable means checked by
nothing and reported as nothing — a different module, a different check family, and the opposite
failure direction, so that boundary cannot be cited to accept it.

**What the change has to be scoped for.** INC-6's `Enforced by` names its checks over every tracked
TypeScript, JavaScript, Python and shell file, and for the embedded-JavaScript region of a shell file
that claim is false — a field claiming _more_ than the gate delivers, where DOC-2 records the
opposite direction. Teaching the shell reader to take `//` runs beside `#` runs is the expected fix.
The honest alternative is amending INC-6's `Enforced by` to say where its checks stop. **The outcome
to avoid is the third one** — leaving both the silence and the enforcement claim standing, which is
how the next dangling citation gets written into the one place a reader trusts most.

**What teaching the reader would newly raise is one advisory, not forty-three**, which is what makes
this a rider rather than its own change. Measured on 2026-08-12 by running the real checkers over a
body carrying only the `//` text of all ten files: rule-id, citation, line-citation, bare-path and
voice raise **nothing**, because the `//` blocks are clean and every citation in them
resolves; COR-3's `check_history_phrases` raises nothing; and COR-4's `check_counts` raises **one
advisory over three lines**. The reason is structural rather than lucky — COR-3, COR-4 and
`check_comment_length` all read `branch_additions`, so they cannot fire on a line no branch added,
and the over-length block named above surfaces only when somebody rewrites it.

### 6 · OPS-11 — The local-compose guard cannot tell an invocation from a mention

**Status:** Open\
**Surfaces:** Ops\
**Effort:** S\
**Path:** Independent — `scripts/selfcheck.sh` already drives this hook the way the hook runner does.

**`.claude/hooks/guard-local-compose.sh` matches the command as text.** It denies a shell command
containing `docker compose`, or `docker-compose` followed by a space, unless that same command also
names the local compose file. A search for the phrase and a heredoc writing it into a document each
contain it, so each is denied — with the message written for someone about to operate the production
stack by mistake. Both shapes were hit during the decision-record demolition on 2026-08-19: a grep
whose search pattern was the phrase, and a heredoc writing `.claude/CLAUDE.md` §5 — the repository's
own rule about that command, which cannot be stated without naming it. The second is the one to sit
with, because the refusal falls on the sentence that carries the rule.

**A false refusal costs more than the inconvenience.** A guard is worth obeying only while every
refusal it issues is worth obeying. One that fires on a command it has no business refusing invites
that command to be reworded rather than reconsidered, and a wording that gets around a false refusal
gets around a true one just as well.

**The escape is textual in the same way, and that half is a hole rather than a nuisance.** The second
`case` releases any command whose text contains `docker-compose.local.yml`, wherever it sits — in a
trailing comment, in an unrelated quoted argument, in a path the command never opens. So a command
that genuinely drives the production definition is allowed through by a mention of the local file it
is not using, which is the single outcome this guard exists to prevent. The refusal half is loud and
one command away from resolved; this half is observable only as a production stack that was operated
by mistake, and the hook's own header says there is no error to notice when that happens.

**What the narrowing has to preserve.** The branch guard is settled on the asymmetry: a false refusal
is one command away from resolved, while a hole is not observable
at all. The same asymmetry binds here, so the test to reach for is where the phrase sits rather than
whether it occurs. A match at a command position — the start of the command or the far side of a
separator, allowing a leading `sudo` or an environment assignment — still refuses
`docker compose --project-name x up`, which an allowlist of subcommands would let through.

**The repository already holds the shape both halves want.** `.claude/hooks/guard-branch-bash.sh`
splits the command into words and reasons about `words[0]` and `words[1]` rather than about the
string — it takes the program's basename and its subcommand, and reads path-like tokens out of the
argument vector. Deciding the same way answers both halves at once: the refusal fires only when the
invoked program is `docker` with `compose` first, or is `docker-compose`, and the escape fires only
when `-f` actually carries the local file as its value.

**Done when:** the guard refuses every invocation shape, allows a command that only names one, and
**refuses an invocation that names the local file somewhere other than a `-f` value**, with
`scripts/selfcheck.sh` asserting each. It already drives this hook for a bare invocation, for the
local file named, and for a command that is not compose at all, so the probes have a home; the third
assertion above is the one with no probe today.

### 7 · OPS-63 — A comment claims two files hold the same pattern, and nothing holds them to it

**Status:** Open\
**Surfaces:** FE, BE, Ops\
**Effort:** S\
**Path:** Independent — both files exist and the suite that would host a check already reads the
published document.

**The two ends of the wire are resolved against each other in exactly one place, and patterns are
outside it on purpose.** `fl_frontend/src/core/apiContract.test.ts` converts every exported Zod
schema to JSON Schema, pairs it with its component in the committed `fl_backend/openapi.json`, and
compares presence, required, nullable, primitive type and enum members.
`fl_frontend/src/core/apiContract.test.ts :: FieldFacts` states the boundary in terms: patterns,
lengths, bounds and messages are deliberately not compared, because the two sides diverge there by
design and comparing validation policy produces failures nobody can act on. **This entry does not
propose moving that boundary.**

**What nothing checks is a narrower claim, made in prose and legible from one side only.**
`fl_frontend/src/shared/schemas.ts` opens by stating that each schema there mirrors a constraint in
`fl_backend/app/shared/schemas/custom.py`, that looser makes the message a lie, and that a pattern is
outside the contract comparison entirely. That sentence is the whole written record of the
`PHONE_REGEX` pair, it is a comparison nothing performs, and it reads only from the frontend:
`fl_backend/app/shared/schemas/custom.py :: PHONE_REGEX` explains its own character class to whoever
edits it, and points at no twin.

**The two patterns agree today, and nothing holds them there.** They last diverged on the character
class: a literal space on one side against `\s` on the other, which in JavaScript absorbs a trailing
newline so `$` still matches. The frontend was the looser end, so the failure mode is a form
accepting a value the API answers with a 422 that nothing in the interface can explain, rather than
a bad value being stored — and it survived a review, a commit body asserting the two were identical,
and a contract test that does not look at patterns. **What makes it worth an entry is that the same
divergence can reappear the next time either side is edited, silently and in the same direction.**
The phone pair's blast radius is nil, since no referee holds a phone number at all, which is exactly
what would make a recurrence invisible.

**`hausnummer` is a second hand-mirrored pair, and it does not share that mercy.**
`fl_backend/app/shared/schemas/addresses.py :: HAUSNUMMER_PATTERN` and
`fl_frontend/src/shared/schemas.ts :: HAUSNUMMER_REGEX` are the two ends, each named on its own side
so the read model and the payload cannot drift within a side — and nothing compares them across the
wire, exactly as with the phone pair. The alphabets agree today, `\d` inside a JavaScript class being
`[0-9]`, but every club, venue and referee form carries a house number, so a divergence here is
visible to an admin on the first address they type. The prose record is weaker here than for the
phone pair: the mirroring comment names `custom.py`, where these two ends live in `addresses.py`, so
a reader following that comment never arrives at them.

**Three answers, and they are not equivalent.**

- **Check the declared pairs.** A list of `(python symbol, typescript symbol)` pairs whose patterns
  must be byte-identical, compared in the frontend suite that already reads across the boundary. It
  says nothing about the pairs not on the list, which is what keeps it inside that boundary.
- **Drop the claim.** Delete the mirroring sentence, let the two ends diverge like every other
  validation policy, and accept the 422 as the contract. Cheapest, and it gives up the one property
  that makes the frontend message trustworthy.
- **Generate one end from the other.** Refused for the mirror as a whole, and refusing it
  for one constant is the same argument at a smaller scale.

### 8 · OPS-65 — An unused parameter is reported by neither checker the frontend runs

**Status:** Open\
**Surfaces:** FE, Ops\
**Effort:** S\
**Path:** Independent — `fl_frontend/tsconfig.json` is the file, and the single site the flag reports
is named below.

**`fl_frontend/tsconfig.json` declares `noUnusedLocals` and leaves `noUnusedParameters` out, and the
lint rule beside it cannot cover the gap.** `fl_frontend/eslint.config.mjs` runs
`@typescript-eslint/no-unused-vars` with an underscore escape and takes that rule's default for
arguments, which reports a parameter only when nothing after it is read. A parameter a framework's
calling convention forces into the leading position is therefore invisible to both.

**Enabling it costs a single underscore, measured.** Running the installed checker over the project
with the flag on 2026-08-20 reported exactly one site:
`fl_frontend/src/features/auth/actions.ts :: handleSignIn`, whose `prevState` is required by
`useActionState`'s calling convention and read by nothing. TypeScript takes a leading underscore as
the escape, which is the spelling `fl_frontend/eslint.config.mjs` already configures, so the flag and
the rule would agree.

**What it is worth, and what it costs beyond the underscore.** It closes a class the toolchain
otherwise cannot see, and the class is small — the frontend holds no other unused parameter today. A
parameter kept for a calling convention is exactly the shape that has to be underscored to satisfy
it, and an underscore in front of `prevState` reads as "ignored" where the name is what says why the
parameter is there at all. Whether that trade is worth taking is the decision this entry asks for.

**Nothing else moves with it.** `next build` writes its suggested defaults into
`fl_frontend/tsconfig.json` for any key absent from `compilerOptions`, which is why `allowJs` is
declared rather than omitted. `noUnusedParameters` is not among the keys it writes — read from the
installed Next 16.3.0 on 2026-08-20 — so adding it neither collides with that pass nor has to be
defended against it.

### 9 · OPS-66 — The style directive concedes more than the reason recorded for it needs

**Status:** Open\
**Surfaces:** Ops, Docs\
**Effort:** S\
**Path:** Independent. An nginx change, so the gate is the full form with the images built
([`docs/ops/spec.md`](../ops/spec.md) §1.6) and the deploy is watched, for the reason OPS-64 gives.
It edits the same file as OPS-64 and could ride that same deploy.

**`nginx/prod.conf` sends `style-src 'self' 'unsafe-inline'`, and the narrower pair that serves the
same purpose is `style-src 'self'` with `style-src-attr 'unsafe-inline'`.**
[`docs/ops/spec.md`](../ops/spec.md) §1.4 records why the directive keeps the concession — a
runtime-computed inline `style` attribute, for which CSP offers neither a nonce nor a hash — and
records the narrowing as an nginx change rather than a documentation one. This entry is that change,
and what it needs first is a premise that page states more narrowly than the tree does.

**The premise needs re-measuring before a line is written.** That section states that nothing else in
the application sets an inline style attribute. `fl_frontend/src/shared/components/ui/FilterPanel.tsx`
sets one, carrying the custom properties its overlay's width is computed from; and the component
library sets one on every portalled overlay, react-aria's popover writing its resolved position and
its trigger width as an inline style. PRE-1 puts the code above the spec sheet, so that sentence is
the loser and moves in the same change (CUR-2). **None of it changes the candidate**, because
`style-src-attr 'unsafe-inline'` covers a style attribute wherever it comes from. What it changes is
the residual risk, the population under that directive being far larger than the page implies.

**The residual risk, stated rather than hidden, and unverified here (COR-9).** The narrowing rests
on a client applying `style-src-attr` in place of `style-src` to a style attribute; where a client
does not implement the attribute directive, the fallback leaves `style-src 'self'` governing
attributes as well — and on that client every overlay loses its computed position and the toast's
timer bar loses its duration. Neither the fallback rule nor the client population has been checked
at a source here, so confirming both is the work's opening step rather than an assumption inside it.

**What it buys.** `'unsafe-inline'` on `style-src` also admits an injected `<style>` element, which
is a real capability — exfiltration by attribute selector, and interface redress — on a policy whose
`script-src` half is already conceded and compensated by `react/no-danger`
([`docs/frontend/spec.md`](../frontend/spec.md) §1.8). Dropping the element half while keeping the
attribute half is the whole of the value. That the prerendered HTML carries no inline `<style>` block
is the spec sheet's claim rather than this entry's measurement, and it is worth re-checking beside
the one above it.

### 10 · OPS-60 — The gate's wall clock is one scope, and that scope runs serially

**Status:** Open\
**Surfaces:** Ops\
**Effort:** M\
**Path:** Independent. Its own branch — it touches the pool manifest, which carries the exit
contract.

**A parallel pool can never finish faster than its slowest member, and eight of the gate's nine
sections already fit inside the ninth.** Measured on 2026-08-12 at the full form with images:
scope 4.0s, **scripts 86s**, docs 12s, backend 17s, format 45s, frontend 57s, ops 2.8s, db 24s,
images 9.1s — 257s of scope-time in **91s** of wall clock, a 2.8x speedup, and only five seconds
more than `scripts` alone. **Parallelism is done; the remaining lever is inside one scope.**

**Where the 86s sits**, same run: `selfcheck` **52s**, `pytest` **30s**, pyright 2.4s, ruff 0.4s.
Both large halves are serial by construction — `selfcheck` drives 218 guard probes one at a time,
each spawning a shell, and the fixture net builds a throwaway git repository per case.

**Three levers, in descending measured value:**

- **Batch or parallelise the probe table.** The largest single cost, and the probes are independent
  by design.
- **Run the fixture net across cores.** `pytest-xdist` is the standard answer; the risk is that two
  workers write the same scratch repository, so isolation has to be proved rather than assumed.
- **Split `scripts` into two pool members**, so its halves run concurrently instead of in sequence.

**The estimate is half a day, and most of it is not the code.** Any change to how the probes execute
must prove no verdict moved: 218 probes, a before-baseline, a verdict-set diff, and a required zero.
`scripts/selfcheck.sh` also owns the four-code exit contract's classifier, so splitting the scope
re-opens that contract's eleven measured rank/finding/exit combinations.

**What it buys, and what it does not.** Taking `scripts` to roughly 55s takes the whole gate to
about 60s, at which point `frontend` at 57s becomes the new floor and the next lever is `next
build`. **OPS-19's linter cache buys nothing on wall clock** — it targets `format` at 45s, which is
already hidden inside `scripts`.

### 11 · OPS-12 — Nothing checks a generated file against the generator that owns it

**Status:** Open\
**Surfaces:** FE, Ops\
**Effort:** S\
**Path:** Independent — `fl_backend/openapi.json` already carries the pattern this extends.

**`fl_frontend/src/shared/components/ui/FLLogo.tsx` is written by
`fl_frontend/scripts/generate-brand-assets.mjs`, and what keeps them in step is a banner asking a
reader not to edit the file.** A hand-edit type-checks, lints and builds. It then survives until
somebody runs `pnpm brand` for an unrelated reason — a new icon size, a manifest entry — at which
point the generator overwrites it inside a commit whose subject says something else entirely. Every
other asset that script emits carries no banner at all: `icon.svg`, the favicon and the manifest
icons rest on the convention alone.

**The artifacts agree today.** What the generator emits for the component and what the repository
holds differ in whitespace alone — the script writes the filter primitives and the letter and
speed-bar rects one to a line, and the formatter expands them — so the mark that renders is the mark
the geometry produces, erosion filter included. This entry is about the missing check, not about a
divergence.

**The pattern exists already, on the other surface.** `fl_backend/openapi.json` is a committed
generated artifact whose freshness is a test: it regenerates the document and compares
(`fl_backend/tests/openapi_document.py`). What is missing here is not the idea but its application to
the generator on the other surface, which is why the effort is small.

**What keeps it from being free.** Only the text artifact compares cleanly. The images go through
sharp, whose output is not guaranteed byte-identical across versions, so a check that diffs them
fails on a dependency bump rather than on a hand-edit — and a check that fails for reasons unrelated
to the defect is one that gets suppressed. The honest scope is the emitted component, compared after
the formatter has run over each side so the comparison is about content rather than layout.

**Done when:** the frontend scope of the gate regenerates the component into a temporary location
and fails where it differs from the committed one, and the images are left to review with that
exclusion written down rather than assumed.

### 12 · DOC-9 — Pairs of audit checks hunt one another's ground, and only one pair has a boundary about it

**Status:** Open\
**Surfaces:** Docs\
**Effort:** S\
**Path:** Independent. A prompt is read at the start of a pass, so the repair lands whenever it is
made and pays nothing until a pass runs.

**Pairs of checks under `docs/_auditing/prompts/` ask for the same findings, and each pair fails
differently.**

**The frontend pair contradicts a boundary its own page states.**
`docs/_auditing/prompts/frontend/1-deprecated.md`'s dead-styling-vocabulary check hunts classes and
tokens resolving to nothing, tokens renamed out from under their users, and arbitrary values
duplicating a token. `docs/_auditing/prompts/frontend/6-styling-perf.md`'s token-discipline check
hunts arbitrary values duplicating or bypassing a token, tokens declared and consumed by nothing, and
shadowed or stale token names. That same page's boundary line hands "deprecated utilities and dead
styling vocabulary" to the pass above, so a check and the boundary under it disagree about who owns
the ground.

**The ops and crosscut pair has no boundary at all.**
`docs/_auditing/prompts/ops/1-build-deploy.md`'s gate-coverage check builds a required table of
failure classes against what catches each, naming the known residents of "by nothing" — cache-tag
wiring among them. `docs/_auditing/prompts/crosscut/1-contracts-and-seams.md`'s contract-enforcement
check builds a required table of seams against what would catch a regression today, and cache-tag
wiring is one of its own seams. Neither page's boundary section names the other, so the overlap is
invisible from either.

**Why it is worth a repair rather than a shrug.** A required table is required, so both passes fill
theirs and the same row is derived and reported in each — the duplication the remediation ledger then
has to notice, which [`docs/_auditing/lessons.md`](../_auditing/lessons.md) §7 records as the
ledger's own failure mode. A check duplicated across passes also splits the evidence for one finding
across reports nobody reads together.

**What the repair has to preserve.** A boundary line is how a pass knows what it is not, so the
answer is not simply deleting a check. What each pass needs is a lens: the frontend pair splits on
whether the vocabulary is _dead_ or merely _bypassed_, and the ops and crosscut pair splits on
whether a row is a failure class the gate could catch or a seam no single surface can see. Either
split is a sentence in each prompt, and both pages of a pair move together.

**Not decided:** whether `docs/_auditing/prompts/README.md` should carry a rule that every check
names its counterpart, or whether the boundary lines stay the only mechanism.

### 13 · DOC-2 — An enforcement claim is resolved in one direction only

**Status:** Open\
**Surfaces:** Docs\
**Effort:** M\
**Path:** Independent — a chapter's `Enforced by` field and the check it claims move in one change.

**`scripts/check_docs.py :: check_enforced_by` fails a rule naming a gate check that does not
exist, and nothing resolves the opposite direction.** A rule may omit a check that enforces it, and
a rule may state something a parser can decide while its field reads that it is unenforced. Either
shape leaves the field claiming less than the gate delivers, which is the reading nobody verifies —
and the field is where the standard says what is mechanically defended.

**The clear instance is `anchor`.** It is emitted in the same pass as `link`, over a markdown page
and over a source comment alike, and it is what resolves the heading a link's fragment names. INC-6
names `link` and stops there; COR-6 names `citation`, `path`, `rule-id` and `line-citation` and stops
there. A reader of either rule learns that a link's target is verified and never that its anchor is.
Most of what no rule claims defends the gate itself rather than a rule — its own registry, its
inputs, the repository's line endings — and that is correct, which is why this direction cannot be
closed by requiring every check to be claimed.

**The clear unenforced clause is OUT-7's.** It fixes what a diagram may be, and part of that is
decidable by reading the page: a fence naming a diagram language that is not mermaid, and a `[`
inside a quoted node label. The level clause is not decidable in general.
Its `Enforced by` field claims review judgment for the whole rule, so the part a parser could settle
is settled by nobody, and the field is accurate about it.

**Done when:** each rule's `Enforced by` names every check that enforces it, the clauses a parser
can decide carry one, and the direction the gate does not resolve is either mechanised or written
down as deliberate. PRE-4 closes that field's vocabulary at checks, commands and linters, so a check
added for OUT-7 lands with the field that claims it.

### 14 · OPS-19 — Both repository-wide linters re-read every file on every run

**Status:** Open\
**Surfaces:** FE, Ops\
**Effort:** S\
**Path:** Independent — two package scripts, a gitignore line, and the consequence note in
`docs/ops/spec.md` §1.6. The prettier half lands in `format` and the eslint half in `frontend`
(`docs/ops/spec.md` §1.6's scope table), so what either buys on wall clock is decided by which pool
member is binding at the scope being run.

**`fl_frontend/package.json` runs `eslint .` and `prettier --check ..` across the whole repository,
and neither is given a cache.** `fl_frontend/tsconfig.json` sets `incremental: true`; nothing else in
either tree keeps state between runs, so both tools re-read every file they are pointed at whether or
not anything about it has changed since the last run said the same thing.

**What the two steps cost**, measured 2026-08-11 on a development machine while the gate was
profiled: prettier over the repository is 41.5 s with other scopes running beside it and 33.3 s
alone, and eslint is 21.5 s — the longest step in the frontend scope, where a warm Turbopack cache
leaves `next build` at half of it. On a runner the order reverses and eslint is the second-largest
step behind `next build`, 16 s against 28 s over fourteen runs on 2026-08-11, inside the job that
sets a pull request's critical path.

**Why this may be worth more than the concurrency the gate already has.** Running the scopes
concurrently moved the wall clock and spent about a quarter more processor time to do it. A cache
does not redistribute the work, it removes it — and it lowers the floor in CI as well as locally,
which concurrency cannot: `.github/workflows/verify.yml` runs one scope per job, so inside a job
there is nothing to overlap it with.

**The three unknowns this was filed on are answered**, measured on 2026-08-12 on the development
machine — sixteen cores, repository clean — against the invocations the gate uses:

| Run, 2026-08-12                                      | Wall clock |
| ---------------------------------------------------- | ---------- |
| `prettier --check ..`, no cache — the gate's today   | 34.5 s     |
| `prettier --check ..`, `--cache`, warm               | 25.6 s     |
| `eslint .`, no cache — the gate's today              | 23.4 s     |
| `eslint .`, `--cache --cache-strategy content`, cold | 20.5 s     |
| `eslint .`, `--cache --cache-strategy content`, warm | 4.5 s      |

1. **Does a cache survive usefully between local runs?** Yes — decisively for eslint and modestly for
   prettier, and together they remove **about twenty-eight seconds of scope-time from a warm local
   run** (2026-08-12) — scope-time rather than wall clock, because the two halves fall in different
   pool members. Prettier's floor of 25.6 s with a fully warm cache and nothing changed says most of
   its time is startup, discovery and ignore-matching rather than formatting, which bounds what any
   cache can ever buy on that step.
2. **Does `--cache` change what the check proves?** Not once the key is chosen rather than defaulted.
   A cached clean verdict is exactly as good as its key, and `scripts/verify.sh` passes
   `--no-optimistic-repeat-install` to pnpm precisely because that tool's fast path keys on
   timestamps, where a stale one lets a real mismatch answer that everything is already up to date.
   `--cache-strategy content` hashes file contents instead, so that shape cannot arise here — and on
   2026-08-12 it measured no slower than the metadata key, 20.5 s cold and 4.5 s warm against 21.5 s
   and 4.8 s. **Use `content`**: the suspicion this entry was filed with is discharged by choosing
   the key, not by an argument about it.
3. **Can CI persist one?** **Out of scope, decided 2026-08-12: the local win only.** It needs no CI
   change to collect, so `.github/workflows/verify.yml` is left alone and the image build cache —
   buildx's `type=gha`, with no `actions/cache` step — needs no
   revisiting, nor does `.claude/CLAUDE.md` §7's line for it. This is a boundary on the work rather
   than a question still open inside it, and reopening it is its own decision.

**Done when:** `fl_frontend/package.json`'s two scripts pass `--cache`, eslint's passes
`--cache-strategy content` with it, and `fl_frontend/.gitignore` carries the line for eslint's cache
file that it has none for today (2026-08-12). **One consequence lands with it and belongs beside the
change**: a cache means the gate writes an untracked file into the working tree on every run.
`.claude/CLAUDE.md`'s rule that no formatter the gate runs writes a _tracked_ file still holds, and
`docs/ops/spec.md` §1.6 is where the note goes.

**A second lever sits on the same eslint step and is worth taking in the same sitting**: eslint
9.39.5 takes `--concurrency` as a first-class flag under flat configuration,
`fl_frontend/eslint.config.mjs` declares no `project` or `projectService` so the configuration is not
type-aware and a worker parses independently, and `auto` measured 13.8 s against 23.4 s uncached on
that same sixteen-core machine on 2026-08-12. That is not the CI figure and must not be read as one —
a standard GitHub-hosted runner has four cores, where worker startup and plugin loading can spend the
whole win, so the flag is kept only if three CI runs beat the recorded baseline.

### 15 · OPS-10 — Deciding whether a change is comments only costs a process per file

**Status:** Open\
**Surfaces:** Ops\
**Effort:** S\
**Path:** Independent — what the classifier answers does not change, only what the answer costs.

**`scripts/check_scope.py :: is_comment_only` spawns per file, and the gate runs it over the whole
diff.** Each changed file costs a `git show` for its earlier version, and each changed TypeScript
file then costs a fresh node process, because `scripts/check_scope.py :: typescript_same` hands one
pair at a time to `scripts/ts_normalize.mjs`. The cost therefore scales with how many files a branch
touched rather than with what is in them, and it is paid on every gate run at a docs or frontend
scope. `scripts/check_scope.py :: images_culprits` has the same shape on the failure path, running
`scripts/ci_scopes.sh` once per file to name which one required the image build.

**Why it is worth doing and why it is not urgent.** The gate is run before every push, so its
runtime is charged to every change, and a spawn is the part of this work that does not shrink with
the size of the file it is asked about. Against that, nothing is wrong with the answers: the
classifier is correct, and what a slow gate costs is patience.

**What must not change.** The carve-out reaches exactly as far as a parser does, so a batched run
still has to answer
"same" only where a parser proved it, and still has to count every error — a file that will not
parse, a missing toolchain, a crashed process — as code. A batch that loses which pair produced
which verdict, or that turns one file's parse failure into a verdict for the rest, is worse than the
spawning it replaced.

**Not measured:** what the spawns actually cost, and how much of a gate run is attributable to them.
The mechanism above is read from the code; the magnitude is not.

### 16 · OPS-2 — Nothing validates the contents of a restored `.env`

**Status:** Standing\
**Surfaces:** Ops\
**Effort:** —\
**Path:** Independent — ops audit pass O1 owns the script's failure modes.

**Found 2026-08-01**, the hard way, during a server re-clone.

`deploy.sh` checks that `fl_backend/.env`, `fl_frontend/.env`, `nginx/prod.conf` and `certs/` all
**exist** before it pulls anything, and Compose refuses to start a service whose `env_file` is missing.
**Nothing checks that a value inside those files is well-formed**, and each `.env` is gitignored — so
every server restore recreates them by hand from the password manager, unverified, and a malformed
value surfaces as a container that never becomes healthy.

**What that cost.** The restore produced a `MONGODB_URI` whose host had been truncated, most likely a
shell redirection swallowing part of the string as the file was written. Every preflight passed: file
present, key present, URI syntactically parseable. pymongo then resolved an SRV record that cannot
exist, the startup ping raised `ConfigurationError`, the backend crash-looped, nginx never started
because it waits on `service_healthy`, and the site was down until the truncation was found by reading
a stack trace.

**The options, none obviously right:**

| Option                                                  | Catches                                 | Cost                                                                                  |
| ------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------- |
| Leave it unchecked                                      | Nothing automatically                   | Zero. The failure is loud, contained, and quick to diagnose once recognised           |
| Name-presence preflight in `deploy.sh`                  | A missing key                           | Small. **Would not have caught this incident** — the key was present and merely wrong |
| Resolve the Mongo SRV record in `deploy.sh` before `up` | Exactly this class, plus a dead cluster | Adds a network dependency to a deploy step, and a DNS blip becomes a refused deploy   |

**The trade to weigh** is that resolving the SRV record is the only option that would have helped, and
it makes deployment fail for reasons unrelated to the deployment. Given the failure is already
contained — nginx serves nothing rather than serving something broken — the honest question is whether
a faster diagnosis is worth a new way for `deploy.sh` to refuse.

**Trigger to revisit:** the second time a restore breaks this way, or any move to a setup where the site
cannot tolerate the minutes between a bad deploy and a human reading the log. Ops audit pass O1
(`docs/_auditing/prompts/ops/1-build-deploy.md`, check 4) covers script failure modes and owns this.

### 17 · OPS-3 — The crawler policy is split between robots.txt and Cloudflare, and neither knows about the other

**Status:** Standing\
**Surfaces:** Ops\
**Effort:** —\
**Path:** Independent — no pass covers it, and the table below is the early warning.

**Found 2026-08-01 while diagnosing a missing WhatsApp link preview.**

`fl_frontend/src/app/robots.ts` disallows a named list of AI crawlers, `meta-externalagent` among them.
That file is a **request**: robots.txt is advisory and a crawler chooses whether to obey it.

Cloudflare is separately enforcing something stronger. Measured against the live site, 2026-08-01:

| User-Agent                | page | image |
| ------------------------- | ---- | ----- |
| `WhatsApp/2.x`            | 200  | 200   |
| `facebookexternalhit/1.1` | 200  | 200   |
| `Twitterbot/1.0`          | 200  | 200   |
| `meta-externalagent/1.1`  | 403  | 403   |

The 403 carries `Server: cloudflare` and a `CF-RAY`, and `nginx/prod.conf` contains no user-agent or
`deny` rules — so the block is an edge setting, made in a dashboard this repository does not configure
and does not record.

**Why it matters, and why it is not urgent.** Link previews on Meta's products are fetched by
`facebookexternalhit`, which is served normally, so nothing is broken today. The risk is
consolidation: if preview fetching ever moves behind `meta-externalagent`, every WhatsApp and Facebook
preview for this site stops working, the failure is silent, and nothing in the repository would explain
it. The 403 is invisible from the codebase.

**What a rework has to decide, rather than assume:**

- Whether the AI opt-out belongs in robots.txt, at the edge, or both — and if both, which one is the
  source of truth when they disagree. They already disagree in kind: one asks, one enforces.
- Whether blocking an agent Meta also uses for product features is the intended trade. The opt-out was
  aimed at training, not at previews.
- Whether the edge configuration should be recorded here at all, given `docs/ops/overview.md` states
  that this repository does not configure Cloudflare. A setting that can break a user-visible feature
  and leaves no trace in the repo is the argument for writing it down somewhere.

**Trigger to revisit:** any Cloudflare bot-protection change, or a report of broken previews. Re-running
the table above takes one `curl` per agent and distinguishes an edge block from a markup problem
immediately.

### 18 · DOC-3 — A rule pattern in the documentation gate reaches less than the rule it enforces

**Status:** Standing\
**Surfaces:** Docs\
**Effort:** —\
**Path:** Independent — no pass covers it, and only the triggers below reopen it.

**Not a defect today, and the corpus is why.** Each pattern below matches everything the repository
currently holds. Each is also narrower than the rule it serves, and where it falls short the gate
answers with silence rather than a finding.

**The rule families are spelt into the patterns.** `scripts/check_docs.py :: RULE_ID_RE` carries the
standard's prefixes as a closed alternation, and `RULE_HEAD_RE`, `CHAPTER_ROW_RE` and
`RULE_INDEX_LINE_RE` repeat the same list. A chapter written under a prefix none of them carries
falls outside all of them at once: citations of its rules resolve to nothing and dangle unreported,
its rules are not held to PRE-4's anatomy, and none of them is required to take a line in the rules
index. Widening the alternation by hand is not the answer, because the list is closed so that the
backend's error codes — which carry an extra segment — can never be read as rule ids. A pattern
whose prefixes disagree with the chapters is a divergence the gate could resolve on its own, the way
`scripts/check_docs.py :: roadmap_ids` derives the roadmap's ids from the tables defining them
instead of matching a shape.

**The metadata pattern is anchored at column 0.** `scripts/check_docs.py :: METADATA_LINE_RE`
requires its bold label to open the line, where `scripts/check_docs.py :: RULE_FIELD_RE` reads a
metadata block of its own and tolerates leading
whitespace — so `scripts/check_docs.py :: check_metadata_breaks` cannot see a metadata block
nested inside a list item or a blockquote, and COR-8's hard break goes unchecked there. Widening it
is not free: this is a discovery pattern run across every page, an indented bold label is a shape
ordinary prose also takes, and a check that reports prose is a check that gets ignored. What an
answer has to find is a way to reach the indented block without reaching indented prose.

**Trigger to revisit:** a chapter added to the standard under a prefix the patterns do not carry, or
the first page that needs a metadata block indented.

### 19 · DOC-4 — A stamp is required by a path and owed by a claim

**Status:** Standing\
**Surfaces:** Docs\
**Effort:** —\
**Path:** Independent — no pass covers it, and only the trigger below reopens it.

**CUR-3 decides a stamp by what a page claims and never by where the page sits.**
`scripts/check_docs.py :: check_stamp_missing` decides it by `STAMP_REQUIRED_GLOBS`, a list of
paths, because what a page claims is not something a check can read: the globs cover the part of the
criterion a path settles and leave the rest to a reader.

**What the gap costs.** A page stating current state from outside those globs carries no stamp and
nothing reports the omission — and `branch-impact` arms only on a stamped page, so every file that
page cites may change under it with nothing ever asking for it to be re-verified. That is precisely
the staleness the stamp exists to measure, running unmeasured on the pages the stamp never reached.

**Why inverting the default is not free.** The exempt kinds CUR-3 names are decidable by path: a
template, an instruction file, a document addressed to a reader outside this repository. The
class it leaves open is not. A page whose own content is the table that navigates elsewhere needs no
stamp and is not wrong to carry one, so an inverted rule reports it and the report names no defect.
Naming those pages in the check is the outcome to avoid — a list of names is what deciding by kind
was written to replace.

**Trigger to revisit:** a reference page added under `docs/` that sits outside
`STAMP_REQUIRED_GLOBS`, or any change to what the branch-impact check arms on.
