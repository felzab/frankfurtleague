import asyncio
from typing import Any, Awaitable, Callable, Iterable, Mapping

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo.errors import OperationFailure

from app.api.schiedsrichter.admin_router import patch_schiedsrichter
from app.api.schiedsrichter.schemas import FLPatchSchiedsrichterPayload, FLPatchSchiedsrichterResponse
from app.api.spielorte.admin_router import patch_spielort
from app.api.spielorte.schemas import FLPatchSpielortPayload, FLPatchSpielortResponse
from app.api.teams.admin_router import patch_team
from app.api.teams.schemas import FLPatchTeamPayload, FLPatchTeamResponse
from app.core.collections import Collection
from tests.database import a_clean_database
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_reference_fanout_test")

# Named rather than caught broadly: another failure must not read as the rollback this suite proves.
DOCUMENT_VALIDATION_FAILED = 121

# Fixed rather than generated, so a failure names the same row every run.
SPIELORT_OID = ObjectId("6890a1b2c3d4e5f607400001")
OTHER_SPIELORT_OID = ObjectId("6890a1b2c3d4e5f607400002")
UNUSED_SPIELORT_OID = ObjectId("6890a1b2c3d4e5f607400003")

SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607400011")
OTHER_SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607400012")
UNUSED_SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607400013")

TEAM_OID = ObjectId("6890a1b2c3d4e5f607400021")
OTHER_TEAM_OID = ObjectId("6890a1b2c3d4e5f607400022")
THIRD_TEAM_OID = ObjectId("6890a1b2c3d4e5f607400023")

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

CLUB_NAMES = {
    TEAM_OID: ("Carl-Schurz", "CS"),
    OTHER_TEAM_OID: ("Lessing", "LE"),
    THIRD_TEAM_OID: ("Wöhler", "WÖ"),
}

RENAMED_VENUE = "Sportplatz Nord"
# An umlaut, so the value travelling the fan-out is one an ASCII-only name rule would have refused.
RENAMED_REFEREE = "Anna Körner"
RENAMED_CLUB = "Carl-Schurz-Gymnasium"
# Both writable copies change, so a pass writing one field and not the other shows on the fixtures.
RENAMED_SHORTHAND = "CG"

ADDRESS = {
    "strasse": "Hanauer Landstraße",
    "hausnummer": "12a",
    "plz": "60314",
    "stadtteil": "Ostend",
    "stadt": "Frankfurt am Main",
}

KONTAKT = {"telefon": "+49 69 1234567", "email": "kontakt@example.com"}

WEBSITE_URL = "https://example.com"

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
    5: (OTHER_SPIELORT_OID, 130, OTHER_SCHIEDSRICHTER_OID, 40),
    6: (OTHER_SPIELORT_OID, 140, OTHER_SCHIEDSRICHTER_OID, 45),
}

# spiel_nr -> (home club, the goals it scored, away club, the goals it scored). The renamed club
# stands on both sides, which is what makes the second `update_many` pass reachable.
SIDES: dict[int, tuple[ObjectId, int, ObjectId, int]] = {
    1: (TEAM_OID, 2, OTHER_TEAM_OID, 1),
    2: (OTHER_TEAM_OID, 3, TEAM_OID, 0),
    3: (TEAM_OID, 4, THIRD_TEAM_OID, 2),
    4: (THIRD_TEAM_OID, 1, TEAM_OID, 5),
    5: (OTHER_TEAM_OID, 0, THIRD_TEAM_OID, 6),
    6: (THIRD_TEAM_OID, 2, TEAM_OID, 3),
}

SAISON_ID = "2026"
PAST_SAISON_ID = "2025"

# spiel_nr -> the season it was played in. Only the club rename reads this: a venue and a referee are
# league-wide, while a club's name is the season's own and a closed season keeps what it was played under.
SEASONS: dict[int, str] = {1: SAISON_ID, 2: SAISON_ID, 3: PAST_SAISON_ID, 4: SAISON_ID, 5: SAISON_ID, 6: PAST_SAISON_ID}

