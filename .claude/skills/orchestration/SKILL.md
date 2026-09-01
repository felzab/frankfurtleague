---
name: orchestration
description: Coordinating a long multi-agent session — planning file ownership before dispatch, keeping a fleet of subagents at maximum safe parallelism, owning every commit, judging agent reports, running the audit cycle to its stopping rule, and handing off between sessions. Use when work needs more than a handful of subagents, when parallelism has collapsed to one agent at a time, when several agents' edits must be assembled into commits and a pull request, when planning a multi-session programme, or when resuming a session that was paused, killed, or stopped for quota.
---

# Coordinating a multi-agent session

You are the coordinator. Agents write files; you own every commit, every routing decision, and every
claim that reaches a permanent artefact. This page is written to be opened at one section rather than
read through.

| Section                                                           | Answers                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------- |
| [1. Before you dispatch](#1-before-you-dispatch-anything)         | Who owns which file, and what the commits will be       |
| [2. Holding parallelism](#2-holding-parallelism)                  | Why the fleet drains, and what refills it               |
| [3. Briefing](#3-briefing-an-agent)                               | What every brief carries, and why agents must push back |
| [4. The register](#4-the-register)                                | Where fleet state lives instead of your memory          |
| [5. The cycle](#5-the-cycle-and-where-it-stops)                   | Research, implement, audit, fix, re-audit, fix, end     |
| [6. Judging a report](#6-judging-a-report-an-agents-and-your-own) | How to detect that an agent — or you — is wrong         |
| [7. Assembly](#7-assembly-commits-gate-pull-request)              | Commits, gate scope, the pull request                   |
| [8. Across sessions](#8-across-sessions)                          | Programme shape, handoffs, resume                       |
| [9. Traps](#9-traps-that-produced-a-confident-wrong-answer)       | Mechanisms that answered wrongly with nothing failing   |

Supporting files, all beside this one: [agent-brief-template.md](agent-brief-template.md),
[register-template.md](register-template.md), [handoff-template.md](handoff-template.md),
[resume-prompt.md](resume-prompt.md).

Every incident cited below happened in this repository, recorded 2026-09-01. They are here because
the rule they carry is hard to believe without them.

## 1. Before you dispatch anything

**Parallelism's ceiling is the number of disjoint file groups, not the agent cap.** A plan cut into
ten units of work and dispatched as ten agents runs almost serially when six of those units write one
file. Peak useful implement parallelism here measured out at eight to twelve agents, set by the file
map; the concurrency cap binds only in read-only audit waves.

So the first artefact is a **file-ownership map**, not a task list.

1. List every file each unit of work writes. A file two or more units write is a **hub**; everything
   else is a **leaf**, sits on nobody's critical path, and can be dispatched early.
2. **Cut agents by file, audits by unit of work.** One agent owns one hub file and carries every
   unit's hunk for it as an ordered checklist. Auditors stay per unit and see none of the writing,
   which is what the audit discipline actually protects. Nothing is weakened by this regrouping.
3. Watch for couplings that are not file edges — a script that parses another script, a library
   several files source. Two files coupled that way share a wave and share a re-auditor, because an
   edit to either can turn the other red **after both agents have finished**.

**Assembly cost is set here, not at the end.** `.githooks/pre-commit` refuses a file staged in part,
so two agents' hunks in one hub file are one commit, or they are separated by a commit boundary in
time. Decide the commit structure at the same moment you decide file ownership. That is the whole fix
for a session that spends its back end reassembling commits and pull requests.

**Send the owner every question you have as one batch, before the first dispatch.** Owner latency is
unbounded and gates whole branches of the schedule; asking one question at a time was the single
largest avoidable delay in this programme. Anything that arises later is raised at the moment it
arises, never saved for a wrap-up.

## 2. Holding parallelism

The fleet drains because dispatching is work and the coordinator is busy doing something else. The
mechanisms that keep it full:

- **Plan every dispatch against the concurrency budget before sending it.** Know the cap, know the
  live count, never dispatch blind.
- **Give every agent an explicit sub-agent cap, and sum the caps against the budget first.** The
  default is **zero**. Unbounded fan-out took 28 of 40 slots twice, blocked everything queued behind
  it, and one nested helper never returned, leaving a claim unverified.
- **Keep a standing-action list in the register** — queued work paired with the condition that
  releases it, such as _dispatch when the fleet is under twenty_. Write the whole brief there when you
  queue it, not a note to write one later. A standing action still needs checking: one here was
  recorded correctly and never dispatched, and only the handoff caught it.

**Verify agents have stopped by listing them**, never by assuming and never by killing a parent —
killing a parent does not kill its children. A measurement or a gate run taken while unlisted agents
still edit the tree measures a tree nobody controls.

**Stop starting before you run out of room to finish.** A session that spends everything on dispatch
dies holding unassembled work, and the next session inherits a mess rather than a handoff. This one
ended with sixteen commits, an unpushed branch and no pull request, which became the first item its
handoff owed the owner.

**This cannot be applied as a budget reserve.** A coordinator cannot see its remaining context or
quota, and an owner's pause is not predictable, so a rule phrased as _keep enough in hand_ has no
moment at which it fires. Bound the **unassembled work** instead, which the register does show:

- **Commit each wave before dispatching the next**, so stopping at any moment costs one wave rather
  than the session.
- **Write the handoff incrementally**, into the register as findings land, so ending the session is
  an edit rather than a task.
- **Enumerate the ending before dispatching what you believe is the last wave.** Assembly, the gate
  run, the pull request, the handoff and its independent audit are countable where the budget is
  not. Once what remains is one wave plus that ending, start nothing new.

## 3. Briefing an agent

The brief template, and the auditor variant, are in
[agent-brief-template.md](agent-brief-template.md). The sections carrying most of the value:

- **Ownership.** The exact files this agent may write, listed in full, plus how many agents are
  editing the tree concurrently. Writing any other file is a defect in the brief, to be reported
  rather than worked around.
- **Push back.** _This brief may be wrong; say so rather than building on it._ Seven briefs in one
  session were materially wrong and the agents caught all seven. It is the highest-yield sentence in
  any brief, and an agent correcting you is the system working, not a failure of it.
- **The report contract.** What could **not** be verified and why, and anything found outside scope
  described rather than fixed. The best reports here said "not measurable" over a number nobody trusted.

**Agents run no git command that writes** — no `add`, `commit`, `checkout`, `stash`, `reset`.
Concurrent `git add` in one tree corrupts the index. Each agent instead writes a **proposed commit
message** to a scratch file as it works, and you commit in waves. That one convention is what keeps
the coordinator from becoming the whole bottleneck.

**Make the read-only half structural where it can be.** A sentence in a brief is the weakest
enforcement there is: one auditor stages a file and the index is corrupted for every concurrent
agent. A project agent type at `.claude/agents/<name>.md` carries a `tools` allowlist, and an agent
defined without `Write`, `Edit` or `Bash` cannot write whatever its brief says; leaving `Agent` off
the list is also what turns §2's sub-agent cap of zero from a request into a fact. The documented
fields are `tools` and `disallowedTools`.

**That reaches the cold reader, not the driving re-auditor.** An auditor that judges a diff or a
document needs `Read`, `Grep` and `Glob` and nothing else. One that _drives_ a check must plant a
violation and restore it, so it needs a shell, and nothing documented grants a shell while
constraining which commands it may run. For that agent the prose rule is the only control, so it
stays in every brief regardless.

**Agents work in one working tree, never in separate worktrees.** Cherry-picking between worktrees
plus the cleanup costs more than the parallelism buys, and each needs its own dependency install.

## 4. The register

With a large fleet, your memory of what each agent is doing is the weakest component in the system.
The register is the source of truth instead: every dispatch recorded **before** it runs, every report
landing at a known path, nothing carried between turns in your head. Template:
[register-template.md](register-template.md).

**The rule that keeps it cheap:** an agent's condensed final message is what you read into context;
its full report stays on disk and is opened only when a specific fix needs the detail.

**Read the live-agent table before every dispatch, not only when reconciling.** §1's ownership map
does not catch duplicated work: two agents can investigate one question while writing different
files, or no files at all. It happened twice in this session — work went to a fresh agent that a
live one was already covering.

**Prefer resuming the live agent to starting a new one.** The asymmetry is what makes this cheap:
resuming keeps the context that agent has already paid for, while a fresh agent buys it again and
then hands you a second independent conclusion on the same question — a disagreement you must drive
(§6.7) rather than an answer. Where the question really is new, say which live agent came closest
and why it does not cover it.

## 5. The cycle, and where it stops

**research → implement → audit → fix → re-audit → fix → end.** Keep it. The properties that make it
work, each easy to lose:

**The re-audit's subject is the fixes and their blast radius**, not the original work again. It is run
by an agent that did not write the fixes, it takes each fix one at a time, and it **drives** each one
rather than reading it — reporting real exit codes and what the fix broke elsewhere. The evidence that
this is not ceremony: a fix round in this programme introduced a **live false green**, a wrapper that
turned a tripped failure into a clean report and exit 0 in three scripts, and the re-audit caught it
after three agents had reviewed that same code without seeing it. Reviewing never found it; a fourth
agent _drove_ it and found it at once.

**What is bounded is the number of audits — two — not the findings.** That is the stopping rule.
Decide it when you plan the unit of work, **never while you are reading findings**: holding a fresh
list, another round always looks worth it, each extra audit looks justified in isolation, and the
accumulated cost is invisible. A coordinator that keeps ordering one more audit is not being
thorough; it is failing to apply the cycle's own stopping rule. Here that produced a fourth version
of an execution plan where the third was the last one the cycle called for.

**Every audit is followed by its fix round, the last one included — the cycle ends on a fix, never on
an audit.** Ending on an audit ships an artefact with findings you have already read, which is the
one outcome auditing exists to prevent. A finding inside the unit's scope is fixed whichever round
surfaces it. A finding genuinely **outside** its scope is filed at once as a roadmap entry instead —
that is a judgement about scope and never about timing, and blurring the two is how "we are past the
last round" becomes a reason not to fix something.

**One gap this cycle genuinely has, and it is on the document side only.** A chain of plan audits each
read the plan afresh, and none walked the **previous** audit's findings to confirm each had closed.
For code the drive-each-fix re-audit already answers that; for a document or a plan, nothing does. Add
one explicit step to a document re-audit: take the prior audit's findings one at a time and say, for
each, closed or open, with the evidence.

## 6. Judging a report: an agent's and your own

1. **Verify every quantitative claim yourself** — counts, file lists, exit codes. A count in prose is
   the first thing to go stale: a paragraph naming twelve test modules was wrong because there were
   fourteen; a collected test count moved through four values while agents were reading it; one
   audit's brief was half the round's real size because two files landed mid-audit. **Name the
   things; do not stamp the total.**
2. **Compare the report's list of files touched against `git diff --name-only`** at every wave
   boundary. It is the only cheap total check available, and a file outside an agent's allocation is
   a conflict incident that is invisible in any prose report.
3. **While agents are writing, the working tree is not evidence.** Read `git show HEAD:<path>` for
   committed state. The incident: a config file was read from the worktree while eight agents edited
   it, the text quoted as evidence turned out to be an agent's own uncommitted edit, an agent was
   stood down on that basis, and a later break-and-restore leaked 8 of 36 cases.
4. **Never relay a finding without its evidence.** Route one agent's conclusion to another as _a
   claim, with its source named, to be verified_ — never as a premise. A wrong premise travels
   quietly along the coordinator's routing and ends up in a permanent artefact.
5. **Your own conclusions are the more dangerous half of rule 4.** An inference of yours, stated one
   notch more broadly than its evidence supports, reaches an agent as fact and carries your
   authority. Say what your evidence covers and what it does not. Three times in one session a
   coordinator here reported a defect in the owner's process that was in fact its own departure from
   that process — the same error each time, each stated confidently enough to have been written into
   a permanent artefact, and each caught only because the owner knew their own instruction. **That is
   the argument for writing a process down explicitly and checking claims against the written
   version**, which is what this page is for.
6. **Before recording that a process is missing a step, check whether the step exists and you skipped
   it.** This is rule 5's most common concrete shape.
7. **When two agents disagree about one file, drive the difference.** Do not pick a side, and do not
   average them.
8. **A green report on a check nobody drove is not evidence.** Break and restore: plant the
   violation, see it red, restore, see it green, recording the exit code at each step. Every false
   green in this repository's record was a status-carrying bug rather than a semantics bug, and
   reading the check cannot see one.
9. **Only the gate's own invocation counts.** A checker read by hand, in a tree several agents are
   editing, describes a tree that has already moved on by the time you act on it.

## 7. Assembly: commits, gate, pull request

- **One branch, commits by theme, one draft pull request.** Agents propose messages; you write the
  commit.
- **Check every commit message against its own diff, never against the proposal it came from.** The
  moment you take one agent's message while staging another agent's files, the body describes a
  subset of what you are recording. The check is mechanical and cheap: for every path in the diff,
  does the body account for it? Run it before you push, not after.
- **Push once per wave, not once per unit of work.** Here the first edit to a shell script or a
  workflow arms the full-form gate with images for the rest of the branch, so a per-unit push costs a
  full-form run every time; nine implied runs became four needed ones.
- **After that arming edit there is no cheap narrow gate run** — a narrow scope is _refused_, not
  merely advised. Agents iterate with the underlying tools; the gate is a wave-boundary instrument.
- **Report the real exit code**, taken from the command and never through a pipe, and never the word
  "passing".

## 8. Across sessions

**Plan in a separate session.** It produces two artefacts: the programme plan, and the starter prompt
for session one. The plan lays out the whole path — each session's scope, its dependencies and its
exit condition — so no later session has to re-derive the shape under pressure.

**Each session writes a handoff for the next and has that handoff independently audited** by an agent
that has seen none of the work. **One pull request per session.** Size a session so it is worth its
own branch and does not exhaust its context; where a phase needs its own verification verdict, give
it its own session and pull request so that verdict stands alone.

A handoff answers a different question from a transcript: **what the previous session believed.** That
is what stops a finding arriving with its premise garbled. Required content and shape:
[handoff-template.md](handoff-template.md).

**Resuming after a pause, a kill or a quota stop:** [resume-prompt.md](resume-prompt.md), written to
be pasted verbatim.

## 9. Traps that produced a confident wrong answer

Each of these returned a wrong answer with nothing failing.

- **An exit code read through a pipe is the pipe's** — the status belongs to the last command in the
  pipeline, not yours. It produced a false zero here.
- **Bash masks a child exit code to a byte**, so 2304 reads as 0.
- **A compound command that is the left operand of `||` runs with errexit and the ERR trap
  disabled**, and the suppression propagates into subshells and into any function called from there.
  Every capture of the form _run, or record the status_ is therefore blind to a trap-based failure.
- **A Windows text-mode stream turns every newline into CRLF invisibly** — including in a scratch
  file made only to measure something. Write bytes, or pass an explicit empty newline argument.
- **A commit SHA on a live branch is not an identifier.** A sixteen-commit branch was rebuilt twice
  inside six minutes and every SHA changed. Cite commit subjects and re-derive.
- **A stale virtual environment is an ordinary state, not an edge case.** A lockfile change nobody
  synced gave an internal error at exit 3 on every test run. Sync before measuring anything.
- **Blast radius is where the danger lives.** Making one check stricter turned twelve comment blocks
  red across three files after their authors had finished, and one of the false greens in this
  repository's record was introduced by a fix to the very file being fixed.
