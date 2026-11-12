"""
API · the order a referee's own list serves their fixtures in: open work first, then each day to come, then the days gone by

The list's whole use is what to do next, so a request to answer filed among the days to come, or a day's untimed fixture
after its Anpfiff, is a referee looking in the wrong place.
"""

from typing import Any

from bson import ObjectId

from app.api.schiedsrichter.schemas import FLSchiedsrichterSpiel
from app.api.schiedsrichter.services import order_self_spiele


def entry(spiel_nr: int, date: str | None, time: str | None = None, **fields: Any) -> FLSchiedsrichterSpiel:
    """A fixture to come, agreed and owing no report, its id ordered by `spiel_nr`."""

    return FLSchiedsrichterSpiel.model_validate(
        {
            "spiel_id": ObjectId(f"6890a1b2c3d4e5f607e600{10 + spiel_nr:02d}"),
            "team1_name": "Adler",
            "team2_name": "Biber",
            "date": date,
            "time": time,
            "spielort": None,
            "sonderereignis": None,
            "spielbestaetigung_id": None,
            "state": "agreed",
            "reason": None,
            "entered": False,
            "past": False,
            "reportable": False,
            "submitted_at": None,
            **fields,
        }
    )


def served(spiele: list[FLSchiedsrichterSpiel]) -> list[int]:
    return [int(str(spiel.spiel_id)[-2:]) - 10 for spiel in order_self_spiele(spiele)]


def test_a_day_to_come_leads_with_its_untimed_fixture_then_by_time_then_by_id_and_an_undated_one_comes_last():
    """Handed in the reverse of that order, so a sort leaving any key out keeps some of it.

    The untimed fixture holds the newest id: read without the time, it would follow both timed ones.
    """

    untimed = entry(5, "2027-05-20")
    early, early_again = entry(2, "2027-05-20", "18:30:00"), entry(3, "2027-05-20", "18:30:00")
    later = entry(4, "2027-05-21", "10:00:00")
    undated = entry(1, None)

    assert served([undated, later, early_again, early, untimed]) == [5, 2, 3, 4, 1]


def test_a_request_to_answer_leads_a_day_to_come_ahead_of_it():
    """The request is dated after the agreed fixture: by day alone it would stand second."""

    agreed = entry(1, "2027-05-20", "18:30:00")
    to_answer = entry(2, "2027-05-27", "18:30:00", state="valid", spielbestaetigung_id=ObjectId())

    assert served([agreed, to_answer]) == [2, 1]
