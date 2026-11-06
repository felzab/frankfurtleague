from typing import Any

from app.api.invitations.services import (
    confirmed_recipients,
    plan_invitation_dispatch,
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


class TestATeamTheBanListKeepsTheLinkFrom:
    """The mailer sends a barred address nothing and records nothing, so the plan reads the ban itself."""

    def test_a_re_send_does_not_reach_past_the_ban(self):
        """Each press would mint over the team's live link while nobody on it can be reached."""

        decided = plan_invitation_dispatch(
            austritt=None,
            kontakte=kontakte(trainer=kontaktperson("Bramblewick", "bramblewick@example.com", confirmed_at=CONFIRMED_ON)),
            invitation_raw={**INVITATION, "sent_at": CONFIRMED_ON},
            resend=True,
            barred=frozenset({"bramblewick@example.com"}),
        )

        assert decided == ([], "kontakte_barred")
