"""
FLSpiel and its embedded field models.

`ergebnis` is the important one. It is parsed as structured data by the frontend, which derives
win/draw/loss from it — an unconstrained value rendered as a loss for BOTH teams (audit R3a-B1.2).
BE-2 added `ge=0` to `tore`; Wave 4 added the pattern that makes `\\d+` provably safe.
"""

import pytest
from pydantic import ValidationError

from app.api.spiele.schemas import FLPatchSpielDataPayload, FLSpiel


def test_accepts_a_valid_spiel(spiel):
    parsed = FLSpiel.model_validate(spiel())
    assert parsed.ergebnis == "2:1"
    assert parsed.saison_id == "2026"


@pytest.mark.parametrize("ergebnis", ["0:0", "3:1", "10:12", "100:0"])
def test_accepts_a_well_formed_result(spiel, ergebnis):
    assert FLSpiel.model_validate(spiel(ergebnis=ergebnis)).ergebnis == ergebnis


@pytest.mark.parametrize("ergebnis", ["3", "", ":", "3:", ":1", "1:2:3", "abc", "x:y", "3-1", " 3:1", "-1:2"])
def test_rejects_a_malformed_result(spiel, ergebnis):
    with pytest.raises(ValidationError):
        FLSpiel.model_validate(spiel(ergebnis=ergebnis))


def test_accepts_a_null_result_for_an_unplayed_match(spiel):
    assert FLSpiel.model_validate(spiel(ergebnis=None)).ergebnis is None


@pytest.mark.parametrize("spiel_nr", [0, -1])
def test_rejects_a_non_positive_match_number(spiel, spiel_nr):
    with pytest.raises(ValidationError):
        FLSpiel.model_validate(spiel(spiel_nr=spiel_nr))


@pytest.mark.parametrize("saison_id", ["202", "20266", ""])
def test_rejects_a_season_id_that_is_not_four_characters(spiel, saison_id):
    with pytest.raises(ValidationError):
        FLSpiel.model_validate(spiel(saison_id=saison_id))


def test_rejects_a_date_that_does_not_exist(spiel):
    with pytest.raises(ValidationError):
        FLSpiel.model_validate(spiel(datum="2026-02-31"))


def test_rejects_a_time_without_seconds(spiel):
    with pytest.raises(ValidationError):
        FLSpiel.model_validate(spiel(uhrzeit="14:30"))


def test_accepts_a_match_with_no_date_venue_or_referee(spiel):
    parsed = FLSpiel.model_validate(spiel(datum=None, uhrzeit=None, ort=None, schiedsrichter=None))
    assert parsed.datum is None
    assert parsed.ort is None


class TestEmbeddedFields:
    def test_rejects_a_negative_goal_count(self, spiel, spiel_team_field):
        with pytest.raises(ValidationError):
            FLSpiel.model_validate(spiel(team1=spiel_team_field(tore=-1)))

    def test_accepts_a_null_goal_count(self, spiel, spiel_team_field):
        assert FLSpiel.model_validate(spiel(team1=spiel_team_field(tore=None))).team1.tore is None

    def test_rejects_a_negative_referee_payment(self, spiel, spiel_schiedsrichter_field):
        with pytest.raises(ValidationError):
            FLSpiel.model_validate(spiel(schiedsrichter=spiel_schiedsrichter_field(payment=-1)))

    @pytest.mark.parametrize("field", ["name", "maps_link"])
    def test_rejects_an_empty_venue_string(self, spiel, spiel_ort_field, field):
        with pytest.raises(ValidationError):
            FLSpiel.model_validate(spiel(ort=spiel_ort_field(**{field: ""})))

    # Owner decision: a rental price is whole euros. Stored values were float in 12 of 31
    # documents, but every one was integral -- Pydantic coerces those and rejects a fraction.
    def test_coerces_an_integral_float_rent(self, spiel, spiel_ort_field):
        assert FLSpiel.model_validate(spiel(ort=spiel_ort_field(mietpreis=80.0))).ort.mietpreis == 80

    def test_rejects_a_fractional_rent(self, spiel, spiel_ort_field):
        with pytest.raises(ValidationError):
            FLSpiel.model_validate(spiel(ort=spiel_ort_field(mietpreis=80.5)))

    def test_rejects_a_negative_rent(self, spiel, spiel_ort_field):
        with pytest.raises(ValidationError):
            FLSpiel.model_validate(spiel(ort=spiel_ort_field(mietpreis=-1)))


class TestPatchPayload:
    """The admin write path. Its empty-string coercion is what lets the form clear a field."""

    def _payload(self, spiel_factory, **overrides):
        base = spiel_factory()
        return {
            "spiel_id": base["_id"],
            "is_canceled": base["is_canceled"],
            "team1": base["team1"],
            "team2": base["team2"],
            "datum": base["datum"],
            "uhrzeit": base["uhrzeit"],
            "ort": base["ort"],
            "schiedsrichter": base["schiedsrichter"],
            **overrides,
        }

    def test_accepts_a_valid_payload(self, spiel):
        assert FLPatchSpielDataPayload.model_validate(self._payload(spiel)).datum == "2026-03-15"

    def test_coerces_empty_strings_to_none(self, spiel):
        parsed = FLPatchSpielDataPayload.model_validate(self._payload(spiel, datum="", uhrzeit=""))
        assert parsed.datum is None
        assert parsed.uhrzeit is None

    def test_rejects_a_time_without_seconds(self, spiel):
        with pytest.raises(ValidationError):
            FLPatchSpielDataPayload.model_validate(self._payload(spiel, uhrzeit="14:30"))
