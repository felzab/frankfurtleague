"""
The declared constraints, checked as data (ADR-0027).

Three separate jobs, and the middle one is the reason this file matters more than its length suggests:

  1. The validators are well-formed — every required field has a declared type, every index names keys
     the validator knows about.
  2. **They have not DRIFTED from the Pydantic models.** A `$jsonSchema` is a third copy of the schema
     after Pydantic and the Zod mirror, and hand-mirroring is this codebase's main drift risk. Both
     copies here are importable Python in one process, so the check is fifteen lines and
     `test_every_mirrored_model_matches_its_validator` is it. Add a field to `FLSpiel` and forget
     `constraints.py`, and the default `pytest` run fails by name. The Zod mirror is checked too, and
     needs a published document as the intermediary to do it (ADR-0040).
  3. The scope ADR-0027 drew is still the scope. Types, presence and enums; no ranges, no patterns, no
     lengths. `test_no_validator_constrains_a_range_or_a_format` is that decision made enforceable,
     because widening it is a one-word edit that would otherwise pass review.

Job 2 is really two checks, and the second was missing until ADR-0061 added two more hand-copied enums
and had to rely on it. `test_every_mirrored_model_matches_its_validator` compares field NAMES and stops
there, so a validator whose `enum` had drifted from its `Literal` passed every test in this file and
failed against the live database instead. `test_every_validator_enum_matches_its_literal` closes that.

The sibling `test_constraints_execution.py` asserts what MongoDB does with all of this. Neither
replaces the other: this file fails when a rule is missing, that one when a rule is present and wrong.
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
from app.api.spieler.services import SAISON_SPIELER_COLLECTION_NAME
from app.api.spielorte.schemas import FLSpielort
from app.api.spieltage.schemas import FLSpieltag
from app.api.teams.schemas import FLDisqualifikation, FLGruppenNames, FLTeam, FLTeamRecord
from app.api.teams.services import SAISON_TEAMS_COLLECTION_NAME
from app.core.constraints import COLLECTION_VALIDATORS, UNIQUE_INDEXES, diagnose_failure
from app.shared.schemas.addresses import FLAddress
from app.shared.schemas.kontakt import FLKontakt

# Every collection the application reads or writes. Written out rather than derived from `db.py`'s
# providers, because two of the nine have no provider -- the junctions are reached through a `$lookup`
# by name -- so a derivation would quietly cover seven and look complete.
EXPECTED_COLLECTIONS = {
    "saisons",
    "teams",
    "saison_teams",
    "spieler",
    "saison_spieler",
    "spiele",
    "spieltage",
    "spielorte",
    "schiedsrichter",
}

# The two collections with no Pydantic model of the ROW. Named here so that giving one a model later
# fails this file rather than silently leaving its validator unmirrored. A model of an EMBEDDED
# sub-document does not take a collection off this list -- `saison_teams.disqualifikation` has one and
# the row around it still does not.
MODELLESS_COLLECTIONS = {SAISON_TEAMS_COLLECTION_NAME, SAISON_SPIELER_COLLECTION_NAME}

# JSON Schema keywords ADR-0027 puts out of scope. Ranges, formats and lengths stay Pydantic's, and a
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

# (collection, path to the sub-schema, model, fields the model has that the DOCUMENT does not).
#
# The fourth element is where the flattening is recorded. `FLTeam` and `FLSpieler` are assembled from
# more than one collection, so they carry fields no single document holds -- and naming them here is
# what keeps this an equality check rather than a subset check that would pass while a real field went
# missing.
MIRRORED_MODELS: list[tuple[str, tuple[str, ...], type[BaseModel] | tuple[type[BaseModel], ...], frozenset[str]]] = [
    ("saisons", (), FLSaison, frozenset()),
    ("saisons", ("rules",), FLSaisonRules, frozenset()),
    ("spiele", (), FLSpiel, frozenset()),
    ("spiele", ("team1",), FLSpielTeamField, frozenset()),
    ("spiele", ("team2",), FLSpielTeamField, frozenset()),
    # A discriminated union, so both variants are named and the validator must declare their union
    # (ADR-0042). `required` on the validator side is `type` alone -- $jsonSchema cannot make a key
    # required only when a sibling holds a particular value, and this test compares field SETS.
    ("spiele", ("team1_quelle",), (FLSpielQuelleGruppe, FLSpielQuelleSpiel), frozenset()),
    ("spiele", ("team2_quelle",), (FLSpielQuelleGruppe, FLSpielQuelleSpiel), frozenset()),
    # No variants, so unlike the two `quelle` fields above this one is covered in full: the validator
    # requires both counts and types both (ADR-0044).
    ("spiele", ("elfmeterschiessen",), FLSpielElfmeterschiessen, frozenset()),
    ("spiele", ("ort",), FLSpielOrtField, frozenset()),
    ("spiele", ("schiedsrichter",), FLSpielSchiedsrichterField, frozenset()),
    # `anzahl_spiele` is derived from the season's rules and this matchday's phase, and is stored
    # nowhere (ADR-0065) -- the same shape `statistik` has on a team two entries down.
    ("spieltage", (), FLSpieltag, frozenset({"anzahl_spiele"})),
    ("spielorte", (), FLSpielort, frozenset()),
    ("spielorte", ("address",), FLAddress, frozenset()),
    ("schiedsrichter", (), FLSchiedsrichter, frozenset()),
    ("schiedsrichter", ("kontakt",), FLKontakt, frozenset()),
    # `gruppe` and `disqualifikation` are joined from saison_teams; `statistik` is derived from spiele
    # and stored nowhere at all (ADR-0026). None of the three is on a teams document.
    ("teams", (), FLTeam, frozenset({"gruppe", "disqualifikation", "statistik"})),
    # The same collection twice, on purpose. `FLTeam` is the READ shape and is allowed to carry three
    # fields no document has; `FLTeamRecord` is what a write echoes, so its field set must match the
    # validator EXACTLY -- an empty `not_stored` is the assertion.
    ("teams", (), FLTeamRecord, frozenset()),
    ("teams", ("address",), FLAddress, frozenset()),
    # Everything but the two names comes from the saison_spieler junction.
    ("spieler", (), FLSpieler, frozenset({"team_id", "stufe", "nummer", "position", "is_nachgetragen", "is_captain"})),
    # The one sub-document of a modelless row that does have a model, so the drift check reaches it
    # (ADR-0059). `FLTeam` embeds it, which is how the record travels from the junction to the reader.
    ("saison_teams", ("disqualifikation",), FLDisqualifikation, frozenset()),
]

# (collection, path to the sub-schema, field, the Literal it must equal, whether null is a member).
#
# Every `enum` any validator declares appears here, and the test below asserts that -- so a seventh
# enum added to `constraints.py` without a row here fails rather than going unchecked.
#
# The two `quelle` entries read their members off a MODEL FIELD rather than a named alias, because
# neither has one: `type` is the discriminator declared inline on each variant, and `ausgang` is
# declared inline on the match-fed variant (ADR-0042). Naming them here would mean adding two aliases
# to the spiele slice for a test's benefit, which is the tail wagging the dog.
MIRRORED_ENUMS: list[tuple[str, tuple[str, ...], str, tuple[object, ...], bool]] = [
    ("saisons", (), "status", get_args(FLSaisonStatus), False),
    # An ARRAY of the league's set: which levels this season runs. Not nullable and not itself a
    # Literal — the members are, which is what this row compares.
    ("saisons", ("rules",), "erlaubte_stufen", get_args(FLSpielerStufe), False),
    ("saison_teams", (), "gruppe", get_args(FLGruppenNames), False),
    ("spiele", (), "saison_phase", get_args(FLSaisonPhase), False),
    ("spieltage", (), "saison_phase", get_args(FLSaisonPhase), False),
    (
        "spiele",
        ("team1_quelle",),
        "type",
        get_args(FLSpielQuelleGruppe.model_fields["type"].annotation) + get_args(FLSpielQuelleSpiel.model_fields["type"].annotation),
        False,
    ),
    ("spiele", ("team1_quelle",), "gruppe", get_args(FLGruppenNames), False),
    ("spiele", ("team1_quelle",), "ausgang", get_args(FLSpielQuelleSpiel.model_fields["ausgang"].annotation), False),
    (
        "spiele",
        ("team2_quelle",),
        "type",
        get_args(FLSpielQuelleGruppe.model_fields["type"].annotation) + get_args(FLSpielQuelleSpiel.model_fields["type"].annotation),
        False,
    ),
    ("spiele", ("team2_quelle",), "gruppe", get_args(FLGruppenNames), False),
    ("spiele", ("team2_quelle",), "ausgang", get_args(FLSpielQuelleSpiel.model_fields["ausgang"].annotation), False),
    # Nullable, because a squad entry is filled in over time (ADR-0061). `None` is a member of the
    # validator's list, which is what lets `enum` stand beside a nullable `bsonType`.
    ("saison_spieler", (), "position", get_args(FLSpielerPosition), True),
    ("saison_spieler", (), "stufe", get_args(FLSpielerStufe), True),
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


def properties_at(collection: str, path: tuple[str, ...]) -> Mapping[str, Any]:
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
    collection: str,
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
    collection: str,
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
    on passing for the seven that have one — the same failure mode `test_only_the_two_junctions_are_unmirrored`
    exists to prevent one level up.
    """

    def walk(schema: Mapping[str, Any], path: tuple[str, ...]) -> set[tuple[str, ...]]:
        """
        Descends `properties` AND `items`, because an enum can sit on either.

        `items` was missed at first and `rules.erlaubte_stufen` is why it no longer is: an array of a
        closed set declares its enum one level below the property, so a walker that only followed
        `properties` reported the whole file checked while that one went unread.
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
def test_every_required_field_declares_a_type(collection: str):
    """A required field with no entry in `properties` asserts presence and nothing about the value."""
    for schema in walk_schemas(COLLECTION_VALIDATORS[collection]["$jsonSchema"]):
        undeclared = set(schema.get("required", [])) - set(schema.get("properties", {}))
        assert not undeclared, f"{collection} requires {sorted(undeclared)} without declaring a bsonType for it"


@pytest.mark.parametrize("collection", sorted(COLLECTION_VALIDATORS))
def test_no_validator_constrains_a_range_or_a_format(collection: str):
    """
    ADR-0027's scope, made enforceable.

    Widening it is a one-word edit and reads as an improvement, which is exactly why it needs a test
    rather than a paragraph. The argument for the line is in the ADR: types, presence and enums are the
    constraints whose violation is silent, and a bad range or length fails Pydantic on the next read.
    """
    for schema in walk_schemas(COLLECTION_VALIDATORS[collection]["$jsonSchema"]):
        out_of_scope = set(schema) & OUT_OF_SCOPE_KEYWORDS
        assert not out_of_scope, f"{collection} uses {sorted(out_of_scope)}, which ADR-0027 leaves to Pydantic"


@pytest.mark.parametrize(
    ("code", "errmsg", "expected"),
    [
        # Atlas, measured 2026-08-02. BOTH of the first two arrive as AtlasError 8000 with nothing but
        # the message to separate them, which is why an earlier code-only rule reported the second as a
        # rejected password and sent the reader to change the wrong thing.
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
