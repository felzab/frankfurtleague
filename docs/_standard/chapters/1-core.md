# Core rules

**Verified against:** `d666f6c9`, 2026-08-30\
**Applies to:** every written artifact — module headers, symbol docs, inline comments, `docs/`
pages, prompts, command files, commit messages and pull request bodies.

| ID     | Rule                                     |
| ------ | ---------------------------------------- |
| COR-2  | Say it once                              |
| COR-3  | Name only what exists                    |
| COR-4  | Ban the facts that rot fastest           |
| COR-5  | Concise by selection, and earn the space |
| COR-6  | Anchor every citation                    |
| COR-7  | Purpose first, and the index navigates   |
| COR-8  | Structure for scanning                   |
| COR-10 | Generic examples in normative documents  |
| COR-11 | The voice is mine                        |
| COR-12 | A defined shape is never widened         |

---

### COR-2 — Say it once

**Rule:** a fact is stated in full in exactly one place — its home — and cited from everywhere else.
Where each kind belongs:

- why this line looks like this — an inline comment, at the line
- true of a module — its header
- a decision with rejected alternatives — the commit that took it, with the constraint at the line
- a contract someone looks up — the surface spec sheet
- what a surface is for — its overview
- a rule every session must follow — CLAUDE.md, pointing at the source

