import asyncio
from functools import partial
from typing import Annotated, Any, Literal, Mapping, Union, get_args, get_origin

import pytest
from bson import ObjectId
from pydantic import BaseModel, EmailStr
from pydantic.fields import FieldInfo
from pymongo.errors import OperationFailure

from app.api.aktionen.schemas import FLAktion, FLAktionMitStand, FLAktionRequest, FLAktor
from app.api.bewerbungen.schemas import (
    FLBewerbung,
    FLBewerbungEntscheidung,
    FLBewerbungKader,
    FLBewerbungSchule,
    FLBewerbungStatus,
    FLBewerbungTrikot,
)
from app.api.saisons.schemas import (
    FLSaison,
    FLSaisonBewerbung,
    FLSaisonForfeitErgebnis,
    FLSaisonRules,
    FLSaisonSpielplan,
    FLSaisonStatus,
)
from app.api.schiedsrichter.schemas import FLSchiedsrichter
from app.api.spiele.schemas import (
    FLSaisonPhase,
    FLSonderereignis,
    FLSpiel,
    FLSpielElfmeterschiessen,
    FLSpielOrtField,
    FLSpielQuelleGruppe,
    FLSpielQuelleSpiel,
    FLSpielSchiedsrichterField,
    FLSpielTeamField,
)
from app.api.spieler.schemas import (
    FLEinwilligung,
    FLSaisonSpielerRow,
    FLSpieler,
    FLSpielerPosition,
    FLSpielerRolle,
    FLSpielerStufe,
)
from app.api.spielorte.schemas import FLSpielort
from app.api.spieltage.schemas import FLSpieltag
from app.api.teams.schemas import (
    FLAustritt,
    FLGruppenNames,
    FLKontaktEinwilligung,
    FLKontaktperson,
    FLSaisonTeamKontakte,
    FLSchulform,
    FLTeam,
    FLTeamRecord,
    FLTrainerZugleich,
    FLTrikotFarbe,
)
from app.core.collections import Collection
from app.core.constraints import _AKTION_OPERATIONS, _AKTOR_KINDS, COLLECTION_VALIDATORS, UNIQUE_INDEXES, _apply_concurrently, diagnose_failure
from app.core.recording import Actor, Operation
from app.shared.schemas.addresses import FLAddress
from app.shared.schemas.kontakt import FLKontakt

# Not derived from `db.py`'s providers: the junctions are reached by `$lookup` and have none.
EXPECTED_COLLECTIONS = {collection.value for collection in Collection}

