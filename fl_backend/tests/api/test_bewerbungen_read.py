import asyncio
from typing import Any, cast

import pytest
from bson import ObjectId
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from motor.motor_asyncio import AsyncIOMotorCollection

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

    def find(self, filter: Any, projection: Any = None, session: Any = None) -> "_ArchiveCollection":
        return self

    def sort(self, sort_by: Any) -> "_ArchiveCollection":
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
            bewerbungen_collection=cast(AsyncIOMotorCollection, collection),
            filters=FLBewerbungenFilterParams.model_validate(filters),
        )
    )


class TestTheTriageListRefusesATruncatedArchive:
    """`bewerbungen` has no delete, no TTL and no purge (`docs/backend/spec.md :: I45`).

    The sort is newest-first, so a silent truncation drops the OLDEST rows and an administrator
    picking an early season reads the empty table as the filter's answer.
    """

    def test_an_archive_past_the_cap_is_refused(self):
        with pytest.raises(ValueError, match=str(LIST_LIMIT_DEFAULT)):
            run_list(_ArchiveCollection(archive_of(LIST_LIMIT_DEFAULT + 1)))

    def test_an_archive_at_the_cap_is_still_listed(self):
        """The boundary in the other direction: the largest readable archive must not answer 500."""

        assert len(run_list(_ArchiveCollection(archive_of(LIST_LIMIT_DEFAULT))).bewerbungen) == LIST_LIMIT_DEFAULT

    def test_the_unbounded_read_asks_one_document_past_the_cap(self):
        """Non-vacuity: a read bounded AT the cap could never see the extra row, so nothing would ever raise."""

        collection = _ArchiveCollection(archive_of(3))
        run_list(collection)

        assert collection.requested_limit == LIST_LIMIT_DEFAULT + 1


class TestACallersOwnBoundIsNeverATruncation:
    """A caller who asked for ten and got ten was not surprised, so the tripwire is scoped to the unbounded read."""

    def test_a_named_limit_is_served_short_without_refusing(self):
        answered = run_list(_ArchiveCollection(archive_of(LIST_LIMIT_DEFAULT + 1)), limit=10)

        assert len(answered.bewerbungen) == 10

    def test_a_named_limit_bounds_the_read_at_exactly_what_was_asked(self):
        collection = _ArchiveCollection(archive_of(LIST_LIMIT_DEFAULT + 1))
        run_list(collection, limit=10)

        assert collection.requested_limit == 10

    def test_a_caller_naming_the_cap_itself_is_not_refused(self):
        """The case `model_fields_set` could never separate: this value equals the old default exactly."""

        answered = run_list(_ArchiveCollection(archive_of(LIST_LIMIT_DEFAULT + 1)), limit=LIST_LIMIT_DEFAULT)

        assert len(answered.bewerbungen) == LIST_LIMIT_DEFAULT

    def test_a_caller_naming_the_maximum_is_not_refused(self):
        collection = _ArchiveCollection(archive_of(LIST_LIMIT_DEFAULT + 1))
        run_list(collection, limit=LIST_LIMIT_MAX)

        assert collection.requested_limit == LIST_LIMIT_MAX

    def test_a_bound_above_the_default_is_served_whole(self):
        """`model_construct`: the field refuses this value while `LIST_LIMIT_MAX` equals `LIST_LIMIT_DEFAULT`.

        Two names so the ceiling can be raised alone -- and then a caller above the default must not
        get a 500, which `requested is None` holds open.
        """

        collection = _ArchiveCollection(archive_of(LIST_LIMIT_DEFAULT + 5))
        answered = asyncio.run(
            get_bewerbungen(
                bewerbungen_collection=cast(AsyncIOMotorCollection, collection),
                filters=FLBewerbungenFilterParams.model_construct(limit=LIST_LIMIT_DEFAULT + 5),
            )
        )

        assert len(answered.bewerbungen) == LIST_LIMIT_DEFAULT + 5


# The dependency alone, mounted on a bare app: what is under test is how FastAPI fills the model, so
# the real router's admin guard and collection would only stand between the query string and it.
_probe = FastAPI()


@_probe.get("/probe")
def _read_filters(filters: FLBewerbungenFilterParams = Depends()) -> dict[str, Any]:
    return {"limit": filters.limit}


class TestTheUnboundedSentinelCannotBeSentByACaller:
    """`limit is None` carries the whole tripwire, so a caller able to forge it would disarm it silently."""

    def test_an_omitted_parameter_arrives_as_null(self):
        with TestClient(_probe) as client:
            assert client.get("/probe").json() == {"limit": None}

    def test_a_named_parameter_arrives_as_the_number(self):
        with TestClient(_probe) as client:
            assert client.get("/probe?limit=10").json() == {"limit": 10}

    @pytest.mark.parametrize("value", ["", "null", "none", "0", str(LIST_LIMIT_MAX + 1)])
    def test_no_query_string_spells_it(self, value: str):
        """An empty or unparseable `limit`, and either bound broken, is a 422 rather than a null."""

        with TestClient(_probe) as client:
            assert client.get(f"/probe?limit={value}").status_code == 422
