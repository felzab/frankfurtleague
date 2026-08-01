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
        parsed = FLPostSchiedsrichterPayload.model_validate({"kontakt": kontakt(), "name": "A. Referee", "schule": None, "default_payment": 20})

        assert parsed.default_payment == 20

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

    def test_rejects_a_negative_order_value(self, spieltag):
        """`order_val` is the bracket's sort key, so it must be non-negative."""
        with pytest.raises(ValidationError):
            FLSpieltag.model_validate(spieltag(order_val=-1))

    # order_val is a sort key, so 0 is a legitimate first entry.
    def test_accepts_a_zero_order_value(self, spieltag):
        """The boundary the rule above stops at: `0` is a legitimate first entry, not an unset value."""
        assert FLSpieltag.model_validate(spieltag(order_val=0)).order_val == 0

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
        assert FLSaison.model_validate(saison(rules={"win_points": 3, "draw_points": 0})).rules.draw_points == 0

    @pytest.mark.parametrize("field", ["start_date", "end_date"])
    def test_rejects_a_date_that_does_not_exist(self, saison, field):
        """Both season boundaries get the calendar check — 2026-04-31 passes the regex and is not a real day."""
        with pytest.raises(ValidationError):
            FLSaison.model_validate(saison(**{field: "2026-04-31"}))
