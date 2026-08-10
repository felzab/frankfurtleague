# ADR-0053 — The domain model is declared as data and conformance-checked, not evaluated at runtime

**Status:** Accepted\
**Date:** 2026-08-07\
**Surface:** backend\
**Supersedes:** —\
**Superseded by:** —\
**Source:** My request of 2026-08-07: "please create a documented convention for the whole span of
domains: What is the data hierarchy? What data depends on what? What data can be edited when and under what
circumstances? What needs to happen when certain data is edited/created/deleted? … Maybe there even already
is a standard out there." Then, on the shape: "Would it be possible to have the full system modelled in code
against which we can verify any operation and see if it's valid? Is this a bad approach or would this be
textbook?" and finally "I want the absolute best practice, textbook approach. Please confirm which that is
and then use it."

## Context

The rules of this league were **individually documented and collectively unwritten.** Every constraint had a
home — a `find_*_refusal` function, a `$jsonSchema` validator, an ADR, a module header — and there was no
single place that answered the four questions above. A reader wanting to know when `qualifiers_per_group`
may be edited had to find the endpoint, read the refusal, and hope no other endpoint wrote the field.

Three specific gaps followed from that:

**Which collections form one consistency boundary was never stated.** `PATCH /spiele/{spiel_id}` looks like a
single-document write and resolves the whole season's bracket in the same transaction
([ADR-0034](0034-a-result-entry-resolves-the-whole-bracket.md)). `teams` looks like it belongs to a season
and does not. Both facts were discoverable from the code and neither was declared.

**What happens to a reference when its target changes was scattered across nine comments.** A team rename
fans out into every match; a venue rename fans out but `mietpreis` deliberately does not
([ADR-0021](0021-store-what-was-true-then-derive-what-is-true-now.md)); a matchday retirement touches no
match at all. MongoDB enforces none of this, so the intent existed only where somebody had written it down
next to the code that implemented it.

**A deliberate absence was indistinguishable from an omission.** Nothing refuses a season whose end date
precedes its start, nothing refuses an early rollover, nothing refuses a matchday retired while it holds
played matches. Each is a considered decision, and each reads exactly like a missing check.

**My own proposal was a runtime model every operation could be verified against** — a registry that
each write consults before proceeding. That is the design this decision has to answer, because it is
appealing for a real reason: it makes the rules enumerable, which is the whole complaint.

## Decision

**An invariant is enforced at the aggregate boundary, and the aggregate boundary is the write endpoint.**
That is the textbook answer — Evans's aggregate is defined as the unit that enforces its own invariants — and
it is what this repository already does: every rule is a pure `find_*_refusal` returning
`(error_code, detail)`, called by the endpoint that owns the write.

**A central evaluator is rejected, and the reason is that it is bypassable.** A registry each write must
remember to consult is a rule with an opt-out, and the opt-out is silent: a new endpoint that forgets the
call passes every test, because the tests exercise the registry. Coverage that depends on every future
caller remembering something is not coverage. Worse, the two are not equivalent in expressiveness — several
of these rules do not return a verdict at all. `judge_spieltag_occupancy` **moves** a manual side out of a
clash and refuses only against a maintained one; the bracket resolution **rewrites** fixtures the request
never named. A uniform `is_valid(operation) -> bool` cannot express an outcome, so the interesting rules
would have sat outside the registry, and the registry would then have documented the easy half while looking
complete.

**What was actually missing is not a runtime — it is a declaration.** So `fl_backend/app/core/domain.py`
states the model as data, and nothing evaluates it:

| Table            | States                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `AGGREGATES`     | seven consistency boundaries over nine collections, each with the invariant that binds it     |
| `REFERENCES`     | every cross-collection reference, with a referential action for change and for removal        |
| `FIELD_POLICIES` | when each non-trivially-editable field may be written, and what enforces that                 |
| `RULES`          | every refusal the write paths perform, with its code, operation, implementation and test      |
| `UNENFORCED`     | eight states the system permits on purpose, with the reason and the surface that reports them |

**`Action` uses SQL's own vocabulary** — `RESTRICT`, `CASCADE`, `SET_NULL`, `NO_ACTION` — because it is
precise, widely understood, and because MongoDB enforces none of it. Naming the intended behaviour is the
only way the intention is written down at all.

**`Editability` separates five answers that a single "read-only" flag would have merged.** `IMMUTABLE` is
written once at create; `CONTROL_ONLY` is on no payload and written by one named endpoint; `COMPOSED` is on
no payload and **stored**, composed server-side from fields the payload does carry; `DERIVED` is computed on
read and stored nowhere; `CONDITIONAL` depends on the aggregate's state. The distinction between `COMPOSED`
and `DERIVED` is load-bearing: `spiele.ergebnis` is never accepted from a client and **is** stored, so
calling it derived would assert something false about the database — and the conformance test asserts a
`DERIVED` field is absent from its collection's validator, which is what makes the label mean something.

**The declaration is checked, not trusted.** `fl_backend/tests/core/test_domain.py` is what makes this
different from a second document that drifts:

