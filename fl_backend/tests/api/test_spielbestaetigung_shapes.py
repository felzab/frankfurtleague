from typing import Any

import pytest
from bson import ObjectId
from pydantic import ValidationError

from app.api.spielbestaetigungen.schemas import (
    FLSpielbestaetigungAnsetzung,
    FLSpielbestaetigungAntwortPayload,
    FLSpielbestaetigungSchiedsrichterAntwortPayload,
)
from app.api.spielbestaetigungen.services import (
    ANSETZUNG_QUELLEN,
    ansetzung_stand_of,
    compose_ansetzung,
)
from app.shared.schemas.bounds import SPIELBESTAETIGUNG_BEGRUENDUNG_MAX_LENGTH

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

    def test_the_snapshot_stores_exactly_the_digests_inputs_beside_it(self):
        composed = compose_ansetzung(spiel())

        assert set(composed) == set(FLSpielbestaetigungAnsetzung.model_fields) == {*ANSETZUNG_QUELLEN, "stand"}
        assert composed["stand"] == ansetzung_stand_of(spiel())
        FLSpielbestaetigungAnsetzung.model_validate(composed)


VORSCHLAG = {"datum": "2027-05-20", "uhrzeit": "17:00:00"}


class TestTheAnswersShape:
    @pytest.mark.parametrize(
        "body",
        [
            {"antwort": "declined", "vorschlag": None, "begruendung": "Halle belegt"},
            {"antwort": "zugesagt", "vorschlag": VORSCHLAG, "begruendung": None},
            {"antwort": "zugesagt", "vorschlag": None, "begruendung": "danke"},
            {"antwort": "declined", "vorschlag": VORSCHLAG, "begruendung": "eine\nzweite Zeile"},
            {"antwort": "declined", "vorschlag": VORSCHLAG, "begruendung": "x" * (SPIELBESTAETIGUNG_BEGRUENDUNG_MAX_LENGTH + 1)},
            {"antwort": "declined", "vorschlag": {**VORSCHLAG, "ort": "x"}, "begruendung": None},
            {"antwort": "zugesagt", "vorschlag": None},
        ],
        ids=["decline-without-date", "accept-with-date", "accept-with-reason", "two-lines", "over-bound", "extra-key", "key-omitted"],
    )
    def test_is_refused(self, body: dict[str, Any]):
        with pytest.raises(ValidationError):
            FLSpielbestaetigungAntwortPayload.model_validate({"token": "t", **body})

    def test_an_empty_reason_is_none(self):
        parsed = FLSpielbestaetigungAntwortPayload.model_validate(
            {"token": "t", "antwort": "declined", "vorschlag": VORSCHLAG, "begruendung": "   "}
        )

        assert parsed.begruendung is None


class TestTheRefereesAnswersShape:
    """A stale page or a scripted client reaches the endpoint past the panel's own schema, which refuses the same two."""

    @pytest.mark.parametrize(
        "body",
        [
            {"antwort": "declined", "begruendung": None},
            {"antwort": "declined", "begruendung": "   "},
            {"antwort": "zugesagt", "begruendung": "gern"},
        ],
        ids=["decline-without-reason", "decline-with-blank-reason", "accept-with-reason"],
    )
    def test_is_refused(self, body: dict[str, Any]):
        with pytest.raises(ValidationError):
            FLSpielbestaetigungSchiedsrichterAntwortPayload.model_validate(body)
