# Agent brief template

A brief is what a dispatch adds to its agent's definition under `.claude/agents/`, which the harness
loads as that agent's system prompt and which binds whatever the brief says. **A brief carries only
the parts below, and never restates a standing section**: the definition is that section's one home,
so a restatement that has drifted is one the agent reads and does not follow, and nothing announces
the difference. A brief is a prompt rather than a file, so nothing checks one; a part left out here is
a constraint the agent never sees.

**The rules about writing one.**

- **Nothing in a brief may ask for an answer mid-task.** A dispatched agent's only channel back is
  its final report, so an instruction to tell you, announce something or wait for your reply is one
  no agent can obey — agents have spent a paragraph each explaining why. Ask for it in the report,
  or write the instruction as _stop and report_, which is reachable and returns the task to you.
- **Glob every path before the brief goes out.** A file list assembled from another agent's report
  inherits that report's errors, and the agent's rediscovery costs more than the check.
- **For a signature change the file list is the CALLERS, plus every test asserting over the call's
  own text — never the definition's neighbours.** A list built from what the change reads misses
  what calls it: one naming every module that read a constant and no module that called the builders
  taking it could not land an added parameter, optional or not, and the agent wrote nothing and
  reported it. Derive it by searching for the symbol's call sites and for its name in test source,
  not by reading out from the module the change starts in.
- **Measure what a design costs before briefing it as the closure, and read what already constrains
  the surface it lands on.** A briefed count design measured at three collection scans per page load
  against a growing collection, which the endpoint's own comment already forbade — so the refusal
  was in the file the brief was written from.
- **Where the plan names the repair, brief the agent to DRIVE it and to report if it does not close
  the item** — never to implement it as settled. A briefed repair has been driven, instrumented and
  measured not to close its entry, and the entry offering it was wrong as well; what paid was the
  definition's standing instruction to report a contradicted premise (`.claude/agents/implementer.md`
  section 4).
- **Name an acceptance check by what it asserts, never by what it is called.** A brief named a
  contract test as an item's guard; the agent ran it and read a green suite over a half-done
  narrowing, because that test pairs schema components and the change was a query parameter. Say in
  one sentence what the named check compares before the brief goes out — and where you cannot, the
  item has no acceptance test and the brief owes it one.
- **Give every figure its provenance**, because a number acquires false authority in transit —
  three relayed in one programme were wrong in three different directions.
- **Never cap the report's length.** A cap makes an agent drop its caveats, its not-established
  notes and its out-of-scope findings first, those looking least like findings, which is the class
  the report exists to carry. Shape is the instruction instead, and the definition's section 14
  gives it.
- **Never give a brief a time budget, an expectation or a stop-at-N clause.** An agent that stops
  on a clock hands back partial work the next one re-derives, and a session's wall clock is spent
  on routing and waiting, never on an agent running long; where something must be bounded, bound
  the scope, and measure durations after the fact.
- **A judgement test the brief hands out names its parameters, and is calibrated once with a worked
  verdict before it reaches a second agent.** A test phrased over "a reader" left every sweep to
  pick its own, each picking the most generous one available, so one rule produced opposite verdicts
  across a corpus with nothing to reconcile them and the coordinator alone able to see the spread.
- **Where the session is rewriting the rules it works under, every instruction citing one says which
  version it means.** An agent reading `HEAD` is right to refuse a clause that exists only in the
  revision being assembled, and you are the only party holding both texts.

## The implementer's brief

`.claude/agents/implementer.md` carries sections 2 and 4 to 15. The brief carries the values that
definition names in angle brackets, section 1, section 3, and the traps specific to this work, which
the definition's section 9 cannot know: what the agent must NOT do is carried as carefully as what it
must, each standing trap existing because an agent did the reasonable thing in its absence.

```
VALUES.         Your agent name: <name>. Session branch: <session branch>; your worktree forked
                from it at <sha>. Coordinator's checkout: <path>. Scratch path: <path>.

1  OWNERSHIP.   The exact files you may write, listed in full:
                  <path>
                  <path>
                Writing any other file is a defect in this brief -- stop and report it rather than
                working around it. <N> other agents work in worktrees of their own, and none of
                you sees another's edits until I land them.
                <Where a file is shared: who else is in it, and which region is theirs. Keep at
                least one unchanged line between your edit and theirs: git merges two hunks one
                line apart, and conflicts on a line both change or on one insertion point both
                use. Anchor every edit on a unique fragment.>

3  THE WORK.    A numbered checklist. Each item states: the change; the anchor it lands at, which
                is a symbol, a path or a rule id and never a line number; and its own acceptance
                test, named before you start.
                DRIVE every case you add or change RED before you call its item closed. A case
                that compares a thing to its own definition, or that asserts source text nobody
                rendered, passes on the day the behaviour goes -- and it is indistinguishable
                from a real one until somebody breaks the code under it. Where an item changes
                what a person SEES, its acceptance names the served page and the reading that
                proves it, a source-text pin alone being exactly that vacuous case.
                An item that changes a thing's IDENTITY -- splitting a numbered row, renaming a
                symbol -- or that removes a concept carries its outward sweep in the same item.
                Every citation into a split row still resolves while pointing at the half that no
                longer carries the claim, and a deleted concept's VOCABULARY survives in prose no
                citation check reads: both are green in every gate there is.

9  TRAPS.       Beyond your definition's standing list: <the traps specific to this work>
```