# Named here so giving one a model later fails this file rather than leaving its validator unmirrored.
MODELLESS_COLLECTIONS = {Collection.SAISON_TEAMS}

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
    # The single read's model: the LIST model drops `before` and computes `stand_gesichert`,
    # which no document stores.
    (Collection.AKTIONEN, (), FLAktionMitStand, frozenset({"stand_gesichert"})),
    (Collection.AKTIONEN, ("actor",), FLAktor, frozenset()),
    (Collection.AKTIONEN, ("request",), FLAktionRequest, frozenset()),
    (Collection.SAISONS, (), FLSaison, frozenset({"schedule"})),
    (Collection.SAISONS, ("rules",), FLSaisonRules, frozenset()),
    (Collection.SAISONS, ("rules", "forfeit_ergebnis"), FLSaisonForfeitErgebnis, frozenset()),
    (Collection.SAISONS, ("spielplan",), FLSaisonSpielplan, frozenset()),
    (Collection.SAISONS, ("bewerbung",), FLSaisonBewerbung, frozenset()),
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
    # `gruppe` and `austritt` join from `saison_teams`, `statistik` derives from `spiele`.
    (Collection.TEAMS, (), FLTeam, frozenset({"gruppe", "austritt", "statistik"})),
    # Twice on purpose: `FLTeam` is the read shape; `FLTeamRecord` is the write echo and must match exactly.
    (Collection.TEAMS, (), FLTeamRecord, frozenset()),
    (Collection.TEAMS, ("address",), FLAddress, frozenset()),
    # Everything but the two names comes from the saison_spieler junction.
    (Collection.SPIELER, ("einwilligung",), FLEinwilligung, frozenset()),
    (Collection.SPIELER, (), FLSpieler, frozenset({"team_id", "stufe", "nummer", "position", "is_nachgetragen", "rolle"})),
    # The sub-documents of a modelless row that DO have models, so the drift check reaches them.
    (Collection.SAISON_TEAMS, ("austritt",), FLAustritt, frozenset()),
    (Collection.SAISON_TEAMS, ("kontakte",), FLSaisonTeamKontakte, frozenset()),
    (Collection.SAISON_TEAMS, ("kontakte", "trainer"), FLKontaktperson, frozenset()),
    (Collection.SAISON_TEAMS, ("kontakte", "ansprechperson"), FLKontaktperson, frozenset()),
    (Collection.SAISON_TEAMS, ("kontakte", "stellvertretung"), FLKontaktperson, frozenset()),
    (Collection.SAISON_TEAMS, ("kontakte", "trainer", "einwilligung"), FLKontaktEinwilligung, frozenset()),
    (Collection.SAISON_TEAMS, ("kontakte", "ansprechperson", "einwilligung"), FLKontaktEinwilligung, frozenset()),
    (Collection.SAISON_TEAMS, ("kontakte", "stellvertretung", "einwilligung"), FLKontaktEinwilligung, frozenset()),
    (Collection.BEWERBUNGEN, (), FLBewerbung, frozenset()),
    (Collection.BEWERBUNGEN, ("schule",), FLBewerbungSchule, frozenset()),
    (Collection.BEWERBUNGEN, ("schule", "address"), FLAddress, frozenset()),
    (Collection.BEWERBUNGEN, ("trikot",), FLBewerbungTrikot, frozenset()),
    (Collection.BEWERBUNGEN, ("kader",), FLBewerbungKader, frozenset()),
    (Collection.BEWERBUNGEN, ("entscheidung",), FLBewerbungEntscheidung, frozenset()),
    # The same three people the junction holds, so the block is mirrored on both collections.
    (Collection.BEWERBUNGEN, ("kontakte",), FLSaisonTeamKontakte, frozenset()),
    (Collection.BEWERBUNGEN, ("kontakte", "trainer"), FLKontaktperson, frozenset()),
    (Collection.BEWERBUNGEN, ("kontakte", "ansprechperson"), FLKontaktperson, frozenset()),
    (Collection.BEWERBUNGEN, ("kontakte", "stellvertretung"), FLKontaktperson, frozenset()),
    (Collection.BEWERBUNGEN, ("kontakte", "trainer", "einwilligung"), FLKontaktEinwilligung, frozenset()),
    (Collection.BEWERBUNGEN, ("kontakte", "ansprechperson", "einwilligung"), FLKontaktEinwilligung, frozenset()),
    (Collection.BEWERBUNGEN, ("kontakte", "stellvertretung", "einwilligung"), FLKontaktEinwilligung, frozenset()),
    # The junction's declared shape; nothing validates a stored row through it.
    (Collection.SAISON_SPIELER, (), FLSaisonSpielerRow, frozenset()),
]

