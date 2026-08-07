# Decisions about the documentation standard

**Verified against:** `68ac42d`, 2026-08-07

`DS` decisions are about **how this repository is documented**, which is why they live here rather
than in `docs/_decisions/` alongside ADRs about the software itself. The same discipline applies:
**do not edit a decision's reasoning; supersede it.**

Each entry records what was decided, what forced the choice, and what was rejected. The rejected
alternatives are the part that stops a settled question being reopened.

**Correcting a broken pointer is not editing the reasoning.** Where an entry cites something that has
stopped resolving — a renamed file, a retired tracking id — the pointer is replaced by naming the
thing in words. The argument itself is never touched: if an argument was wrong, that is a new
decision that supersedes this one.

| #                                                                                           | Decision                                                       | Area |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---- |
| [DS1](#ds1--in-code-style-tiered)                                                           | In-code style: tiered                                          | code |
| [DS2](#ds2--module-header-h5-hybrid)                                                        | Module header: H5 hybrid                                       | code |
| [DS3](#ds3--coverage-headers-endpoints-surprises)                                           | Coverage: headers, endpoints, surprises                        | code |
| [DS4](#ds4--enforcement-a-narrow-ruff-d-subset-and-nothing-else)                            | Enforcement: narrow ruff `D` subset only                       | code |
| [DS5](#ds5--citations-adr-numbers)                                                          | Citations: ADR numbers                                         | code |
| [DS6](#ds6--docs-standard-adrs--spec-sheets--overviews)                                     | `/docs` standard: three layers                                 | docs |
| [DS7](#ds7--location-central-docs-per-surface)                                              | Location: central `/docs`, per surface                         | docs |
| [DS8](#ds8--currency-citations-and-the-same-commit-rule)                                    | Currency: citations and the same-commit rule                   | docs |
| [DS9](#ds9--claudemd-9-shrinks-to-a-pointer-table)                                          | CLAUDE.md §9 → pointer table                                   | docs |
| [DS10](#ds10--diagrams-mermaid-c4-levels-13)                                                | Diagrams: mermaid, C4 levels 1–3                               | docs |
| [DS11](#ds11--glossary-one-central-file)                                                    | Glossary: one central file                                     | docs |
| [DS12](#ds12--documents-are-self-contained-the-audit-is-never-the-substance)                | Documents are self-contained; the audit is never the substance | both |
| [DS13](#ds13--every-test-carries-a-sentence-saying-what-it-covers)                          | Every test carries a sentence saying what it covers            | code |
| [DS14](#ds14--documentation-names-only-what-exists)                                         | Documentation names only what exists                           | both |
| [DS15](#ds15--a-module-header-points-at-the-adr-it-does-not-restate-it)                     | A module header points at the ADR; it does not restate it      | code |
| [DS16](#ds16--documentation-is-written-for-a-reader-with-no-context)                        | Documentation is written for a reader with no context          | both |
| [DS17](#ds17--citations-are-anchored-never-line-numbers)                                    | Citations are anchored, never line numbers                     | both |
| [DS18](#ds18--currency-is-enforced-by-the-gate-not-by-diligence)                            | Currency is enforced by the gate, not by diligence             | both |
| [DS19](#ds19--the-standard-is-not-exempt-from-itself)                                       | The standard is not exempt from itself                         | docs |
| [DS20](#ds20--in-code-documentation-is-covered-by-the-same-currency-system)                 | In-code documentation is covered by the same currency system   | code |
| [DS21](#ds21--a-completed-programmes-report-is-a-record-and-records-may-use-the-past-tense) | A completed programme's report is a record                     | docs |

---

## DS1 — In-code style: tiered

**Decided:** 2026-08-01

**Decision.** Three altitudes: module header, symbol docs, inline comments. One hard rule — never
restate a type.

**Context.** Measured before deciding: the frontend already carried JSDoc blocks on roughly half its
files, while the backend documented its rationale almost entirely in `#` comments with very few
docstrings. The voice was already consistent on both sides. So the real question was not "pick a
style" but "what do the existing blocks become, and how does the backend catch up".

**Rejected.**

- _Full TSDoc / Google docstrings on every symbol._ Roughly three times the comment volume for the same
  two functions (49 comment lines against 17 in the sample), and most of the excess restates types the
  signature already gives. It also dilutes: the one critical sentence in a helper — the forfeit rule in
  `build_statistik_lookup_stage`, say — ends up under three sections of boilerplate. Half-filled
  `@param` lists are worse than none.
- _Minimal / self-documenting._ Never wrong, and discards exactly what nine remediation waves produced.
  Closed findings become re-breakable.
- _Current house style, unformalized._ About 90% right. The missing 10% is what makes a codebase hard
  to re-enter: no entry point per module, and "no comment" stays ambiguous between nothing-to-say and
  nobody-looked.

**Consequences.** Additive, not a migration — most existing blocks already qualify. The backend is the
larger gap, and it is the side carrying the harder invariants.

## DS2 — Module header: H5 hybrid

**Decided:** 2026-08-01

**Decision.** Labelled sections (`INVARIANTS`, `DECISIONS`, `SEE ALSO`) separated by horizontal rules,
drawn to a fixed column of 110.

**Context.** Chosen from five variants. Prose-only buried the invariants in paragraphs; labelled
sections alone were scannable but plain; ruled banners looked best but appeared to invite crooked
hand-drawn ASCII; compact lost the scannability the header exists for.

**Consequences.**

- The crookedness objection is defused by construction: the label vocabulary is **fixed**, so rule
  widths are a template that gets pasted, not arithmetic that gets redone.
- Prettier's `proseWrap: "preserve"` guarantees no reflow. Verified in `.prettierrc.json`.
- Python's docstring must be the **first statement** in the file. Below the imports it silently becomes
  a dead string expression, invisible to ruff, `help()` and editors.
- The full header is ~18 lines, so it **scales down**: drop sections with fewer than two entries; the
  header must not exceed about a third of the file.

**Amended 2026-08-01, on first contact with the tooling.** The original form opened with a full-width
rule above the title. Applying it to `fl_backend` immediately failed ruff's `D205`, and the rule was
right: the **first line of a docstring is what `help()`, `pydoc` and editor hovers display as the
summary**, so a row of dashes there is worse than no docstring at all. The same is true of a JSDoc
block's first line in a hover tooltip.

The shape is now **title, blank line, prose**, with the section rules (`INVARIANTS`, `SEE ALSO`)
carrying the visual separation. Both languages use it, so the two look alike.

A second constraint surfaced at the same time: a **directive** (`"use server"`, `"use client"`) stays
on the first line, with the header below it. The ECMAScript spec permits comments before a directive
prologue and bundlers generally accept them, but a mistake there fails at _request time_ rather than
build time — a failure mode this codebase has already been bitten by — and the ordering costs nothing.

## DS3 — Coverage: headers, endpoints, surprises

**Decided:** 2026-08-01

**Decision.** A missing docstring is a defect in exactly three places: every module, every FastAPI
endpoint, and anywhere with a _why_ worth recording. Everything else is judgement.

**Context.** FastAPI publishes an endpoint docstring as the operation `description` in
`/openapi.json`, and `summary=` as its title. Measured: `app = FastAPI(lifespan=lifespan)` sets no
title or description and no endpoint has a docstring, so `/openapi.json` carries no prose at all.

Routing detail that lowers the stakes: routers mount under `/api/v{n}/…` and nginx sends `/api` to
FastAPI, but FastAPI's own `/docs` and `/openapi.json` sit at the app root, which nginx sends to Next.
**The Swagger UI is not publicly reachable** — it is a development and in-network tool.

**Rejected.** _Every exported symbol._ Uniform and greppable, and guarantees filler on the many symbols
whose names already say everything.

## DS4 — Enforcement: a narrow ruff `D` subset, and nothing else

**Decided:** 2026-08-01

**Decision.** Add ruff `D` rules covering docstring **formatting** only. Exclude the `D1xx`
missing-docstring family. Do not add `eslint-plugin-jsdoc`.

The selected codes live in `fl_backend/pyproject.toml` under `[tool.ruff.lint]`. Read them there
rather than from a copy here — a restated tool configuration is one of the fastest things to go stale
(P4).

**Context.** Neither side enforces anything today: `pyproject.toml` selects `E, W, F, I, B` with
`ignore = ["B008"]`; `eslint.config.mjs` registers no JSDoc plugin.

**Rejected.** _`D103` / require-docstring rules._ They would manufacture precisely the boilerplate DS1
rejects. _`eslint-plugin-jsdoc`._ Its useful rules police `@param` completeness, which this standard
deliberately does not use.

**Consequences.** The load-bearing rule — never restate a type — is not machine-checkable and lives in
CLAUDE.md as a review judgement.

## DS5 — Citations: ADR numbers

**Decided:** 2026-08-01

**Decision.** Comments cite ADR numbers. Existing inline audit IDs (`D2`, `R3b-S9.1b`, `R4 §6.3`,
`§9 A7`) get rewritten during the ADR extraction.

**Context.** A citation into a working document is load-bearing while it resolves — it is how a reader
finds the reasoning — and dangles the moment that document is archived, renumbered or deleted.
`docs/audit/` is deleted by design at the end of every audit programme, so every citation into it has
a known expiry date.

**Consequences.** Ordering constraint: **only cite an ADR that exists**, and never invent a number to
fill a gap. Writing the ADR is therefore part of the change that cites it, and the documentation gate
fails on a citation resolving to no file.

## DS6 — `/docs` standard: ADRs + spec sheets + overviews

**Decided:** 2026-08-01

**Decision.** Three layers with three different update triggers: an append-only ADR log, spec sheets
with cited invariants, and short narrative overviews (~120 lines). Plus a glossary.

**Context.** Four full samples were written on the same subject. The deciding property was how each
ages when neglected for a year: Diátaxis leaves the reference current and the tutorial stale, which is
the worst state because you cannot tell which half to trust; narrative goes quietly, confidently wrong
in a way that reads well; spec sheets fail detectably (grep the cited line); ADRs do not go stale at
all, because they record what was decided _then_.

**Rejected.**

- _Diátaxis._ The four-way split costs discipline on every write, forever, for a benefit that mostly
  accrues to multi-author teams with a review process. Its how-to content survives as a section inside
  a spec sheet.
- _Spec sheets alone._ Rules without reasons get "cleaned up" by the next reader, or by an assistant.
- _ADRs alone._ They answer why and nothing else — no contract, no usage.
- _Narrative alone._ Cannot be patched: one wrong paragraph means rewriting the section, so it gets
  rewritten yearly or never.

**Consequences.** The ADR layer recovers reasoning that would otherwise stay trapped in working
documents too large to load and slated for deletion. That recovery is transcription rather than
invention, which is what makes it cheap relative to its value.

## DS7 — Location: central `/docs`, per surface

**Decided:** 2026-08-01

**Decision.** Everything under `/docs`, organised as frontend / backend / ops. Per-slice pages only
where a slice deviates from the template. No per-file documentation.

**Context.** The in-code decisions (DS1–DS2) put per-file documentation in module headers, so a
colocated README layer would duplicate it.

**Rejected.** _A page per slice_ — one more file per slice that can go stale, most of them saying
"follows the template". _Colocated READMEs_ — scatters cross-cutting material and leaves ops,
glossary and ADRs homeless. _Central plus colocated stubs_ — the module headers already provide
discoverability from the code.

## DS8 — Currency: citations and the same-commit rule

**Decided:** 2026-08-01

**Decision.** Every claim cites its source; every page that describes current state carries a
`Verified against` line; a change that invalidates a claim updates the doc **in the same commit**.

Superseded in two respects by later decisions, which sharpened rather than reversed it:
[DS17](#ds17--citations-are-anchored-never-line-numbers) fixes the citation form, and
[DS18](#ds18--currency-is-enforced-by-the-gate-not-by-diligence) makes the whole thing mechanical.

**Amended:** the stamp is scoped to pages describing current state. **ADRs are exempt and must stay
exempt** — an ADR is dated to when the decision was taken, so a "verified against" line would imply a
re-check that by design never happens.

The exemption once extended to `_standard/` as well, on the reasoning that it defines rules rather
than describing code. [DS19](#ds19--the-standard-is-not-exempt-from-itself) removes that: the standard
does make claims about current state, and exempting it is why it drifted.

**Rejected.** _Verified-against stamps alone_ — staleness becomes visible but nothing obliges a fix.
_Periodic re-verification passes_ — realistic only if the pass actually gets run, and with one
maintainer it does not.

**Consequences.** The same-commit rule goes into CLAUDE.md, where it is enforceable. Everything else is
convention.

## DS9 — CLAUDE.md §9 shrinks to a pointer table

**Decided:** 2026-08-01

**Decision.** Each of the eight ratified decisions becomes one imperative line plus its ADR number. The
argument moves into the ADR.

**Context.** CLAUDE.md is loaded into every assistant session, so its length is a running cost. §9
currently carries eight full arguments — the largest section in the file.

**Rejected.** _Keep §9 verbatim with ADRs mirroring it_ — two copies of eight arguments that must be
edited together, which is the exact drift ADRs exist to remove. _Move §9 out entirely_ — an assistant
that does not open the folder loses the "do not fix this" warning §9 exists to give.

**Consequences.** A consistency rule must be recorded in CLAUDE.md itself: **if CLAUDE.md and an ADR
disagree, the ADR is the source and CLAUDE.md is the summary.** Without it, the pointer table can drift
from what it points at.

## DS10 — Diagrams: mermaid, C4 levels 1–3

**Decided:** 2026-08-01

**Decision.** Mermaid, so diagrams render in-repo without a build step. C4 levels 1–3 (context,
container, component) only. Diagrams live in surface overviews, and in a spec sheet where a data flow
is genuinely hard in prose. Not in ADRs.

**Rejected.** _C4 level 4 (code diagrams)._ They duplicate the source and rot immediately. Code layout
goes in the spec sheet as a directory tree, which is cheap to keep right.

**Consequences.** A `sequenceDiagram` earns its place where ordering carries meaning — the Spiel write
path, where the backend read returns the **pre-write** document and that is the source of the
statistics delta, is the motivating case. Practical note: avoid square brackets inside quoted mermaid
node labels, as some renderers choke on them.

## DS11 — Glossary: one central file

**Decided:** 2026-08-01

**Decision.** `docs/glossary.md`. One entry per term: the German word, a one-line English gloss, where
it lives in code, and the pitfalls.

**Context.** The German domain vocabulary (Spiel, Spieltag, Saison, Schiedsrichter, Spielort, Gruppe,
Tore) is load-bearing, and parts of it are ambiguous in ways only the maintainer currently knows.

**Consequences.** Ranked second in value after the ADR extraction. The motivating example:
`saison_phase` has four stored values, but `"playoffs"` — which appears throughout the query layer — is
**not** one of them; it is a query-only alias compiled to `saison_phase != "gruppenphase"` and never
appears on a stored document. That costs an hour to rediscover and thirty seconds to write down.

## DS12 — Documents are self-contained; the audit is never the substance

**Decided:** 2026-08-01

**Decision.** No document — in code or in `/docs` — may carry a reference to `docs/audit/` as the
substance of a claim. Where the audit settled a question, the reasoning is **written out in full**, in
the document's own words.

Audit references survive in exactly one role: **provenance**, as a `Source:` line on an extracted ADR
recording where a decision originally came from.

**Context.** `docs/audit/` is expected to be deleted. Six files, ~1.4 MB, whose value is being
transferred into ADRs. Any document that says "see R3a §A1.4" instead of stating the reasoning becomes
hollow the day the audit goes — and the failure is silent, because the sentence still reads as though it
means something.

This reverses the original programme instruction ("where the audit already settled a question, cite it
instead of re-deriving it"), which assumed the audit was permanent.

**Consequences.**

- Phase 2 documents are longer than they would otherwise be, and that is the cost being accepted on
  purpose: self-containment is worth more than brevity here.
- **Nothing may be deleted until its reasoning exists somewhere self-contained.** Recording a
  decision in an ADR is a prerequisite for retiring the working document it came from, not a
  follow-up to it.
- The same rule governs cross-references inside `/docs`: a spec sheet states its invariant in full and
  cites the ADR for the argument. It never substitutes the citation for the statement.
- Consistent with DS5, which had already banned audit IDs from code comments for the same reason.

## DS13 — Every test carries a sentence saying what it covers

**Decided:** 2026-08-01

**Decision.** Every test function gets a docstring: normally one sentence, occasionally a short block
where the reason it exists is not obvious. This applies to both suites.

**The sentence must say what is COVERED — never paraphrase the function name.** The name already
says `test_rejects_a_malformed_email`. Restating that adds a line and no information. The docstring's
job is the part the name cannot carry:

```python
@pytest.mark.parametrize("email", ["not-an-email", "@example.com", "a@", "a@b", "a b@example.com"])
def test_rejects_a_malformed_email(kontakt, email):
    """Five near-misses, including `a@b` — a shape a naive "contains @" check would let through."""
```

Useful things for it to say, in rough order of value:

- **What the parametrised cases actually span**, and which one is the interesting one. A reader
  scanning a list of five strings cannot tell which is load-bearing.
- **The failure it guards against**, where the test exists because something once broke.
- **Why a case that looks redundant is not** — `00000` for a postcode, `0` for a version number.

**Context.** All 102 backend test functions had a descriptive name and no docstring. The names are
good, which is exactly why the gap was easy to miss: they say what the test is _called_, and a reader
deciding whether a change is safe needs to know what it _covers_. With parametrised cases the gap is
widest — a list of five strings carries no explanation of what each one probes.

**Consequences.**

- A test whose docstring can only restate its name is a signal, not a formatting problem: either the
  name is vague, or the test is not pinning anything a reader would doubt.
- Ruff's `D` subset (DS4) applies to these docstrings like any other, so `D200` keeps one-liners on one
  line.
- **`conftest.py` fixtures are out of scope** — they are documented where the shared helper deserves
  it, not per fixture.

**The rule is about the sentence, not the mechanism.** How it is satisfied differs by language:

- **Python / pytest** — a docstring, because `def test_rejects_a_malformed_email(...)` has nowhere else
  to put a sentence. All 102 backend tests now carry one.
- **TypeScript / `node:test`** — **the `it("…")` string already is the sentence**, and the existing ones
  are full descriptive clauses: _"rejects the script-bearing schemes that z.url() lets through"_,
  _"reports a cancelled match only as cancelled, however incomplete it is"_. All 83 frontend tests
  already satisfy this, and adding a comment above each would be exactly the restatement the rule
  forbids.

Where a frontend test needs more than its name can carry, the existing convention already covers it: a
`//` comment above the `it()`, as on _"does not mutate the input array"_ — "the function spreads before
sorting; callers rely on that to sort cached query results."

**Rejected.** _Rely on the test names alone, in both languages._ In TypeScript that is precisely what the
`it()` string does, and it works. In Python the names are genuinely good and still cannot express which
of five parametrised inputs is the one that used to break, or that an assertion covers a regression
rather than a general property.

## DS14 — Documentation names only what exists

**Decided:** 2026-08-02

**Decision.** No document — a module header, a symbol docstring, an inline comment, a spec sheet, an
overview — may refer to a file, symbol, field, endpoint or behaviour that is not in the repository at
the moment of writing. Two shapes are banned by name:

- **Narrating an edit.** "Moved here from the former `app/api/admin/router.py`", "previously a
  defaultdict", "this was reverted", "`statistik` was unset from all 17 rows on 2026-08-02".
- **Documenting an absence for its own sake.** A paragraph explaining that a `compact` variant is gone
  is a paragraph about something a reader cannot see, in a file they are reading to learn what it does.

**A rejected alternative is not an absence, and stays.** The distinction is grammatical and it is the
whole rule: write the constraint in the **present**, aimed at the reader who is about to violate it.

| ❌ History                                                   | ✅ Constraint                                                                          |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| "A `compact` variant used to branch here and was removed"    | "Never branch a reduced variant off it: measured 2026-08-02, the trim is 26 KiB and …" |
| "Previously a defaultdict was filled from the teams present" | "Never build it from the teams present alone: a season with nobody in group D …"       |
| "Moved here from the former `app/api/admin/router.py`"       | "Every mutation sits beside the reads for the resource it changes (ADR-0034)"          |

Present tense keeps the sentence useful when the alternative is proposed again — which is the only
moment it is read — and it cannot go stale, because it describes a rule rather than an event.

**Context.** The repository already had the code half of this rule in CLAUDE.md §10 ("comments describe
what the code IS, never what it WAS"). It was written for comments and applied to nothing else, and a
session that had read it still wrote three headers in the banned shape. Recording it here makes it a
standard decision that governs `/docs` as well, which is where the same failure is more expensive: a
spec sheet naming a deleted endpoint reads exactly like one naming a live endpoint.

**Consequences.**

- **A date measured is not history.** "Measured 2026-08-02, zero drift across all 31 matches" is a
  present-tense fact with provenance and it stays. What is banned is the _change_, not the _timestamp_.
- The git history is where an edit is recorded, and an ADR is where the argument for it is recorded.
  Neither job belongs to a file the change happened to touch.
- **Three places exist to record what changed, and this rule does not reach into them.** An ADR's
  **Context** section, which has to describe the state the decision replaced or the decision is
  unreadable; [`../roadmap/closed-items.md`](../roadmap/closed-items.md), whose rows are past-tense by
  construction; and an ADR's `Superseded by` line. An ADR's **Decision** and **Consequences** are
  present tense like any other document.
- **Enforceable by grep, not by a tool.** `former`, `used to`, `was removed`, `no longer`, `previously`,
  `moved here` over a branch diff finds nearly all of it. Reading the hits is required — "the former …
  the latter" is ordinary English and `there is no X, because Y` is a constraint.

**Rejected.** _Allow a short migration note for one release._ There is no release boundary in this
repository at which someone would come back and delete it, so "temporary" means permanent.

## DS15 — A module header points at the ADR; it does not restate it

**Decided:** 2026-08-02

**Decision.** Where reasoning is long enough to need its own paragraph and governs more than the file it
sits in, the header states the **rule in one or two lines** and cites the ADR. The argument — the
context, the alternatives, the measurements — lives in the ADR and nowhere else.

The working threshold, deliberately rough because judgement is the point: **a header section running
past about five lines, or repeated in a second file, is an ADR that has not been written yet.** Two
files carrying the same three-paragraph explanation is the clearest signal there is.

```python
#  ❌  a section arguing why the `saisons` path segment is acceptable, twice, in two admin routers
#  ✅  • `/teams/{team_id}/saisons/{saison_id}` addresses a JUNCTION ROW, not a season document. A GET
#         added here must return junction rows (ADR-0034).
```

**Context.** This is DS5 and DS12 meeting each other. DS5 already required citing ADR numbers; DS12
required that a document state its claim in full rather than substitute a citation for it. Read
together they were taken to mean "state everything, and also cite" — so the header restated the ADR.
The resolution is that the two rules are about different things: **the claim** must be stated in full,
**the argument** must be cited. A header says _what is true here_; an ADR says _why, and what was
rejected_.

**Consequences.**

- **The ADR has to exist first.** DS5 permits citing only an ADR that exists, so writing one is part of
  the change rather than a follow-up — which is the same rule `/roadmap:start` already applies to a
  decision taken during an item.
- `SEE ALSO` is the section for this. `INVARIANTS` holds the one-line rules; `DECISIONS` holds bare ADR
  numbers with a half-line gloss; `SEE ALSO` points onward.
- **The header still has to be self-contained enough to act on.** A reader who never opens the ADR must
  still know not to violate the rule. What they lose by not opening it is _why_, never _what_.

**Rejected.** _Keep the reasoning in the header and let the ADR be the formal copy._ That is two copies
of an argument with two different update triggers, and the header is the one nobody revisits — so it is
the one that goes stale, in the file a reader trusts most because it is next to the code.

## DS16 — Documentation is written for a reader with no context

**Decided:** 2026-08-04

**Decision.** Every document must be fully understandable to someone encountering the repository for
the first time: no reference to a conversation, a working session, a past effort, or an identifier
that does not resolve to something tracked in the repository. Where the lesson behind such a
reference is worth keeping, it is **restated as a rule in the present** rather than told as an
account.

Recorded as [P1](1-principles.md#p1--write-for-a-reader-who-has-no-context).

**Context.** Documentation written during a working session inherits that session's context for free,
so its author cannot feel what is missing. Reviewing the repository's process documentation against
an outside reader found the failure throughout: references to programmes a reader cannot see,
identifiers pointing at deleted files, and in one case a guide that spent half its length arguing for
a decision the repository had already taken and implemented.

**A dangling identifier is worse than no citation**, because it still reads as though it means
something. A reader cannot distinguish a pointer to a deleted tracking document from one to a live
tracked item, so they either waste time searching or silently lose the reasoning.

**Consequences.**

- A lesson learned from a specific incident survives as a rule; the incident does not.
- An identifier may be cited only when it resolves to something tracked: an ADR number, a roadmap id,
  a file path, a commit. This is checkable, and DS18 checks it.
- Persuasion belongs in an ADR's `Alternatives considered`, which is where a settled argument is
  recorded once. Reference documentation states the rule and moves on.

**Rejected.** _Allow session references where they add colour._ The colour is invisible to the only
reader who matters — the one who was not there — and it reads to them as a missing prerequisite.

## DS17 — Citations are anchored, never line numbers

**Decided:** 2026-08-04

**Decision.** A claim cites a file plus a **symbol** or a short **quoted fragment**, an ADR number, or
a bare file path. **Never a line number.**

Recorded as [P6](1-principles.md#p6--anchor-a-citation-to-something-that-survives-an-edit).

**Context.** The standard previously mandated file-and-line citations for every spec-sheet claim. A
line number is wrong the moment anything is inserted above it, which happens on almost every commit
to the file, and nothing anywhere detects it. So the citation form intended to make claims checkable
was instead the fastest-rotting content in `/docs`.

**Consequences.**

- Anchored citations survive edits above them and break only when the thing cited actually changes,
  which is exactly when a claim should be re-examined.
- They are **machine-checkable**: the file must exist and the symbol or fragment must appear in it.
  This is what makes DS18 possible; with line numbers there is nothing to check against.
- Existing line-number citations are converted as the pages carrying them are next touched, rather
  than in one sweep — a mass edit of every spec sheet is a large diff with no behavioural content and
  a high chance of introducing errors of its own.

**Rejected.** _Keep line numbers and regenerate them with a script._ It would have to parse prose to
know what each citation meant, and a wrong regeneration is silent. _Drop citations entirely._ They
are what separates a spec sheet from confident prose.

## DS18 — Currency is enforced by the gate, not by diligence

**Decided:** 2026-08-04

**Decision.** Documentation currency rests on four defences, of which one is mechanical: anchored
citations at write time, the same-commit rule at change time, **a documentation check inside
`./scripts/verify.sh`**, and a close-out question before every pull request.

It is implemented as `scripts/check_docs.py` and run by `scripts/verify.sh`. The check list, the
reasoning for which findings fail and which only report, and the four scanning rules that keep it
quiet are recorded in [`5-currency.md`](5-currency.md).

**Enforcement is scoped rather than repo-wide from day one.** Failures fail the run only inside the
paths the script lists; elsewhere they are counted and reported. Adopting the standard folder by
folder means a repo-wide hard failure would have to be suppressed until every folder conformed, and a
suppressed check is worse than none. Widening the scope belongs in the commit that makes a folder
conform, so the two never separate.

**Context.** The previous currency rule had four parts, of which three depended on someone
remembering and one depended on a tracking document that has since been deleted. The one genuinely
load-bearing part — the same-commit rule — is sound but unenforceable by itself, and the
`Verified against` stamp was never validated against anything, so a stamp could be written without
the check it claims to record having happened.

Evidence that diligence alone does not hold comes from this folder itself, which had been
maintained by diligence and nothing else. Its chapters had accumulated references to deleted files,
an index that had fallen behind the entries it indexed, a claim that a body of documents did not
exist when it did, and a tool configuration described as proposed long after it was applied. Each
was written by someone who cared about the standard, and none of them was noticed by reading.

**Consequences.**

- Writing an ADR becomes part of the change that cites it rather than a follow-up, because the gate
  fails on a citation to a file that is not there.
- The two reporting checks are deliberately not failures. A cited file changing does not prove a claim
  wrong, and the history phrases match ordinary English. **A check that cries wolf gets suppressed**,
  and a suppressed check is worse than none.
- The check lives inside `verify.sh` rather than beside it, so no session and no person has to be told
  it exists.

**Rejected.** _A scheduled documentation review._ Realistic only if it runs; with one maintainer it
does not. _A coverage percentage._ It would manufacture filler on symbols whose names already say
everything, which DS3 and DS4 exist to prevent. _Failing the gate when a cited file changes._ Most
such changes leave the claim true, so the check would fire constantly and be turned off.

## DS19 — The standard is not exempt from itself

**Decided:** 2026-08-04

**Decision.** `_standard/` carries `Verified against` stamps and obeys every principle it defines,
including those about naming only what exists and writing for a reader with no context.

**Context.** The standard previously exempted itself on the grounds that it defines rules rather than
describing code. The exemption is why it drifted. Every failure class the standard warns about had
appeared in it: pointers into a deleted document, an index behind its own contents, a body of
documents described as not yet existing after they were written, and a tool configuration recorded
as proposed after it had been applied.

The reasoning behind the exemption was wrong in a specific way: the standard **does** describe current
state. "These lint rules are selected", "these documents exist", "this is tracked there" are all
claims about the repository, and they go stale exactly like any other.

**Consequences.**

- The chapters state rules and cite configuration rather than restating it, so most of what could go
  stale is removed at the source rather than tracked.
- Where a chapter must describe current state, it is stamped and the gate checks the stamp.
- The exemption survives in one place only: **an ADR carries no stamp**, because it is dated to when
  its decision was taken and a stamp would imply a re-check that by design never happens.

**Rejected.** _Keep the exemption and review the standard manually._ That is the arrangement that
produced the drift being fixed.

## DS20 — In-code documentation is covered by the same currency system

**Decided:** 2026-08-04

**Decision.** A comment is documentation, so every currency mechanism applies to it. The
documentation gate scans the **comments** of every tracked `.ts`, `.tsx`, `.js`, `.mjs`, `.cjs` and
`.py` file for the same citations it checks in `/docs`: ADR numbers and anchored
`<file> :: <anchor>` references.

Executable code is not scanned. A path-shaped string in a function body is data the program uses, not
a claim made to a reader, and checking it would report the program's own behaviour as a defect.

**Context.** The gate scanned markdown only, so the citations carried by source comments — which are
where most of this repository's reasoning lives — were the one class of reference nothing verified.
That is the wrong way round: a comment citing a decision sits next to the code a reader trusts most,
so a dangling number there misleads more effectively than the same number in a document.

The other three currency defences already covered comments in principle. The same-commit rule and the
close-out question do not care which file a claim lives in, and P3 has always governed comments. Only
the mechanical defence had a gap, and a defence with a gap that size is the one people rely on.

**Consequences.**

- Deleting or renumbering an ADR now fails the gate if any comment still cites it, which is what
  makes DS5's cite-by-number rule safe to depend on.
- A comment may use the anchored citation form, and gets the same guarantee a spec sheet does.
- Comment extraction is deliberately simple — line comments, block comments and docstrings, tracked
  across lines. It does not parse either language. A string containing `//` is harmless because link
  checking ignores http and https anyway, and no other check reads a bare string.

**Rejected.** _Scan whole source files rather than comments only._ Every path constant and every
route string in the codebase would be read as a citation, and the noise would force the check off.
_Leave comments to review._ That is the arrangement that left them unchecked.

## DS21 — A completed programme's report is a record, and records may use the past tense

**Decided:** 2026-08-04

**Decision.** P3's ban on naming what does not exist does not reach a document whose subject **is**
what happened. Four places are exempt, and only within their stated job: an ADR's `Context`, an ADR's
`Superseded by`, `roadmap/closed-items.md`, and a final report in `_auditing/reports/`.

Everything else — including an ADR's `Decision` and `Consequences`, and every other section of a
final report — is present tense like any other document.

**Context.** A final report is the permanent account of a completed programme. Its whole purpose is
to record what was wrong, what changed and what it cost, so a rule requiring it to describe only what
exists now would make it unwritable. The exemption was implicit and therefore unreliable: the
history-phrase sweep flagged a final report on every run, and a check that always fires on a
compliant document trains its reader to ignore it.

**Consequences.**

- The exempt list is closed. A document that finds itself wanting past tense and is not on it is a
  document in the wrong shape, and the fix is to move the content to one that is.
- The sweep excludes the four, so a hit anywhere else is worth reading.

**Rejected.** _Let any document narrate history where it seems useful._ That is the rule P3 replaced,
and the reason it exists.

## DS22 — A claimed mechanism is demonstrated failing on what it claims to prevent

**Decided:** 2026-08-04

**Decision.** When this standard says something is enforced, the enforcement is demonstrated failing
**on the defect the claim names** — not merely on the defect the implementation happens to check.
The demonstration is part of the change that makes the claim, and it is recorded with it.

**Context.** Two claims in this standard were hollow at the moment they were written, and both
survived a review that was looking for exactly that.

The currency claim said the gate enforces that pages stay current. What was built checks that a
`Verified against` SHA is a real ancestor of `HEAD` — which detects a **forged** stamp and says
nothing about a **stale** one. An old but genuine SHA passes forever. The check was tested against a
fabricated SHA, it failed as designed, and the gap stayed invisible because the test was written from
the implementation rather than from the claim.

The citation claim said line numbers are banned. Nothing detected one. Six had already been found by
hand, every one of them pointing at the wrong line, and the gate that shipped afterwards would have
found none of them.

The common cause is not carelessness. **An author testing their own mechanism writes the test from
what they built**, because that is what is in mind; the claim is a sentence written earlier, and the
distance between the two is invisible from the inside. A rule is needed precisely because attention
does not cover it.

**Consequences.**

- The demonstration is a specific artefact: a fixture exhibiting the named defect, and evidence the
  check fails on it. "The check passes on the current tree" is not evidence of anything.
- It applies to every enforcement claim, including one whose mechanism is a human step. Where a claim
  cannot be demonstrated, it is downgraded to a convention **in the text**, so nobody relies on it.
- This is the same rule an audit wave applies to a guardrail, for the same reason: a control never
  shown to fail on its target is an untested assertion.

**Rejected.** _Rely on review to notice the gap._ Both hollow claims were reviewed, by an author
looking for design flaws, and both survived. Review is what produced the gap, so review cannot be the
control for it.
