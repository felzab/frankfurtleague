# Core rules

**Verified against:** `5d70e9f`, 2026-08-09\
**Applies to:** every written artifact — module headers, symbol docs, inline comments, `docs/`
pages, ADRs, prompts, command files, commit messages and pull request bodies.

| ID     | Rule                                    |
| ------ | --------------------------------------- |
| COR-1  | Write for a reader with no context      |
| COR-2  | Say it once                             |
| COR-3  | Name only what exists                   |
| COR-4  | Ban the facts that rot fastest          |
| COR-5  | Concise by selection                    |
| COR-6  | Anchor every citation                   |
| COR-7  | Purpose first, and the index navigates  |
| COR-8  | Structure for scanning                  |
| COR-9  | State doubt                             |
| COR-10 | Generic examples in normative documents |
| COR-11 | The voice is the owner's                |

---

### COR-1 — Write for a reader with no context

**Rule:** every document is fully understandable to someone meeting this repository for the first
time. No reference to a conversation, a session or a past effort. No identifier that fails to
resolve to something tracked — an ADR number, a roadmap id, a file path, a commit SHA. Reasoning a
claim depends on is written out where the claim is made, never left behind a pointer to a file that
is deleted by design.

**Why:** the author has the context and cannot feel its absence, and a dangling reference still
reads as though it means something.

**Exceptions:** —

**Enforced by:** `/docs:audit` (the cold read).

**Example:** a lesson from an incident survives as a present-tense rule; the incident does not.

### COR-2 — Say it once

**Rule:** a fact is stated in full in exactly one place and cited from everywhere else. Where it
belongs:

- why this line looks like this — an inline comment, at the line
- true of a module — its header
- a decision with rejected alternatives — an ADR
- a contract someone looks up — the surface spec sheet
- what a surface is for — its overview
- a rule every session must follow — CLAUDE.md, pointing at the source

**Why:** a fact stated twice eventually disagrees with itself, and the copy nobody revisits is the
one that goes stale.

**Exceptions:** —

**Enforced by:** `/docs:audit` (the duplication read).

**Example:** a header says "never do <X>" in one line and cites ADR-<NNNN>; the ADR carries the
argument; a reader who never opens it still knows the rule — what they lose is why, never what.

### COR-3 — Name only what exists

**Rule:** no document names a file, symbol, field, endpoint or behaviour that is not in the
repository right now. Two shapes are banned by name: narrating an edit, and documenting an absence
for its own sake. A rejected alternative is neither — write it in the present, as a constraint
aimed at the reader about to propose it again. A measurement carrying its date is a record, not
history, and stays.

**Why:** a page naming something that is gone reads exactly like one naming something live, and a
reader has no way to tell the two apart without checking.

**Exceptions:** a closed list — an ADR's Context, an ADR's `Superseded by` line,
`docs/roadmap/closed-items.md`, and the final reports in `docs/_auditing/reports/`. Each is a
record whose subject is what happened, and only within that job.

**Enforced by:** gate check `history` (reported over the branch diff — the hits must be read), and
`/docs:audit`.

**Example:** "Never branch a reduced variant off it: measured <date>, the trim is <n> KiB and both
lookups run either way (ADR-<NNNN>)" — the constraint, never the story of a removal.

### COR-4 — Ban the facts that rot fastest

**Rule:** three kinds of claim are never written as facts about now:

- a count — derive it at read time or omit it; write one only when it is the point of the
  sentence, and then with the date it was measured
- a tool's current configuration — cite the config file rather than restating it
- a line number — anchor the citation instead (COR-6)

**Why:** each goes wrong at some point after it is written, nothing detects the moment, and a
reader who catches one stops trusting the page.

**Exceptions:** —

**Enforced by:** gate check `line-citation` for the line-number half; `/docs:audit` for the rest.

**Example:** —

### COR-5 — Concise by selection

**Rule:** cut whole sentences that carry no instruction — preamble, restatement, closing
summaries, justification for a decision already taken. Never compress the sentences that remain:
spell terms out and keep the words that make a sentence readable. When in doubt, delete.

