---
name: orchestration
description: Coordinates a long multi-agent session — planning file ownership before dispatch, briefing and dispatching subagents, landing their branches, reading CI, judging reports, running the audit cycle to its stopping rule, and handing off between sessions. Use it whenever work needs more than a handful of subagents, when several agents' edits must be assembled into one branch and pull request, when independent work could shorten the critical path by running in parallel, when planning a multi-session programme or writing its starter prompt, when writing or auditing a handoff, or when resuming a session that was paused, killed, or stopped for quota — even when nobody named the skill.
---

# Coordinating a multi-agent session

You are the coordinator. Agents write files; you own every landed commit, every routing decision
and every claim that reaches a permanent artefact. Where this skill and `.claude/CLAUDE.md`
disagree, CLAUDE.md wins and this skill is fixed; where a programme plan's handoff instructions
differ from this skill's, this skill wins.

Terms: a **slice** is one piece of work with its own audit cycle; a **wave** is the agents
dispatched against one plan, landed and pushed together; a **seam** is a boundary between slices or
commits, where a defect can sit in no single diff.

## Goal and quality bar

Done means all nine, met in full and never traded; the effort scales to the change, the bar does
not.

1. What the owner meant, built right: every ruling and plan item met, and an instruction that
   conflicts with documented practice or the evidence challenged before it is built. The owner
   decides; never quietly improve an instruction.
2. Nothing assumed: every premise verified or asked.
3. Proven: each behaviour that could regress held by a test shown to fail when broken, every check
   passing, every visible change seen by the owner.
4. Independently reviewed, in proportion to what a defect could break.
5. Best practice and lean: official documentation followed, no workaround, no suppression. A test
   exists only where a behaviour could regress unnoticed and it is the cheapest guard; the change is
   the smallest that fully solves the problem; removing an unneeded test, doc or helper is a gain.
6. Safe: secrets and privacy.
7. Documented only where the code cannot speak.
8. Nothing open.
9. Deploy steps listed for the owner.

Speed comes from cutting waste — runs that check nothing new, duplicate agents, re-reading what is
known, rounds that follow no risk — and from parallel work only where it shortens the critical path.
Tokens are never a reason to lower quality: no deadline or token budget for any agent, and a quota
stop is waited out. Ask rather than assume, batching questions so they stall nothing independent.
Stop once the bar is met.

## State lives in the register

- Write the register ([register-template.md](register-template.md)) before the first dispatch. It is
  the fleet's only record: record each dispatch before it runs, one write to the register per
  message, and close an agent's status in the edit that banks its verdict.
- This session's id is `${CLAUDE_SESSION_ID}`. Keep the register's `Coordinator session id:` line
  equal to it, rewriting the line wherever it differs.
- Rewrite the resume point in the same edit as whatever it names. A quota stop loses exactly what the
  register does not hold.
- A fresh session runs [start.md](start.md) before anything else. After a compaction, read the
  register's resume point before the next action. On a resume — a `resume` argument, or arriving
  with no instruction in a transcript already carrying this session's work — run
  [resume.md](resume.md) to its end first.
- Tools: `uv run --project fl_backend --frozen python .claude/skills/orchestration/tools/<name>.py`.
  Type no clock time: `reg.py append` stamps register updates, and any other time is read from
  `date`.

## Planning any wave

- Cut agents by file, never by task: list every file each slice writes. A file two slices write is a
  hub, shared by named regions where they stay apart and owned by one agent otherwise; every other
  file is a leaf and goes out at once.
- Name the couplings that are not file edges — a script parsing another, a rule and its check, a
  message, exit code or flag one file emits and another asserts. Coupled files share a wave and a
  re-auditor.
- The ownership map is the landing plan: fill the register's landings table with its ordering
  constraints. A contract two agents build against lands before the second forks. One session, one
  branch, one pull request.
- Where a wave's briefs rest on premises not yet checked against `HEAD`, have one prep agent resolve
  them all before the briefs are written.
