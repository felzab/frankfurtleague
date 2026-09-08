import asyncio
from typing import Any, Mapping, cast

import pytest
from bson import ObjectId
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from pymongo.asynchronous.collection import AsyncCollection

from app.api.bewerbungen.router import FLBewerbungenFilters, get_bewerbungen
from app.api.bewerbungen.schemas import FLBewerbungenFilterParams
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX

SAISON_ID = "2026"

# 20 fixed characters and a four-digit tail, so every id below is a well-formed ObjectId.
BEWERBUNG_ID = "6890a1b2c3d4e5f60793{:04d}"

ADDRESS = {
    "strasse": "Hanauer Landstraße",
    "hausnummer": "12a",
    "plz": "60314",
    "stadtteil": "Ostend",
    "stadt": "Frankfurt am Main",
}

KONTAKTPERSON = {
    "vorname": "Anke",
    "nachname": "Koerner",
    "email": "a.koerner@example.de",
    "telefon": "+49 170 1234567",
    "geburtsdatum": "1984-05-09",
    "einwilligung": {"umfang": "kontaktdaten", "erfasst_von": "person", "text_version": "v1", "datum": "2026-01-15"},
}


def bewerbung_document(index: int, status: str = "eingereicht", saison_id: str = SAISON_ID) -> dict[str, Any]:
    """One stored application. Validated by the route, so every required field is here."""

    return {
        "_id": ObjectId(BEWERBUNG_ID.format(index)),
        "saison_id": saison_id,
        "eingereicht_am": "2026-02-01",
        "status": status,
        "team_id": None,
        "schule": {
            "team_name": f"Schule {index}",
            "full_name": f"Schule {index} Gesamtschule",
            "shorthand": "SG",
            "schulform": "gesamtschule",
            "address": dict(ADDRESS),
            "website_url": "https://example.de",
        },
        "kontakte": {
            "trainer": dict(KONTAKTPERSON),
            "ansprechperson": None,
            "stellvertretung": None,
            "trainer_ist_zugleich": None,
        },
        "trikot": {"vorhandener_satz": "16 rote Trikots", "wunschfarbe": "rot"},
        "kader": {"voraussichtliche_groesse": 14, "gute_spieler": 3},
        "entscheidung": None,
    }


def archive_of(count: int) -> list[dict[str, Any]]:
    return [bewerbung_document(index) for index in range(1, count + 1)]


def matches(document: Mapping[str, Any], db_filter: Mapping[str, Any]) -> bool:
    """Equality and `$in`, which is every operator this endpoint composes."""

    for field, term in db_filter.items():
        held = document.get(field)
        if field == "_id" and isinstance(term, dict) and "$lt" in term:
            if not held < term["$lt"]:
                return False
        elif isinstance(term, dict):
            if held not in term["$in"]:
                return False
        elif held != term:
            return False

    return True


class _ArchiveCollection:
    """One collection, called as `pull_many_from_db` calls the driver: `find`, `sort`, `limit`, `to_list`."""

    def __init__(self, documents: list[dict[str, Any]]) -> None:
        self.documents = documents
        # The archive as it stands, because `find` narrows `documents` in place and the counts are
        # answered against everything stored rather than against what one read left.
        self.stored = list(documents)
        # What the route ASKED for, kept because the answer alone cannot tell a read bounded at the
        # cap from one bounded a document past it.
        self.requested_limit: int | None = None
        # The cursor is a FILTER term, so a page of the right length off the wrong filter would
        # satisfy every assertion about its contents.
        self.requested_filter: Any = None

    def find(self, filter: Any, projection: Any = None, collation: Any = None, session: Any = None) -> "_ArchiveCollection":
        self.requested_filter = filter
        # Applied rather than recorded: a fake serving every row whatever it was asked for would let
        # a case about what one status's page holds pass over rows of all three.
        self.documents = [document for document in self.documents if matches(document, filter or {})]
        return self

    async def count_documents(self, filter: Any) -> int:
        return len([document for document in self.stored if matches(document, filter or {})])

    def sort(self, sort_by: Any) -> "_ArchiveCollection":
        # Applied rather than accepted: a fake that ignores the sort hands back insertion order, and
        # a keyset walk over it would look total while paging the wrong end of the queue.
        for field, direction in reversed(list(sort_by)):
            self.documents.sort(key=lambda document: document[field], reverse=direction < 0)
        return self

    def limit(self, count: int) -> "_ArchiveCollection":
        self.requested_limit = count
        # Truncating rather than answering everything: this IS the silent loss under test.
        self.documents = self.documents[:count]
        return self

    async def to_list(self, length: int | None = None) -> list[dict[str, Any]]:
        return self.documents if length is None else self.documents[:length]


