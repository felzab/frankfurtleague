from typing import Any, Mapping

import pytest

from app.api.bewerbungen.services import KONTAKT_SEATS, compose_decline_update
from app.api.kontakte.services import KONTAKT_SLOTS, build_clearing_update

TODAY = "2026-04-01"


def written(update: Mapping[str, Any]) -> Mapping[str, Any]:
    return update["$set"]


class TestASlotAndItsBookkeepingMoveTogether:
    """A null `kontakte` slot beside a live `bestaetigungen` entry is a seat the confirmation would `$set` under a null parent.

    Nothing else empties a slot, so these two composers are where that state would come from.
    """

    @pytest.mark.parametrize("seats", [("trainer",), ("trainer", "ansprechperson"), KONTAKT_SEATS])
    def test_a_decline_stamps_the_entry_of_every_seat_it_empties(self, seats: tuple[str, ...]):
        update = written(compose_decline_update(seats=seats, today=TODAY))

        for seat in seats:
            assert update[f"kontakte.{seat}"] is None
            assert update[f"bestaetigungen.{seat}.abgelehnt_am"] == TODAY

    @pytest.mark.parametrize("slots", [("trainer",), ("trainer", "ansprechperson"), KONTAKT_SLOTS])
    def test_an_erasure_over_an_application_nulls_the_entry_beside_every_slot(self, slots: tuple[str, ...]):
        update = written(build_clearing_update(slots, bestaetigungen=True))

        for slot in slots:
            assert update[f"kontakte.{slot}"] is None
            assert update[f"bestaetigungen.{slot}"] is None

    def test_an_erasure_finding_no_block_moves_no_bookkeeping(self):
        """The flag's other side: a junction row and an application stored before the flow have no entry to null."""

        update = written(build_clearing_update(KONTAKT_SLOTS))

        assert set(update) == {f"kontakte.{slot}" for slot in KONTAKT_SLOTS}
