---
name: orchestration
description: Coordinating a long multi-agent session — planning file ownership before dispatch, keeping a fleet of subagents at maximum safe parallelism, owning every commit, judging agent reports, running the audit cycle to its stopping rule, and handing off between sessions. Use it whenever work needs more than a handful of subagents, when parallelism has collapsed to one agent at a time, when several agents' edits must be assembled into commits and a pull request, when planning a multi-session programme or writing its starter prompt, when writing or auditing a handoff, or when resuming a session that was paused, killed, or stopped for quota — even when nobody named the skill.
---

# Coordinating a multi-agent session

You are the coordinator. Agents write files; you own every commit, every routing decision, and every
claim that reaches a permanent artefact. Each section closes with the incidents that made its rules,
every one measured in this repository between August and September 2026.

| You are…                                   | Read                                 |
| ------------------------------------------ | ------------------------------------ |
| starting or resuming a session             | [§1](#1-starting-or-resuming)        |
| about to dispatch the first agent          | [§2](#2-before-the-first-dispatch)   |
| about to dispatch any agent                | [§3](#3-every-dispatch)              |
| running the fleet and reading its reports  | [§4](#4-running-the-fleet)           |
| about to let an agent change the tree      | [§4](#a-fleet-shares-one-tree)       |
| about to measure anything                  | [§4](#measuring-on-a-shared-machine) |
| at a wave boundary                         | [§5](#5-the-wave-boundary)           |
| taking a slice through the audit cycle     | [§6](#6-the-cycle)                   |
| ending the session                         | [§7](#7-ending-the-session)          |
| planning a programme                       | [handoff](handoff-template.md)       |
| about to trust a number, a green, or a SHA | [§8](#8-traps)                       |

The templates beside this one are opened where a section names them; [USAGE.md](USAGE.md) is how this
skill loads and how a session starts or resumes.

**This page is a fixed budget, and nothing checks it.** Compaction keeps only its first 5,000 tokens
([USAGE.md](USAGE.md) has the why), so an addition displacing nothing is paid for out of §8, the last
section, leaving a coordinator blind to what it lost. Whether it is inside that budget is **not
established**: nothing here measures tokens, `wc -c` is the only proxy, and tokenizing the file would
settle it. Until then, add nothing without removing something of its size.

## 1. Starting or resuming

- **A fresh session reads the starter prompt's files in the order the starter gives before any work;
  a resumed one runs [resume-prompt.md](resume-prompt.md) to its end before continuing anything.** A
  resume point is a state you can prove — the last commit, the register, a real exit code — never a
  state you remember.
- **Describe the owner's process only from a written source.** Before recording that a process lacks
  a step, check whether the step exists and you skipped it.
- **Send the owner every question as one batch before the first dispatch**, and each later one the
  moment it arises, never held for a wrap-up. **Settle it against the live system first:** an agent's
  escalation here died to a single command, and an owner interrupted for nothing discounts the next.

Incidents. A coordinator made three consecutive claims about the owner's process, each inferred from
watching the session and each wrong. Owner latency is unbounded and gates whole branches of the
schedule; asking one question at a time was the largest avoidable delay in the programme.

## 2. Before the first dispatch

Do these in this order. None is skippable.

1. **Build the file-ownership map, not a task list**, from every file each unit of work writes. A
   file two or more units write is a **hub**: one agent owns it and carries every unit's hunk for it
   as an ordered checklist. Everything else is a **leaf**, sits on nobody's critical path, and goes
   out at once. Cut agents by file and audits by unit of work — auditors stay per unit and see none
   of the writing.
2. **Name the couplings that are not file edges** — a script that parses another, a library several
   files source, and every **shared contract**: a message string, an exit code, a flag name that one
   file emits and another asserts. Coupled files share a wave and a re-auditor, because an edit to
   either can turn the other red after both agents have finished.
3. **Decide the commit structure now**, and write its ordering constraints (§5) into the map beside
   it — they are invisible until looked for and survive a coordinator change only in writing.
   `.githooks/pre-commit` refuses a file staged in part, so two agents' hunks in one hub file are one
   commit, or they are separated by a commit boundary in time.
4. **Decide each slice's cycle now (§6)** — the full two rounds by default, or a lightening the plan
   names with its reason. Never decide it while reading findings.
5. **Enumerate the ending (§7)** so the dispatch floor has something to count.
6. **Write the register ([register-template.md](register-template.md)) before the first agent runs,
   naming the session's scratch path** — outside the repository, with a subdirectory per agent named
   for that agent, because agents sharing one directory overwrite each other in it. You own its top
   level. Then send the owner batch.

Incidents. A plan cut into ten units and dispatched as ten agents ran almost serially because six
units wrote one file; peak useful implement parallelism measured out at eight to twelve agents, while
the concurrency cap bound only in read-only audit waves. Two agents took opposite sides of one
contract, one rewording a guard's messages and the other asserting the old wording, owning different
files throughout, so the map saw nothing.

## 3. Every dispatch

Run it for every agent, the fifteenth as much as the first.

1. **Read the live-agent table.** Is a live agent already covering this question? Resume it rather
   than start a fresh one: resuming keeps the context that agent has paid for, while a fresh one buys
   it again and hands you a second conclusion to drive. A resumed agent re-enters its partition —
   check its files are still free.
2. **Diff this brief's file list against every live agent's, path by path.** Two agents were handed
   one module, one rewriting its imports while the other edited cases inside it, and only luck kept
   both edits. Where a file must be shared, each brief names who else is in it and which region is
   theirs, and every edit anchors on a unique fragment so a stale one fails loudly.
3. **Sum against the budget** — the live count, this agent, and its sub-agent cap, **zero** unless
   you say otherwise. Never dispatch blind.
4. **Brief from [agent-brief-template.md](agent-brief-template.md)**, every section, with the file
   list in full and the scratch path and report file written out.
5. **Dispatch a judging auditor as `cold-auditor`** — its definition gives it no `Edit`, `Bash` or
   `Agent` and a hook refuses its `Write` inside the repository, while it still writes its report to
   the scratch path. **So put no shell command, no plant and no exit code in its brief**: send the
   template's **cold form**, which replaces the read rule too, since an agent told to read committed
   state with no shell to read it substitutes the working tree. A re-auditor that must plant needs a
   shell, so it goes as `general-purpose` under the **driving form**, read-only by prose alone.
   **Read-only and no-subagents are two different rules** — name the instrument that settles the
   question, then pick a type that allows it.
6. **Record the dispatch in the register before it runs.** One working tree, never worktrees.

Incidents. Work went twice to a fresh agent a live one was already covering, and twice more two
agents were sent to prove the same negative under different subject headings. An audit whose only
decisive test was a fresh agent, and whose brief forbade subagents, spent a whole dispatch to report
"unsettled"; a two-line probe settled it in four minutes. Unbounded fan-out took 28 of 40 slots
twice, and one nested helper never returned. Worktrees cost more in cherry-picks, cleanup and
per-tree installs than the parallelism bought.

## 4. Running the fleet

- **The fleet drains because dispatching is work and you are busy.** One agent running while queued
  work exists is a defect. Refill a slot the moment a report lands, keep the queue as standing
  actions in the register, and fan out reading as you fan out writing.
- **Verify agents have stopped by listing them.** Killing a parent does not kill its children.
- **A report is the agent's final message, not its files**, and the file it wrote as it went is what
  survives a kill.
- **Read a report this way.** Verify every count, file list and exit code yourself. Compare the files
  it says it touched against `git status --porcelain`, and read committed state with
  `git show HEAD:<path>` — while agents write, the working tree is not evidence. Route one agent's
  conclusion to another as a claim with its source named, never as a premise; your own inference,
  stated one notch wider than its evidence, reaches an agent as fact. When two agents disagree about
  one file, drive the difference — never pick a side, never average.
- **A claim about what the tooling permits is banked only once something has attempted it** — ask
  which command was run. An agent reasoned from an agent definition that the harness forbids a
  subagent to write a report file, rewrote the report contract around it, and was wrong while three
  sibling files still said the opposite. Where a change leaves one document contradicting its
  siblings, the siblings are the evidence against it, not a tidying job.
- **Route every out-of-scope finding in the turn you read it**, from the report's separately headed
  list: an owner or a roadmap entry each, and say which each got. Reports run to thousands of words
  and rank findings by their author's scope, so the one that matters is rarely ranked first.
- **A green on a check nobody drove is not evidence**: plant, see red, restore, see green, exit code
  at each step. The plant-and-restore discipline in
  [the brief template](agent-brief-template.md) section 8 binds you too.

Incidents. An agent's own uncommitted edit was quoted back at it as evidence and it was stood down on
that. Every false green in this repository's record was a status-carrying bug, which reading cannot
see and driving finds at once.

### A fleet shares one tree

A change to a file is a change to every other agent's inputs, and it surfaces as somebody else's
inexplicable failure.

- **Nothing runs a break-and-restore loop against the shared tree.** A benchmark edited a gate
  module, timed it and restored it, repeatedly — correct alone, destructive here: every suite run
  overlapping the loop failed for reasons unrelated to its own subject. Two agents reported spurious
  red, and a cold audit's most alarming finding, a suite failing three runs in ten and once missing a
  planted defect, is as plausibly this as a real defect. A measurement that mutates a file runs
  against a copy outside the tree; where it genuinely cannot, the agent asks you for an exclusive
  window and you quiesce the fleet before granting it.
- **Record every open plant-and-restore window in the register and require it in the agent's
  report**, so red seen elsewhere inside that window is attributed there before it is believed. The
  lasting cost of an unattributed one is that the next genuine finding of that shape gets discounted.
- **A guard, a hook registration or a manifest changes what every other agent may do**, not only what
  it measures, so it takes an exclusive window even at one line. Two agents reporting the same
  out-of-scope failure is one such change, not two findings: a version pin one agent added made every
  other agent's gate invocation refuse, and four reported it separately.

### Measuring on a shared machine

- **Every figure a fleet takes is an upper bound, and its spread is contention rather than the
  change** — one command timed three times read 15.7s, 18.1s and 105.4s. Refuse a bare number, and
  re-take on a quiet machine, fleet listed and stopped, any figure a decision rests on. What agents
  do at the point of measurement is [the brief template](agent-brief-template.md) section 12.
- **When a measured whole exceeds the arithmetic of its parts, that gap is the finding.** Two units
  running concurrently, each about a minute, inside a section taking ninety seconds is not a slow
  unit; it is a serialisation nobody has named. Nine agents measured around that gap and the owner
  asked about it. Chase it before optimising anything inside it.

## 5. The wave boundary

1. **Reconcile the ownership map against the whole tree** — `git status --porcelain`, never
   `git diff --name-only`, which shows nothing an agent created and left unstaged. A path the map
   does not assign is a conflict incident and appears in no prose report. **Treat a production
   file modified while no live agent owns it as a stranded plant until proven otherwise, and ask its
   agent rather than restoring it** — a restore over a live drive corrupts that agent's measurement
   and invites a re-plant. Nothing in a working tree separates a disciplined ten-second plant from an
   abandoned one, so only the agent can answer, and a brief that named the files it may break is what
   makes the answer cheap. Run the check mechanically — the plant found this way was caught in the one
   moment somebody happened to be reading `git status`.
2. **Commit the wave before dispatching the next**, so stopping at any moment costs one wave rather
   than the session. Nothing enters a commit whose row in the register has an empty audit cell, and
   the audit filling that cell is dispatched in the same action as the decision to commit — a cycle
   that ends on a commit has skipped its last step. Agents propose messages; you write the commit.
3. **Check every message against its own diff, never against the proposal it came from** — for
   every path in the diff, does the body account for it? Validate each with
   `python scripts/check_commits.py --message-file <file>`, and keep the subject within 72 characters.
4. **Re-establish every environment fact in the message against the live system as you commit it**,
   never against the agent's report — an installed version, a remote setting or a file's presence
   moves between writing a message and its becoming permanent. One recorded a resolver version the
   branch's own new pin refuses; another asserted a missing allowlist entry that was already there,
   and would have sent the owner to change a correct setting. Qualify every blanket negative to what
   you checked: "nothing else is shared" missed a process-global two frames down, and that is exactly
   the sentence the next reader builds on.
5. **Order commits by what each commit's own checks can see**, never by what reads tidily. A citation
   resolves only once the file it names is tracked — `scripts/docs_gate/checks.py` resolves it
   against the working tree, so a document naming a still-untracked file passes locally and fails the
   CI checkout — and a workflow's version key resolves only once its manifest is committed.
6. **Stage a file that must execute with its mode, and read it back with `git ls-files -s`.**
   `core.fileMode` is false here, so a new file lands 100644 whatever the filesystem says, and a hook
   without the executable bit is skipped in silence on Linux.
7. **Push once per wave.** One _saved_ edit arming the images scope — [the brief
   template](agent-brief-template.md) section 9 names which paths do — arms the full-form gate for
   the rest of the branch, and a scope without it is refused rather than advised. Only the gate's own
   invocation counts, and only over a tree that has stopped moving — a run across a tree a fleet is
   writing exits non-zero on somebody's half-written file, so mid-wave the answerable question is
   narrower: does it report a finding in the files I am about to commit?

Incidents. A commit landed carrying two agents' changes under one agent's message; nothing failed,
and re-reading the body beside the diff found it. Three items reached a commit with no audit at all,
and only the owner's question surfaced it. Six subjects over 72 characters cost a full branch replay.
Nine implied full-form runs became four by pushing per wave.

## 6. The cycle

**research/think → implement → audit → fix → re-audit → fix → END** — the owner's, verbatim.

- **Fixed length: two audits and two fix rounds, then it ends** unless the owner asks for more, and
  **it ends on a fix, never on an audit** — the artefact that ships is the post-fix artefact. What is
  bounded is the number of audits, never the findings.
- **The re-audit's subject is the fixes and their blast radius**, never the original work again, and
  its agent wrote none of them. Batch re-auditors by blast-radius overlap
  ([the brief template](agent-brief-template.md)).
- **A finding inside the slice is fixed whichever round surfaces it.** Only a finding genuinely
  outside the slice's scope becomes a roadmap entry — a judgement about scope, never about timing.
- **A plan may lighten a slice it names, with its reason, to a floor of one audit and one fix**
  (owner ruling, 2026-09-02). Nothing is lightened by default; no slice ships on a cold read alone.
- **A document or plan re-audit walks the previous audit's findings one at a time**, closed or open,
  with the evidence — for code the driven re-audit answers this, for a document nothing does.

Incidents. A fix round introduced a live false green that three reviewers missed and the driven
re-audit caught. A plan reached a fourth version where the cycle ended at the third, each extra audit
looking justified alone with a fresh list of findings in hand. A chain of plan audits each read the
plan afresh, none confirming the previous audit's findings had closed.

## 7. Ending the session

**The dispatch floor.** You cannot see remaining context or quota, so a rule phrased as "keep enough
in hand" never fires. Bound the unassembled work instead: once what remains is one wave plus the
ending below, start nothing new.

The ending, in order:

1. Assemble the last wave (§5), run the gate at the branch's scope, open the draft pull request,
   print its link, and name the `verify` run's conclusion before the session ends (CLAUDE.md §2).
2. **Write the handoff ([handoff-template.md](handoff-template.md)) and have it audited by an agent
   that has seen none of the work**, then fix what the audit finds — the cycle applies to the handoff
   and ends on the fix. Write it incrementally into the register as findings land, so ending the
   session is an edit rather than a task.
3. Write the next session's starter prompt beside the handoff, named `START-<session>.md`, the name
   [USAGE.md](USAGE.md) tells the owner to paste — under any other it is a file the owner is sent to
   look for and cannot find. Keep one copy of each governing file beside it; a second diverges.

Incidents. A session that spent everything on dispatch ended with sixteen commits, an unpushed branch
and no pull request. A quota limit killed six agents at once: every file edit was on disk and
survived, every finding not yet written to one was gone. Two copies of the owner's instructions file
diverged on a ruling.

## 8. Traps

Each returned a confident wrong answer, nothing failing.

- **Bash masks a child's exit code to a byte**, so 2304 reads as 0 — beside CLAUDE.md §2's pipe rule,
  which is the same failure one layer up.
- **A commit SHA on a live branch is not an identifier** — a sixteen-commit branch was rebuilt twice
  inside six minutes. Cite subjects and re-derive.
