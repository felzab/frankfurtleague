# Shared audit-pass protocol

How to run **one pass session**. Every pass prompt binds this file; the pass prompt supplies only the
lens. [`../programme.md`](../programme.md) covers everything above a single session.

| Section                                                   | Answers                                                        |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| [Start sequence](#start-sequence)                         | What to read and write before check 1                          |
| [Ground rules](#ground-rules)                             | What a pass may and may not do, and where it writes            |
| [What every agent is told](#what-every-agent-is-told)     | The five that hold for any dispatched agent, audit or fix      |
| [Report structure](#report-structure-in-this-order)       | The report's required shape and severity rubric                |
| [Method](#method)                                         | Traversal, evidence, blast radius, deliberate decisions        |
| [Ask, don't guess](#ask-dont-guess)                       | What goes to a human rather than into an assumption            |
| [The verdict](#the-verdict-is-the-ledgers-input-contract) | The labelled lists the ledger is built from                    |
| [Budget honesty](#budget-honesty-and-incremental-writing) | Writing the report as it is produced, and saying when it grows |
| [Resume protocol](#resume-protocol)                       | Continuing a pass whose session died                           |
| [Handoff](#handoff)                                       | What is printed at the end, and the lessons harvest            |

## Start sequence

Run these before check 1, in order.

1. **Read [`../lessons.md`](../lessons.md) in full.** It records the traps and failure modes earlier
   programmes hit — stale findings, untested replacement snippets, environment artifacts,
   stack-specific facts. A pass that skips it repeats them.
2. **Run the resume protocol below.** A target report already on disk decides whether this session
   starts, resumes or stops.
3. **Read the installed versions** from `fl_frontend/package.json` and `fl_backend/pyproject.toml`,
   and state them in the report header. Every judgment is relative to those versions, not to training
   data.
4. **Read the rows assigned to this pass** in `docs/audit/register.md` and in the coverage map of
   `docs/audit/programme/r1-failure-modes.md`, where those files exist. They are part of this pass's
   scope, and the verdict must state whether each was covered.
5. **Read this programme's earlier reports** — only the sections you need, never a whole file. Cite
   them by section instead of re-reporting, and respect their "already correct" lists. If an earlier
   pass has not run, say so in the header, run anyway, and expect the ledger to have overlap to
   untangle.
6. **Read the ratified decisions** — `.claude/CLAUDE.md` §7, and §6 for the traps that fail silently.
   They list patterns that read as violations and are deliberate. A finding that contradicts a §7 row
   or a spec sheet's invariant is not a finding; it is at most a clearly-labelled "decision to
   revisit" entry naming the row or the invariant id.
7. **Write the coverage-ledger skeleton** to the report file — every check number, empty result
   columns — before starting check 1.

## Ground rules

- **Report only.** Zero fixes, zero source files changed. Findings are recorded, never acted on.
- **Write the report to the path the pass prompt names**, under `docs/audit/programme/`, overwriting
  any existing file unless resuming. `docs/audit/` is **gitignored and local-only** — the repository
  is public and unfixed findings must not publish. Never commit or stage anything under it.
  CLAUDE.md's security section names it as the one ignored path this workflow may read and write.
- **Derive every count you state** by counting at run time. Never copy a count from this file, a pass
  prompt, an earlier report, or memory.
- **Confirm library and platform behaviour at the installed source or the official documentation**
  wherever a judgment depends on it. Never assert it from memory.
- **Secrets.** Never read, print, echo, decode or reproduce the contents of `.env*` files or any
  credential value; refer to secrets by variable name only. A check that would require reading a
  secret is reported as unverifiable, with the reason. Scope every grep away from ignored paths
  **before** running it — an unscoped grep has matched a secret file.

## What every agent is told

These hold for any agent a programme dispatches, auditing or fixing. They sit here rather than in
each prompt because every one has been broken by an agent that had read
[`../lessons.md`](../lessons.md) first.

- **Build it and measure.** A claim about a regex, an exit code, a guard's verdict or a hook's
  behaviour is unverified until someone runs it, however many people have repeated it. Here the
  argument you can construct is reliably weaker than the answer the machine gives.
- **When a fix handles N instances, enumerate the population and count.** A correct conclusion is not
  evidence the population was complete.
- **Verify prescribed text before applying it.** A reviewer's authority is over the defect, never
  automatically over the replacement.
- **Write findings into the deliverable as you establish them.** An agent that stops while holding
  everything in flight loses all of it; one that wrote as it went loses only the last item.
- **Say what you could not verify and why.** An unverifiable check reported honestly costs minutes; a
  guessed one costs a session.

## Report structure, in this order

1. **Header**, carrying:

   - **`Audited at commit: <sha>`** and **`Tree state: clean | dirty (<n> files)`**, both from `git`
     at the start of the pass. Every later phase measures drift against that SHA. A report written
     against a dirty tree describes code that may never land, which the reader has to be told.
   - Files-read count and exclusions, installed versions, scope note.
   - Any checks cut, and why.
   - Which earlier reports of this surface existed and were cited.
   - For a security pass, the secret-handling rule operated under; for a standards-anchored pass, the
     exact standard version fetched.

2. **Coverage ledger** — one row per numbered check: check number · the exact grep patterns used and
   files read · raw occurrence count · finding count. Fill each row as its check completes. A check
   with zero findings still gets a row naming what was searched.

3. **Summary table** — every finding, one row: ID · severity · one-line statement · file · evidence
   class. Filled in last.

4. **Numbered sections, one per check, in the prompt's order.** Every finding carries:

   - `path/to/file.ext:LINE`
   - a statement of the defect
   - **replacement:** the concrete fix
   - **evidence:** one of `read` (judged by reading the code) · `grepped (<n> sites)` ·
     `measured (<what was measured, with the number>)` · `unverified (<why>)`
   - a severity tag from the rubric below
   - for a security finding, **exploit:** who can do what, concretely. Theoretical risk with no
     reachable path is INFO at most.

   The **evidence** tag is not optional. A cost or performance claim without a measurement, and a
   count without a grep behind it, are the two ways a report misleads the wave that acts on it.

   Each section also records: an explicit "Zero occurrences" with what was searched; already-correct
   usages worth naming so nobody "fixes" them; and near-misses that are **not** findings, each with a
   one-line reason.

5. **Verdict** — see the contract below.

### Severity is consequence, not category

Severity states **what happens if this is real**, never how alarming the code looks.

| Severity     | Assign it when                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **CRITICAL** | Data is lost or corrupted, an unauthorised party can write or read what they must not, or personal data is exposed — and a reachable path exists |
| **HIGH**     | The system serves a **wrong answer as fact** with nothing indicating it, or a control that other things depend on is absent or defeated          |
| **MED**      | A visible failure: something breaks loudly, a user is blocked, or a documented behaviour does not hold                                           |
| **LOW**      | Friction, inconsistency or maintenance cost, with correct behaviour throughout                                                                   |
| **INFO**     | No reachable path, or an observation with no defect behind it                                                                                    |

**A silent wrong answer outranks a loud outage.** An outage is noticed and fixed within the hour; a
league table that has quietly been wrong for a month is believed. Where a finding could sit in two
rows, the one that fails silently takes the higher.

These rules override the table. A finding reachable only from a privileged position is rated **for
that position**, not for the open internet — and it is still real, so do not drop it. And never soften a
genuine CRITICAL because the project is small.

Where `docs/audit/register.md` already rates an outcome, **use its severity rather than deriving
one** — it was confirmed with me, and a pass silently re-rating it makes severity mean two things at
once. Raise a rating you believe is wrong as an open question.

### Anchoring to an external standard

Where a pass names an external standard, **fetch the current control list at run time and state the
exact version you used in the report header.** Never reproduce a control list from memory, and never
copy one into a prompt — a stale control list reads as coverage.

Cover it with a table, one row per control group: control | what implements it here, with the file |
evidence | `met` / `gap` / `not applicable`. **Every `not applicable` carries its reason**; an
unexplained N/A is indistinguishable from a control nobody looked at. Every `gap` becomes a numbered
finding below with a file:line — a gap named only in the coverage table is an observation. The
table is a floor, not the lens: the pass's own numbered checks still run in full, and a defect the
standard has no control for is still a finding.

## Method

**Work check by check, not file by file.** Per check: grep to build a candidate set, then read those
candidates in full plus enough surrounding code to judge intent. Read a whole file set only where a
check genuinely requires it. **Scan, do not summarise.**

**No finding without a file:line.** No vague "consider refactoring". Where unsure whether something
is intentional, read the surrounding code until you can say.

**Negative results are first-class output.** An audit that only lists problems cannot be trusted
about what it checked. A required table is the deliverable wherever the prompt says so; a narrative
summary is not a substitute.

**Report the blast radius, not the first site.** Where a finding names a pattern, grep for that
pattern and give the full site count. A report that names one site invites a fix applied to one of
four call sites, which can be worse than no fix at all.

**Where a "violation" is plausibly a deliberate decision**: say so explicitly, name what depends on
it, state what reversing it would cost, and present it as a decision to confirm — never as a defect
to rip out. A reader must never act on this report and break something load-bearing.

## Ask, don't guess

**Collect the question rather than picking silently** where a check's intent is ambiguous, where a
judgment depends on information outside the code (deployment reality, product intent, whether a
workflow exists), or where two plausible readings lead to opposite findings.

Put questions to me as one batch at the end of the current check, each with its evidence and your
best reading, and carry every one into the verdict. A wrong silent guess becomes a false positive
that costs a remediation session later, and a finding written from one surface can be the exact
opposite of correct once the other surface is consulted. **Err toward asking.**

## The verdict is the ledger's input contract

The ledger is built from each report's **summary table and verdict only**. Anything reachable from
neither is invisible to the plan and will never be worked. The verdict therefore carries every one of
these, each as its own labelled list:

1. **Overall state** of the surface under this lens, in a short paragraph.
2. **Fix priority**, numbered, ordered by severity and blast radius, with decisions-to-confirm placed
   last and labelled as decisions rather than defects.
3. **Open questions** — everything collected under "Ask, don't guess", each with its evidence, the
   finding IDs it blocks, and your best reading. These become Wave 0.
4. **Needs-human items** — findings whose verification requires a real keyboard, screen reader,
   browser, credential or wall-clock time. Tag rather than guess a verdict; these become exit-gate
   clauses.
5. **Cross-surface handoffs** — anything this lens found that belongs to another surface's pass or
   programme, named with the owning surface.
6. **Controls that would prevent recurrence.** A fix removes one instance; a control removes the
   class. Group this pass's findings by defect class and, per class, name the cheapest thing that
   would fail on the next occurrence — a lint rule, a test, a schema or type constraint, a database
   validator, a gate step, or **nothing available**. State the class, the candidate control, roughly
   what it would cost, and what it would **not** catch. Where no automated control is possible, say
   so.
7. **Risk-register coverage.** Omit only where no register exists. List every coverage-map row
   assigned to this pass and state `covered` / `partly covered` / `not covered`, each with a reason.
   A register row is not discharged by a pass simply having run: say what you actually looked at.

Findings themselves live in the numbered sections and are referenced from the summary table by ID.
The verdict points; it does not restate.

## Budget honesty and incremental writing

Complete checks at full depth in the priority order the pass prompt gives. Where you cannot finish
all of them, state plainly in the report header which checks you cut and why. **Never silently thin
coverage across all checks to make them fit** — six checks done properly with four declared
incomplete beats ten done shallowly, because the ledger can schedule what was declared and cannot
schedule what was quietly skipped.

**Write incrementally.** Append each check's section to the report file as that check completes, and
update its coverage-ledger row at the same moment. Before any long or risky operation, the file on
disk should already state `INCOMPLETE — resumed from here` at the open check.

**Say in the header if the report grows past what a wave session could load a section of.** A lens
whose report cannot be opened is a lens whose findings cannot be worked, and the answer is to split
the pass, not to compress the findings.

## Resume protocol

Check whether the target report file already exists:

- **It does not** → fresh pass; proceed.
- **It exists with a complete verdict** → this pass already ran. Stop and tell me rather than
  silently overwriting.
- **It exists without a verdict** → a previous session died mid-pass. Read its header and coverage
  ledger, **trust the completed checks and do not redo them**, delete any half-written trailing
  section, and continue from the first check whose ledger row is unfilled or whose section is missing
  or marked `INCOMPLETE`. Note the resume in the report header.

## Handoff

Confirm the report file exists on disk at the named path, then tell me that the pass is complete, the
file is written, and the next step is `/clear` before the next pass — carrying this pass's context
into the next one makes the model summarise instead of scan.

**Harvest lessons before handing off.** Where the pass surfaced a misstep, tooling trap or process
failure with value beyond this programme — a search technique that silently missed things, an
environment artifact, a wrong assumption in the prompt itself — verify it (reproduce it, or confirm
it at the source) and merge it into the matching section of [`../lessons.md`](../lessons.md). That
file is process meta, so editing it does not violate the report-only rule; findings about the
_audited code_ still go only in the report. Only one session edits `lessons.md` at a time.
