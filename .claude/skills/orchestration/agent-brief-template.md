# Agent brief template

Every dispatched agent gets every section below. Push back and the report contract are the two that
pay for the whole template: they are what turned seven wrong briefs into seven corrections rather
than seven defects. Fill the angle-bracketed placeholders and delete nothing.

```
1  OWNERSHIP.   The exact files you may write, listed in full:
                  <path>
                  <path>
                Writing any other file is a defect in this brief -- stop and report it rather than
                working around it. You are one of <N> agents editing this working tree right now.

2  READ RULE.   For any file you do NOT own, read the committed state -- `git show HEAD:<path>`.
                The working tree holds another agent's half-finished edit and answers a different
                question from the one you are asking.

3  THE WORK.    A numbered checklist. Each item states: the change; the anchor it lands at, which
                is a symbol, a path or a rule id and never a line number; and its own acceptance
                test, named before you start.

4  PUSH BACK.   This brief may be wrong. Seven briefs in one session were, and the agents caught
                all seven. If a premise here does not survive contact with the tree, stop and
                report it instead of building on it. Naming a wrong premise is worth more to me
                than finishing the task. Where you are asked to build on a claim you have reason
                to doubt, ask for the evidence behind it before you build.

5  GIT.         You run NO git command that writes -- no add, commit, checkout, stash, reset.
                A `git stash push` by one agent emptied the shared tree under nine editors, and
                concurrent staging corrupts the index. Write your proposed commit message to
                <scratch path>; I assemble every commit.

6  SUB-AGENTS.  <N, normally zero>. Do not exceed it. Unbounded fan-out has twice consumed the
                whole concurrency budget and blocked the work queued behind it.

7  WRITE AS     Write your report to <scratch path> incrementally, first finding first, never
   YOU GO.      held until complete. A quota stop killed six agents at once; the one whose work
                was lost was the audit that had written nothing to disk.

8  TRAPS.       Never read an exit code through a pipe -- piping a command into another and then
                reading the status gives the second command's status, not the first's.
                Bash masks a child exit code to a byte, so 2304 reads as 0.
                A Windows text-mode stream turns every newline into CRLF invisibly, in a scratch
                file as much as a tracked one: write bytes, or pass an explicit empty newline.
                A new or changed check is not done until it has been driven red and then green,
                with the exit code recorded at each step.
                <plus the traps specific to this work>

9  DOCS.        Do not edit a shared document that another agent owns. Write your documentation
                hunk to <scratch path>, naming the file, the section anchor and the exact
                replacement text. I apply it in the same commit as the change it documents.

10 REPORT.      Exactly, in this order:
                (a) the files you wrote;
                (b) per checklist item, the acceptance evidence, with real exit codes;
                (c) what you could NOT verify, and why;
                (d) anything in this brief that was wrong;
                (e) anything you found outside your scope -- describe it, do not fix it.
```

**(c) and (e) are load-bearing.** The most useful reports in this programme said "not measurable
here" rather than quoting a number nobody could trust, and (e) is what stops a found-means-fixed
finding from becoming an unowned edit inside another agent's file.

## The auditor variant

Dispatch it as a read-only agent type where one exists (`SKILL.md` §3), and replace sections 1, 3
and 9 with:

```
1  OWNERSHIP.   You write nothing in the repository. Your output is a report at <scratch path>.

3  THE SUBJECT. You are given the intent and the diff -- never the implementer's report, which
                would tell you what to believe. For every check, guard or assertion you judge,
                DRIVE it: plant a violation, observe the failure and its exit code, restore,
                observe the pass. Reading it cannot tell you whether it can fail.

9  BLAST RADIUS. Say what each change could break outside the files it touches, and test that,
                not only the change itself.
```

For a **re-audit**, the subject is the fixes and their blast radius rather than the original work,
and the agent must not have written the fixes. For a **document or plan re-audit**, add one step:
take the previous audit's findings one at a time and report, for each, closed or open, with the
evidence.

## Batching re-auditors

The test for whether two fixes may share one re-auditor is **blast-radius overlap**: they may share
when what one could break is disjoint from what the other could break. The rules that follow:

- Files that **cannot be judged apart** — one parses the other, or one grades what the other ran —
  go deliberately to a single agent. Splitting them produces two reports that contradict each other
  on one file.
- Anything that can **produce a finding** gets its own drive, never a shared read. Three agents
  reviewed one wrapper and found nothing; a fourth drove it and found a live false green.

Where two bundles overlap on exactly one hunk, name that seam in both briefs and drive the
difference yourself if the two verdicts disagree.
