"""
CORE · the declared constraints, checked as data

Three jobs: the validators are well-formed; they have not drifted from the Pydantic models —
hand-mirroring is this codebase's main drift risk, and the mirror test fails by name when a
field is added to one copy only; and the scope is still types, presence and enums, because
widening it is a one-word edit that would otherwise pass review.

Invariants:
- Field names and enum members are checked separately — the name check cannot see a drifted `enum`.
- `test_constraints_execution.py` is the other half: this fails on a missing rule, that on a wrong one.
"""

from typing import Any, Mapping, get_args

import pytest
from pydantic import BaseModel
from pymongo.errors import OperationFailure

from app.api.saisons.schemas import FLSaison, FLSaisonRules, FLSaisonStatus
from app.api.schiedsrichter.schemas import FLSchiedsrichter
from app.api.spiele.schemas import (
    FLSaisonPhase,
    FLSpiel,
    FLSpielElfmeterschiessen,
    FLSpielOrtField,
    FLSpielQuelleGruppe,
    FLSpielQuelleSpiel,
    FLSpielSchiedsrichterField,
    FLSpielTeamField,
)
from app.api.spieler.schemas import FLSpieler, FLSpielerPosition, FLSpielerStufe
from app.api.spielorte.schemas import FLSpielort
from app.api.spieltage.schemas import FLSpieltag
from app.api.teams.schemas import FLDisqualifikation, FLGruppenNames, FLTeam, FLTeamRecord
from app.core.collections import Collection
from app.core.constraints import COLLECTION_VALIDATORS, UNIQUE_INDEXES, diagnose_failure
from app.shared.schemas.addresses import FLAddress
from app.shared.schemas.kontakt import FLKontakt

# Every collection the application reads or writes, from the one declaration of them.
# Written out rather than derived from `db.py`'s providers, which cover seven of the nine -- the
# junctions are reached by `$lookup` and have no provider.
EXPECTED_COLLECTIONS = {collection.value for collection in Collection}

# The two collections with no Pydantic model of the row. Named here so that giving one a model later
# fails this file rather than leaving its validator unmirrored. A model of an embedded sub-document
# does not take a collection off the list.
MODELLESS_COLLECTIONS = {Collection.SAISON_TEAMS, Collection.SAISON_SPIELER}

# JSON Schema keywords out of scope. Ranges, formats and lengths stay Pydantic's, and a
# validator reaching for one of these is the scope being widened rather than a constraint being added.
OUT_OF_SCOPE_KEYWORDS = {
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minLength",
    "maxLength",
    "pattern",
    "minItems",
    "maxItems",
    "uniqueItems",
    # Not a range, and out of scope for its own reason: forbidding unknown keys turns every future
    # field addition into a deploy-ordering problem between this file and whatever writes that field.
    "additionalProperties",
}

# (collection, path to the sub-schema, model, fields the model has that the document does not).

# The fourth element records the flattening. `FLTeam` and `FLSpieler` are assembled from more than one
# collection, so they carry fields no single document holds -- naming them keeps this an equality
# check rather than a subset check.
MIRRORED_MODELS: list[tuple[Collection, tuple[str, ...], type[BaseModel] | tuple[type[BaseModel], ...], frozenset[str]]] = [
    # `schedule` is derived from this season's own `rules` and is stored nowhere -- the same
    # shape `anzahl_spiele` has on a matchday, which reports one entry of it per matchday.
    (Collection.SAISONS, (), FLSaison, frozenset({"schedule"})),
    (Collection.SAISONS, ("rules",), FLSaisonRules, frozenset()),
    (Collection.SPIELE, (), FLSpiel, frozenset()),
    (Collection.SPIELE, ("team1",), FLSpielTeamField, frozenset()),
    (Collection.SPIELE, ("team2",), FLSpielTeamField, frozenset()),
    # A discriminated union, so both variants are named and the validator must declare their union.
    # `required` on the validator side is `type` alone -- $jsonSchema cannot make a key required
    # only when a sibling holds a value.
    (Collection.SPIELE, ("team1_quelle",), (FLSpielQuelleGruppe, FLSpielQuelleSpiel), frozenset()),
    (Collection.SPIELE, ("team2_quelle",), (FLSpielQuelleGruppe, FLSpielQuelleSpiel), frozenset()),
    # No variants, so unlike the two `quelle` fields above this one is covered in full: the validator
    # requires both counts and types both.
    (Collection.SPIELE, ("elfmeterschiessen",), FLSpielElfmeterschiessen, frozenset()),
    (Collection.SPIELE, ("ort",), FLSpielOrtField, frozenset()),
    (Collection.SPIELE, ("schiedsrichter",), FLSpielSchiedsrichterField, frozenset()),
    # `anzahl_spiele` is derived from the season's rules and this matchday's phase, and is stored
    # nowhere -- the same shape `statistik` has on a team two entries down.
    (Collection.SPIELTAGE, (), FLSpieltag, frozenset({"anzahl_spiele"})),
    (Collection.SPIELORTE, (), FLSpielort, frozenset()),
    (Collection.SPIELORTE, ("address",), FLAddress, frozenset()),
    (Collection.SCHIEDSRICHTER, (), FLSchiedsrichter, frozenset()),
    (Collection.SCHIEDSRICHTER, ("kontakt",), FLKontakt, frozenset()),
    # `gruppe` and `disqualifikation` are joined from saison_teams; `statistik` is derived from spiele
    # and stored nowhere at all. None of the three is on a teams document.
    (Collection.TEAMS, (), FLTeam, frozenset({"gruppe", "disqualifikation", "statistik"})),
    # The same collection twice, on purpose. `FLTeam` is the read shape and may carry three fields no
    # document has; `FLTeamRecord` is what a write echoes, so its field set must match the validator
    # exactly.
    (Collection.TEAMS, (), FLTeamRecord, frozenset()),
    (Collection.TEAMS, ("address",), FLAddress, frozenset()),
    # Everything but the two names comes from the saison_spieler junction.
    (Collection.SPIELER, (), FLSpieler, frozenset({"team_id", "stufe", "nummer", "position", "is_nachgetragen", "is_captain"})),
    # The one sub-document of a modelless row that does have a model, so the drift check reaches it.
    # `FLTeam` embeds it, which is how the record travels from the junction to the reader.
    (Collection.SAISON_TEAMS, ("disqualifikation",), FLDisqualifikation, frozenset()),
]

