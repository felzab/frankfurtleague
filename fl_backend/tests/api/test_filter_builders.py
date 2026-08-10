"""
API · the filter builders, plus the matchday order — the pure half of each `services.py`

An ordering is pure in exactly the way a filter builder is: a list in, a list out, no collection
and no await, so it belongs here rather than in a file of its own. Anything asserting that the
routers apply these correctly needs an HTTP client and a database, which this suite deliberately
does not have — see `docs/backend/spec.md`.
"""

from bson import ObjectId

from app.api.saisons.schemas import FLSaisonsFilterOptions
from app.api.saisons.services import build_saisons_filter
from app.api.spiele.schemas import FLSpieleFilterParams
from app.api.spiele.services import build_spiele_filter
from app.api.spieltage.schemas import FLSpieltag, FLSpieltageFilterParams
from app.api.spieltage.services import build_spieltage_filter, order_spieltage

TODAY = "2026-07-31"


class TestSaisonsFilter:
    # The defect: an `include={...}` naming a key no field has matches nothing, so the filter is
    # dropped with no error and every request is answered unfiltered. `include` names are strings and
    # nothing checks them, so the first test asserts the property.
    def test_every_included_name_is_a_real_field(self):
        """
        The class of bug, not one instance of it: a name in `include` that no field carries.

        Pydantic drops such a key silently, so the filter vanishes and the endpoint answers
        unfiltered. Asserting the property means a field renamed without updating the builder fails
        here even though every value-level test below would still pass.
        """
        included = {"status"}

        assert included <= set(FLSaisonsFilterOptions.model_fields)

    def test_filters_by_status(self):
        """`status` needs no alias — it is the same name on the model and in Mongo."""
        filters = FLSaisonsFilterOptions.model_validate({"status": "active"})

        assert build_saisons_filter(filters=filters) == {"status": "active"}

    def test_a_season_id_is_not_a_filter_term(self):
        """One season by its id is an identity served by `GET /saisons/{saison_id}`, never a list filter (ADR-0027)."""
        filters = FLSaisonsFilterOptions.model_validate({"saison_id": "2526", "status": "past"})

        assert build_saisons_filter(filters=filters) == {"status": "past"}

    # Paging and sorting are not filter terms; they must not leak into the query document.
    def test_omits_unset_terms_and_never_leaks_paging(self):
        """An empty filter yields an empty query, and `limit`/`sort_by`/`order` never appear as filter terms."""
        filters = FLSaisonsFilterOptions.model_validate({})

        assert build_saisons_filter(filters=filters) == {}


class TestSpieleFilter:
    # The router resolves an omitted `saison_id` to the current season, so the field is always set by
    # the time the builder runs. Both spellings are asserted anyway; only a test reaches the unset
    # one.
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
        """All three date branches at once.

        `ausstehend` is `$gte` — it INCLUDES today, as intent rather than accident (ADR-0058):
        the landing page's upcoming list must show today's fixtures, so a tightening to `$gt`
        is the regression this assertion exists to refuse.
        """
        vergangen = build_spiele_filter(filters=FLSpieleFilterParams.model_validate({"spiel_status": "vergangen"}), today=TODAY)
        ausstehend = build_spiele_filter(filters=FLSpieleFilterParams.model_validate({"spiel_status": "ausstehend"}), today=TODAY)
        heute = build_spiele_filter(filters=FLSpieleFilterParams.model_validate({"spiel_status": "heute"}), today=TODAY)

        assert vergangen["datum"] == {"$lt": TODAY}
        assert ausstehend["datum"] == {"$gte": TODAY}
        assert heute["datum"] == TODAY

    # The id reaches the query as a real `ObjectId`, not the string it arrived as -- `team_id` is a
    # `CustomObjectId`, so validation coerces it. Asserted explicitly because a filter holding the
    # string matches nothing and returns an empty list.
    def test_team_id_matches_either_side_of_the_fixture_as_an_objectid(self):
        """Both sides via `$or`, and as a real ObjectId — a string here would match nothing and return empty."""
        filters = FLSpieleFilterParams.model_validate({"team_id": "6890a1b2c3d4e5f607182930"})

        assert build_spiele_filter(filters=filters, today=TODAY)["$or"] == [
            {"team1.team_id": ObjectId("6890a1b2c3d4e5f607182930")},
            {"team2.team_id": ObjectId("6890a1b2c3d4e5f607182930")},
        ]