**Why:** length is not the constraint — readability is, and a small accurate corpus is one that
can actually be kept true.

**Exceptions:** never cut a caveat that changes what someone would do, the failure mode behind a
rule, or the reason a constraint exists.

**Enforced by:** unenforced — review judgment.

**Example:** —

### COR-6 — Anchor every citation

**Rule:** a citation is one of:

- a backticked `<path> :: <symbol>` or `<path> :: <short quoted fragment>`
- a bare backticked repository path
- an ADR number

Never a line number, in any form.

**Why:** an anchored citation is machine-checkable and survives every edit above it; a line number
is wrong the moment anything is inserted, and nothing can tell a correct one from a stale one.

**Exceptions:** —

**Enforced by:** gate checks `citation`, `path`, `adr` and `line-citation`.

**Example:** `<slice>/actions.ts :: <actionName>` — the file must exist, and the symbol must still
appear in it.

### COR-7 — Purpose first, and the index navigates

**Rule:** the first lines of a document state what question it answers. A chapter of this standard
navigates by its rule-index table; any other page longer than about a hundred lines carries a
table of its sections against the question each answers.

**Why:** a page whose purpose has to be inferred gets read in full by people who did not need it,
and prose alone does not let a reader skip.

**Exceptions:** —

**Enforced by:** `/docs:audit` (the shape read).

**Example:** —

### COR-8 — Structure for scanning

**Rule:**

- rules as lists, one rule per item — a sentence chaining independent rules with semicolons is a
  list that has not been written yet
- tables for anything enumerable
- prose for anything that needs a "because" — a table cannot carry one
- bold the claim, never the paragraph
- headings state the rule, not the topic
- no nesting past three levels — deeper means the document needs splitting
- metadata lines — a stamp, a Scope line, an ADR's six fields — each end with a hard break (a
  trailing backslash), so they render one per line rather than flowing into a paragraph

**Why:** a human reader wins on structure and an assistant wins on precision, and this shape gives
both — a clear heading with an unambiguous rule under it.

**Exceptions:** —

**Enforced by:** `/docs:audit` (the shape read).

**Example:** "Name only what exists" is a heading; "Naming" is a topic.

### COR-9 — State doubt

**Rule:** where something could not be verified, say so and say why. Where two readings are
possible, give the one believed and name the other. Where a claim rests on a measurement, give the
measurement. Never present a plan as a description — a pass that "writes a report" must exist and
do so.

**Why:** a named gap is a gap someone can close; a confident guess is a defect with a long
half-life.

**Exceptions:** —

**Enforced by:** `/docs:audit` (the doubt read).

**Example:** —

### COR-10 — Generic examples in normative documents

**Rule:** a normative document — a chapter of this standard, a template, the rules index, a
command file — never embeds a real path, symbol or value as an example. Examples use placeholders:
`<slice>/queries.ts`, `ADR-<NNNN>`, `<date>`. Worked examples anchored to real code belong in spec
sheets and overviews, where the gate checks every citation. A rule's own subject may be a real
path — naming `scripts/check_docs.py` as the enforcement is content, not an example.

**Why:** the gate skips placeholders, so a generic example can never rot and never forces a
restamp; a real example ties a normative page to that code's churn.

**Exceptions:** —

**Enforced by:** `/docs:audit` (the shape read).

**Example:** `<slice>/queries.ts :: <fn>` here; the same citation with real names in a surface
spec sheet.

### COR-11 — The voice is the owner's

**Rule:** the words "the owner" appear nowhere in `docs/`. Documentation speaks in the owner's own
voice — first person where a person acts, neutral imperative everywhere else. Files under
`.claude/` are exempt: they are instructions to the assistant and name the owner as a third party
by design.

**Why:** `docs/` is the maintainer documenting their own project, and a third-person "the owner"
reads as a second author who does not exist.

**Exceptions:** `.claude/`, the whole tree.

**Enforced by:** `/docs:audit` (the cold read).

**Example:** "Marking ready and merging are mine alone" — never "are the owner's".
