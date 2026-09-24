---
name: orchestration
description: Coordinating a long multi-agent session — planning file ownership before dispatch, keeping a fleet of subagents at maximum safe parallelism, owning every commit, judging agent reports, running the audit cycle to its stopping rule, and handing off between sessions. Use it whenever work needs more than a handful of subagents, when parallelism has collapsed to one agent at a time, when several agents' edits must be assembled into commits and a pull request, when planning a multi-session programme or writing its starter prompt, when writing or auditing a handoff, or when resuming a session that was paused, killed, or stopped for quota — even when nobody named the skill.
---

# Coordinating a multi-agent session

You are the coordinator. Agents write files; you own every commit, every routing decision, and every
claim that reaches a permanent artefact.

| You are…                                   | Read                                  |
| ------------------------------------------ | ------------------------------------- |
| starting, pausing or resuming a session    | [§1](#1-starting-pausing-or-resuming) |
| about to dispatch the first agent          | [§2](#2-before-the-first-dispatch)    |
| about to dispatch any agent                | [§3](#3-every-dispatch)               |
| running the fleet or replying to the owner | [§4](#4-running-the-fleet)            |
| planning a wave, or asked how long         | [§4](#the-schedule-is-read-back)      |
| about to change the tree, or to measure    | [§4](#tree-and-machine-are-shared)    |
| judging a landed report, or committing     | [§5](#5-commits-and-the-boundary)     |
| taking a slice through the audit cycle     | [§6](#6-the-cycle)                    |
| ending the session                         | [§7](#7-ending-the-session)           |
| planning a programme                       | [handoff](handoff-template.md)        |

**This page is a fixed budget, and nothing checks it.** Compaction keeps only its opening
([USAGE.md](USAGE.md) has the budget and the why), so **remove something of its own size before you
add anything, and measure the page afterwards rather than assuming it still fits**: an addition
displacing nothing is not refused, it is taken out of the end. **The physical order is for
compaction, not chronology** — the table reaches each section by its moment, and only §2 is safely
last, spent before the second agent runs; §6 and §4's two subsections are late-session material
sitting where the cut falls, so re-read them at `.claude/skills/orchestration/`.

## 1. Starting, pausing or resuming

- **A fresh session reads the starter prompt's files in the order the starter gives before any work.
  A `resume` argument is a resume, and so is arriving with no instruction into a transcript already
  carrying this session's work; either way run [resume-prompt.md](resume-prompt.md) to its end
  before anything else.**
- **A quota stop costs exactly what the register does not hold.** Every edit on disk survives it;
  every finding an agent has not yet returned dies with it (§4), and so does your judgement since
  the last register edit — so the register's **resume point**
  ([register-template.md](register-template.md)) is rewritten in the same edit as whatever it names,
  a stop that gives warning being the exception and an announced one getting one action only
  ([resume-prompt.md](resume-prompt.md)). **The resume point is this session continuing, never a
  handoff** ([handoff-template.md](handoff-template.md)).
- **Before recording that the owner's process lacks a step, check whether the step exists and you
  skipped it.** **A programme's rulings live in its register alone**
  ([register-template.md](register-template.md)).
- **Send the owner every question as one batch before the first dispatch**, and each later one the
  moment it arises: owner latency is unbounded and gates whole branches of the schedule, and asking
  one at a time was the programme's largest avoidable delay. **Settle it against the live system
  first** — an owner interrupted for nothing discounts the next.
- **A stretch nobody will answer is prepared before it starts** — what to disable, on which axis,
  and how the change is undone without your remembering it, is
  [register-template.md](register-template.md).

## 5. Commits and the boundary

1. **A commit lands in the turn its report is judged**, from the register's commit table, and its
   audit is dispatched in the same action: a cycle that ends on a commit has skipped its last step.
   Neither waits for the wave boundary. **Land it in your own checkout with
   `git cherry-pick -n $(git merge-base HEAD <branch>)..<branch>`, then `git commit -F <msg>`**:
   it runs `.githooks/pre-commit` and `commit-msg`, where a plain cherry-pick runs neither, and one
   reason spread over two agents' branches is one `-n` over both. On a conflict, `--abort`; the
   agent rebases onto the session branch and resolves in its own worktree. A later fix to a landed
   commit lands as a commit of its own, naming the commit it corrects.
2. **A commit message is good enough when both routes accept it and its claims are true of its own
   diff.** Check it against the diff, never against the proposal it came from: for every path in the
   diff, does the body account for it? Validate with both routes
   [register-template.md](register-template.md) gives.
3. **Re-establish every fact in the message as you commit it**, never from the agent's report: an
   installed version, a remote setting or a file's presence moves between drafting and permanence.
   **A claim about the code is checked against that commit**, never against where the branch ends —
   the tooling claims being the ones nobody re-reads. Qualify every blanket negative to what
   you checked — "nothing else is shared" missed a process-global two frames down.
4. **Only the branch's final state passes the gate and CI**; a commit is held to its hooks and the
   range check, never probed or reordered to be green alone. Land a branch once
   `git -C <worktree> status --porcelain` is empty: the agent's checks read files its commits lack.
5. **At the boundary, reconcile mechanically** ([resume-prompt.md](resume-prompt.md) step 4): your
   checkout is clean, and every `git worktree list` entry is a live agent's or a branch the commit
   table has landed. Remove a landed one and delete its branch, which is your routine work and
   never the owner's question ([register-template.md](register-template.md)); the harness removes
   only an unchanged one.
6. **Push once per wave, and run no gate for it**: the gate runs once, over the branch's final state
   (item 4, §7). The local stack runs in your checkout, which holds landed work only, so it never
   waits for the fleet (§4), and it still holds port 3000 against the next build.

## 7. Ending the session

**The dispatch floor.** You cannot see remaining context or quota, so a rule phrased as "keep enough
in hand" never fires. Bound the unassembled work instead: once what remains is one wave plus the
ending below, start nothing new.

The ending, in order:

1. Assemble the last wave (§5). Its last commit dispatches its own audit in the same action, so the
   ending still holds a whole round — that audit, and the fix the cycle ends on (§6). **Count both
   in the floor above**, which an ending enumerated without them under-counts.
2. **Run §2's enumeration again here**, against the branch this time: a slice nobody dispatched and
   a slice deliberately deferred are indistinguishable until someone asks. Then run the gate at the
   branch's scope over a tree that has stopped moving. **The branch is stable only here** — the last
   fix committed, the gate green, no live agent still able to return a finding, and every worktree
   row closed ([register-template.md](register-template.md)).
3. Open the draft pull request, its body written once, here (CLAUDE.md §2), and **start the handoff
   in the same action, which is its moment**: the checks then run for as long as the handoff takes
   to write, audit and fix.
4. **Write the handoff ([handoff-template.md](handoff-template.md)) and the next session's starter
   (`START-<session>.md`, [USAGE.md](USAGE.md)) once each, from the register**, which was the draft
   all along. **Once is the rule and step 3 only the moment that serves it**: begun while anything
   in it can still move, a handoff gets refreshed instead, and the refresh is the waste. The pull
   request's link and its checks' conclusions are the only facts that cannot be in it yet — a gap to
   fill as they land, never a reason to start later. Audited by an agent that has seen none of the
   work, then fixed.

**Where a programme plan's handoff instructions differ from this skill's, this skill wins; where
this skill differs from `.claude/CLAUDE.md`, this skill is wrong and is fixed here.**

## 3. Every dispatch

Run it for every agent, the fifteenth as much as the first.

1. **Read the live-agent table.** Is a live agent already covering this question? Resume it rather
   than start a fresh one, which hands you a second conclusion to drive; a resumed agent re-enters
   its partition, so check its files are still free. **That the harness can resume an agent at all
   is established by attempting one send** ([resume-prompt.md](resume-prompt.md)).
2. **Diff this brief's file list against what every unclosed agent OWNS, path by path** — its whole
   brief list, never the subset it is writing now, because an agent can return to any of its files
   until it reports. Nothing mechanical sees
   two owners ([register-template.md](register-template.md)). A file two agents must share is
   written into both briefs, each naming the other's region ([the brief](agent-brief-template.md)
   section 1).
3. **Sum against the budget** — the live count and this agent — and never dispatch blind. **A raised
   cap is a number, not a suspension**, and the sum lapses exactly when requests arrive faster than
   agents finish, each justified alone. **Name which of §4's three reasons buys this agent before
   you write its brief**; none, and the work is yours. **No agent spawns sub-agents**
   ([the brief](agent-brief-template.md) section 6): where a question needs a fresh agent, you
   dispatch it.
4. **Brief from [agent-brief-template.md](agent-brief-template.md)**, every section, with the file
   list in full and the scratch path written out. **One prep agent resolves a whole wave's premises
   against `HEAD` before its briefs are written** — half of them otherwise carry one the tree
   contradicts ([the brief](agent-brief-template.md)), each paid for twice, in the agent's
   rediscovery and in the fix round that follows.
5. **Dispatch a judging auditor as `cold-auditor`**; an auditor needing a shell — to plant, run a
   suite, read an exit code or committed state — goes as `general-purpose`, read-only by prose
   ([the brief](agent-brief-template.md)).
6. **Omit the Agent tool's `model` parameter unless the owner names another model for that work**:
   the parameter outranks every default, and its alias `opus` has resolved to an older Opus.
7. **Record the dispatch in the register before it runs. An agent that writes the repository runs
   in a worktree of its own** (`isolation: "worktree"`, which branches from your `HEAD` only under
   `worktree.baseRef: "head"`), so commit what it needs first; a reader stays in yours.

## 4. Running the fleet

- **Check the live count against the cap before every reply, and end the reply with the gauge that
  proves you did:** `Fleet: 3 of <cap>, two queued behind the gate commit.` No clause explaining a
  blockage, which belongs in the reply's prose.
- **The gauge cannot test "nothing is dispatchable"**, and a truthful count sits happily above a
  queue nobody examined — which is how this rule keeps failing while the line proving it gets
  written. Name what would have to become true for one more agent to go out, and check whether it
  already is; three classes a busy tree almost never blocks are a cold audit over a captured diff
  (§6), read-only research, and the next wave's prep agent (§3). **The owner asking about
  parallelism is a defect report, never a question.**
- **Dispatch before you read, and before you reply.** A landed report frees a slot, and the queue's
  next standing action fills it before the report is opened.
- **An agent is bought for a fresh reader, for breadth you cannot cover, or for tool-hours — never
  for typing**: every dispatch costs a brief, a report you must read, a slot, and the risk of a
  second conclusion to drive.
- **A follow-up on an agent's own files goes to that agent (§3)** rather than to a stranger, an
  audit's fixes included **where the finding is SETTLED** — by a driven plant, an owner's
  ruling, a quoted never-clause. A finding that argues the shape is wrong goes to a fresh reader
  instead, being one the author can dispute from inside the reasoning that produced it; the
  re-audit's agent wrote none of the fixes either way (§6).
- **Size a brief by what losing its whole output costs** — a report is the agent's final message,
  banked into the register in the turn it lands
  ([register-template.md](register-template.md)).
- **Verify every count, file list and exit code in a report yourself**, against the agent's branch —
  `git log --stat <forked at>..<branch>` and `git show <branch>:<path>` — since what lands is what it
  committed, never what its worktree or its report says. **A finding about a file its reporter does
  not own is checked at `HEAD` before it is routed**: findings have dissolved that way. Route one agent's
  conclusion to another as a claim with its source named, never as a premise; your own inference,
  stated one notch wider than its evidence, reaches an agent as fact. When two agents disagree about
  one file, drive the difference — never pick a side, never average.
- **Route every out-of-scope finding in the turn you read it**, from the report's separately headed
  list: a fixer in this wave where it is a fix, the owner where its place in this session is unsure,
  or a check where the class is mechanically detectable — never a roadmap entry the owner has not
  been asked about (CLAUDE.md §3) — and say which each got. Reports rank findings by their author's
  scope, so the one that matters is rarely first. **Route at the class, never at the instance reported** — protecting the one file reported
  lost other agents' commit messages in the same directory a wave later.
- **[The brief](agent-brief-template.md) sections 8, 9 and 13 — plant-and-restore, the traps and the
  siblings test — bind you as they bind an agent**, and 13 binds what you bank from a report: ask
  which command established a claim about the tooling, and read its success as evidence about that
  command and no wider class.

### The schedule is read back

**At the plan and at every wave boundary, write what remains as a block-by-block wall-clock estimate
([register-template.md](register-template.md)), each figure marked measured or estimated, then read
it back for what to change** — the read-back is the instrument, and the estimate alone has never
moved a schedule. **A wave costs its longest agent, never the sum**, so the schedule is a chain of
longest agents: find the block dominating it and spend the round there, because **an optimisation
leaving that block untouched buys nothing**, however easy it looks. **A whole exceeding the
arithmetic of its parts is a serialisation nobody has named**; and where one block dominates two
read-backs running, the question stops being how to shorten it and becomes what could have started
earlier. **Re-take any figure a decision rests on with the fleet listed and stopped, and refuse a
bare number** — every figure a fleet takes is an upper bound, and its spread measures contention
rather than the change ([the brief](agent-brief-template.md) section 12).

### Tree and machine are shared

- **The trees are not; the machine, the stores and the refs are.** A plant in an agent's worktree
  reaches nobody, but a timing loop still contends for the CPU, so a figure is taken in an
  exclusive window ([register-template.md](register-template.md)).
- **A guard, a hook registration or a manifest changes what every other agent may do once it lands**
  ([the brief](agent-brief-template.md) section 10) — hooks run from your checkout
  (`CLAUDE_PROJECT_DIR`), and a lockfile obliges every later worktree to reinstall — so it lands in
  an exclusive window even at one line, and **two agents reporting one out-of-scope failure is one
  such change rather than two findings.**

## 6. The cycle

**research/think → implement → audit → fix → re-audit → fix → END**, unless the owner asks for
more. **It ends on a fix, never on an audit**: ending on an audit ships known open findings, which
defeats having audited. The re-audit's subject is [the brief](agent-brief-template.md)'s, the
lightening floor and its discriminator [register-template.md](register-template.md)'s. Beyond them:

- **The re-audit's agent wrote none of the fixes.**
- **A document is audited once, cold, and its fix is read by you**; where one is re-audited anyway
  it walks the previous audit's findings one at a time ([the brief](agent-brief-template.md)), a
  chain of plan audits having each read the plan afresh with none confirming the previous had closed.
- **Allocate the audits to the seams, never one per slice** — across blocks, across commits, and the
  one or two artefacts where a wrong claim is expensive and invisible. A defect living between the
  pieces is in no piece's diff, so a slice several agents built in parallel is audited whole.
  **A seam is the wrong axis wherever one thing's meaning is spread across seams** — what a new
  field means to whoever maintains it and what it says to whoever fills it in can land in three
  diffs and disagree, with no auditor holding both — and that slice is cut by identifier instead.
- **A surface a person looks at is not audited by reading.** A cold auditor has no browser, a render
  harness cannot mount what needs a router, and a source-text pin passes on markup nobody rendered,
  so a slice that changes what someone sees is judged by the OWNER over the local stack
  (CLAUDE.md §5) as soon as it is served and before its fix rounds close — rounds of owner feedback
  over a served build have reopened decisions every cold audit had passed. Yours: the stack up, a
  checklist of what changed, and the structural checks. **A look ruling is a class** and binds every
  surface in flight, and **the owner is the primary source on what the owner has looked at**: where
  a handoff's list disagrees, the list is withdrawn.
- **At many slices the lightening is the normal allocation and the full cycle the exception**
  ([register-template.md](register-template.md)).
- **Audits are bought by blast radius, not by agent count.** One cold auditor per seam takes every
  slice that seam crosses; one driving re-auditor takes every fix landed since the last, across
  seams ([the brief](agent-brief-template.md)); a follow-up found by one audit rides the next
  re-audit's walk list. **A cold audit's subject is a captured diff, so it goes out the moment its
  own files stop moving** — as its implementer's report lands, ahead of the commit and of the rest of
  the wave. Write the diff over the seam's paths to the scratch path and name that file in the brief;
  the tree moving under the auditor costs nothing, its read rule ([the
  brief](agent-brief-template.md) section 2) refusing the tree anyway. **A driving re-audit plants
  in a worktree of its own** at the commit it audits.

## 2. Before the first dispatch

Do these in this order. None is skippable.

1. **Cut the session's one branch (CLAUDE.md §2) before the first read**: every step below reads
   the repository.
2. **Enumerate the population from the tree by command, and tick every slice off against that
   listing**, because no check asks whether a file was considered: files went unswept, one of them
   the corpus's largest page, while every slice truthfully reported itself complete. Measure across
   the whole set in the same pass, duplication above all (§6).
3. **Build the file-ownership map, not a task list**, from every file each unit of work writes. A
   file two or more units write is a **hub**: its units share it by region, each brief naming the
   others', where their regions stay apart ([the brief](agent-brief-template.md) section 1), and
   one agent owns it otherwise — a plan cut into ten units ran almost serially because six wrote one
   file. Everything else is a **leaf** and goes out at once. **Cut agents by file and audits by unit of
   work.**
4. **Name the couplings that are not file edges** — a script that parses another, a library several
   files source, a rule and the check enforcing it, and every **shared contract**: a message string,
   an exit code, a flag name that one file emits and another asserts; two agents took opposite sides
   of one contract while owning different files throughout, so the map saw nothing. Coupled files
   share a wave and a re-auditor, an edit to either being able to turn the other red after both
   agents have finished.
5. **The ownership map is the commit plan.** Fill the register's commit table now, its ordering
   constraints (§5) included, which survive a coordinator change only in writing. A contract two
   agents build against lands before the second forks, since neither sees the other's worktree.
   **One session, one branch, one pull request**: a finding that seems to want its own branch is
   fixed here, or put to the owner — an entry only where the owner says so.
6. **Decide each slice's cycle now (§6)**, with its reason. Never decide it while reading findings.
7. **Enumerate the ending (§7)** so the dispatch floor has something to count.
8. **Write the register ([register-template.md](register-template.md)) before the first agent
   runs**, naming step 1's branch and the session's scratch path, whose top level you own. Then send
   the owner batch.
