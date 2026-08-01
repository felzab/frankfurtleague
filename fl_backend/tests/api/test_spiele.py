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
    """The positive baseline for the whole module."""
    parsed = FLSpiel.model_validate(spiel())
    assert parsed.ergebnis == "2:1"
    assert parsed.saison_id == "2026"


@pytest.mark.parametrize("ergebnis", ["0:0", "3:1", "10:12", "100:0"])
def test_accepts_a_well_formed_result(spiel, ergebnis):
    """Including `0:0` and multi-digit scores — nil-nil must not be confused with "no result"."""
    assert FLSpiel.model_validate(spiel(ergebnis=ergebnis)).ergebnis == ergebnis


@pytest.mark.parametrize("ergebnis", ["3", "", ":", "3:", ":1", "1:2:3", "abc", "x:y", "3-1", " 3:1", "-1:2"])
def test_rejects_a_malformed_result(spiel, ergebnis):
    """Eleven near-misses. `":"` and `"3:"` are the ones that matter: split-and-Number reads them as 0:0 and a win."""
    with pytest.raises(ValidationError):
        FLSpiel.model_validate(spiel(ergebnis=ergebnis))


def test_accepts_a_null_result_for_an_unplayed_match(spiel):
    """`None` is the only legal way to say "not played yet" — distinct from any string."""
    assert FLSpiel.model_validate(spiel(ergebnis=None)).ergebnis is None


@pytest.mark.parametrize("spiel_nr", [0, -1])
def test_rejects_a_non_positive_match_number(spiel, spiel_nr):
    """Zero and negative. Match numbers are 1-based and used for ordering."""
    with pytest.raises(ValidationError):
        FLSpiel.model_validate(spiel(spiel_nr=spiel_nr))


@pytest.mark.parametrize("saison_id", ["202", "20266", ""])
def test_rejects_a_season_id_that_is_not_four_characters(spiel, saison_id):
    """Four characters exactly. A longer id validates on the season and then breaks every match referencing it."""
    with pytest.raises(ValidationError):
        FLSpiel.model_validate(spiel(saison_id=saison_id))


def test_rejects_a_date_that_does_not_exist(spiel):
    """A calendar check behind the regex: 2026-02-31 matches the pattern and is not a real day."""
    with pytest.raises(ValidationError):
        FLSpiel.model_validate(spiel(datum="2026-02-31"))


def test_rejects_a_time_without_seconds(spiel):
    """Seconds are mandatory. The frontend once sent `14:30` and the API answered 422."""
    with pytest.raises(ValidationError):
        FLSpiel.model_validate(spiel(uhrzeit="14:30"))


def test_accepts_a_match_with_no_date_venue_or_referee(spiel):
    """A fixture can exist before it is scheduled — all four of those fields are nullable together."""
    parsed = FLSpiel.model_validate(spiel(datum=None, uhrzeit=None, ort=None, schiedsrichter=None))
    assert parsed.datum is None
    assert parsed.ort is None


class TestEmbeddedFields:
    def test_rejects_a_negative_goal_count(self, spiel, spiel_team_field):
        """Goals are `ge=0`; a negative count would flow straight into a team's statistics."""
        with pytest.raises(ValidationError):
            FLSpiel.model_validate(spiel(team1=spiel_team_field(tore=-1)))

    def test_accepts_a_null_goal_count(self, spiel, spiel_team_field):
        """`None` means unplayed and is distinct from `0` — the statistics arithmetic depends on the difference."""
        assert FLSpiel.model_validate(spiel(team1=spiel_team_field(tore=None))).team1.tore is None

    def test_rejects_a_negative_referee_payment(self, spiel, spiel_schiedsrichter_field):
        """The fee is `ge=0`, matching the venue rent beside it."""
        with pytest.raises(ValidationError):
            FLSpiel.model_validate(spiel(schiedsrichter=spiel_schiedsrichter_field(payment=-1)))

    @pytest.mark.parametrize("field", ["name", "maps_link"])
    def test_rejects_an_empty_venue_string(self, spiel, spiel_ort_field, field):
        """A venue embedded on a match must be renderable: neither its name nor its maps link may be blank."""
        with pytest.raises(ValidationError):
            FLSpiel.model_validate(spiel(ort=spiel_ort_field(**{field: ""})))

    # Owner decision: a rental price is whole euros. Stored values were float in 12 of 31
    # documents, but every one was integral -- Pydantic coerces those and rejects a fraction.
    def test_coerces_an_integral_float_rent(self, spiel, spiel_ort_field):
        """Historic documents stored the rent as a float. Integral values coerce rather than failing the read path."""
        parsed = FLSpiel.model_validate(spiel(ort=spiel_ort_field(mietpreis=80.0)))

        assert parsed.ort is not None
        assert parsed.ort.mietpreis == 80

    def test_rejects_a_fractional_rent(self, spiel, spiel_ort_field):
        """The other half of the coercion rule: a real fraction is an error, not something to round."""
        with pytest.raises(ValidationError):
            FLSpiel.model_validate(spiel(ort=spiel_ort_field(mietpreis=80.5)))

    def test_rejects_a_negative_rent(self, spiel, spiel_ort_field):
        """`ge=0` on the rent, as on every other money field."""
        with pytest.raises(ValidationError):
            FLSpiel.model_validate(spiel(ort=spiel_ort_field(mietpreis=-1)))

    # mietpreis must be REQUIRED, not defaulted. The admin PATCH writes this payload back wholesale
    # with $set, so a default let a request omitting the field silently overwrite a venue's stored
    # rent with 0 -- while the sibling `payment` correctly 422'd in the same situation.
    @pytest.mark.parametrize("field", ["mietpreis", "name", "maps_link", "spielort_id"])
    def test_requires_every_venue_field(self, spiel, spiel_ort_field, field):
        """No field may have a DEFAULT: the admin PATCH writes wholesale, so a default silently overwrites a real rent with 0."""
        incomplete = spiel_ort_field()
        del incomplete[field]

        with pytest.raises(ValidationError) as excinfo:
            FLSpiel.model_validate(spiel(ort=incomplete))

        assert excinfo.value.errors()[0]["loc"][-1] == field

    def test_requires_every_referee_field(self, spiel, spiel_schiedsrichter_field):
        """The same rule for the referee fee, which is the field that behaved correctly while the rent did not."""
        incomplete = spiel_schiedsrichter_field()
        del incomplete["payment"]

        with pytest.raises(ValidationError) as excinfo:
            FLSpiel.model_validate(spiel(schiedsrichter=incomplete))

        assert excinfo.value.errors()[0]["loc"][-1] == "payment"


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
        """The write model accepts what the read model produces — the two are composed from the same field types."""
        assert FLPatchSpielDataPayload.model_validate(self._payload(spiel)).datum == "2026-03-15"

    def test_coerces_empty_strings_to_none(self, spiel):
        """A cleared form field arrives as `""` and must mean "unset", not fail validation."""
        parsed = FLPatchSpielDataPayload.model_validate(self._payload(spiel, datum="", uhrzeit=""))
        assert parsed.datum is None
        assert parsed.uhrzeit is None

    def test_rejects_a_time_without_seconds(self, spiel):
        """The write path enforces the same time format as the read path, rather than relaxing it."""
        with pytest.raises(ValidationError):
            FLPatchSpielDataPayload.model_validate(self._payload(spiel, uhrzeit="14:30"))
