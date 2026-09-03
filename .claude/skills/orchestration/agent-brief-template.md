# Agent brief template

Every dispatched agent gets every section below. Push back and the report contract are the two that
pay for the whole template: across two sessions more than half the briefs carried a premise the tree
contradicted, and every agent that pushed back was right — counted from the landed reports, the only
place that figure exists. Fill the angle-bracketed placeholders and delete nothing: a brief is a
prompt rather than a file, so nothing checks one, and a section dropped here is a constraint the
agent never sees.

**The brief is the agent's whole world, so it has to carry what the agent must NOT do as carefully
as what it must.** Sections 5, 6, 9 and 10 are that half, and each of them exists because an agent
did the reasonable thing in their absence.

**Five rules about writing one.**

- **Glob every path before the brief goes out.** A file list assembled from another agent's report
  inherits that report's errors, and the agent's rediscovery costs more than the check.
- **Give every figure its provenance**, because a number acquires false authority in transit —
  three relayed in one programme were wrong in three different directions.
- **Never cap the report's length.** A cap makes an agent drop its caveats, its not-established
  notes and its out-of-scope findings first, those looking least like findings, which is the class
  the report exists to carry. Shape is the instruction instead, and section 14 gives it.
- **A judgement test the brief hands out names its parameters, and is calibrated once with a worked
  verdict before it reaches a second agent.** A test phrased over "a reader" left every sweep to
  pick its own, each picking the most generous one available, so one rule produced opposite verdicts
  across a corpus with nothing to reconcile them and the coordinator alone able to see the spread.
- **Where the session is rewriting the rules it works under, every instruction citing one says which
  version it means.** An agent reading `HEAD` is right to refuse a clause that exists only in the
  revision being assembled, and you are the only party holding both texts.

