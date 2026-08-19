import pytest
from pydantic import ValidationError

from app.api.spiele.schemas import (
    FLPatchSpielDataPayload,
    FLSpiel,
    FLSpielElfmeterschiessen,
    FLSpielQuelleGruppe,
    FLSpielQuelleSpiel,
)


def test_accepts_a_valid_spiel(spiel):
    parsed = FLSpiel.model_validate(spiel())
    assert parsed.ergebnis == "2:1"
    assert parsed.saison_id == "2026"


@pytest.mark.parametrize("ergebnis", ["0:0", "3:1", "10:12", "100:0"])
def test_accepts_a_well_formed_result(spiel, ergebnis):
    """`0:0` is load-bearing: nil-nil must not read as no result."""
    assert FLSpiel.model_validate(spiel(ergebnis=ergebnis)).ergebnis == ergebnis


@pytest.mark.parametrize("ergebnis", ["3", "", ":", "3:", ":1", "1:2:3", "abc", "x:y", "3-1", " 3:1", "-1:2"])
def test_rejects_a_malformed_result(spiel, ergebnis):
    """A bare `:` and a trailing `3:` are load-bearing: the frontend splits this string for win/draw/loss."""
    with pytest.raises(ValidationError):
        FLSpiel.model_validate(spiel(ergebnis=ergebnis))


def test_accepts_a_null_result_for_an_unplayed_match(spiel):
    assert FLSpiel.model_validate(spiel(ergebnis=None)).ergebnis is None


@pytest.mark.parametrize("spiel_nr", [0, -1])
def test_rejects_a_non_positive_match_number(spiel, spiel_nr):
    """Match numbers are 1-based and used for ordering."""
    with pytest.raises(ValidationError):
        FLSpiel.model_validate(spiel(spiel_nr=spiel_nr))


@pytest.mark.parametrize("saison_id", ["202", "20266", ""])
def test_rejects_a_season_id_that_is_not_four_characters(spiel, saison_id):
    """A longer id validates on the season and then breaks every match referencing it."""
    with pytest.raises(ValidationError):
        FLSpiel.model_validate(spiel(saison_id=saison_id))


def test_rejects_a_date_that_does_not_exist(spiel):
    """A calendar check behind the regex: the value matches the pattern and is not a real day."""
    with pytest.raises(ValidationError):
        FLSpiel.model_validate(spiel(datum="2026-02-31"))


def test_rejects_a_time_without_seconds(spiel):
    """Seconds are mandatory: a frontend sending `14:30` gets a 422."""
    with pytest.raises(ValidationError):
        FLSpiel.model_validate(spiel(uhrzeit="14:30"))


def test_accepts_a_match_with_no_date_venue_or_referee(spiel):
    """A fixture exists before it is scheduled, so those fields are nullable together."""
    parsed = FLSpiel.model_validate(spiel(datum=None, uhrzeit=None, ort=None, schiedsrichter=None))
    assert parsed.datum is None
    assert parsed.ort is None


class TestUnresolvedSides:
    """Nothing pairs `teamN` with `teamN_quelle`: every combination validates, and a reader renders whichever it has."""

    def test_accepts_a_fixture_whose_opponent_is_not_yet_known(self, spiel):
        parsed = FLSpiel.model_validate(spiel(team1=None, team1_quelle={"type": "spiel", "spiel_nr": 25, "ausgang": "sieger"}, ergebnis=None))

        assert parsed.team1 is None
        assert parsed.team1_quelle == FLSpielQuelleSpiel(type="spiel", spiel_nr=25, ausgang="sieger")

    def test_keeps_the_source_once_the_team_arrives(self, spiel):
        """A source is a fact about the fixture, not a stand-in: keeping it is what lets the slot be recomputed."""
        parsed = FLSpiel.model_validate(spiel(team1_quelle={"type": "spiel", "spiel_nr": 25, "ausgang": "sieger"}))

        assert parsed.team1 is not None
        assert parsed.team1_quelle == FLSpielQuelleSpiel(type="spiel", spiel_nr=25, ausgang="sieger")

    def test_accepts_a_slot_seeded_from_the_group_phase(self, spiel):
        """The first knockout round is always fed by the standings, so the model has to say so."""
        parsed = FLSpiel.model_validate(spiel(team1=None, team1_quelle={"type": "gruppe", "gruppe": "B", "platz": 2}, ergebnis=None))

        assert parsed.team1_quelle == FLSpielQuelleGruppe(type="gruppe", gruppe="B", platz=2)

    def test_accepts_a_slot_with_neither_a_team_nor_a_label(self, spiel):
        """An opponent not entered yet, or a slot an admin took manual charge of by clearing its source."""
        parsed = FLSpiel.model_validate(spiel(team1=None, team1_quelle=None, ergebnis=None))

        assert parsed.team1 is None
        assert parsed.team1_quelle is None

    @pytest.mark.parametrize("field", ["team1_quelle", "team2_quelle"])
    def test_requires_the_source_field_to_be_present(self, spiel, field):
        """Nullable and required: a default would let a document that never carried the key read as `None`."""
        incomplete = spiel()
        del incomplete[field]

        with pytest.raises(ValidationError) as excinfo:
            FLSpiel.model_validate(incomplete)

        assert excinfo.value.errors()[0]["loc"][-1] == field


