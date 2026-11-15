from collections.abc import Mapping
from typing import Any

import pytest

from app.api.bewerbungen.services import paired_seat
from app.api.kontakte.services import build_clearing_update
from app.shared.schemas.literals import KONTAKT_ROLLEN
from app.shared.tokens import hash_token
from tests.documents import kontaktperson_document, minted_confirmations

TODAY = "2026-04-01"


def written(update: Mapping[str, Any]) -> Mapping[str, Any]:
    return update["$set"]


class TestASlotAndItsBookkeepingMoveTogether:
    """A null `kontakte` slot beside a live `confirmations` entry is a seat the confirmation would `$set` under a null parent.

    Nothing but a decline and an erasure empties a slot, so their composers are where that state would come from.
    """

    @pytest.mark.parametrize("slots", [("trainer", "ansprechperson"), KONTAKT_ROLLEN])
    def test_an_erasure_over_an_application_nulls_the_entry_beside_every_slot(self, slots: tuple[str, ...]):
        update = written(build_clearing_update(slots, confirmations=True))

        for slot in slots:
            assert update[f"kontakte.{slot}"] is None
            assert update[f"confirmations.{slot}"] is None


# Fixed rather than minted, so a case names the same hash every run; the raw values are never
# needed here, only what the database would hold.
HASHES: Mapping[str, str] = {seat: hash_token(f"raw-{seat}") for seat in KONTAKT_ROLLEN}
CONFIRMATIONS: Mapping[str, Any] = minted_confirmations(hashes=HASHES, today=TODAY)


def kontakte(**overrides: Any) -> dict[str, Any]:
    return {
        "trainer": kontaktperson_document("Quillhilde"),
        "ansprechperson": kontaktperson_document("Ansgar"),
        "stellvertretung": kontaktperson_document("Stellan"),
        "trainer_is_also": None,
        **overrides,
    }


class TestThePairedSeat:
    """The double-seated Trainer: one click answers for the person, whichever of their two links they opened."""

    @pytest.mark.parametrize("also", ["stellvertretung"])
    def test_the_pairing_reads_in_both_directions(self, also: str):
        block = kontakte(trainer_is_also=also)

        assert paired_seat(kontakte=block, confirmations=CONFIRMATIONS, seat="trainer") == also
        assert paired_seat(kontakte=block, confirmations=CONFIRMATIONS, seat=also) == "trainer"
