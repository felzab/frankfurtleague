from typing import Any, Mapping, get_args

import pytest
from pydantic import BaseModel
from pydantic.fields import FieldInfo
from pymongo.errors import OperationFailure

from app.api.aktionen.schemas import FLAktion, FLAktionRequest, FLAktor
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
    FLTrikotFarbe,
)
from app.core.collections import Collection
from app.core.constraints import _AKTION_OPERATIONS, _AKTOR_KINDS, COLLECTION_VALIDATORS, UNIQUE_INDEXES, diagnose_failure
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
    (Collection.AKTIONEN, (), FLAktion, frozenset()),
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