class TestSpieltageFilter:
    def test_passes_saison_id_through_under_its_own_name(self):
        """`saison_id` is a real field on the document here, so it needs no alias — unlike on `saisons`."""
        filters = FLSpieltageFilterParams.model_validate({"saison_id": "2526"})

        assert build_spieltage_filter(filters=filters)["saison_id"] == "2526"

    def test_omits_saison_id_when_unset(self):
        """Reachable only in tests: the router resolves the current season before the builder ever runs."""
        filters = FLSpieltageFilterParams.model_validate({})

        assert "saison_id" not in build_spieltage_filter(filters=filters)

    def test_playoffs_phase_becomes_a_negation(self):
        """`playoffs` is a query-only alias and must compile to "not gruppenphase", never a stored value."""
        filters = FLSpieltageFilterParams.model_validate({"saison_phase": "playoffs"})

        assert build_spieltage_filter(filters=filters)["saison_phase"] == {"$ne": "gruppenphase"}


class TestSpieltageOrder:
    """
    The derived order, which is also what the displayed name is composed from (ADR-0051).

    A stored position offers nothing to assert but its type, so every ordering defect it permits is
    invisible to a suite (ADR-0051). A derived one is assertable, which is what these cases do.

    Each matchday is identified by its `_id` rather than by a name, because a matchday carries no name --
    the id is both the final tie-break and the only stable handle a test has on one.
    """

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

    #: Four ids in ascending order, so a test can assert an ordering by the handle it sorted on.
    A = "6890a1b2c3d4e5f60718000a"
    B = "6890a1b2c3d4e5f60718000b"
    C = "6890a1b2c3d4e5f60718000c"
    D = "6890a1b2c3d4e5f60718000d"

    def _ids(self, spieltage: list[FLSpieltag]) -> list[str]:
        return [str(spieltag.id) for spieltag in spieltage]

    def test_orders_the_phases_as_they_are_played(self):
        """
        The reason the phase leads rather than the date.

        Mongo sorts the five lexically — achtelfinale, finale, gruppenphase, halbfinale, viertelfinale —
        so a `$sort` on the field is not this order.
        """
        shuffled = [
            self._spieltag(oid=self.D, phase="finale", beginn="2026-09-04"),
            self._spieltag(oid=self.A, phase="gruppenphase", beginn="2026-03-07"),
            self._spieltag(oid=self.C, phase="halbfinale", beginn="2026-08-21"),
            self._spieltag(oid=self.B, phase="viertelfinale", beginn="2026-06-12"),
        ]

        assert self._ids(order_spieltage(shuffled)) == [self.A, self.B, self.C, self.D]

    def test_the_phase_outranks_the_date(self):
        """
        A knockout round dated before a group matchday still comes after it.

        This is the defect a stored position made possible in the other direction: a Halbfinale sitting at
        a lower number than the Viertelfinale it follows.
        """
        out_of_sequence = [
            self._spieltag(oid=self.B, phase="halbfinale", beginn="2026-01-01"),
            self._spieltag(oid=self.A, phase="gruppenphase", beginn="2026-03-07"),
        ]

        assert self._ids(order_spieltage(out_of_sequence)) == [self.A, self.B]

    def test_the_date_orders_within_one_phase(self):
        """Three group matchdays are a date sequence, which is what the season's schedule already is."""
        rounds = [
            self._spieltag(oid=self.C, phase="gruppenphase", beginn="2026-05-13"),
            self._spieltag(oid=self.A, phase="gruppenphase", beginn="2026-03-07"),
            self._spieltag(oid=self.B, phase="gruppenphase", beginn="2026-04-18"),
        ]

        assert self._ids(order_spieltage(rounds)) == [self.A, self.B, self.C]

    def test_the_id_breaks_a_shared_phase_and_date(self):
        """
        The order has to stay total, because nothing refuses two matchdays in one phase on one date.

        Without a final tie-break two calls can disagree, and the public Spielplan's tabs then move between
        reloads. The tie-break is the id rather than a name for two reasons: a matchday has none, and the
        name a reader sees is composed FROM this order, so using it here would be circular (ADR-0051).
        """
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
