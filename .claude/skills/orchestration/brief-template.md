# Brief template

A brief is what a dispatch adds to the agent's definition under `.claude/agents/`, which the harness
loads as the agent's system prompt and which binds whatever the brief says. A brief carries only the
parts below and never restates a standing section of the definition: the definition is that
section's one home.

Two lines are read by tools, each at the start of a line, and nothing else in a brief is checked:

- `Owns:` lists every path a writer may write, separated by a comma and a space, each relative to
  the repository root with forward slashes: a file, a folder for everything under it, or a glob
  where `*` matches within one folder and `**` across folders, with no `{a,b}` brace sets. A brief
  may carry several such lines; `reg.py overlap --brief` reads their union. A brief for an agent
  that writes no repository file carries none, and a path named anywhere else — one forbidden,
  another agent's region — stays prose.
- `Rows:` names, each by its ledger id, the findings-ledger rows a writer's work answers, and
  `reg.py dispatch --brief` routes them to the agent, naming each refusal. An auditor's or a
  researcher's brief names the rows it judges in its text alone: an agent that lands nothing closes
  no row, and a `Rows:` line would take the rows from their fixer. A brief citing a row only for
  context leaves it off the line, and one answering none carries no such line.

## Contents

- [Sizing a brief](#sizing-a-brief)
- [The implementer's brief](#the-implementers-brief)
- [The cold auditor's brief](#the-cold-auditors-brief)
- [The driving re-auditor's brief](#the-driving-re-auditors-brief)
- [The researcher's brief](#the-researchers-brief)

## Sizing a brief

A brief is sized by what losing its agent's whole output would cost, and carries:

- every path in full, globbed first;
- for a signature change, the callers and every test asserting the call's text;
- for a design, its cost measured and what already constrains its surface read, before it is
  briefed as the closure;
- each acceptance check named by what it asserts;
- every figure with its provenance;
- a plan's repair briefed to be driven, and reported if it does not close;
- a judgement test with its parameters and one worked verdict;
- the version meant, wherever the session is rewriting the rules cited.

## The implementer's brief

`.claude/agents/implementer.md` carries every other section. The brief carries the values that
definition names in angle brackets, the BAR line, OWNERSHIP, THE WORK, and the traps specific to
this work. The bar reaches an agent only through its brief: the definitions are dispatched outside
skill sessions too. The definition withholds `gh`, so a CI failure the work must answer goes in as
the lines `ci.py` printed for it, never as a run to read.

```text
VALUES.         Your agent name: <name>. Session branch: <session branch>; your worktree forked
                from it at <sha>. Coordinator's checkout: <path>. Scratch path: <path>.

BAR.            Done is every item met in full, nothing traded. Challenge an item that conflicts
                with documented practice or the evidence before you build it. Ask what you cannot
                verify; never assume it. Lean: a test only where a behaviour could regress unnoticed
                and it is the cheapest guard, a comment or document only for what the code cannot
                say, the smallest change that fully solves the item, and removing an unneeded test,
                doc or helper counts as a gain. <What else the skill's bar means for this work.>

1  OWNERSHIP.   The exact files you may write, on the `Owns:` lines below. Writing any other file
                is a defect in this brief -- stop and report it, or message me for it, rather than
                working around it. <N> other agents work in worktrees of their own, and none of
                you sees another's edits until I land them.
                <Where a file is shared: who else is in it, and which region is theirs. Keep at
                least one unchanged line between your edit and theirs: git merges two hunks one
                line apart, and conflicts on a line both change or on one insertion point both
                use. Anchor every edit on a unique fragment.>
Owns: <path>, <path>

3  THE WORK.    A numbered checklist. Each item states: the change; the anchor it lands at, which
                is a symbol, a path or a rule id and never a line number; and its own acceptance
                test, named before you start.
                DRIVE every case you add or change RED before you call its item closed: a case
                that compares a thing to its own definition, or asserts source text nobody
                rendered, passes on the day the behaviour goes. Where an item changes what a person
                SEES, its acceptance names the served page and the reading that proves it.
                An item that changes a thing's IDENTITY -- splitting a numbered row, renaming a
                symbol -- or removes a concept carries its outward sweep in the same item: every
                citation into a split row, and the concept's vocabulary in prose no check reads.
Rows: <row id>, <row id>

9  TRAPS.       Beyond your definition's standing list: <the traps specific to this work>
```

## The cold auditor's brief

`.claude/agents/cold-auditor.md` holds only `Read`, `Grep` and `Glob`, and carries its report
contract and its calibration; the block below is the brief's whole standing text. Check the brief's
verbs before it goes out: run, measure, drive red and read the diff each need a shell this agent
lacks. A re-audit's subject is the fixes and their blast radius, by an agent that wrote none of them;
a document or plan re-audit also takes the previous audit's findings one at a time, each by its
ledger id, closed or open with its evidence.

```text
BAR.            Ask what you cannot verify; never assume it. A test, document or helper with no
                job is a finding too: removing it counts as a gain. <What else the skill's bar
                means for this subject.>

1  OWNERSHIP.   You write nothing, having no tool that writes. Your report is your final
                message.

2  READ RULE.   You have no shell, so committed state reaches you in this brief: <the diff, and the
                committed text of every file you must judge that another agent owns>. Where an
                answer needs a command, report it not established and name the command. Never
                substitute a working-tree read: any tree you can read holds some state other than
                the diff you judge.

3  THE SUBJECT. The intent and the diff -- never the implementer's report. Reading a check cannot
                tell you whether it can fail, and you cannot drive one: report every drive-shaped
                question as one for me or a driving re-auditor. Where a rule names the check
                enforcing it, ask whether the check enforces what the rule CLAIMS or a fragment.

4  PUSH BACK.   This brief may be wrong. A premise the tree contradicts is reported, not judged by,
                and one that names its source is a claim you check before you rely on it.

10 TELL ME.     A guard refusal is a rule arriving: comply with it and report it. Reaching the same
                end through a different tool, or rewording until it passes, is a violation.

11 BLAST RADIUS. Say what each change could break outside the files it touches, and name the
                command that would test it.

13 CLAIMS.      What the tooling, the harness or a guard permits is established only by attempting
                it, which you cannot do: report such a claim "not established", with the command
                that would settle it. Where a change leaves one file contradicting its siblings,
                the siblings are evidence the change is wrong.
```

## The driving re-auditor's brief

`.claude/agents/driving-reauditor.md` carries its standing sections. The brief carries the values
that definition names, the cold auditor's BAR line, the intent and the diff — never the
implementer's report — and the blast radius the bundle of fixes shares.

## The researcher's brief

`.claude/agents/researcher.md` carries its standing sections and its report. The brief carries the
values that definition names, the cold auditor's BAR line, and the question, or for an audit the intent and the refs to read with
`git show`. It asks for no install, suite or plant: those go to a driving re-auditor.
