"""
API · the order a referee's own list serves their fixtures in: open work first, then each day to come, then the days gone by

The list's whole use is what to do next, so a request to answer filed among the days to come, or a day's untimed fixture
after its Anpfiff, is a referee looking in the wrong place.
"""

from datetime import UTC, datetime
from typing import Any

from bson import ObjectId

from app.api.schiedsrichter.schemas import FLSchiedsrichterSpiel
from app.api.schiedsrichter.services import order_self_spiele, owes_a_bericht


def entry(spiel_nr: int, date: str | None, time: str | None = None, *, reportable: bool = False, **fields: Any) -> FLSchiedsrichterSpiel:
    """A fixture to come, agreed and owing no report, its id ordered by `spiel_nr`; owed its report as the read serves it."""

    served = {
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
        "submitted_at": None,
        **fields,
    }
    owed = owes_a_bericht(reportable=reportable, submitted_at=served["submitted_at"], sonderereignis=served["sonderereignis"])

    return FLSchiedsrichterSpiel.model_validate({**served, "bericht_owed": owed})


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


def test_an_abandonment_owing_its_report_leads_while_a_no_show_owing_none_files_among_the_days_gone_by():
    """Each kicked off with no report sent; the no-show stands later than the abandonment and earlier than a reported game.

    Counted as owed, the no-show would lead behind the abandonment; the abandonment counted as owing nothing would file
    last, the days gone by running from the latest.
    """

    played = {"past": True, "reportable": True}
    abandoned = entry(1, "2027-05-13", "18:30:00", sonderereignis="abgebrochen", **played)
    no_show = entry(2, "2027-05-20", "18:30:00", sonderereignis="nichtantreten_team1", **played)
    reported = entry(3, "2027-05-27", "18:30:00", submitted_at=datetime(2027, 5, 27, 19, tzinfo=UTC), **played)

    assert served([reported, no_show, abandoned]) == [1, 3, 2]
