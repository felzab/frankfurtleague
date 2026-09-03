# Agent register template

One file, written before any agent runs, updated as the only record of fleet state. Its purpose is
stated at the top so a session resuming into it knows what it is trusting. How the fleet is run is
`SKILL.md` §3 to §5; this file is only what the register records and what makes a row trustworthy.

**Name it `REGISTER-<session>.md`, in the session's own plan directory beside the plan.** A resume
searches for exactly that shape and takes the newest match ([resume-prompt.md](resume-prompt.md)
step 1), so a register named anything else is one the owner has to hand over a path for, in the
message where they are least able to. That directory is outside the repository, so no gate, hook or
commit ever reads a register: every rule below is held by whoever writes it and by nothing else.

```
# Agent register -- <programme / session name>

Purpose. With a large fleet running, my memory of what each agent is doing is the weakest link.
This file is the source of truth instead, kept in the durable plan directory beside the plan.
Every dispatch is recorded here BEFORE it runs, nothing is carried in my head between turns, and
a quota stop costs exactly what this file does not hold.

The rule that makes it sound: every agent's condensed verdict is copied into this file as it
lands, and its status is closed in the same edit. A report exists only as the agent's final
message -- the harness has every subagent return findings as text rather than write a file -- so
nothing outlives the turn except what I put here.

Repository state at the start of this fleet: <branch, tip subject, tree clean or not, what is
being written to the repository while the fleet runs>.
Concurrency budget: <cap>, helpers included. Useful implement parallelism peaked at eight to
twelve agents in one programme, and the cap bound only in read-only audit waves. Sub-agent cap
per agent: zero, always -- a fresh agent is a second dispatch of mine.
Scratch path: <one directory, outside the repository, a subdirectory per agent, named in every
brief>.
Starter prompt: <path>. Previous handoff: <path, or none>. Owner's standing instructions: <path>.
These three are what a resume re-reads (`resume-prompt.md` steps 2 and 5), and a compacted
transcript may name none of them.

## Prepared for the unattended stretch -- and nothing here depends on my remembering it

<Every change made so a stretch nobody will answer cannot stall on a prompt: what was changed,
where the byte-exact backup sits OUTSIDE the tree, and the exact command that restores it.
Empty while the session runs attended, and emptied again the moment each is restored.>

## Resume point -- rewritten in the same edit as whatever it names, never at a wave boundary

Next action, and why it is next:
Reports landed and not yet judged:
Commit about to land (from the commit table):
Last gate run: <scope, real exit code, when>
Unattended changes still open, and the command that restores each:

## File ownership -- the map every dispatch is checked against

| Files owned | Agent | Unit of work |
| ----------- | ----- | ------------ |

Hubs (written by more than one unit, so one owner each, in sequence):
Leaves (single owner, dispatchable at any time):
Couplings that are not file edges, shared contracts included:
Tracked generated files, and who regenerates each: <a file a build step writes and git tracks has
no owner in a map built from what agents edit -- several agents change its sources, none owns the
artefact, none regenerates it, and the map shows no conflict because nobody wrote it. It is a
standing line here rather than somebody's file.>

## Commits -- the ownership map's other half, drawn with it

| Commit subject | Files | Message drafted by | Lands after | Audit dispatched to | Landed |
| -------------- | ----- | ------------------ | ----------- | ------------------- | ------ |

A leaf's commit lands in the turn its agent's report is judged, a hub's in the turn its owner's
is. "Lands after" holds the ordering constraints (`SKILL.md` §5) -- a citation's target, a
workflow's manifest -- never prose elsewhere. "Audit dispatched to" is filled in the same edit as
"Landed", and a landed row with it empty is committed work nobody is auditing.

**Validate every message twice.** `python scripts/checks/check_commits.py --message-file <file>`
prints only what fails, so an over-long subject and an unknown scope come back at exit 0 with no
output at all. The second route is the checking function itself, which prints both tiers:

    python -c "import sys;sys.path.insert(0,'scripts/checks');from check_commits import check_message;[print(f.severity,f.detail) for f in check_message(open(sys.argv[1],encoding='utf-8').read(),'pending')]" <file>

Run both, read both, and treat a message that passes only the hook's route as unvalidated. Neither
route judges the `Closes:` trailer, which needs a diff: a bare
`python scripts/checks/check_commits.py` over the branch range does, and prints the report tier
besides, but only once the commit exists -- so run it in the turn the commit lands, while
`git commit --amend` still reaches the tip. Past that a reword is a rebase.

## The cycle, per slice -- decided here, before any finding exists

| Slice | Rounds | Lightened? Reason, or "no" |
| ----- | ------ | -------------------------- |

At a handful of slices the full two rounds are the default and a lightening is the exception. Past
that, the exception becomes the rule: two rounds cost two agents a slice, so fifteen slices is
thirty audit agents spent before a finding exists. Give the full cycle to the few slices every
other one is judged against -- a defect there propagates into all the rest before anyone sees it --
and one audit and one fix to everything whose blast radius is its own file group. Every row still
carries its reason, and the reason is written before any finding exists either way.

**Where the session BUILDS a mechanism meant to change what people write** -- a rule set, a prompt,
a card delivered before every edit, a linter -- one of its slices is an A/B rather than an audit:
the same writing task to two agents, one given the mechanism and one denied it, both outputs read
against the rules afterwards. It costs two read-only agents, it tests the premise rather than the
plumbing, and it is the only instrument that can find the mechanism worthless while there is still
time to change it. Driving every check red proves the machinery runs, which is the cheap half; a
check is verified against what it makes people WRITE, and the free half of that is asking each
agent to report where it shaped its prose to satisfy a checker.

## Tree health -- re-established at every wave boundary, not assumed

<Two facts everybody relies on and nobody owns: the shared tooling still imports and its registry
holds what it should, and `git status --porcelain` reconciles against the ownership map with no
path unassigned. A syntax error in a module the gate imports kills every gate invocation in the
tree and announces nothing -- one was found only because an unrelated agent tried to import it and
mentioned the failure under "what I could not verify".>

## Live agents

| Agent name | The question it settles | Owns | Cycle | Last write to an owned file | Status |
| ---------- | ----------------------- | ---- | ----- | --------------------------- | ------ |

The agent name is the name it was dispatched under, and it is one value doing three jobs: its
scratch subdirectory is named for it, its brief calls it `<your agent name>`, and it is the address
a resume is sent to. Record it at dispatch; a resume has nothing to aim at otherwise.

Cycle is one of: implement, audit, fix, re-audit, fix, done.

## Plant-and-restore windows currently open

| Agent | Files it may break | Declared at | Restore confirmed |
| ----- | ------------------ | ----------- | ----------------- |

## Standing actions -- queued work and the condition that releases each

| Trigger | The whole brief, written out now | Dispatched? |
| ------- | -------------------------------- | ----------- |

## The ending -- enumerated before the last wave goes out

<Assembly of the last wave; the gate at <scope>; the draft pull request; the `verify` run's
conclusion; the handoff and its independent audit; the starter prompt. Once one wave plus this
list is what remains, dispatch nothing new.>

## Decisions taken by the owner, and where each was routed

| # | Question | Ruling | Routed to |
| - | -------- | ------ | --------- |

## Open, awaiting the owner

<A batch goes to the owner as prose. The question tool caps at four questions of four options, so
a longer batch cannot go through it, and flattening one into buttons drops the sub-questions that
were the reason for asking; keep the tool for the crisp blocker, which is what it is good at.>

## Cross-agent handoffs in flight

<Agent A writes X to the scratch path; agent B owns the file it lands in; I route it. Both briefs
name the path.>

## Findings banked, and handoff material

<Per completed agent: the condensed verdict. What the next session's handoff will need is written
here as it lands, never reconstructed at the end.
Before banking a novelty as a preference, run the thing that would fail if it were not one: a
report saying "these are the first two occurrences in the repository" is describing a convention
it has just watched being broken, and one command settles whether that is new capability or a
violation.>
```