```
1  OWNERSHIP.   The exact files you may write, listed in full:
                  <path>
                  <path>
                Writing any other file is a defect in this brief -- stop and report it rather than
                working around it. You are one of <N> agents editing this working tree right now.
                <Where a file is shared: who else is in it, and which region is theirs. Anchor
                every edit on a unique fragment, so an edit made stale by their work fails loudly
                instead of landing in the wrong place.>
                <Where one of these files already holds an earlier agent's finished but
                uncommitted edits: name that agent. This list answers "may I write here", never
                "is this file clean", and an agent finding changes in its own file that it did not
                make reports the ownership map as broken -- correctly, and at the cost of proving
                nothing was clobbered in either direction before it can trust its own diff.>

2  READ RULE.   For any file you do NOT own, read the committed state -- `git show HEAD:<path>`.
                The working tree holds another agent's half-finished edit and answers a different
                question from the one you are asking.

3  THE WORK.    A numbered checklist. Each item states: the change; the anchor it lands at, which
                is a symbol, a path or a rule id and never a line number; and its own acceptance
                test, named before you start.
                An item that changes a thing's IDENTITY -- splitting a numbered row, renaming a
                symbol -- or that removes a concept carries its outward sweep in the same item.
                Every citation into a split row still resolves while pointing at the half that no
                longer carries the claim, and a deleted concept's VOCABULARY survives in prose no
                citation check reads: both are green in every gate there is.

4  PUSH BACK.   This brief may be wrong. More than half of them are, by my count across this
                programme's sessions, and the agents caught every one. If a premise here does not
                survive contact with the tree, stop and report it instead of building on it. Naming
                a wrong premise is worth more to me than finishing the task. A premise that names
                its source -- "an audit reported X" -- is a claim: verify it in one command before
                you build on it, and ask for the evidence behind one that names no source at all.
                Every figure here names where it came from, and one that is not mine to vouch for
                you measure yourself before you act on it -- cutting to meet a description rather
                than the rule is how a report comes back successful against a number nobody held.

5  GIT.         You are on branch <branch>, which I cut before dispatching you. `.claude/CLAUDE.md`
                §2's branch trigger binds you as it binds me, and here it is already satisfied: run
                `git rev-parse --abbrev-ref HEAD` before your first edit, and anything but <branch>
                is a wrong premise under section 4 -- stop and report it rather than moving the
                tree yourself.
                You run NO git command that writes and NO command that reaches the remote: no
                add, commit, checkout, stash, reset, no push, and no `gh` at all -- not
                `gh pr create`, not `gh pr ready`, not `gh pr merge`. A `git stash push` by one
                agent emptied the shared tree under nine editors, and concurrent staging corrupts
                the index. `git checkout -- <path>` is included: it restores from the INDEX, not
                from the last commit, so in a shared tree it discards a colleague's unstaged work.
                A backup you take by hand carries the same hazard and the same rule: it obliges you
                to RECONCILE against that copy rather than restore from it, a restore being a
                silent revert wearing a safety measure's clothes that discards whatever the file's
                other writer did in the window you held it.
                Write your proposed commit message to the scratch path; I assemble every commit.
                The gate is mine as well. `./scripts/gate/verify.sh` is a wave-boundary instrument and
                a run over a tree a dozen agents are writing exits non-zero on somebody else's
                half-written file, so drive your own checks by calling the underlying tool.
                `.claude/CLAUDE.md` §2 defines a finished task as one whose branch is pushed and
                whose draft pull request is open. That definition is addressed to me, not to you:
                YOU are finished when your report lands.

6  SUB-AGENTS.  ZERO, whatever this task looks like it needs: the owner's standing instructions
                allow no agent to spawn one. Where a question needs a fresh agent, say so and
                stop -- I dispatch it myself at the top level. Unbounded fan-out has twice
                consumed the whole concurrency budget and blocked the work queued behind it.

7  SCRATCH.     <scratch path>/<your agent name>/ -- your own subdirectory, outside the
                repository, for everything you write that is not a file you own: a proposed commit
                message, a hunk for someone else's file, a copy to measure against. Your report
                is not a file at all (section 14).
                Agents sharing one directory overwrite each other in it.
                Keep scratch out of the repository: `.claude/hooks/guard-credential-shell.sh`
                refuses a shell command naming a path `.gitignore` matches, outside the
                exemptions it lists, so a scratch file under the repository is one no command of
                yours can reach. The Read tool still opens it, which is what makes the gap easy
                to miss: you write the file, read it back, and find out only when a script needs
                it.

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
                - Verify each plant by READING the planted file back, never by the writing tool's
                  exit or its success message. Where the planted state's expected observation is a
                  pass rather than a red -- reverting a normaliser, undoing an exemption -- a
                  plant that silently never landed is indistinguishable from a successful drive,
                  and the report says "driven red, restored" and is wrong.
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
                - A budget nested inside a larger one inverts denial into permission: a hook the
                  harness kills at ten seconds ran its own watchdog at fifteen, and a killed
                  hook's silence reads as permission. State both budgets, which must be the
                  smaller, and add the check holding them in order -- two files enforce nothing.
                - One purpose per shell command. A compound line gives a text-matching guard more
                  to object to, and its refusal then names something none of the commands touched.
                - Once any agent has saved an edit to a path `scripts/gate/scope_map.sh` maps to
                  the images scope, the gate hard-refuses any scope without `--images`, because
                  the scope check reads the working tree rather than your diff. That file decides
                  the set and it is wider than the Dockerfiles and the build manifests: three
                  `fl_frontend/src/` modules are in it, and so is every path no arm there
                  recognises at all. Satisfying it is mine at the wave boundary: never widen the
                  argument to get past it.
                - Everything in `.claude/CLAUDE.md` binds you too -- it is in your context without
                  your reading it -- and the pipe rule, the text-mode write rule and §2's branch
                  trigger are there. Three parts of it are mine rather than yours, and each would
                  otherwise send you into a file you do not own: §2's branch-cutting, push and
                  pull-request clauses, which are section 5 above; §3's "a finding outside the task
                  becomes a roadmap entry at once", which is section 14(f) for you and mine to
                  route, since every agent's out-of-scope findings land on the one roadmap page;
                  and §8's "update every claim a change invalidates in the same commit", which is
                  section 11 for you -- write the hunk, and I apply it in that commit.
                - <plus the traps specific to this work>

10 TELL ME.     Two things stop your work and come to me. Both are cheap for you to raise and
                expensive for me to find afterwards.
                - BEFORE you change a shared manifest, a guard or a hook registration, tell me
                  and WAIT. Such a change alters what every other agent may DO, not only what it
                  measures, so it needs an exclusive window -- and only you know it is coming, so
                  reporting it afterwards is reporting damage. One added version pin made every
                  other agent's gate invocation refuse, and four reported it as their own finding.
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

14 REPORT.      Your report is your FINAL MESSAGE and there is no second copy of it anywhere: the
                harness instructs you to return findings as text rather than write a report file,
                so everything you have not yet said dies with you. What survives instead is what
                is on disk, so close checklist items in ORDER and leave each one's acceptance
                evidence where I can find it. **No length limit.** What I cannot use is narration
                of your own process, or this brief restated back to me. Exactly, in this order:
                (a) the files you wrote;
                (b) every file you broke and restored, with the byte comparison for each;
                (c) per checklist item, the acceptance evidence, with real exit codes;
                (d) what you could NOT verify, and why;
                (e) under its own heading, ALWAYS answered: what in this brief was wrong -- a
                    premise the tree contradicts, a figure that does not hold, a proof this brief
                    prescribes that returns the opposite result. "Nothing was wrong" is an answer,
                    and a contradicted premise is worth more to me than a confirmed one: it is the
                    only thing that stops me writing the next brief the same way;
                (f) under its own heading, short: anything you found outside your scope --
                    describe it, do not fix it, and where it looks like one instance of a class,
                    say what the class is and how wide you think it runs;
                (g) anywhere you shaped the work to satisfy a check rather than to be right --
                    restored a sentence to keep an exemption, split a block, worded around a
                    matcher. That is a finding about the check and you are the only one who can
                    see it, so it reads as process narration and gets left out unless asked for.

15 THE STANDARD. `docs/_standard/standard.md` binds every document, comment, commit message and pull
                request body you write, and `docs/_standard/worked-examples.md` is those rules applied to
                real passages. Read both in full, at those paths, before your first
                documentation-shaped write. `.claude/hooks/docs-standard.sh` puts the Spine and
                the bounds in front of every such write, sliced out of the standard at runtime --
                one section of it, and never a substitute for the read.
```

