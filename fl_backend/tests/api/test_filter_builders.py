"""
The filter builders — the pure `filters in, Mongo query out` half of each feature's `services.py`.

These are the first behaviour tests outside model validation, and they fit the suite's no-I/O
boundary: a builder takes a filter model and returns a dict, with no collection and no await
anywhere in the call. Anything that asserts the *routers* apply these correctly needs an HTTP
client and a database, which this suite deliberately does not have — see `tests/README.md`.
"""

from bson import ObjectId

from app.api.saisons.schemas import FLSaisonsFilterOptions
from app.api.saisons.services import build_saisons_filter
from app.api.spiele.schemas import FLSpieleFilterParams
from app.api.spiele.services import build_spiele_filter
from app.api.spieltage.schemas import FLSpieltageFilterParams
from app.api.spieltage.services import build_spieltage_filter

TODAY = "2026-07-31"


class TestSaisonsFilter:
    # The regression test for the defect this file was created with. `FLSaisonsFilterOptions`
    # declares the field as `saison_id` with `serialization_alias="_id"`; the builder used to
    # `include={"id", ...}`, a name no field has, so pydantic matched nothing and the filter was
    # dropped without any error. Every request to /saisons was answered unfiltered.
    def test_filters_by_saison_id_under_the_mongo_column_name(self):
        """The regression this file was created for: the filter was silently dropped and /saisons answered unfiltered."""
        filters = FLSaisonsFilterOptions.model_validate({"saison_id": "2526"})

        assert build_saisons_filter(filters=filters) == {"_id": "2526"}

    def test_filters_by_status(self):
        """`status` needs no alias — it is the same name on the model and in Mongo."""
        filters = FLSaisonsFilterOptions.model_validate({"status": "active"})

        assert build_saisons_filter(filters=filters) == {"status": "active"}

    def test_combines_both(self):
        """Two terms produce one document, rather than the second overwriting the first."""
        filters = FLSaisonsFilterOptions.model_validate({"saison_id": "2526", "status": "past"})

        assert build_saisons_filter(filters=filters) == {"_id": "2526", "status": "past"}

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
