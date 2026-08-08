"""
FLSpiel and its embedded field models.

`ergebnis` is the important one. It is parsed as structured data by the frontend, which derives
win/draw/loss from it — an unconstrained value rendered as a loss for BOTH teams.
`ge=0` on `tore` and the pattern that makes `\\d+` provably safe both guard that.
"""

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


class TestUnresolvedSides:
    """
    A bracket slot whose occupant the group phase has not produced yet (ADR-0041).

    The four cases below are the four combinations of `teamN` and `teamN_quelle`, and the point of
    the parametrised one is that ALL of them validate. Nothing pairs the two fields, so no case here
    is the "wrong" one to be rejected — a reader renders whichever of the two it has.
    """

    def test_accepts_a_fixture_whose_opponent_is_not_yet_known(self, spiel):
        """The shape that replaces the placeholder team: an absent side, and a reference to what fills it."""
        parsed = FLSpiel.model_validate(spiel(team1=None, team1_quelle={"type": "spiel", "spiel_nr": 25, "ausgang": "sieger"}, ergebnis=None))

        assert parsed.team1 is None
        assert parsed.team1_quelle == FLSpielQuelleSpiel(type="spiel", spiel_nr=25, ausgang="sieger")

    def test_keeps_the_source_once_the_team_arrives(self, spiel):
        """
        A source is a fact about the FIXTURE, not a stand-in for the missing team.

        "the winner of match 25" stays true after that winner is written into the slot, which is the
        whole reason it is a sibling of `team1` rather than a key inside it — and it is what lets the
        slot be recomputed when match 25's result is corrected.
        """
        parsed = FLSpiel.model_validate(spiel(team1_quelle={"type": "spiel", "spiel_nr": 25, "ausgang": "sieger"}))

        assert parsed.team1 is not None
        assert parsed.team1_quelle == FLSpielQuelleSpiel(type="spiel", spiel_nr=25, ausgang="sieger")

    def test_accepts_a_slot_seeded_from_the_group_phase(self, spiel):
        """The first knockout round is always fed by the standings, so the model has to say so."""
        parsed = FLSpiel.model_validate(spiel(team1=None, team1_quelle={"type": "gruppe", "gruppe": "B", "platz": 2}, ergebnis=None))

        assert parsed.team1_quelle == FLSpielQuelleGruppe(type="gruppe", gruppe="B", platz=2)

    def test_accepts_a_slot_with_neither_a_team_nor_a_label(self, spiel):
        """An opponent not entered yet, or a slot an admin has taken manual charge of by clearing its source."""
        parsed = FLSpiel.model_validate(spiel(team1=None, team1_quelle=None, ergebnis=None))

        assert parsed.team1 is None
        assert parsed.team1_quelle is None

    @pytest.mark.parametrize("field", ["team1_quelle", "team2_quelle"])
    def test_requires_the_source_field_to_be_present(self, spiel, field):
        """
        Nullable, and REQUIRED — no Pydantic default.

        A default would let a document that has never carried the key read as `None`, which is exactly
        the state the pre-deploy seeding step exists to remove. Without this, that step could be
        skipped and nothing would say so until a bracket edit silently wrote the field for the first
        time on one document out of thirty-one.
        """
        incomplete = spiel()
        del incomplete[field]

        with pytest.raises(ValidationError) as excinfo:
            FLSpiel.model_validate(incomplete)

        assert excinfo.value.errors()[0]["loc"][-1] == field


class TestShootout:
    """
    `elfmeterschiessen`: how a knockout that finished level was settled (ADR-0044).

    A scoreline of its own, never a third number inside `ergebnis` — both ends parse that string to
    derive win/draw/loss, and the league table counts this fixture as the draw it was.
    """

    def test_accepts_a_level_knockout_settled_on_penalties(self, spiel):
        """The fixture the field exists for."""
        parsed = FLSpiel.model_validate(spiel(ergebnis="2:2", elfmeterschiessen={"team1": 4, "team2": 3}))

        assert parsed.elfmeterschiessen == FLSpielElfmeterschiessen(team1=4, team2=3)

    def test_accepts_a_null_shootout(self, spiel):
        """Every match that did not end level, which is almost all of them."""
        assert FLSpiel.model_validate(spiel()).elfmeterschiessen is None

    def test_rejects_a_level_shootout(self, spiel, assert_rejects):
        """
        The one value the field could hold and still name nobody.

        Accepting it would put a fixture back exactly where a drawn knockout was before this field
        existed — no winner, nothing downstream, and now a filled-in record suggesting otherwise.
        """
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
        """
        Nullable, and REQUIRED — no Pydantic default, exactly as `teamN_quelle` is.

        A default would let a document that has never carried the key read as `None`, which is the state
        the pre-deploy seeding step exists to remove: `python -m app.core.constraints --check` reports
        which documents still lack it, and a default would make that report come back clean while the
        key was still missing.
        """
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
        """
        `None` means unplayed and is distinct from `0` — the derived league table counts a 0 and skips a null.

        The two assertions are distinct claims, which is why the side is not narrowed with a cast: an
        occupied side that scored nothing yet is a different state from a side with no occupant, and
        collapsing them here would let this pass on the wrong one.
        """
        parsed = FLSpiel.model_validate(spiel(team1=spiel_team_field(tore=None)))

        assert parsed.team1 is not None
        assert parsed.team1.tore is None

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

    def test_requires_the_shootout_field(self, spiel):
        """
        On the payload for the same `$set` reason as the two sources above, and required for it too.

        An omitted key is written as an overwrite, so a payload model without this would silently
        retract a recorded shoot-out the first time an admin corrected a kick-off time.
        """
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
        """
        On the payload, because the handler writes it back wholesale with `$set`.

        A field the request omits is OVERWRITTEN rather than preserved, so a payload model without
        these would erase a bracket's wiring the first time an admin edited any other field —
        the same failure mode `mietpreis` has, for the same reason.
        """
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
