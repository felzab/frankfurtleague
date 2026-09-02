# Agent brief template

Every dispatched agent gets every section below. Push back and the report contract are the two that
pay for the whole template: across two sessions more than half the briefs carried a premise the tree
contradicted, and every agent that pushed back was right. Fill the angle-bracketed placeholders and
delete nothing.

**The brief is the agent's whole world, so it has to carry what the agent must NOT do as carefully
as what it must.** Sections 5, 6, 9 and 10 are that half, and each of them exists because an agent
did the reasonable thing in their absence.

```
1  OWNERSHIP.   The exact files you may write, listed in full:
                  <path>
                  <path>
                Writing any other file is a defect in this brief -- stop and report it rather than
                working around it. You are one of <N> agents editing this working tree right now.
                <Where a file is shared: who else is in it, and which region is theirs. Anchor
                every edit on a unique fragment, so an edit made stale by their work fails loudly
                instead of landing in the wrong place.>

2  READ RULE.   For any file you do NOT own, read the committed state -- `git show HEAD:<path>`.
                The working tree holds another agent's half-finished edit and answers a different
                question from the one you are asking.

3  THE WORK.    A numbered checklist. Each item states: the change; the anchor it lands at, which
                is a symbol, a path or a rule id and never a line number; and its own acceptance
                test, named before you start.

4  PUSH BACK.   This brief may be wrong. More than half of them are, and the agents caught every
                one. If a premise here does not survive contact with the tree, stop and report it
                instead of building on it. Naming a wrong premise is worth more to me than
                finishing the task. Where you are asked to build on a claim you have reason to
                doubt, ask for the evidence behind it before you build.

5  GIT.         You run NO git command that writes and NO command that reaches the remote: no
                add, commit, checkout, stash, reset, no push, and no `gh` at all -- not
                `gh pr create`, not `gh pr ready`, not `gh pr merge`. A `git stash push` by one
                agent emptied the shared tree under nine editors, and concurrent staging corrupts
                the index. `git checkout -- <path>` is included: it restores from the INDEX, not
                from the last commit, so in a shared tree it discards a colleague's unstaged work.
                Write your proposed commit message to the scratch path; I assemble every commit.
                The gate is mine as well. `./scripts/verify.sh` is a wave-boundary instrument and
                a run over a tree a dozen agents are writing exits non-zero on somebody else's
                half-written file, so drive your own checks by calling the underlying tool.
                `.claude/CLAUDE.md` §2 defines a finished task as one whose branch is pushed and
                whose draft pull request is open. That definition is addressed to me, not to you:
                YOU are finished when your report lands.

6  SUB-AGENTS.  <N, normally zero>. Do not exceed it. Unbounded fan-out has twice consumed the
                whole concurrency budget and blocked the work queued behind it.

7  SCRATCH.     <scratch path>/<your agent name>/ -- your own subdirectory, outside the
                repository, for everything you write that is not a file you own; your report is
                <report file> inside it. Agents sharing one directory overwrite each other in it.
                Keep scratch out of the repository: a shell guard refuses a command naming a
                path `.gitignore` matches, exempting only `node_modules`, `.venv`, `.next`,
                `.claude/worktrees`, `docs/audit/` and `.vscode/`, so a scratch file anywhere
                else under the repository is one you cannot read back.

8  PLANT AND    Proving a check can fail means planting a violation and restoring it, and the
   RESTORE.     tree you are planting in is shared.
                - Plant ONLY in a file you own. If proving a test's teeth needs breaking code you
                  were not given, that is the signal to drive against a scratch copy, never to
                  take a wider licence.
                - Tell me BEFORE the first plant which files you will break, and confirm in your
                  report that each was restored and verified byte-for-byte against its snapshot.
                  Nothing in a working tree tells me a ten-second plant from an abandoned one, so
                  an undeclared one costs a full stop on that file and a round trip.
                - Snapshot the file immediately before each break, never once at the start of a
                  run; after each restore compare it against the snapshot and STOP if it differs
                  -- its owner edited it while you held the copy, and restoring over that reverts
                  their fix silently. Record the exit code at each step: plant, red, restore,
                  green.
                - Never loop plant-and-restore against the shared tree to measure something. Every
                  run overlapping the loop fails for reasons unrelated to its own subject, and the
                  agents who see that red have no way to attribute it. Copy out of the tree, or
                  ask me for an exclusive window and wait for it.

9  TRAPS.       Each of these returns a confident wrong answer with nothing failing.
                - Bash masks a child exit code to a byte, so 2304 reads as 0.
                - A text-mode tool cannot detect CRLF: Git Bash strips the carriage returns
                  before the pattern sees them, so a plain `grep` reports a clean file that is
                  not one. Dump the bytes, or force binary matching.
                - `git archive` of a subdirectory emits CRLF when the attributes file governing
                  line endings sits above the archived subtree.
                - A budget nested inside another inverts a denial into permission the moment the
                  inner one is the larger. A guard's own watchdog was raised to fifteen seconds
                  inside a hook the harness kills at ten; a killed hook prints nothing, and
                  printing nothing reads as permission, so every decision costing over ten
                  seconds flipped silently from deny to allow. Wherever you put one budget inside
                  another, state both, state which must be the smaller, and add the check that
                  holds them in that order -- an invariant living in two files is enforced by
                  neither.
                - One purpose per shell command. A compound line gives a text-matching guard more
                  to object to, and its refusal then names something none of the commands touched.
                - Once any agent has saved an edit to `scripts/*.sh`, a workflow or one of the
                  build manifests, the gate hard-refuses any scope without `--images`, because
                  the scope check reads the working tree rather than your diff. Satisfying that
                  is mine at the wave boundary: never widen the argument to get past it, and
                  never set an environment variable to skip it.
                - Everything in `.claude/CLAUDE.md` binds you too -- it is in your context without
                  your reading it -- and the pipe rule and the text-mode write rule are there.
                  Section 5 above names the one part of it that is mine rather than yours.
                - <plus the traps specific to this work>

10 TELL ME.     Two things stop your work and come to me. Both are cheap for you to raise and
                expensive for me to find afterwards.
                - BEFORE you change a shared manifest, a guard or a hook registration, tell me
                  and WAIT. Such a change alters what every other agent may DO, not only what it
                  measures, so it needs an exclusive window -- and only you know it is coming, so
                  reporting it afterwards is reporting damage rather than asking for a window.
                  One agent's added version pin made every other agent's gate invocation refuse,
                  and four of them reported it separately as a finding of their own.
                - A guard refusal is a rule arriving: comply with it and tell me. Reaching the
                  same end through a different tool is a violation however good the reason, and
                  so is rewording until it passes. An arm you honestly report as undriven costs
                  nothing.

11 HAND-OVER.   Do not edit a shared document, or any file another agent owns. Write your hunk to
                the scratch path, naming the file, the section anchor and the exact replacement
                text; I apply it in the same commit as the change it documents. Where the hunk is
                for another agent, that agent's brief names the same path.

12 MEASURE.     Interleave the arms -- A, B, A, B in one window -- and report the ratio: two arms
                measured minutes apart on a machine a dozen agents share measure the machine.
                Every figure is an upper bound. Report a spread and what else was running, never a
                bare number, and never a comparison against a figure taken earlier in the session.
                Where a whole exceeds the arithmetic of its parts, say so: that gap is a finding.

13 CLAIMS.      A claim about what the tooling, the harness or a guard permits is established by
                ATTEMPTING the thing -- never by reading a definition, never by reasoning from
                one. Before writing "X is impossible" anywhere durable, do X. A claim you cannot
                test is written as "not established", with the command that would settle it.
                If a change of yours leaves one file contradicting its siblings, the siblings are
                evidence the change is wrong, not leftovers to tidy.

14 REPORT.      Write your report into <report file> as you go, first finding first, never held
                until the end -- an agent killed mid-run returns nothing, and that file is then
                the only place its findings exist. Then give me the same report as your FINAL
                MESSAGE, which is what I read. Exactly, in this order:
                (a) the files you wrote;
                (b) every file you broke and restored, with the byte comparison for each;
                (c) per checklist item, the acceptance evidence, with real exit codes;
                (d) what you could NOT verify, and why;
                (e) anything in this brief that was wrong;
                (f) under its own heading, short: anything you found outside your scope --
                    describe it, do not fix it.
```

**(d) and (f) are load-bearing.** The most useful reports in this programme said "not measurable
here" rather than quoting a number nobody could trust, and (f) is what stops a found-means-fixed
finding from becoming an unowned edit inside another agent's file. Its own heading is what stops it
being lost in a report of several thousand words.

**Section 11 is only half a hand-over.** Name the same path in the producing agent's brief and in
the consuming agent's, or it goes one way only: one agent polled twenty minutes for a line the
other had never been told to write.

## The auditor variant

Two forms, and the agent type decides which (`SKILL.md` §3). Sending the wrong one is not a
cosmetic error: the cold form's agent has no shell, so a brief that asks it for an exit code buys a
dispatch that returns "unsettled", or worse, a working-tree read substituted for the committed
state section 2 asked for.

### The cold form — a `cold-auditor`, and the default for every judging audit

Its tools are `Read`, `Grep`, `Glob` and `Write`: no shell, no `Edit`, no sub-agents. **Replace
sections 1, 2, 3 and 11, and drop section 8** — it governs planting, and this agent cannot plant.

```
1  OWNERSHIP.   You write nothing in the repository -- a hook refuses it -- so your report goes
                to <report file> outside it, under section 14.

2  READ RULE.   You have no shell, so you cannot read committed state yourself. It reaches you in
                this brief instead: <the diff, and the committed text of every file you must
                judge that another agent owns>. Where answering something needs a command, report
                it not established under section 13 and name the command. Never substitute a
                working-tree read for it: the tree holds other agents' half-finished edits and
                answers a different question, which is the whole reason this rule exists.

3  THE SUBJECT. You are given the intent and the diff -- never the implementer's report, which
                would tell you what to believe. Reading a check cannot tell you whether it can
                fail, and you cannot drive one, so every drive-shaped question comes back to me
                as "not established" under section 13, with the command that would settle it. I
                drive it, or a driving re-auditor does. Naming one costs you nothing and is worth
                more to me than a verdict reached by reading.

11 BLAST RADIUS. Say what each change could break outside the files it touches, and name the
                command that would test that.
```

### The driving form — a `general-purpose` re-auditor that must plant

Sections 2 and 8 stand as written; it has the shell they assume. Replace sections 1, 3 and 11:

```
1  OWNERSHIP.   You write no repository file except the violations you plant under section 8,
                each one restored and verified; your report goes to <report file> outside the
                repository, under section 14.

3  THE SUBJECT. You are given the intent and the diff -- never the implementer's report, which
                would tell you what to believe. For every check, guard or assertion you judge,
                DRIVE it under section 8: plant a violation, observe the failure and its exit
                code, restore, observe the pass. Reading it cannot tell you whether it can fail.
                Where a guard refuses the command that would drive an arm, that arm is reported
                undriven, with the refusal quoted. Do not reach it through another tool.

11 BLAST RADIUS. Say what each change could break outside the files it touches, and test that,
                not only the change itself.
```

For a **re-audit**, the subject is the fixes and their blast radius rather than the original work,
and the agent must not have written the fixes. For a **document or plan re-audit**, add one step:
take the previous audit's findings one at a time and report, for each, closed or open, with the
evidence.

## Batching re-auditors

The test for whether two fixes may share one re-auditor is **blast-radius overlap**: they may share
when what one could break is disjoint from what the other could break. The rules that follow:

- Files that **cannot be judged apart** — one parses the other, one grades what the other ran, or
  one asserts a message or an exit code the other emits — go deliberately to a single agent.
  Splitting them produces two reports that contradict each other on one file.
- Anything that can **produce a finding** gets its own drive, never a shared read. Three agents
  reviewed one wrapper and found nothing; a fourth drove it and found a live false green.

Where two bundles overlap on exactly one hunk, name that seam in both briefs and drive the
difference yourself if the two verdicts disagree.