# Deliberately different counts: no endpoint's tally can be right by borrowing another's.
AT_THE_VENUE = (1, 2, 3)
WITH_THE_REFEREE = (1, 2)
ON_TEAM1 = (1, 3)
ON_TEAM2 = (2, 4, 6)

# The renamed club's fixtures in a season still running, and its one in the closed season, which keeps
# the name it was played under.
RENAMED_SIDES = tuple(spiel_nr for spiel_nr in (*ON_TEAM1, *ON_TEAM2) if SEASONS[spiel_nr] != PAST_SAISON_ID)

# One closed-season fixture per SLOT: the two passes carry their own filter, so a boundary proved on
# one side says nothing about the other.
IN_THE_CLOSED_SEASON = 3
IN_THE_CLOSED_SEASON_ON_TEAM2 = 6

# A fixture belonging to neither the venue nor the referee, so both filters are proved to exclude something.
ELSEWHERE = 4
# And one the renamed club stands in on neither side, which is the same proof for the club filter.
WITHOUT_THE_CLUB = 5


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


def club_document(team_id: ObjectId) -> dict[str, Any]:
    """Every field `FLTeamRecord` reads: the endpoint validates the document it wrote before echoing it."""

    name, shorthand = CLUB_NAMES[team_id]

    return {
        "_id": team_id,
        "name": name,
        "shorthand": shorthand,
        "description": "",
        "full_name": f"{name}-Schule",
        "website_url": WEBSITE_URL,
        "address": dict(ADDRESS),
        "inactive_since": None,
    }


def saison_document(saison_id: str) -> dict[str, Any]:
    """Only what `patch_team` reads: this database installs no validator, and rules nothing here consults would be decoration."""

    return {"_id": saison_id, "status": "past" if saison_id == PAST_SAISON_ID else "active"}


def junction_document(team_id: ObjectId, saison_id: str) -> dict[str, Any]:
    """The season's own copy of the club's identity, which the rename rewrites only while the season is open."""

    name, shorthand = CLUB_NAMES[team_id]

    return {"saison_id": saison_id, "team_id": team_id, "gruppe": "A", "austritt": None, "name": name, "shorthand": shorthand}


def side(team_id: ObjectId, tore: int) -> dict[str, Any]:
    """`tore` is the club side's equivalent of an agreed rent: the field beside the copies that must survive a rename."""

    name, shorthand = CLUB_NAMES[team_id]

    return {"team_id": team_id, "name": name, "shorthand": shorthand, "tore": tore}