**Section 15 names `docs/_standard/standard.md` and `docs/_standard/worked-examples.md` rather than copying either.**
Each rule keeps the one home COR-2 gives it, `.claude/hooks/docs-standard.sh` slices the same file
at every documentation-shaped write, and a rename that misses one of the three fails the `path`
check here and the `bare-path` check in the hook. The paths are repeated in this sentence because
the fenced block above is stripped before any check reads it, so a path named only inside it
resolves to nothing the day the file moves and nothing fails.

**(d) and (f) are load-bearing.** The most useful reports in this programme said "not measurable
here" rather than quoting a number nobody could trust, and (f) is what stops a found-means-fixed
finding from becoming an unowned edit inside another agent's file. Its own heading is what stops it
being lost in a report of several thousand words. **These three are also the first casualties of a
length cap**, which is why none is set: they look less like findings than the findings do.

**(e) is asked because agents do not volunteer it.** A wrong premise worked around in silence leaves
the next brief carrying it, and the agent is the only party who can see it: one brief prescribed its
own proof — run the backend suite, expect it to pass — against a suite that returned exit 1 with 155
failures.

## The auditor variant

Two forms, and the agent type decides which (`SKILL.md` §3.5).

### The cold form — a `cold-auditor`, and the default for every judging audit

Its tools are `Read`, `Grep`, `Glob` and `Write`: no shell, no `Edit`, no sub-agents, and no
destination its `Write` may use — a hook refuses the repository, and the harness **instructs** every
subagent not to write a report file, which is an instruction rather than an error, so such a write
succeeds at exit 0 and nothing announces that the report went nowhere anyone reads.
**Replace sections 1, 2, 3, 10, 11 and 14, and drop sections 5, 7, 8, 9 and 12.** Five and nine are
shell — an enumeration of git commands, and traps about running things; seven hands out a scratch
directory this agent has nothing to put in; eight governs planting and twelve measuring, and it can
do neither. Ten is replaced rather than dropped because its
second half, a guard refusal being a rule arriving, is the one clause of it this agent will meet:
its own `Write` hits that refusal. Section 14 goes because (a) to (c) ask for files written, files
restored and exit codes, none of which this agent can produce; the replacement is the order **and
the medium** its agent definition gives, so the two contracts are one — check that, because a
definition drifting from this page is how an agent gets two report contracts at once.

**Check the brief's verbs against that list before it goes out.** Run, measure, drive red and read
the diff each need a shell this agent has not, and it cannot know what tools it was meant to have:
briefed to read a diff it audits the tree as it stands, which cannot say which defects the work
introduced and which predate it.

```
1  OWNERSHIP.   You write nothing: not in the repository, where a hook refuses it, and not a
                report file, which the harness tells you not to write. Your report is your final
                message, under section 14.

2  READ RULE.   You have no shell, so you cannot read committed state yourself. It reaches you in
                this brief instead: <the diff, and the committed text of every file you must
                judge that another agent owns>. Where answering something needs a command, report
                it not established under section 13 and name the command. Never substitute a
                working-tree read for it: the tree holds other agents' half-finished edits and
                answers a different question.

3  THE SUBJECT. You are given the intent and the diff -- never the implementer's report, which
                would tell you what to believe. Reading a check cannot tell you whether it can
                fail, and you cannot drive one: every drive-shaped question comes back under
                section 13 for me or a driving re-auditor, and naming one is worth more to me
                than a verdict reached by reading.
                Where a rule names the check enforcing it, ask of each pair whether that check
                enforces what the rule CLAIMS or only a fragment of it. The name resolves either
                way, so a rule and its check can be written in one session, disagree about what is
                enforced, and leave every gate green.

10 TELL ME.     A guard refusal is a rule arriving: comply with it and report it under section 14.
                Reaching the same end through a different tool is a violation however good the
                reason, and so is rewording until it passes.

11 BLAST RADIUS. Say what each change could break outside the files it touches, and name the
                command that would test that.

14 REPORT.      Your report is your FINAL MESSAGE and there is no second copy: the harness
                instructs you to return findings as text rather than write a report file, so an
                audit cut short returns nothing. No length limit. Exactly, in this order: what you
                verified and how; what you could NOT verify, and why; anything in this brief that
                was wrong; anything outside your scope, described and not fixed.
```

### The driving form — a `general-purpose` re-auditor that must plant

Sections 2 and 8 stand as written; it has the shell they assume. Replace sections 1, 3 and 11:

```
1  OWNERSHIP.   You write no repository file except the violations you plant under section 8,
                each one restored and verified; your report is your final message, under section
                14.

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
