---
name: orchestration
description: Coordinating a long multi-agent session — planning file ownership before dispatch, keeping a fleet of subagents at maximum safe parallelism, owning every commit, judging agent reports, running the audit cycle to its stopping rule, and handing off between sessions. Use it whenever work needs more than a handful of subagents, when parallelism has collapsed to one agent at a time, when several agents' edits must be assembled into commits and a pull request, when planning a multi-session programme or writing its starter prompt, when writing or auditing a handoff, or when resuming a session that was paused, killed, or stopped for quota — even when nobody named the skill.
---

# Coordinating a multi-agent session

You are the coordinator. Agents write files; you own every commit, every routing decision, and every
claim that reaches a permanent artefact. Open this page at the moment you are in: each section opens
with its rules and closes with the incidents that made them. Every incident happened in this
repository between August and September 2026, and each rule is here because it was costly to relearn.

| You are…                                                | Read                               |
| ------------------------------------------------------- | ---------------------------------- |
| starting a session, or resuming after a pause or a kill | [§1](#1-starting-or-resuming)      |
| about to dispatch the first agent                       | [§2](#2-before-the-first-dispatch) |
| about to dispatch any agent                             | [§3](#3-every-dispatch)            |
| running the fleet and reading its reports               | [§4](#4-running-the-fleet)         |
| at a wave boundary                                      | [§5](#5-the-wave-boundary)         |
| taking a slice through the audit cycle                  | [§6](#6-the-cycle)                 |
| ending the session                                      | [§7](#7-ending-the-session)        |
| planning a programme                                    | [§8](#8-planning-a-programme)      |
| about to trust a number, a green, or a SHA              | [§9](#9-traps)                     |

Files beside this one, opened when a section names them: [agent-brief-template.md](agent-brief-template.md),
[register-template.md](register-template.md), [handoff-template.md](handoff-template.md),
[resume-prompt.md](resume-prompt.md), and [USAGE.md](USAGE.md) — how this skill loads, what survives
compaction, and the message sequence that starts or resumes a session.

## 1. Starting or resuming

- **A fresh session reads the starter prompt's files in the order the starter gives, before any
  work.** The owner's standing-instructions file the starter names wins over this page wherever the
  two differ.
- **A resumed session runs [resume-prompt.md](resume-prompt.md) to its end before continuing
  anything.** A resume point is a state you can prove — the last commit, the register, a real exit
  code — never a state you remember.
- **Describe the owner's process only from a written source.** Before recording that a process lacks
  a step, check whether the step exists and you skipped it.
- **Send the owner every question you have as one batch before the first dispatch.** A question
  arising later is asked the moment it arises, never held for a wrap-up.

Incidents. A coordinator made three consecutive claims about the owner's process — that a re-audit
does not cover the fixes, that the cycle has no stopping rule, that it may end on an audit — each
inferred from watching the session, each wrong, each the coordinator's own departure from the process,
and each caught only because the owner knew their own instruction. Owner latency is unbounded and
gates whole branches of the schedule; asking one question at a time was the largest avoidable delay
in the programme.

## 2. Before the first dispatch

Do these in this order. None is skippable.

1. **Build the file-ownership map, not a task list.** List every file each unit of work writes. A
   file two or more units write is a **hub**: one agent owns it and carries every unit's hunk for it
   as an ordered checklist. Everything else is a **leaf**, sits on nobody's critical path, and goes
   out at once. Cut agents by file and audits by unit of work — auditors stay per unit and see none
   of the writing.
2. **Name the couplings that are not file edges** — a script that parses another, a library several
   files source. Coupled files share a wave and a re-auditor, because an edit to either can turn the
   other red after both agents have finished.
3. **Decide the commit structure now.** `.githooks/pre-commit` refuses a file staged in part, so two
   agents' hunks in one hub file are one commit, or they are separated by a commit boundary in time.
4. **Decide each slice's cycle now (§6)** — the full two rounds by default, or a lightening the plan
   names with its reason. Never decide it while reading findings.
5. **Enumerate the ending (§7)** so the dispatch floor has something to count.
6. **Write the register ([register-template.md](register-template.md)) before the first agent
   runs**, and send the owner batch.

Incidents. A plan cut into ten units and dispatched as ten agents ran almost serially because six
units wrote one file; peak useful implement parallelism measured out at eight to twelve agents, set
by the file map, while the concurrency cap bound only in read-only audit waves. A session whose
commit structure was decided at the end spent its back end reassembling commits and pull requests —
that is the whole of that failure.

## 3. Every dispatch

Run this checklist for every agent, the fifteenth as much as the first.

1. **Read the live-agent table.** Is a live agent already covering this question? Resume it rather
   than starting a fresh one: resuming keeps the context that agent has paid for, while a fresh agent
   buys it again and hands you a second conclusion to drive. A resumed agent re-enters its partition —
   check its files are still free.
2. **Sum against the budget** — the live count, this agent, and its sub-agent cap, which is **zero**
   unless you say otherwise. Never dispatch blind.
3. **Brief from [agent-brief-template.md](agent-brief-template.md)**, every section, with the file
   list in full. The sections that pay for the template: push back, the report contract, no writing
   git command, and write as you go.
4. **Dispatch an auditor as `cold-auditor`** (`subagent_type: cold-auditor`, defined in
   `.claude/agents/cold-auditor.md`). Its `tools` allowlist has no `Edit`, `Bash` or `Agent`, so it
   cannot edit, run a command or spawn whatever its brief says, and `.claude/hooks/guard-auditor-write.sh`
   refuses any `Write` inside the repository, leaving only its report at the scratch path. A driving
   re-auditor needs a shell to plant a violation: dispatch it as `general-purpose`, knowing the
   `PreToolUse` guards in `.claude/settings.json` run inside subagents too, so its shell is the
   guarded one. The prose rule stays in every brief regardless.
5. **Record the dispatch in the register before it runs.** One working tree, never worktrees.

Incidents. Work went twice to a fresh agent that a live one was already covering — the ownership map
does not catch two agents investigating one question while writing different files, or none.
Unbounded fan-out took 28 of 40 slots twice, blocked everything queued behind it, and one nested
helper never returned, leaving a claim unverified. Seven briefs in one session were materially wrong
and the agents caught all seven — an agent correcting you is the system working. A resumed agent and
a fresh one were live in one directory for a window because the resume was not treated as a dispatch.
An agent's `git stash push` emptied the shared tree under nine editors, and concurrent `git add`
corrupts the index. Worktrees cost more in cherry-picks, cleanup and per-tree installs than the
parallelism bought.

## 4. Running the fleet

- **The fleet drains because dispatching is work and you are busy.** One agent running while queued
  work exists is a defect. Refill a slot the moment a report lands. Parallelism includes research
  and planning: fan out reading as you fan out writing.
- **Keep queued work as standing actions in the register** — the whole brief written now, paired
  with the condition that releases it. Tick one only against evidence that it went out.
- **Judge a stall by the timestamps of the files the agent owns**, never by its status label.
- **Verify agents have stopped by listing them.** Killing a parent does not kill its children. A
  measurement or a gate run taken while unlisted agents still edit the tree measures a tree nobody
  controls.
- **Read a report this way.** Verify every count, file list and exit code yourself; name the things,
  never stamp the total. Compare the files it says it touched against `git diff --name-only`. Read
  committed state with `git show HEAD:<path>` — while agents write, the working tree is not
  evidence. Route one agent's conclusion to another as a claim with its source named, never as a
  premise; your own inference, stated one notch wider than its evidence, reaches an agent as fact
  with your authority behind it. When two agents disagree about one file, drive the difference —
  never pick a side, never average. A green on a check nobody drove is not evidence: plant the
  violation, see red, restore, see green, exit code at each step.
- **Only the gate's own invocation counts.** A checker read by hand in a moving tree describes a
  tree that has already gone.

Incidents. A standing action recorded correctly was never dispatched, and only the handoff caught
it. Two agents stalled silently for over an hour, while another looked stalled for 45 minutes
writing fourteen files. A paragraph naming twelve test modules was wrong because there were
fourteen; a collected test count moved through four values while agents read it; an audit's brief
was a third under the round's real size because two files landed mid-audit. `nginx/prod.conf` was
read from the worktree while eight agents edited it, the text quoted as evidence was an agent's own
uncommitted edit, an agent was stood down on it, and a later break-and-restore leaked 8 of 36 cases.
`python scripts/check_docs.py --all` read clean while `./scripts/verify.sh --docs` was red on eleven
findings. Every false green in this repository's record was a status-carrying bug, which reading
cannot see and driving finds at once.

## 5. The wave boundary

1. **Reconcile the ownership map against `git diff --name-only`.** A path in the diff the map does
   not assign is a conflict incident, and it appears in no prose report.
2. **Commit the wave before dispatching the next**, so stopping at any moment costs one wave rather
   than the session. Agents propose messages; you write the commit.
3. **Check every message against its own diff, never against the proposal it came from** — for
   every path in the diff, does the body account for it? Validate each with
   `python scripts/check_commits.py --message-file <file>`, and keep the subject within 72 characters.
4. **Order commits so a citation never precedes the file it names.** `scripts/docs_gate/checks.py`
   resolves a cited path against the working tree, so a document naming a still-untracked file
   passes locally and fails the CI checkout.
5. **Push once per wave.** The first edit to a shell script or a workflow arms the full-form gate
   with images for the rest of the branch, and after that a narrower scope is refused rather than
   advised: agents iterate with the underlying tools, and the gate is a wave-boundary instrument.
   Report its exit code from the command, never through a pipe.

Incidents. A commit landed carrying two agents' changes under one agent's message; nothing failed,
and re-reading the body beside the diff found it. Six subjects over 72 characters cost a full branch
replay. Nine implied full-form runs became four by pushing per wave.

## 6. The cycle

**research/think → implement → audit → fix → re-audit → fix → END** — the owner's, verbatim in effect.

- **Fixed length: two audits and two fix rounds, then it ends** unless the owner asks for more. What
  is bounded is the number of audits, never the findings.
- **It ends on a fix, never on an audit.** The artefact that ships is always the post-fix artefact.
- **The re-audit's subject is the fixes and their blast radius**, never the original work again. An
  agent that did not write the fixes drives each one and reports what it broke elsewhere. It may be
  several agents bundled by blast-radius overlap, or one per fix agent; the batching rule is in
  [agent-brief-template.md](agent-brief-template.md).
- **A finding inside the slice is fixed whichever round surfaces it.** Only a finding genuinely
  outside the slice's scope becomes a roadmap entry — a judgement about scope, never about timing.
- **A plan may lighten the cycle for a slice it names with a stated reason, to a floor of one audit
  and one fix.** Owner ruling of 2026-09-02. Nothing is lightened by default, and no slice ships on a
  cold read alone.
- **Decide the rounds when the slice is planned (§2), never while holding findings.**
- **A document or plan re-audit adds one step:** walk the previous audit's findings one at a time
  and say, for each, closed or open, with the evidence. For code the driven re-audit already answers
  this; for a document nothing else does.

Incidents. A fix round introduced a live false green — a wrapper that turned a tripped failure into
a clean report and exit 0 in three scripts — and the re-audit caught it after three agents had
reviewed the same code without seeing it; a fourth drove it and found it at once. A plan reached a
fourth version where the cycle ended at the third, because each extra audit looked justified alone
while a fresh list of findings was in hand. A chain of plan audits each read the plan afresh and none
confirmed the previous audit's findings had closed.

## 7. Ending the session

**The dispatch floor.** You cannot see remaining context or quota, and a pause is not predictable, so
a rule phrased as "keep enough in hand" never fires. Bound the unassembled work instead: once what
remains is one wave plus the ending below, start nothing new.

The ending, in order:

1. Assemble the last wave (§5), run the gate at the branch's scope, open the draft pull request, and
   print its link. The branch's `verify` run concludes while step 2 is written; its conclusion is
   named in the response before the session ends, never assumed from the local gate (CLAUDE.md §2).
2. **Write the handoff ([handoff-template.md](handoff-template.md)) and have it audited by an agent
   that has seen none of the work**, then fix what the audit finds — the cycle applies to the handoff
   and ends on the fix. Write it incrementally into the register as findings land, so ending the
   session is an edit rather than a task.
3. Write the next session's starter prompt beside the handoff, in the durable plan directory the
   starter names, with every document it cites in the same directory and one copy of each governing
   file — a second copy diverges.

Incidents. A session that spent everything on dispatch ended with sixteen commits, an unpushed
branch and no pull request, and that was the first item its handoff owed the owner. A five-hour
quota limit killed six agents at once; every agent edit was on disk and a resume state had been
written minutes before, so the work survived, while the plan audit that had written nothing to disk
lost everything. Two copies of the owner's instructions file diverged on the one ruling that changed
the per-slice discipline. A handoff restated files for a third of its length and buried what
mattered, hard-coded a filename its pending fix round was about to rename, and re-asked a question
the owner had ruled.

## 8. Planning a programme

- **Plan in a separate session.** It produces the programme plan and the starter prompt for session
  one; the plan lays out the whole path — each session's scope, dependencies and exit condition — so
  no later session re-derives the shape under pressure.
- **One pull request per session.** Size a session to be worth its own branch and not exhaust its
  context. A phase whose verification verdict must stand alone gets its own session.
- **Each session writes a handoff for the next and has it independently audited** — the chain in
  [handoff-template.md](handoff-template.md).
- **The plan lives on disk in the durable plan directory, with a `START-*.md` starter beside it** —
  never in a session scratchpad, which the next session cannot reach, and never as an artifact,
  which the next session does not read. A plan restructured into an entry document plus per-slice
  files is about the document, never a licence to split the work across sessions.

## 9. Traps

Each returned a confident wrong answer with nothing failing.

- **An exit code read through a pipe is the pipe's.** `cmd | tail; echo $?` is `tail`'s status.
- **Bash masks a child exit code to a byte**, so 2304 reads as 0.
- **A compound command that is the left operand of `||` runs with errexit and the ERR trap
  disabled**, and the suppression reaches subshells and called functions — every capture of the
  form "run, or record the status" is blind to a trap-based failure.
- **A Windows text-mode stream turns every newline into CRLF invisibly**, in a scratch file as much
  as a tracked one. Write bytes, or pass an explicit empty newline.
- **MSYS rewrites a `<ref>:<path>` argument into a path**, so `git show origin/main:<path>` exits 128
  in Git Bash without `MSYS_NO_PATHCONV=1`.
- **`git grep` does not search untracked files**, so a check run with it over a branch that adds
  files is silently partial.
- **A commit SHA on a live branch is not an identifier.** A sixteen-commit branch was rebuilt twice
  inside six minutes and every SHA changed. Cite subjects and re-derive.
- **A stale virtual environment is an ordinary state.** A lockfile change nobody synced gave an
  internal error at exit 3 on every test run. Sync before measuring anything.
- **Blast radius is where the danger lives.** Making one check stricter turned twelve comment blocks
  red across three files after their authors had finished, and one false green in this repository's
  record was introduced by a fix to the very file being fixed.
