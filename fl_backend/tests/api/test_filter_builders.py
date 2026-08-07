"""
The filter builders, plus the matchday order — the pure half of each feature's `services.py`.

An ordering is pure in exactly the way a filter builder is: a list in, a list out, no collection and no
await, so it belongs in this file rather than in one of its own.

These are the first behaviour tests outside model validation, and they fit the suite's no-I/O
boundary: a builder takes a filter model and returns a dict, with no collection and no await
anywhere in the call. Anything that asserts the *routers* apply these correctly needs an HTTP
client and a database, which this suite deliberately does not have — see `tests/README.md`.
"""

from typing import get_args

from bson import ObjectId

from app.api.saisons.schemas import FLSaisonsFilterOptions
from app.api.saisons.services import build_saisons_filter
from app.api.spiele.schemas import PHASE_RANK, FLSaisonPhase, FLSpieleFilterParams
from app.api.spiele.services import build_spiele_filter
from app.api.spieltage.schemas import FLSpieltag, FLSpieltageFilterParams
from app.api.spieltage.services import build_spieltage_filter, order_spieltage

TODAY = "2026-07-31"


class TestSaisonsFilter:
    # The defect this file was created for: the builder's `include={...}` named a key no field has,
    # so pydantic matched nothing, the filter was dropped without any error, and every request to
    # /saisons was answered unfiltered. `include` names are strings and nothing checks them, which is
    # why the first test below asserts the property rather than one particular term.
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
        """One season by its id is an identity served by `GET /saisons/{saison_id}`, never a list filter (ADR-0034)."""
        filters = FLSaisonsFilterOptions.model_validate({"saison_id": "2526", "status": "past"})

        assert build_saisons_filter(filters=filters) == {"status": "past"}

    # Paging and sorting are not filter terms; they must not leak into the query document.
    def test_omits_unset_terms_and_never_leaks_paging(self):
        """An empty filter yields an empty query, and `limit`/`sort_by`/`order` never appear as filter terms."""
        filters = FLSaisonsFilterOptions.model_validate({})

        assert build_saisons_filter(filters=filters) == {}


class TestSpieleFilter:
    # The router resolves an omitted `saison_id` to the current season, so by the time the
    # builder runs the field is always set. Both spellings are asserted because the builder is
    # reachable with either.
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
        """All three date branches at once — note `ausstehend` is `$gte`, so it INCLUDES today."""
        vergangen = build_spiele_filter(filters=FLSpieleFilterParams.model_validate({"spiel_status": "vergangen"}), today=TODAY)
        ausstehend = build_spiele_filter(filters=FLSpieleFilterParams.model_validate({"spiel_status": "ausstehend"}), today=TODAY)
        heute = build_spiele_filter(filters=FLSpieleFilterParams.model_validate({"spiel_status": "heute"}), today=TODAY)

        assert vergangen["datum"] == {"$lt": TODAY}
        assert ausstehend["datum"] == {"$gte": TODAY}
        assert heute["datum"] == TODAY

    # The id reaches the query as a real `ObjectId`, not the string it arrived as — `team_id` is a
    # `CustomObjectId`, so validation coerces it. Asserted explicitly because a Mongo filter holding
    # the *string* would match nothing and return an empty list rather than an error.
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
    The derived order (ADR-0064).

    These are the tests a stored position never had: with the value written by hand there was nothing to
    assert but its type, and every ordering defect it permitted was invisible to the suite.
    """

    def _spieltag(self, *, name: str, phase: str, beginn: str) -> FLSpieltag:
        return FLSpieltag.model_validate(
            {
                "_id": ObjectId("6890a1b2c3d4e5f607182930"),
                "name": name,
                "beginn": beginn,
                "ende": beginn,
                "anzahl_spiele": 4,
                "saison_phase": phase,
                "saison_id": "2026",
                "inactive_since": None,
            }
        )

    def test_orders_the_phases_as_they_are_played(self):
        """
        The reason the phase leads rather than the date.

        Mongo sorts these four lexically — finale, gruppenphase, halbfinale, viertelfinale — so a `$sort`
        on the field is not this order.
        """
        shuffled = [
            self._spieltag(name="Finale", phase="finale", beginn="2026-09-04"),
            self._spieltag(name="Spieltag 1", phase="gruppenphase", beginn="2026-03-07"),
            self._spieltag(name="Halbfinale", phase="halbfinale", beginn="2026-08-21"),
            self._spieltag(name="Viertelfinale", phase="viertelfinale", beginn="2026-06-12"),
        ]

        assert [s.name for s in order_spieltage(shuffled)] == ["Spieltag 1", "Viertelfinale", "Halbfinale", "Finale"]

    def test_the_phase_outranks_the_date(self):
        """
        A knockout round dated before a group matchday still comes after it.

        This is the defect a stored position made possible in the other direction: a Halbfinale sitting at
        a lower number than the Viertelfinale it follows.
        """
        out_of_sequence = [
            self._spieltag(name="Halbfinale", phase="halbfinale", beginn="2026-01-01"),
            self._spieltag(name="Spieltag 1", phase="gruppenphase", beginn="2026-03-07"),
        ]

        assert [s.name for s in order_spieltage(out_of_sequence)] == ["Spieltag 1", "Halbfinale"]

    def test_the_date_orders_within_one_phase(self):
        """Three group matchdays are a date sequence, which is what the season's schedule already is."""
        rounds = [
            self._spieltag(name="Spieltag 3", phase="gruppenphase", beginn="2026-05-13"),
            self._spieltag(name="Spieltag 1", phase="gruppenphase", beginn="2026-03-07"),
            self._spieltag(name="Spieltag 2", phase="gruppenphase", beginn="2026-04-18"),
        ]

        assert [s.name for s in order_spieltage(rounds)] == ["Spieltag 1", "Spieltag 2", "Spieltag 3"]

    def test_the_name_breaks_a_shared_phase_and_date(self):
        """
        The order has to stay total, because nothing refuses two matchdays in one phase on one date.

        Without a final tie-break two calls can disagree, and the public Spielplan's tabs then move
        between reloads.
        """
        same_day = [
            self._spieltag(name="Gruppe B", phase="gruppenphase", beginn="2026-03-07"),
            self._spieltag(name="Gruppe A", phase="gruppenphase", beginn="2026-03-07"),
        ]

        assert [s.name for s in order_spieltage(same_day)] == ["Gruppe A", "Gruppe B"]

    def test_leaves_its_input_alone(self):
        """`sorted`, not `list.sort` — the router hands it a validated list it may still hold a reference to."""
        rounds = [
            self._spieltag(name="Finale", phase="finale", beginn="2026-09-04"),
            self._spieltag(name="Spieltag 1", phase="gruppenphase", beginn="2026-03-07"),
        ]

        order_spieltage(rounds)

        assert [s.name for s in rounds] == ["Finale", "Spieltag 1"]

    def test_every_phase_has_a_rank(self):
        """
        Every member of the phase Literal has a rank, so the ordering cannot raise on an unranked value.

        A fifth phase added to one and not the other would raise a KeyError on the next read rather than
        sorting oddly, and this is what catches it before that read happens in production.
        """
        assert set(PHASE_RANK) == set(get_args(FLSaisonPhase))
