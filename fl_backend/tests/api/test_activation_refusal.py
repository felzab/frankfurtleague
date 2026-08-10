"""
SAISONS · what the rollover refuses

`unplayed_spiel_nrs` and `find_activation_refusal`, both pure. `POST /saisons/{saison_id}/activate`
demotes the incumbent to `past` in the same transaction it promotes with — and `past` freezes the
rules and makes the derived table the record, so rolling over across unplayed fixtures closes a
competition that is not finished, in the one operation editing afterwards cannot undo.

Cancelling is the way through, not a loophole: a fixture nobody will ever play is settled by
cancelling it — chosen (decided 2026-08-08) over counting the unplayed fixtures and activating
anyway.
"""

import pytest

from app.api.saisons.services import ACTIVATE_SAISON_UNFINISHED, find_activation_refusal, unplayed_spiel_nrs
from app.api.spiele.schemas import FLSpielListAdapter


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
        "is_canceled": False,
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

    def test_a_cancelled_fixture_is_settled(self):
        """
        Cancelling is the route past the refusal, so it has to count as settled.

        Otherwise a season holding a fixture nobody will ever play could never be closed at all.
        """

        assert unplayed_spiel_nrs(season({"spiel_nr": 4, "ergebnis": None, "is_canceled": True})) == []

    def test_a_cancelled_fixture_with_a_result_is_also_settled(self):
        """
        Both conditions say settled, and they agree.

        A cancelled match carrying a result still counts for the league table (docs/glossary.md), so it
        is as played as any other.
        """

        assert unplayed_spiel_nrs(season({"spiel_nr": 4, "ergebnis": "1:0", "is_canceled": True})) == []

    def test_an_empty_bracket_slot_is_unplayed(self):
        """
        A knockout fixture the group phase never filled.

        A season leaving one open is exactly as unfinished as one leaving a match unscored, and this
        fixture has no occupants to score.
        """

        assert unplayed_spiel_nrs(season({"spiel_nr": 29, "saison_phase": "halbfinale", "team1": None, "team2": None})) == [29]

    def test_the_numbers_come_back_in_order(self):
        """The refusal names the first few, so the ones it names have to be the lowest-numbered."""

        fixtures = season({"spiel_nr": 9}, {"spiel_nr": 2}, {"spiel_nr": 5})

        assert unplayed_spiel_nrs(fixtures) == [2, 5, 9]


class TestTheOutgoingSeasonMustBeFinished:
    def test_a_finished_season_rolls_over(self):
        assert find_activation_refusal(outgoing_unplayed=[]) is None

    def test_no_incumbent_at_all_rolls_over(self):
        """
        The first rollover of a fresh database, where there is no outgoing season to be unfinished.

        The caller passes an empty list for it, which is the same input as a season with nothing left.
        """

        assert find_activation_refusal(outgoing_unplayed=[]) is None

    @pytest.mark.parametrize("unplayed", [[3], [3, 7, 11]])
    def test_an_unfinished_season_is_refused(self, unplayed):
        refusal = find_activation_refusal(outgoing_unplayed=unplayed)

        assert refusal is not None
        assert refusal[0] == ACTIVATE_SAISON_UNFINISHED

    def test_the_refusal_names_the_fixtures(self):
        """
        The numbers are what make it actionable.

        `spiel_nr` is how an admin finds a fixture in the Spielsuche, so a refusal naming them is one
        somebody can act on without a second lookup.
        """

        refusal = find_activation_refusal(outgoing_unplayed=[3, 7])

        assert refusal is not None
        assert "3, 7" in refusal[1]

    def test_a_long_list_is_summarised_rather_than_printed(self):
        """
        This detail is the log line, so its length is a real constraint.

        A season's worth of numbers buries the sentence that says what to do, so it names the first five
        and counts the rest.
        """

        refusal = find_activation_refusal(outgoing_unplayed=list(range(1, 12)))

        assert refusal is not None
        assert "1, 2, 3, 4, 5 and 6 more" in refusal[1]
        assert "11 unplayed fixtures" in refusal[1]
