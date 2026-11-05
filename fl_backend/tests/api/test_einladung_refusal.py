from typing import Any

from app.api.einladungen.services import (
    bestaetigte_empfaenger,
    plan_einladung_versand,
)
from tests.documents import kontaktperson_document

CONFIRMED_ON = "2026-03-20"


def kontaktperson(vorname: str, email: str, *, confirmed_at: str | None) -> dict[str, Any]:
    """One seat as the junction stores it. `confirmed_at` is the whole of what a recipient has to clear."""

    return kontaktperson_document(vorname, confirmed_at=confirmed_at, email=email, telefon="+49 69 1234567")


def kontakte(*, trainer: Any = None, ansprechperson: Any = None, stellvertretung: Any = None) -> dict[str, Any]:
    return {
        "trainer": trainer,
        "ansprechperson": ansprechperson,
        "stellvertretung": stellvertretung,
        "trainer_is_also": None,
    }


EINLADUNG: dict[str, Any] = {"saison_id": "2026", "revoked_at": None}


class TestWhoALinkIsMailedTo:
    def test_only_a_seat_its_own_person_confirmed_is_addressed(self):
        """An address nobody has proven is not one a credential goes to."""

        block = kontakte(
            trainer=kontaktperson("Bramblewick", "bramblewick@example.com", confirmed_at=CONFIRMED_ON),
            ansprechperson=kontaktperson("Quillhilde", "quillhilde@example.com", confirmed_at=None),
        )

        assert [entry.email for entry in bestaetigte_empfaenger(kontakte=block)] == ["bramblewick@example.com"]

    def test_one_person_holding_two_seats_is_one_message(self):
        block = kontakte(
            trainer=kontaktperson("Bramblewick", "bramblewick@example.com", confirmed_at=CONFIRMED_ON),
            stellvertretung=kontaktperson("Bramblewick", "bramblewick@example.com", confirmed_at=CONFIRMED_ON),
        )
        empfaenger = bestaetigte_empfaenger(kontakte=block)

        assert len(empfaenger) == 1
        # The FIRST seat in seat order, so the message addresses the person as the role they lead with.
        assert empfaenger[0].rolle == "trainer"

    def test_a_block_whose_seats_are_all_unconfirmed_addresses_nobody(self):
        block = kontakte(ansprechperson=kontaktperson("Quillhilde", "quillhilde@example.com", confirmed_at=None))

        assert bestaetigte_empfaenger(kontakte=block) == []

    def test_a_seat_with_no_address_is_no_recipient(self):
        block = kontakte(trainer={**kontaktperson("Bramblewick", "", confirmed_at=CONFIRMED_ON)})

        assert bestaetigte_empfaenger(kontakte=block) == []


class TestATeamTheBanListKeepsTheLinkFrom:
    """The mailer sends a barred address nothing and records nothing, so the plan reads the ban itself."""

    def test_a_re_send_does_not_reach_past_the_ban(self):
        """Each press would mint over the team's live link while nobody on it can be reached."""

        decided = plan_einladung_versand(
            austritt=None,
            kontakte=kontakte(trainer=kontaktperson("Bramblewick", "bramblewick@example.com", confirmed_at=CONFIRMED_ON)),
            einladung_raw={**EINLADUNG, "sent_at": CONFIRMED_ON},
            resend=True,
            barred=frozenset({"bramblewick@example.com"}),
        )

        assert decided == ([], "kontakte_barred", False)