## What makes a row trustworthy

- **Keep every row short enough that adding one is cheaper than skipping it.** Under load a
  coordinator dispatched first and recorded later twice, then rewrote the table wholesale hours
  after the fact — the cost of a wide row is paid every time the fleet is busiest.
- **Close a status in the same edit that banks the verdict, never in batches.** Eight rows read
  RUNNING for agents that had finished, and the coordinator spent that stretch tracking eleven live
  agents against a register describing a different fleet. A stale register is worse than none,
  because it is trusted.
- **The live-agent column is the question the agent settles, not its subject.** Two agents were sent
  to prove one negative under two different subject headings; file ownership catches nothing when
  both write different files or none. The converse costs more: **a dispatch you hold in mind by its
  task is one whose paths you never diff**, and two briefs of different verbs and concerns — rewrite
  this page, reconcile that derivation — can name one destination without ever sounding alike. Two
  agents held one file for three minutes that way, and nothing mechanical noticed: `git status`
  shows a modified file, never two owners.
- **Fill "last write to an owned file" from the file's timestamp**, never from the agent's status
  label. Two agents stalled silently for over an hour behind a live-looking label, while another
  looked stalled for 45 minutes because only its notes file was being watched.
- **Open a plant-and-restore row before the agent plants and close it when the restore is
  confirmed.** The open row is what an unrelated red is attributed to (`SKILL.md` §4), so one
  opened after the fact attributes nothing.
