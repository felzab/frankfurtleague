---
name: orchestration
description: Coordinating a long multi-agent session — planning file ownership before dispatch, keeping a fleet of subagents at maximum safe parallelism, owning every commit, judging agent reports, running the audit cycle to its stopping rule, and handing off between sessions. Use it whenever work needs more than a handful of subagents, when parallelism has collapsed to one agent at a time, when several agents' edits must be assembled into commits and a pull request, when planning a multi-session programme or writing its starter prompt, when writing or auditing a handoff, or when resuming a session that was paused, killed, or stopped for quota — even when nobody named the skill.
---

# Coordinating a multi-agent session

You are the coordinator. Agents write files; you own every commit, every routing decision, and every
claim that reaches a permanent artefact. Each section closes with the incidents that made its rules.

| You are…                                   | Read                                  |
| ------------------------------------------ | ------------------------------------- |
| starting, pausing or resuming a session    | [§1](#1-starting-pausing-or-resuming) |
| preparing a stretch nobody will answer     | [register](register-template.md)      |
| about to dispatch the first agent          | [§2](#2-before-the-first-dispatch)    |
| about to dispatch any agent                | [§3](#3-every-dispatch)               |
| running the fleet or replying to the owner | [§4](#4-running-the-fleet)            |
| about to let an agent change the tree      | [§4](#a-fleet-shares-one-tree)        |
| about to measure anything                  | [§4](#measuring-on-a-shared-machine)  |
| judging a landed report, or committing     | [§5](#5-commits-and-the-boundary)     |
| taking a slice through the audit cycle     | [§6](#6-the-cycle)                    |
| ending the session                         | [§7](#7-ending-the-session)           |
| planning a programme                       | [handoff](handoff-template.md)        |

[USAGE.md](USAGE.md) is how this skill loads and how a session starts or resumes.

**This page is a fixed budget, and nothing checks it.** Compaction keeps only its first 5,000 tokens
([USAGE.md](USAGE.md) has the why), so an addition displacing nothing is paid for out of the end of
the page. Whether it is inside that budget is **not established** — `wc -c` is the only proxy here,
and tokenizing the file would settle it — so add nothing without removing something of its size.
**The physical order is for compaction, not chronology** — the table above reaches each section by
its moment, so §2 sits last, spent before the second agent runs.

## 1. Starting, pausing or resuming

- **A fresh session reads the starter prompt's files in the order the starter gives before any work.
  A `resume` argument is a resume, and so is arriving with no instruction into a transcript already
  carrying this session's work; either way run [resume-prompt.md](resume-prompt.md) to its end
  before anything else.**
- **A quota stop costs exactly what the register does not hold.** Every edit on disk survives it;
  every finding an agent has not yet returned dies with it, there being no second copy anywhere
  (§4), and so does your judgement since the last register edit. So the
  register's **resume point** is rewritten in the same edit as whatever it names — the next action,
  a report landed and not yet judged, a commit about to land, the last gate run and its exit code —
  never saved for a wave boundary and never left until a stop looks close, since a stop that gives
  warning is the exception. An announced one gets a single action: bring it current and reply with
  it. **The resume point is this session continuing, never a handoff**
  ([handoff-template.md](handoff-template.md)).
- **Describe the owner's process only from a written source.** Before recording that a process lacks
  a step, check whether the step exists and you skipped it.
- **Send the owner every question as one batch before the first dispatch**, and each later one the
  moment it arises, never held for a wrap-up. **Settle it against the live system first:** an owner
  interrupted for nothing discounts the next.
- **A stretch nobody will answer is prepared before it starts**, a subagent's prompt surfacing in
  your session rather than the agent's: one tripped at the quietest hour parks the fleet behind a
  dialog instead of failing fast. What to disable, and how the change is undone without your
  remembering it, is [register-template.md](register-template.md).

Incidents. Owner latency is unbounded and gates whole branches of the schedule; asking one question
at a time was the largest avoidable delay in the programme. At a quota stop a coordinator hesitated
between a handoff and a resume-state; the resume-state carried the session. One session was stopped
twice, the second time with no warning at all.

## 5. Commits and the boundary

1. **A commit lands in the turn its report is judged**, from the register's commit table, and its
   audit is dispatched in the same action: a cycle that ends on a commit has skipped its last step.
   Nothing waits for the wave boundary, where the tree is reconciled and pushed.
2. **Check every message against its own diff, never against the proposal it came from** — for
   every path in the diff, does the body account for it? Validate each with
   `python scripts/checks/check_commits.py --message-file <file>` — that route alone is a false
   green, and the second is [register-template.md](register-template.md)'s.
3. **Re-establish every environment fact in the message against the live system as you commit it**,
   never against the agent's report — an installed version, a remote setting or a file's presence
   moves between writing a message and its becoming permanent. Qualify every blanket negative to
   what you checked — "nothing else is shared" missed a process-global two frames down.
4. **Order commits by what each commit's own checks can see**, never by what reads tidily. A citation
   resolves only once its file is tracked — `scripts/checks/docs_gate/checks.py` reads the working
   tree, so a document naming an untracked file passes locally and fails the CI checkout.
5. **Stage a file that must execute with its mode, and read it back with `git ls-files -s`.**
   `core.fileMode` is false here, so a new file lands 100644 whatever the filesystem says, and a hook
   without the executable bit is skipped in silence on Linux.
6. **At the boundary, reconcile the ownership map against the whole tree** with
   `git status --porcelain`, never `git diff --name-only`
   ([resume-prompt.md](resume-prompt.md) step 4). A path the map does not assign is a conflict
   incident and appears in no prose report. **A production file modified while no live agent owns
   it is a stranded plant until proven otherwise: ask its agent, never restore it** — a restore over
   a live drive corrupts the measurement and invites a re-plant. Run it mechanically, never by
   happening to read `git status`.
7. **Push once per wave.** One _saved_ edit to a path [the brief template](agent-brief-template.md)
   section 9 names arms the full-form gate for the rest of the branch. Only the gate's own
   invocation counts, over a tree that has stopped moving — while a fleet writes it exits non-zero
   on somebody's half-written file, so mid-wave ask only: does it report a finding in the files I am
   about to commit? Read its exit code from the command itself (CLAUDE.md §2), past section 9's
   byte-masking trap.

Incidents. Commits first planned at hour four met fifty uncommitted files from twenty agents: a file
five of them had edited became one commit, and messages drafted hours earlier recorded a resolver
version the branch's own pin refuses and an allowlist entry as missing that was present. A commit
landed carrying two agents' changes under one agent's message; nothing failed, and re-reading the
body beside the diff found it. Three items reached a
commit with no audit at all, and only the owner's question surfaced it. Six subjects over 72
characters cost a full branch replay. Nine implied full-form runs became four by pushing per wave.

## 7. Ending the session

**The dispatch floor.** You cannot see remaining context or quota, so a rule phrased as "keep enough
in hand" never fires. Bound the unassembled work instead: once what remains is one wave plus the
ending below, start nothing new.

The ending, in order:

1. Assemble the last wave (§5), run the gate at the branch's scope, open the draft pull request,
   print its link, and name the `verify` run's conclusion before the session ends (CLAUDE.md §2).
2. **Write the handoff ([handoff-template.md](handoff-template.md)) from the material the register
   banked as reports landed, and have it audited by an agent that has seen none of the work**, then
   fix what the audit finds — the cycle applies to the handoff and ends on the fix.
3. Write the next session's starter prompt beside the handoff as `START-<session>.md`, the name
   [USAGE.md](USAGE.md) tells the owner to paste, keeping one copy of each governing file beside it;
   a second diverges. **Where a programme plan's handoff instructions differ from this skill's, this
   skill wins.**

Incidents. A session that spent everything on dispatch ended with sixteen commits, an unpushed branch
and no pull request.

## 3. Every dispatch

Run it for every agent, the fifteenth as much as the first.

1. **Read the live-agent table.** Is a live agent already covering this question? Resume it rather
   than start a fresh one, which buys the same context again and hands you a second conclusion to
   drive. A resumed agent re-enters its partition — check its files are still free.
2. **Diff this brief's file list against every live agent's, path by path.** Nothing mechanical sees
   two owners, and a dispatch held in mind by its task rather than its paths is one where this diff
   never gets run ([register-template.md](register-template.md)). Where a file must be shared, each
   brief names who else is in it and which region is theirs, and every edit anchors on a unique
   fragment so a stale one fails loudly.
3. **Sum against the budget** — the live count and this agent — and never dispatch blind. **No agent
   spawns sub-agents** ([the brief](agent-brief-template.md) section 6): where a question needs a
   fresh agent, you dispatch it.
4. **Brief from [agent-brief-template.md](agent-brief-template.md)**, every section, with the file
   list in full and the scratch path written out.
5. **Dispatch a judging auditor as `cold-auditor`** — no `Edit`, `Bash` or `Agent`, and a hook
   refuses its `Write` inside the repository. Its brief is the template's **cold form**, which
   carries no shell command, no plant and no exit code. A re-auditor that must plant needs a shell
   and goes as `general-purpose` under the **driving form**, read-only by prose alone. **Then check
   the brief's verbs against that type's tools**, which nothing else catches: run, measure, drive
   red and read the diff each need a shell a `cold-auditor` has not, and an agent cannot know what
   tools it was meant to have.
6. **Record the dispatch in the register before it runs.** One working tree, never worktrees.

Incidents. Work went twice to a fresh agent a live one already covered. An audit whose only decisive
test was a fresh agent, and whose brief forbade subagents, spent its dispatch to report "unsettled";
a two-line probe settled it in four minutes. Worktrees cost more in cherry-picks, cleanup and
per-tree installs than they bought.

## 4. Running the fleet

- **Check the live count against the cap before every reply, and end the reply with the gauge that
  proves you did:** `Fleet: 3 of 20, two queued behind the gate commit.` A gauge carries numbers:
  one sentence, a dozen words at most, no em dash and no clause explaining a blockage, which belongs
  in the reply's prose where the reader needs it. Print it in the turn it feels most redundant;
  **it is never dropped and never dissolved into the prose.** The owner asking about parallelism is a
  defect report, never a question.
- **Dispatch before you read, and before you reply.** A landed report frees a slot, and the queue's
  next standing action fills it before the report is opened; neither of the two is the work.
- **Your own serial work is a dispatch** once it needs more than a minute and none of your context —
  a commit message, the partition, report condensation, the pull request body, the handoff draft;
  you judge the output.
- **Verify agents have stopped by listing them.** Killing a parent does not kill its children.
- **A report is the agent's final message and nothing else** — the harness has every subagent return
  findings as text rather than write a file, so a killed agent returns nothing: bank each verdict
  into the register in the turn it lands, and size a brief by what losing its whole output costs.
- **Read a report this way.** Verify every count, file list and exit code yourself. Compare the files
  it says it touched against `git status --porcelain`, and read committed state with
  `git show HEAD:<path>` — while agents write, the working tree is not evidence. Route one agent's
  conclusion to another as a claim with its source named, never as a premise; your own inference,
  stated one notch wider than its evidence, reaches an agent as fact. **A figure carries its
  provenance** — measured by you, reported by an agent, or estimated — and its receiver re-measures
  whatever it will act on ([the brief](agent-brief-template.md)).
  When two agents disagree about one file, drive the difference — never pick a side, never average.
- **A claim about what the tooling permits is banked only once something has attempted it** — ask
  which command was run, and read its success as evidence about that command and no wider class.
  Where a change leaves one document contradicting its siblings, the siblings are the evidence
  against it, not a tidying job.
- **Route every out-of-scope finding in the turn you read it**, from the report's separately headed
  list: an owner or a roadmap entry each, and say which each got. Reports rank findings by their
  author's scope, so the one that matters is rarely first.
- **A green on a check nobody drove is not evidence** — and [the brief](agent-brief-template.md)
  sections 8 and 9, plant-and-restore and the traps, bind you as they bind an agent.

Incidents. The owner demanded full parallelism five times in one session, and each time three to
five dispatchable items were waiting on the coordinator's reading. An agent's own uncommitted
edit was quoted back at it as evidence and it was stood down on that. A report contract was
rewritten on a reading of an agent definition, wrongly, while three sibling files said the opposite.
Every false green in this repository's record was a status-carrying bug.

### A fleet shares one tree

A change to a file is a change to every other agent's inputs, and it surfaces as somebody else's
inexplicable failure.

- **Nothing runs a break-and-restore loop against the shared tree** ([the
  brief](agent-brief-template.md) section 8). A benchmark that edited, timed and restored a gate
  module failed every overlapping suite run on something unrelated, and a cold audit's gravest
  finding is as plausibly this as real. Where a measurement cannot run against a copy outside the
  tree, quiesce the fleet before granting the exclusive window.
- **Record every open plant-and-restore window in the register**, so red seen elsewhere inside that
  window is attributed there before it is believed; an unattributed one discounts the next genuine
  finding of that shape.
- **A guard, a hook registration or a manifest changes what every other agent may do** ([the
  brief](agent-brief-template.md) section 10), so it takes an exclusive window even at one line, and
  **two agents reporting one out-of-scope failure is one such change rather than two findings** — a
  version pin one added made every other's gate refuse, and four reported it.

### Measuring on a shared machine

**Every figure a fleet takes is an upper bound, and its spread is contention rather than the
change** — one command timed three times read 15.7s, 18.1s and 105.4s. Refuse a bare number, and
re-take on a quiet machine, fleet listed and stopped, any figure a decision rests on. **A measured
whole exceeding the arithmetic of its parts is a serialisation nobody has named**, so chase that gap
before optimising anything inside it.

## 6. The cycle

**research/think → implement → audit → fix → re-audit → fix → END.** Its length, its ending on a
fix, the re-audit's subject and the lightening floor are the owner's standing instructions, which
the starter names: read them there, never from memory (§1). What they leave to you:

- **The re-audit's agent wrote none of the fixes.** Batch re-auditors by blast-radius overlap
  ([the brief template](agent-brief-template.md)).
- **A document or plan re-audit walks the previous audit's findings one at a time** ([the brief
  template](agent-brief-template.md)) — for code the driven re-audit does this, for a document
  nothing does.
- **At many slices the lightening is the normal allocation and the full cycle the exception**
  ([register-template.md](register-template.md)), two rounds costing two agents a slice.

Incidents. A plan reached a fourth version where the cycle ended at the third, each extra audit
looking justified with a fresh list of findings. A chain of plan audits each read the plan afresh,
none confirming the previous findings had closed.

## 2. Before the first dispatch

Do these in this order. None is skippable.

1. **Build the file-ownership map, not a task list**, from every file each unit of work writes. A
   file two or more units write is a **hub**: one agent owns it and carries every unit's hunk for it
   as an ordered checklist. Everything else is a **leaf**, sits on nobody's critical path, and goes
   out at once. Cut agents by file and audits by unit of work.
2. **Name the couplings that are not file edges** — a script that parses another, a library several
   files source, a rule and the check enforcing it, and every **shared contract**: a message string,
   an exit code, a flag name that one file emits and another asserts. Coupled files share a wave and
   a re-auditor, because an edit to either can turn the other red after both agents have finished.
3. **The ownership map is the commit plan.** Fill the register's commit table now, its ordering
   constraints (§5) included, which survive a coordinator change only in writing.
   `.githooks/pre-commit` refuses a partly staged file only where prettier parses it — never a
   `.py`, `.sh` or Dockerfile — so two agents' hunks in one hub file are one commit, or they are
   separated by a commit boundary in time.
   **One session, one branch, one pull request** (the owner's standing instructions): a finding that
   seems to want its own branch is in scope and fixed here, or out of scope and a roadmap entry.
4. **Decide each slice's cycle now (§6)**, with its reason. Never decide it while reading findings.
5. **Enumerate the ending (§7)** so the dispatch floor has something to count.
6. **Write the register ([register-template.md](register-template.md)) before the first agent runs,
   naming the session's scratch path**, whose top
   level you own. **The session's one branch exists before the first agent runs** (CLAUDE.md §2);
   the register names it. Then send the owner batch.

Incidents. A plan cut into ten units and dispatched as ten agents ran almost serially because six
units wrote one file. Two agents took opposite sides of one contract while owning
different files throughout, so the map saw nothing.
