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
| about to change the tree, or to measure    | [§4](#tree-and-machine-are-shared)    |
| judging a landed report, or committing     | [§5](#5-commits-and-the-boundary)     |
| taking a slice through the audit cycle     | [§6](#6-the-cycle)                    |
| ending the session                         | [§7](#7-ending-the-session)           |
| planning a programme                       | [handoff](handoff-template.md)        |

**This page is a fixed budget, and nothing checks it.** Compaction keeps only its first 5,000 tokens
([USAGE.md](USAGE.md) has the why), so **add nothing without removing something of its size**: an
addition displacing nothing is paid for out of the end of the page. Whether the file is inside that
budget is **not established** — `wc -c` is the only proxy here, and tokenizing it would settle it.
**The physical order is for compaction, not chronology** — the table above reaches each section by
its moment, so §2 sits last, spent before the second agent runs. Compaction takes sections the table
still names; re-read them at `.claude/skills/orchestration/`. Each section closes with the incidents
that made its rules.

## 1. Starting, pausing or resuming

- **A fresh session reads the starter prompt's files in the order the starter gives before any work.
  A `resume` argument is a resume, and so is arriving with no instruction into a transcript already
  carrying this session's work; either way run [resume-prompt.md](resume-prompt.md) to its end
  before anything else.**
- **A quota stop costs exactly what the register does not hold.** Every edit on disk survives it;
  every finding an agent has not yet returned dies with it (§4), and so does your judgement since
  the last register edit. So the register's five-field **resume point**
  ([register-template.md](register-template.md)) is rewritten in the same edit as whatever it names,
  never saved for a wave boundary and never left until a stop looks close, since a stop that gives
  warning is the exception and an announced one gets one action only
  ([resume-prompt.md](resume-prompt.md)). **The resume point is this session continuing, never a
  handoff** ([handoff-template.md](handoff-template.md)).
- **Describe the owner's process only from a written source.** Before recording that a process lacks
  a step, check whether the step exists and you skipped it.
- **Send the owner every question as one batch before the first dispatch**, and each later one the
  moment it arises, never held for a wrap-up. **Settle it against the live system first:** an owner
  interrupted for nothing discounts the next.
- **A stretch nobody will answer is prepared before it starts**: a tripped prompt parks the fleet
  behind a dialog rather than failing fast. What to disable, on which axis, and how the change is
  undone without your remembering it, is [register-template.md](register-template.md).

Incidents. Owner latency is unbounded and gates whole branches of the schedule; asking one question
at a time was the largest avoidable delay in the programme. At a quota stop a coordinator hesitated
between a handoff and a resume-state; the resume-state carried the session. One session was stopped
twice, the second time with no warning at all.

## 5. Commits and the boundary

1. **A commit lands in the turn its report is judged**, from the register's commit table, and its
   audit is dispatched in the same action: a cycle that ends on a commit has skipped its last step.
   Neither waits for the wave boundary.
2. **Check every message against its own diff, never against the proposal it came from** — for
   every path in the diff, does the body account for it? Validate each with
   both routes [register-template.md](register-template.md) gives.
3. **Re-establish every fact in the message as you commit it**, never from the agent's report: an
   installed version, a remote setting or a file's presence moves between drafting and permanence.
   **A claim about the code is checked against that commit**, never against where the branch ends —
   the tooling claims being the ones nobody re-reads, two bodies having gone permanent asserting a
   drift that never happened and a flag that still existed. Qualify every blanket negative to what
   you checked — "nothing else is shared" missed a process-global two frames down.
4. **Order commits by what each commit's own checks can see**, never by what reads tidily. A citation
   resolves only once its file is tracked — `scripts/checks/docs_gate/checks.py` reads the working
   tree, so a document naming an untracked file passes locally and fails the CI checkout.
5. **At the boundary, reconcile the ownership map against the whole tree mechanically**, never by
   happening to read `git status`, with `git status --porcelain` and never `git diff --name-only`
   ([resume-prompt.md](resume-prompt.md) step 4). A path the map does not assign is a conflict
   incident and appears in no prose report. **A production file modified while no live agent owns
   it is a stranded plant until proven otherwise: ask its owner, never restore it** — a restore over
   a live drive corrupts the measurement and invites a re-plant.
6. **Push once per wave**, one _saved_ edit to a path [the brief](agent-brief-template.md) section 9
   names arming the full-form gate for the rest of the branch. Run it over a tree that has stopped
   moving ([resume-prompt.md](resume-prompt.md) step 6), and mid-wave ask only whether it reports a
   finding in the files you are about to commit. Read its exit code from the command itself
   (CLAUDE.md §2), past section 9's byte-masking trap.

Incidents. Commits first planned at hour four met fifty uncommitted files from twenty agents, and a
file five of them had edited became one commit. A commit landed carrying two agents' changes under
one agent's message, and nothing failed. Three items reached a commit with no audit at all, and only
the owner's question surfaced it. Nine implied full-form runs became four by pushing per wave.

## 7. Ending the session

**The dispatch floor.** You cannot see remaining context or quota, so a rule phrased as "keep enough
in hand" never fires. Bound the unassembled work instead: once what remains is one wave plus the
ending below, start nothing new.

The ending, in order:

1. Assemble the last wave (§5), run the gate at the branch's scope, open the draft pull request,
   print its link, and name the conclusion of every check it starts (CLAUDE.md §2).
2. **Write the handoff ([handoff-template.md](handoff-template.md)) from the material the register
   banked as reports landed, and have it audited by an agent that has seen none of the work**, then
   fix what the audit finds.
3. Write the next session's starter prompt beside the handoff as `START-<session>.md`
   ([USAGE.md](USAGE.md)). **Where a programme plan's handoff instructions differ from this skill's,
   this skill wins; where this skill differs from `.claude/CLAUDE.md` or the owner's standing
   instructions, this skill is wrong and is fixed here.**

Incidents. A session that spent everything on dispatch ended with sixteen commits, an unpushed branch
and no pull request.

## 3. Every dispatch

Run it for every agent, the fifteenth as much as the first.

1. **Read the live-agent table.** Is a live agent already covering this question? Resume it rather
   than start a fresh one, which hands you a second conclusion to drive. A resumed agent re-enters
   its partition — check its files are still free.
2. **Diff this brief's file list against every live agent's, path by path.** Nothing mechanical sees
   two owners, and a dispatch held in mind by its task rather than its paths is one where this diff
   never gets run ([register-template.md](register-template.md)). A file two agents must share is
   written into both briefs, each naming the other's region ([the brief](agent-brief-template.md)
   section 1).
3. **Sum against the budget** — the live count and this agent — and never dispatch blind. **A raised
   cap is a number, not a suspension**, and the sum lapses exactly when requests arrive faster than
   agents finish, each justified alone. **No agent spawns sub-agents**
   ([the brief](agent-brief-template.md) section 6): where a question needs a fresh agent, you
   dispatch it.
4. **Brief from [agent-brief-template.md](agent-brief-template.md)**, every section, with the file
   list in full and the scratch path written out. Its section 14(e), what in this brief was wrong,
   is answered even where nothing was: a premise worked around in silence returns in your next
   brief.
5. **Dispatch a judging auditor as `cold-auditor`.** A re-auditor that must plant needs a shell and
   goes as `general-purpose`, read-only by prose alone. Each has its form in
   [the brief](agent-brief-template.md), which also checks the brief's verbs against the type's
   tools.
6. **Record the dispatch in the register before it runs.** One working tree, never worktrees.

Incidents. Work went twice to a fresh agent a live one already covered. An audit whose only decisive
test was a fresh agent, and whose brief forbade subagents, spent its dispatch to report "unsettled";
a two-line probe settled it in four minutes. Worktrees cost more in cherry-picks, cleanup and
per-tree installs than they bought.

## 4. Running the fleet

- **Check the live count against the cap before every reply, and end the reply with the gauge that
  proves you did:** `Fleet: 3 of 20, two queued behind the gate commit.` No clause explaining a
  blockage: that belongs in the reply's prose where the reader needs it. **It is never dropped and
  never dissolved into the prose**, least of all in the turn it feels most redundant. The owner
  asking about parallelism is a defect report, never a question.
- **Dispatch before you read, and before you reply.** A landed report frees a slot, and the queue's
  next standing action fills it before the report is opened.
- **Your own serial work is a dispatch** once it needs more than a minute and none of your context —
  a commit message, the partition, report condensation, the pull request body, the handoff draft;
  you judge the output — **and below that it stays yours**, a two-comment repair dispatched at the
  cap having cost a brief, a report and a slot with parallel work behind it. **Quoting your own
  serial time to the owner is the moment to run this rule on it**, which is where it goes unapplied.
- **Verify agents have stopped by listing them** ([resume-prompt.md](resume-prompt.md) step 3).
- **Bank each verdict into the register in the turn it lands, and size a brief by what losing its
  whole output costs** — a report is the agent's final message and there is no second copy of it
  anywhere ([register-template.md](register-template.md)).
- **Verify every count, file list and exit code in a report yourself.** Compare the files it says it
  touched against `git status --porcelain`, and read committed state with
  `git show HEAD:<path>` — while agents write, the working tree is not evidence. Route one agent's
  conclusion to another as a claim with its source named, never as a premise; your own inference,
  stated one notch wider than its evidence, reaches an agent as fact. **A figure carries its
  provenance to its next reader** — measured by you, reported by an agent, or estimated
  ([the brief](agent-brief-template.md)).
  When two agents disagree about one file, drive the difference — never pick a side, never average.
- **A claim about what the tooling permits is banked only once something has attempted it** — ask
  which command was run, and read its success as evidence about that command and no wider class; a
  green on a check nobody drove is not evidence either.
- **A checker's exit code omits every finding it merely reports**, so read the output: an over-long
  commit subject and an over-long pull request summary each come back at 0.
- **Route every out-of-scope finding in the turn you read it**, from the report's separately headed
  list: an owner, a roadmap entry, or a check where the class is mechanically detectable, and say
  which each got. Reports rank findings by their author's scope, so the one that matters is rarely
  first. **Route at the class, never at the instance reported** — told one shared file had been
  overwritten, a coordinator protected that kind of file alone and lost four agents' commit messages
  in the same directory a wave later.
- **[The brief](agent-brief-template.md) sections 8, 9 and 13 — plant-and-restore, the traps and the
  siblings test — bind you as they bind an agent.**

Incidents. The owner demanded full parallelism five times in one session, and each time three to
five dispatchable items were waiting on the coordinator's reading. An agent's own uncommitted
edit was quoted back at it as evidence and it was stood down on that. Six commit subjects over the
target cost a full branch replay, the checker having reported every one.

### Tree and machine are shared

- **Grant an exclusive window rather than let a break-and-restore loop run against the shared tree**
  ([the brief](agent-brief-template.md) section 8), and quiesce the fleet before granting it: a
  benchmark that edited, timed and restored a gate module failed every overlapping suite run on
  something unrelated, and a cold audit's gravest finding inside such a window is as plausibly this
  as real.
- **Record every open plant-and-restore window in the register**, so red seen elsewhere inside that
  window is attributed there before it is believed; an unattributed one discounts the next genuine
  finding of that shape.
- **A guard, a hook registration or a manifest changes what every other agent may do** ([the
  brief](agent-brief-template.md) section 10), so it takes an exclusive window even at one line, and
  **two agents reporting one out-of-scope failure is one such change rather than two findings.**
- **Every figure a fleet takes is an upper bound, and its spread is contention rather than the
  change** — one command timed three times read 15.7s, 18.1s and 105.4s. Refuse a bare number, and
  re-take on a quiet machine, fleet listed and stopped, any figure a decision rests on. **A measured
  whole exceeding the arithmetic of its parts is a serialisation nobody has named**, so chase that
  gap before optimising anything inside it.

## 6. The cycle

**research/think → implement → audit → fix → re-audit → fix → END.** Its length, its ending on a
fix, the re-audit's subject and the lightening floor are the owner's standing instructions, which
the starter names: read them there, never from memory (§1). What they leave to you:

- **The re-audit's agent wrote none of the fixes**, and re-auditors batch by blast-radius overlap
  ([the brief](agent-brief-template.md)).
- **A document or plan re-audit walks the previous audit's findings one at a time** ([the
  brief](agent-brief-template.md)) — for code the driven re-audit does this, for a document nothing
  does.
- **Allocate the audits to the seams, never one per slice** — across blocks, across commits, and the
  one or two artefacts where a wrong claim is expensive and invisible. A defect living between the
  pieces is in no piece's diff, so a slice several agents built in parallel is audited whole:
  per-slice reads confirmed four sweeps and found nothing, while cross-block and cross-commit
  questions found 58 groups of duplicated prose and two false claims already permanent in commit
  bodies.
- **At many slices the lightening is the normal allocation and the full cycle the exception**
  ([register-template.md](register-template.md)).

Incidents. A plan reached a fourth version where the cycle ended at the third, each extra audit
looking justified with a fresh list of findings. A chain of plan audits each read the plan afresh,
none confirming the previous findings had closed.

## 2. Before the first dispatch

Do these in this order. None is skippable.

1. **Cut the session's one branch (CLAUDE.md §2) before the first read**: every step below reads
   the repository.
2. **Enumerate the population from the tree by command, and tick every slice off against that
   listing.** A queue written from what agents reported touching covers what agents reported
   touching, and no check asks whether a file was considered: seven files, one the corpus's largest
   page, went unswept while every slice truthfully reported itself complete. Measure across the
   whole set in the same pass, duplication above all (§6).
3. **Build the file-ownership map, not a task list**, from every file each unit of work writes. A
   file two or more units write is a **hub**: one agent owns it and carries every unit's hunk for it
   as an ordered checklist. Everything else is a **leaf**, sits on nobody's critical path, and goes
   out at once. Cut agents by file and audits by unit of work.
4. **Name the couplings that are not file edges** — a script that parses another, a library several
   files source, a rule and the check enforcing it, and every **shared contract**: a message string,
   an exit code, a flag name that one file emits and another asserts. Coupled files share a wave and
   a re-auditor, because an edit to either can turn the other red after both agents have finished.
5. **The ownership map is the commit plan.** Fill the register's commit table now, its ordering
   constraints (§5) included, which survive a coordinator change only in writing.
   `.githooks/pre-commit` refuses a partly staged file only where prettier parses it — never a
   `.py`, `.sh` or Dockerfile — so two agents' hunks in one hub file are one commit, or they are
   separated by a commit boundary in time.
   **One session, one branch, one pull request** (the owner's standing instructions): a finding that
   seems to want its own branch is in scope and fixed here, or out of scope and a roadmap entry.
6. **Decide each slice's cycle now (§6)**, with its reason. Never decide it while reading findings.
7. **Enumerate the ending (§7)** so the dispatch floor has something to count.
8. **Write the register ([register-template.md](register-template.md)) before the first agent
   runs**, naming step 1's branch and the session's scratch path, whose top level you own. Then send
   the owner batch.

Incidents. A plan cut into ten units and dispatched as ten agents ran almost serially because six
units wrote one file. Two agents took opposite sides of one contract while owning
different files throughout, so the map saw nothing.
