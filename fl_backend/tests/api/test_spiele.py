from typing import Any, get_args

import pytest
from bson import ObjectId
from pydantic import ValidationError

from app.api.spiele.schemas import (
    FLPatchSpielDataPayload,
    FLSpiel,
    FLSpielortFieldPayload,
    FLSpielSchiedsrichterFieldPayload,
    FLSpielTeamFieldPayload,
    is_unplayed,
    unplayed_filter,
)
from app.core.collections import Collection
from app.shared.schemas.literals import FLSonderereignis
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop
from tests.payloads import spiel_patch_body
from tests.worker import worker_database

UNPLAYED_DATABASE_NAME = worker_database("fl_spiele_unplayed_test")
SPIELTAG_ID = ObjectId("6890a1b2c3d4e5f607e70001")
HOME, AWAY = ObjectId("6890a1b2c3d4e5f607e70011"), ObjectId("6890a1b2c3d4e5f607e70012")


@pytest.mark.parametrize("ergebnis", ["3", "", ":", "3:", ":1", "1:2:3", "abc", "x:y", "3-1", " 3:1", "-1:2"])
def test_rejects_a_malformed_result(spiel, ergebnis):
    """A bare `:` and a trailing `3:` are load-bearing: the frontend splits this string for win/draw/loss."""
    with pytest.raises(ValidationError):
        FLSpiel.model_validate(spiel(ergebnis=ergebnis))


@pytest.mark.db
def test_the_unplayed_filter_selects_what_the_predicate_answers(mongo_replica_set_url: str):
    """Every event, with a result and without: the retirements select with the filter, and the booking rule weighs with the predicate."""

    cases = [(ergebnis, sonderereignis) for ergebnis in (None, "1:0") for sonderereignis in (None, *get_args(FLSonderereignis.__value__))]
    ids = [ObjectId() for _ in cases]

    def stored(nr: int, ergebnis: str | None, sonderereignis: str | None) -> dict[str, Any]:
        """One fixture as a save leaves it, its two clubs' goals the result's."""

        tore = (None, None) if ergebnis is None else (1, 0)
        return documents.spiel_document(
            spiel_id=ids[nr],
            saison_id="2026",
            spiel_nr=nr + 1,
            spieltag_id=SPIELTAG_ID,
            team1={"team_id": HOME, "tore": tore[0]},
            team2={"team_id": AWAY, "tore": tore[1]},
            ergebnis=ergebnis,
            sonderereignis=sonderereignis,
        )

    async def selected() -> set[int]:
        async with a_clean_database(mongo_replica_set_url, UNPLAYED_DATABASE_NAME) as (_, database):
            spiele = database[Collection.SPIELE]
            await spiele.insert_many([stored(nr, ergebnis, event) for nr, (ergebnis, event) in enumerate(cases)])

            return {ids.index(row["_id"]) for row in await spiele.find(unplayed_filter(), {"_id": 1}).to_list(length=None)}

    answered = {nr for nr, (ergebnis, event) in enumerate(cases) if is_unplayed(ergebnis=ergebnis, sonderereignis=event)}

    assert answered and len(answered) < len(cases), "the predicate answers every case alike, so agreeing with it proves nothing"
    assert on_the_seed_loop(selected()) == answered


class TestShootout:
    """A scoreline of its own, never a third number in `ergebnis`: both ends parse that string for win/draw/loss."""

    def test_rejects_a_level_shootout(self, spiel, assert_rejects):
        """The one value the field could hold and still name nobody."""
        assert_rejects(FLSpiel, spiel(ergebnis="2:2", elfmeterschiessen={"team1": 3, "team2": 3}), "elfmeterschiessen")


class TestPatchPayload:
    """The admin write path. Its empty-string coercion is what lets the form clear a field."""

    def _payload(self, spiel_factory, **overrides):
        return spiel_patch_body(spiel_factory(), **overrides)

    def test_requires_the_shootout_field(self, spiel):
        """An omitted key is written as an overwrite, so this would retract a recorded shoot-out on the next kick-off edit."""
        incomplete = self._payload(spiel)
        del incomplete["elfmeterschiessen"]

        with pytest.raises(ValidationError) as excinfo:
            FLPatchSpielDataPayload.model_validate(incomplete)

        assert excinfo.value.errors()[0]["loc"][-1] == "elfmeterschiessen"

    @pytest.mark.parametrize("field", ["team1_quelle", "team2_quelle"])
    def test_requires_the_source_fields(self, spiel, field):
        """The handler writes back wholesale with `$set`, so an omitted source erases a bracket's wiring on the next edit."""
        incomplete = self._payload(spiel)
        del incomplete[field]

        with pytest.raises(ValidationError) as excinfo:
            FLPatchSpielDataPayload.model_validate(incomplete)

        assert excinfo.value.errors()[0]["loc"][-1] == field

    @pytest.mark.parametrize(
        ("model", "composed"),
        [
            (FLSpielTeamFieldPayload, {"name", "shorthand"}),
            (FLSpielortFieldPayload, {"name", "maps_link"}),
            (FLSpielSchiedsrichterFieldPayload, {"name"}),
        ],
        ids=["a side", "a venue", "a referee"],
    )
    def test_a_display_copy_is_on_no_payload(self, model, composed):
        """The server composes each from the row it belongs to, so a copy a client typed could only disagree with it."""

        assert not composed & set(model.model_fields)
