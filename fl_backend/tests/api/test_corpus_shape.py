from collections import defaultdict
from collections.abc import Mapping
from typing import Any

import pytest
from bson import ObjectId

from app.core.collections import Collection
from app.core.constraints import COLLECTION_VALIDATORS

from .conftest import SAISON_TEAMS, SPIELE, TEAMS

# The shared corpus is written into a database carrying no validator at all
# (`tests/conftest.py :: mongo_database`), so nothing else would notice its rows drifting from the
# shape production stores.

# `insert_many` writes an `_id` where a row omits one, so a literal without one is stored complete.
# Every other required key has to be in the literal.
DRIVER_SUPPLIED = frozenset({"_id"})

SEEDED = [
    pytest.param(Collection.TEAMS, TEAMS, id="teams"),
    pytest.param(Collection.SAISON_TEAMS, SAISON_TEAMS, id="saison_teams"),
    pytest.param(Collection.SPIELE, SPIELE, id="spiele"),
]


# What a driver encodes each stored value as, in `isinstance` order rather than by name: `True` is
# an `int`, so a widest-match walk would type every bool as one.
STORES_AS: tuple[tuple[type, str], ...] = (
    (type(None), "null"),
    (bool, "bool"),
    (ObjectId, "objectId"),
    (int, "int"),
    (float, "double"),
    (str, "string"),
    (dict, "object"),
    (list, "array"),
)


def stored_as(value: Any) -> str:
    """Raises rather than passing an unmapped type: it is a decision to take, and a guess shows up nowhere."""

    for python_type, bson_type in STORES_AS:
        if isinstance(value, python_type):
            return bson_type

    raise AssertionError(f"{value!r} has no bsonType in STORES_AS, so no seeded value of its type can be held to one")


def violations(schema: Mapping[str, Any], document: Mapping[str, Any], prefix: str = "") -> list[str]:
    """Read off the validator's own `required` and `bsonType` rather than a transcription that could drift from them.

    Enums are not read, and an array's `items` is never descended -- no swept validator declares one.
    Ranges, lengths and formats stay Pydantic's.
    """

    offences = [f"{prefix}{key}" for key in schema.get("required", ()) if key not in document]

    for key, sub_schema in schema.get("properties", {}).items():
        if key not in document:
            continue

        value = document[key]
        spelled = sub_schema.get("bsonType")
        declared = {spelled} if isinstance(spelled, str) else set(spelled or ())
        stored = stored_as(value)

        if declared and stored not in declared:
            offences.append(f"{prefix}{key} stores {stored}, not {sorted(declared)}")

        # A null satisfies a nullable object, which is why the sub-schema is walked over values that
        # ARE objects -- exactly as MongoDB applies `required`.
        if isinstance(value, Mapping) and "required" in sub_schema:
            offences.extend(violations(sub_schema, value, f"{prefix}{key}."))

    return offences


def refused(collection: Collection, document: Mapping[str, Any]) -> list[str]:
    schema = COLLECTION_VALIDATORS[collection]["$jsonSchema"]

    return [offence for offence in violations(schema, document) if offence not in DRIVER_SUPPLIED]


@pytest.mark.parametrize(("collection", "documents"), SEEDED)
def test_every_seeded_row_is_a_shape_the_collection_would_store(collection: Collection, documents: list[dict[str, Any]]):
    """The corpus the pipeline suites walk, held to the shipped validator.

    A stage added on a key the corpus omits is proved by nothing, and one that works only because a
    key is absent fails on a real season.
    """

    assert documents, f"the {collection} corpus is empty, so the sweep below holds of nothing"

    offenders = {index: found for index, document in enumerate(documents) if (found := refused(collection, document))}

    assert not offenders, f"rows of {collection} the shipped validator would refuse, by their position in the seed: {offenders}"


def test_no_club_is_fielded_twice_among_the_fixtures_sharing_a_spieltag():
    """The one refusal `$jsonSchema` cannot hold: it spans documents rather than living in one.

    A corpus carrying the state `REQ-SPIELTAG-001` refuses is one production could not have stored,
    so a pipeline proved against it is proved against nothing.
    """

    fielded: dict[ObjectId, list[str]] = defaultdict(list)

    for spiel in SPIELE:
        for side in (spiel["team1"], spiel["team2"]):
            if side is not None:
                fielded[spiel["spieltag_id"]].append(side["name"])

    twice = {spieltag: sorted(names) for spieltag, names in fielded.items() if len(set(names)) != len(names)}

    assert not twice, f"clubs fielded more than once on one Spieltag: {twice}"


def test_a_row_that_lost_a_required_key_is_named():
    """The control: without it the walk could report nothing for every corpus and read as green."""

    stripped = {key: value for key, value in SPIELE[0].items() if key != "saison_id"}

    assert refused(Collection.SPIELE, stripped) == ["saison_id"]


def test_a_value_stored_under_the_wrong_bson_type_is_named():
    """A JSON round trip is where an id becomes its 24 characters, and it leaves every `required` key exactly where it was."""

    as_text = {**SPIELE[0], "spieltag_id": str(SPIELE[0]["spieltag_id"])}

    assert refused(Collection.SPIELE, as_text) == ["spieltag_id stores string, not ['objectId']"]


def test_an_embedded_side_that_lost_a_required_key_is_named():
    """An embedded side is where a required key is easiest to leave out, and a walk stopping at the top level passes over it."""

    side = {key: value for key, value in dict(SPIELE[0]["team1"]).items() if key != "shorthand"}

    assert refused(Collection.SPIELE, {**SPIELE[0], "team1": side}) == ["team1.shorthand"]
