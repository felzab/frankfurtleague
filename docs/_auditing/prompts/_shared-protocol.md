# Shared audit-pass protocol

Every audit pass prompt in this folder begins with: _"Read `docs/_auditing/prompts/_shared-protocol.md`
and follow it for the whole pass."_ This file holds the discipline that is identical across passes so
it exists once and cannot drift per-prompt. The pass prompt itself holds only the lens: the scope,
the numbered checks, the required tables, and the priority order.

## Ground rules

- **Report only.** Apply zero fixes, change zero source files. Findings are recorded, not acted on.
- **Write the report to the path the pass prompt names**, in `docs/audit/`, overwriting any existing
  file _unless resuming_ (see below). `docs/audit/` is **gitignored and local-only** — the repo is
  public and unfixed findings must not publish; never commit or stage anything under it (CLAUDE.md
  §3 names it as the one ignored path this workflow may read and write).
- **Verify installed versions first** — `fl_frontend/package.json`, `fl_backend/pyproject.toml` — and
  state them in the report header. Every judgment is relative to those versions, not training data.
  Derive every count you state (files read, occurrences) by actually counting at run time; never
  copy a count from this prompt, an earlier report, or memory.
- **Read the programme's earlier reports before starting** — only the sections you need, never a
  whole file — and cite them by section instead of re-reporting their findings. Respect their
  "already correct" lists.
- **Check ratified decisions before flagging.** CLAUDE.md §9 and `docs/_decisions/` list patterns
  that read as violations and are deliberate. A finding that contradicts an ADR is not a finding —
  it is at most a "decision to revisit" entry, clearly labelled, with the ADR named.
- **Secrets:** never read, print, echo, decode or reproduce the contents of `.env*` files or any
  credential value; refer to secrets by variable name only. If a check would require reading a
  secret, report it as unverifiable and say why. Scope every grep away from ignored paths before
  running it.

## Report structure (in this order)

1. **Header** — files-read count and exclusions, installed versions, scope note, and (for security
   passes) the secret-handling rule operated under.
2. **Coverage ledger** — one table row per numbered check: check number · exact grep patterns used
   and files read · raw occurrence count · finding count. Write the _skeleton_ of this table (all
   check numbers, empty result columns) before starting check 1, and fill each row as its check
   completes. A check with zero findings still gets a row naming what was searched.
3. **Summary table** — categories/severities with counts. Filled in last, before the verdict.
4. **Numbered sections, one per check, in the prompt's order.** Every finding:
   `path/to/file.ext:LINE` — statement of the defect — **replacement:** the concrete fix — severity
   tag `CRITICAL / HIGH / MED / LOW / INFO`. Security findings additionally carry **exploit:** who
   can do what, concretely; theoretical risk with no reachable path is INFO at most.
   Also record, per section: explicit "Zero occurrences" with what was searched, already-correct
   usages worth naming so nobody "fixes" them, and near-misses that are NOT findings with a one-line
   reason.
5. **Verdict** — overall state, then a numbered fix-priority list by severity and blast radius, with
   decisions-to-confirm placed last and labelled as decisions.

## Traversal

Work **check-by-check, not file-by-file**. For each check: grep to build a candidate set, then read
the candidates in full plus enough surrounding code to judge intent. Read the whole file set only
where a check genuinely requires it. Scan, do not summarise.

## The nuance rule

Where a "violation" is plausibly a deliberate decision: say so explicitly, explain what depends on
it, state what reversing it would cost, and present it as a decision to confirm — never as a defect
to rip out. A reader must never act on this report and break something load-bearing.

## Rigor

No finding without a file:line. No vague "consider refactoring". If unsure whether something is
intentional, read surrounding code until you can say. Negative results are first-class output — an
audit that only lists problems cannot be trusted about what it checked. Required tables are the
deliverable where the prompt says so; a narrative summary is not a substitute.

## Ask, don't guess

If a check's intent is ambiguous, a judgment depends on information outside the code (deployment
reality, product intent, whether a workflow exists), or two plausible readings lead to opposite
findings — **collect the question rather than picking silently**. Put questions to the owner in one
batch at the natural break (end of the current check), each with the evidence and your best reading.
A wrong silent guess becomes a false positive that costs a remediation session later; the frontend
programme's Wave 0 existed because five such questions were _not_ askable at audit time. Err toward
asking.

## Budget honesty and incremental writing

Complete checks at full depth in the priority order the pass prompt gives. If you cannot finish all
of them, state plainly at the top of the report which checks you cut and why. Never silently thin
coverage across all checks to make them fit — six checks done properly and four declared incomplete
beat ten done shallowly.

**Write incrementally.** Append each check's section to the report file as the check completes —
never accumulate the whole report in memory for one final write. Update that check's coverage-ledger
row at the same time. If the session ends mid-check, the last action before any risky long operation
should have left the file stating `INCOMPLETE — resumed from here` at the open check.

## Resume protocol

On starting, check whether the target report file already exists:

- **It does not** → fresh pass; proceed.
- **It exists with a complete verdict** → this pass already ran; stop and tell the owner rather than
  silently overwriting.
- **It exists without a verdict** → a previous session died mid-pass. Read its header and coverage
  ledger, trust the completed checks (do not redo them), delete any half-written trailing section,
  and continue from the first check whose ledger row is unfilled or whose section is missing or
  marked `INCOMPLETE`. Note the resume in the report header.

## Handoff

End the pass by confirming the report file exists on disk at the named path and telling the owner:
the pass is complete, the file is written, and the next step is `/clear` before the next pass —
stale context from this pass will poison the next one.

Before handing off, harvest lessons: if the pass surfaced a new misstep, tooling trap or process
failure with value beyond this programme (a search technique that silently missed things, an
environment artifact, a wrong assumption in this very prompt), verify it — reproduce it or confirm
it at the source — and merge it into the matching theme of `docs/_auditing/lessons.md`. That file
is process meta, so editing it does not violate the report-only rule; findings about the _audited
code_ still go only in the report.
