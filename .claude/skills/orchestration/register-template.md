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
Concurrency budget: <cap>, helpers included -- what the owner last said: this session, else the
latest row of the programme register, else 12, under a ceiling of 20; it paces quota, and is never
taken from a handoff, which is written before a session ends. Beneath it sits a lower ceiling, what
quality bears, which is learned by watching quality rather than taken from a figure some earlier
session remembered.
Sub-agent cap per agent: zero, always -- a fresh agent is a second dispatch of mine.
Model: every dispatch passes "opus" unless the owner or a ruling below names another for that
work; design and plan-audit work may take the stronger model the owner names for it, one such agent
at a time, and whether a piece of work earns it is mine to decide rather than to ask.
Scratch path: <one directory, outside the repository, a subdirectory per agent, named in every
brief>.
Starter prompt: <path>. Previous handoff: <path, or none>. These two are what a resume re-reads
(`resume-prompt.md` steps 2 and 5), and a compacted transcript may name neither.

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

| Commit subject | Files | Lands after | Audit dispatched to | Landed |
| -------------- | ----- | ----------- | ------------------- | ------ |

A leaf's commit lands in the turn its agent's report is judged, a hub's in the turn its owner's
is. "Lands after" holds the ordering constraints (`SKILL.md` §5) -- a citation's target, a
workflow's manifest -- never prose elsewhere. "Audit dispatched to" is filled in the same edit as
"Landed", and a landed row with it empty is committed work nobody is auditing. No column records
who drafted the message: every one is mine, assembled in minutes from the agents' scratch
paragraphs and never dispatched (`SKILL.md` §4, §5).

**Stage a file that must execute with its mode, and read it back with `git ls-files -s`.**
`core.fileMode` is false here, so a new file lands 100644 whatever the filesystem says, and a hook
without the executable bit is skipped in silence on Linux.

**Validate every message twice.** `python scripts/checks/check_commits.py --message-file <file>`
prints only what fails, so an over-long subject and an unknown scope come back at exit 0 with no
output at all. The second route is the checking function itself, which prints both tiers:

    python -c "import sys;sys.path.insert(0,'scripts/checks');from check_commits import check_message;[print(f.severity,f.detail) for f in check_message(open(sys.argv[1],encoding='utf-8').read(),'pending')]" <file>

Run both, read both, and treat a message that passes only the hook's route as unvalidated. Neither
route judges the `Closes:` trailer, which needs a diff: a bare
`python scripts/checks/check_commits.py` over the branch range does, and prints the report tier
besides, but only once the commit exists -- so run it in the turn the commit lands, while
`git commit --amend` still reaches the tip. Past that a reword is a rebase.

**Mechanise this whole sequence before the first commit lands, and pin the session's constants at
the top of the script.** A wave costs its longest agent and this costs a sum, so it decides the
session's wall clock while appearing in no wave row, and paying it by hand once per commit is where
a schedule read-back's arithmetic quietly goes wrong. One call per commit, on the scratch path
rather than in the repository, which owes a tracked script its scope, its documentation and its
audit. What that script owes:

- **It stops at the first red step with nothing committed**, so a failure leaves the tree as it
  found it and the run is repeated rather than unpicked.
- **It refuses to run against an index that is not empty** unless told the hunks were staged
  deliberately: in a shared tree an inherited index sweeps another agent's work into your commit.
  `git commit --amend` commits that same index rather than the tip's file set, so the refusal binds
  an amend as it binds a commit; a tip that folded foreign files in is repaired with
  `git reset --soft HEAD~1` and a re-stage from the folded commit.
- **It stages from a diff captured at the start of the run, never with `git add`.** In a tree the
  fleet is still writing, `git add <path>` stages whatever the file holds at that instant rather
  than the content you judged.
- **It judges the staged content and never the working tree.** A corpus check run over a tree the
  fleet is writing reddens on somebody else's file and says nothing about your commit, so the check
  reads a snapshot of what was staged.
- **It re-implements, as a pre-check, whatever only runs after the commit exists** -- the trailer
  check above being the case that costs an amend, and a rebase once the push has happened.
