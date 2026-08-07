"""
The remaining constrained models: spielorte, schiedsrichter, spieler, spieltage, saisons.

One module rather than five, because each carries only a handful of constraints and splitting them
would be more navigation than signal. Split it the moment any one of them grows real behaviour.
"""

import pytest
from pydantic import ValidationError

from app.api.saisons.schemas import FLSaison
from app.api.schiedsrichter.schemas import FLPostSchiedsrichterPayload, FLSchiedsrichter
from app.api.spieler.schemas import FLSpieler
from app.api.spielorte.schemas import FLPostSpielortPayload, FLSpielort
from app.api.spieltage.schemas import FLSpieltag


class TestSpielort:
    def test_accepts_a_valid_spielort(self, spielort):
        """Positive baseline for the venue model."""
        assert FLSpielort.model_validate(spielort()).default_mietpreis == 80

    @pytest.mark.parametrize("field", ["name", "maps_link"])
    def test_rejects_an_empty_required_string(self, spielort, field):
        """A venue must be nameable and locatable — both strings are embedded onto every match that uses it."""
        with pytest.raises(ValidationError):
            FLSpielort.model_validate(spielort(**{field: ""}))

    def test_rejects_a_negative_default_rent(self, spielort):
        """`ge=0` on the standard rent, matching the per-match `mietpreis`."""
        with pytest.raises(ValidationError):
            FLSpielort.model_validate(spielort(default_mietpreis=-1))

    # The payload gets its own positive baseline before anything asserts a rejection: without one,
    # a mistyped key would produce "field required" and the rejection test would pass while the
    # constraint it names went unenforced.
    def test_payload_accepts_a_valid_body(self, address):
        """The write payload's own baseline: without it a mistyped key would make the rejection test pass for the wrong reason."""
        parsed = FLPostSpielortPayload.model_validate({"address": address(), "name": "Sportplatz Ost", "default_mietpreis": 80})

        assert parsed.default_mietpreis == 80

    def test_payload_shares_the_same_constraints(self, address, assert_rejects):
        """The payload does not relax what the read model enforces, and the error names the offending field."""
        assert_rejects(FLPostSpielortPayload, {"address": address(), "name": "", "default_mietpreis": 0}, "name")
        assert_rejects(FLPostSpielortPayload, {"address": address(), "name": "X", "default_mietpreis": -1}, "default_mietpreis")