class TestShootout:
    """A scoreline of its own, never a third number in `ergebnis`: both ends parse that string for win/draw/loss."""

    def test_accepts_a_level_knockout_settled_on_penalties(self, spiel):
        parsed = FLSpiel.model_validate(spiel(ergebnis="2:2", elfmeterschiessen={"team1": 4, "team2": 3}))

        assert parsed.elfmeterschiessen == FLSpielElfmeterschiessen(team1=4, team2=3)

    def test_accepts_a_null_shootout(self, spiel):
        assert FLSpiel.model_validate(spiel()).elfmeterschiessen is None

    def test_rejects_a_level_shootout(self, spiel, assert_rejects):
        """The one value the field could hold and still name nobody."""
        assert_rejects(FLSpiel, spiel(ergebnis="2:2", elfmeterschiessen={"team1": 3, "team2": 3}), "elfmeterschiessen")

    def test_rejects_a_negative_shootout_count(self, spiel, assert_rejects):
        assert_rejects(FLSpiel, spiel(ergebnis="2:2", elfmeterschiessen={"team1": -1, "team2": 3}), "team1")

    @pytest.mark.parametrize("field", ["team1", "team2"])
    def test_requires_both_sides_of_the_shootout(self, spiel, assert_rejects, field):
        """One count alone names a winner only by assuming what the other one was."""
        shootout = {"team1": 4, "team2": 3}
        del shootout[field]

        assert_rejects(FLSpiel, spiel(ergebnis="2:2", elfmeterschiessen=shootout), field)

    def test_requires_the_shootout_field_to_be_present(self, spiel):
        """Nullable and required, as `teamN_quelle` is: a default makes `constraints.py --check` report clean while the key is missing."""
        incomplete = spiel()
        del incomplete["elfmeterschiessen"]

        with pytest.raises(ValidationError) as excinfo:
            FLSpiel.model_validate(incomplete)

        assert excinfo.value.errors()[0]["loc"][-1] == "elfmeterschiessen"


