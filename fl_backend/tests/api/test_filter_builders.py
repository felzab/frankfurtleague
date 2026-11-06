from bson import ObjectId

from app.api.spieltage.schemas import FLSpieltag
from app.api.spieltage.services import order_spieltage


class TestSpieltageOrder:
    """The played order, which the displayed name is composed from; a matchday carries no name, so cases identify one by `_id`."""

    def _spieltag(self, *, oid: str, phase: str, position: int, start: str = "2026-03-07") -> FLSpieltag:
        return FLSpieltag.model_validate(
            {
                "_id": ObjectId(oid),
                "start": start,
                "end": start,
                "count_spiele": 4,
                "position": position,
                "saison_phase": phase,
                "saison_id": "2026",
            }
        )

    # Four ids in ascending order, so a case can assert an ordering by the handle it sorted on.
    A = "6890a1b2c3d4e5f60718000a"
    B = "6890a1b2c3d4e5f60718000b"
    C = "6890a1b2c3d4e5f60718000c"
    D = "6890a1b2c3d4e5f60718000d"

    def _ids(self, spieltage: list[FLSpieltag]) -> list[str]:
        return [str(spieltag.id) for spieltag in spieltage]

    def test_orders_the_phases_as_they_are_played(self):
        """Mongo sorts the phase names lexically, so a `$sort` on the field is not this order."""
        shuffled = [
            self._spieltag(oid=self.D, phase="finale", position=1),
            self._spieltag(oid=self.A, phase="gruppenphase", position=1),
            self._spieltag(oid=self.C, phase="halbfinale", position=1),
            self._spieltag(oid=self.B, phase="viertelfinale", position=1),
        ]

        assert self._ids(order_spieltage(shuffled)) == [self.A, self.B, self.C, self.D]

    def test_the_dates_do_not_disturb_the_stored_order(self):
        """THE POINT OF STORING IT: `start` is free to be missing, equal or backwards and the order a person chose stands."""
        against_the_calendar = [
            self._spieltag(oid=self.B, phase="gruppenphase", position=2, start="2026-01-04"),
            self._spieltag(oid=self.A, phase="gruppenphase", position=1, start="2026-09-30"),
            self._spieltag(oid=self.C, phase="gruppenphase", position=3, start="2026-01-04"),
        ]

        assert self._ids(order_spieltage(against_the_calendar)) == [self.A, self.B, self.C]
