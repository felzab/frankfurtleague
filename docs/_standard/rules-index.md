# Rules index

**Verified against:** `889c31dd`, 2026-08-19

Every rule in one line each. A chapter heading links to the file that chapter's fuller statements
live in; a rule with no section there is stated in full by its line here (PRE-4).

## [Precedence](chapters/0-precedence.md)

- **PRE-1:** the ladder — code · spec sheet · CLAUDE.md · overview, higher wins.
- **PRE-2:** correct the summary, never the source; a document disagreeing with the code is wrong.
- **PRE-4:** a rule's anatomy — its heading, its fields in order, a chapter row, an index line, and an
  `Enforced by` naming only checks the gate emits, a named read of a command or a linter selection, or
  admitting the rule is unenforced. An optional field appears only when it carries something.

## [Core rules](chapters/1-core.md)

- **COR-1:** write for a stranger — no conversation, session or past effort, no identifier that
  fails to resolve, and the reasoning at the claim rather than behind a pointer to a file deleted by
  design. _Enforced by_ `/docs:audit` (the cold read).
- **COR-2:** say it once — the claim in full at its one home, cited from everywhere else; the
  enforcement layer states a rule and the reasoning layer argues it; the duplicate that dies leaves no
  pointer, and the only survivor is one no citation can reach.
- **COR-3:** name only what exists — no edit narration, no absences; rejected alternatives in the
  present, as constraints.
- **COR-4:** never state a count, an enumeration, a version number, a tool's configuration or a line
  number as a fact about now — and cite a value the repository states elsewhere rather than repeating
  it. A set the same sentence closes is definition, not a count.
- **COR-5:** concise by selection — cut sentences, never the words that make one readable; a remark a
  competent reader or the code already carries is deleted; a page is never cut for length; and every
  bound here is a ceiling, never a target.
- **COR-6:** citations are anchored — `<path> :: <symbol or short quoted fragment>`, a repo path, a
  rule id or an invariant id.
- **COR-7:** purpose in the first lines; a long reference carries a navigation table — never a command
  file or a pass prompt.
- **COR-8:** rules as lists, tables for the enumerable, bold the claim, nesting ≤ 3, metadata lines
  hard-broken one per line.
- **COR-9:** state doubt — what was verified, what was assumed and why, which reading you chose and
  which you rejected, and the measurement where a claim rests on one. Never present a plan as a
  description. _Enforced by_ `/docs:audit` (the doubt read).
- **COR-10:** normative pages carry placeholder examples only; worked examples live in the specs and
  overviews.
- **COR-11:** "the owner" appears in no tracked file outside `.claude/` — first person or neutral
  imperative.
- **COR-12:** a file never deviates from the shape its kind is given; where it will not fit, the file
  changes and the shape never widens.

## [In-code documentation](chapters/2-in-code.md)

- **INC-1:** comments carry why — never what the line does, never a type.
- **INC-2:** a module header survives in a shell script, and in a Python `app/` or `scripts/` module
  whose fact attaches to no symbol — `<TOKEN> · <what>`, ≤3 sentences, plain `Invariants:`/`See:`
  lists, ≤20 lines, no ruled lines.
- **INC-3:** a header states the rule in a line and never the argument behind it; `Invariants:`
  holds only what a change could violate silently. A passage outgrowing a few lines, or repeated
  in a second file, becomes a spec-sheet invariant in the same change.
  _Enforced by_ review judgment.
- **INC-4:** docstrings on every FastAPI endpoint and wherever a why needs recording — no coverage
  rule, and the domain rules behind an endpoint stay in the spec sheet.
- **INC-5:** an inline comment sits at the line of temptation — the line someone would change,
  never the top of the function — carrying the failed alternative where there is one.
  _Enforced by_ review judgment.
- **INC-6:** comment citations are gate-checked, in source files and in every configuration file
  scanned beside them — anchored paths and symbols, never audit ids.
- **INC-7:** directive first line · Python docstring is the first statement, above the imports ·
  summary line, then a blank line, then prose. Docstring enforcement is a formatting subset only:
  the selected ruff `D` codes live in `fl_backend/pyproject.toml`, and the missing-docstring `D1xx`
  family stays off, because it would demand exactly the filler INC-4 rejects. _Enforced by_ ruff's
  `D` selection for the formatting half; placement is review judgment.
- **INC-8:** a test docstring says what is covered, never the name again.
- **INC-9:** a comment block is ≤250 characters, and ≤3 lines inline or ≤6 as a symbol doc, markers
  stripped — a ceiling, never a target.

## [The documentation corpus](chapters/3-corpus.md)

- **OUT-1:** two layers — specs say the contract, overviews say what for; why sits at the constraint.
- **OUT-2:** per-surface folders, each holding that surface's overview and spec, with the meta
  collections underscore-prefixed so they sort above them and never read as a surface. A directory
  holds a collection: a lone cross-cutting reference is a file at the root until two or three share a
  theme. A per-slice page exists only where a slice deviates from what the surface spec describes.
  _Enforced by_ review judgment.
- **OUT-3:** a folder README is orientation plus at most one bounded body section — purpose,
  navigation table, and a "Read next" only where the table does not already send the reader there;
  ≤120 lines. The root README is the sole exception, bound by the cap alone.
- **OUT-4:** spec spine — `1. Contract` with `1.<n>` subsections, then Invariants (permanent numbers,
  `I<n>` per surface and `L<n>` for logging), Violation → remedy, Known-open. Section 2 holds the
  three-column invariant table and nothing else.
- **OUT-5:** overview spine — a two-or-three-sentence opening, "How it is organised", sections,
  "Read next"; ~120 lines treated as a ceiling. Mechanisms belong in the spec sheet, and the
  argument for one in the commit that introduced it. _Enforced by_ gate check `overview-spine` for
  the first and last sections; the ceiling and what sits between are `/docs:audit`'s.
- **OUT-6:** one central glossary, one entry per term — the term as code spells it, a gloss, then
  `Is`, `In code`, `Trap`, `See`.
- **OUT-7:** diagrams are mermaid so they render in-repo, C4 levels 1–3 and never a code diagram,
  with no square brackets inside a quoted node label. They live in overviews, plus a spec sheet where
  a data flow is genuinely hard in prose. _Enforced by_ review judgment.
- **OUT-8:** a surface is frontend, backend or ops — the granularity where a question has one answer.
- **OUT-9:** the two shapes are called layers, and layer is the only word for them — never a
  second term for the concept anywhere in `docs/`. _Enforced by_ review judgment.

## [Currency](chapters/5-currency.md)

- **CUR-1:** claims about current behaviour are anchored so the gate can check them; a document
  that cannot state anchored claims is in the wrong shape, and narrative prose about current
  behaviour moves into a spec sheet rather than being promised a re-read.
  _Enforced by_ gate checks `citation` and `path` for the anchors; that a claim carries one is
  `/docs:audit`'s.
- **CUR-2:** a change that invalidates a claim updates the document in the same commit — a rewritten
  identifier is swept as free text, and a deleted record amends the rule that mandated it.
- **CUR-3:** stamp on line 3, exact shape, moved only after re-verifying the page; what the page
  claims decides whether it carries one.
- **CUR-4:** materially change a file a stamped page cites → re-verify and restamp it, same branch; a
  stamp-only delta re-arms nothing.
- **CUR-5:** the gate's check list lives in the currency chapter, and only there.
- **CUR-6:** what no branch touched belongs to `/docs:audit`; one branch's slice, before its pull
  request, to `/docs:audit-pr`.

Templates: [`templates/`](templates/).
