from typing import Any

import pytest
from bson import ObjectId
from pydantic import ValidationError

from app.api.spielbestaetigungen.schemas import FLSpielbestaetigungAnsetzung, FLSpielbestaetigungAntwortPayload
from app.api.spielbestaetigungen.services import (
    ANSETZUNG_QUELLEN,
    ansetzung_stand_of,
    build_token_filter,
    compose_ansetzung,
    seat_holding,
)
from app.api.teams.schemas import KONTAKT_ROLLEN
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
        "team1": {"team_id": TEAM1, "name": "Eins", "shorthand": "EI", "tore": None},
        "team2": {"team_id": TEAM2, "name": "Zwei", "shorthand": "ZW", "tore": None},
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

        renamed = {"team_id": TEAM1, "name": "Umbenannt", "shorthand": "UM", "tore": 2}

        assert ansetzung_stand_of(spiel(ergebnis="2:1", notiz="x", team1=renamed)) == ansetzung_stand_of(spiel())

    def test_the_snapshot_stores_exactly_the_digests_inputs_beside_it(self):
        composed = compose_ansetzung(spiel())

        assert set(composed) == set(FLSpielbestaetigungAnsetzung.model_fields) == {*ANSETZUNG_QUELLEN, "stand"}
        assert composed["stand"] == ansetzung_stand_of(spiel())
        FLSpielbestaetigungAnsetzung.model_validate(composed)


def row(**seats: Any) -> dict[str, Any]:
    return {"kontakte": {seat: seats.get(seat) for seat in KONTAKT_ROLLEN}}


class TestATokenNamesItsSeat:
    def test_the_filter_has_one_clause_per_seat(self):
        """One clause per seat, each the path a support index carries: an `$or` uses indexes only where every clause has one."""

        assert build_token_filter(token_hash="h") == {"$or": [{f"kontakte.{seat}.token_hashes": "h"} for seat in KONTAKT_ROLLEN]}

    def test_every_link_a_seat_was_mailed_names_it(self):
        found = row(trainer={"token_hashes": ["t"]}, stellvertretung={"token_hashes": ["s1", "s2", "s3"]})

        assert [seat_holding(spielbestaetigung_raw=found, token_hash=h) for h in ("t", "s1", "s2", "s3")] == [
            "trainer",
            "stellvertretung",
            "stellvertretung",
            "stellvertretung",
        ]

    def test_a_link_two_seats_share_names_the_first_in_seat_order(self):
        """The case that fails if the resolution assumes one hash per seat."""

        found = row(trainer={"token_hashes": ["p"]}, stellvertretung={"token_hashes": ["p"]})

        assert seat_holding(spielbestaetigung_raw=found, token_hash="p") == "trainer"

    @pytest.mark.parametrize("found", [row(trainer={"token_hashes": ["t"]}), {"kontakte": None}, {}])
    def test_a_hash_no_seat_holds_names_none(self, found: dict[str, Any]):
        assert seat_holding(spielbestaetigung_raw=found, token_hash="x") is None


VORSCHLAG = {"datum": "2027-05-20", "uhrzeit": "17:00:00"}


class TestTheAnswersShape:
    @pytest.mark.parametrize(
        "body",
        [
            {"antwort": "abgelehnt", "vorschlag": None, "begruendung": "Halle belegt"},
            {"antwort": "zugesagt", "vorschlag": VORSCHLAG, "begruendung": None},
            {"antwort": "zugesagt", "vorschlag": None, "begruendung": "danke"},
            {"antwort": "abgelehnt", "vorschlag": VORSCHLAG, "begruendung": "eine\nzweite Zeile"},
            {"antwort": "abgelehnt", "vorschlag": VORSCHLAG, "begruendung": "x" * (SPIELBESTAETIGUNG_BEGRUENDUNG_MAX_LENGTH + 1)},
            {"antwort": "abgelehnt", "vorschlag": {**VORSCHLAG, "ort": "x"}, "begruendung": None},
            {"antwort": "zugesagt", "vorschlag": None},
        ],
        ids=["decline-without-date", "accept-with-date", "accept-with-reason", "two-lines", "over-bound", "extra-key", "key-omitted"],
    )
    def test_is_refused(self, body: dict[str, Any]):
        with pytest.raises(ValidationError):
            FLSpielbestaetigungAntwortPayload.model_validate({"token": "t", **body})

    def test_an_empty_reason_is_none(self):
        parsed = FLSpielbestaetigungAntwortPayload.model_validate(
            {"token": "t", "antwort": "abgelehnt", "vorschlag": VORSCHLAG, "begruendung": "   "}
        )

        assert parsed.begruendung is None