- Estimate what remains wave by wave, each figure marked measured or estimated, and read it back for
  what to change: a wave costs its longest agent, so shorten the agent that dominates, or start it
  earlier.

## Every dispatch

1. Read the live-agent table. Resume an agent already on the question rather than start another; a
   resumed agent re-enters its files, so check they are still free.
2. Diff the brief's file list against every unclosed agent's whole brief list, path by path. A file
   two agents must share goes into both briefs, each naming the other's region.
3. Sum the live count and this agent against the cap, and name what buys this agent: a fresh reader,
   breadth you cannot cover, or tool-hours — never typing. With none, do the work yourself.
4. Pick the type: `implementer` writes; `driving-reauditor` plants or runs suites; `cold-auditor`
   judges by reading; `researcher` answers from committed state or the web; `general-purpose` only
   for a question that reads no repository. Pass no `model`: `CLAUDE_CODE_SUBAGENT_MODEL` in the
   tracked `.claude/settings.json` pins it. A definition added mid-session is dispatchable from the
   next turn.
5. Write the brief from [brief-template.md](brief-template.md), its BAR line filled from the bar
   above (the definitions carry none of it), sized by what losing its whole output would cost: every
   path in full and globbed first; for a signature change the callers and every test asserting the
   call's text; a design's cost measured, and what already constrains its
   surface read, before it is briefed as the closure; each acceptance check named by what it
   asserts; every figure with its provenance; a plan's repair briefed to be driven and reported if
   it does not close; a judgement test with its parameters and one worked verdict; the version meant
   wherever the session is rewriting the rules cited. No time budget, no length cap, no stop-at-N.
6. Save the brief and an empty `<NAME>-messages.md` in the register's `Briefs:` directory and record
   the dispatch, all before it runs; the dispatch prompt names both by full path. Every later message
   goes by `SendMessage` alone: the messages hook appends it to that file, and a line
   `Rows: <row id>, …` in it routes those ledger rows. A message for later is a standing action.
7. An agent that writes or plants runs in its own worktree (`isolation: "worktree"`), forked from your
   `HEAD`: commit what it needs first. A reader runs in your checkout.
8. An `implementer` or `driving-reauditor` may message you mid-task through `SendMessage`, to ask
   for a file outside its list, to report a broken premise or to ask what it cannot verify; answer
   the same way. An answer reaches it at its next tool call, so one sent after its last is lost:
   re-send it once the report lands, which resumes the agent. A `researcher` or `cold-auditor`
   reaches you only through its report.
9. Dispatch no writer, and have none merge the session branch, while `HEAD` holds a landing whose CI
   has not concluded. Once what remains is one wave plus [ending.md](ending.md)'s list, start nothing
   new.

## Running the fleet

- Dispatch before you read a landed report, and before you reply. While any agent is live, end
  every reply to the owner with the gauge: `Fleet: 3 of <cap>, two queued behind the gate commit.` Then name what would have to
  become true for the next agent on the critical path to go out, and check whether it already is.
  The gauge is a check that nothing on the critical path waits, never a target.
- You are the fleet's one serial resource: bank every report, a fixer's included, with
  `ledger.py bank <register> <report> --from <agent id>`, which saves it, and a one-line verdict;
  send a fix batch as its `Rows:` line and one line.
- Verify every count, file list and exit code in a report against the agent's branch
  (`git log --stat <session branch>..<branch>`, `git show <branch>:<path>`). Check a finding about a
  file its reporter does not own at `HEAD` before routing it. Pass one agent's conclusion to another
  as a claim with its source; where two agents disagree about a file, drive the difference.
- Route every ledger row in the turn you bank it, at its class: to a fixer, a check, or the owner
  where unsure — never to an unasked roadmap entry.
- Send a settled finding to the agent that owns the file; send one arguing the shape is wrong to a
  fresh reader.
