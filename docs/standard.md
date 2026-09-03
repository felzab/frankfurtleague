# Documentation standard

**Purpose:** every rule a written artifact here follows — `docs/` pages, module headers, docstrings,
comments, prompts, command files, templates, commit messages and pull request bodies.

**Three rules carry the weight**, and a writer holding only those gets most of it right: COR-13, why
rather than what; COR-5, the deletion test; COR-14, which rung.

**Every rule is one line, and the argument for it is in the commit that wrote that line** (COR-14).

**This file never arrives alone.** `.claude/hooks/docs-standard.sh` puts the Spine and the bounds,
sliced out of it at the moment of writing, in front of every documentation-shaped edit, and names
this file and `docs/worked-examples.md` — these rules applied to real passages, each shown before and
after — to be read in full; every agent brief names both, and the examples cite these rules rather
than restating them (COR-2). The mechanical defence is `scripts/checks/check_docs.py`,
run by `./scripts/gate/verify.sh` in its docs scope; its checks are registered at
`scripts/checks/docs_gate/kernel.py :: CHECKS`, and the finding a check prints says what its failure
means.

| Section                   | Holds                                              |
| ------------------------- | -------------------------------------------------- |
| [Spine](#spine)           | The three rules that carry the weight              |
| [Precedence](#precedence) | Which source wins, and the anatomy of a rule       |
| [Core](#core)             | The rules binding every written artifact           |
| [In-code](#in-code)       | Headers, docstrings, comments                      |
| [Corpus](#corpus)         | The `docs/` tree, every README and every template  |
| [Currency](#currency)     | The same-commit rule, the audit, and the machinery |

## Spine

- **COR-13:** documentation says why the code is the way it is; the code says what it does. Anything
  a reader gets by reading the code, running it or asking git is not written. Three questions the
  repository cannot answer by being read are the only reasons a written artifact exists: **why a
  shape was chosen** — this value, this order, the alternative rejected, what breaks otherwise;
  **what a caller may rely on**, true across a whole surface and so stated nowhere inside it; and
  **what has not reached the code** — a term's trap, a procedure performed at a keyboard, an
  obligation from outside, a decision not yet taken. What is none of the three is not written; what
  is one of them is written in full, at COR-14's rung, and leaving it out because a reader could work
  it out is not conciseness. _Enforced by_ `/docs:audit`.
- **COR-5:** ask of every sentence, **what does a reader do differently because this sentence is
  here?** No answer, and it is deleted rather than shortened; then ask it of the paragraph, and of
  the page. These never have an answer: announcing that the next sentence matters; restating the
  paragraph you are closing; naming where an argument lives and then giving it; justifying a decision
  recorded elsewhere; recounting how a measurement was taken rather than what it found (COR-9); a
  remark the code beside it states; a section introducing the one below it; a hedge or an
  intensifier; a claim true of any project of this kind. Never compress what survives: spell terms
  out and keep the words that make a sentence
  readable. Never cut a caveat that changes what someone would do, a failure mode, or the reason a
  constraint exists — they look least like instructions, so a pass deleting by appearance takes them
  first. **Unnecessary is decided by this test and never by a quota**: no pass carries a percentage
  or a target, because a passage already at its floor is then cut to reach it. **Every bound in this
  file is read after this test and never instead of it** — a passage still over one when every
  surviving sentence has an answer is content in the wrong place and it moves (COR-14); trimming from
  just over a bound to just under it is the defect the bound reveals, not the repair. _Enforced by_
  `/docs:audit`, and review.
- **COR-14:** a fact's rung is chosen by **which reader needs it, never by how long it is**, and
  among the rungs that reader reaches it takes the lowest: a test or a type, then a comment at the
  line it constrains, then an invariant row on the spec sheet, then that sheet's contract prose, then
  the overview. A **comment is read involuntarily** — nobody changes the line without seeing it — so
  its fact is the constraint on that line, aimed at whoever is about to break it; a **spec sheet is
  read deliberately**, by someone with no code open, so its fact is the contract. **A contract does
  not belong in a comment even when short, and a line constraint does not belong in a spec sheet even
  when long.** Between rungs the same reader reaches, the lower wins: a test fails where a page goes
  quietly wrong. **A bound a row or a cell cannot meet is a rung question and never a licence to
  cut**: what keeps the cell is the clause the reader with no code open would otherwise undo; a
  clause about how the code achieves the invariant goes down a rung to the comment at the line,
  moved rather than compressed; where both clauses would be undone by the reader with no code open
  they are two invariants and the row splits, a row being one invariant; and a clause fitting no
  rung stays where it is, which leaves the cell over OUT-4's bound with no exemption to reach and
  the docs gate red for every branch until I widen the bound or the clause finds a rung after all.
  The argument behind any of them is in the commit that made it, reached with
  `git log -S` on the identifier, never repeated at the rung. _Enforced by_ `/docs:audit`.

## Precedence

- **PRE-1:** when two sources disagree the higher wins: the code and what it actually does, then a
  spec sheet for a current contract, then `.claude/CLAUDE.md`, then an overview, then everything
  else — a runbook, a backlog entry, an audit prompt, a command file. _Enforced by_ unenforced —
  judgment.
- **PRE-2:** correct the summary, never the source. Where a document disagrees with the code the
  document is wrong: fix it in the commit that discovered it, because editing the source to match its
  summary launders an error into a decision. _Enforced by_ unenforced — judgment.
- **PRE-4:** a rule lives here exactly once, as a list line `- **<ID>:** <the whole rule>`, whose one
  line is everything a citation resolves to and which names what enforces it. An id is an address,
  not an order: its prefix names its family rather than its section, it is assigned once and never
  reused, and a retired or absorbed rule has every citation repointed in the same commit. A rule is
  never rewritten for reading oddly or narrowly: say what is wrong with it and stop. `Enforced by`
  names only checks the gate emits, a named read of a command, a linter selection, or says the rule
  is unenforced: a claim overstating the gate is worse than an unenforced rule. A rule and the check
  it claims land in the same commit, and the check is proven first against a violation planted in its
  real position on a real page. **A new check derives its population independently of the property it
  asserts** — two listings reached by different routes and required to agree — because one whose
  subjects come from that property can never fail: a subject lacking the property drops out of the
  listing rather than failing it. _Enforced by_ gate checks `enforced-by`, `rule-id` and
  `rule-shape`; the proving and the population are review judgment.

## Core

These bind every written artifact. A comment is documentation and carries every rule here too.

- **COR-1:** write for a reader who knows this stack and this repository's conventions and nothing
  else — not the conversation, the session, the branch or the effort behind the change. Every
  identifier resolves, every domain term is the glossary's, and the reasoning stands at the claim
  rather than behind a pointer to a file deleted by design. _Enforced by_ `/docs:audit`.
- **COR-2:** a fact is stated in full in exactly one place — the rung COR-14 gives it — and cited
  from everywhere else. A second mention is **one sentence and a citation**; a second paragraph is a
  second home, and one of the two goes. A sentence that names where the argument lives does not then
  give the argument. A section on two pages belongs to one, and the other links. Where nobody
  standing there needs the claim, the copy is deleted with nothing in its place. **A convention
  constraining a line at several sites keeps its one-sentence claim at every one of them**, because
  COR-14's reader meets it at the line and never at its home, and a comment reading only "see the
  spec sheet" fails the person about to break the line: what goes is every copy restating the
  argument, what stays is the copy stating the claim, cited to the argument's home where one is
  citable and one sentence alone where none is. One duplicate survives, and it is the only thing the
  check exempts: the copy no citation can reach, because
  something other than a reader consumes it at a fixed location — a path a platform serves, a form a
  tool quotes verbatim. Convenience is never the reason, and neither is the copy being short.
  _Enforced by_ gate check `echo` over a page's paragraphs alone; comment runs are `/docs:audit`'s,
  which can tell a restated argument from the restated claim the bold clause above requires, where a
  mechanical match reports both alike.
- **COR-3:** no document names a file, symbol, field, endpoint or behaviour absent from the
  repository right now. Two shapes are banned outright: narrating an edit, and documenting an absence
  for its own sake. A rejected alternative is neither: write it in the present, as a constraint aimed
  at the reader about to propose it again. A document whose subject is what happened is exempt within
  that job — a commit body, a pull request, an audit report, and `docs/worked-examples.md`, whose
  subject is a passage on each side of a cut. _Enforced by_ gate check `history` for a fixed phrase
  list over a branch's added lines; both banned shapes past those phrases, and the exemptions, are
  `/docs:audit`'s.
- **COR-4:** **the test is derivability, never a list of banned words**: a value this repository
  answers in seconds — from a command, a manifest, a config file, a data file or a constant — is
  cited and never written, whatever kind of value it is. A count, an enumeration, an ordinal, a size,
  a duration, a version, a date, a tool's configuration and a line number are the classes that keep
  catching people, and they illustrate the test rather than bound it. Name what selects a set instead
  of listing it, and an enumeration survives only where the gate resolves every member. **A date is
  the commit's** (COR-14), so no sentence in the working tree is dated. Five things are not values in
  this sense: a bound this file sets, which is a decision; a figure a test or a data file asserts,
  which is the assertion; a fact copied from outside, at the line holding the copy, which says what it
  mirrors and
  that the source moves without us; a set the same sentence closes, which is a definition; and a date
  that is itself the datum — a document whose subject is that date, and **the date a measurement was
  taken, which stays beside the figure**, because a figure nobody can date is a figure nobody can call
  stale, and because `scripts/checks/check_gate_budget.py` refuses a raised budget whose stamp did not
  move, making that stamp a value the repository reads rather than one it merely records. _Enforced by_ gate check `line-citation`
  for the line-number class alone; every other class, and the exceptions, are `/docs:audit`'s.
- **COR-6:** a citation is a backticked `<path> :: <symbol>`, `<path> :: <short quoted fragment>`, a
  bare backticked repository path, a rule or invariant id, or the continuation `` `:: <anchor>` ``,
  which resolves against the nearest file named above it and fails where none is. A section is cited
  by anchor or quoted fragment, never described. Never a commit SHA: this history has been rewritten
  and can be again, so a commit is reached by its content (COR-14) rather than by its name. Never a
  line number, in any form — nothing tells a correct one from a stale one — except a finding in a
  gitignored audit report, read once against the tree it came from. _Enforced by_ gate checks
  `citation`, `path`, `anchor`, `link`, `rule-id` and `line-citation`; gate check `sha`, which fails
  a backticked run of seven or eight hex characters carrying both a digit and a letter whether or not
  this clone resolves it, resolution being exactly what a rewritten history takes away — a run of hex
  alone is a value and stays review's; `/docs:audit`.
- **COR-7:** purpose in the first lines; a reference long enough that a reader arrives with a
  question rather than at the top carries a table of its sections against the question each answers.
  **What triggers the table is how the page is read, never how long it is**, so a page read from its
  first line through to its last — a command file, an audit pass prompt, anything that is a script
  for one run — owes none however long it grows, and needs no exemption saying so. _Enforced by_
  `/docs:audit`.
- **COR-8:** rules as lists, one per item; a list or a table wherever a document's body is
  enumerable, an enumeration left as prose there being a list nobody made, and prose only where a
  "because" carries it; the claim in an item's first words; bold marking the claim and never the
  paragraph, since a section bolding everything marks nothing; headings stating the rule rather than
  the topic; no nesting past three levels. **Inside one line whose shape another rule fixes** — a
  rule here (PRE-4), a `.claude/CLAUDE.md` §7 line, a `.claude/rules/` clause — an enumeration stays
  prose with semicolons parting its members, because that line cannot carry a list without breaking
  the shape a citation resolves against. The shape is chosen before any bound is read (COR-5), and no
  bound counts what a shape costs to draw, so a word bound is never a reason to leave an enumeration
  as prose. A section introducing the one below it, a heading with a
  line or two under it, a one-row table, and a list restating the table beside it all merge upward.
  Metadata lines each end with a hard break — a trailing backslash — when another follows; the last
  carries none. _Enforced by_ gate check `metadata-break` for the hard breaks alone, in both
  directions; the lists, the bold, the headings and the nesting are `/docs:audit`'s.
- **COR-9:** state doubt wherever a reader would otherwise act on a guess — what was verified, what
  was assumed and why, which reading you chose and which you rejected, and the measurement a claim
  rests on, which is **what it found and never how it was taken** — and never present a plan as a
  description. This binds a report, a commit body, a pull request and a backlog entry; a spec sheet
  states its contract and cites it, and the doubt behind a contract belongs to its commit.
  _Enforced by_ `/docs:audit`.
- **COR-10:** a normative document — this file, a command file, a rules file — writes a placeholder
  rather than a real path, symbol or value, so nothing in it reads as a claim about the tree that a
  rename can falsify. A rule's own subject is excepted, and so is `docs/worked-examples.md`, whose
  real passages are the point. _Enforced by_ `/docs:audit`.
- **COR-11:** the words "the owner" appear in no tracked file outside `.claude/` — everything so
  written speaks in my own voice: first person where a person acts, neutral imperative everywhere
  else. `.claude/` is exempt whole, needing me named as a third party to be unambiguous; quoting the
  phrase to name what is banned is a mention, not a use. _Enforced by_ gate check `owner-voice`,
  which reads a quoted or backticked occurrence as the mention it is; `/docs:audit` for the
  third-person constructions that avoid the phrase.
- **COR-12:** a file whose kind has a defined shape never deviates from it — not once, not for one
  file, not by approval. The shapes are a README's (OUT-3), a spec sheet's (OUT-4), an overview's
  (OUT-5), a glossary entry's (OUT-6), a module header's (INC-2) and a rule's (PRE-4). Where a file
  does not fit, **the file changes**: the content that does not fit moves to a page whose shape holds
  it, or it goes. _Enforced by_ gate checks `readme-cap`, `spec-spine`, `invariant-row`,
  `overview-spine`, `glossary-entry`, `module-header` and `rule-shape`; whether a deviation was
  repaired by moving the content or by widening the shape is review judgment.
- **COR-15:** a file whose only reader is a model — a command file, a rules file, `.claude/CLAUDE.md`,
  a skill page, an audit pass prompt — is written for that reader alone, and its length is judged per
  invocation rather than per file, because it is paid again on every run. What goes is everything
  serving a human's comfort or pacing: narrative flow, an onboarding passage, motivational framing, a
  sentence easing the reader into the next one, an example illustrating what the line beside it
  already states plainly, a second phrasing for emphasis. What stays, and stays harder here than
  anywhere else, is exactly what COR-1 and COR-5 already protect — terms spelled out, every caveat
  that changes what someone would do, every failure mode, and the reason a constraint exists — because
  a reader who cannot ask walks confidently into whatever a compression took out. No cap bounds such a
  file: COR-5's test does, and a cap on a file read every run is a target. COR-7 binds it like any
  other reference. _Enforced by_ `/docs:audit`.

## In-code

Scope: every tracked file of a kind `scripts/checks/docs_gate/kernel.py :: SCANNED_SUFFIXES` or
`:: OPS_FILENAMES` selects, wherever it sits — the source trees `fl_frontend/src`,
`fl_backend/app`, `fl_backend/tests` and `scripts/`, the hook folders `.claude/hooks/` and
`.githooks/`, and the Dockerfile, workflow and manifest outside all of them. **A tree is in scope
for those kinds and never whole**, because `scripts/checks/docs_gate/kernel.py :: comment_style`
hands an unrecognised kind to the shell-comment reader, which cannot tell a CSS id selector from a
comment.
The hooks are exempt from INC-2's shape alone — their uniform label rows keep the folder scannable
side by side — and every other rule here binds them as written, INC-2's own checked reach being
narrower than this Scope in a way INC-2 states.

- **INC-1:** a comment is COR-13 at the line: it records what cannot be re-derived from the source —
  the constraint, the rejected alternative, the trap — and sits at the line of temptation, the line
  someone would change, never the top of the function. Never what the next line does, and never a
  type the signature declares: no `@param`/`@returns` blocks, no `Args:`/`Returns:` sections.
  _Enforced by_ unenforced — review judgment.
- **INC-2:** a module header survives in a **shell script**, and in a Python module under
  `fl_backend/app/`, `fl_backend/tests/` or `scripts/` — the tests in both trees included — carrying
  a fact that attaches to no symbol: an exit contract, a one-cache-per-run rule, a carve-out the
  whole module rests on; `scripts/checks/docs_gate/checks.py :: HEADER_SCOPES` is that scope.
  TypeScript and JavaScript modules carry none: a comment sits at the thing it explains. Where one
  survives it is a plain block — a title line `<TOKEN> · <what this module is>`, at most three
  sentences why-first, a sentence of plain "what" where the file's contents do not carry it, optional
  plain `Invariants:` and `See:` lists one line per entry, and no other label, rule, column or
  decoration. It states a rule in a line and never the argument behind it, and `Invariants:` holds
  only what a change could violate silently. The bound is **175 words**, measured on the header text
  with its markers stripped — a list's markers among them, as INC-9 strips them, so the two lists
  above never cost a header for taking the shape COR-8 asks for — and read as COR-5 reads every
  bound: a header still over it once every surviving sentence has an answer is holding a fact that
  belongs at a lower rung, and that fact moves (COR-14). **Outside `HEADER_SCOPES` a header is
  measured by no bound at all — where the file has one**:
  `scripts/checks/docs_gate/kernel.py :: comment_runs` skips a leading run of comment lines, and it
  finds one only where the file's first non-blank line below any shebang begins with a marker. A
  hook, a `.githooks/` file, a Dockerfile, a `.dockerignore`, an nginx configuration and `zizmor.yml`
  do open that way, so their opening block is held to COR-5's test and to review alone. A workflow,
  `.github/dependabot.yml` and `fl_backend/pyproject.toml` open on a key instead, which leaves their
  first comment run an ordinary block INC-9 bounds like any other. That gap is stated rather than
  closed because a bound reaches a file only once someone has read it against COR-5 first, and a
  header failing a bound nobody applied when it was written is a red gate rather than a repair.
  _Enforced by_ gate check
  `module-header`, inside `HEADER_SCOPES` alone, for the word bound, the title line, the banned
  vocabulary and a header placed below the imports; gate check `header-see`, which resolves every
  file a `See:` entry names; the three-sentence bound, which files carry a header at all, and every
  header outside that scope, are review judgment.
- **INC-4:** a docstring is required in exactly two places — every FastAPI endpoint, published as the
  operation description in `/openapi.json` and written for a reader of the API; and anywhere with a
  why worth recording. There is no every-exported-symbol rule, because a coverage rule manufactures
  filler that buries the one sentence which matters. An endpoint's docstring says what the operation
  does and any behaviour a caller would be surprised by; the domain rules behind it stay in the spec
  sheet (PRE-1). **No bound holds a published endpoint docstring** — COR-5's test does, as it does a
  file only a model reads (COR-15) — because a refusal a caller would be surprised by is stated or it
  is not, and a bound written for a comment interrupting code would buy its own number by dropping
  one of them. Test functions are INC-8's. _Enforced by_ gate check `comment-length` for INC-9's
  bound over a docstring the API does not publish, and unenforced for one it does; that an endpoint
  carries one at all, and that every surprising refusal is in it, are review judgment.
- **INC-6:** a comment cites the way `docs/` cites (COR-6), and never an audit id, a ledger row, a
  roadmap id, a session or an issue number, whose tracker sits outside this repository's history. A
  link to code outside this repository is pinned to a commit — one naming a branch and a range of
  lines drifts silently. The gate reads comments in the files
  `scripts/checks/check_docs.py :: SCANNED_SUFFIXES` names, Dockerfiles included, and not executable
  code, where a path-shaped string is data; an unbackticked path is read too, because an unmarked
  path is how a dead one survives a green gate. A roadmap id and a review reference are narrower:
  `scripts/checks/docs_gate/branch.py :: check_added_citations` reads the branch's added comments in
  `scripts/checks/docs_gate/kernel.py :: SOURCE_SUFFIXES` alone, so neither is caught in a Dockerfile,
  a workflow, an nginx configuration or a manifest. _Enforced by_ gate checks `citation`,
  `line-citation`, `comment-citation`, `path`, `bare-path`, `link` and `rule-id`; an unpinned outside
  link is review judgment.
- **INC-7:** directive first line · a Python docstring is the first statement, above the imports ·
  summary line, then a blank line, then prose. Docstring enforcement is a formatting subset only: the
  selected ruff `D` codes live in `fl_backend/pyproject.toml`, and the missing-docstring `D1xx`
  family stays off, because it would demand exactly the filler INC-4 rejects. _Enforced by_ ruff's
  `D` selection; placement is review judgment.
- **INC-8:** a Python test function carries a docstring only where it says what the name cannot —
  what a parametrised set spans and which case is load-bearing, the failure it guards against, why a
  case that looks redundant is not. Never a paraphrase of the test name; one restating the name is
  deleted rather than shortened. In TypeScript the `it("…")` string is the sentence, and where it
  cannot carry everything a `//` comment above the case does. Fixtures in `conftest.py` are out of
  scope. _Enforced by_ gate check `comment-length` for INC-9's ceiling; ruff's `D` subset shapes the
  docstrings that exist; whether one is a name-paraphrase is review judgment.
- **INC-9:** a comment block is judged by COR-5's test first and read against its bound only
  afterwards. The bound is **forty words**, and it is a prompt to re-ask COR-14's question rather
  than a number to get under: at it, ask whether this is a contract at the wrong rung, which moves to
  an invariant row leaving the comment as the line citing it; whether every surviving sentence has an
  answer, because density is the repair and compression is not; and whether it constrains more than
  one line, which makes it more than one constraint, each going to the line it is about. A block
  still over the bound once all three are answered is content in the wrong place and it **moves**
  (COR-14); one that is a single line's constraint and irreducible stays over it. The bound is
  measured on the comment text with markers and indentation stripped — a list's markers among them,
  so the shape COR-8 asks for never costs a block anything — one number for every shape, inline
  comment, symbol doc and test docstring alike, so it cannot be avoided by moving a paragraph from
  beside a symbol to above it; an opening block is skipped here as a module header and keeps INC-2's
  bound, or none where INC-2 says none is checked. **The bound does not
  reach a docstring the API publishes** (INC-4), which is a contract read by someone with no code
  open and so not this rung at all (COR-14); every other docstring is a block like any other. **A
  blank line separates two runs of line comments, or the checker reads them as one block**: a bare
  `#` between them joins the run rather than ending it, and a formatter can delete the blank line
  inside an argument list, so a two-paragraph comment moves above the statement, where the break
  survives. **A docstring is one block whatever blank lines it holds**, its paragraphs joined before
  the count, and so is a TypeScript `/** … */` doc comment, which a blank line cannot part either:
  the blank would detach it from the declaration beneath it, which is the whole of what a doc
  comment is. Two independent constraints inside either are parted by moving one to the line it is
  about (COR-14), or by writing it as a `//` block above the doc comment, whose own attachment
  survives that. _Enforced by_ gate check `comment-length`, which fails a block
  past that same bound over every block a branch added a line to, and which exempts a docstring only
  where the published document carries it AND a route decorator sits above it. **The two are one
  population, not two**: that document is generated from these same docstrings, so PRE-4's
  independence is not what this pair buys — what it buys is that a docstring the API does not
  publish keeps this bound, the decorator alone never deciding. A block the branch found already over the bound keeps that standing while the
  branch does not lengthen it, matched to its earlier self by the lines the two versions share
  rather than by its first line, so improving an over-bound block's opening sentence costs nothing
  and adding to one fails; a block over the bound that no branch has touched is `/docs:audit`'s
  (CUR-6).

## Corpus

Scope: the `docs/` tree — its kinds and its layout — and, wherever in the repository they sit, every
README and every template.

- **OUT-1:** every page in `docs/` has a kind, and a kind fixes three things: the question the page
  answers, what makes it change, and the shape it keeps. A page holding content of another kind moves
  that content rather than widening (COR-12), and a page whose update trigger nobody can name has no
  kind and does not go in. Pages sit in per-surface folders holding at least that surface's overview
  and spec — a folder takes a page of any other kind that belongs to that surface — with the meta
  collections underscore-prefixed so they sort above them; a lone cross-cutting reference is a
  file at the root until two or three share a theme, and a per-slice page exists only where a slice
  deviates from its surface spec. Why something is built as it is sits in none of them (COR-14).
  _Enforced by_ `/docs:audit`; the shapes are COR-12's checks.
- **OUT-3:** a README carries a title naming the folder, a `Folder purpose:` line, a navigation table
  under `## Folder overview`, and at most **one** body section — the single thing a reader needs
  before opening anything in the table. No rules, no worked examples, no precedence, no term
  definitions, which live in this file, a spec sheet or the glossary. A closing `## Read next` is
  navigation, not a body section, and appears only where the table does not already send the reader
  there. The bound is **600 words counted outside table rows and fenced blocks**, read as COR-5 reads
  every bound; the navigation table is required structure, so counting it would push a compliant
  README toward its bound for obeying the rule above. A README still over the bound once every
  surviving sentence has an answer is carrying a body section that belongs on a page of its own. The
  repository's root `README.md` is the sole exception, being the public landing page; the bound still
  reaches it. _Enforced by_ gate check `readme-cap` for the bound alone; the title, the purpose line,
  the table and the one body section are `/docs:audit`'s.
- **OUT-4:** a spec sheet says what a caller may rely on and cites the symbol that delivers it; a
  paragraph describing how a function does its work is a comment that moved, and goes back (COR-14).
  **Prose in a table cell is prose:** a cell carrying a paragraph is a paragraph wearing a table's
  clothes, and it is cut to the invariant with its argument in the commit. The bound is **25 words**
  on the cell as it is written, a citation's own words counted, and read as COR-5 reads every bound.
  **What leaves the cell is the reasoning that was weighed; what stays is the clause a reader would
  otherwise undo** — the
  sentence saying why the obvious simplification is refused is the reason the constraint exists, and
  COR-5 never cuts it. The one cell exempt is a fragment something else consumes verbatim, quoted as
  it is spelled; **the check reads that shape rather than the consumption**, sparing a cell whose
  text outside its quoted and backticked spans runs to two words or fewer, so a cell dressed as a
  fragment that nothing consumes passes and is review's. The sheet opens with its scope and section table (COR-7), then carries
  exactly four sections: `1. Contract`, holding as many `1.<n>` subsections as the surface needs;
  `2. Invariants`; `3. Violation → remedy`; and `4. Known-open`. The invariant table is three
  columns — the number, the invariant, and what
  enforces it. Numbers are `I<n>` on a surface sheet and `L<n>` on the logging sheet, permanent and
  never reused **within their own sheet**, so a citation crossing sheets names the sheet. **Section 2
  holds that table and nothing else**; a symptom a reader would observe is a row in section 3.
  Section 4 holds the accepted gaps in the sheet's own words, so a known limitation never reads as an
  oversight and gets "fixed"; **its shape is the writer's** (COR-8), and a gap carrying a finding, a
  procedure and a refusal at once is a list entry rather than a cell losing one of the three, the
  bound reaching a table cell and nothing else. Every claim carries an anchored citation (COR-6). _Enforced by_ gate
  checks `cell-prose`, `spec-spine`, `invariant-row`, `invariant-id`, `citation` and `path`; contract
  over mechanism is `/docs:audit`'s.
- **OUT-5:** overview spine — a two-or-three-sentence opening, `How it is organised`, sections,
  `Read next` — with mechanism left to the spec sheet and the argument for one to its commit. **No
  bound holds an overview**, deliberately: what lengthens one is mechanism, mechanism has a named
  destination and moves there (COR-14), and a number in its place would be read as room to fill by
  the content that should not be on the page at all. _Enforced by_ gate check `overview-spine` for
  the opening and closing sections existing and nothing further; what sits between them, and whether
  mechanism has crept in, are `/docs:audit`'s.
- **OUT-6:** the domain vocabulary lives in one file, `docs/glossary.md`, one entry per term: a `### `
  heading giving the term as code spells it and a one-line gloss, then the fields `Is`, `In code`,
  `Trap` and `See`, in that order. Where the code and the domain spell one thing differently, the
  spellings share an entry. `Trap` is the field a hurried entry drops and the one the glossary exists
  for. _Enforced by_ gate check `glossary-entry` for the heading's shape and the four fields in
  order; whether `Trap` carries the trap is `/docs:audit`'s.
- **OUT-7:** diagrams are mermaid, so they render in-repo; C4 levels 1–3, mirroring the C4 model's
  own levels, which move without us; never a code diagram; no square brackets inside a quoted node
  label. They live in overviews, plus a spec sheet where a data flow is hard in prose. _Enforced by_
  unenforced — review judgment.
- **OUT-8:** a surface is one of the three parts of the system a reader goes to as a whole — frontend
  (`fl_frontend/`), backend (`fl_backend/`), and ops (the compose files, `nginx/`, `scripts/`, the
  Dockerfiles). Ops owns the scripts and what they guarantee; `docs/_git/` owns the pipeline that
  invokes them and the GitHub configuration. A surface is not a slice, not a layer, not a directory.
  _Enforced by_ unenforced — review judgment.
- **OUT-9:** a template is a rule made copyable, and this binds every one in the repository whatever
  tree it sits in and wherever the artifact it produces lands, that artifact landing outside the
  repository included. Where a rule fixes the shape it shows, the form cites that rule rather than
  restating it (COR-2); where none does, the form is that shape's one home and has nothing to cite.
  It says what checks the artifact it produces, and **says that nothing does where nothing does** —
  a copier who assumes a gate is watching is the failure that clause refuses, so the sentence is a
  claim about the enforcement rather than COR-3's documented absence. A form carrying a constraint on
  this repository's own work that no rule, spec sheet or checker states is a rule with no home: it
  moves to the rung that holds it (COR-14) and the form cites it there, or the form loses it; a
  constraint on what an author types into that one form is the form's own subject and stays.
  _Enforced by_ `/docs:audit`, whose partition reaches every tree a template sits in; gate check
  `template-fragment`, which confirms only that the pull request form still carries every fragment
  the body checker quotes from it, and reads neither a template's own shape nor any artifact a
  template produces.

## Currency

- **CUR-1:** claims about current behaviour are anchored so the gate can check them; a document that
  cannot state anchored claims is in the wrong shape, and narrative prose about current behaviour
  moves into a spec sheet rather than being promised a re-read. _Enforced by_ gate checks `citation`
  and `path`; that a claim carries one is `/docs:audit`'s.
- **CUR-2:** a change that invalidates a documented claim updates that document in the same commit —
  not the same branch eventually, not a follow-up — because the moment of the change is the only
  moment fixing drift costs nothing. Before any pull request, answer one question out loud: what did
  this change make untrue? "Nothing" is a legitimate answer; not asking is not. Two answers are
  routinely missed: a renamed or renumbered identifier is swept as free text, not only in the
  citation forms the gate resolves; and deleting a record some rule names as mandatory amends that
  rule in the same change, or the rule survives pointing at nothing and the next reader restores the
  record to satisfy it. _Enforced by_ unenforced — the close-out question, and review.
- **CUR-6:** **a branch is failed only for a finding it can fix** — a gate failing branches over
  pages they never touched trains people to override it. This is not a promise that every check is
  branch-scoped: only `comment-length`, `history` and `comment-citation` read the branch's own diff,
  and every other check here reads the whole corpus. What holds the promise instead is that the
  corpus stays clean, so a whole-corpus check has nothing standing to charge anyone: **a check lands
  in the same commit that clears the findings it raises**, and a migration too large for that commit
  is a migration, never a per-branch tax collected until somebody gets to it. What no change has touched is
  `/docs:audit`'s job: invoked, never scheduled, catching up rather than defending, and invoked over
  the rules that changed whenever this file changes. One branch's documentation, judged before its
  pull request, is `/docs:audit-pr`'s. _Enforced by_ unenforced by design.
- **CUR-8:** the machinery is audited like the corpus, and whoever revises this file does it, because
  a lens aimed at the artifacts cannot see the enforcement holding them. Of every check ask: does
  anything it prints reach a reader, and can a sibling starve it? Is its population PRE-4's, derived
  independently of the property it asserts, and what does that population make permanent by default?
  Can it fail, and has anyone driven it red? Does it fail only when it should, or does it teach
  people to route around it? Of every rule
  ask: who enforces it where the gate cannot, when did that last happen, and what makes it happen
  again? A rule with no enforcer, and a check whose findings nobody has acted on, are both defects —
  one is a rule nobody believes, the other a signal nobody sees, and the repairs differ.
  _Enforced by_ unenforced — judgment, at every revision of this file.
