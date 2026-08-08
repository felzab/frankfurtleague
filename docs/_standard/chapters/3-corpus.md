# The documentation corpus

**Verified against:** `09f903d`, 2026-08-08\
**Applies to:** the `docs/` tree — its layers, its layout, and every README in the repository.

| ID    | Rule                                |
| ----- | ----------------------------------- |
| OUT-1 | Three layers, three update triggers |
| OUT-2 | The folder layout                   |
| OUT-3 | A README is orientation only        |
| OUT-4 | The spec-sheet spine                |
| OUT-5 | The overview spine                  |
| OUT-6 | The glossary                        |
| OUT-7 | Diagrams                            |
| OUT-8 | The surface                         |
| OUT-9 | The word is layer                   |

---

### OUT-1 — Three layers, three update triggers

**Rule:** `docs/` holds three layers:

- the ADR log — why it is like this; append-only, reversal is a new number
- the spec sheets — the current contract; edited when a constraint changes
- the surface overviews — what a surface is for; rewritten only when that changes

A new page is one of the three, or one of the named exceptions, or it does not go in.

**Why:** each layer's update trigger is attached to work that happens anyway, which is what lets
the corpus stay true without a scheduled review.

**Exceptions:** the cross-cutting root files (OUT-8), the process folders (`docs/_standard/`,
`docs/_auditing/`, `docs/workflows/`, `docs/roadmap/`), and `docs/domain.md` — a narrative over
tables a test walks, so its claims are checked rather than reviewed (ADR-0066).

**Enforced by:** unenforced — review judgment.

**Example:** —

### OUT-2 — The folder layout

**Rule:** one directory per surface, each holding that surface's overview and spec. A directory
holds a collection; a single cross-cutting reference lives at the root as a file until two or
three share a theme. The underscore prefix marks the cross-cutting meta collections
(`docs/_standard/`, `docs/_decisions/`) so they sort above the surfaces and never read as a fourth
one. The ADR log stays one flat, globally numbered folder, browsed by surface through its index. A
per-slice page exists only where a slice deviates from what the surface spec already describes.

**Why:** surfaces own descriptions; the log owns decisions — decisions routinely span surfaces,
and a number is a permanent identity cited from code, so a surface-filed ADR hides from the other
surfaces and breaks its citations the day scope moves.

**Exceptions:** —

**Enforced by:** unenforced — review judgment.

**Example:** —

### OUT-3 — A README is orientation only

**Rule:** a README carries a title naming the folder, a `Folder purpose:` line, a navigation
table under a `## Folder overview` heading, and at most one "start here" pointer. No rules, no
worked examples, no precedence, no term definitions. This binds every README in the repository —
`docs/_standard/`'s and the repository root's included.

**Why:** a README that carries rules is a second copy of them, and the copy a reader lands on
first is the one that goes stale.

**Exceptions:** —

**Enforced by:** `/docs:audit` (the shape read).

**Example:** [`templates/readme.md`](../templates/readme.md).

### OUT-4 — The spec-sheet spine

**Rule:** a spec sheet opens with its stamp and scope, carries as many numbered contract sections
as the surface needs, then always ends with the same three — Invariants, numbered `I<n>`, numbers
permanent and never reused; then Violation → remedy; then Known-open. Every claim carries an
anchored citation (COR-6), and every invariant states its failure mode.

**Why:** fixed closing sections make separate spec sheets read as one document, and permanent
invariant numbers are what lets a comment or an ADR cite `I<n>` without the reference silently
moving.

**Exceptions:** —

**Enforced by:** `/docs:audit` (the shape read); the citations by the gate.

**Example:** [`templates/spec-sheet.md`](../templates/spec-sheet.md).

### OUT-5 — The overview spine

**Rule:** an overview opens with two or three sentences, then "How it is organised", then the
sections the surface needs, then "Read next" — around 120 lines, treated as a ceiling. It says
what the surface is for and names its parts; mechanisms belong in the spec sheet, arguments in
ADRs.

**Why:** an overview that is growing has started explaining mechanisms the spec sheet already
owns, and the ceiling is what makes that drift visible.

**Exceptions:** —

**Enforced by:** `/docs:audit` (the shape read).

**Example:** [`templates/surface-overview.md`](../templates/surface-overview.md).

### OUT-6 — The glossary

**Rule:** the domain vocabulary lives in one central file, `docs/glossary.md`, one entry per term:
the term as it appears in code, a one-line gloss, where it lives, and the pitfalls.

**Why:** the vocabulary is load-bearing and ambiguous in ways only the pitfall lines record, and
scattering it per surface would strand the cross-cutting terms.

**Exceptions:** —

**Enforced by:** unenforced — review judgment.

**Example:** a term whose stored values and query-only aliases differ — the pitfall line is what
costs an hour to rediscover and thirty seconds to write down.

### OUT-7 — Diagrams

**Rule:** diagrams are mermaid, so they render in-repo without a build step. C4 levels 1–3 only —
never a code diagram. They live in overviews, plus a spec sheet where a data flow is genuinely
hard in prose; never in an ADR, which is an argument, and an argument is prose. No square brackets
inside quoted node labels — write `<path>/:id`, not `<path>/[id]`.

**Why:** a code diagram duplicates the source and rots immediately; code layout goes in the spec
sheet as a directory tree, which is cheap to keep right.

**Exceptions:** —

**Enforced by:** unenforced — review judgment.

**Example:** a sequence diagram earns its place exactly where ordering carries the meaning.

### OUT-8 — The surface

**Rule:** a surface is one of the three parts of the system a reader goes to as a whole —
frontend (`fl_frontend/`), backend (`fl_backend/`), and ops (the compose files, `nginx/`,
`scripts/`, the Dockerfiles). Documentation is organised by surface because that is the
granularity at which a question has one answer. A surface is not a slice, not a layer, not a
directory. Three pages belong to no surface: `docs/glossary.md`, `docs/logging.md` and
`docs/domain.md`.

**Why:** "how does caching work", "how is a request authenticated" and "what happens on deploy"
each has exactly one home, and that is the property worth organising around.

**Exceptions:** —

**Enforced by:** unenforced — review judgment.

**Example:** —

### OUT-9 — The word is layer

**Rule:** the three shapes of OUT-1 are called layers, and layer is the only word for them — never
introduce a second term for the same concept anywhere in `docs/`.

**Why:** two words for one concept read as two concepts, and every future page has to pick one.

**Exceptions:** —

**Enforced by:** unenforced — review judgment.

**Example:** —