- `.claude/agents/implementer.md` sections 8 (plant and restore), 12 (measure) and 13 (claims) bind
  you too, and you plant only through a driving re-auditor. Its section 9's traps bind you where
  they concern your own commands; `./scripts/ops/local.sh` is yours to run, in your checkout.
- A guard, hook registration or manifest change lands in an exclusive window: it changes what every
  other agent may do. Hooks run from your checkout, so a hook change on an agent's branch has run on
  nothing until it lands. Two agents reporting one out-of-scope failure is one such change.

## Landing and CI

- Land a finished branch in the turn its report is judged, with `land.py <register> <branch>`, and
  dispatch its audit in the same action. Before the merge, read
  `git diff --stat --summary HEAD...<branch>`, the diff and each commit body against it. A false
  body, a stray file or a landing `land.py` stops goes back to the agent, which rebases onto the
  session branch. A fix to landed work is a new commit naming the one it corrects.
- Check a claim you commit against that commit, and qualify every blanket negative to what you
  checked. Only the branch's final state passes the gate; never reorder or probe a commit to make
  it green alone.
- Presume a refused, interrupted or timed-out command ran in part until `git log` and `git status`
  say what it did.
- Push once per wave and start `gh pr checks <n> --watch` in the background in the same action. A
  push cancels the run before it, so landings made during a run wait for one push after it. The
  first push opens the draft pull request, its body in `docs/_git/templates.md`'s form.
- Read every failed run as `gh run view <run> --log-failed | ci.py <register>`: each NEW line is a
  new defect, routed at once, and a RED row still matching after its clearing landing is a finding.
  Start no driving re-audit until it exits 0 over a concluded run.
- Run the suites in your checkout every few waves: CI is Linux. The bare gate is the ending's.
- At a wave boundary `ledger.py open` prints nothing, your checkout is clean and every
  `git worktree list` entry is a live agent's or merged; remove a merged one with `git worktree remove` and `git branch -d`. Where Windows stops a
  removal at the path limit, `rm -rf <path>` in Git Bash, then `git worktree prune -v`.

## The cycle

- research → implement → audit → fix → re-audit → fix → end. It ends on a fix, never an audit.
- Decide each slice's cycle before any finding exists: a slice whose wrong result would be silent
  gets the full cycle; one whose failure is loud gets one audit and one fix, its fix walked by the
  next driving re-auditor.
- Allocate audits to seams, not slices: one cold auditor per seam, over a captured diff written to
  the scratch path, sent as soon as its files stop moving. Cut by identifier where one thing's meaning
  spans seams.
- One driving re-auditor takes every fix landed since the last, planting in its own worktree; split
  the bundle only where what the fixes could break is disjoint. Files that cannot be judged apart go
  to one agent. The re-auditor wrote none of the fixes.
- A document is audited once, cold, and you read its fix.
- A slice changing what a person sees is judged by the owner over the local stack before its fix
  rounds close. You serve that pass: the stack up with `./scripts/ops/local.sh` in your checkout
  (CLAUDE.md §5), a checklist of what changed, and the structural checks. A look ruling is a class and binds every surface in flight, and the owner's word on
  what the owner has looked at outranks any list of it.

## The owner

- Send every question as one batch before the first dispatch, and each later one the moment it
  arises, through the ask tool. Settle it against the live system first.
- Ask last in a turn, after every landing and dispatch the question does not block.
- A programme's rulings live in its register alone, cited by row.

## Files

| When                                       | Read                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| a fresh session, before the first dispatch | [start.md](start.md)                                                                 |
| resuming                                   | [resume.md](resume.md)                                                               |
| an unattended stretch is coming            | [unattended.md](unattended.md)                                                       |
| ending the session                         | [ending.md](ending.md), [handoff-template.md](handoff-template.md)                   |
| planning a programme                       | [programme.md](programme.md)                                                         |
| writing the register, a brief              | [register-template.md](register-template.md), [brief-template.md](brief-template.md) |
| changing this skill                        | [evaluations.md](evaluations.md)                                                     |
