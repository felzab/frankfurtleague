# Handoff template

A handoff tells the next session what this one believed and how much of it was verified. A pause
inside a session is served by the register's resume point, never by a handoff. A handoff, a register
and a starter describe a session, so what went wrong in one is its subject; a claim the tree does not
bear out is still corrected, and a lesson is written as what is true.

## Required sections

```
# Handoff -- <session name> to <next session name>

## Read these, in this order
<Each file, and the one question it answers. Point at files; do not restate them. The programme
register holding the rulings is one of them, by path.>

## What this session settled, so you do not re-open it
<Decisions with where the argument lives. A ruling is cited by its row in the programme register,
never copied.>

## The single most important thing in this handoff
<One item.>

## What actually bit, this session
<Incidents, each with its mechanism, what it cost, and the rule it leaves behind. An entry with no
incident behind it belongs in a standing rules file.>

## What NOT to redo
<Every rejected option, its reason, and the condition that would re-open it.>

## Open, and owed to the owner
<Every unanswered question and what is blocked behind it; first, whatever must be raised before the
next session starts. Nothing the owner has ruled.>

## Writing your own handoff
<The standard, restated only where this session learned something about it.>

## VERIFIED STATE
<Established by commands, each exit status read from the command itself, between <time> and <time>
on <date>. Where a fact needed a command this session could not run, say so.>

- Branch, and the commit SUBJECTS -- never SHAs.
- Gate state: the full `./scripts/gate/verify.sh`'s exit code, its closing line, the findings.
- Counts, each with who measured it, when, and that it will move.
- What could NOT be established, and why.
```

## What to leave out

- A figure quoted as a baseline that nobody re-measured in the state the next session inherits, and
  any figure taken while the fleet was running.
- A filename a pending fix round will rename: hand over only what reached the end of its cycle.
- A question the owner has ruled.
- A restatement of the rules file, the plan or this skill.

## The starter prompt

A later session's starter is a short map, under a page, that points at its predecessor's handoff
and carries the lines below — never a copy of the handoff. Where a programme's playbook lists what
every starter carries, that list wins over the page bound. The owner sends `/orchestration` as its
own message before pasting it.

```
- Invoke the `orchestration` skill first if it is not already in context.
- Read <handoff path> before doing anything else, then the decisions table of the programme
  register it names. Where the handoff and a rule file -- `~/.claude/CLAUDE.md`, the repository's
  `.claude/CLAUDE.md` -- disagree, the rule file wins on process; a ruling binds the programme
  whose register holds it, and is history for any other.
- Your scope is <session scope>. Its exit condition is <exit condition>. One pull request.
- Raise every open question the moment it arises, in one batch where you can, never in a wrap-up.
- You end by writing the handoff for the next session and having an agent that has not seen your
  work audit it, then fixing what it finds.
```

Both live in the durable plan directory beside the plan, with one copy of each document they cite.
