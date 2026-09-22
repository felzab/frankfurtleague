import pytest

from app.api.saisons.schemas import FIRST_SAISON_YEAR
from app.api.sperrliste.services import (
    SPERRE_DAUER_SAISONS,
    SPERRLISTE_KEINE_SAISON,
    compose_gesperrt_bis_saison_id,
    find_keine_saison_refusal,
)
from app.shared.schemas.bounds import SAISON_ID_LENGTH


class TestTheLastSeasonABanCovers:
    def test_a_ban_entered_under_2026_covers_through_2031(self):
        """The ruled arithmetic, spelled: a case computing the expected value from the constants passes whatever either of them becomes."""

        assert compose_gesperrt_bis_saison_id(massgebliche_saison_id="2026") == "2031"

    def test_the_constants_are_the_ones_that_arithmetic_rests_on(self):
        """The floor under the literals above, so a changed constant fails HERE rather than leaving them a fossil nobody reads."""

        assert (FIRST_SAISON_YEAR, SPERRE_DAUER_SAISONS) == (2026, 5)

    def test_the_bound_keeps_the_width_every_season_id_has(self):
        """What makes the `$gte` comparison legal: the check orders two ids as STRINGS, which is wrong the moment one is wider."""

        answered = compose_gesperrt_bis_saison_id(massgebliche_saison_id="2026")

        assert len(answered) == SAISON_ID_LENGTH
        # STRING ordering, which is the operation the sweep and the check both run rather than the
        # integer comparison a reader assumes from the arithmetic above.
        assert answered > "2026"

    def test_a_league_year_whose_bound_would_not_fit_composes_none(self):
        """The ANSWER's width, which the input guard says nothing about: the format widens rather than truncating, in silence."""

        with pytest.raises(ValueError):
            compose_gesperrt_bis_saison_id(massgebliche_saison_id="9999")

    @pytest.mark.parametrize("unusable", ["", "26", "20260", "２０２６", "٢٠٢٦", "abcd", "202x"])
    def test_a_season_id_nothing_can_be_compared_against_composes_no_bound(self, unusable):
        """The digit sets `int` accepts and a string comparison does not: each would store a bound sorting nowhere near the ids it bounds."""

        with pytest.raises(ValueError):
            compose_gesperrt_bis_saison_id(massgebliche_saison_id=unusable)


class TestALeagueThatHasRunNoSeason:
    def test_a_ban_is_refused_where_there_is_no_season_to_count_from(self):
        """`REQ-SPERRLISTE-002`. Without it the write would need a row bounded by nothing, which is the shape the lapse exists to end."""

        refusal = find_keine_saison_refusal(massgebliche_saison_id=None)

        assert refusal is not None
        assert refusal.error_code == SPERRLISTE_KEINE_SAISON

    def test_a_league_holding_a_season_that_ran_is_not_refused(self):
        """The control: a refusal answering every state would bar the endpoint outright and still pass the case above."""

        assert find_keine_saison_refusal(massgebliche_saison_id=str(FIRST_SAISON_YEAR)) is None
