# ADR-0068 — One declaration of the collection names, as a `StrEnum`

**Status:** Accepted
**Date:** 2026-08-08
**Surface:** backend
**Supersedes:** —
**Superseded by:** —
**Source:** Fallout from [ADR-0066](0066-the-domain-model-is-declared-and-conformance-checked.md). Its
conformance test asserts that every validated collection sits in exactly one aggregate, and writing that
test meant writing the nine names out for a fifth time.

## Context

The nine collection names were spelled out in five places, and nothing held them equal:

| Where                                        | As                                          |
| -------------------------------------------- | ------------------------------------------- |
| `app/core/db.py`                             | the dependency-injection accessors          |
| `app/core/constraints.py`                    | validator keys and unique-index definitions |
| `app/core/domain.py`                         | the aggregate and reference tables          |
| `tests/core/test_constraints.py`             | a hand-written `EXPECTED_COLLECTIONS`       |
| three separate `*_COLLECTION_NAME` constants | two of which declared the same string twice |

A tenth collection reaching one of those and not the others is invisible: every one is a plain string, so a
missing entry is not a type error, not a test failure, and not anything a reader would notice.

The last row is the sharpest form of the problem — the same literal already existed in two modules under
two names, which is the drift arriving rather than threatening.

## Decision

**`fl_backend/app/core/collections.py :: Collection` is the one declaration, and every one of those five reads it.**

**It is a `StrEnum`, which is the opposite of every other closed set in this backend**, and the difference
is what the value _is_. `FLSaisonStatus` is a `Literal` because the string is **data**: stored in MongoDB,
enumerated in a `$jsonSchema` validator, published in `openapi.json`. The wire format needs the bare value
and nothing else. **A collection name never crosses the wire** — it is how this process addresses its own
storage — so it can have the three things an enum gives and a `Literal` cannot: a namespace at the call
site, per-member documentation attached to the member, and iteration.

**Iteration is what earns it.** `fl_backend/tests/core/test_constraints.py` builds its
`EXPECTED_COLLECTIONS` by walking `Collection`, and `:: test_every_collection_has_a_validator` asserts that
set equals `COLLECTION_VALIDATORS` — so a tenth collection added to one and not the other fails rather than
drifts. That check is not expressible over a `Literal` without reaching for `get_args`.

**It walks the enum rather than `db.py`'s providers, and that is the reason the declaration is its own
module.** Deriving the set from the providers would cover seven collections of the nine: `saison_teams` and
`saison_spieler` are reached through a `$lookup` by name and have no provider at all. A declaration that is
derived from one consumer is a declaration that documents that consumer, which is what this one is not.

**`StrEnum` and not the `(str, Enum)` mixin**, for the reason `app/core/domain.py` gives: on Python 3.12+
the mixin renders as `Collection.SAISONS` inside an f-string, and a Mongo filter built from one would carry
the enum member's name instead of the collection's.

**The maps are keyed on it.** `COLLECTION_VALIDATORS` and `MIRRORED_MODELS` take `Collection` rather than
`str`, which is worth doing for its own sake: pyright found twenty-seven raw strings across `domain.py` and
the constraints test that a `str` key would have accepted forever.

**Field names are deliberately not given the same treatment.** A filter needs the **stored** name, which
differs from the model's field wherever an alias is involved — `_id` against `id` — so a constants layer
over fields would be a hand-maintained third copy of every schema, which is exactly what
[ADR-0031](0031-the-third-copy-of-the-schema-is-checked-not-generated.md) exists to avoid. Motor's API takes
strings there and this repository keeps them.

## Consequences

**Adding a collection is now a checked sequence rather than a remembered one.** Add the member, and the
test names each place that has not caught up.

**The two duplicate `*_COLLECTION_NAME` constants are gone**, so the string that was declared twice is
declared once.

**A raw string where a `Collection` belongs is a type error.** That is the whole benefit of typing the maps,
and it is retroactive: the twenty-seven pyright found were pre-existing and none of them was wrong, which is
the point — nothing would have reported the first one that was.

**`docs/domain.md` and `app/core/domain.py` both address collections through the enum**, so the reader's
version and the declaration cannot name a collection differently.

## Alternatives considered

**A `Literal` type alias plus module constants**, matching the schemas. Rejected on the iteration argument
above: the conformance test is the reason this exists at all, and it needs to walk the set. `get_args` on a
`Literal` reaches the members but gives up the namespace and the per-member documentation, which is paying
the cost and keeping none of the benefit.

**Leave the names as strings and add the conformance test against a hand-written tuple.** This is what
`EXPECTED_COLLECTIONS` in the constraints test already was, and it is a sixth copy rather than a fix — a
tuple somebody must remember to extend is the same failure the other five had.

**Extend the same treatment to field names.** Rejected above, and it is the more tempting half of the idea:
field names are spelled far more often than collection names. The alias problem is what stops it — a
constants layer would have to declare both the model's field and the stored key, which is a third copy of
every schema and the drift ADR-0031 measured.
