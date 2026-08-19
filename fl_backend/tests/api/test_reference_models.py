import pytest
from pydantic import ValidationError

from app.api.saisons.schemas import FLSaison
from app.api.schiedsrichter.schemas import FLPostSchiedsrichterPayload, FLSchiedsrichter
from app.api.spiele.schemas import FLSpielBooking
from app.api.spieler.schemas import FLSpieler
from app.api.spielorte.schemas import FLPostSpielortPayload, FLSpielort
from app.api.spieltage.schemas import FLSpieltag


class TestSpielort:
    def test_accepts_a_valid_spielort(self, spielort):
        assert FLSpielort.model_validate(spielort()).default_mietpreis == 80

    @pytest.mark.parametrize("field", ["name", "maps_link"])
    def test_rejects_an_empty_required_string(self, spielort, field):
        """Both strings are embedded onto every match that uses the venue."""
        with pytest.raises(ValidationError):
            FLSpielort.model_validate(spielort(**{field: ""}))

    def test_rejects_a_negative_default_rent(self, spielort):
        with pytest.raises(ValidationError):
            FLSpielort.model_validate(spielort(default_mietpreis=-1))

    def test_payload_accepts_a_valid_body(self, address):
        """Without it a mistyped key makes the rejection test below pass for the wrong reason."""
        parsed = FLPostSpielortPayload.model_validate({"address": address(), "name": "Sportplatz Ost", "default_mietpreis": 80})

        assert parsed.default_mietpreis == 80

    def test_payload_shares_the_same_constraints(self, address, assert_rejects):
        assert_rejects(FLPostSpielortPayload, {"address": address(), "name": "", "default_mietpreis": 0}, "name")
        assert_rejects(FLPostSpielortPayload, {"address": address(), "name": "X", "default_mietpreis": -1}, "default_mietpreis")


class TestSchiedsrichter:
    def test_accepts_a_valid_schiedsrichter(self, schiedsrichter):
        assert FLSchiedsrichter.model_validate(schiedsrichter()).default_payment == 20

    def test_rejects_an_empty_name(self, schiedsrichter):
        """The name is embedded onto every match the referee officiates."""
        with pytest.raises(ValidationError):
            FLSchiedsrichter.model_validate(schiedsrichter(name=""))

    def test_rejects_a_negative_payment(self, schiedsrichter):
        with pytest.raises(ValidationError):
            FLSchiedsrichter.model_validate(schiedsrichter(default_payment=-1))

    def test_accepts_a_missing_school(self, schiedsrichter):
        """Not every referee is attached to a school."""
        assert FLSchiedsrichter.model_validate(schiedsrichter(schule=None)).schule is None

    def test_rejects_a_malformed_email_through_the_nested_contact(self, schiedsrichter, kontakt):
        with pytest.raises(ValidationError):
            FLSchiedsrichter.model_validate(schiedsrichter(kontakt=kontakt(email="nope")))

    def test_payload_accepts_a_valid_body(self, kontakt):
        parsed = FLPostSchiedsrichterPayload.model_validate(
            {"kontakt": kontakt(), "name": "Anna Referee", "schule": None, "default_payment": 20}
        )

        assert parsed.default_payment == 20

    # A referee is a person, so the name takes the player payloads' rule; the cost is a refused initial or title.
    @pytest.mark.parametrize("name", ["A. Referee", "Referee (C)", "Referee 2"])
    def test_payload_rejects_a_name_that_is_not_letters(self, kontakt, assert_rejects, name):
        assert_rejects(
            FLPostSchiedsrichterPayload,
            {"kontakt": kontakt(), "name": name, "schule": None, "default_payment": 20},
            "name",
        )

    def test_the_read_model_still_accepts_a_stored_name_the_payload_would_refuse(self, schiedsrichter):
        """A read model refusing a stored name would answer 500 for the whole list because of one row."""
        assert FLSchiedsrichter.model_validate(schiedsrichter(name="A. Referee")).name == "A. Referee"

    def test_payload_shares_the_same_constraints(self, kontakt, assert_rejects):
        assert_rejects(FLPostSchiedsrichterPayload, {"kontakt": kontakt(), "name": "", "schule": None, "default_payment": 0}, "name")
        assert_rejects(
            FLPostSchiedsrichterPayload, {"kontakt": kontakt(), "name": "X", "schule": None, "default_payment": -1}, "default_payment"
        )