# (collection, path to the sub-schema, field, the Literal it must equal, whether null is a member).
# The `quelle` rows read members off a model field: `type` and `ausgang` are declared inline.
MIRRORED_ENUMS: list[tuple[Collection, tuple[str, ...], str, tuple[object, ...], bool]] = [
    (Collection.AKTIONEN, (), "operation", get_args(FLAktion.model_fields["operation"].annotation), False),
    (Collection.AKTIONEN, ("actor",), "kind", get_args(FLAktor.model_fields["kind"].annotation), False),
    # Derived from the roster rather than spelled out, so adding a collection widens this enum and
    # forgetting to widen the validator fails here rather than at the first write to the new one.
    (Collection.AKTIONEN, (), "collection", tuple(c.value for c in Collection if c is not Collection.AKTIONEN), False),
    (Collection.SAISONS, (), "status", get_args(FLSaisonStatus), False),
    # An array: not itself a `Literal`, but its members are, which is what this row compares.
    (Collection.SAISONS, ("rules",), "erlaubte_stufen", get_args(FLSpielerStufe), False),
    (Collection.SAISONS, ("rules",), "tiebreak_order", get_args(FLSaisonRules.model_fields["tiebreak_order"].annotation), False),
    (Collection.SAISON_TEAMS, (), "gruppe", get_args(FLGruppenNames), False),
    (Collection.SAISON_TEAMS, ("austritt",), "type", get_args(FLAustritt.model_fields["type"].annotation), False),
    # Nullable because the field arrived after the rows did, as `saison_spieler.rolle` is: a season
    # entered before it holds no key, and the null is what the validator's `enum` has to admit.
    (Collection.TEAMS, (), "schulform", get_args(FLSchulform), True),
    (Collection.SAISON_TEAMS, (), "trikot_farbe", get_args(FLTrikotFarbe), True),
    (Collection.BEWERBUNGEN, (), "status", get_args(FLBewerbungStatus), False),
    # Nullable on both: null is the Trainer holding no second seat, which is the ordinary case rather
    # than a field nobody filled in.
    (Collection.SAISON_TEAMS, ("kontakte",), "trainer_ist_zugleich", get_args(FLTrainerZugleich), True),
    (Collection.BEWERBUNGEN, ("kontakte",), "trainer_ist_zugleich", get_args(FLTrainerZugleich), True),
    # Nullable for `teams.schulform`'s reason on the one, and because a school may state no wish on
    # the other: the null is a real answer rather than a field nobody filled in.
    (Collection.BEWERBUNGEN, ("schule",), "schulform", get_args(FLSchulform), True),
    (Collection.BEWERBUNGEN, ("trikot",), "wunschfarbe", get_args(FLTrikotFarbe), True),
    # One row per person, because the validator declares the block three times over: a sub-schema
    # shared in Python is still three separate paths to the drift walk.
    (
        Collection.SAISON_TEAMS,
        ("kontakte", "trainer", "einwilligung"),
        "umfang",
        get_args(FLKontaktEinwilligung.model_fields["umfang"].annotation),
        False,
    ),
    (
        Collection.SAISON_TEAMS,
        ("kontakte", "trainer", "einwilligung"),
        "erteilt_von",
        get_args(FLKontaktEinwilligung.model_fields["erteilt_von"].annotation),
        False,
    ),
    (
        Collection.SAISON_TEAMS,
        ("kontakte", "ansprechperson", "einwilligung"),
        "umfang",
        get_args(FLKontaktEinwilligung.model_fields["umfang"].annotation),
        False,
    ),
    (
        Collection.SAISON_TEAMS,
        ("kontakte", "ansprechperson", "einwilligung"),
        "erteilt_von",
        get_args(FLKontaktEinwilligung.model_fields["erteilt_von"].annotation),
        False,
    ),
    (
        Collection.SAISON_TEAMS,
        ("kontakte", "stellvertretung", "einwilligung"),
        "umfang",
        get_args(FLKontaktEinwilligung.model_fields["umfang"].annotation),
        False,
    ),
    (
        Collection.SAISON_TEAMS,
        ("kontakte", "stellvertretung", "einwilligung"),
        "erteilt_von",
        get_args(FLKontaktEinwilligung.model_fields["erteilt_von"].annotation),
        False,
    ),
    (
        Collection.BEWERBUNGEN,
        ("kontakte", "trainer", "einwilligung"),
        "umfang",
        get_args(FLKontaktEinwilligung.model_fields["umfang"].annotation),
        False,
    ),
    (
        Collection.BEWERBUNGEN,
        ("kontakte", "trainer", "einwilligung"),
        "erteilt_von",
        get_args(FLKontaktEinwilligung.model_fields["erteilt_von"].annotation),
        False,
    ),
    (
        Collection.BEWERBUNGEN,
        ("kontakte", "ansprechperson", "einwilligung"),
        "umfang",
        get_args(FLKontaktEinwilligung.model_fields["umfang"].annotation),
        False,
    ),
    (
        Collection.BEWERBUNGEN,
        ("kontakte", "ansprechperson", "einwilligung"),
        "erteilt_von",
        get_args(FLKontaktEinwilligung.model_fields["erteilt_von"].annotation),
        False,
    ),
    (
        Collection.BEWERBUNGEN,
        ("kontakte", "stellvertretung", "einwilligung"),
        "umfang",
        get_args(FLKontaktEinwilligung.model_fields["umfang"].annotation),
        False,
    ),
    (
        Collection.BEWERBUNGEN,
        ("kontakte", "stellvertretung", "einwilligung"),
        "erteilt_von",
        get_args(FLKontaktEinwilligung.model_fields["erteilt_von"].annotation),
        False,
    ),
    (Collection.SPIELER, ("einwilligung",), "umfang", get_args(FLEinwilligung.model_fields["umfang"].annotation), False),
    (Collection.SPIELER, ("einwilligung",), "erteilt_von", get_args(FLEinwilligung.model_fields["erteilt_von"].annotation), False),
    (Collection.SPIELE, (), "saison_phase", get_args(FLSaisonPhase), False),
    (Collection.SPIELE, (), "sonderereignis", get_args(FLSonderereignis), True),
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
    # Nullable for a reason the two above do not share: holding no role is the ordinary state, and
    # a row predating the field carries no key at all.
    (Collection.SAISON_SPIELER, (), "rolle", get_args(FLSpielerRolle), True),
]


