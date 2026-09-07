from typing import Any, Mapping

import pytest

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


def missing_keys(schema: Mapping[str, Any], document: Mapping[str, Any], prefix: str = "") -> list[str]:
    """Read off the validator's own `required` lists rather than a transcription that could drift from them.

    Types and enums are not read again here: pairing a validator with its model is
    `tests/core/test_constraints.py`'s.
    """

    absent = [f"{prefix}{key}" for key in schema.get("required", ()) if key not in document]

    for key, sub_schema in schema.get("properties", {}).items():
        value = document.get(key)
        # A null satisfies a nullable object, which is why the sub-schema is walked over values that
        # ARE objects -- exactly as MongoDB applies `required`.
        if isinstance(value, Mapping) and "required" in sub_schema:
            absent.extend(missing_keys(sub_schema, value, f"{prefix}{key}."))

    return absent


def refused(collection: Collection, document: Mapping[str, Any]) -> list[str]:
    schema = COLLECTION_VALIDATORS[collection]["$jsonSchema"]

    return [key for key in missing_keys(schema, document) if key not in DRIVER_SUPPLIED]


@pytest.mark.parametrize(("collection", "documents"), SEEDED)
def test_every_seeded_row_is_a_shape_the_collection_would_store(collection: Collection, documents: list[dict[str, Any]]):
    """The corpus the pipeline suites walk, held to the shipped validator.

    A stage added on a key the corpus omits is proved by nothing, and one that works only because a
    key is absent fails on a real season.
    """

    assert documents, f"the {collection} corpus is empty, so the sweep below holds of nothing"

    offenders = {index: absent for index, document in enumerate(documents) if (absent := refused(collection, document))}

    assert not offenders, f"rows of {collection}, by their position in the seed, leave out required keys: {offenders}"


def test_a_row_that_lost_a_required_key_is_named():
    """The control: without it the walk could report nothing for every corpus and read as green."""

    stripped = {key: value for key, value in SPIELE[0].items() if key != "saison_id"}

    assert refused(Collection.SPIELE, stripped) == ["saison_id"]


def test_an_embedded_side_that_lost_a_required_key_is_named():
    """An embedded side is where a required key is easiest to leave out, and a walk stopping at the top level passes over it."""

    side = {key: value for key, value in dict(SPIELE[0]["team1"]).items() if key != "shorthand"}

    assert refused(Collection.SPIELE, {**SPIELE[0], "team1": side}) == ["team1.shorthand"]
