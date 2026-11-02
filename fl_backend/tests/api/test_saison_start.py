import asyncio
from typing import Any, cast

import pytest

from app.api.saisons.crud import nachnominierung_laeuft_in
from app.api.saisons.services import find_saison_start_refusal, has_started
from app.core.codes import Code
from app.core.readonly import ReadCollection

# The day every case is judged on, so the stored start is the only thing a case moves.
TODAY = "2026-04-01"


class TestTheSeasonStartsOnItsStartDate:
    """The one start every start lock, the Nachnominierung and the landing read."""

    def test_the_day_before_is_not_yet_started(self):
        assert has_started(start_date="2026-04-02", today=TODAY) is False

    def test_the_start_date_itself_is_started(self):
        """The day itself, not the day after: the countdown reaches 00:00 of it, and the locks close with it."""

        assert has_started(start_date=TODAY, today=TODAY) is True

    def test_a_later_day_is_started(self):
        assert has_started(start_date="2026-03-15", today=TODAY) is True


class _OneSeason:
    """A `saisons` collection answering one stored season, recording the session it was asked in."""

    def __init__(self, start_date: str) -> None:
        self.start_date = start_date
        self.sessions: list[Any] = []

    async def find_one(self, **asked: Any) -> dict[str, Any]:
        self.sessions.append(asked.get("session"))
        return {"_id": asked["filter"]["_id"], "start_date": self.start_date}


def _laeuft_in(stub: _OneSeason, *, session: Any = None) -> bool:
    return asyncio.run(nachnominierung_laeuft_in(saisons_collection=cast(ReadCollection, stub), saison_id="2026", today=TODAY, session=session))


class TestTheSquadCreateReadsTheStartInItsSession:
    def test_the_read_runs_in_the_callers_session(self):
        """The create judges inside its transaction, so a helper dropping the session reads a start the write never saw."""

        stub = _OneSeason(TODAY)
        session = object()
        _laeuft_in(stub, session=session)

        assert stub.sessions == [session]

    @pytest.mark.parametrize(("start_date", "late"), [("2026-04-02", False), (TODAY, True)], ids=["starting tomorrow", "starting today"])
    def test_it_answers_as_the_predicate_does(self, start_date: str, late: bool):
        assert _laeuft_in(_OneSeason(start_date)) is late


class TestTheStartIsFixedOnceAFixtureHasTakenPlace:
    """`saison_start_taken_place`: compared by value, so only a MOVED start is refused, and only after play."""

    def test_a_moved_start_after_play_is_refused(self):
        refusal = find_saison_start_refusal(stored_start_date="2026-03-01", proposed_start_date="2026-03-08", taken_place=True)

        assert refusal is not None and refusal.error_code == Code.SAISON_START_TAKEN_PLACE

    def test_a_resubmitted_start_after_play_passes(self):
        """A dates-only edit of the end resubmits the stored start, which has to pass on a played season."""

        assert find_saison_start_refusal(stored_start_date="2026-03-01", proposed_start_date="2026-03-01", taken_place=True) is None

    def test_a_moved_start_before_play_passes(self):
        """The way a season frozen too early is unlocked."""

        assert find_saison_start_refusal(stored_start_date="2026-03-01", proposed_start_date="2026-05-01", taken_place=False) is None
