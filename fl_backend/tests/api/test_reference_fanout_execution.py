import asyncio
from typing import Any, Awaitable, Callable, Mapping

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.api.schiedsrichter.admin_router import patch_schiedsrichter
from app.api.schiedsrichter.schemas import FLPatchSchiedsrichterPayload, FLPatchSchiedsrichterResponse
from app.api.spielorte.admin_router import patch_spielort
from app.api.spielorte.schemas import FLPatchSpielortPayload, FLPatchSpielortResponse

pytestmark = pytest.mark.db

DATABASE_NAME = "fl_reference_fanout_test"

# Fixed rather than generated, so a failure names the same row every run.
SPIELORT_OID = ObjectId("6890a1b2c3d4e5f607400001")
OTHER_SPIELORT_OID = ObjectId("6890a1b2c3d4e5f607400002")
UNUSED_SPIELORT_OID = ObjectId("6890a1b2c3d4e5f607400003")

SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607400011")
OTHER_SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607400012")
UNUSED_SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607400013")

VENUE_NAMES = {
    SPIELORT_OID: "Sportplatz Ost",
    OTHER_SPIELORT_OID: "Sportplatz Süd",
    UNUSED_SPIELORT_OID: "Sportplatz West",
}

# Every name matches `PERSON_NAME_PATTERN`, which the patch payload applies and the read model does not.
REFEREE_NAMES = {
    SCHIEDSRICHTER_OID: "Anna Weber",
    OTHER_SCHIEDSRICHTER_OID: "Bernd Kraus",
    UNUSED_SCHIEDSRICHTER_OID: "Clara Roth",
}

RENAMED_VENUE = "Sportplatz Nord"
# An umlaut, so the value travelling the fan-out is one an ASCII-only name rule would have refused.
RENAMED_REFEREE = "Anna Körner"

ADDRESS = {
    "strasse": "Hanauer Landstraße",
    "hausnummer": "12a",
    "plz": "60314",
    "stadtteil": "Ostend",
    "stadt": "Frankfurt am Main",
}

KONTAKT = {"telefon": "+49 69 1234567", "email": "kontakt@example.com"}

SEEDED_DEFAULT_MIETPREIS = 80
SEEDED_DEFAULT_PAYMENT = 20

# Far from every agreed figure below, so a default that leaked into a fan-out shows on every fixture.
RENAMED_DEFAULT_MIETPREIS = 250
RENAMED_DEFAULT_PAYMENT = 99

# spiel_nr -> (venue, the rent agreed for THAT match, referee, the fee agreed for THAT match). Every
# figure is distinct, so a fan-out writing one value over all of them leaves none of them standing.
FIXTURES: dict[int, tuple[ObjectId, int, ObjectId, int]] = {
    1: (SPIELORT_OID, 80, SCHIEDSRICHTER_OID, 20),
    2: (SPIELORT_OID, 95, SCHIEDSRICHTER_OID, 25),
    3: (SPIELORT_OID, 110, OTHER_SCHIEDSRICHTER_OID, 30),
    4: (OTHER_SPIELORT_OID, 120, OTHER_SCHIEDSRICHTER_OID, 35),
}

# Deliberately different counts: neither endpoint's tally can be right by borrowing the other's.
AT_THE_VENUE = (1, 2, 3)
WITH_THE_REFEREE = (1, 2)

# The one fixture belonging to neither, so both filters are proved to exclude something.
ELSEWHERE = 4


def seeded_maps_link(name: str) -> str:
    """Not the derivation `patch_spielort` runs, so a rewritten link cannot equal the seeded one by accident."""

    return f"{name}, Frankfurt"


def venue_document(spielort_id: ObjectId) -> dict[str, Any]:
    return {
        "_id": spielort_id,
        "name": VENUE_NAMES[spielort_id],
        "address": dict(ADDRESS),
        "maps_link": seeded_maps_link(VENUE_NAMES[spielort_id]),
        "default_mietpreis": SEEDED_DEFAULT_MIETPREIS,
        "inactive_since": None,
    }


def referee_document(schiedsrichter_id: ObjectId) -> dict[str, Any]:
    return {
        "_id": schiedsrichter_id,
        "name": REFEREE_NAMES[schiedsrichter_id],
        "schule": None,
        "default_payment": SEEDED_DEFAULT_PAYMENT,
        "kontakt": dict(KONTAKT),
        "inactive_since": None,
    }


def fixture_document(spiel_nr: int) -> dict[str, Any]:
    """Only the two embedded copies and the number naming the row: no other field takes part in a fan-out."""

    spielort_id, mietpreis, schiedsrichter_id, payment = FIXTURES[spiel_nr]

    return {
        "spiel_nr": spiel_nr,
        "ort": {
            "spielort_id": spielort_id,
            "name": VENUE_NAMES[spielort_id],
            "maps_link": seeded_maps_link(VENUE_NAMES[spielort_id]),
            "mietpreis": mietpreis,
        },
        "schiedsrichter": {
            "schiedsrichter_id": schiedsrichter_id,
            "name": REFEREE_NAMES[schiedsrichter_id],
            "payment": payment,
        },
    }