def run_list(collection: _ArchiveCollection, **filters: Any) -> Any:
    """`asyncio.run`, as the rest of the suite drives an async function; no event-loop plugin is configured."""

    return asyncio.run(
        get_bewerbungen(
            bewerbungen_collection=cast(AsyncCollection, collection),
            filters=FLBewerbungenFilterParams.model_validate(filters),
        )
    )


class TestTheListDegradesRatherThanRefusing:
    """A tripwire would let an anonymous writer choose when this page 500s.

    The reason it does not sits at `app/api/bewerbungen/router.py :: get_bewerbungen`.
    """

    def test_an_archive_past_the_cap_is_served_short(self):
        answered = run_list(_ArchiveCollection(archive_of(LIST_LIMIT_DEFAULT + 25)))

        assert len(answered.bewerbungen) == LIST_LIMIT_DEFAULT
        assert answered.vollstaendig is False

    def test_an_archive_past_the_cap_raises_nothing(self):
        """The whole point of the change: the old guard answered 500 here, and 500 is the attack."""

        run_list(_ArchiveCollection(archive_of(LIST_LIMIT_DEFAULT * 3)))

    def test_an_archive_under_the_cap_is_whole(self):
        answered = run_list(_ArchiveCollection(archive_of(7)))

        assert len(answered.bewerbungen) == 7
        assert answered.vollstaendig is True

    def test_an_archive_exactly_at_the_cap_is_whole(self):
        """The boundary the probe row exists for: the largest complete answer must not call itself short."""

        answered = run_list(_ArchiveCollection(archive_of(LIST_LIMIT_DEFAULT)))

        assert len(answered.bewerbungen) == LIST_LIMIT_DEFAULT
        assert answered.vollstaendig is True

    def test_one_row_past_the_cap_is_the_first_incomplete_answer(self):
        """The other side of the same boundary, so the flag cannot be a constant."""

        assert run_list(_ArchiveCollection(archive_of(LIST_LIMIT_DEFAULT + 1))).vollstaendig is False

    def test_the_read_asks_one_row_past_what_it_serves(self):
        """Non-vacuity: a read bounded AT the cap could never tell a full list from a truncated one."""

        collection = _ArchiveCollection(archive_of(3))
        run_list(collection)

        assert collection.requested_limit == LIST_LIMIT_DEFAULT + 1

    def test_the_probe_row_is_never_served(self):
        answered = run_list(_ArchiveCollection(archive_of(9)), limit=4)

        assert len(answered.bewerbungen) == 4
        assert answered.vollstaendig is False


class TestTheCallersOwnBoundIsCappedRatherThanObeyed:
    """`limit` is the operator's recovery path under a flood, and it is bounded on both sides."""

    @pytest.mark.parametrize("named", [1, 7, LIST_LIMIT_MAX])
    def test_a_named_bound_is_the_bound_served(self, named: int):
        collection = _ArchiveCollection(archive_of(LIST_LIMIT_MAX + 10))
        answered = run_list(collection, limit=named)

        assert len(answered.bewerbungen) == named
        assert collection.requested_limit == named + 1

    def test_a_named_bound_that_covers_the_archive_reports_it_whole(self):
        """A caller who asked for ten and got seven was not truncated, and must not be told they were."""

        assert run_list(_ArchiveCollection(archive_of(7)), limit=10).vollstaendig is True

    @pytest.mark.parametrize("refused", [0, -1, LIST_LIMIT_MAX + 1, 999999])
    def test_a_bound_outside_the_range_is_refused(self, refused: int):
        """The CAP, not just the default: a caller naming a larger read must not be served it."""

        with pytest.raises(ValidationError):
            FLBewerbungenFilterParams.model_validate({"limit": refused})