class TestSchiedsrichter:
    def test_accepts_a_valid_schiedsrichter(self, schiedsrichter):
        """Positive baseline for the referee model."""
        assert FLSchiedsrichter.model_validate(schiedsrichter()).default_payment == 20

    def test_rejects_an_empty_name(self, schiedsrichter):
        """The name is embedded onto every match the referee officiates, so it cannot be blank."""
        with pytest.raises(ValidationError):
            FLSchiedsrichter.model_validate(schiedsrichter(name=""))

    def test_rejects_a_negative_payment(self, schiedsrichter):
        """`ge=0` on the standard fee."""
        with pytest.raises(ValidationError):
            FLSchiedsrichter.model_validate(schiedsrichter(default_payment=-1))

    def test_accepts_a_missing_school(self, schiedsrichter):
        """`schule` is genuinely optional — not every referee is attached to one."""
        assert FLSchiedsrichter.model_validate(schiedsrichter(schule=None)).schule is None

    def test_rejects_a_malformed_email_through_the_nested_contact(self, schiedsrichter, kontakt):
        """Nested validation actually runs: a bad address inside `kontakt` fails the whole model."""
        with pytest.raises(ValidationError):
            FLSchiedsrichter.model_validate(schiedsrichter(kontakt=kontakt(email="nope")))

    def test_payload_accepts_a_valid_body(self, kontakt):
        """The referee payload's own baseline, for the same reason as the venue one above."""
        parsed = FLPostSchiedsrichterPayload.model_validate(
            {"kontakt": kontakt(), "name": "Anna Referee", "schule": None, "default_payment": 20}
        )

        assert parsed.default_payment == 20

    # A referee is a PERSON, so their name takes the same rule the player payloads take: letters and
    # the three separators a real name uses. The cost is named rather than hidden -- an initial or a
    # title is refused, because "A." and "Dr." are not letters.
    @pytest.mark.parametrize("name", ["A. Referee", "Referee (C)", "Referee 2"])
    def test_payload_rejects_a_name_that_is_not_letters(self, kontakt, assert_rejects, name):
        """The write path refuses it; the READ model still parses whatever is stored."""
        assert_rejects(
            FLPostSchiedsrichterPayload,
            {"kontakt": kontakt(), "name": name, "schule": None, "default_payment": 20},
            "name",
        )

    def test_the_read_model_still_accepts_a_stored_name_the_payload_would_refuse(self, schiedsrichter):
        """
        The asymmetry, pinned.

        A read model that refused a stored name would answer 500 for the whole list because of one
        row. The rule belongs on the way in, and this is the test that stops someone "tidying" it
        onto `FLSchiedsrichter`.
        """
        assert FLSchiedsrichter.model_validate(schiedsrichter(name="A. Referee")).name == "A. Referee"

    def test_payload_shares_the_same_constraints(self, kontakt, assert_rejects):
        """The referee payload does not relax the read model's rules either, and names the offending field."""
        assert_rejects(FLPostSchiedsrichterPayload, {"kontakt": kontakt(), "name": "", "schule": None, "default_payment": 0}, "name")
        assert_rejects(
            FLPostSchiedsrichterPayload, {"kontakt": kontakt(), "name": "X", "schule": None, "default_payment": -1}, "default_payment"
        )


