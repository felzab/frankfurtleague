from typing import Any

from app.api.invitations.services import (
    confirmed_recipients,
)
from tests.documents import kontaktperson_document

CONFIRMED_ON = "2026-03-20"


def kontaktperson(first_name: str, email: str, *, confirmed_at: str | None) -> dict[str, Any]:
    """One seat as the junction stores it. `confirmed_at` is the whole of what a recipient has to clear."""

    return kontaktperson_document(first_name, confirmed_at=confirmed_at, email=email, phone="+49 69 1234567")


def kontakte(*, trainer: Any = None, ansprechperson: Any = None, stellvertretung: Any = None) -> dict[str, Any]:
    return {
        "trainer": trainer,
        "ansprechperson": ansprechperson,
        "stellvertretung": stellvertretung,
        "trainer_is_also": None,
    }


INVITATION: dict[str, Any] = {"saison_id": "2026", "revoked_at": None}


class TestWhoALinkIsMailedTo:
    def test_only_a_seat_its_own_person_confirmed_is_addressed(self):
        """An address nobody has proven is not one a credential goes to."""

        block = kontakte(
            trainer=kontaktperson("Bramblewick", "bramblewick@example.com", confirmed_at=CONFIRMED_ON),
            ansprechperson=kontaktperson("Quillhilde", "quillhilde@example.com", confirmed_at=None),
        )

        assert [entry.email for entry in confirmed_recipients(kontakte=block)] == ["bramblewick@example.com"]

    def test_one_person_holding_two_seats_is_one_message(self):
        block = kontakte(
            trainer=kontaktperson("Bramblewick", "bramblewick@example.com", confirmed_at=CONFIRMED_ON),
            stellvertretung=kontaktperson("Bramblewick", "bramblewick@example.com", confirmed_at=CONFIRMED_ON),
        )
        recipient = confirmed_recipients(kontakte=block)

        assert len(recipient) == 1
        # The FIRST seat in seat order, so the message addresses the person as the role they lead with.
        assert recipient[0].rolle == "trainer"

    def test_an_unconfirmed_first_seat_leaves_the_next_one_addressed(self):
        """The seats are read in turn, so stopping at the Trainer would keep the link from a person who confirmed."""

        block = kontakte(
            trainer=kontaktperson("Bramblewick", "bramblewick@example.com", confirmed_at=None),
            ansprechperson=kontaktperson("Quillhilde", "quillhilde@example.com", confirmed_at=CONFIRMED_ON),
        )

        assert [(entry.rolle, entry.email) for entry in confirmed_recipients(kontakte=block)] == [("ansprechperson", "quillhilde@example.com")]

    def test_a_repeated_address_leaves_the_seat_after_it_addressed(self):
        block = kontakte(
            trainer=kontaktperson("Bramblewick", "bramblewick@example.com", confirmed_at=CONFIRMED_ON),
            ansprechperson=kontaktperson("Bramblewick", "bramblewick@example.com", confirmed_at=CONFIRMED_ON),
            stellvertretung=kontaktperson("Quillhilde", "quillhilde@example.com", confirmed_at=CONFIRMED_ON),
        )

        assert [entry.email for entry in confirmed_recipients(kontakte=block)] == ["bramblewick@example.com", "quillhilde@example.com"]