- **Confirm which hooks your commit route actually runs, and call explicitly whatever it skips.** A
  route that writes the commit object directly runs neither `.githooks/pre-commit` nor `commit-msg`,
  and neither says anything about not having run.
- **The session's own constants -- the branch ref, the fork point, the repository root, the scratch
  path -- sit at the top**, so the next session resets a handful of lines instead of writing the
  script again.

## The cycle, per slice -- decided here, before any finding exists

| Slice | Rounds | Critical -- is a wrong result SILENT? Reason |
| ----- | ------ | ------------------------------------------- |

**The discriminator is whether a wrong result is SILENT** (`SKILL.md` §6): a slice whose failure
looks exactly like success keeps the full cycle, and the allocation that yields is one audit and
one fix for everything whose failure is loud -- which is also the floor, no slice shipping on a
cold read alone: two rounds cost two agents a slice, so fifteen slices is thirty audit agents spent
before a finding exists. The full cycle goes to the few slices every other one is judged against --
a defect there propagates into all the rest before anyone sees it. Every row carries its reason,
written before any finding exists either way, and a lightened slice's single fix is walked by the
next driving re-auditor rather than by a re-audit of its own (`SKILL.md` §6).

**A slice whose output a person looks at carries its browser pass in this table beside its rounds**
(`SKILL.md` §6). A cold read cannot see a layout, so that pass is the slice's audit and not an
extra: the owner runs it over the served build as soon as the slice is up, and its findings enter
the slice's fix round rather than a round of their own after the audits have closed.

**Where the session BUILDS a mechanism meant to change what people write** -- a rule set, a prompt,
a card delivered before every edit, a linter -- one of its slices is an A/B rather than an audit:
the same writing task to two agents, one given the mechanism and one denied it, both outputs read
against the rules afterwards. It costs two read-only agents, it tests the premise rather than the
plumbing, and it is the only instrument that can find the mechanism worthless while there is still
time to change it. Driving every check red proves the machinery runs, which is the cheap half; a
check is verified against what it makes people WRITE, and the free half of that is asking each
agent to report where it shaped its prose to satisfy a checker.

**A check reading the whole corpus rather than a branch's diff is run against the real tree before
it is wired into anything, and its findings are CLASSIFIED rather than counted.** A plant proves a
check can fail and says nothing about what it fails on: one such check returned a large backlog that
was every one a genuine defect, and another returned a comparable backlog of which none was the
defect its rule forbids -- the rule's own mandated repair having pushed the shared text past the
check's word floor, a floor being an accidental exemption wherever the rule refuses shortness as a
reason. From outside the two are the same thing, and only the classification separates a migration
worth doing from a check that must not ship. Read the fixtures and the corpus as separate
questions: a green fixture suite has stood beside a red corpus the same night.

## Tree health -- re-established at every wave boundary, not assumed

<Two facts everybody relies on and nobody owns: the shared tooling still imports and its registry
holds what it should, and `git status --porcelain` reconciles against the ownership map with no
path unassigned. A syntax error in a module the gate imports kills every gate invocation in the
tree and announces nothing -- one was found only because an unrelated agent tried to import it and
mentioned the failure under "what I could not verify".>

## Live agents

| Agent name and id | The question it settles | Owns | Cycle | Last write to an owned file | Status |
| ----------------- | ----------------------- | ---- | ----- | --------------------------- | ------ |

The name is the one it was dispatched under: its scratch subdirectory is named for it and its brief
calls it `<your agent name>`. **The address a resume or a follow-up is sent to is the id the Agent
tool returned, never the name** -- a send by name has failed. Record both at dispatch; a resume has
nothing to aim at otherwise, and where this harness has no send tool at all (`resume-prompt.md`)
the banked verdict is the whole of what a follow-up brief can be built from.

Cycle is one of: implement, audit, fix, re-audit, fix, done.

## Plant-and-restore windows currently open

| Agent | Files it may break | Dispatched at | Restore confirmed |
| ----- | ------------------ | ------------- | ----------------- |

