# Shared audit-pass protocol

How to run **one pass session**. Every pass prompt binds this file and supplies only the lens.
[`../programme.md`](../programme.md) covers everything above a single session.

| Section                                                   | Answers                                                  |
| --------------------------------------------------------- | -------------------------------------------------------- |
| [Start sequence](#start-sequence)                         | What to read and write before check 1                    |
| [Ground rules](#ground-rules)                             | What a pass may and may not do, and where it writes      |
| [Report structure](#report-structure-in-this-order)       | The report's required shape, and the severity rubric     |
| [Required tables](#required-tables)                       | The shapes a prompt can ask for by name                  |
| [Method](#method)                                         | Traversal, evidence, blast radius, deliberate decisions  |
| [Ask, don't guess](#ask-dont-guess)                       | What goes to a human rather than into an assumption      |
| [The verdict](#the-verdict-is-the-ledgers-input-contract) | The labelled lists the ledger is built from              |
| [Budget honesty](#budget-honesty-and-incremental-writing) | Writing the report as it is produced, and declaring cuts |
| [Resume protocol](#resume-protocol)                       | Continuing a pass whose session died                     |
| [Handoff](#handoff)                                       | What is printed at the end, and the lessons harvest      |

## Start sequence

Run these before check 1, in order.

1. **Read [`../lessons.md`](../lessons.md) in full.**
2. **Run the resume protocol below.** A target report already on disk decides whether this session
   starts, resumes or stops.
3. **Read the installed versions** from `fl_frontend/package.json` and `fl_backend/pyproject.toml`
   and state them in the report header.
4. **Read the rows assigned to this pass** in `docs/audit/register.md` and in the coverage map of
   `docs/audit/programme/r1-failure-modes.md`, where those exist. The verdict must state whether each
   was covered.
5. **Read this programme's earlier reports** — only the sections you need, never a whole file. Cite
   them by section instead of re-reporting, and respect their "already correct" lists. Where an
   earlier pass has not run, say so in the header and run anyway.
6. **Read `.claude/CLAUDE.md` §7 and §6, and every file §7 indexes under `.claude/rules/` whose
   paths reach this pass's surface.** A finding that contradicts a ratified clause or a spec
   sheet's invariant is not a finding; it is at most a clearly-labelled "decision to revisit"
   naming the clause or the invariant id.
7. **Write the coverage-ledger skeleton** to the report file — every check number, empty result
   columns — before starting check 1.

## Ground rules

- **Report only.** Zero fixes, zero source files changed.
- **Write the report to the path the pass prompt names**, under `docs/audit/programme/`, overwriting
  any existing file unless resuming. **Never commit or stage anything under that tree** — it is
  gitignored so that unfixed findings never publish.
- **Derive every count you state** by counting at run time; never copy one from this file, a prompt,
  an earlier report, or memory. Where a claim covers N instances, enumerate the population.
- **Build it and measure.** A claim about a regex, an exit code, a guard's verdict or a library's
  behaviour is unverified until it is run or read at the installed source.
- **Say what you could not verify, and why.**
- **Secrets.** `.claude/CLAUDE.md` §1 binds a pass session whole. What it adds for an audit: a check
  that would require reading a credential is reported unverifiable, with the reason, and every grep
  is scoped away from ignored paths **before** it runs.

## Report structure, in this order

1. **Header**, carrying an **`Audited at commit:`** line and a **`Tree state:`** line — clean, or
   dirty with the file count — both read from `git` at the start of the pass. Every later phase
   measures drift against that SHA. Then: files-read count and exclusions, installed versions, scope
   note, any checks cut and why, which earlier reports were cited, and for a standards-anchored pass
   the standard version
   fetched.

2. **Coverage ledger** — one row per numbered check: check number · the exact grep patterns used and
   files read · raw occurrence count · finding count. Fill each row as its check completes. A check
   with zero findings still gets a row naming what was searched.

3. **Summary table** — every finding, one row: ID · severity · one-line statement · file · evidence
   class. Filled in last.

4. **Numbered sections, one per check, in the prompt's order.** Every finding carries
   `path/to/file.ext:LINE`, a statement of the defect, **replacement:** the concrete fix,
   **evidence:** one of `read` · `grepped (<n> sites)` · `measured (<what, with the number>)` ·
   `unverified (<why>)`, a severity tag, and for a security finding **exploit:** who can do what,
   concretely — theoretical risk with no reachable path is INFO at most. Each section also records
   an explicit "Zero occurrences" with what was searched, already-correct usages worth naming so
   nobody "fixes" them, and near-misses that are **not** findings, each with a one-line reason.

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

**A silent wrong answer outranks a loud outage.** Where a finding could sit in two rows, the one
that fails silently takes the higher.

A finding reachable only from a privileged position is rated **for that position** and is still real,
so do not drop it; and never soften a genuine CRITICAL because the project is small. Where
`docs/audit/register.md` already rates an outcome, **use its severity rather than deriving one**.
Raise a rating you believe is wrong as an open question.

## Required tables

A prompt names the tables its lens must produce. Two shapes are shared, and are specified here.

**Anchoring to an external standard.** Where a pass names one, **fetch the current control list at
run time and state the exact version in the report header** — never reproduce one from memory, and
never copy one into a prompt. One row per control group: control | what implements it here, with the
file | evidence | `met` / `gap` / `not applicable`. **Every `not applicable` carries its reason.**
Every `gap` becomes a numbered finding below with
a file:line — a gap named only in the coverage table is an observation. The table is a floor, not the
lens: the pass's own checks still run in full, and a defect the standard has no control for is still
a finding.

**The excess table**, where a prompt asks for one: what | every site as `<file> :: <symbol>` | the
class, from the candidate table that prompt gives | which copy or construct dies, and what replaces
it | size removed, in lines and exported names | verdict.

- **Every `duplicated` row names which copy dies** and confirms the survivor is reachable from where
  the dying copy's importers stand.
- **Every `one-caller` row states what inlining it would cost.** A single caller is a candidate, not
  a verdict.
- **Every `hand-rolled` row cites the API that replaces it**, verified at the installed version.
- **Measure before proposing.** State the lines and exported names each row removes; a row with no
  number is filed INFO.
- **Check `.claude/CLAUDE.md` §7 and the `.claude/rules/` file for this surface first.** Several
  constructs that read as excess are ratified.

## Method

- **Work check by check, not file by file.** Per check: grep to build a candidate set, then read
  those candidates in full plus enough surrounding code to judge intent. **Scan, do not summarise.**
- **No finding without a file:line**, and no vague "consider refactoring". Where unsure whether
  something is intentional, read the surrounding code until you can say.
- **Negative results are first-class output.** A narrative summary never substitutes for a required
  table.
- **Report the blast radius, not the first site.** Where a finding names a pattern, grep for it and
  give the full site count.
- **Where a "violation" is plausibly a deliberate decision**, say so explicitly, name what depends on
  it, state what reversing it would cost, and present it as a decision to confirm.

## Ask, don't guess

**Collect the question rather than picking silently** where a check's intent is ambiguous, where a
judgment depends on information outside the code (deployment reality, product intent, whether a
workflow exists), or where two plausible readings lead to opposite findings.

Put questions to me as one batch at the end of the current check, each with its evidence and your
best reading, and carry every one into the verdict. **Err toward asking.**

## The verdict is the ledger's input contract

The ledger is built from each report's **summary table and verdict only**. Anything reachable from
neither is invisible to the plan and will never be worked. The verdict carries each of these as its
own labelled list, pointing at the numbered sections rather than restating them:

1. **Overall state** of the surface under this lens, in a short paragraph.
2. **Fix priority**, numbered, ordered by severity and blast radius, with decisions-to-confirm last
   and labelled as decisions rather than defects.
3. **Open questions** — everything collected under "Ask, don't guess", each with its evidence, the
   finding IDs it blocks, and your best reading. These become Wave 0.
4. **Needs-human items** — findings whose verification requires a real keyboard, screen reader,
   browser, credential or wall-clock time. Tag rather than guess; these become exit-gate clauses.
5. **Cross-surface handoffs** — anything this lens found that belongs to another surface, named with
   the owning surface.
6. **Controls that would prevent recurrence.** A fix removes one instance; a control removes the
   class. Group the findings by defect class and, per class, name the cheapest thing that would fail
   on the next occurrence — a lint rule, a test, a schema or type constraint, a database validator, a
   gate step, or **nothing available** — with roughly what it would cost and what it would **not**
   catch.
7. **Risk-register coverage.** Omit only where no register exists. Every coverage-map row assigned to
   this pass as `covered` / `partly covered` / `not covered`, each with a reason. A register row is
   not discharged by a pass simply having run: say what you actually looked at.

## Budget honesty and incremental writing

Complete checks at full depth in the priority order the pass prompt gives. Where you cannot finish
all of them, state plainly in the header which you cut and why. **Never silently thin coverage across
all checks to make them fit** — six checks done properly with four declared incomplete beats ten done
shallowly.

**Write incrementally.** Append each check's section as that check completes and update its
coverage-ledger row at the same moment; before any long or risky operation, the file on disk should
already state `INCOMPLETE — resumed from here` at the open check.

**Say in the header if the report grows past what a wave session could load a section of**
([`../lessons.md`](../lessons.md) §9).

## Resume protocol

Check whether the target report file already exists:

- **It does not** → fresh pass; proceed.
- **It exists with a complete verdict** → this pass already ran. Stop and tell me rather than
  silently overwriting.
- **It exists without a verdict** → a previous session died mid-pass. Read its header and coverage
  ledger, **trust the completed checks and do not redo them**, delete any half-written trailing
  section, and continue from the first check whose ledger row is unfilled or whose section is missing
  or marked `INCOMPLETE`. Note the resume in the header.

## Handoff

Confirm the report file exists on disk at the named path, then tell me that the pass is complete and
that the next step is `/clear` before the next pass.

**Harvest lessons before handing off.** Where the pass surfaced a misstep, tooling trap or process
failure with value beyond this programme — a search technique that silently missed things, an
environment artifact, a wrong assumption in the prompt itself — verify it, then merge it into the
matching section of [`../lessons.md`](../lessons.md), whose own editing rules apply. That file is
process meta, so editing it does not violate the report-only rule; findings about the _audited code_
still go only in the report.
