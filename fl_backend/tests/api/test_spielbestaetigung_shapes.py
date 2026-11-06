from typing import Any

import pytest
from bson import ObjectId

from app.api.spielbestaetigungen.services import ansetzung_stand_of

TEAM1 = ObjectId("650000000000000000000001")
TEAM2 = ObjectId("650000000000000000000002")
SPIELORT = ObjectId("650000000000000000000003")


def spiel(**overrides: Any) -> dict[str, Any]:
    """A raw fixture as the collection stores it, carrying fields the digest must not read."""

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


class TestTheStandNamesOneAnsetzung:
    def test_a_fixed_spiel_keeps_its_digest(self):
        """Pinned: every stored row's `stand` was composed this way, so a changed composition makes every open row read as moved."""

        assert ansetzung_stand_of(spiel()) == "ff22b9d18168e96dd86358f6bbc4997b59b77f23fd3028389a8a9f0b1c0ffc27"
        assert ansetzung_stand_of(spiel(spielort=None)) == "e214a39a277656e1c74a8aec08602c77631e7c7a6cdc9a1c2d48fb9b86364259"

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
        assert ansetzung_stand_of(spiel(**moved)) != ansetzung_stand_of(spiel())

    def test_what_is_no_input_leaves_it(self):
        """A result, a note or a renamed side is no new Ansetzung, and must not void a confirmation."""

        renamed = {"team_id": TEAM1, "tore": 2}

        assert ansetzung_stand_of(spiel(ergebnis="2:1", note="x", team1=renamed)) == ansetzung_stand_of(spiel())