# (collection, path to the sub-schema, field, the Literal it must equal, whether null is a member).

# Every `enum` any validator declares appears here, and the test below asserts that -- so a seventh
# enum added to `constraints.py` without a row here fails rather than going unchecked.

# The two `quelle` entries read their members off a model field rather than a named alias, because
# neither has one: `type` and `ausgang` are declared inline on their variants. An alias
# would exist for a test's benefit alone.
MIRRORED_ENUMS: list[tuple[Collection, tuple[str, ...], str, tuple[object, ...], bool]] = [
    (Collection.SAISONS, (), "status", get_args(FLSaisonStatus), False),
    # An ARRAY of the league's set: which levels this season runs. Not nullable and not itself a
    # Literal — the members are, which is what this row compares.
    (Collection.SAISONS, ("rules",), "erlaubte_stufen", get_args(FLSpielerStufe), False),
    (Collection.SAISON_TEAMS, (), "gruppe", get_args(FLGruppenNames), False),
    (Collection.SPIELE, (), "saison_phase", get_args(FLSaisonPhase), False),
    (Collection.SPIELTAGE, (), "saison_phase", get_args(FLSaisonPhase), False),
    (
        Collection.SPIELE,
        ("team1_quelle",),
        "type",
        get_args(FLSpielQuelleGruppe.model_fields["type"].annotation) + get_args(FLSpielQuelleSpiel.model_fields["type"].annotation),
        False,
    ),
    (Collection.SPIELE, ("team1_quelle",), "gruppe", get_args(FLGruppenNames), False),
    (Collection.SPIELE, ("team1_quelle",), "ausgang", get_args(FLSpielQuelleSpiel.model_fields["ausgang"].annotation), False),
    (
        Collection.SPIELE,
        ("team2_quelle",),
        "type",
        get_args(FLSpielQuelleGruppe.model_fields["type"].annotation) + get_args(FLSpielQuelleSpiel.model_fields["type"].annotation),
        False,
    ),
    (Collection.SPIELE, ("team2_quelle",), "gruppe", get_args(FLGruppenNames), False),
    (Collection.SPIELE, ("team2_quelle",), "ausgang", get_args(FLSpielQuelleSpiel.model_fields["ausgang"].annotation), False),
    # Nullable, because a squad entry is filled in over time. `None` is a member of the
    # validator's list, which is what lets `enum` stand beside a nullable `bsonType`.
    (Collection.SAISON_SPIELER, (), "position", get_args(FLSpielerPosition), True),
    (Collection.SAISON_SPIELER, (), "stufe", get_args(FLSpielerStufe), True),
]


def document_keys(models: type[BaseModel] | tuple[type[BaseModel], ...]) -> set[str]:
    """
    The models' fields named as they are STORED, so `id` reads `_id` exactly as the document does.

    Several models rather than one where a field is a discriminated union: `teamN_quelle` is a `gruppe`
    variant or a `spiel` variant, and one validator has to name every key either of them can store.
    Their UNION is therefore what the validator must declare, and adding a field to either variant while
    forgetting `constraints.py` still fails here naming the field.
    """
    keys: set[str] = set()

    for model in models if isinstance(models, tuple) else (models,):
        for field_name, field in model.model_fields.items():
            alias = field.validation_alias
            keys.add(alias if isinstance(alias, str) else field_name)

    return keys


