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

# Not derived from `db.py`'s providers: the junctions are reached by `$lookup` and have none.
EXPECTED_COLLECTIONS = {collection.value for collection in Collection}

# Named here so giving one a model later fails this file rather than leaving its validator unmirrored.
MODELLESS_COLLECTIONS = {Collection.SAISON_TEAMS, Collection.SAISON_SPIELER}

# Ranges, formats and lengths stay Pydantic's: reaching for one of these widens the scope.
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
    # Its own reason: forbidding unknown keys makes every field addition a deploy-ordering problem.
    "additionalProperties",
}

# (collection, path to the sub-schema, model, fields the model has that the document does not). The
# fourth keeps this an equality check: `FLTeam` and `FLSpieler` are assembled from several collections.
MIRRORED_MODELS: list[tuple[Collection, tuple[str, ...], type[BaseModel] | tuple[type[BaseModel], ...], frozenset[str]]] = [
    # `schedule` is derived from this season's `rules` and stored nowhere.
    (Collection.SAISONS, (), FLSaison, frozenset({"schedule"})),
    (Collection.SAISONS, ("rules",), FLSaisonRules, frozenset()),
    (Collection.SPIELE, (), FLSpiel, frozenset()),
    (Collection.SPIELE, ("team1",), FLSpielTeamField, frozenset()),
    (Collection.SPIELE, ("team2",), FLSpielTeamField, frozenset()),
    # A discriminated union: `$jsonSchema` cannot require a key only when a sibling holds a value, so
    # the validator declares both variants' union and requires `type` alone.
    (Collection.SPIELE, ("team1_quelle",), (FLSpielQuelleGruppe, FLSpielQuelleSpiel), frozenset()),
    (Collection.SPIELE, ("team2_quelle",), (FLSpielQuelleGruppe, FLSpielQuelleSpiel), frozenset()),
    (Collection.SPIELE, ("elfmeterschiessen",), FLSpielElfmeterschiessen, frozenset()),
    (Collection.SPIELE, ("ort",), FLSpielOrtField, frozenset()),
    (Collection.SPIELE, ("schiedsrichter",), FLSpielSchiedsrichterField, frozenset()),
    # `anzahl_spiele` is derived from the rules and the phase, and stored nowhere.
    (Collection.SPIELTAGE, (), FLSpieltag, frozenset({"anzahl_spiele"})),
    (Collection.SPIELORTE, (), FLSpielort, frozenset()),
    (Collection.SPIELORTE, ("address",), FLAddress, frozenset()),
    (Collection.SCHIEDSRICHTER, (), FLSchiedsrichter, frozenset()),
    (Collection.SCHIEDSRICHTER, ("kontakt",), FLKontakt, frozenset()),
    # `gruppe` and `disqualifikation` join from `saison_teams`, `statistik` derives from `spiele`.
    (Collection.TEAMS, (), FLTeam, frozenset({"gruppe", "disqualifikation", "statistik"})),
    # Twice on purpose: `FLTeam` is the read shape; `FLTeamRecord` is the write echo and must match exactly.
    (Collection.TEAMS, (), FLTeamRecord, frozenset()),
    (Collection.TEAMS, ("address",), FLAddress, frozenset()),
    # Everything but the two names comes from the saison_spieler junction.
    (Collection.SPIELER, (), FLSpieler, frozenset({"team_id", "stufe", "nummer", "position", "is_nachgetragen", "is_captain"})),
    # The one sub-document of a modelless row with a model, so the drift check reaches it.
    (Collection.SAISON_TEAMS, ("disqualifikation",), FLDisqualifikation, frozenset()),
]

# (collection, path to the sub-schema, field, the Literal it must equal, whether null is a member).
# The `quelle` rows read members off a model field: `type` and `ausgang` are declared inline.
MIRRORED_ENUMS: list[tuple[Collection, tuple[str, ...], str, tuple[object, ...], bool]] = [
    (Collection.SAISONS, (), "status", get_args(FLSaisonStatus), False),
    # An array: not itself a `Literal`, but its members are, which is what this row compares.
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
    # Nullable because a squad entry fills in over time; `None` is what lets `enum` stand beside a
    # nullable `bsonType`.
    (Collection.SAISON_SPIELER, (), "position", get_args(FLSpielerPosition), True),
    (Collection.SAISON_SPIELER, (), "stufe", get_args(FLSpielerStufe), True),
]


