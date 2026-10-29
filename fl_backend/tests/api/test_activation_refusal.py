import pytest

from app.api.saisons.services import (
    find_activation_refusal,
    unplayed_spiel_nrs,
)
from app.api.spiele.schemas import SONDEREREIGNIS_WITHOUT_A_RESULT, FLSpielListAdapter
from app.core.codes import Code


def season(*spiele: dict) -> list:
    """Validated fixtures from partial dicts, so a case names only the fields it is about."""

    base = {
        "_id": "6890a1b2c3d4e5f607200001",
        "team1": None,
        "team2": None,
        "team1_quelle": None,
        "team2_quelle": None,
        "datum": "2026-03-15",
        "uhrzeit": None,
        "ort": None,
        "schiedsrichter": None,
        "ergebnis": None,
        "elfmeterschiessen": None,
        "spieltag_id": "6890a1b2c3d4e5f607210001",
        "spiel_nr": 1,
        "sonderereignis": None,
        "saison_phase": "gruppenphase",
        "saison_id": "2026",
    }

    return FLSpielListAdapter.validate_python(
        [{**base, "_id": f"6890a1b2c3d4e5f60720{index:04d}", **spiel} for index, spiel in enumerate(spiele, start=1)]
    )


class TestWhatCountsAsUnplayed:
    def test_a_fixture_with_a_result_is_played(self):
        assert unplayed_spiel_nrs(season({"spiel_nr": 1, "ergebnis": "2:1"})) == []

    def test_a_fixture_with_no_result_is_unplayed(self):
        assert unplayed_spiel_nrs(season({"spiel_nr": 7, "ergebnis": None})) == [7]

    @pytest.mark.parametrize("sonderereignis", SONDEREREIGNIS_WITHOUT_A_RESULT)
    def test_a_fixture_that_can_award_nothing_is_settled(self, sonderereignis):
        """Recording that a match will never be played is the route past the refusal: otherwise a fixture nobody will play closes nothing."""

        assert unplayed_spiel_nrs(season({"spiel_nr": 4, "ergebnis": None, "sonderereignis": sonderereignis})) == []

    def test_an_abandoned_fixture_with_no_result_still_owes_one(self):
        """The distinction the boolean hid: abandoning a match settles nothing, because a replay may still be scheduled."""

        assert unplayed_spiel_nrs(season({"spiel_nr": 4, "ergebnis": None, "sonderereignis": "abgebrochen"})) == [4]

    def test_a_forfeit_carrying_its_awarded_result_is_settled(self):
        """A no-show is awarded a result and counts for the league table (`docs/glossary.md`), so it is as played as any other."""

        assert unplayed_spiel_nrs(season({"spiel_nr": 4, "ergebnis": "1:0", "sonderereignis": "nichtantreten_team2"})) == []

    def test_an_empty_bracket_slot_is_unplayed(self):
        """A season leaving one open is as unfinished as one leaving a match unscored, and it has no occupants to score."""

        assert unplayed_spiel_nrs(season({"spiel_nr": 29, "saison_phase": "halbfinale", "team1": None, "team2": None})) == [29]

    def test_the_numbers_come_back_in_order(self):
        """The refusal names the first few, so the ones it names have to be the lowest-numbered."""

        fixtures = season({"spiel_nr": 9}, {"spiel_nr": 2}, {"spiel_nr": 5})

        assert unplayed_spiel_nrs(fixtures) == [2, 5, 9]


class TestAFinishedSeasonIsNeverPromotedBack:
    def test_the_target_is_judged_before_the_outgoing_season(self):
        """Otherwise the administrator is sent to settle the running season's fixtures, and only then told the target was never promotable."""

        refusal = find_activation_refusal(undated_spieltage=0, target_status="past", target_fixtures=60, outgoing_unplayed=[3, 7])

        assert refusal is not None
        assert refusal.error_code == Code.ACTIVATE_TARGET_PAST
