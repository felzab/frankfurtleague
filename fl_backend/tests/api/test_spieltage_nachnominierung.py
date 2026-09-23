import asyncio
from typing import Any, cast

import pytest
from pymongo.asynchronous.collection import AsyncCollection

from app.api.spieltage.crud import nachnominierung_laeuft_in
from app.api.spieltage.services import nachnominierung_laeuft

# The day every stored-state case is judged on, so the stored matchday is the only thing a case moves.
TODAY = "2026-04-01"


class TestTheNachnominierungPeriodOpensOnMatchdayOnesFirstDay:
    """The period's own boundary, read off `spieltage` at `position` 1 rather than off a fixture's date."""

    def test_the_day_before_the_span_is_not_yet_a_nachnominierung(self):
        assert nachnominierung_laeuft(beginn="2026-04-02", today="2026-04-01") is False

    def test_the_first_day_of_the_span_is_one(self):
        """The day itself, not the day after: a player joining on matchday 1 joins a season already under way."""

        assert nachnominierung_laeuft(beginn="2026-04-01", today="2026-04-01") is True

    def test_a_later_day_is_one(self):
        assert nachnominierung_laeuft(beginn="2026-04-01", today="2026-04-30") is True

    @pytest.mark.parametrize("beginn", [None, 20260401], ids=["an undated matchday", "a date stored as a number"])
    def test_a_season_whose_matchday_one_carries_no_date_has_not_begun(self, beginn: Any):
        """A drawn season holds no dates until somebody sets them, and an undated one takes ordinary registrations."""

        assert nachnominierung_laeuft(beginn=beginn, today="2026-04-30") is False


class _OneMatchday:
    """A `spieltage` collection answering one stored matchday, or none, and recording what it was asked."""

    def __init__(self, stored: dict[str, Any] | None) -> None:
        self.stored = stored
        self.asked: list[tuple[Any, Any, Any]] = []

    async def find_one(self, db_filter: Any, projection: Any, *, session: Any = None) -> dict[str, Any] | None:
        self.asked.append((db_filter, projection, session))
        return self.stored


def _laeuft_in(stub: _OneMatchday, *, session: Any = None) -> bool:
    return asyncio.run(
        nachnominierung_laeuft_in(spieltage_collection=cast(AsyncCollection, stub), saison_id="2026", today=TODAY, session=session)
    )


class TestThePeriodIsReadOffTheFirstPhasesMatchdayOne:
    """What the invite's read and the squad create both call, so one reading of `spieltage` decides both."""

    def test_it_asks_for_the_first_phases_first_matchday_alone(self):
        """`position` restarts in every phase: without the phase, a knockout round's matchday 1 could answer for the season's start."""

        stub = _OneMatchday(None)
        _laeuft_in(stub)

        assert [db_filter for db_filter, _, _ in stub.asked] == [{"saison_id": "2026", "saison_phase": "gruppenphase", "position": 1}]

    def test_the_read_runs_in_the_callers_session(self):
        """The create judges inside its transaction, so a helper dropping the session reads a calendar the write never saw."""

        stub = _OneMatchday(None)
        session = object()
        _laeuft_in(stub, session=session)

        assert [asked_in for _, _, asked_in in stub.asked] == [session]

    @pytest.mark.parametrize(
        ("stored", "laeuft"),
        [
            (None, False),
            ({"beginn": None}, False),
            ({"beginn": "2026-04-02"}, False),
            ({"beginn": TODAY}, True),
            ({"beginn": "2026-03-15"}, True),
        ],
        ids=["no matchday yet", "an undated matchday 1", "dated after today", "dated today", "dated before today"],
    )
    def test_each_stored_state_answers_as_the_predicate_does(self, stored: dict[str, Any] | None, laeuft: bool):
        assert _laeuft_in(_OneMatchday(stored)) is laeuft
