# Decisions about the documentation standard

Thirteen decisions, all taken **2026-08-01** by the owner, choosing from worked samples written against
real repo code. The samples were disposable and have been deleted as planned, so the rationale — and
critically, the **rejected** alternatives — are recorded here.

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
  signature already gives. It also dilutes: the one critical sentence in `get_stats_contribution` ends
  up under three sections of boilerplate. Half-filled `@param` lists are worse than none.
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
