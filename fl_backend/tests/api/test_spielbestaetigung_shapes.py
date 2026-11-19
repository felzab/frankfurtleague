from typing import Any

import pytest
from bson import ObjectId

from app.api.spielbestaetigungen.services import ansetzung_values_of, compose_ansetzung

TEAM1 = ObjectId("650000000000000000000001")
TEAM2 = ObjectId("650000000000000000000002")
SPIELORT = ObjectId("650000000000000000000003")


def spiel(**overrides: Any) -> dict[str, Any]:
    """A raw fixture as the collection stores it, carrying fields the Ansetzung must not read."""

    return {
        "_id": ObjectId("650000000000000000000009"),
        "date": "2027-05-14",
        "time": "18:30:00",
        "spielort": {"spielort_id": SPIELORT, "mietpreis": 40},
        "team1": {"team_id": TEAM1, "tore": None},
        "team2": {"team_id": TEAM2, "tore": None},
        "ergebnis": None,
        "note": None,
        **overrides,
    }


def ansetzung(**overrides: Any) -> tuple[Any, ...]:
    return ansetzung_values_of(compose_ansetzung(spiel(**overrides)))


class TestTheValuesNameOneAnsetzung:
    @pytest.mark.parametrize(
        "moved",
        [
            {"date": "2027-05-15"},
            {"time": "18:31:00"},
            {"spielort": {"spielort_id": ObjectId("650000000000000000000004")}},
            {"team1": {"team_id": ObjectId("650000000000000000000004")}},
            {"team2": {"team_id": ObjectId("650000000000000000000004")}},
        ],
        ids=["date", "time", "spielort", "team1", "team2"],
    )
    def test_each_input_moves_it(self, moved: dict[str, Any]):
        assert ansetzung(**moved) != ansetzung()

    def test_what_is_no_input_leaves_it(self):
        """A result, a note or a renamed side is no new Ansetzung, and must not void a confirmation."""

        renamed = {"team_id": TEAM1, "tore": 2}

        assert ansetzung(ergebnis="2:1", note="x", team1=renamed) == ansetzung()
