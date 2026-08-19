from bson import ObjectId

from app.api.saisons.schemas import FLSaisonsFilterOptions
from app.api.saisons.services import build_saisons_filter
from app.api.spiele.schemas import FLSpieleFilterParams
from app.api.spiele.services import build_spiele_filter
from app.api.spieltage.schemas import FLSpieltag, FLSpieltageFilterParams
from app.api.spieltage.services import build_spieltage_filter, order_spieltage

TODAY = "2026-07-31"


class TestSaisonsFilter:
    def test_every_included_name_is_a_real_field(self):
        """A name no field carries is dropped silently and the endpoint answers unfiltered, which every value-level case below still passes."""
        included = {"status"}

        assert included <= set(FLSaisonsFilterOptions.model_fields)

    def test_filters_by_status(self):
        """`status` needs no alias — it is the same name on the model and in Mongo."""
        filters = FLSaisonsFilterOptions.model_validate({"status": "active"})

        assert build_saisons_filter(filters=filters) == {"status": "active"}

    def test_a_season_id_is_not_a_filter_term(self):
        """One season by its id is an identity served by `GET /saisons/{saison_id}`, never a list filter."""
        filters = FLSaisonsFilterOptions.model_validate({"saison_id": "2526", "status": "past"})

        assert build_saisons_filter(filters=filters) == {"status": "past"}

    def test_omits_unset_terms_and_never_leaks_paging(self):
        """Paging and sorting are not filter terms and must not leak into the query document."""
        filters = FLSaisonsFilterOptions.model_validate({})

        assert build_saisons_filter(filters=filters) == {}


class TestSpieleFilter:
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


class TestSpieltageOrder:
    """The derived order, which the displayed name is composed from; a matchday carries no name, so cases identify one by `_id`."""

    def _spieltag(self, *, oid: str, phase: str, beginn: str) -> FLSpieltag:
        return FLSpieltag.model_validate(
            {
                "_id": ObjectId(oid),
                "beginn": beginn,
                "ende": beginn,
                "anzahl_spiele": 4,
                "saison_phase": phase,
                "saison_id": "2026",
                "inactive_since": None,
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
            self._spieltag(oid=self.D, phase="finale", beginn="2026-09-04"),
            self._spieltag(oid=self.A, phase="gruppenphase", beginn="2026-03-07"),
            self._spieltag(oid=self.C, phase="halbfinale", beginn="2026-08-21"),
            self._spieltag(oid=self.B, phase="viertelfinale", beginn="2026-06-12"),
        ]

        assert self._ids(order_spieltage(shuffled)) == [self.A, self.B, self.C, self.D]

    def test_the_phase_outranks_the_date(self):
        """A stored position permits the reverse: a Halbfinale numbered below the Viertelfinale it follows."""
        out_of_sequence = [
            self._spieltag(oid=self.B, phase="halbfinale", beginn="2026-01-01"),
            self._spieltag(oid=self.A, phase="gruppenphase", beginn="2026-03-07"),
        ]

        assert self._ids(order_spieltage(out_of_sequence)) == [self.A, self.B]

    def test_the_date_orders_within_one_phase(self):
        rounds = [
            self._spieltag(oid=self.C, phase="gruppenphase", beginn="2026-05-13"),
            self._spieltag(oid=self.A, phase="gruppenphase", beginn="2026-03-07"),
            self._spieltag(oid=self.B, phase="gruppenphase", beginn="2026-04-18"),
        ]

        assert self._ids(order_spieltage(rounds)) == [self.A, self.B, self.C]

    def test_the_id_breaks_a_shared_phase_and_date(self):
        """Nothing refuses two matchdays in one phase on one date, and without a tie-break two calls disagree and the tabs move."""
        same_day = [
            self._spieltag(oid=self.B, phase="gruppenphase", beginn="2026-03-07"),
            self._spieltag(oid=self.A, phase="gruppenphase", beginn="2026-03-07"),
        ]

        assert self._ids(order_spieltage(same_day)) == [self.A, self.B]

    def test_leaves_its_input_alone(self):
        """`sorted`, not `list.sort` — the router hands it a validated list it may still hold a reference to."""
        rounds = [
            self._spieltag(oid=self.D, phase="finale", beginn="2026-09-04"),
            self._spieltag(oid=self.A, phase="gruppenphase", beginn="2026-03-07"),
        ]

        order_spieltage(rounds)

        assert self._ids(rounds) == [self.D, self.A]
