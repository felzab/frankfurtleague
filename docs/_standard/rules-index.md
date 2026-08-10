# Rules index

**Verified against:** `7555ecd`, 2026-08-10

Every rule in one line each; the chapter heading links to the file the full rules live in.

## [Precedence](chapters/0-precedence.md)

- **PRE-1:** the ladder — code · ADR · spec sheet · CLAUDE.md · overview, higher wins.
- **PRE-2:** correct the summary, never the source; a document disagreeing with the code is wrong.
- **PRE-3:** one home per rule — state it fully once, cite it everywhere else.
- **PRE-4:** a rule's anatomy — its fixed fields, a chapter row, an index line, and an `Enforced by`
  naming only checks the gate emits, a named read of a command or a linter selection, or admitting
  the rule is unenforced.

## [Core rules](chapters/1-core.md)

- **COR-1:** write for a reader with no context — nothing session-bound, no dangling identifiers.
- **COR-2:** say it once — the claim in full at its one home, cited from everywhere else; the
  duplicate that dies leaves no pointer, and the only survivor is one no citation can reach.
- **COR-3:** name only what exists — no edit narration, no absences; rejected alternatives in the
  present, as constraints.
- **COR-4:** never state a count, a tool's configuration or a line number as a fact about now — a
  set the same sentence closes is definition, not a count.
- **COR-5:** concise by selection — cut sentences, never the words that make one readable; a remark
  a competent reader or the code already carries is deleted, and a page is never cut for length.
- **COR-6:** citations are anchored — `<path> :: <symbol or short quoted fragment>`, a repo path,
  or an ADR number.
- **COR-7:** purpose in the first lines; a long reference carries a navigation table — never an
  ADR, a command file or a pass prompt.
- **COR-8:** rules as lists, tables for the enumerable, bold the claim, nesting ≤ 3, metadata
  lines hard-broken one per line.
- **COR-9:** state doubt — what was verified, what was assumed, which reading you chose.
- **COR-10:** normative pages carry placeholder examples only; worked examples live in the specs
  and overviews.
- **COR-11:** "the owner" appears in no tracked file outside `.claude/` — first person or neutral
  imperative.
- **COR-12:** a file never deviates from the shape its kind is given; where it will not fit, the
  file changes and the shape never widens.

## [In-code documentation](chapters/2-in-code.md)

- **INC-1:** comments carry why — never what the line does, never a type.
- **INC-2:** module header — `<TOKEN> · <what>`, ≤3 sentences, plain `Invariants:`/`See:` lists,
  ≤20 lines, no ruled lines.
- **INC-3:** a header states the rule in a line and cites the ADR; it never restates the argument.
- **INC-4:** docstrings on every FastAPI endpoint and wherever a why needs recording — no coverage
  rule.
- **INC-5:** an inline comment sits at the line of temptation, carrying the failed alternative where
  there is one.
- **INC-6:** comment citations are gate-checked, in source files and in every configuration file
  scanned beside them — ADR numbers, never audit ids.
- **INC-7:** directive first line · Python docstring is the first statement · summary line first.
- **INC-8:** a test docstring says what is covered, never the name again.
- **INC-9:** an inline comment block is ≤3 lines AND ≤250 characters, markers stripped.

## [The documentation corpus](chapters/3-corpus.md)

- **OUT-1:** three layers — ADRs say why, specs say the contract, overviews say what for.
- **OUT-2:** per-surface folders; the ADR log stays flat and globally numbered.
- **OUT-3:** a folder README is orientation plus at most one bounded body section — purpose,
  navigation table, and a "Read next" only where the table does not already send the reader there;
  ≤120 lines. The root README is the sole exception, bound by the cap alone.
- **OUT-4:** spec spine — `1. Contract` with `1.<n>` subsections, then Invariants (permanent
  numbers, `I<n>` per surface and `L<n>` for logging), Violation → remedy, Known-open.
- **OUT-5:** overview spine — opening, "How it is organised", sections, "Read next"; ~120 lines.
- **OUT-6:** one central glossary, one entry per term — the term as code spells it, a gloss, then
  `Is`, `In code`, `Trap`, `See`.
- **OUT-7:** diagrams are mermaid, C4 levels 1–3, never in an ADR.
- **OUT-8:** a surface is frontend, backend or ops — the granularity where a question has one
  answer.
- **OUT-9:** the three shapes are called layers, and layer is the only word for them.

## [Decisions](chapters/4-decisions.md)

- **DEC-1:** an ADR exactly when someone would propose the opposite and the refusal needs the
  argument re-derived — never for a bug fix or a first implementation nobody argues with.
- **DEC-2:** six metadata lines, four H2s, Source required, no stamp.
- **DEC-3:** Status is `Accepted`, `Proposed`, `Deprecated` or `Superseded by ADR-NNNN`.
- **DEC-4:** accepted reasoning is never edited — mechanical repairs, or a rewrite that is
  certainly warranted and explicitly approved, with the approval and its date on the rule.
- **DEC-5:** numbers are permanent identities; gaps stay gaps, mapped in the index, except under
  DEC-4's approval clause on the same terms.
- **DEC-6:** reversal — a new number plus exactly two lines in the old one.
- **DEC-7:** one index row per ADR, no asserted counts.

## [Currency](chapters/5-currency.md)

- **CUR-1:** claims about current behaviour are anchored so the gate can check them.
- **CUR-2:** a change that invalidates a claim updates the document in the same commit — a rewritten
  identifier is swept as free text, and a deleted record amends the rule that mandated it.
- **CUR-3:** stamp on line 3, exact shape, moved only after re-verifying the page; what the page
  claims decides whether it carries one.
- **CUR-4:** materially change a file a stamped page cites → re-verify and restamp it, same
  branch; a stamp-only delta re-arms nothing.
- **CUR-5:** the gate's check list lives in the currency chapter, and only there.
- **CUR-6:** what no branch touched belongs to `/docs:audit`; one branch's slice, before its pull
  request, to `/docs:audit-pr`.

Templates: [`templates/`](templates/).
