import asyncio
from typing import Any, cast

import pytest
from bson import ObjectId
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from pymongo.asynchronous.collection import AsyncCollection

from app.api.bewerbungen.router import get_bewerbungen
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
    "einwilligung": {"umfang": "kontaktdaten", "erteilt_von": "person", "text_version": "v1", "datum": "2026-01-15"},
}


def bewerbung_document(index: int) -> dict[str, Any]:
    """One stored application, undecided. Validated by the route, so every required field is here."""

    return {
        "_id": ObjectId(BEWERBUNG_ID.format(index)),
        "saison_id": SAISON_ID,
        "eingereicht_am": "2026-02-01",
        "status": "eingereicht",
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


class _ArchiveCollection:
    """One collection, called as `pull_many_from_db` calls the driver: `find`, `sort`, `limit`, `to_list`."""

    def __init__(self, documents: list[dict[str, Any]]) -> None:
        self.documents = documents
        # What the route ASKED for, kept because the answer alone cannot tell a read bounded at the
        # cap from one bounded a document past it.
        self.requested_limit: int | None = None
        # The cursor is a FILTER term, so a page of the right length off the wrong filter would
        # satisfy every assertion about its contents.
        self.requested_filter: Any = None

    def find(self, filter: Any, projection: Any = None, session: Any = None) -> "_ArchiveCollection":
        self.requested_filter = filter
        self.documents = [d for d in self.documents if "_id" not in (filter or {}) or d["_id"] < filter["_id"]["$lt"]]
        return self

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
        run_list(collection, saison_id="2026", status="eingereicht")

        assert collection.requested_filter == {"saison_id": "2026", "status": "eingereicht"}

    def test_an_unfiltered_read_narrows_on_nothing(self):
        """The control: a filter built from absent parameters would narrow to rows nobody asked about."""

        collection = _ArchiveCollection(archive_of(3))
        run_list(collection)

        assert collection.requested_filter == {}


# The dependency alone, mounted on a bare app: what is under test is how FastAPI fills the model, so
# the real router's admin guard and collection would only stand between the query string and it.
_probe = FastAPI()


@_probe.get("/probe")
def _read_filters(filters: FLBewerbungenFilterParams = Depends()) -> dict[str, Any]:
    return {"limit": filters.limit}


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
