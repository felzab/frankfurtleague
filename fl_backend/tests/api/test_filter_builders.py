from bson import ObjectId

from app.api.spiele.schemas import SONDEREREIGNIS_RECORDING_AN_ABSENCE, FLSpieleFilterParams
from app.api.spiele.services import build_spiele_filter
from app.api.spieltage.schemas import FLSpieltag, FLSpieltageFilterParams
from app.api.spieltage.services import build_spieltage_filter, build_spieltage_sort, order_spieltage

TODAY = "2026-07-31"


class TestSpieleFilter:
    def test_the_abgesagt_status_selects_every_fixture_recording_an_absence(self):
        """The only `spiel_status` branch that is not about time, and the only one nothing pinned."""

        compiled = build_spiele_filter(filters=FLSpieleFilterParams.model_validate({"spiel_status": "abgesagt"}), today=TODAY)

        assert compiled["sonderereignis"] == {"$in": list(SONDEREREIGNIS_RECORDING_AN_ABSENCE)}
        assert "datum" not in compiled

    def test_an_abandoned_fixture_is_not_abgesagt(self):
        """The distinction the branch exists to draw: an abandonment took place, so its date still decides its status."""

        compiled = build_spiele_filter(filters=FLSpieleFilterParams.model_validate({"spiel_status": "abgesagt"}), today=TODAY)

        assert "abgebrochen" not in compiled["sonderereignis"]["$in"]

    def test_passes_saison_id_through_under_its_own_name(self):
        """`saison_id` is a real field on the document here, so it needs no alias — unlike on `saisons`."""
        filters = FLSpieleFilterParams.model_validate({"saison_id": "2526"})

        assert build_spiele_filter(filters=filters, today=TODAY)["saison_id"] == "2526"

    def test_omits_saison_id_when_unset(self):
        """Reachable only in tests: the router resolves the current season before the builder ever runs."""
        filters = FLSpieleFilterParams.model_validate({})

        assert "saison_id" not in build_spiele_filter(filters=filters, today=TODAY)

    def test_playoffs_phase_becomes_a_negation(self):
        """`playoffs` is a query-only alias and must compile to "not gruppenphase", never a stored value."""
        filters = FLSpieleFilterParams.model_validate({"saison_phase": "playoffs"})

        assert build_spiele_filter(filters=filters, today=TODAY)["saison_phase"] == {"$ne": "gruppenphase"}

    def test_status_maps_to_a_date_comparison_against_today(self):
        """`ausstehend` is `$gte` by intent: the upcoming list must show today's fixtures, so a tightening to `$gt` is the regression."""
        vergangen = build_spiele_filter(filters=FLSpieleFilterParams.model_validate({"spiel_status": "vergangen"}), today=TODAY)
        ausstehend = build_spiele_filter(filters=FLSpieleFilterParams.model_validate({"spiel_status": "ausstehend"}), today=TODAY)
        heute = build_spiele_filter(filters=FLSpieleFilterParams.model_validate({"spiel_status": "heute"}), today=TODAY)

        assert vergangen["datum"] == {"$lt": TODAY}
        assert ausstehend["datum"] == {"$gte": TODAY}
        assert heute["datum"] == TODAY

    def test_team_id_matches_either_side_of_the_fixture_as_an_objectid(self):
        """Both sides via `$or`, and as a real `ObjectId`: a string here would match nothing and return empty."""
        filters = FLSpieleFilterParams.model_validate({"team_id": "6890a1b2c3d4e5f607182930"})

        assert build_spiele_filter(filters=filters, today=TODAY)["$or"] == [
            {"team1.team_id": ObjectId("6890a1b2c3d4e5f607182930")},
            {"team2.team_id": ObjectId("6890a1b2c3d4e5f607182930")},
        ]


