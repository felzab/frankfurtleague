from collections.abc import Iterator, Mapping
from typing import Any

import pytest
from pydantic import ValidationError

from app.api.bewerbungen.schemas import FLDeclineBewerbungPayload
from app.api.bewerbungen.services import (
    compose_kontakt_seat_update,
    find_acceptance_code_refusal,
    find_kontakt_email_refusal,
    find_new_club_refusal,
)
from app.core.codes import Code
from tests.documents import kontaktperson_document


class ZorbanaxBoom(RuntimeError):
    """Not a `ValidationError`, so it is not the school's fault and may not be answered as one."""


class ExplodingSchule(Mapping[str, Any]):
    """A block whose every read raises, provoking a non-validation failure inside the guard.

    Pydantic reads a mapping to validate it, so what the `except` catches decides whether a fault in
    this code reads to an administrator as the school's fault.
    """

    def __getitem__(self, key: str) -> Any:
        raise ZorbanaxBoom("the block blew up")

    def __iter__(self) -> Iterator[str]:
        raise ZorbanaxBoom("the block blew up")

    def __len__(self) -> int:
        raise ZorbanaxBoom("the block blew up")


class TestOnlyTheSchoolsOwnFaultIsRefused:
    """A widened `except` files every bug on this path under `bewerbung_schule_unusable`."""

    def test_a_failure_that_is_no_validation_error_is_left_to_the_500(self):
        """The repair that refusal offers -- decline it and type the club in by hand -- is then the wrong one."""

        with pytest.raises(ZorbanaxBoom):
            find_new_club_refusal(club_document=ExplodingSchule())


class TestADeclinesReason:
    """The reason is stored and mailed verbatim, so a NUL or a page break an administrator pasted reaches every person it goes to."""

    @pytest.mark.parametrize("reason", ["Kein\x00Platz", "Kein\x0cPlatz", "Kein\u2028Platz"])
    def test_a_character_no_paragraph_holds_is_refused(self, reason: str):
        with pytest.raises(ValidationError):
            FLDeclineBewerbungPayload(reason=reason, version=0)


class TestWhatASeatWriteMoves:
    """Per seat: a write restarting the application's other seats keeps their details past their own 14 days."""

    SEAT = {"token_hashes": [], "sent_at": "2026-03-01", "deadline": "2026-03-15", "reminded_at": None, "declined_at": None}

    def written(self, **confirmations: Any) -> Mapping[str, Any]:
        person = {"first_name": "Berta", "last_name": "Beispiel", "email": "berta@example.de", "phone": "069 1234567"}

        return compose_kontakt_seat_update(seats=("trainer",), person=person, today="2026-04-01", confirmations=confirmations)["$set"]

    def test_only_the_written_seat_restarts(self):
        written = self.written(trainer=self.SEAT, ansprechperson=self.SEAT, stellvertretung=self.SEAT)

        assert written["confirmations.trainer"]["deadline"] == "2026-04-15"
        assert not any("ansprechperson" in path or "stellvertretung" in path for path in written)

    def test_filling_the_last_declined_seat_takes_the_announcement_back(self):
        """The notice named a deletion this write calls off, so the next deletion is announced afresh."""

        assert self.written(trainer={**self.SEAT, "declined_at": "2026-03-20"})["erasure_announced_at"] is None

    def test_a_widerspruch_on_another_seat_keeps_the_announcement(self):
        """That seat still takes the application on the day the notice named, and a second notice would announce one deletion twice."""

        assert "erasure_announced_at" not in self.written(trainer=self.SEAT, stellvertretung={**self.SEAT, "declined_at": "2026-03-20"})


class TestTheCodeAnAcceptanceTakes:
    """A new school accepted with no code fails at the club's own parse as the school's fault, and a code on a picked club is dropped unsaid."""

    @pytest.mark.parametrize(
        ("new_school", "shorthand"),
        [pytest.param(True, None, id="a new school with none"), pytest.param(False, "ABX", id="a picked club with one")],
    )
    def test_the_wrong_side_of_the_rule_is_refused_on_the_box(self, new_school: bool, shorthand: str | None):
        refusal = find_acceptance_code_refusal(new_school=new_school, shorthand=shorthand)

        assert refusal is not None
        assert (refusal.error_code, refusal.fields) == (Code.PAYLOAD_REFUSED, (("shorthand",),))


class TestCorrectingOneContactAddress:
    def test_another_spelling_of_the_address_another_person_is_reached_at_is_refused(self):
        """On the sign-in fold, as the submission compares it: otherwise two people end on one mailbox the erasure cannot tell apart."""

        seats = {
            "trainer": kontaktperson_document("Quillhilde"),
            "ansprechperson": kontaktperson_document("Ansgar"),
            "stellvertretung": kontaktperson_document("Stellan"),
            "trainer_is_also": None,
        }

        refusal = find_kontakt_email_refusal(kontakte=seats, seats=("ansprechperson",), email="STELLAN@example.com")

        # Naming the field, or the dialog has no box to say it on.
        assert refusal is not None and (refusal.error_code, refusal.fields) == (Code.BEWERBUNG_KONTAKT_EMAIL_TAKEN, (("email",),))
