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
        """Cancelling is the route past the refusal: otherwise a fixture nobody will play closes nothing."""

        assert unplayed_spiel_nrs(season({"spiel_nr": 4, "ergebnis": None, "is_canceled": True})) == []

    def test_a_cancelled_fixture_with_a_result_is_also_settled(self):
        """A cancelled match carrying a result counts for the league table (`docs/glossary.md`), so it is as played as any other."""

        assert unplayed_spiel_nrs(season({"spiel_nr": 4, "ergebnis": "1:0", "is_canceled": True})) == []

    def test_an_empty_bracket_slot_is_unplayed(self):
        """A season leaving one open is as unfinished as one leaving a match unscored, and it has no occupants to score."""

        assert unplayed_spiel_nrs(season({"spiel_nr": 29, "saison_phase": "halbfinale", "team1": None, "team2": None})) == [29]

    def test_the_numbers_come_back_in_order(self):
        """The refusal names the first few, so the ones it names have to be the lowest-numbered."""

        fixtures = season({"spiel_nr": 9}, {"spiel_nr": 2}, {"spiel_nr": 5})

        assert unplayed_spiel_nrs(fixtures) == [2, 5, 9]


class TestTheOutgoingSeasonMustBeFinished:
    """`past` freezes the rules and makes the derived table the record, so rolling over early closes an unfinished competition."""

    def test_a_finished_season_rolls_over(self):
        """A fresh database has no incumbent at all, and the caller passes the same empty list for that case as for this one."""

        assert find_activation_refusal(outgoing_unplayed=[]) is None

    def test_an_unfinished_season_is_refused(self):
        refusal = find_activation_refusal(outgoing_unplayed=[3])

        assert refusal is not None
        assert refusal.error_code == ACTIVATE_SAISON_UNFINISHED

    def test_the_refusal_names_the_fixtures(self):
        """`spiel_nr` is how an admin finds a fixture in the Spielsuche, so naming them saves a second lookup."""

        refusal = find_activation_refusal(outgoing_unplayed=[3, 7])

        assert refusal is not None
        assert "3, 7" in refusal.message

    def test_a_long_list_is_summarised_rather_than_printed(self):
        """This detail is the log line: a season's worth of numbers buries the sentence saying what to do."""

        refusal = find_activation_refusal(outgoing_unplayed=list(range(1, 12)))

        assert refusal is not None
        assert "1, 2, 3, 4, 5 and 6 more" in refusal.message
        assert "11 unplayed fixtures" in refusal.message
