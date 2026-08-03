# Shared audit-pass protocol

Every pass prompt begins with: _"Read `docs/_auditing/prompts/_shared-protocol.md` and follow it for
the whole pass."_ This file is how to run **one pass session**. The pass prompt supplies only the
lens; [`../README.md`](../README.md) covers everything above a single session.

## Ground rules

- **Report only.** Zero fixes, zero source files changed. Findings are recorded, never acted on.
- **Write the report to the path the pass prompt names**, under `docs/audit/`, overwriting any
  existing file _unless resuming_ (see below). `docs/audit/` is **gitignored and local-only** —
  the repository is public and unfixed findings must not publish. Never commit or stage anything
  under it. CLAUDE.md §3 names it as the one ignored path this workflow may read and write.
- **Verify installed versions first** — `fl_frontend/package.json`, `fl_backend/pyproject.toml` —
  and state them in the report header. Every judgment is relative to those versions, not to training
  data.
- **Derive every count you state** by counting at run time. Never copy a count from this file, a
  pass prompt, an earlier report, or memory.
- **Read the programme's earlier reports before starting** — only the sections you need, never a
  whole file — and cite them by section instead of re-reporting their findings. Respect their
  "already correct" lists.
- **Check ratified decisions before flagging anything.** CLAUDE.md §9 and `docs/_decisions/` list
  patterns that read as violations and are deliberate. A finding that contradicts an ADR is not a
  finding; it is at most a clearly-labelled "decision to revisit" entry naming the ADR.
- **Secrets.** Never read, print, echo, decode or reproduce the contents of `.env*` files or any
  credential value; refer to secrets by variable name only. If a check would require reading a
  secret, report it as unverifiable and say why. Scope every grep away from ignored paths **before**
  running it — an unscoped grep has matched a secret file.

## Report structure, in this order

1. **Header** — files-read count and exclusions, installed versions, scope note, and for a security
   pass the secret-handling rule operated under.
2. **Coverage ledger** — one row per numbered check: check number · the exact grep patterns used and
   files read · raw occurrence count · finding count. **Write the skeleton of this table — every
   check number, empty result columns — before starting check 1**, and fill each row as its check
   completes. A check with zero findings still gets a row naming what was searched.
3. **Summary table** — categories and severities with counts. Filled in last, before the verdict.
4. **Numbered sections, one per check, in the prompt's order.** Every finding is
   `path/to/file.ext:LINE` — a statement of the defect — **replacement:** the concrete fix — a
   severity tag of `CRITICAL / HIGH / MED / LOW / INFO`. A security finding additionally carries
   **exploit:** who can do what, concretely; theoretical risk with no reachable path is INFO at most.
   Each section also records: an explicit "Zero occurrences" with what was searched; already-correct
   usages worth naming so nobody "fixes" them; and near-misses that are **not** findings, each with a
   one-line reason.
5. **Verdict** — the overall state, then a numbered fix-priority list ordered by severity and blast
   radius, with decisions-to-confirm placed last and labelled as decisions.

## Traversal

Work **check by check, not file by file**. For each check: grep to build a candidate set, then read
those candidates in full plus enough surrounding code to judge intent. Read a whole file set only
where a check genuinely requires it. **Scan, do not summarise.**

## Rigor

No finding without a file:line. No vague "consider refactoring". If unsure whether something is
intentional, read the surrounding code until you can say. **Negative results are first-class
output** — an audit that only lists problems cannot be trusted about what it checked. A required
table is the deliverable wherever the prompt says so; a narrative summary is not a substitute.

## The nuance rule

Where a "violation" is plausibly a deliberate decision: say so explicitly, explain what depends on
it, state what reversing it would cost, and present it as a decision to confirm — never as a defect
to rip out. **A reader must never act on this report and break something load-bearing.**

## Ask, don't guess

If a check's intent is ambiguous, if a judgment depends on information outside the code (deployment
reality, product intent, whether a workflow exists), or if two plausible readings lead to opposite
findings — **collect the question rather than picking silently**. Put questions to the owner as one
batch at the natural break, which is the end of the current check, each with its evidence and your
best reading.

A wrong silent guess becomes a false positive that costs a remediation session later, and a finding
written from one surface can be the exact opposite of correct once the other surface is consulted.
**Err toward asking.**

## Budget honesty and incremental writing

Complete checks at full depth in the priority order the pass prompt gives. If you cannot finish all
of them, state plainly at the top of the report which checks you cut and why. **Never silently thin
coverage across all checks to make them fit** — six checks done properly with four declared
incomplete beats ten done shallowly, because the ledger can schedule what was declared.

**Write incrementally.** Append each check's section to the report file as that check completes;
never accumulate the whole report in memory for one final write. Update the check's coverage-ledger
row at the same moment. Before any long or risky operation, the file on disk should already state
`INCOMPLETE — resumed from here` at the open check.

## Resume protocol

On starting, check whether the target report file already exists:

- **It does not** → fresh pass; proceed.
- **It exists with a complete verdict** → this pass already ran. Stop and tell the owner rather than
  silently overwriting.
- **It exists without a verdict** → a previous session died mid-pass. Read its header and coverage
  ledger, **trust the completed checks and do not redo them**, delete any half-written trailing
  section, and continue from the first check whose ledger row is unfilled or whose section is missing
  or marked `INCOMPLETE`. Note the resume in the report header.

## Handoff

End the pass by confirming the report file exists on disk at the named path, then tell the owner
that the pass is complete, the file is written, and the next step is `/clear` before the next pass —
carrying this pass's context into the next one makes the model summarise instead of scan.

**Before handing off, harvest lessons.** If the pass surfaced a misstep, tooling trap or process
failure with value beyond this programme — a search technique that silently missed things, an
environment artifact, a wrong assumption in the prompt itself — verify it (reproduce it, or confirm
it at the source) and merge it into the matching section of
[`../lessons.md`](../lessons.md). That file is process meta, so editing it does not violate the
report-only rule; findings about the _audited code_ still go only in the report. Only one session
edits `lessons.md` at a time — if passes are running in parallel, hold the harvest until the others
have finished theirs.