Body = Callable[[AsyncIOMotorDatabase], Awaitable[Any]]


def on_a_database(container: Any, body: Body) -> Any:
    """One client and event loop per call: Motor binds to the loop it first runs on."""

    async def _run() -> Any:
        client = AsyncIOMotorClient(container.get_connection_url())
        try:
            await client.drop_database(DATABASE_NAME)
            database = client[DATABASE_NAME]
            await database.spielorte.insert_many([venue_document(oid) for oid in VENUE_NAMES])
            await database.schiedsrichter.insert_many([referee_document(oid) for oid in REFEREE_NAMES])
            await database.spiele.insert_many([fixture_document(spiel_nr) for spiel_nr in FIXTURES])
            return await body(database)
        finally:
            await client.drop_database(DATABASE_NAME)
            client.close()

    return asyncio.run(_run())


async def rename_the_venue(
    database: AsyncIOMotorDatabase,
    spielort_id: ObjectId = SPIELORT_OID,
    name: str = RENAMED_VENUE,
) -> FLPatchSpielortResponse:
    """The default rent moves with the name, which is what makes a leaked `mietpreis` visible on the fixtures."""

    return await patch_spielort(
        spielort_id=spielort_id,
        spielort_data=FLPatchSpielortPayload.model_validate(
            {"name": name, "address": dict(ADDRESS), "default_mietpreis": RENAMED_DEFAULT_MIETPREIS}
        ),
        spielorte_collection=database.spielorte,
        spiele_collection=database.spiele,
    )


async def rename_the_referee(
    database: AsyncIOMotorDatabase,
    schiedsrichter_id: ObjectId = SCHIEDSRICHTER_OID,
    name: str = RENAMED_REFEREE,
) -> FLPatchSchiedsrichterResponse:
    """The default fee moves with the name, for the same reason the venue's default rent does."""

    return await patch_schiedsrichter(
        schiedsrichter_id=schiedsrichter_id,
        schiedsrichter_data=FLPatchSchiedsrichterPayload.model_validate(
            {"name": name, "schule": None, "kontakt": dict(KONTAKT), "default_payment": RENAMED_DEFAULT_PAYMENT}
        ),
        schiedsrichter_collection=database.schiedsrichter,
        spiele_collection=database.spiele,
    )


async def stored_fixtures(database: AsyncIOMotorDatabase) -> dict[int, Mapping[str, Any]]:
    """Keyed by `spiel_nr`, so a failing assertion names the fixture rather than a list position."""

    return {row["spiel_nr"]: row for row in await database.spiele.find().to_list(length=None)}


def after_renaming_the_venue(container: Any, **overrides: Any) -> tuple[FLPatchSpielortResponse, dict[int, Mapping[str, Any]]]:
    """The response and the whole collection together: one seeded database serves the echo and the stored copies both."""

    async def body(database: AsyncIOMotorDatabase) -> tuple[FLPatchSpielortResponse, dict[int, Mapping[str, Any]]]:
        response = await rename_the_venue(database, **overrides)

        return response, await stored_fixtures(database)

    return on_a_database(container, body)


def after_renaming_the_referee(container: Any, **overrides: Any) -> tuple[FLPatchSchiedsrichterResponse, dict[int, Mapping[str, Any]]]:
    async def body(database: AsyncIOMotorDatabase) -> tuple[FLPatchSchiedsrichterResponse, dict[int, Mapping[str, Any]]]:
        response = await rename_the_referee(database, **overrides)

        return response, await stored_fixtures(database)

    return on_a_database(container, body)


class TestAVenueRenameReachesTheFixturesThatEmbedIt:
    """`docs/backend/spec.md :: I13` against a real mongod: the fan-out is an `update_many` no response shape can prove."""

    def test_the_name_is_rewritten_on_every_fixture_at_the_venue(self, mongo_container: Any):
        _, fixtures = after_renaming_the_venue(mongo_container)

        for spiel_nr in AT_THE_VENUE:
            assert fixtures[spiel_nr]["ort"]["name"] == RENAMED_VENUE

    def test_the_maps_link_is_rewritten_alongside_the_name(self, mongo_container: Any):
        """A stale link carries the old search string, which finds the wrong place rather than nothing."""

        response, fixtures = after_renaming_the_venue(mongo_container)

        for spiel_nr in AT_THE_VENUE:
            assert fixtures[spiel_nr]["ort"]["maps_link"] == response.updated_document.maps_link
            assert fixtures[spiel_nr]["ort"]["maps_link"] != seeded_maps_link(VENUE_NAMES[SPIELORT_OID])

    def test_each_fixture_keeps_the_rent_agreed_for_it(self, mongo_container: Any):
        """The rent on a match is what was agreed for that match. One word more in the `$set` rewrites every historical figure."""

        _, fixtures = after_renaming_the_venue(mongo_container)

        for spiel_nr in AT_THE_VENUE:
            assert fixtures[spiel_nr]["ort"]["mietpreis"] == FIXTURES[spiel_nr][1]

    def test_a_fixture_at_another_venue_keeps_its_whole_copy(self, mongo_container: Any):
        """Without this the cases above pass for a fan-out that ignores its filter and rewrites the collection."""

        _, fixtures = after_renaming_the_venue(mongo_container)
        other = fixtures[ELSEWHERE]["ort"]

        assert other["name"] == VENUE_NAMES[OTHER_SPIELORT_OID]
        assert other["maps_link"] == seeded_maps_link(VENUE_NAMES[OTHER_SPIELORT_OID])
        assert other["mietpreis"] == FIXTURES[ELSEWHERE][1]


