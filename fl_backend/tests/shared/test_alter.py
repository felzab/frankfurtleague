import pytest

from app.shared.alter import whole_years_between


class TestWholeYears:
    """The age arithmetic every consent flow judges by, pinned against fixed pairs of dates so the boundary is provable without a clock."""

    @pytest.mark.parametrize(
        ("born", "today", "years"),
        [
            pytest.param("2010-06-01", "2026-06-01", 16, id="the birthday itself"),
            pytest.param("2010-06-02", "2026-06-01", 15, id="the day before the birthday"),
            pytest.param("2010-05-31", "2026-06-01", 16, id="the day after"),
            pytest.param("2008-02-29", "2026-02-28", 17, id="a leap birthday, the year's 28th"),
            pytest.param("2008-02-29", "2026-03-01", 18, id="a leap birthday, the following day"),
        ],
    )
    def test_a_birthday_not_yet_reached_this_year_has_not_counted(self, born: str, today: str, years: int):
        """Off by one here and every person born in the second half of the year is judged a year older, on all three flows at once."""

        assert whole_years_between(born=born, today=today) == years
