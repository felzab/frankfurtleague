"""The seed builders, each called with nothing but what it requires, as the read-back reads what they answer."""

from collections.abc import Callable
from typing import Any

import pytest
from bson import ObjectId
from pydantic import ValidationError

from app.core.collections import Collection
from app.readback import RECORD_MODELS
from tests import documents

Build = Callable[..., dict[str, Any]]


def _spiel(**fields: Any) -> dict[str, Any]:
    return documents.spiel_document(spiel_id=ObjectId(), saison_id="2026", spiel_nr=1, spieltag_id=ObjectId(), **fields)


def _set_spiel() -> dict[str, Any]:
    """A fixture dated and timed between two clubs, the only kind a confirmation is minted for."""

    sides = {side: {"team_id": ObjectId(), "tore": None} for side in ("team1", "team2")}

    return _spiel(**sides, date="2026-04-25", time="14:00:00")


# Each builder of a whole stored document, keyed by the collection it seeds; every one but the two spelling each of
# their fields lays a call's fields over its own.
BUILDERS: dict[Collection, Build] = {
    Collection.SAISONS: lambda **fields: documents.saison_document("2026", "active", **fields),
    Collection.TEAMS: lambda **fields: documents.team_document(ObjectId(), "Carl", "CSX", **fields),
    Collection.SAISON_TEAMS: lambda **fields: documents.saison_team_document("2026", ObjectId(), "Carl", "CSX", **fields),
    Collection.SPIELE: _spiel,
    Collection.SPIELBESTAETIGUNGEN: lambda **fields: documents.spielbestaetigung_document(
        _set_spiel(), party={"kind": "team", "team_id": ObjectId()}, **fields
    ),
    Collection.SPIELBERICHTE: lambda **fields: documents.spielbericht_document(_spiel(), **fields),
    Collection.SPIELER: lambda **fields: documents.spieler_document(ObjectId(), "Mehmet", "Yilmaz", **fields),
    Collection.BEWERBUNGEN: lambda **fields: documents.bewerbung_document(
        ObjectId(), "2026", "submitted", kontakte=documents.kontakte_document(), submitted_at="2026-01-10", **fields
    ),
    Collection.REGISTRIERUNGEN: lambda **fields: documents.registrierung_document(
        ObjectId(),
        "mehmet@schule.example",
        saison_id="2026",
        team_id=ObjectId(),
        first_name="Mehmet",
        last_name="Yilmaz",
        token="their-link",
        submitted_at="2026-01-10",
        deadline="2026-01-24",
        **fields,
    ),
    Collection.BAN_LIST: lambda **fields: documents.ban_document("mehmet@schule.example", until="2027", **fields),
    Collection.SAISON_SPIELER: lambda **fields: documents.saison_spieler_document(ObjectId(), "2026", ObjectId(), **fields),
    Collection.SCHIEDSRICHTER: lambda **fields: documents.schiedsrichter_document(
        ObjectId(), email="anna@schiri.example", name="Anna", default_payment=20, einwilligung=None, **fields
    ),
    Collection.AUFSTELLUNGEN: lambda: documents.aufstellung_document(_spiel(), ObjectId()),
    Collection.ADDRESS_CHANGES: lambda: documents.address_change_document(
        address="mehmet@schule.example", email="neu@schule.example", token_hash=None, day="2026-01-10"
    ),
}
SPELLED = {Collection.AUFSTELLUNGEN, Collection.ADDRESS_CHANGES}


@pytest.mark.parametrize(("collection", "build"), BUILDERS.items(), ids=[str(collection) for collection in BUILDERS])
def test_a_builders_own_document_reads_back(collection: Collection, build: Build) -> None:
    """The defaults every seed stands on: a field the record model dropped fails here before any case seeds it."""

    RECORD_MODELS[collection].model_validate({"_id": ObjectId(), **build()}, extra="forbid")


@pytest.mark.parametrize(
    "build", [build for collection, build in BUILDERS.items() if collection not in SPELLED], ids=[str(c) for c in BUILDERS if c not in SPELLED]
)
def test_a_field_a_call_lays_over_the_builders_is_read_back_too(build: Build) -> None:
    """So a seed still passing a field its record model dropped fails at that seed, rather than seeding a value no code reads."""

    with pytest.raises(ValidationError):
        build(a_field_no_record_holds=None)