class TestTheFiltersStillNarrowTheRead:
    """Season and status are what an operator reaches for under a flood, so they reach the query."""

    def test_the_filters_named_reach_the_db_filter(self):
        collection = _ArchiveCollection(archive_of(3))
        run_list(collection, saison_id="2026", status=["eingereicht"])

        assert collection.requested_filter == {"saison_id": "2026", "status": {"$in": ["eingereicht"]}}

    def test_two_statuses_reach_the_read_as_one_term(self):
        """The whole reason the parameter is a list: `$in` is what a multi-select facet's second click composes."""

        collection = _ArchiveCollection(archive_of(3))
        run_list(collection, status=["angenommen", "abgelehnt"])

        assert collection.requested_filter == {"status": {"$in": ["angenommen", "abgelehnt"]}}

    def test_an_unfiltered_read_narrows_on_nothing(self):
        """The control: a filter built from absent parameters would narrow to rows nobody asked about."""

        collection = _ArchiveCollection(archive_of(3))
        run_list(collection)

        assert collection.requested_filter == {}


def mixed_archive() -> list[dict[str, Any]]:
    """Five open, three accepted, two declined, and the accepted ones in another season."""

    return [
        *(bewerbung_document(index) for index in range(1, 6)),
        *(bewerbung_document(index, status="angenommen", saison_id="2025") for index in range(6, 9)),
        *(bewerbung_document(index, status="abgelehnt") for index in range(9, 11)),
    ]


class TestTheCountsAreTheServersRatherThanTheRowsOnHand:
    """What the narrowing would otherwise cost: a caller counting the rows it was served.

    Narrowed to one status, that count is zero for every other status -- which is what the triage
    bar disables an option on.
    """

    def test_every_status_is_counted_though_the_page_holds_one(self):
        answered = run_list(_ArchiveCollection(mixed_archive()), status=["eingereicht"])

        assert [row.status for row in answered.bewerbungen] == ["eingereicht"] * 5
        assert answered.anzahl_je_status == {"eingereicht": 5, "angenommen": 3, "abgelehnt": 2}

    def test_a_page_holding_no_rows_still_says_what_the_others_hold(self):
        """The case that decides the shape: the counts cannot ride on the rows, because there need be none."""

        answered = run_list(_ArchiveCollection(mixed_archive()), saison_id=SAISON_ID, status=["angenommen"])

        assert answered.bewerbungen == []
        assert answered.anzahl_je_status == {"eingereicht": 5, "angenommen": 0, "abgelehnt": 2}

    def test_each_count_keeps_every_term_but_the_status_it_answers_for(self):
        """A count taken with the request's own status term applied would read zero for every status nobody asked for."""

        answered = run_list(_ArchiveCollection(mixed_archive()), saison_id="2026", status=["eingereicht"])

        assert answered.anzahl_je_status == {"eingereicht": 5, "angenommen": 0, "abgelehnt": 2}

    def test_the_counts_name_all_three_states_whatever_is_stored(self):
        """An option missing from the answer is an option the bar has no number for, which reads as zero."""

        assert sorted(run_list(_ArchiveCollection(archive_of(2))).anzahl_je_status) == ["abgelehnt", "angenommen", "eingereicht"]


# The declaration alone, mounted on a bare app: what is under test is how FastAPI fills the model, so
# the real router's admin guard and collection would only stand between the query string and it.
_probe = FastAPI()


# The router's own alias and never a second spelling of it: the filling is what these cases judge.
@_probe.get("/probe")
def _read_filters(filters: FLBewerbungenFilters) -> dict[str, Any]:
    return {"limit": filters.limit, "status": filters.status}


