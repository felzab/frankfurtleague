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
Tokens are never a reason to lower quality: no deadline or token budget for any agent. The quota is
paced, never waited out: read the usage (the desktop app's `get_usage`) before each dispatch and at
each notification, and keep each window's reading under a straight line to about 95% at its reset
([unattended.md](unattended.md) has the arithmetic). A limit stop kills every live agent mid-call
and can leave the session idle past the reset. Ask rather than assume, batching questions so they
stall nothing independent. Stop once the bar is met.

## State lives in the register

- Write the register ([register-template.md](register-template.md)) before the first dispatch. It is
  the fleet's only record: record each dispatch before it runs, one write to the register per
  message.
- This session's id is `${CLAUDE_SESSION_ID}`. Keep the register's `Coordinator session id:` line
  equal to it, rewriting the line wherever it differs.
- Rewrite the resume point with `reg.py resume` whenever what it names changes: a quota stop loses
  exactly what the register does not hold.
- A fresh session runs [start.md](start.md) before anything else. After a compaction, read the
  register's resume point before the next action. On a resume — a `resume` argument, or arriving
  with no instruction in a transcript already carrying this session's work — run
  [resume.md](resume.md) to its end first.
- Tools: `uv run --project fl_backend --frozen python .claude/skills/orchestration/tools/<name>.py`.
  Type no clock time: `reg.py append <register> --file <path>`, its text written with the Write tool,
  stamps register updates, and any other time is read from `date`.

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

1. Read the live-agent table. Resume an agent still mid-task on the question rather than start
   another; a resumed agent re-enters its files, so check they are still free. A new round for a
   finished agent — a fix, a merge, a stopped landing — goes to a fresh agent with a full brief and
   the old report as claims once `reg.py context` reads its context past about 300k tokens
   (estimated): every call of a resumed agent re-reads its whole context.
2. Diff the brief's file list against every unclosed agent's whole brief list, path by path, and run
   `reg.py overlap <register> --brief <file>`, which also finds a path an unmerged branch already
   touched. A file two agents must share goes into both briefs, each naming the other's region.
3. Sum the live count and this agent against the lower of the owner's cap and the width the usage
   line allows. Name what buys this agent: a fresh reader, breadth you cannot cover, or tool-hours —
   never typing. With none, do the work yourself.
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
6. Save the brief in the register's `Briefs:` directory and run
   `reg.py dispatch <register> <NAME> --brief <file>`, which writes the agent's messages file and
   live-agent row and routes the brief's `Rows:` line, before it runs, and again with `--id` once
   the Agent tool returns; the dispatch prompt names the brief and the messages file by full path.
   Every later message goes by `SendMessage` alone: the messages hook records it there, and a line
   `Rows: <row id>, …` in it routes those ledger rows. A message for later is a standing action,
   queued with `reg.py queue <register> <trigger> <brief>`; `dispatch` ticks it.
7. An agent that writes or plants runs in its own worktree (`isolation: "worktree"`), forked from your
   `HEAD`: commit what it needs first. A reader runs in your checkout.
8. An `implementer` or `driving-reauditor` may message you mid-task through `SendMessage`, for what
   its section 10 names; answer the same way. An answer reaches it at its next tool call, so one
   sent after its last is lost: re-send it once the report lands, which resumes the agent. A
   `researcher` or `cold-auditor` reaches you only through its report.
9. Dispatch no writer, and have none rebase onto or merge the session branch, while `HEAD` holds a
   landing whose CI has not concluded; queue it with the trigger `window`, which `land.py` holds the
   next landing behind. Once what remains is one wave plus [ending.md](ending.md)'s list, start
   nothing new.

## Running the fleet

- Dispatch before you read a landed report, and before you reply. While any agent is live, end
  every reply to the owner with the gauge `reg.py live` counts:
  `Fleet: 3 of <width>, two queued behind the gate commit.` Then name what would have to become
  true for the next agent on the critical path to go out, and check whether it already is. The gauge
  is a check that nothing on the critical path waits, never a target.
- You are the fleet's one serial resource: bank every report, a fixer's included, with
  `ledger.py bank --from`, which saves it and closes the agent's live row, and a one-line verdict.
  Route or close every row in that command (`--route`, `--close`), at its class: to a fixer, a
  check, or an owner's queue where unsure — never to an unasked roadmap entry. Its exit 4 names each
  row left OPEN.
- Verify every count, file list and exit code in a report against the agent's branch
  (`git log --stat <session branch>..<branch>`, `git show <branch>:<path>`). Check a finding about a
  file its reporter does not own at `HEAD` before routing it. Pass one agent's conclusion to another
  as a claim with its source; where two agents disagree about a file, drive the difference.
- Send a settled finding to the agent that owns the file; send one arguing the shape is wrong to a
  fresh reader.
- `.claude/agents/implementer.md` sections 8 (plant and restore), 12 (measure) and 13 (claims) bind
  you too, and you plant only through a driving re-auditor. Its section 9's traps bind you where
  they concern your own commands; `./scripts/ops/local.sh` is yours to run, in your checkout.
- An exclusive window is a landing with no other landing in its push, and each live agent told what
  changed. A hook, settings, agent-definition, guard or manifest change takes one: it changes what
  every live agent may do at once, and hooks run from your checkout, so a hook change on a branch
  has run on nothing until it lands. Two agents reporting one out-of-scope failure is one such
  change. A lint rule or gate check acts at each branch's next run instead: it lands like any
  branch, and each live writer is told to merge the head, once its CI concludes, before it reports.

## Landing and CI

- Land a finished branch in the turn its report is judged, with `land.py`, and dispatch its audit in
  the same action. Before the merge, read `git diff --stat --summary HEAD...<branch>`, the diff and
  each commit body against it. A false body, a stray file or a landing `land.py` stops goes back to
  the agent, or to a fresh one where step 1 says so, which merges the session branch into its own,
  rebasing only where no other branch holds its commits; its exit 8 is the session branch's own
  red. A fix to landed work is a new commit naming the one it corrects.
- Check a claim you commit against that commit, and qualify every blanket negative to what you
  checked. Only the branch's final state passes the gate; never reorder or probe a commit to make
  it green alone.
- Presume a refused, interrupted or timed-out command ran in part until `git log` and `git status`
  say what it did.
- Push once per wave and start `ci.py <register> --head --wait` in the background in the same
  action: its completion notification is the verify run's verdict. A push cancels the run before
  it, so landings made during a run wait for one push after it. The first push opens the draft pull
  request, its body in `docs/_git/templates.md`'s form.
- Read `ci.py`'s output whole: each NEW line, printed last, is a new defect, routed at once, and a
  RED row still matching after its clearing landing is a finding. Start no driving re-audit until
  `ci.py` exits 0.
- Run the suites in your checkout every few waves: CI is Linux. The bare gate is the ending's.
- At a wave boundary `ledger.py open` exits 0, your checkout is clean, and after `reg.py prune`
  every `git worktree list` entry left is a live agent's. Where Windows stops a removal at the path
  limit, `rm -rf <path>` in Git Bash, then `git worktree prune -v`.

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
  arises, through the ask tool, or unattended to its queue ([unattended.md](unattended.md)). Settle
  it against the live system first.
- Ask last in a turn, after every landing and dispatch the question does not block.
- A programme's rulings live in its register alone, cited by row.

## Files

| When                                       | Read                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| a fresh session, before the first dispatch | [start.md](start.md)                                                                 |
| resuming                                   | [resume.md](resume.md)                                                               |
| pacing; an unattended stretch is coming    | [unattended.md](unattended.md)                                                       |
| ending the session                         | [ending.md](ending.md), [handoff-template.md](handoff-template.md)                   |
| planning a programme                       | [programme.md](programme.md)                                                         |
| writing the register, a brief              | [register-template.md](register-template.md), [brief-template.md](brief-template.md) |
| changing this skill                        | [evaluations.md](evaluations.md)                                                     |
