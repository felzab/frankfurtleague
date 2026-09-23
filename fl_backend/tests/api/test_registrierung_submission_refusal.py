import pytest

from app.api.registrierungen.services import (
    REGISTRIERUNG_ADRESSE_GESPERRT,
    REGISTRIERUNG_FENSTER_GESCHLOSSEN,
    REGISTRIERUNG_KADER_VOLL,
    REGISTRIERUNG_STUFE_NICHT_ERLAUBT,
    REGISTRIERUNG_TEAM_NICHT_EINGETRAGEN,
    find_fenster_refusal,
    find_gesperrt_refusal,
    find_kader_refusal,
    find_stufe_refusal,
    find_team_junction_refusal,
)

TODAY = "2026-04-01"

OPEN_WINDOW = {"offen": True, "von": "2026-03-01", "bis": "2026-04-30"}

# What a season's rules offer, narrowed to two of the six: a list holding every member could not
# tell a refusal from an accident.
ERLAUBTE_STUFEN = ("Q1", "Q2")


class TestTheWindowMustBeRunning:
    @pytest.mark.parametrize("saison_status", ["future", "active"])
    def test_a_running_window_is_not_refused(self, saison_status: str):
        assert find_fenster_refusal(saison_status=saison_status, registrierung=dict(OPEN_WINDOW), today=TODAY) is None

    def test_a_closed_window_is_refused(self):
        refusal = find_fenster_refusal(saison_status="future", registrierung={**OPEN_WINDOW, "offen": False}, today=TODAY)

        assert refusal is not None
        assert refusal.error_code == REGISTRIERUNG_FENSTER_GESCHLOSSEN

    def test_a_season_recording_no_window_is_refused(self):
        """The third closed shape, which reaches this refusal rather than a 500: a stored null is unreadable."""

        refusal = find_fenster_refusal(saison_status="future", registrierung=None, today=TODAY)

        assert refusal is not None
        assert refusal.error_code == REGISTRIERUNG_FENSTER_GESCHLOSSEN

    def test_a_season_that_has_ended_is_refused_while_its_dates_still_run(self):
        """A link minted while its season was `future` outlives the season's end, and the dates alone would admit through it."""

        refusal = find_fenster_refusal(saison_status="past", registrierung=dict(OPEN_WINDOW), today=TODAY)

        assert refusal is not None
        assert refusal.error_code == REGISTRIERUNG_FENSTER_GESCHLOSSEN

    def test_the_refusal_names_none_of_the_four(self):
        """ONE code and one sentence: naming which would report a season's administrative state to a stranger."""

        for refusal in (
            find_fenster_refusal(saison_status="future", registrierung={**OPEN_WINDOW, "offen": False}, today=TODAY),
            find_fenster_refusal(saison_status="past", registrierung=dict(OPEN_WINDOW), today=TODAY),
        ):
            assert refusal is not None
            assert "offen" not in refusal.message and "past" not in refusal.message
            assert OPEN_WINDOW["von"] not in refusal.message and OPEN_WINDOW["bis"] not in refusal.message


class TestTheTeamMustPlayTheSeason:
    def test_a_team_the_junction_holds_is_not_refused(self):
        assert find_team_junction_refusal(entered=True) is None

    def test_a_team_with_no_junction_row_is_refused(self):
        refusal = find_team_junction_refusal(entered=False)

        assert refusal is not None
        assert refusal.error_code == REGISTRIERUNG_TEAM_NICHT_EINGETRAGEN


class TestTheStufeMustBeOneTheSeasonOffers:
    def test_a_stufe_the_season_offers_is_not_refused(self):
        assert find_stufe_refusal(stufe="Q2", erlaubte_stufen=ERLAUBTE_STUFEN) is None

    def test_no_stufe_at_all_is_not_refused(self):
        """The field is nullable on the payload, so leaving it unanswered is an answer rather than a value outside the set."""

        assert find_stufe_refusal(stufe=None, erlaubte_stufen=ERLAUBTE_STUFEN) is None

    def test_a_stufe_outside_the_seasons_list_is_refused(self):
        refusal = find_stufe_refusal(stufe="E1", erlaubte_stufen=ERLAUBTE_STUFEN)

        assert refusal is not None
        assert refusal.error_code == REGISTRIERUNG_STUFE_NICHT_ERLAUBT

    def test_an_empty_list_offers_nothing(self):
        """A season narrowed to nothing takes no registration naming a Stufe, rather than every one."""

        refusal = find_stufe_refusal(stufe="Q1", erlaubte_stufen=())

        assert refusal is not None
        assert refusal.error_code == REGISTRIERUNG_STUFE_NICHT_ERLAUBT


class TestTheSquadMustHaveRoom:
    def test_a_squad_below_the_cap_is_not_refused(self):
        assert find_kader_refusal(squad_size=17, max_kadergroesse=18) is None

    def test_a_squad_at_the_cap_is_refused(self):
        """The boundary the cap is written at: the row this registration would become is the one past it."""

        refusal = find_kader_refusal(squad_size=18, max_kadergroesse=18)

        assert refusal is not None
        assert refusal.error_code == REGISTRIERUNG_KADER_VOLL

    def test_the_refusal_names_no_figure(self):
        """A stranger holding a link learns nothing about the squad's size or the season's cap."""

        refusal = find_kader_refusal(squad_size=18, max_kadergroesse=18)

        assert refusal is not None
        assert "18" not in refusal.message


class TestABannedAddress:
    def test_an_address_the_list_does_not_hold_is_not_refused(self):
        assert find_gesperrt_refusal(gesperrt=False) is None

    def test_an_address_the_list_holds_is_refused(self):
        refusal = find_gesperrt_refusal(gesperrt=True)

        assert refusal is not None
        assert refusal.error_code == REGISTRIERUNG_ADRESSE_GESPERRT

    def test_the_log_message_names_no_list_either(self):
        """The German a visitor reads is asserted in the frontend; this is the English the log keeps.

        It names no list either, so a copy reaching a surface by mistake still tells nobody.
        """

        refusal = find_gesperrt_refusal(gesperrt=True)

        assert refusal is not None
        assert "ban" not in refusal.message.lower() and "sperr" not in refusal.message.lower()