def document_keys(models: type[BaseModel] | tuple[type[BaseModel], ...]) -> set[str]:
    """Named as stored, so `id` reads `_id`; a union field's variants merge, because one validator names every key either can store."""
    keys: set[str] = set()

    for model in models if isinstance(models, tuple) else (models,):
        for field_name, field in model.model_fields.items():
            alias = field.validation_alias
            keys.add(alias if isinstance(alias, str) else field_name)

    return keys


def stored_fields(models: type[BaseModel] | tuple[type[BaseModel], ...]) -> dict[str, list[tuple[str, FieldInfo]]]:
    """`document_keys` in mapping form; a union key lists one entry per variant, since the validator requires it of whichever is stored."""
    fields: dict[str, list[tuple[str, FieldInfo]]] = {}

    for model in models if isinstance(models, tuple) else (models,):
        for field_name, field in model.model_fields.items():
            alias = field.validation_alias
            fields.setdefault(alias if isinstance(alias, str) else field_name, []).append((model.__name__, field))

    return fields


def properties_at(collection: Collection, path: tuple[str, ...]) -> Mapping[str, Any]:
    schema: Mapping[str, Any] = COLLECTION_VALIDATORS[collection]["$jsonSchema"]

    for step in path:
        schema = schema["properties"][step]

    return schema["properties"]


def required_at(collection: Collection, path: tuple[str, ...]) -> list[str]:
    """`properties_at`'s sibling: `required` is a key beside `properties` rather than one inside it."""
    schema: Mapping[str, Any] = COLLECTION_VALIDATORS[collection]["$jsonSchema"]

    for step in path:
        schema = schema["properties"][step]

    return list(schema.get("required", []))


def walk_schemas(schema: Mapping[str, Any]):
    yield schema

    for child in schema.get("properties", {}).values():
        yield from walk_schemas(child)


def test_every_collection_has_a_validator():
    assert set(COLLECTION_VALIDATORS) == EXPECTED_COLLECTIONS


def test_only_the_saison_teams_junction_is_unmirrored():
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


@pytest.mark.parametrize(("collection", "path", "model"), [(collection, path, model) for collection, path, model, _ in MIRRORED_MODELS])
def test_every_required_field_is_required_on_its_model(
    collection: Collection,
    path: tuple[str, ...],
    model: type[BaseModel] | tuple[type[BaseModel], ...],
):
    """A defaulted field still mirrors by name, and the model then accepts a row the validator would refuse to store."""

    fields = stored_fields(model)
    where = ".".join((collection, *path))

    for key in required_at(collection, path):
        declaring = fields.get(key, [])
        assert declaring, f"{where} requires {key!r}, which no model in MIRRORED_MODELS declares"

        optional_on = sorted(name for name, field in declaring if not field.is_required())
        assert not optional_on, (
            f"{where}.{key} is required by the validator and optional on {optional_on}. "
            f"A positional `Field(0, ge=0)` is a default to Pydantic while Pyright still reads the field as required. "
            f"Drop it, or drop {key!r} from `required` in app/core/constraints.py in the same commit."
        )