def document_keys(models: type[BaseModel] | tuple[type[BaseModel], ...]) -> set[str]:
    """Named as stored, so `id` reads `_id`; a union field's variants merge, because one validator names every key either can store."""
    keys: set[str] = set()

    for model in models if isinstance(models, tuple) else (models,):
        for field_name, field in model.model_fields.items():
            alias = field.validation_alias
            keys.add(alias if isinstance(alias, str) else field_name)

    return keys


def properties_at(collection: Collection, path: tuple[str, ...]) -> Mapping[str, Any]:
    schema: Mapping[str, Any] = COLLECTION_VALIDATORS[collection]["$jsonSchema"]

    for step in path:
        schema = schema["properties"][step]

    return schema["properties"]


def walk_schemas(schema: Mapping[str, Any]):
    yield schema

    for child in schema.get("properties", {}).values():
        yield from walk_schemas(child)


def test_every_collection_has_a_validator():
    assert set(COLLECTION_VALIDATORS) == EXPECTED_COLLECTIONS


def test_only_the_two_junctions_are_unmirrored():
    """Root entries only: `saison_teams` has a mirrored sub-document and its row is still modelless."""
    mirrored_rows = {collection for collection, path, _, _ in MIRRORED_MODELS if not path}
    assert set(COLLECTION_VALIDATORS) - mirrored_rows == MODELLESS_COLLECTIONS


@pytest.mark.parametrize(("collection", "path", "model", "not_stored"), MIRRORED_MODELS)
def test_every_mirrored_model_matches_its_validator(
    collection: Collection,
    path: tuple[str, ...],
    model: type[BaseModel] | tuple[type[BaseModel], ...],
    not_stored: frozenset[str],
):
    """Fails in the default tier naming the field, rather than in production as a hand-edit the validator refuses."""
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
    """The drift check compares names only: without this a renamed member surfaces as a live write refused for a legal-looking value."""

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
    """An enum added to a validator with no row in `MIRRORED_ENUMS` would go unchecked while the mirror test kept passing."""

    def walk(schema: Mapping[str, Any], path: tuple[str, ...]) -> set[tuple[str, ...]]:
        """Descends `items` too: an array of a closed set declares its enum a level below, as `rules.erlaubte_stufen` does."""
        found: set[tuple[str, ...]] = set()

        for name, child in schema.get("properties", {}).items():
            here = (*path, name)
            # An array's members are the same field to `MIRRORED_ENUMS`, so `items`' enum is recorded
            # under the property's own path.
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
    """Widening the scope is a one-word edit that reads as an improvement; a bad range fails Pydantic on the next read anyway."""
    for schema in walk_schemas(COLLECTION_VALIDATORS[collection]["$jsonSchema"]):
        out_of_scope = set(schema) & OUT_OF_SCOPE_KEYWORDS
        assert not out_of_scope, f"{collection} uses {sorted(out_of_scope)}, which is left to Pydantic"


@pytest.mark.parametrize(
    ("code", "errmsg", "expected"),
    [
        # Atlas: both arrive as AtlasError 8000, so a code-only rule sends the reader to change the wrong thing.
        (8000, "bad auth : Authentication failed.", "REJECTED THE CREDENTIALS"),
        (8000, "user is not allowed to do action [collMod] on [fl_main.spiele]", "NOT ALLOWED"),
        # A self-managed mongod, which does use the specific codes.
        (18, "Authentication failed.", "REJECTED THE CREDENTIALS"),
        (13, "not authorized on fl_main to execute command", "NOT ALLOWED"),
        (26, "ns does not exist", "refused the command"),
    ],
)
def test_a_driver_failure_is_diagnosed_rather_than_traced(code: int, errmsg: str, expected: str):
    failure = OperationFailure(errmsg, code, {"errmsg": errmsg, "code": code})
    diagnosis = diagnose_failure(failure)

    assert expected in diagnosis
    # A diagnostic quoting the connection string is one nobody can paste into a bug report.
    assert "mongodb" not in diagnosis and "@" not in diagnosis


def test_unique_index_names_are_distinct():
    """Two indexes sharing a name is the second one silently never being built."""
    names = [f"{index.collection}.{index.name}" for index in UNIQUE_INDEXES]
    assert len(names) == len(set(names))


@pytest.mark.parametrize("index", UNIQUE_INDEXES, ids=lambda index: index.name)
def test_every_index_key_is_a_field_the_validator_declares(index):
    """MongoDB indexes a missing field as null, so a unique index on a misspelt key permits one document and rejects every other."""
    declared = set(properties_at(index.collection, ()))
    assert set(index.keys) <= declared, f"{index.name} indexes {sorted(set(index.keys) - declared)}, which {index.collection} has no field for"