class TestSpieler:
    def test_accepts_a_valid_spieler(self, spieler):
        assert FLSpieler.model_validate(spieler()).vorname == "Max"

    # A player must have a first name; the rest fills in over time, and the frontend mirrors the split.
    def test_requires_a_first_name(self, spieler):
        with pytest.raises(ValidationError):
            FLSpieler.model_validate(spieler(vorname=""))

    @pytest.mark.parametrize("field", ["nachname", "stufe", "nummer", "position"])
    def test_allows_every_other_name_field_to_be_absent(self, spieler, field):
        assert getattr(FLSpieler.model_validate(spieler(**{field: None})), field) is None

    # Nullable is not open: a missing answer is null, a value outside the set is unstorable.
    @pytest.mark.parametrize(
        ("field", "value"),
        [
            # Two spellings of one position — the split the closed set removes.
            ("position", "Sturm"),
            ("position", "TW"),
            # A placeholder somebody typed where null already meant the same thing.
            ("position", "?"),
            ("stufe", "??"),
            # Outside the Oberstufe, which is where the set stops.
            ("stufe", "10"),
        ],
    )
    def test_rejects_a_position_or_stufe_outside_its_closed_set(self, spieler, field, value):
        with pytest.raises(ValidationError):
            FLSpieler.model_validate(spieler(**{field: value}))

    def test_accepts_the_stufe_no_row_holds_yet(self, spieler):
        """`E2` is offered although the current season has nobody in it — the phases run in sequence."""
        assert FLSpieler.model_validate(spieler(stufe="E2")).stufe == "E2"


class TestSpieltag:
    def test_accepts_a_valid_spieltag(self, spieltag):
        assert FLSpieltag.model_validate(spieltag()).anzahl_spiele == 4

    def test_carries_no_name(self):
        """A stored name restates a composed fact with nothing holding the two consistent."""

        assert "name" not in FLSpieltag.model_fields

    def test_rejects_a_negative_match_count(self, spieltag):
        """`ge=0` rather than `gt=0`: the count is derived from the season's rules, and zero is a real answer."""
        with pytest.raises(ValidationError):
            FLSpieltag.model_validate(spieltag(anzahl_spiele=-1))

    def test_accepts_a_match_count_of_zero(self, spieltag):
        assert FLSpieltag.model_validate(spieltag(anzahl_spiele=0)).anzahl_spiele == 0

    def test_carries_no_stored_position(self, spieltag):
        """Asserted, not left to absence: Pydantic drops an unknown key silently, and a stored position second-guesses `order_spieltage`."""
        assert "order_val" not in FLSpieltag.model_fields
        assert not hasattr(FLSpieltag.model_validate(spieltag(order_val=3)), "order_val")

    @pytest.mark.parametrize("field", ["beginn", "ende"])
    def test_rejects_a_date_that_does_not_exist(self, spieltag, field):
        """Both ends of the range get the calendar check, not just the regex."""
        with pytest.raises(ValidationError):
            FLSpieltag.model_validate(spieltag(**{field: "2026-02-31"}))