class TestTheVenueFanOutReportsWhatItRewrote:
    def test_the_count_is_the_number_of_fixtures_rewritten(self, mongo_container: Any):
        response, _ = after_renaming_the_venue(mongo_container)

        assert response.fanned_out_to_spiele == len(AT_THE_VENUE)

    def test_a_venue_no_fixture_embeds_reports_none(self, mongo_container: Any):
        """The venue itself is asserted on too, or the zero would also be what a patch that reached nothing reports."""

        response, fixtures = after_renaming_the_venue(mongo_container, spielort_id=UNUSED_SPIELORT_OID)

        assert response.updated_document.name == RENAMED_VENUE
        assert response.fanned_out_to_spiele == 0
        assert fixtures[AT_THE_VENUE[0]]["ort"]["name"] == VENUE_NAMES[SPIELORT_OID]

    def test_a_repeated_rename_reports_none(self, mongo_container: Any):
        """`modified_count`, not `matched_count`: the fixtures still match the filter, and none of them changed."""

        async def body(database: AsyncIOMotorDatabase) -> int:
            await rename_the_venue(database)
            repeated = await rename_the_venue(database)

            return repeated.fanned_out_to_spiele

        assert on_a_database(mongo_container, body) == 0


class TestARefereeRenameReachesTheFixturesThatEmbedThem:
    def test_the_name_is_rewritten_on_every_fixture_they_officiate(self, mongo_container: Any):
        _, fixtures = after_renaming_the_referee(mongo_container)

        for spiel_nr in WITH_THE_REFEREE:
            assert fixtures[spiel_nr]["schiedsrichter"]["name"] == RENAMED_REFEREE

    def test_each_fixture_keeps_the_fee_agreed_for_it(self, mongo_container: Any):
        """The fee on a match is what was agreed for that match, exactly as a venue's rent is."""

        _, fixtures = after_renaming_the_referee(mongo_container)

        for spiel_nr in WITH_THE_REFEREE:
            assert fixtures[spiel_nr]["schiedsrichter"]["payment"] == FIXTURES[spiel_nr][3]

    def test_a_fixture_with_another_referee_keeps_its_whole_copy(self, mongo_container: Any):
        _, fixtures = after_renaming_the_referee(mongo_container)
        other = fixtures[ELSEWHERE]["schiedsrichter"]

        assert other["name"] == REFEREE_NAMES[OTHER_SCHIEDSRICHTER_OID]
        assert other["payment"] == FIXTURES[ELSEWHERE][3]

    def test_the_venue_copy_is_left_alone(self, mongo_container: Any):
        """Both fan-outs run `update_many` over one collection, so a `$set` naming the wrong path would still report a plausible count."""

        _, fixtures = after_renaming_the_referee(mongo_container)

        for spiel_nr in WITH_THE_REFEREE:
            assert fixtures[spiel_nr]["ort"]["name"] == VENUE_NAMES[FIXTURES[spiel_nr][0]]


class TestTheRefereeFanOutReportsWhatItRewrote:
    def test_the_count_is_the_number_of_fixtures_rewritten(self, mongo_container: Any):
        response, _ = after_renaming_the_referee(mongo_container)

        assert response.fanned_out_to_spiele == len(WITH_THE_REFEREE)

    def test_a_referee_no_fixture_embeds_reports_none(self, mongo_container: Any):
        response, fixtures = after_renaming_the_referee(mongo_container, schiedsrichter_id=UNUSED_SCHIEDSRICHTER_OID)

        assert response.updated_document.name == RENAMED_REFEREE
        assert response.fanned_out_to_spiele == 0
        assert fixtures[WITH_THE_REFEREE[0]]["schiedsrichter"]["name"] == REFEREE_NAMES[SCHIEDSRICHTER_OID]

    def test_a_repeated_rename_reports_none(self, mongo_container: Any):
        """`modified_count`, not `matched_count`: the fixtures still match the filter, and none of them changed."""

        async def body(database: AsyncIOMotorDatabase) -> int:
            await rename_the_referee(database)
            repeated = await rename_the_referee(database)

            return repeated.fanned_out_to_spiele

        assert on_a_database(mongo_container, body) == 0