class TestNoQueryStringReachesAnUnboundedRead:
    """The cap is the whole bound, so a caller able to forge it past the ceiling would disarm it."""

    def test_an_omitted_bound_arrives_as_the_default(self):
        with TestClient(_probe) as client:
            assert client.get("/probe").json()["limit"] == LIST_LIMIT_DEFAULT

    def test_a_named_bound_arrives_as_the_number(self):
        with TestClient(_probe) as client:
            assert client.get("/probe?limit=10").json()["limit"] == 10

    @pytest.mark.parametrize("value", ["", "null", "none", "0", "-1", str(LIST_LIMIT_MAX + 1), "999999"])
    def test_no_query_string_reaches_a_larger_read(self, value: str):
        """Empty, unparseable or past either bound is a 422 -- never a read the caller sized."""

        with TestClient(_probe) as client:
            assert client.get(f"/probe?limit={value}").status_code == 422


class TestTheQueueOffersOneOrderAlone:
    """Why one order is all this endpoint offers sits at `app/api/bewerbungen/schemas.py :: FLBewerbungenSortOptions`."""

    # 422 rather than 404: the value arrives in the query string, and the routing clause in
    # `.claude/rules/backend.md` keeps 404 for a path id.
    @pytest.mark.parametrize("value", ["saison_id", "status", "eingereicht_am_desc"])
    def test_an_unoffered_sort_key_is_refused(self, value: str):
        with TestClient(_probe) as client:
            assert client.get(f"/probe?sort_by={value}").status_code == 422

    def test_the_offered_sort_key_is_served(self):
        """Non-vacuity: a model refusing every value would pass the case above without offering anything."""

        with TestClient(_probe) as client:
            assert client.get("/probe?sort_by=eingereicht_am").status_code == 200


class TestWhatAStatusSelectionMayBeSpelledAs:
    """A `list` field on a `Depends()` model publishes no query parameter and answers `None` whatever the query string holds.

    Silently, which is why `FLBewerbungenFilters` names `Query()` and why these cases drive the
    filling rather than the model.
    """

    @pytest.mark.parametrize(
        ("query", "picked"),
        [
            ("status=eingereicht", ["eingereicht"]),
            ("status=eingereicht&status=abgelehnt", ["eingereicht", "abgelehnt"]),
            ("status=eingereicht,abgelehnt", ["eingereicht", "abgelehnt"]),
            ("status=angenommen,abgelehnt&status=eingereicht", ["angenommen", "abgelehnt", "eingereicht"]),
        ],
    )
    def test_repeating_the_parameter_and_joining_its_values_are_one_selection(self, query: str, picked: list[str]):
        with TestClient(_probe) as client:
            assert client.get(f"/probe?{query}").json()["status"] == picked

    @pytest.mark.parametrize("query", ["", "status="])
    def test_an_absent_or_emptied_parameter_narrows_on_nothing(self, query: str):
        """`null` and never `[]`: the queue's off-switch is the empty parameter, and `$in: []` would answer it with nothing."""

        with TestClient(_probe) as client:
            assert client.get(f"/probe?{query}").json()["status"] is None

    # 422 rather than 404, the routing clause in `.claude/rules/backend.md` keeping 404 for a path id.
    @pytest.mark.parametrize("value", ["erfunden", "EINGEREICHT", "eingereicht,erfunden", "null", "0"])
    def test_a_status_outside_the_set_is_refused(self, value: str):
        with TestClient(_probe) as client:
            assert client.get(f"/probe?status={value}").status_code == 422

    def test_the_parameter_is_published_as_a_query_parameter(self):
        """What `Depends()` failed silently at: a body field publishes nothing here and is never filled from a URL."""

        with TestClient(_probe) as client:
            published = client.get("/openapi.json").json()["paths"]["/probe"]["get"]["parameters"]

        assert "status" in [parameter["name"] for parameter in published]