def fixture_document(spiel_nr: int) -> dict[str, Any]:
    """Only the embedded copies and the number naming the row: no other field takes part in a fan-out."""

    spielort_id, mietpreis, schiedsrichter_id, payment = FIXTURES[spiel_nr]
    home, home_tore, away, away_tore = SIDES[spiel_nr]

    return {
        "spiel_nr": spiel_nr,
        "saison_id": SEASONS[spiel_nr],
        "team1": side(home, home_tore),
        "team2": side(away, away_tore),
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


Body = Callable[[AsyncIOMotorDatabase, AsyncIOMotorClient], Awaitable[Any]]


def on_a_database(url: str, body: Body, *, mutates_schema: bool = False) -> Any:
    """A replica set, not the standalone: every endpoint here writes in a transaction, and seeding runs outside it.

    `mutates_schema=True` where the body attaches a validator: `tests/database.py` then keeps the
    change off every later test.
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, mutates_schema=mutates_schema) as (client, database):
            await database[Collection.SPIELORTE].insert_many([venue_document(oid) for oid in VENUE_NAMES])
            await database[Collection.SCHIEDSRICHTER].insert_many([referee_document(oid) for oid in REFEREE_NAMES])
            await database[Collection.TEAMS].insert_many([club_document(oid) for oid in CLUB_NAMES])
            await database[Collection.SAISONS].insert_many([saison_document(saison_id) for saison_id in (SAISON_ID, PAST_SAISON_ID)])
            # The renamed club is in both seasons; another club is in the open one, so the filter is proved to exclude a row.
            await database[Collection.SAISON_TEAMS].insert_many(
                [
                    junction_document(TEAM_OID, SAISON_ID),
                    junction_document(TEAM_OID, PAST_SAISON_ID),
                    junction_document(OTHER_TEAM_OID, SAISON_ID),
                ]
            )
            await database[Collection.SPIELE].insert_many([fixture_document(spiel_nr) for spiel_nr in FIXTURES])
            return await body(database, client)

    return asyncio.run(_run())


async def rename_the_venue(
    database: AsyncIOMotorDatabase,
    client: AsyncIOMotorClient,
    spielort_id: ObjectId = SPIELORT_OID,
    name: str = RENAMED_VENUE,
) -> FLPatchSpielortResponse:
    """The default rent moves with the name, which is what makes a leaked `mietpreis` visible on the fixtures."""

    return await patch_spielort(
        spielort_id=spielort_id,
        spielort_data=FLPatchSpielortPayload.model_validate(
            {"name": name, "address": dict(ADDRESS), "default_mietpreis": RENAMED_DEFAULT_MIETPREIS}
        ),
        spielorte_collection=database[Collection.SPIELORTE],
        spiele_collection=database[Collection.SPIELE],
        db=client,
    )


async def rename_the_referee(
    database: AsyncIOMotorDatabase,
    client: AsyncIOMotorClient,
    schiedsrichter_id: ObjectId = SCHIEDSRICHTER_OID,
    name: str = RENAMED_REFEREE,
) -> FLPatchSchiedsrichterResponse:
    """The default fee moves with the name, for the same reason the venue's default rent does."""

    return await patch_schiedsrichter(
        schiedsrichter_id=schiedsrichter_id,
        schiedsrichter_data=FLPatchSchiedsrichterPayload.model_validate(
            {"name": name, "schule": None, "kontakt": dict(KONTAKT), "default_payment": RENAMED_DEFAULT_PAYMENT}
        ),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        spiele_collection=database[Collection.SPIELE],
        db=client,
    )


async def rename_the_club(
    database: AsyncIOMotorDatabase,
    client: AsyncIOMotorClient,
    team_id: ObjectId = TEAM_OID,
    name: str = RENAMED_CLUB,
) -> FLPatchTeamResponse:
    """The shorthand moves with the name, because a match card shows whichever of the two fits."""

    return await patch_team(
        team_id=team_id,
        team_data=FLPatchTeamPayload.model_validate(
            {
                "name": name,
                "shorthand": RENAMED_SHORTHAND,
                "description": "",
                "full_name": f"{name}-Schule",
                "website_url": WEBSITE_URL,
                # Sent because the payload defaults none of its fields, not because a rename touches it.
                "schulform": "gymnasium_g9",
                "address": dict(ADDRESS),
            }
        ),
        teams_collection=database[Collection.TEAMS],
        spiele_collection=database[Collection.SPIELE],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        db=client,
    )


async def stored_junctions(database: AsyncIOMotorDatabase) -> dict[tuple[Any, str], Mapping[str, Any]]:
    """Keyed by the pair that identifies a row, so a failing assertion names the club and the season."""

    rows = await database[Collection.SAISON_TEAMS].find().to_list(length=None)

    return {(row["team_id"], row["saison_id"]): row for row in rows}


async def stored_fixtures(database: AsyncIOMotorDatabase) -> dict[int, Mapping[str, Any]]:
    """Keyed by `spiel_nr`, so a failing assertion names the fixture rather than a list position."""

    return {row["spiel_nr"]: row for row in await database[Collection.SPIELE].find().to_list(length=None)}


async def stored_entities(database: AsyncIOMotorDatabase, collection: Collection) -> dict[Any, Mapping[str, Any]]:
    """Keyed by `_id`, for the same reason the fixtures are keyed by their number."""

    return {row["_id"]: row for row in await database[collection].find().to_list(length=None)}


def only_these_names(path: str, allowed: Iterable[str]) -> dict[str, Any]:
    """A `$jsonSchema` refusing any other value at `<path>.name`, which is how this repo forces a failure mid-transaction."""

    return {"bsonType": "object", "properties": {path: {"bsonType": "object", "properties": {"name": {"enum": sorted(allowed)}}}}}


async def refuse_writes_to_spiele(database: AsyncIOMotorDatabase, jsonschema: Mapping[str, Any]) -> None:
    """Installed after the seeding, so it constrains only what a fan-out is about to write."""

    await database.command("collMod", Collection.SPIELE.value, validator={"$jsonSchema": jsonschema}, validationLevel="strict")


def after_renaming_the_venue(url: str, **overrides: Any) -> tuple[FLPatchSpielortResponse, dict[int, Mapping[str, Any]]]:
    """The response and the whole collection together: one seeded database serves the echo and the stored copies both."""

    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
        response = await rename_the_venue(database, client, **overrides)

        return response, await stored_fixtures(database)

    return on_a_database(url, body)


def after_renaming_the_referee(url: str, **overrides: Any) -> tuple[FLPatchSchiedsrichterResponse, dict[int, Mapping[str, Any]]]:
    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
        response = await rename_the_referee(database, client, **overrides)

        return response, await stored_fixtures(database)

    return on_a_database(url, body)


def after_renaming_the_club(
    url: str, **overrides: Any
) -> tuple[FLPatchTeamResponse, dict[int, Mapping[str, Any]], dict[tuple[Any, str], Mapping[str, Any]]]:
    """The junction rows travel with the fixtures: this rename writes both, and either alone is half a season."""

    async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
        response = await rename_the_club(database, client, **overrides)

        return response, await stored_fixtures(database), await stored_junctions(database)

    return on_a_database(url, body)


class TestAVenueRenameReachesTheFixturesThatEmbedIt:
    """`docs/backend/spec.md :: I13` against a real mongod: the fan-out is an `update_many` no response shape can prove."""

    def test_the_name_is_rewritten_on_every_fixture_at_the_venue(self, mongo_replica_set_url: str):
        _, fixtures = after_renaming_the_venue(mongo_replica_set_url)

        for spiel_nr in AT_THE_VENUE:
            assert fixtures[spiel_nr]["ort"]["name"] == RENAMED_VENUE

    def test_the_maps_link_is_rewritten_alongside_the_name(self, mongo_replica_set_url: str):
        """A stale link carries the old search string, which finds the wrong place rather than nothing."""

        response, fixtures = after_renaming_the_venue(mongo_replica_set_url)

        for spiel_nr in AT_THE_VENUE:
            assert fixtures[spiel_nr]["ort"]["maps_link"] == response.updated_document.maps_link
            assert fixtures[spiel_nr]["ort"]["maps_link"] != seeded_maps_link(VENUE_NAMES[SPIELORT_OID])

    def test_each_fixture_keeps_the_rent_agreed_for_it(self, mongo_replica_set_url: str):
        """The rent on a match is what was agreed for that match. One word more in the `$set` rewrites every historical figure."""

        _, fixtures = after_renaming_the_venue(mongo_replica_set_url)

        for spiel_nr in AT_THE_VENUE:
            assert fixtures[spiel_nr]["ort"]["mietpreis"] == FIXTURES[spiel_nr][1]

    def test_a_fixture_at_another_venue_keeps_its_whole_copy(self, mongo_replica_set_url: str):
        """Without this the cases above pass for a fan-out that ignores its filter and rewrites the collection."""

        _, fixtures = after_renaming_the_venue(mongo_replica_set_url)
        other = fixtures[ELSEWHERE]["ort"]

        assert other["name"] == VENUE_NAMES[OTHER_SPIELORT_OID]
        assert other["maps_link"] == seeded_maps_link(VENUE_NAMES[OTHER_SPIELORT_OID])
        assert other["mietpreis"] == FIXTURES[ELSEWHERE][1]


class TestTheVenueFanOutReportsWhatItRewrote:
    def test_the_count_is_the_number_of_fixtures_rewritten(self, mongo_replica_set_url: str):
        response, _ = after_renaming_the_venue(mongo_replica_set_url)

        assert response.fanned_out_to_spiele == len(AT_THE_VENUE)

    def test_a_venue_no_fixture_embeds_reports_none(self, mongo_replica_set_url: str):
        """The venue itself is asserted on too, or the zero would also be what a patch that reached nothing reports."""

        response, fixtures = after_renaming_the_venue(mongo_replica_set_url, spielort_id=UNUSED_SPIELORT_OID)

        assert response.updated_document.name == RENAMED_VENUE
        assert response.fanned_out_to_spiele == 0
        assert fixtures[AT_THE_VENUE[0]]["ort"]["name"] == VENUE_NAMES[SPIELORT_OID]

    def test_a_repeated_rename_reports_none(self, mongo_replica_set_url: str):
        """`modified_count`, not `matched_count`: the fixtures still match the filter, and none of them changed."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> int:
            await rename_the_venue(database, client)
            repeated = await rename_the_venue(database, client)

            return repeated.fanned_out_to_spiele

        assert on_a_database(mongo_replica_set_url, body) == 0


class TestARefereeRenameReachesTheFixturesThatEmbedThem:
    def test_the_name_is_rewritten_on_every_fixture_they_officiate(self, mongo_replica_set_url: str):
        _, fixtures = after_renaming_the_referee(mongo_replica_set_url)

        for spiel_nr in WITH_THE_REFEREE:
            assert fixtures[spiel_nr]["schiedsrichter"]["name"] == RENAMED_REFEREE

    def test_each_fixture_keeps_the_fee_agreed_for_it(self, mongo_replica_set_url: str):
        """The fee on a match is what was agreed for that match, exactly as a venue's rent is."""

        _, fixtures = after_renaming_the_referee(mongo_replica_set_url)

        for spiel_nr in WITH_THE_REFEREE:
            assert fixtures[spiel_nr]["schiedsrichter"]["payment"] == FIXTURES[spiel_nr][3]

    def test_a_fixture_with_another_referee_keeps_its_whole_copy(self, mongo_replica_set_url: str):
        _, fixtures = after_renaming_the_referee(mongo_replica_set_url)
        other = fixtures[ELSEWHERE]["schiedsrichter"]

        assert other["name"] == REFEREE_NAMES[OTHER_SCHIEDSRICHTER_OID]
        assert other["payment"] == FIXTURES[ELSEWHERE][3]

    def test_the_venue_copy_is_left_alone(self, mongo_replica_set_url: str):
        """Both fan-outs run `update_many` over one collection, so a `$set` naming the wrong path would still report a plausible count."""

        _, fixtures = after_renaming_the_referee(mongo_replica_set_url)

        for spiel_nr in WITH_THE_REFEREE:
            assert fixtures[spiel_nr]["ort"]["name"] == VENUE_NAMES[FIXTURES[spiel_nr][0]]


class TestTheRefereeFanOutReportsWhatItRewrote:
    def test_the_count_is_the_number_of_fixtures_rewritten(self, mongo_replica_set_url: str):
        response, _ = after_renaming_the_referee(mongo_replica_set_url)

        assert response.fanned_out_to_spiele == len(WITH_THE_REFEREE)

    def test_a_referee_no_fixture_embeds_reports_none(self, mongo_replica_set_url: str):
        response, fixtures = after_renaming_the_referee(mongo_replica_set_url, schiedsrichter_id=UNUSED_SCHIEDSRICHTER_OID)

        assert response.updated_document.name == RENAMED_REFEREE
        assert response.fanned_out_to_spiele == 0
        assert fixtures[WITH_THE_REFEREE[0]]["schiedsrichter"]["name"] == REFEREE_NAMES[SCHIEDSRICHTER_OID]

    def test_a_repeated_rename_reports_none(self, mongo_replica_set_url: str):
        """`modified_count`, not `matched_count`: the fixtures still match the filter, and none of them changed."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> int:
            await rename_the_referee(database, client)
            repeated = await rename_the_referee(database, client)

            return repeated.fanned_out_to_spiele

        assert on_a_database(mongo_replica_set_url, body) == 0


class TestAClubRenameReachesBothSidesOfItsFixtures:
    def test_both_copies_are_rewritten_wherever_the_club_stands(self, mongo_replica_set_url: str):
        """One `update_many` per slot: a fan-out running only the first leaves every away side stale."""

        _, fixtures, _ = after_renaming_the_club(mongo_replica_set_url)
        renamed = (RENAMED_CLUB, RENAMED_SHORTHAND)

        for spiel_nr in RENAMED_SIDES:
            slot = "team1" if spiel_nr in ON_TEAM1 else "team2"
            assert (fixtures[spiel_nr][slot]["name"], fixtures[spiel_nr][slot]["shorthand"]) == renamed

    def test_both_slots_are_reached(self):
        """The season filter must not have narrowed the corpus to one slot, or the second pass goes unproved."""

        assert set(RENAMED_SIDES) & set(ON_TEAM1)
        assert set(RENAMED_SIDES) & set(ON_TEAM2)

    def test_each_side_keeps_the_goals_it_scored(self, mongo_replica_set_url: str):
        """A result is not a display copy: one word more in the `$set` erases every score the club ever played to."""

        _, fixtures, _ = after_renaming_the_club(mongo_replica_set_url)

        for spiel_nr in (*ON_TEAM1, *ON_TEAM2):
            home_tore, away_tore = SIDES[spiel_nr][1], SIDES[spiel_nr][3]
            assert (fixtures[spiel_nr]["team1"]["tore"], fixtures[spiel_nr]["team2"]["tore"]) == (home_tore, away_tore)

    def test_a_fixture_the_club_stands_in_on_neither_side_is_untouched(self, mongo_replica_set_url: str):
        """Without this the cases above pass for a pair of passes that ignore their filters."""

        _, fixtures, _ = after_renaming_the_club(mongo_replica_set_url)
        home, _, away, _ = SIDES[WITHOUT_THE_CLUB]

        assert fixtures[WITHOUT_THE_CLUB]["team1"]["name"] == CLUB_NAMES[home][0]
        assert fixtures[WITHOUT_THE_CLUB]["team2"]["name"] == CLUB_NAMES[away][0]

    def test_a_fixture_of_a_closed_season_keeps_the_name_it_was_played_under(self, mongo_replica_set_url: str):
        """A `past` season is the record of what happened, so its fixtures are not a stale copy of today's club."""

        _, fixtures, _ = after_renaming_the_club(mongo_replica_set_url)
        seeded_name, seeded_shorthand = CLUB_NAMES[TEAM_OID]
        closed = fixtures[IN_THE_CLOSED_SEASON]["team1"]

        assert (closed["name"], closed["shorthand"]) == (seeded_name, seeded_shorthand)

    def test_the_away_side_of_a_closed_season_keeps_it_too(self, mongo_replica_set_url: str):
        """The case above stands on `team1` alone, and the second pass carries its own filter: dropping that one would pass every test here."""

        _, fixtures, _ = after_renaming_the_club(mongo_replica_set_url)
        seeded_name, seeded_shorthand = CLUB_NAMES[TEAM_OID]
        closed = fixtures[IN_THE_CLOSED_SEASON_ON_TEAM2]["team2"]

        assert (closed["name"], closed["shorthand"]) == (seeded_name, seeded_shorthand)


class TestAClubRenameReachesTheJunctionRowsOfItsOpenSeasons:
    """The season's own copy of the identity: without this pass every table would read the name of a closed season."""

    def test_the_open_seasons_row_is_rewritten(self, mongo_replica_set_url: str):
        _, _, junctions = after_renaming_the_club(mongo_replica_set_url)
        row = junctions[(TEAM_OID, SAISON_ID)]

        assert (row["name"], row["shorthand"]) == (RENAMED_CLUB, RENAMED_SHORTHAND)

    def test_a_closed_seasons_row_is_left_alone(self, mongo_replica_set_url: str):
        """The same boundary the fixtures obey, asserted on the row they take their identity from."""

        _, _, junctions = after_renaming_the_club(mongo_replica_set_url)
        row = junctions[(TEAM_OID, PAST_SAISON_ID)]

        assert (row["name"], row["shorthand"]) == CLUB_NAMES[TEAM_OID]

    def test_another_clubs_row_in_the_same_season_is_untouched(self, mongo_replica_set_url: str):
        """Without this the case above passes for a pass that ignores `team_id` and rewrites the season."""

        _, _, junctions = after_renaming_the_club(mongo_replica_set_url)
        row = junctions[(OTHER_TEAM_OID, SAISON_ID)]

        assert (row["name"], row["shorthand"]) == CLUB_NAMES[OTHER_TEAM_OID]

    def test_the_group_survives_the_rewrite(self, mongo_replica_set_url: str):
        """`gruppe` and `austritt` are the row's own state: a `$set` reaching them would move a club between groups on a rename."""

        _, _, junctions = after_renaming_the_club(mongo_replica_set_url)
        row = junctions[(TEAM_OID, SAISON_ID)]

        assert (row["gruppe"], row["austritt"]) == ("A", None)


class TestTheClubFanOutReportsWhatItRewrote:
    def test_the_count_sums_both_passes(self, mongo_replica_set_url: str):
        """A club never plays itself, so no fixture is counted by both passes and the sum is a count of fixtures."""

        response, _, _ = after_renaming_the_club(mongo_replica_set_url)

        assert response.updated_document.name == RENAMED_CLUB
        assert response.fanned_out_to_spiele == len(RENAMED_SIDES)

    def test_the_junction_count_is_its_own_figure(self, mongo_replica_set_url: str):
        """Reported separately because it is scoped separately, and a reader cannot derive one from the other."""

        response, _, _ = after_renaming_the_club(mongo_replica_set_url)

        assert response.fanned_out_to_saison_teams == 1
        assert response.fanned_out_to_saison_teams != response.fanned_out_to_spiele

    def test_a_club_entered_in_no_season_reports_none_for_the_junction(self, mongo_replica_set_url: str):
        """The club document and its fixtures are asserted on too, or the zero would also be what a patch that reached nothing reports."""

        response, _, _ = after_renaming_the_club(mongo_replica_set_url, team_id=THIRD_TEAM_OID)

        assert response.updated_document.name == RENAMED_CLUB
        assert response.fanned_out_to_saison_teams == 0
        assert response.fanned_out_to_spiele > 0


class TestAMidFlightFailureTakesTheWholeRenameBack:
    """The entity write and its fan-out are one transaction, so a refusal in the later write takes the earlier one back."""

    def test_neither_the_venue_nor_its_fixtures_keep_the_new_name(self, mongo_replica_set_url: str):
        """A validator admitting only the seeded venue names refuses the fan-out, once the venue document itself has been renamed."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await refuse_writes_to_spiele(database, only_these_names("ort", VENUE_NAMES.values()))

            with pytest.raises(OperationFailure) as failure:
                await rename_the_venue(database, client)

            return failure.value.code, await stored_entities(database, Collection.SPIELORTE), await stored_fixtures(database)

        code, venues, fixtures = on_a_database(mongo_replica_set_url, body, mutates_schema=True)
        venue = venues[SPIELORT_OID]

        # Asserted on the code, so this cannot pass because something failed before the first write.
        assert code == DOCUMENT_VALIDATION_FAILED, f"expected the validator to refuse the fan-out, got code {code}"
        # The validator constrains `spiele` alone, so the venue reading its seeded name can only mean the first write was taken back.
        assert venue["name"] == VENUE_NAMES[SPIELORT_OID], "the venue kept a rename none of its fixtures got"
        assert venue["default_mietpreis"] == SEEDED_DEFAULT_MIETPREIS
        for spiel_nr in AT_THE_VENUE:
            assert fixtures[spiel_nr]["ort"]["name"] == VENUE_NAMES[SPIELORT_OID]

    def test_neither_the_referee_nor_their_fixtures_keep_the_new_name(self, mongo_replica_set_url: str):
        """The same shape as the venue's, against the endpoint whose fan-out writes one field."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await refuse_writes_to_spiele(database, only_these_names("schiedsrichter", REFEREE_NAMES.values()))

            with pytest.raises(OperationFailure) as failure:
                await rename_the_referee(database, client)

            return failure.value.code, await stored_entities(database, Collection.SCHIEDSRICHTER), await stored_fixtures(database)

        code, referees, fixtures = on_a_database(mongo_replica_set_url, body, mutates_schema=True)
        referee = referees[SCHIEDSRICHTER_OID]

        assert code == DOCUMENT_VALIDATION_FAILED, f"expected the validator to refuse the fan-out, got code {code}"
        assert referee["name"] == REFEREE_NAMES[SCHIEDSRICHTER_OID], "the referee kept a rename none of their fixtures got"
        assert referee["default_payment"] == SEEDED_DEFAULT_PAYMENT
        for spiel_nr in WITH_THE_REFEREE:
            assert fixtures[spiel_nr]["schiedsrichter"]["name"] == REFEREE_NAMES[SCHIEDSRICHTER_OID]

    def test_neither_slot_keeps_a_rename_the_other_could_not_take(self, mongo_replica_set_url: str):
        """The validator constrains `team2` alone, so the club document and every `team1` copy have landed when the second pass is refused."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            allowed = [name for name, _ in CLUB_NAMES.values()]
            await refuse_writes_to_spiele(database, only_these_names("team2", allowed))

            with pytest.raises(OperationFailure) as failure:
                await rename_the_club(database, client)

            return (
                failure.value.code,
                await stored_entities(database, Collection.TEAMS),
                await stored_fixtures(database),
                await stored_junctions(database),
            )

        code, clubs, fixtures, junctions = on_a_database(mongo_replica_set_url, body, mutates_schema=True)
        club = clubs[TEAM_OID]
        seeded_name, seeded_shorthand = CLUB_NAMES[TEAM_OID]

        assert code == DOCUMENT_VALIDATION_FAILED, f"expected the validator to refuse the second pass, got code {code}"
        # The junction first: it is the earliest write in the transaction, so it is the one a partial rollback leaves standing.
        assert junctions[(TEAM_OID, SAISON_ID)]["name"] == seeded_name, "the junction outlived a rolled-back rename"
        for spiel_nr in ON_TEAM1:
            assert fixtures[spiel_nr]["team1"]["name"] == seeded_name, "the first pass outlived a rolled-back rename"
            assert fixtures[spiel_nr]["team1"]["shorthand"] == seeded_shorthand
        for spiel_nr in ON_TEAM2:
            assert fixtures[spiel_nr]["team2"]["name"] == seeded_name
        assert (club["name"], club["shorthand"]) == (seeded_name, seeded_shorthand), "the club kept a rename none of its fixtures got"