class TestEmbeddedFields:
    def test_rejects_a_negative_goal_count(self, spiel, spiel_team_field):
        """Goals are `ge=0`; a negative count would flow straight into a team's statistics."""
        with pytest.raises(ValidationError):
            FLSpiel.model_validate(spiel(team1=spiel_team_field(tore=-1)))

    def test_accepts_a_null_goal_count(self, spiel, spiel_team_field):
        """`None` means unplayed and is distinct from `0`: the derived table counts a 0 and skips a null."""
        parsed = FLSpiel.model_validate(spiel(team1=spiel_team_field(tore=None)))

        assert parsed.team1 is not None
        assert parsed.team1.tore is None

    def test_rejects_a_negative_referee_payment(self, spiel, spiel_schiedsrichter_field):
        with pytest.raises(ValidationError):
            FLSpiel.model_validate(spiel(schiedsrichter=spiel_schiedsrichter_field(payment=-1)))

    @pytest.mark.parametrize("field", ["name", "maps_link"])
    def test_rejects_an_empty_venue_string(self, spiel, spiel_ort_field, field):
        with pytest.raises(ValidationError):
            FLSpiel.model_validate(spiel(ort=spiel_ort_field(**{field: ""})))

    # A rental price is whole euros; some stored values are integral floats, which Pydantic coerces.
    def test_coerces_an_integral_float_rent(self, spiel, spiel_ort_field):
        parsed = FLSpiel.model_validate(spiel(ort=spiel_ort_field(mietpreis=80.0)))

        assert parsed.ort is not None
        assert parsed.ort.mietpreis == 80

    def test_rejects_a_fractional_rent(self, spiel, spiel_ort_field):
        """The other half of the coercion rule: a real fraction is an error, not something to round."""
        with pytest.raises(ValidationError):
            FLSpiel.model_validate(spiel(ort=spiel_ort_field(mietpreis=80.5)))

    def test_rejects_a_negative_rent(self, spiel, spiel_ort_field):
        with pytest.raises(ValidationError):
            FLSpiel.model_validate(spiel(ort=spiel_ort_field(mietpreis=-1)))

    @pytest.mark.parametrize("field", ["mietpreis", "name", "maps_link", "spielort_id"])
    def test_requires_every_venue_field(self, spiel, spiel_ort_field, field):
        """No field may have a default: the admin PATCH writes wholesale, so a default overwrites a real rent with 0."""
        incomplete = spiel_ort_field()
        del incomplete[field]

        with pytest.raises(ValidationError) as excinfo:
            FLSpiel.model_validate(spiel(ort=incomplete))

        assert excinfo.value.errors()[0]["loc"][-1] == field

    def test_requires_every_referee_field(self, spiel, spiel_schiedsrichter_field):
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
            "team1_quelle": base["team1_quelle"],
            "team2_quelle": base["team2_quelle"],
            "elfmeterschiessen": base["elfmeterschiessen"],
            "datum": base["datum"],
            "uhrzeit": base["uhrzeit"],
            "ort": base["ort"],
            "schiedsrichter": base["schiedsrichter"],
            "notiz": base.get("notiz"),
            **overrides,
        }

    def test_accepts_a_valid_payload(self, spiel):
        assert FLPatchSpielDataPayload.model_validate(self._payload(spiel)).datum == "2026-03-15"

    def test_coerces_empty_strings_to_none(self, spiel):
        """A cleared form field arrives empty and must mean unset, not fail validation."""
        parsed = FLPatchSpielDataPayload.model_validate(self._payload(spiel, datum="", uhrzeit=""))
        assert parsed.datum is None
        assert parsed.uhrzeit is None

    def test_rejects_a_time_without_seconds(self, spiel):
        """The write path enforces the read path's format rather than relaxing it."""
        with pytest.raises(ValidationError):
            FLPatchSpielDataPayload.model_validate(self._payload(spiel, uhrzeit="14:30"))

    def test_requires_the_shootout_field(self, spiel):
        """An omitted key is written as an overwrite, so this would retract a recorded shoot-out on the next kick-off edit."""
        incomplete = self._payload(spiel)
        del incomplete["elfmeterschiessen"]

        with pytest.raises(ValidationError) as excinfo:
            FLPatchSpielDataPayload.model_validate(incomplete)

        assert excinfo.value.errors()[0]["loc"][-1] == "elfmeterschiessen"

    def test_accepts_a_shootout_on_the_payload(self, spiel):
        """The write path is the only way a shoot-out is ever recorded, so it has to carry one."""
        parsed = FLPatchSpielDataPayload.model_validate(self._payload(spiel, elfmeterschiessen={"team1": 4, "team2": 3}))

        assert parsed.elfmeterschiessen == FLSpielElfmeterschiessen(team1=4, team2=3)

    @pytest.mark.parametrize("field", ["team1_quelle", "team2_quelle"])
    def test_requires_the_source_fields(self, spiel, field):
        """The handler writes back wholesale with `$set`, so an omitted source erases a bracket's wiring on the next edit."""
        incomplete = self._payload(spiel)
        del incomplete[field]

        with pytest.raises(ValidationError) as excinfo:
            FLPatchSpielDataPayload.model_validate(incomplete)

        assert excinfo.value.errors()[0]["loc"][-1] == field

    def test_accepts_an_unresolved_side(self, spiel):
        """The write path can put a fixture back into the unresolved state, not only read one out of it."""
        quelle = {"type": "spiel", "spiel_nr": 25, "ausgang": "sieger"}
        parsed = FLPatchSpielDataPayload.model_validate(self._payload(spiel, team1=None, team1_quelle=quelle))

        assert parsed.team1 is None
        assert parsed.team1_quelle == FLSpielQuelleSpiel(type="spiel", spiel_nr=25, ausgang="sieger")

    def test_rejects_a_source_whose_keys_belong_to_the_other_variant(self, spiel, assert_rejects):
        """The tag is what makes this an error rather than a silently half-populated source."""
        mismatched = {"type": "gruppe", "spiel_nr": 25, "ausgang": "sieger"}

        assert_rejects(FLPatchSpielDataPayload, self._payload(spiel, team1=None, team1_quelle=mismatched), "gruppe")