## Standing actions -- queued work and the condition that releases each

| Trigger | The whole brief, written out now | Dispatched? |
| ------- | -------------------------------- | ----------- |

## The schedule -- rewritten at every wave boundary, and read back before it is acted on

| Block | Wall clock | Measured or estimated | Waiting on |
| ----- | ---------- | --------------------- | ---------- |

One row per block of remaining work rather than per agent, and the third column is what stops a
guess hardening into a plan on its second reading. What the read-back is for, and what it looks
for, is `SKILL.md` §4.

**A figure the owner will act on is taken in one exclusive window a session**: announced to the
owner and started at once rather than held for a reply, the fleet stopped and the owner asked off
the machine, with whatever else it was running recorded beside the figure. A figure taken while anyone
works the same machine measures contention.

**My own serial work is a row here, and it is the row a wave estimate cannot contain.** A wave's
figure is its longest agent's and mine is a sum over every commit, report and routing decision, and
one session's assembly outran the waves it had been estimated against for exactly that reason. Give
it a row, mark it estimated, and mechanise it rather than try to shorten it by hand.

## The ending -- enumerated before the last wave goes out

<Assembly of the last wave; the audit its last commit dispatches in the same action, and the fix
round that audit feeds, neither of which belongs to the wave and both of which the ending owes;
the plan reconciled against the branch, every slice ticked to a landed commit and every enumerated
row inside a closed entry ticked too; the gate at <scope>; the draft pull request; every started
check's conclusion; the handoff and its independent audit; the starter prompt. Once one wave plus
this list is what remains, dispatch nothing new.>

## Decisions taken by the owner, and where each was routed

| # | Question | Ruling | Routed to |
| - | -------- | ------ | --------- |

"Routed to" names a live agent or my own next action, never an artefact. A ruling routed to "the
commit" is owed by nobody: no brief carried it, no agent's file list held it, and a cold auditor
found it undone with the commit's trailer already written against it.

**This table is the single home of every ruling taken this session**, dated and in the owner's
words: every other site cites the row by its number here and never copies the text, a second copy
diverging silently, and a number taken from a transcript rather than from this table is checkable
by nobody. A ruling that binds the repository beyond this programme is recorded in the tree as the
constraint itself -- a rules clause, a CLAUDE.md line, an invariant, a comment at the line -- so
the tree never depends on this file surviving; one that binds how the owner works in every
repository goes to their own `~/.claude/CLAUDE.md`.

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
  coordinator dispatched first and recorded later, then rewrote the table wholesale long after the
  fact — the cost of a wide row is paid every time the fleet is busiest.
- **One write to this file per message.** Two edits sent in one tool batch each read the file,
  append and write it back, so the later silently drops the earlier's paragraphs: an audit's whole
  banked verdict and several of the owner's rulings went that way, and were noticed only because a
  later agent found the rows missing.
- **Close a status in the same edit that banks the verdict, never in batches.** Rows read RUNNING
  for agents that had finished, and the coordinator spent that stretch driving a live fleet against
  a register describing a different one. A stale register is worse than none, because it is trusted.
- **The live-agent column is the question the agent settles, not its subject.** Two agents were sent
  to prove one negative under two different subject headings; file ownership catches nothing when
  both write different files or none. The converse costs more: **a dispatch you hold in mind by its
  task is one whose paths you never diff**, and two briefs of different verbs and concerns — rewrite
  this page, reconcile that derivation — can name one destination without ever sounding alike. Two
  agents held one file that way, and nothing mechanical noticed: `git status`
  shows a modified file, never two owners.
- **Fill "last write to an owned file" from the file's timestamp**, never from the agent's status
  label, and take the timestamp across every file the agent owns rather than one of them: agents
  have stalled silently behind a live-looking label, and one read as stalled while only its notes
  file was being watched.