## The auditor variant

Two forms, and the agent type decides which (`SKILL.md` §3).

### The cold form — a `cold-auditor`, and the default for every judging audit

Its tools are `Read`, `Grep` and `Glob`: no shell, no `Write`, no `Edit`, no sub-agents, so it
writes nothing anywhere and its report is its final message. Its definition carries its tools and
its report — the order **and the medium** — and no numbered section, so the block below is the
brief's whole standing text. The implementer's sections 5 to 9, 12 and 15 have no counterpart here:
shell commands, a scratch directory, planting, traps about running things, measuring and a docs
check are all things this agent cannot do. Section 10 keeps its second half, because a guard refusal
is the one clause of it this agent meets: its own `Read` of a credential path hits a deny rule.
**Never restate the report contract in a brief**: the definition replaces section 14 whatever the
brief says.

**Check the brief's verbs against that list before it goes out.** Run, measure, drive red and read
the diff each need a shell this agent has not, and it cannot know what tools it was meant to have:
briefed to read a diff it audits the tree as it stands, which cannot say which defects the work
introduced and which predate it.

For a **re-audit**, the subject is the fixes and their blast radius rather than the original work,
and the agent must not have written the fixes. For a **document or plan re-audit**, add one step:
take the previous audit's findings one at a time and report, for each, closed or open, with the
evidence.

```
1  OWNERSHIP.   You write nothing, having no tool that writes. Your report is your final
                message, under section 14.

2  READ RULE.   You have no shell, so you cannot read committed state yourself. It reaches you in
                this brief instead: <the diff, and the committed text of every file you must
                judge that another agent owns>. Where answering something needs a command, report
                it not established under section 13 and name the command. Never substitute a
                working-tree read for it: the tree you can read holds the session branch as
                landed, not the diff you judge, and answers a different question.

3  THE SUBJECT. You are given the intent and the diff -- never the implementer's report, which
                would tell you what to believe. Reading a check cannot tell you whether it can
                fail, and you cannot drive one: every drive-shaped question comes back under
                section 13 for me or a driving re-auditor, and naming one is worth more to me
                than a verdict reached by reading.
                Where a rule names the check enforcing it, ask of each pair whether that check
                enforces what the rule CLAIMS or only a fragment of it. The name resolves either
                way, so a rule and its check can be written in one session, disagree about what is
                enforced, and leave every gate green.

4  PUSH BACK.   This brief may be wrong; more than half of them are. A premise the tree
                contradicts is reported, not judged by, and one that names its source -- "an
                audit reported X" -- is a claim you check before you rely on it.

10 TELL ME.     A guard refusal is a rule arriving: comply with it and report it under section 14.
                Reaching the same end through a different tool is a violation however good the
                reason, and so is rewording until it passes.

11 BLAST RADIUS. Say what each change could break outside the files it touches, and name the
                command that would test that.

13 CLAIMS.      What the tooling, the harness or a guard permits is established only by attempting
                it, which you cannot do: such a claim is reported "not established", with the
                command that would settle it.

14 REPORT.      Your agent definition `.claude/agents/cold-auditor.md` gives the order and the
                medium, and it replaces this section.
```

### The driving form — a `driving-reauditor` that must plant

`.claude/agents/driving-reauditor.md` carries its standing sections, its re-audit and document
re-audit subjects included. A brief to it carries the values that definition names and the subject:
the intent and the diff — never the implementer's report — and the blast radius the bundle shares
(below).

## Batching re-auditors

**One driving re-auditor takes every fix landed since the last one ran** (`SKILL.md` §6), planting
each in turn. The test for splitting that bundle is **blast-radius overlap**: fixes may share one
agent when what one could break is disjoint from what the other could break. The rules that follow:

- Files that **cannot be judged apart** — one parses the other, one grades what the other ran, or
  one asserts a message or an exit code the other emits — go deliberately to a single agent.
  Splitting them produces two reports that contradict each other on one file.
- Anything that can **produce a finding** gets its own drive, never a shared read. Three agents
  reviewed one wrapper and found nothing; a fourth drove it and found a live false green.

Where two bundles overlap on exactly one hunk, name that seam in both briefs and drive the
difference yourself if the two verdicts disagree.
