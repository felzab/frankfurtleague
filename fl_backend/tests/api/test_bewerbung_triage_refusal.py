from collections.abc import Iterator, Mapping
from typing import Any

import pytest

from app.api.bewerbungen.services import (
    BEWERBUNG_KONTAKT_EMAIL_TAKEN,
    find_kontakt_email_refusal,
    find_new_club_refusal,
)
from tests.documents import kontaktperson_document

# Every one of these is stored happily and refused by `FLTeam`, which reads the clubs list. The
# first is an XSS sink the moment React renders it into an href.


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
    """A widened `except` files every bug on this path under `REQ-BEWERBUNG-003`."""

    def test_a_failure_that_is_no_validation_error_is_left_to_the_500(self):
        """The repair that refusal offers -- decline it and type the club in by hand -- is then the wrong one."""

        with pytest.raises(ZorbanaxBoom):
            find_new_club_refusal(club_document=ExplodingSchule())


class TestCorrectingOneContactAddress:
    def test_another_spelling_of_the_address_another_person_is_reached_at_is_refused(self):
        """On the sign-in fold, as the submission compares it: otherwise two people end on one mailbox the erasure cannot tell apart."""

        seats = {
            "trainer": kontaktperson_document("Quillhilde"),
            "ansprechperson": kontaktperson_document("Ansgar"),
            "stellvertretung": kontaktperson_document("Stellan"),
            "trainer_ist_zugleich": None,
        }

        refusal = find_kontakt_email_refusal(kontakte=seats, seats=("ansprechperson",), email="STELLAN@example.com")

        assert refusal is not None and refusal.error_code == BEWERBUNG_KONTAKT_EMAIL_TAKEN
