# Decisions about the documentation standard

Fifteen decisions. DS1–DS13 were taken **2026-08-01** by the owner, choosing from worked samples
written against real repo code; the samples were disposable and have been deleted as planned, so the
rationale — and critically, the **rejected** alternatives — are recorded here. DS14 and DS15 were taken
**2026-08-02**, after a session's own documentation broke both of them.

These are `DS` (documentation standard) decisions. They are _about how the repo is documented_, which
is why they live here rather than in `docs/_decisions/` alongside ADRs about the software itself. Same
discipline applies: **do not edit a decision's reasoning; supersede it.**

| #                                                                            | Decision                                                       | Area |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------- | ---- |
| [DS1](#ds1--in-code-style-tiered)                                            | In-code style: tiered                                          | code |
| [DS2](#ds2--module-header-h5-hybrid)                                         | Module header: H5 hybrid                                       | code |
| [DS3](#ds3--coverage-headers--endpoints--surprises)                          | Coverage: headers, endpoints, surprises                        | code |
| [DS4](#ds4--enforcement-a-narrow-ruff-d-subset-and-nothing-else)             | Enforcement: narrow ruff `D` subset only                       | code |
| [DS5](#ds5--citations-adr-numbers)                                           | Citations: ADR numbers                                         | code |
| [DS6](#ds6--docs-standard-adrs--spec-sheets--overviews)                      | `/docs` standard: three layers                                 | docs |
| [DS7](#ds7--location-central-docs-per-surface)                               | Location: central `/docs`, per surface                         | docs |
| [DS8](#ds8--currency-citations--same-commit-rule--ledger)                    | Currency: citations, same-commit rule, ledger                  | docs |
| [DS9](#ds9--claudemd-9-shrinks-to-a-pointer-table)                           | CLAUDE.md §9 → pointer table                                   | docs |
| [DS10](#ds10--diagrams-mermaid-c4-levels-13)                                 | Diagrams: mermaid, C4 levels 1–3                               | docs |
| [DS11](#ds11--glossary-one-central-file)                                     | Glossary: one central file                                     | docs |
| [DS12](#ds12--documents-are-self-contained-the-audit-is-never-the-substance) | Documents are self-contained; the audit is never the substance | both |
| [DS13](#ds13--every-test-carries-a-sentence-saying-what-it-covers)           | Every test carries a sentence saying what it covers            | code |
| [DS14](#ds14--documentation-names-only-what-exists)                          | Documentation names only what exists                           | both |
| [DS15](#ds15--a-module-header-points-at-the-adr-it-does-not-restate-it)      | A module header points at the ADR; it does not restate it      | code |

---

## DS1 — In-code style: tiered

**Decision.** Three altitudes: module header, symbol docs, inline comments. One hard rule — never
restate a type.

**Context.** Measured before deciding: the frontend carried **199** JSDoc blocks across **93 of 216**
files; the backend **13** triple-quoted strings across **6** files, using `#` comments for rationale
instead. The voice was already consistent on both sides. So the real question was not "pick a style"
but "what do the existing 199 blocks become, and how does the backend catch up".

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

**Decision.** Add ruff `D` rules covering docstring **formatting** only. Exclude the `D1xx`
missing-docstring family. Do not add `eslint-plugin-jsdoc`.

Proposed starting set: `D200`, `D205`, `D209`, `D210`, `D419` — **exact codes to be confirmed when the
config is applied** (ledger P2-8). They are proposed here, not verified.

**Context.** Neither side enforces anything today: `pyproject.toml` selects `E, W, F, I, B` with
`ignore = ["B008"]`; `eslint.config.mjs` registers no JSDoc plugin.

**Rejected.** _`D103` / require-docstring rules._ They would manufacture precisely the boilerplate DS1
rejects. _`eslint-plugin-jsdoc`._ Its useful rules police `@param` completeness, which this standard
deliberately does not use.

**Consequences.** The load-bearing rule — never restate a type — is not machine-checkable and lives in
CLAUDE.md §1 as a review judgement.

## DS5 — Citations: ADR numbers

**Decision.** Comments cite ADR numbers. Existing inline audit IDs (`D2`, `R3b-S9.1b`, `R4 §6.3`,
`§9 A7`) get rewritten during the ADR extraction.

**Context.** Inline audit citations are common in the current code and are load-bearing — they are how
a reader finds the reasoning. They dangle the moment `docs/audit/` is archived, renumbered or
superseded, which is a live possibility (ledger P3-5).

**Consequences.** Ordering constraint: **only cite an ADR that exists.** The rewrite (P2-9) depends on
the extraction (P3-1). Until then, existing audit IDs stay as they are rather than being replaced with
invented numbers.

## DS6 — `/docs` standard: ADRs + spec sheets + overviews

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

**Consequences.** The ADR layer is disproportionately valuable here because roughly fifteen ADRs already
exist in argued form, trapped in a 298 KB ledger and a 277 KB report file that cannot practically be
loaded. Extraction is mostly transcription.

## DS7 — Location: central `/docs`, per surface

**Decision.** Everything under `/docs`, organised as frontend / backend / ops. Per-slice pages only
where a slice deviates from the template. No per-file documentation.

**Context.** The in-code decisions (DS1–DS2) put per-file documentation in module headers, so a
colocated README layer would duplicate it.

**Rejected.** _Per-slice pages for all twelve slices_ — twelve more files that can go stale, most
saying "follows the template". _Colocated READMEs_ — scatters cross-cutting material and leaves ops,
glossary and ADRs homeless. _Central plus colocated stubs_ — the module headers already provide
discoverability from the code.

## DS8 — Currency: citations + same-commit rule + ledger

**Decision.** Every claim cites a file/line or an ADR; every page **that describes current state**
carries a `Verified against <commit>` line; a change that invalidates a claim updates the doc **in the
same commit**; the ledger tracks coverage and staleness.

**Amended 2026-08-01**, on the first consistency pass: the stamp is scoped to pages describing current
state. ADRs are exempt and must stay exempt — an ADR is dated to when the decision was taken, so a
"verified against" line would imply a re-check that by design never happens. `_standard/` and the ledger
are exempt for the same kind of reason: they define the standard and track the work, rather than
describing the code.

**Rejected.** _Verified-against stamps alone_ — staleness becomes visible but nothing obliges a fix.
_Periodic re-verification passes_ — realistic only if the pass actually gets run, and with one
maintainer it does not.

**Consequences.** The same-commit rule goes into CLAUDE.md, where it is enforceable. Everything else is
convention.

## DS9 — CLAUDE.md §9 shrinks to a pointer table

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

**Decision.** `docs/glossary.md`. One entry per term: the German word, a one-line English gloss, where
it lives in code, and the pitfalls.

**Context.** The German domain vocabulary (Spiel, Spieltag, Saison, Schiedsrichter, Spielort, Gruppe,
Tore) is load-bearing, and parts of it are ambiguous in ways only the maintainer currently knows.

**Consequences.** Ranked second in value after the ADR extraction. The motivating example:
`saison_phase` has four stored values, but `"playoffs"` — which appears throughout the query layer — is
**not** one of them; it is a query-only alias compiled to `saison_phase != "gruppenphase"` and never
appears on a stored document. That costs an hour to rediscover and thirty seconds to write down.

## DS12 — Documents are self-contained; the audit is never the substance

**Decided 2026-08-01**, amending the programme's original instruction to cite the audit rather than
re-derive settled questions.

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
- **Raises the stakes on the ADR extraction (P3-1).** It is no longer merely the highest-value item —
  it is a **prerequisite for deleting the audit at all**. Nothing may be deleted until its reasoning
  exists somewhere self-contained.
- The same rule governs cross-references inside `/docs`: a spec sheet states its invariant in full and
  cites the ADR for the argument. It never substitutes the citation for the statement.
- Consistent with DS5, which had already banned audit IDs from code comments for the same reason.

## DS13 — Every test carries a sentence saying what it covers

**Decided 2026-08-01.**

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

**Decided 2026-08-02** by the owner, after a backend session left three module headers explaining where
their endpoints had moved from.

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

**Decided 2026-08-02** by the owner, in the same session and for the same reason: two module headers had
each grown a two-hundred-word section arguing a decision that was about to become an ADR.

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