- every `REQ-*` code raised under `app/api/` has a row in `RULES`, and every row's code is raised somewhere
- every collection the database validates sits in **exactly one** aggregate
- every reference field path and every field-policy field resolves against a Pydantic model or a
  `$jsonSchema` validator
- every `implemented_by` and `enforced_by` imports and is callable
- every `tested_by` names a file that exists and a class that file declares
- a `DERIVED` field is on no validator and on a read model
- **no module under `app/` imports the declaration**

**That last assertion is the invariant that keeps this a declaration.** The moment production code reads
these tables, they become the engine this decision rejected — so the test refuses the import rather than
leaving the boundary to a comment.

**The pattern is the repository's own, applied a third time.** A hand-written declaration plus a conformance
test is what [ADR-0024](0024-the-third-copy-of-the-schema-is-checked-not-generated.md) ratified for the
database validators and [ADR-0033](0033-the-zod-mirror-is-checked-against-the-published-document.md) for the
Zod mirror. Generating the declaration from the code was rejected there for the reason it is rejected here:
a generated copy agrees with the source by construction and therefore proves nothing, and the _reasons_ —
which are the whole value of these tables — cannot be generated at all.

**The transport-level codes stay outside the model.** `REQ-AUTH-001..004`, `REQ-VAL-001` and `REQ-OID-001`
describe who you are, whether the body parses, and whether an id is an ObjectId. They live in `app/core/`,
and the coverage test keys on the directory rather than on an exception list, so the boundary is a statement
rather than a growing set of excuses.

**`docs/domain.md` is the reader's version and cites the declaration rather than restating it.** The
documentation standard's rule against a second copy applies to this pair too: the tables carry the data, the
page carries the narrative, and the page's claims are anchored to symbols the gate checks.

## Consequences

**The four questions have one answer each, in one place.** The hierarchy is `AGGREGATES`, the dependencies
are `REFERENCES`, the editability is `FIELD_POLICIES`, and what must happen on a write is `RULES` plus the
referential action on each reference.

**A new refusal cannot be added without documenting it.** The coverage test fails on a `REQ-*` code in
`app/api/` with no row, so the declaration cannot fall behind the code by one commit — which is the failure
mode every hand-maintained document has.

**A renamed symbol breaks the test rather than the reader's trust.** `implemented_by`, `enforced_by` and
`tested_by` all resolve, so the citations are as reliable as the code. A refactor that renames
`find_rules_refusal` fails `tests/core/test_domain.py` before it reaches review.

**Eight deliberate absences are now legible as decisions.** `UNENFORCED` names each one, its reason, and the
surface that reports it — so an auditor reading "nothing refuses an early rollover" finds the decision rather
than filing a defect.

**A tenth collection cannot be added silently.** `test_every_collection_belongs_to_exactly_one_aggregate`
keys on `COLLECTION_VALIDATORS`, so a new collection fails until somebody decides which boundary owns it.

**The declaration costs a maintenance step that the gate enforces rather than a reviewer.** Adding a field
policy for a field that does not exist, or citing a test class that was renamed, fails the default tier. The
step is real; it is the same step `constraints.py` already asks for.

**Nothing about request handling changed.** No endpoint gained a call, no refusal moved, and no rule's
behaviour differs. This decision is entirely additive to the runtime, which is the point of preferring a
declaration: the enforcement stays where it was already correct.

## Alternatives considered

**A central rules registry every write consults**, as I proposed. Rejected above, on two grounds: it
is bypassable by any future endpoint that forgets the call, and a uniform verdict interface cannot express
the rules that move or rewrite data rather than approving it. The declaration keeps the enumerability the
proposal was after and gives up nothing, because enumeration was never the part that needed to run.

**Generate the declaration from the code** — walk the routers, collect the refusal codes, emit the tables.
Rejected for ADR-0024's reason: a generated declaration agrees with its source by construction, so it
catches nothing, and the reasons attached to every row here are exactly what a generator cannot produce.

**Write it as prose in `docs/` only, with no code artifact.** The lightest option and the one this repository
would ordinarily reach for. Rejected because prose cannot be checked: the citations would rot, the coverage
would silently fall behind, and the page would join the class of document that is trusted for a year and
wrong for most of it. The `docs/domain.md` page exists **and** is backed by tables a test walks.

**Adopt an off-the-shelf standard.** I asked whether one exists, and the honest answer is that the
vocabulary does but the artifact does not. Aggregates, referential actions and invariants are all standard
terms and are used here as such; what no standard supplies is a machine-checkable format for "which
collection belongs to which boundary in _this_ system", so the vocabulary is borrowed and the artifact is
this repository's own.

**Enforce the referential actions at runtime**, with a generic reference-tracking layer that cascades and
restricts automatically. Rejected: the actions are not uniform enough to be generic — a venue rename fans out
its name and deliberately not its price, and a `spiel_nr` with no match leaves its slot alone rather than
emptying it ([ADR-0039](0039-a-bracket-fault-is-derived-on-demand.md)). A generic layer would have to be
configured per field with the same detail the table already carries, and would then also be a runtime
dependency for behaviour that is currently three explicit fan-outs.