class TestSpieltageFilter:
    def test_passes_saison_id_through_under_its_own_name(self):
        filters = FLSpieltageFilterParams.model_validate({"saison_id": "2526"})

        assert build_spieltage_filter(filters=filters)["saison_id"] == "2526"

    def test_omits_saison_id_when_unset(self):
        filters = FLSpieltageFilterParams.model_validate({})

        assert "saison_id" not in build_spieltage_filter(filters=filters)

    def test_playoffs_phase_becomes_a_negation(self):
        filters = FLSpieltageFilterParams.model_validate({"saison_phase": "playoffs"})

        assert build_spieltage_filter(filters=filters)["saison_phase"] == {"$ne": "gruppenphase"}


class TestSpieltageSort:
    """The Mongo sort, which is the prefix `limit` keeps and never the final order — `order_spieltage` is that."""

    def test_the_natural_order_sorts_on_the_stored_position(self):
        assert build_spieltage_sort(sort_by="natural", order="asc") == [("position", 1), ("_id", 1)]

    def test_a_descending_natural_page_takes_the_descending_end_of_a_tie(self):
        """A `position` repeats across the phases, so a tie can straddle `limit` and the chain has to follow `order`."""
        assert build_spieltage_sort(sort_by="natural", order="desc") == [("position", -1), ("_id", -1)]

    def test_a_date_sort_is_tie_broken_by_the_position(self):
        """Ascending whichever way the dates run: this chain exists to make a page reproducible, not to be reversed with it."""
        assert build_spieltage_sort(sort_by="ende", order="desc") == [("ende", -1), ("position", 1), ("_id", 1)]


class TestSpieltageOrder:
    """The played order, which the displayed name is composed from; a matchday carries no name, so cases identify one by `_id`."""

    def _spieltag(self, *, oid: str, phase: str, position: int, beginn: str = "2026-03-07") -> FLSpieltag:
        return FLSpieltag.model_validate(
            {
                "_id": ObjectId(oid),
                "beginn": beginn,
                "ende": beginn,
                "anzahl_spiele": 4,
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

    def test_the_phase_outranks_the_position(self):
        """The positions restart per phase, so a Halbfinale's 1 must not overtake the Gruppenphase's 3."""
        out_of_sequence = [
            self._spieltag(oid=self.B, phase="halbfinale", position=1),
            self._spieltag(oid=self.A, phase="gruppenphase", position=3),
        ]

        assert self._ids(order_spieltage(out_of_sequence)) == [self.A, self.B]

    def test_the_position_orders_within_one_phase(self):
        rounds = [
            self._spieltag(oid=self.C, phase="gruppenphase", position=3),
            self._spieltag(oid=self.A, phase="gruppenphase", position=1),
            self._spieltag(oid=self.B, phase="gruppenphase", position=2),
        ]

        assert self._ids(order_spieltage(rounds)) == [self.A, self.B, self.C]

    def test_the_dates_do_not_disturb_the_stored_order(self):
        """THE POINT OF STORING IT: `beginn` is free to be missing, equal or backwards and the order a person chose stands."""
        against_the_calendar = [
            self._spieltag(oid=self.B, phase="gruppenphase", position=2, beginn="2026-01-04"),
            self._spieltag(oid=self.A, phase="gruppenphase", position=1, beginn="2026-09-30"),
            self._spieltag(oid=self.C, phase="gruppenphase", position=3, beginn="2026-01-04"),
        ]

        assert self._ids(order_spieltage(against_the_calendar)) == [self.A, self.B, self.C]

    def test_the_id_breaks_a_shared_phase_and_position(self):
        """Reachable only across seasons, the unique index refusing the pair inside one; without it two calls disagree and the tabs move."""
        same_slot = [
            self._spieltag(oid=self.B, phase="gruppenphase", position=1),
            self._spieltag(oid=self.A, phase="gruppenphase", position=1),
        ]

        assert self._ids(order_spieltage(same_slot)) == [self.A, self.B]

    def test_leaves_its_input_alone(self):
        """`sorted`, not `list.sort` — the router hands it a validated list it may still hold a reference to."""
        rounds = [
            self._spieltag(oid=self.D, phase="finale", position=1),
            self._spieltag(oid=self.A, phase="gruppenphase", position=1),
        ]

        order_spieltage(rounds)

        assert self._ids(rounds) == [self.D, self.A]