def properties_at(collection: Collection, path: tuple[str, ...]) -> Mapping[str, Any]:
    """Walk into a validator's nested `properties`, so an embedded model can be compared to its own."""
    schema: Mapping[str, Any] = COLLECTION_VALIDATORS[collection]["$jsonSchema"]

    for step in path:
        schema = schema["properties"][step]

    return schema["properties"]


def walk_schemas(schema: Mapping[str, Any]):
    """Yield every sub-schema, so an invariant can be asserted over all of them rather than the root."""
    yield schema

    for child in schema.get("properties", {}).values():
        yield from walk_schemas(child)


def test_every_collection_has_a_validator():
    """Equality both ways: a collection declared with no validator, and a validator naming no collection."""
    assert set(COLLECTION_VALIDATORS) == EXPECTED_COLLECTIONS


def test_only_the_two_junctions_are_unmirrored():
    """
    The junctions have no model of their ROW, and nothing else may quietly join them.

    Without this, adding a tenth collection whose model was never written would pass every other test
    in this file — the drift check only walks what MIRRORED_MODELS lists.

    Root entries only, which is what makes the claim the one worth asserting. `saison_teams` is mirrored
    at `("disqualifikation",)` and its row is still modelless, so counting a sub-document entry here
    would take the junction off this list while the gap it names is entirely unchanged.
    """
    mirrored_rows = {collection for collection, path, _, _ in MIRRORED_MODELS if not path}
    assert set(COLLECTION_VALIDATORS) - mirrored_rows == MODELLESS_COLLECTIONS


@pytest.mark.parametrize(("collection", "path", "model", "not_stored"), MIRRORED_MODELS)
def test_every_mirrored_model_matches_its_validator(
    collection: Collection,
    path: tuple[str, ...],
    model: type[BaseModel] | tuple[type[BaseModel], ...],
    not_stored: frozenset[str],
):
    """
    A Pydantic model and its validator declare the SAME set of fields.

    This is the whole reason the third copy of the schema is affordable. Changing a model without
    changing `app/core/constraints.py` fails here, in the default tier, naming the field — rather than
    in production, where the symptom is a hand-edit rejected for a field the validator has never heard
    of, or worse, a new field nothing checks at all.
    """
    expected = document_keys(model) - not_stored
    declared = set(properties_at(collection, path))

    where = ".".join((collection, *path))
    names = " | ".join(m.__name__ for m in (model if isinstance(model, tuple) else (model,)))
    assert declared == expected, (
        f"{where} has drifted from {names}. "
        f"Only in the model: {sorted(expected - declared)}. Only in the validator: {sorted(declared - expected)}. "
        f"Update app/core/constraints.py in the same commit as the model."
    )


@pytest.mark.parametrize(("collection", "path", "field", "members", "nullable"), MIRRORED_ENUMS)
def test_every_validator_enum_matches_its_literal(
    collection: Collection,
    path: tuple[str, ...],
    field: str,
    members: tuple[object, ...],
    nullable: bool,
):
    """
    A validator's `enum` holds exactly the members of the `Literal` it copies.

    The sibling drift check compares field NAMES and reaches no further, so without this test a
    renamed or dropped enum member passes the whole default tier and surfaces as a live write the
    database refuses for a value the models consider perfectly legal.

    Compared as SETS: `enum` is an unordered membership rule, and MongoDB does not care what order the
    list is in, so an ordering difference is not drift.
    """

    schema = properties_at(collection, path)[field]
    # An array of a closed set carries its enum on `items`; the row names the property either way.
    declared = schema.get("enum", schema.get("items", {}).get("enum"))
    expected = set(members) | ({None} if nullable else set())

    where = ".".join((collection, *path, field))
    assert declared is not None, f"{where} declares no enum, but MIRRORED_ENUMS says it copies one"
    assert set(declared) == expected, (
        f"{where} has drifted from its Literal. "
        f"Only in the Literal: {sorted(expected - set(declared), key=str)}. "
        f"Only in the validator: {sorted(set(declared) - expected, key=str)}. "
        f"Update app/core/constraints.py in the same commit as the model."
    )