# What a stored value of each annotation IS, which `model_json_schema()` cannot answer: it types a
# `CustomObjectId` as a string, and objectId-versus-string is the distinction the validators exist for.
BSON_TYPES: Mapping[Any, str] = {
    ObjectId: "objectId",
    bool: "bool",
    # Bounded by what fits int32: `bson` encodes a larger int as int64, which stores as `long`. A
    # field that needs one is annotated for it and takes its own row, rather than widening this one.
    int: "int",
    str: "string",
    # A marker class rather than an alias of `str`, so no other row here answers it.
    EmailStr: "string",
    type(None): "null",
}

# (collection, path, field) -> what a row may STORE, where the read model deliberately narrows it:
# `app/api/aktionen/schemas.py :: FLAktion._as_text` flattens the stored shapes to text, mapping a
# removal's id array to null.
STORED_WIDER_THAN_THE_MODEL: Mapping[tuple[Collection, tuple[str, ...], str], frozenset[str]] = {
    (Collection.AKTIONEN, (), "document_id"): frozenset({"objectId", "string", "array", "null"}),
}


def bson_types(annotation: Any) -> set[str]:
    """Every bsonType a value of this annotation stores as, a `None` member counted as one.

    Raises on an annotation `BSON_TYPES` does not place: an unmapped spelling is a decision to
    take, and a wrong guess shows up nowhere.
    """
    while get_origin(annotation) is Annotated:
        annotation = get_args(annotation)[0]

    origin = get_origin(annotation)

    if origin is Union:
        return set[str]().union(*(bson_types(member) for member in get_args(annotation)))

    if origin is Literal:
        return set[str]().union(*(bson_types(type(member)) for member in get_args(annotation)))

    if origin is list:
        return {"array"}

    if origin is dict:
        return {"object"}

    if annotation in BSON_TYPES:
        return {BSON_TYPES[annotation]}

    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return {"object"}

    raise AssertionError(f"{annotation!r} has no bsonType in BSON_TYPES, so no field annotated with it can be compared")


@pytest.mark.parametrize(("collection", "path", "model", "not_stored"), MIRRORED_MODELS)
def test_every_mirrored_field_declares_the_bson_type_of_its_annotation(
    collection: Collection,
    path: tuple[str, ...],
    model: type[BaseModel] | tuple[type[BaseModel], ...],
    not_stored: frozenset[str],
):
    """A wrong bsonType is invisible everywhere else.

    Every mirrored row, which is not every declaration: `saison_teams` has no row model, so its own
    `_id` and `team_id` are declared by the validator and compared here by nothing.
    """

    properties = properties_at(collection, path)
    where = ".".join((collection, *path))
    names = " | ".join(m.__name__ for m in (model if isinstance(model, tuple) else (model,)))

    for key, declaring in stored_fields(model).items():
        if key in not_stored:
            continue

        expected = set[str]().union(*(bson_types(field.annotation) for _, field in declaring))
        spelled = properties.get(key, {}).get("bsonType")
        declared = {spelled} if isinstance(spelled, str) else set(spelled or ())

        stored = STORED_WIDER_THAN_THE_MODEL.get((collection, path, key))
        if stored is not None:
            assert declared == set(stored), f"{where}.{key} declares {sorted(declared)}, and the shape recorded for it is {sorted(stored)}"
            assert expected <= declared, f"{where}.{key} annotates {sorted(expected)} on {names}, which {sorted(stored)} does not hold"
            continue

        assert declared == expected, (
            f"{where}.{key} has drifted from {names}. "
            f"Only on the model: {sorted(expected - declared)}. Only in the validator: {sorted(declared - expected)}. "
            f"Update app/core/constraints.py in the same commit as the model."
        )


# What `MIRRORED_ENUMS` never relates: its rows pin each validator enum to the aktionen SCHEMA, so a
# member added to `recording.py` alone type-checks, lints, and surfaces only as a live write the
# validator refuses.
RECORDED_LITERALS: list[tuple[str, tuple[object, ...], list[str]]] = [
    ("Operation", get_args(Operation), _AKTION_OPERATIONS),
    ("Actor.kind", get_args(Actor.__annotations__["kind"]), _AKTOR_KINDS),
]