A rule obeys the same split by layer: the enforcement layer (CLAUDE.md, the gate's messages) states
it, and the reasoning layer (these chapters) carries the argument.

A second mention exists only where a reader standing there needs the claim, and takes one form: the
claim briefly, plus the citation. Where nobody standing there needs it, the copy is deleted with
nothing in its place — converting it into a pointer removes the drift and keeps the line.

**Why:** a fact stated twice eventually disagrees with itself, and the copy nobody revisits is the
one that goes stale.

**Exceptions:** one duplicate survives — the one a reader cannot reach by citation at all, because
something other than a reader consumes it at a fixed location. A path a platform serves, and a
template a fresh session copies before it could open the source, are both this. Convenience is never
the reason, and neither is the copy being short.

**Enforced by:** `/docs:audit` (the duplication read).

### COR-3 — Name only what exists

**Rule:** no document names a file, symbol, field, endpoint or behaviour absent from the repository
right now. Two shapes are banned outright: narrating an edit, and documenting an absence for its own
sake. A rejected alternative is neither — write it in the present, as a constraint aimed at the
reader about to propose it again. A measurement carrying its date is a record, not history.

**Why:** a page naming something gone reads exactly like one naming something live, and a reader
cannot tell the two apart without checking.

**Exceptions:** a closed list — `docs/_roadmap/closed-items.md`, whose subject is what happened, and
only within that job. A pointer a reader would act on today is not shape, and stays in scope.

**Enforced by:** gate check `history` (reported over the branch diff — the hits must be read), and
`/docs:audit`.

### COR-4 — Ban the facts that rot fastest

**Rule:** these are never written as facts about now:

- **a count** — derive it at read time or omit it; write one only when it is the point of the
  sentence, and then with the date it was measured
- **an enumeration or an ordinal** — name what selects the set instead. A sentence carrying a member
  count has to be edited every time the set grows, and nothing makes that happen
- **a version number** — cite the manifest that declares it. A range moves the installed version with
  no tracked file changing, so a version written into prose or a comment goes stale silently
- **a tool's current configuration** — cite the config file rather than restating it
- **a line number** — anchor the citation instead (COR-6)

More generally: a value the repository states elsewhere is cited, never repeated. Each repetition is
a copy that has to be found and changed together with the original, and nothing finds them.

What this bans is a count of something outside the sentence stating it. A set the same sentence
closes is definition rather than a claim: naming both of two bounds beside those two bounds cannot
come apart, because nothing can add a third without rewriting the sentence that counted them.

**Why:** each goes wrong at some point after it is written, nothing detects the moment, and a reader
who catches one stops trusting the page. Enumerations are the worst because they read as precision:
this corpus had accumulated over three hundred (measured 2026-08-09), including two comments claiming
the same ordinal over one base component.

**Enforced by:** gate check `line-citation` for the line-number half; gate check `counts`, which
reports cardinal and ordinal words in a branch's changed prose and comments — a list to read, not a
failure; `/docs:audit` for the rest.

### COR-5 — Concise by selection, and earn the space

**Rule:** cut whole sentences that carry no instruction — preamble, restatement, closing summaries,
justification for a decision already taken. Never compress the sentences that remain: spell terms out
and keep the words that make a sentence readable. When in doubt, delete.

A remark a competent reader already knows, or that the code beside it states, is deleted rather than
shortened — a shortened one keeps the whole cost of being read and loses the evidence it was worth
cutting.

What earns the space differs by artifact. A page is opened deliberately, so it earns its place by
being worth opening once — maintenance, repository health and process documentation all qualify —
and length is never the finding: no page is deleted for being long. A
comment is read by everyone who touches that line whether they need it or not, so it earns its place
only by carrying what the source cannot (INC-1).

Any bound this standard sets is a ceiling, never a target. Writing to a cap produces prose sized by
the rule rather than by its content.

**Why:** length is not the constraint — readability is, and a small accurate corpus is one that can
be kept true. A page that is true, well shaped and correctly cited can still be worth nothing to
anyone, and no other rule here would say so.

**Exceptions:** never cut a caveat that changes what someone would do, the failure mode behind a
rule, or the reason a constraint exists.

**Enforced by:** unenforced — review judgment, and `/docs:audit`, where a deletion is proposed.

### COR-6 — Anchor every citation

**Rule:** a citation is a backticked `<path> :: <symbol>` or `<path> :: <short quoted fragment>`, a
bare backticked repository path, or a rule id or invariant id. Never a line number, in any form.

**Why:** an anchored citation is machine-checkable and survives every edit above it; a line number is
wrong the moment anything is inserted, and nothing can tell a correct one from a stale one.

**Enforced by:** gate checks `citation`, `path`, `rule-id` and `line-citation`.

**Example:** `<slice>/actions.ts :: <actionName>` — the file must exist, and the symbol must still
appear in it.

### COR-7 — Purpose first, and the index navigates

**Rule:** the first lines of a document state what question it answers. A chapter here navigates by
its rule table; any other reference longer than about a hundred lines — a page consulted at a point
rather than read through — carries a table of its sections against the question each answers.

**Why:** a page whose purpose has to be inferred gets read in full by people who did not need it, and
prose alone does not let a reader skip. A page meant to be read through has nowhere to skip to, so a
table over it is furniture.

**Exceptions:** a command file under `.claude/`, which is a script for one run, and a pass prompt
under `docs/_auditing/prompts/`, which carries one lens and is read in order. A reference living
beside the prompts — the shared protocol every pass reads — is not a prompt and stays in scope.

**Enforced by:** `/docs:audit` (the shape read).

### COR-8 — Structure for scanning

**Rule:**

- rules as lists, one rule per item — a sentence chaining independent rules with semicolons is a list
  that has not been written yet
- tables for anything enumerable, prose for anything needing a "because"
- bold the claim, never the paragraph
- headings state the rule, not the topic
- no nesting past three levels — deeper means the document needs splitting
- metadata lines each end with a hard break — a trailing backslash — when another follows, so they
  render one per line; the last carries none, having nothing to separate from

**Why:** a human reader wins on structure and an assistant wins on precision, and this shape gives
both.

**Enforced by:** gate check `metadata-break` for the hard breaks, in both directions. The rest is
`/docs:audit` (the shape read).

**Example:** "Name only what exists" is a heading; "Naming" is a topic.

### COR-10 — Generic examples in normative documents

**Rule:** a normative document — a chapter here, a template, the rules index, a command file — never
embeds a real path, symbol or value as an example. Examples use placeholders. Worked examples
anchored to real code belong in spec sheets and overviews, where the gate checks every citation. A
rule's own subject may be a real path: naming the script that enforces it is content, not an example.

**Why:** the gate skips placeholders, so a generic example can never rot and never forces a restamp;
a real example ties a normative page to that code's churn.

**Enforced by:** `/docs:audit` (the shape read).

**Example:** `<slice>/queries.ts :: <fn>` here; the same citation with real names in a spec sheet.

### COR-11 — The voice is mine

**Rule:** the words "the owner" appear in no tracked file outside `.claude/` — a `docs/` page, a
commit message and a source comment alike. Everything so written speaks in my own voice: first person
where a person acts, neutral imperative everywhere else. Files under `.claude/` are exempt, because
they instruct the assistant and naming me as a third party is what makes them unambiguous.

**Why:** this repository is me documenting my own project, and a third-person label for its author
reads as a second author who does not exist. The scope is every tracked file because a comment is
read as widely as a page, and a rule bounded by one directory leaves the rest unbound.

**Exceptions:** `.claude/`, the whole tree. Quoting the phrase to name what is banned — as this rule
does — is a mention, not a use.

**Enforced by:** gate check `owner-voice`, which reads a quoted or backticked occurrence as the
mention it is; `/docs:audit` for the third-person constructions that avoid the phrase.

**Example:** "Marking ready and merging are mine alone" — never "are the owner's".

### COR-12 — A defined shape is never widened

**Rule:** a file whose kind has a template or a defined structure never deviates from it. Never once,
never for one file, never by approval. Where a file does not fit, **the file changes**: the content
that does not fit moves to a page whose shape holds it, or it goes.

The shapes are fixed by a README's rule (OUT-3), a spec sheet's (OUT-4), an overview's (OUT-5), a
glossary entry's (OUT-6), a module header's (INC-2) and a rule's own (PRE-4). A template under
[`templates/`](../templates/) instantiates the shape its rule fixes; where the two disagree the rule
decides (PRE-2), and they are brought back into line in the same commit.

**Why:** the file that will not fit is almost always the one carrying content in the wrong place, and
the widening is the cheaper repair every time it is offered. Taken twice, the shape instantiates
nothing and every page becomes its own.

**Enforced by:** gate check `readme-cap` for a README's line cap; gate checks `spec-spine`,
`invariant-row`, `overview-spine`, `glossary-entry`, `module-header` and `rule-shape` for the shapes
they hold. A README's remaining shape is review judgment, as is whether a deviation was repaired by
moving the content or by widening the shape: both leave a green gate.