def test_every_declared_enum_is_checked():
    """
    Every `enum` in every validator has a row in `MIRRORED_ENUMS`.

    Without this, adding an eighth enum and no row would leave it unchecked while the test above went
    on passing for every collection that has one — the failure mode `test_only_the_two_junctions_are_unmirrored`
    exists to prevent one level up.
    """

    def walk(schema: Mapping[str, Any], path: tuple[str, ...]) -> set[tuple[str, ...]]:
        """
        Descends `properties` AND `items`, because an enum can sit on either.

        An array of a closed set declares its enum one level below the property, so a walker following
        `properties` alone reports the whole file checked while that enum goes unread --
        `rules.erlaubte_stufen` is the instance.
        """
        found: set[tuple[str, ...]] = set()

        for name, child in schema.get("properties", {}).items():
            here = (*path, name)
            # An array's members are the same field as far as MIRRORED_ENUMS is concerned, so the
            # enum on `items` is recorded under the property's own path rather than a synthetic one.
            if "enum" in child or "enum" in child.get("items", {}):
                found.add(here)
            found |= walk(child, here)
            found |= walk(child.get("items", {}), here)

        return found

    declared: set[tuple[str, ...]] = set()
    for collection, validator in COLLECTION_VALIDATORS.items():
        declared |= {(collection, *rest) for rest in walk(validator["$jsonSchema"], ())}

    checked = {(collection, *path, field) for collection, path, field, _, _ in MIRRORED_ENUMS}

    assert declared == checked, (
        f"Enums with no row in MIRRORED_ENUMS: {sorted(declared - checked)}. "
        f"Rows naming an enum no validator declares: {sorted(checked - declared)}."
    )


@pytest.mark.parametrize("collection", sorted(COLLECTION_VALIDATORS))
def test_every_required_field_declares_a_type(collection: Collection):
    """A required field with no entry in `properties` asserts presence and nothing about the value."""
    for schema in walk_schemas(COLLECTION_VALIDATORS[collection]["$jsonSchema"]):
        undeclared = set(schema.get("required", [])) - set(schema.get("properties", {}))
        assert not undeclared, f"{collection} requires {sorted(undeclared)} without declaring a bsonType for it"


@pytest.mark.parametrize("collection", sorted(COLLECTION_VALIDATORS))
def test_no_validator_constrains_a_range_or_a_format(collection: Collection):
    """
    The validators' scope, made enforceable.

    Widening it is a one-word edit and reads as an improvement, which is exactly why it needs a test
    rather than a paragraph. Types, presence and enums are the constraints whose violation is silent,
    and a bad range or length fails Pydantic on the next read.
    """
    for schema in walk_schemas(COLLECTION_VALIDATORS[collection]["$jsonSchema"]):
        out_of_scope = set(schema) & OUT_OF_SCOPE_KEYWORDS
        assert not out_of_scope, f"{collection} uses {sorted(out_of_scope)}, which is left to Pydantic"


@pytest.mark.parametrize(
    ("code", "errmsg", "expected"),
    [
        # Atlas, measured 2026-08-02. Both of the first two arrive as AtlasError 8000 with nothing but
        # the message to separate them, so a code-only rule reports the second as a rejected password
        # and sends the reader to change the wrong thing.
        (8000, "bad auth : Authentication failed.", "REJECTED THE CREDENTIALS"),
        (8000, "user is not allowed to do action [collMod] on [fl_main.spiele]", "NOT ALLOWED"),
        # A self-managed mongod, which does use the specific codes.
        (18, "Authentication failed.", "REJECTED THE CREDENTIALS"),
        (13, "not authorized on fl_main to execute command", "NOT ALLOWED"),
        (26, "ns does not exist", "refused the command"),
    ],
)
def test_a_driver_failure_is_diagnosed_rather_than_traced(code: int, errmsg: str, expected: str):
    """
    A rejected password and a missing privilege are different problems that arrive identically.

    Both surface as an `OperationFailure`, and on Atlas they surface with the SAME error code — so the
    message is the only discriminator, and a traceback puts sixty frames of driver internals between
    the reader and it. This is the mapping that names which of the two they have.

    The last assertion is a hard rule rather than a nicety: a diagnostic that quotes the connection
    string is one nobody can paste into a bug report.
    """
    failure = OperationFailure(errmsg, code, {"errmsg": errmsg, "code": code})
    diagnosis = diagnose_failure(failure)

    assert expected in diagnosis
    assert "mongodb" not in diagnosis and "@" not in diagnosis


def test_unique_index_names_are_distinct():
    """Two indexes sharing a name is the second one silently never being built."""
    names = [f"{index.collection}.{index.name}" for index in UNIQUE_INDEXES]
    assert len(names) == len(set(names))


@pytest.mark.parametrize("index", UNIQUE_INDEXES, ids=lambda index: index.name)
def test_every_index_key_is_a_field_the_validator_declares(index):
    """
    A typo'd key builds an index over a field no document has — which succeeds, and enforces nothing.

    MongoDB indexes a missing field as null, so a unique index on a misspelt key does not fail loudly;
    it permits exactly one document and then rejects every other one for a reason nobody can read.
    """
    declared = set(properties_at(index.collection, ()))
    assert set(index.keys) <= declared, f"{index.name} indexes {sorted(set(index.keys) - declared)}, which {index.collection} has no field for"