@pytest.mark.parametrize(("name", "recorded", "declared"), RECORDED_LITERALS)
def test_every_recorded_literal_matches_the_validator_that_stores_it(name: str, recorded: tuple[object, ...], declared: list[str]):
    """The write side and the stored shape, compared directly: one is what a row CARRIES and the other what the database ACCEPTS."""

    assert set(recorded) == set(declared), f"app/core/recording.py :: {name} and its constraints.py copy disagree"


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


def test_the_failure_raised_is_the_one_declared_first_not_the_one_that_arrives_first():
    """The one difference a concurrent apply can make, and the happy path cannot see it.

    `asyncio.gather` reports whichever operation loses the race, so without the declared-order rule
    a refused boot's sentence would depend on server timing.
    """
    arrivals: list[str] = []

    async def fail_after(delay: float, label: str) -> None:
        await asyncio.sleep(delay)
        arrivals.append(label)
        raise RuntimeError(label)

    declared: list[tuple[str, Any]] = [
        ("saisons", partial(fail_after, 0.05, "declared first")),
        ("teams", partial(fail_after, 0.0, "declared second")),
    ]

    with pytest.raises(RuntimeError) as raised:
        asyncio.run(_apply_concurrently(declared))

    # The premise of the test rather than a detail: the later one really did fail first.
    assert arrivals == ["declared second", "declared first"]
    assert str(raised.value) == "declared first"


def test_one_namespace_keeps_its_declared_order_and_stops_at_its_own_failure():
    """Two builds racing on one collection are documented nowhere, and the one after a failure is work no sequential apply ever did."""
    ran: list[str] = []

    async def succeed(label: str) -> None:
        ran.append(label)

    async def fail(label: str) -> None:
        ran.append(label)
        raise RuntimeError(label)

    declared: list[tuple[str, Any]] = [
        ("aktionen", partial(fail, "aktionen first")),
        ("aktionen", partial(succeed, "aktionen second")),
        ("bewerbungen", partial(succeed, "bewerbungen only")),
    ]

    with pytest.raises(RuntimeError, match="aktionen first"):
        asyncio.run(_apply_concurrently(declared))

    assert "aktionen second" not in ran, "a namespace carried on past its own failure"
    assert "bewerbungen only" in ran, "an unrelated namespace was cancelled by someone else's failure"


def test_the_declared_rank_is_global_and_not_each_lane_counting_from_zero():
    """Two failures, and the earlier-declared one sits at a NON-ZERO position inside its lane.

    Numbering per lane reports the other one. Every other case puts the failure first in its lane,
    where the two numberings agree and the wrong one passes.
    """
    ran: list[str] = []

    async def succeed(label: str) -> None:
        ran.append(label)

    async def fail(label: str) -> None:
        ran.append(label)
        raise RuntimeError(label)

    declared: list[tuple[str, Any]] = [
        ("aktionen", partial(succeed, "aktionen queue")),
        ("aktionen", partial(fail, "declared second, lane position 1")),
        ("bewerbungen", partial(fail, "declared third, lane position 0")),
    ]

    with pytest.raises(RuntimeError) as raised:
        asyncio.run(_apply_concurrently(declared))

    # The premise, not a detail: with the failure first in its own lane the case proves nothing.
    assert ran.index("aktionen queue") < ran.index("declared second, lane position 1")
    assert str(raised.value) == "declared second, lane position 1"


def test_the_failure_chosen_is_not_the_first_lane_s_but_the_first_declared():
    """Two lanes fail, and the one that OPENS first is the one that fails LATER.

    `lanes` is insertion-ordered, so the first-opened lane's failure is the first `gather` hands
    back -- and in every other case here that is also the first declared.
    """
    ran: list[str] = []

    async def succeed(label: str) -> None:
        ran.append(label)

    async def fail(label: str) -> None:
        ran.append(label)
        raise RuntimeError(label)

    declared: list[tuple[str, Any]] = [
        ("aktionen", partial(succeed, "aktionen opens the first lane")),
        ("bewerbungen", partial(fail, "declared second")),
        ("aktionen", partial(fail, "declared third")),
    ]

    with pytest.raises(RuntimeError) as raised:
        asyncio.run(_apply_concurrently(declared))

    # The premise, not a detail: one failure orders nothing, and the first lane has to be the one
    # holding the later-declared of the two.
    assert {"declared second", "declared third"} <= set(ran)
    assert str(raised.value) == "declared second"