class TestSaison:
    def test_accepts_a_valid_saison(self, saison):
        assert FLSaison.model_validate(saison()).rules.win_points == 3

    def test_rejects_non_positive_win_points(self, saison):
        """A win must be worth something, or the table cannot rank anyone."""
        with pytest.raises(ValidationError):
            FLSaison.model_validate(saison(rules={"win_points": 0, "draw_points": 1}))

    def test_rejects_negative_draw_points(self, saison):
        """A draw cannot cost points."""
        with pytest.raises(ValidationError):
            FLSaison.model_validate(saison(rules={"win_points": 3, "draw_points": -1}))

    def test_accepts_zero_draw_points(self, saison):
        """The asymmetry with wins: a draw worth nothing is a legal rule set."""
        rules = {
            "win_points": 3,
            "draw_points": 0,
            "qualifiers_per_group": 2,
            "number_of_groups": 4,
            "teams_per_group": 4,
            "erlaubte_stufen": ["Q1"],
        }

        assert FLSaison.model_validate(saison(rules=rules)).rules.draw_points == 0

    # `erlaubte_stufen` is a subset of the league's vocabulary, never a redefinition and never empty.
    def test_rejects_a_stufe_the_league_does_not_have(self, saison):
        """Not `assert_rejects`: it reads the last element of the error location, and a rejected list item ends with the index."""
        rules = {**saison()["rules"], "erlaubte_stufen": ["Q1", "10"]}

        with pytest.raises(ValidationError) as failure:
            FLSaison.model_validate(saison(rules=rules))

        assert any("erlaubte_stufen" in error["loc"] for error in failure.value.errors())

    def test_rejects_an_empty_stufen_list(self, saison, assert_rejects):
        """A season offering no level at all would make every squad entry unfillable."""
        rules = {**saison()["rules"], "erlaubte_stufen": []}

        assert_rejects(FLSaison, saison(rules=rules), "erlaubte_stufen")

    def test_rejects_a_season_missing_the_stufen_list(self, saison, assert_rejects):
        """Required with no default, for the reason `qualifiers_per_group` is: no constant in a model."""
        rules = {key: value for key, value in saison()["rules"].items() if key != "erlaubte_stufen"}

        assert_rejects(FLSaison, saison(rules=rules), "erlaubte_stufen")

    def test_rejects_a_season_advancing_nobody(self, saison):
        """A group nobody comes out of is not a group phase, so the count is `gt=0`."""
        with pytest.raises(ValidationError):
            FLSaison.model_validate(saison(rules={"win_points": 3, "draw_points": 1, "qualifiers_per_group": 0}))

    # No Pydantic default: a season missing the key would read as though it had one, and the bracket's
    # size would be a constant in a model.
    def test_rejects_rules_with_no_qualifier_count(self, saison):
        with pytest.raises(ValidationError):
            FLSaison.model_validate(saison(rules={"win_points": 3, "draw_points": 1}))

    # Required for the qualifier count's reason: an absent key must fail, not read as a bound nobody chose.
    @pytest.mark.parametrize("field", ["number_of_groups", "teams_per_group"])
    def test_rejects_rules_with_no_capacity(self, saison, field):
        rules = {"win_points": 3, "draw_points": 1, "qualifiers_per_group": 2, "number_of_groups": 4, "teams_per_group": 4}
        del rules[field]

        with pytest.raises(ValidationError):
            FLSaison.model_validate(saison(rules=rules))

    def test_rejects_more_groups_than_the_closed_set_holds(self, saison):
        """`FLGruppenNames` is the closed A-D set, so a season cannot run a fifth group."""
        rules = {"win_points": 3, "draw_points": 1, "qualifiers_per_group": 2, "number_of_groups": 5, "teams_per_group": 4}

        with pytest.raises(ValidationError):
            FLSaison.model_validate(saison(rules=rules))

    @pytest.mark.parametrize("field", ["start_date", "end_date"])
    def test_rejects_a_date_that_does_not_exist(self, saison, field):
        """Both boundaries get the calendar check: the value passes the regex and is not a real day."""
        with pytest.raises(ValidationError):
            FLSaison.model_validate(saison(**{field: "2026-04-31"}))


class TestSpielBooking:
    """`find_clash_refusal` splits `uhrzeit` into three parts over a bare projection, and the database is hand-edited."""

    def booking(self, **overrides):
        return {"spiel_nr": 3, "datum": "2026-03-15", "uhrzeit": "18:00:00", **overrides}

    def test_accepts_a_well_formed_booking(self):
        assert FLSpielBooking.model_validate(self.booking()).uhrzeit == "18:00:00"

    @pytest.mark.parametrize("uhrzeit", ["18:00", "18", "abend", "25:00:00"])
    def test_rejects_a_time_the_comparison_could_not_read(self, uhrzeit):
        """`18:00` is load-bearing: three-part unpacking raises `ValueError` on it rather than a 422."""

        with pytest.raises(ValidationError):
            FLSpielBooking.model_validate(self.booking(uhrzeit=uhrzeit))

    def test_rejects_a_malformed_date(self):
        """The date is compared too, so it needs the same guarantee as the time."""

        with pytest.raises(ValidationError):
            FLSpielBooking.model_validate(self.booking(datum="15.03.2026"))

    def test_rejects_a_non_positive_fixture_number(self):
        """`spiel_nr` is named back to the admin in the refusal, so a zero would be nonsense to act on."""

        with pytest.raises(ValidationError):
            FLSpielBooking.model_validate(self.booking(spiel_nr=0))
