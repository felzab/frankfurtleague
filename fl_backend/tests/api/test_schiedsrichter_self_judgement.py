"""
API · how a referee's own list judges a fixture gone by: whether they still referee it, write its report and owe it

A booking a club's exit ended is one the pass told the referee they no longer hold, so a list still offering its report
hands them back a game they were told is off; a no-show's report stays open to write, and a list owing it puts work on
them that nobody asked for.
"""

from datetime import UTC, datetime
from typing import Any

import pytest
from bson import ObjectId

from app.api.saisons.services import SAISON_AS, SPIELTAG_ROWS_AS
from app.api.schiedsrichter.services import BERICHT_AS, OWN_ROW_AS, compose_self_spiel
from tests import documents

KICK_OFF = "2027-05-20"
RESULT = {"ergebnis": "2:1", "team1_tore": 2, "team2_tore": 1}


@pytest.mark.parametrize(
    ("austritt", "record", "refereed", "owed"),
    [
        pytest.param(None, RESULT, True, True, id="a match played"),
        pytest.param(None, {"sonderereignis": "abgebrochen"}, True, True, id="a match abandoned"),
        # It used neither the ground nor the referee, so its report stays open to write and nobody owes it.
        pytest.param(None, {"sonderereignis": "nichtantreten_team1", "ergebnis": "0:3"}, True, False, id="a no-show"),
        pytest.param(KICK_OFF, {}, False, False, id="a club out by its day"),
        # The walkover a fixture against a departed club is reported with: read through the decision, which answers
        # the event first, the referee the pass told „Du pfeifst … nicht mehr“ would be handed the booking back.
        pytest.param(
            KICK_OFF, {"sonderereignis": "nichtantreten_team1", "ergebnis": "0:3"}, False, False, id="a club out by its day reported absent"
        ),
        # An exit dated back over a match already played: its referee officiated and was told nothing.
        pytest.param(KICK_OFF, RESULT, True, True, id="a match played before an exit dated back over it"),
    ],
)
def test_a_past_fixture_is_refereed_and_reportable_and_owes_its_report_unless_a_team_left_by_its_day_and_it_was_never_played(
    austritt: str | None, record: dict[str, Any], refereed: bool, owed: bool
):
    """Each kicked off with no report sent, in a running season: refereed, its report takes a write, owed unless a side did not turn up.

    Not refereed, the list shows no booking.
    """

    stored = documents.spiel_document(
        spiel_id=ObjectId(),
        saison_id="2027",
        spiel_nr=1,
        spieltag_id=ObjectId(),
        date=KICK_OFF,
        time="18:30:00",
        team1={"team_id": ObjectId(), "tore": record.get("team1_tore")},
        team2={"team_id": ObjectId(), "tore": record.get("team2_tore")},
        ergebnis=record.get("ergebnis"),
        sonderereignis=record.get("sonderereignis"),
    )
    joined = documents.joined_spiel_document(stored)
    joined["team1"]["austritt"] = None if austritt is None else {"date": austritt}

    served = compose_self_spiel(
        {
            **joined,
            SPIELTAG_ROWS_AS: [{"position": 1, "count_in_phase": 3}],
            OWN_ROW_AS: [],
            BERICHT_AS: [],
            SAISON_AS: [{"status": "active"}],
        },
        now=datetime(2027, 5, 21, 12, tzinfo=UTC),
    )

    assert (served.officiates, served.past, served.reportable, served.bericht_owed) == (refereed, True, refereed, owed)