class TestSpieler:
    def test_accepts_a_valid_spieler(self, spieler):
        """Positive baseline for the player model."""
        assert FLSpieler.model_validate(spieler()).vorname == "Max"

    # Owner decision: a player must have a first name; the rest may be absent while a squad entry
    # is still being filled in. The frontend mirrors exactly this split.
    def test_requires_a_first_name(self, spieler):
        """`vorname` is the one mandatory field — a squad entry with nothing at all is not a player."""
        with pytest.raises(ValidationError):
            FLSpieler.model_validate(spieler(vorname=""))

    @pytest.mark.parametrize("field", ["nachname", "stufe", "nummer", "position"])
    def test_allows_every_other_name_field_to_be_absent(self, spieler, field):
        """The other four are nullable, because squads are filled in over time. Consumers must handle every one."""
        assert getattr(FLSpieler.model_validate(spieler(**{field: None})), field) is None

    # ADR-0061 closed both sets. Nullable is not the same as open: a missing answer is null, and a
    # value outside the set is a document nothing may store.
    @pytest.mark.parametrize(
        ("field", "value"),
        [
            # The two spellings the live data had split into, and which the runbook normalised away.
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
        """A second spelling of a position the league already has is the failure mode ADR-0061 closes."""
        with pytest.raises(ValidationError):
            FLSpieler.model_validate(spieler(**{field: value}))

    def test_accepts_the_stufe_no_row_holds_yet(self, spieler):
        """`E2` is offered although the current season has nobody in it — the phases run in sequence."""
        assert FLSpieler.model_validate(spieler(stufe="E2")).stufe == "E2"


class TestSpieltag:
    def test_accepts_a_valid_spieltag(self, spieltag):
        """Positive baseline for the matchday model."""
        assert FLSpieltag.model_validate(spieltag()).anzahl_spiele == 4

    def test_rejects_an_empty_name(self, spieltag):
        """A matchday is identified by name in the bracket heading."""
        with pytest.raises(ValidationError):
            FLSpieltag.model_validate(spieltag(name=""))

    @pytest.mark.parametrize("anzahl", [0, -1])
    def test_rejects_a_non_positive_match_count(self, spieltag, anzahl):
        """Zero and negative: a matchday with no matches is not a matchday."""
        with pytest.raises(ValidationError):
            FLSpieltag.model_validate(spieltag(anzahl_spiele=anzahl))

    def test_carries_no_stored_position(self, spieltag):
        """
        A matchday's place in its season is derived, so the model holds no field for one (ADR-0064).

        Asserted rather than left to absence: a stored position is the shape this model is most likely to
        grow back, and it would silently become a second answer to a question `order_spieltage` already
        answers. Pydantic ignores an unknown key, so a document still carrying the retired `order_val`
        validates and the value is dropped -- which is what makes the cleanup optional rather than a
        migration the deploy waits on.
        """
        assert "order_val" not in FLSpieltag.model_fields
        assert not hasattr(FLSpieltag.model_validate(spieltag(order_val=3)), "order_val")

    @pytest.mark.parametrize("field", ["beginn", "ende"])
    def test_rejects_a_date_that_does_not_exist(self, spieltag, field):
        """Both ends of the range get the calendar check, not just the regex."""
        with pytest.raises(ValidationError):
            FLSpieltag.model_validate(spieltag(**{field: "2026-02-31"}))


class TestSaison:
    def test_accepts_a_valid_saison(self, saison):
        """Positive baseline for the season model, including its nested rules."""
        assert FLSaison.model_validate(saison()).rules.win_points == 3

    def test_rejects_non_positive_win_points(self, saison):
        """A win must be worth something, or the table cannot rank anyone."""
        with pytest.raises(ValidationError):
            FLSaison.model_validate(saison(rules={"win_points": 0, "draw_points": 1}))

    def test_rejects_negative_draw_points(self, saison):
        """A draw cannot cost points."""
        with pytest.raises(ValidationError):
            FLSaison.model_validate(saison(rules={"win_points": 3, "draw_points": -1}))

    # A draw being worth nothing is a legal rule set, unlike a win being worth nothing.
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

    # `erlaubte_stufen` names WHICH of the league's levels this season runs (ADR-0061). It is a
    # subset of the vocabulary, never a redefinition of it, and never empty.
    def test_rejects_a_stufe_the_league_does_not_have(self, saison):
        """
        A season may narrow the set, not extend it — `10` is outside `FLSpielerStufe`.

        Asserted directly rather than through `assert_rejects`: that helper reads the LAST element of
        the error location, and a rejected LIST ITEM ends its location with the index, so the field's
        name sits one step up.
        """
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
        """A group nobody comes out of is not a group phase, so the count is `gt=0` (ADR-0043)."""
        with pytest.raises(ValidationError):
            FLSaison.model_validate(saison(rules={"win_points": 3, "draw_points": 1, "qualifiers_per_group": 0}))

    # No Pydantic default, deliberately: a season that has never carried the key would otherwise read as
    # though it had, and the number seeding the bracket would be a constant chosen in the model file --
    # which is what ADR-0026 refused for 3/1/0. A missing one fails loudly on the next read instead.
    def test_rejects_rules_with_no_qualifier_count(self, saison):
        """Required, so a season predating the field is refused rather than silently given a number."""
        with pytest.raises(ValidationError):
            FLSaison.model_validate(saison(rules={"win_points": 3, "draw_points": 1}))

    # The capacity pair is required for the same reason as the qualifier count above: absent keys must
    # fail loudly, not read as a bound nobody chose.
    @pytest.mark.parametrize("field", ["number_of_groups", "teams_per_group"])
    def test_rejects_rules_with_no_capacity(self, saison, field):
        """Required, so a season predating the capacity fields is refused rather than silently bounded."""
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
        """Both season boundaries get the calendar check — 2026-04-31 passes the regex and is not a real day."""
        with pytest.raises(ValidationError):
            FLSaison.model_validate(saison(**{field: "2026-04-31"}))
