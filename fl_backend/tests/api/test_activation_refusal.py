import pytest

from app.api.spiele.schemas import SONDEREREIGNIS_WITHOUT_A_RESULT, is_unplayed


class TestWhatTheActivationCountsAsUnplayed:
    """`is_unplayed`, which the rollover asks of the incumbent's fixtures through `unplayed_filter`, its stored form."""

    def test_a_spiel_with_no_result_is_unplayed(self):
        assert is_unplayed(ergebnis=None, sonderereignis=None)

    @pytest.mark.parametrize("sonderereignis", SONDEREREIGNIS_WITHOUT_A_RESULT)
    def test_a_spiel_that_can_award_nothing_is_settled(self, sonderereignis):
        """Recording that a match will never be played is the route past the refusal: otherwise a fixture nobody will play closes nothing."""

        assert not is_unplayed(ergebnis=None, sonderereignis=sonderereignis)

    def test_an_abandoned_spiel_with_no_result_still_owes_one(self):
        """Abandoning a match settles nothing, because a replay may still be scheduled."""

        assert is_unplayed(ergebnis=None, sonderereignis="abgebrochen")

    def test_a_forfeit_carrying_its_awarded_result_is_settled(self):
        """A no-show is awarded a result and counts for the league table (`docs/glossary.md`), so it is as played as any other."""

        assert not is_unplayed(ergebnis="1:0", sonderereignis="nichtantreten_team2")
