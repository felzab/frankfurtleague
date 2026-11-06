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
        "datum": "2027-05-14",
        "uhrzeit": "18:30:00",
        "ort": {"spielort_id": SPIELORT, "name": "Halle", "maps_link": "x", "mietpreis": 40},
        "team1": {"team_id": TEAM1, "name": "Eins", "shorthand": "EIX", "tore": None},
        "team2": {"team_id": TEAM2, "name": "Zwei", "shorthand": "ZWX", "tore": None},
        "ergebnis": None,
        "notiz": None,
        **overrides,
    }


class TestTheStandNamesOneAnsetzung:
    def test_a_fixed_fixture_keeps_its_digest(self):
        """Pinned: every stored row's `stand` was composed this way, so a changed composition makes every open row read as moved."""

        assert ansetzung_stand_of(spiel()) == "ff22b9d18168e96dd86358f6bbc4997b59b77f23fd3028389a8a9f0b1c0ffc27"
        assert ansetzung_stand_of(spiel(ort=None)) == "e214a39a277656e1c74a8aec08602c77631e7c7a6cdc9a1c2d48fb9b86364259"

    @pytest.mark.parametrize(
        "moved",
        [
            {"datum": "2027-05-15"},
            {"uhrzeit": "18:31:00"},
            {"ort": {"spielort_id": ObjectId("650000000000000000000004")}},
            {"team1": {"team_id": ObjectId("650000000000000000000004")}},
            {"team2": {"team_id": ObjectId("650000000000000000000004")}},
        ],
        ids=["datum", "uhrzeit", "spielort", "team1", "team2"],
    )
    def test_each_input_moves_it(self, moved: dict[str, Any]):
        assert ansetzung_stand_of(spiel(**moved)) != ansetzung_stand_of(spiel())

    def test_what_is_no_input_leaves_it(self):
        """A result, a note or a renamed side is no new Ansetzung, and must not void a confirmation."""

        renamed = {"team_id": TEAM1, "name": "Umbenannt", "shorthand": "UMX", "tore": 2}

        assert ansetzung_stand_of(spiel(ergebnis="2:1", notiz="x", team1=renamed)) == ansetzung_stand_of(spiel())