- **An agent owns every path in its brief until its report lands, never only the paths it happens
  to be writing.** "Owns" is the column a dispatch is diffed against (`SKILL.md` §3); "last write
  to an owned file" answers whether an agent has stalled and answers nothing about scope. Reading
  the second as the first cleared a re-auditor to plant in a live agent's backend file whose
  remaining work had moved to documentation, and what caught the write was a test that agent had
  written earlier rather than any row here.
- **Open a plant-and-restore row at dispatch, for every agent whose brief permits planting, and
  close it when the restore is confirmed.** The open row is what an unrelated red is attributed to
  (`SKILL.md` §4), so one opened after the fact attributes nothing — and an agent cannot announce a
  plant before its report ([agent-brief-template.md](agent-brief-template.md) section 8), so its
  file list is the whole of the warning you get.
- **Write the standing action's whole brief when you queue it**, not a note to write one, and tick
  it only against evidence that it went out. A queued brief recovered from memory later is a
  different brief; one recorded correctly here was never dispatched, and only the end-of-session
  handoff caught it.
- **Name a cross-agent hand-over's path in both briefs.** One named in one brief is written and
  never collected, or waited for and never written.

## Running unattended

`SKILL.md` §1 says when this is prepared; the axis and what the register then owes are here. **A
subagent's prompt surfaces in the owner's session rather than the agent's**, so an agent that trips
one does not fail
fast — it parks the whole fleet behind a dialog nobody is awake to answer, and the register is the
only thing that will still be true in the morning.

- **Bypass permissions mode does not suppress an explicit `ask` rule**, the standard's
  `Edit(**/docs/_standard/**)` in `.claude/settings.json` among them — documented under Claude
  Code's "actions no mode auto-approves", not driven here for the rule form. So bypass is not the
  preparation, whatever it is named for.
- **A deny lets a session adapt; only an unanswerable ask hangs it.** So an unattended stretch turns
  the standard's ask into a deny: add `Edit(**/docs/_standard/**)` to `permissions.deny` in
  `.claude/settings.local.json`, which is gitignored and which a running session reloads —
  documented, not driven here, so confirm one refusal before leaving. Deny is evaluated before ask,
  so an agent reaching the standard is refused and works on, and the change still waits for the
  owner — the deny keeps the sign-off the ask exists to collect. Nothing is removed for the night:
  the denies are what prevent real damage, and a session that has lifted its credential or git
  denies to sleep more soundly has bought the wrong thing.
- **Removing or loosening a permission rule, or a hook's registration, is the owner's instruction to
  give, never the coordinator's to take** — it is routing around a guard, whatever the reason looks
  like at midnight. The overnight deny adds a rule and loosens none.
- **The prompt surface is not enumerable from the rules.** Prompts also come from the harness's own
  permission classifier reacting to whatever is not on its allow list, so a shell command, a script
  invocation and a skill call can each raise one with no rule involved. Auditing the rules and
  declaring the surface closed is a false green, and one command running unprompted establishes that
  command and nothing about its class.
- **The change is undone by mechanism, never by memory**: a byte-exact backup outside the tree of a
  `.claude/settings.local.json` that existed before, and the restore command — that backup put back,
  or the file deleted where the deny created it — written into the resume point above. Left in
  place the deny refuses the owner's own edit to the standard the next day. "I will put it back in
  the morning" is not a mechanism.
- **A pre-authorisation is executed against its intent.** Where applying it literally would defeat
  what it was given for — a bound moved to a number that binds nothing, a cut that empties the thing
  it was meant to tighten — it goes back unexecuted though the permission exists. Two instructions
  in tension are surfaced as a tension rather than resolved by picking one, and the tension is
  usually invisible until somebody measures the distribution.
- **Every call taken alone is closed and recorded, never parked.** Record it as it is taken, with
  its reasoning and what reversing it would cost. A decision handed back costs more than one taken
  wrongly, because the wrong one is visible in a diff and the deferred one is a pile of homework
  waiting at breakfast.
- **Deciding in the owner's place is a grant the owner gives for a named stretch**, never assumed
  and never carried into the next session. It covers routine judgement on best-practice terms: a
  question genuinely unsettled is held for the owner, and so is any string a visitor navigates by.