- **Write the standing action's whole brief when you queue it**, not a note to write one, and tick
  it only against evidence that it went out. A queued brief recovered from memory later is a
  different brief; one recorded correctly here was never dispatched, and only the end-of-session
  handoff caught it.
- **Name a cross-agent hand-over's path in both briefs.** One named in one brief is written and
  never collected, or waited for twenty minutes and never written.

## Running unattended

`SKILL.md` §1 gives the decision axis; this is what the register then owes. **A subagent's prompt
surfaces in the owner's session rather than the agent's**, so an agent that trips one does not fail
fast — it parks the whole fleet behind a dialog nobody is awake to answer, and the register is the
only thing that will still be true in the morning.

- **Bypass permissions mode does not suppress a hook's `ask`** — driven and confirmed: a
  `PreToolUse` hook returning `permissionDecision: "ask"` prompted the owner with bypass mode
  active. So bypass is not the preparation, whatever it is named for; removing the registration is
  the only mechanism that reaches such a prompt, which is the next clause's cost.
- **A deny lets a session adapt; only an unanswerable ask hangs it.** So the asks go and every deny
  stays, and hooks are never disabled wholesale: the denies are what prevent real damage, and a
  session that has switched off its credential and branch guards to sleep more soundly has bought
  the wrong thing.
- **Removing a guard's registration is the owner's instruction to give, never the coordinator's to
  take** — it is routing around a guard, whatever the reason looks like at midnight.
- **The prompt surface is not enumerable from the hooks.** Prompts also come from the harness's own
  permission classifier reacting to whatever is not on its allow list, so a shell command, a script
  invocation and a skill call can each raise one with no hook involved. Auditing the registrations
  and declaring the surface closed is a false green, and one command running unprompted establishes
  that command and nothing about its class.
- **The change is undone by mechanism, never by memory.** Four of them, each catching what the
  others miss: a byte-exact backup outside the tree; its restore command written into the resume
  point above; staging by explicit path, so no `git add -A` can sweep the change into a commit; and
  a path-by-path read of the pull request diff before the push. "I will put it back in the morning"
  is not one of the four.
- **A pre-authorisation is executed against its intent.** Where applying it literally would defeat
  what it was given for — a bound moved to a number that binds nothing, a cut that empties the thing
  it was meant to tighten — it goes back unexecuted though the permission exists. Two instructions
  in tension are surfaced as a tension rather than resolved by picking one, and the tension is
  usually invisible until somebody measures the distribution.
- **Every call taken alone is closed and recorded, never parked.** Record it as it is taken, with
  its reasoning and what reversing it would cost. A decision handed back costs more than one taken
  wrongly, because the wrong one is visible in a diff and the deferred one is a pile of homework
  waiting at breakfast.
