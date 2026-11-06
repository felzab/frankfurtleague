from typing import get_args

import pytest
from pydantic import ValidationError

from app.api.spiele.schemas import (
    SONDEREREIGNIS_KEEPING_ITS_SLOT,
    FLPatchSpielDataPayload,
    FLSpiel,
    FLSpielortFieldPayload,
    FLSpielQuelleSpiel,
    FLSpielSchiedsrichterFieldPayload,
    FLSpielTeamFieldPayload,
    is_unplayed,
    unplayed_filter,
)
from app.core.collections import Collection
from app.shared.schemas.literals import FLSonderereignis
from tests.database import a_clean_database, on_the_seed_loop
from tests.payloads import spiel_patch_body
from tests.worker import worker_database

UNPLAYED_DATABASE_NAME = worker_database("fl_spiele_unplayed_test")


@pytest.mark.parametrize("ergebnis", ["3", "", ":", "3:", ":1", "1:2:3", "abc", "x:y", "3-1", " 3:1", "-1:2"])
def test_rejects_a_malformed_result(spiel, ergebnis):
    """A bare `:` and a trailing `3:` are load-bearing: the frontend splits this string for win/draw/loss."""
    with pytest.raises(ValidationError):
        FLSpiel.model_validate(spiel(ergebnis=ergebnis))


def test_rejects_a_date_that_does_not_exist(spiel):
    """A calendar check behind the regex: the value matches the pattern and is not a real day."""
    with pytest.raises(ValidationError):
        FLSpiel.model_validate(spiel(date="2026-02-31"))


def test_rejects_a_time_without_seconds(spiel):
    """Seconds are mandatory: a frontend sending `14:30` gets a 422."""
    with pytest.raises(ValidationError):
        FLSpiel.model_validate(spiel(time="14:30"))


def test_an_abandoned_spiel_keeps_its_slot_and_a_called_off_one_frees_it():
    """The booking read's own question: an abandoned match used the ground and the referee; a match called off freed both."""

    assert "abgebrochen" in SONDEREREIGNIS_KEEPING_ITS_SLOT
    assert "ausgefallen" not in SONDEREREIGNIS_KEEPING_ITS_SLOT


@pytest.mark.db
def test_the_unplayed_filter_selects_what_the_predicate_answers(mongo_url: str):
    """Every event, with a result and without: the retirements select with the filter, and the booking rule weighs with the predicate.

    Unconstrained, because only the two fields the partition reads are stored.
    """

    cases = [(ergebnis, sonderereignis) for ergebnis in (None, "1:0") for sonderereignis in (None, *get_args(FLSonderereignis.__value__))]

    async def selected() -> set[int]:
        async with a_clean_database(mongo_url, UNPLAYED_DATABASE_NAME, constraints=False) as (_, database):
            spiele = database[Collection.SPIELE]
            await spiele.insert_many([{"_id": nr, "ergebnis": ergebnis, "sonderereignis": event} for nr, (ergebnis, event) in enumerate(cases)])

            return {row["_id"] for row in await spiele.find(unplayed_filter(), {"_id": 1}).to_list(length=None)}

    answered = {nr for nr, (ergebnis, event) in enumerate(cases) if is_unplayed(ergebnis=ergebnis, sonderereignis=event)}

    assert answered and len(answered) < len(cases), "the predicate answers every case alike, so agreeing with it proves nothing"
    assert on_the_seed_loop(selected()) == answered


class TestUnresolvedSides:
    """Nothing pairs `teamN` with `teamN_quelle`: every combination validates, and a reader renders whichever it has."""

    def test_keeps_the_source_once_the_team_arrives(self, spiel):
        """A source is a fact about the fixture, not a stand-in: keeping it is what lets the slot be recomputed."""
        parsed = FLSpiel.model_validate(spiel(team1_quelle={"type": "spiel", "spiel_nr": 25, "ausgang": "sieger"}))

        assert parsed.team1 is not None
        assert parsed.team1_quelle == FLSpielQuelleSpiel(type="spiel", spiel_nr=25, ausgang="sieger")


class TestShootout:
    """A scoreline of its own, never a third number in `ergebnis`: both ends parse that string for win/draw/loss."""

    def test_rejects_a_level_shootout(self, spiel, assert_rejects):
        """The one value the field could hold and still name nobody."""
        assert_rejects(FLSpiel, spiel(ergebnis="2:2", elfmeterschiessen={"team1": 3, "team2": 3}), "elfmeterschiessen")

    @pytest.mark.parametrize("field", ["team1", "team2"])
    def test_requires_both_sides_of_the_shootout(self, spiel, assert_rejects, field):
        """One count alone names a winner only by assuming what the other one was."""
        shootout = {"team1": 4, "team2": 3}
        del shootout[field]

        assert_rejects(FLSpiel, spiel(ergebnis="2:2", elfmeterschiessen=shootout), field)


class TestPatchPayload:
    """The admin write path. Its empty-string coercion is what lets the form clear a field."""

    def _payload(self, spiel_factory, **overrides):
        return spiel_patch_body(spiel_factory(), **overrides)

    def test_rejects_a_time_without_seconds(self, spiel):
        """The write path enforces the read path's format rather than relaxing it."""
        with pytest.raises(ValidationError):
            FLPatchSpielDataPayload.model_validate(self._payload(spiel, time="14:30"))

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

    @pytest.mark.parametrize(
        ("model", "kept"),
        [(FLSpielortFieldPayload, "mietpreis"), (FLSpielSchiedsrichterFieldPayload, "payment")],
        ids=["the rent", "the payment"],
    )
    def test_what_this_spiel_pays_stays_on_the_payload(self, model, kept):
        """Deliberately unlike the names beside it: each is this fixture's own record, not a copy of a default."""

        assert kept in model.model_fields

    def test_a_submitted_side_name_never_reaches_the_payload(self, spiel):
        """The other end of the same claim, on the one block that still takes a key it does not declare.

        The stored side EXTENDS this payload, so refusing here would 500 a fixture read.
        """

        parsed = FLPatchSpielDataPayload.model_validate(self._payload(spiel))

        assert parsed.team1 is not None and not hasattr(parsed.team1, "name")
