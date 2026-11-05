from collections.abc import Awaitable, Callable, Iterable, Mapping
from typing import Any

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.api.teams.admin_router import patch_team
from app.api.teams.schemas import FLPatchTeamPayload, FLPatchTeamResponse
from app.core.collections import Collection
from tests.database import DOCUMENT_VALIDATION_FAILED, a_clean_database, on_the_seed_loop
from tests.documents import ADDRESS, saison_document, saison_team_document, spiel_document, team_document
from tests.worker import worker_database

DATABASE_NAME = worker_database("fl_reference_fanout_test")

# Fixed rather than generated, so a failure names the same row every run.
SPIELORT_OID = ObjectId("6890a1b2c3d4e5f607400001")
OTHER_SPIELORT_OID = ObjectId("6890a1b2c3d4e5f607400002")

SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607400011")
OTHER_SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607400012")

TEAM_OID = ObjectId("6890a1b2c3d4e5f607400021")
OTHER_TEAM_OID = ObjectId("6890a1b2c3d4e5f607400022")
THIRD_TEAM_OID = ObjectId("6890a1b2c3d4e5f607400023")

SPIELORT_NAMES = {
    SPIELORT_OID: "Sportplatz Ost",
    OTHER_SPIELORT_OID: "Sportplatz Süd",
}

SCHIEDSRICHTER_NAMES = {
    SCHIEDSRICHTER_OID: "Anna Weber",
    OTHER_SCHIEDSRICHTER_OID: "Bernd Kraus",
}

TEAM_NAMES = {
    TEAM_OID: ("Carl-Schurz", "CSX"),
    OTHER_TEAM_OID: ("Lessing", "LEX"),
    THIRD_TEAM_OID: ("Wöhler", "WÖ"),
}

RENAMED_TEAM = "Carl-Schurz-Gymnasium"
# Both writable copies change, so a pass writing one field and not the other shows on the fixtures.
RENAMED_SHORTHAND = "CGX"

WEBSITE_URL = "https://example.com"

# spiel_nr -> (venue, the rent agreed for THAT match, referee, the fee agreed for THAT match): the bookings a fixture
# carries beside the sides a club rename reaches.
SPIELE: dict[int, tuple[ObjectId, int, ObjectId, int]] = {
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

# One matchday for every fixture: no rule here reads a Spieltag, and the reference is required.
SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f6072200f1")

# spiel_nr -> the season it was played in. Only the club rename reads this: a venue and a referee are
# league-wide, while a club's name is the season's own and a closed season keeps what it was played under.
SAISONS: dict[int, str] = {1: SAISON_ID, 2: SAISON_ID, 3: PAST_SAISON_ID, 4: SAISON_ID, 5: SAISON_ID, 6: PAST_SAISON_ID}

ON_TEAM1 = (1, 3)
ON_TEAM2 = (2, 4, 6)

# The renamed club's fixtures in a season still running, and its one in the closed season, which keeps
# the name it was played under.
RENAMED_SIDES = tuple(spiel_nr for spiel_nr in (*ON_TEAM1, *ON_TEAM2) if SAISONS[spiel_nr] != PAST_SAISON_ID)

# One closed-season fixture per SLOT: the two passes carry their own filter, so a boundary proved on
# one side says nothing about the other.
IN_THE_CLOSED_SAISON = 3
IN_THE_CLOSED_SAISON_ON_TEAM2 = 6

# A fixture the renamed club stands in on neither side, so the club filter is proved to exclude something.
WITHOUT_THE_TEAM = 5


def seeded_maps_link(name: str) -> str:
    """The venue's search string as a fixture's booking holds it beside the sides."""

    return f"{name}, Frankfurt"


def seeded_team_document(team_id: ObjectId) -> dict[str, Any]:
    """Every field `FLTeamRecord` reads: the endpoint validates the document it wrote before echoing it."""

    name, shorthand = TEAM_NAMES[team_id]

    return team_document(team_id, name, shorthand, website_url=WEBSITE_URL)


def junction_document(team_id: ObjectId, saison_id: str) -> dict[str, Any]:
    """The season's own copy of the club's identity, which the rename rewrites only while the season is open."""

    name, shorthand = TEAM_NAMES[team_id]

    return saison_team_document(saison_id, team_id, name, shorthand, gruppe="A")


def side(team_id: ObjectId, tore: int) -> dict[str, Any]:
    """`tore` is the club side's equivalent of an agreed rent: the field beside the copies that must survive a rename."""

    name, shorthand = TEAM_NAMES[team_id]

    return {"team_id": team_id, "name": name, "shorthand": shorthand, "tore": tore}


def fixture_document(spiel_nr: int) -> dict[str, Any]:
    """The embedded copies and the number naming the row are what a fan-out reaches.

    Every other field is null, so nothing else can appear to move under a rename.
    """

    spielort_id, mietpreis, schiedsrichter_id, payment = SPIELE[spiel_nr]
    home, home_tore, away, away_tore = SIDES[spiel_nr]

    return spiel_document(
        spiel_id=ObjectId(),
        saison_id=SAISONS[spiel_nr],
        spiel_nr=spiel_nr,
        spieltag_id=SPIELTAG_OID,
        team1=side(home, home_tore),
        team2=side(away, away_tore),
        ort={
            "spielort_id": spielort_id,
            "name": SPIELORT_NAMES[spielort_id],
            "maps_link": seeded_maps_link(SPIELORT_NAMES[spielort_id]),
            "mietpreis": mietpreis,
        },
        schiedsrichter={
            "schiedsrichter_id": schiedsrichter_id,
            "name": SCHIEDSRICHTER_NAMES[schiedsrichter_id],
            "payment": payment,
        },
    )


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_database(url: str, body: Body, *, mutates_schema: bool = False) -> Any:
    """A replica set, not the standalone: every endpoint here writes in a transaction, and seeding runs outside it.

    `mutates_schema=True` where the body attaches a validator (`tests/database.py :: a_clean_database`).
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, mutates_schema=mutates_schema) as (client, database):
            await database[Collection.TEAMS].insert_many([seeded_team_document(oid) for oid in TEAM_NAMES])
            # `status` is the only field `patch_team` reads of a season.
            await database[Collection.SAISONS].insert_many([saison_document(SAISON_ID, "active"), saison_document(PAST_SAISON_ID, "past")])
            # The renamed club is in both seasons; another club is in the open one, so the filter is proved to exclude a row.
            await database[Collection.SAISON_TEAMS].insert_many(
                [
                    junction_document(TEAM_OID, SAISON_ID),
                    junction_document(TEAM_OID, PAST_SAISON_ID),
                    junction_document(OTHER_TEAM_OID, SAISON_ID),
                ]
            )
            await database[Collection.SPIELE].insert_many([fixture_document(spiel_nr) for spiel_nr in SPIELE])
            return await body(database, client)

    return on_the_seed_loop(_run())


async def rename_the_team(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    team_id: ObjectId = TEAM_OID,
    name: str = RENAMED_TEAM,
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


async def stored_junctions(database: AsyncDatabase) -> dict[tuple[Any, str], Mapping[str, Any]]:
    """Keyed by the pair that identifies a row, so a failing assertion names the club and the season."""

    rows = await database[Collection.SAISON_TEAMS].find().to_list(length=None)

    return {(row["team_id"], row["saison_id"]): row for row in rows}


async def stored_spiele(database: AsyncDatabase) -> dict[int, Mapping[str, Any]]:
    """Keyed by `spiel_nr`, so a failing assertion names the fixture rather than a list position."""

    return {row["spiel_nr"]: row for row in await database[Collection.SPIELE].find().to_list(length=None)}


async def stored_entities(database: AsyncDatabase, collection: Collection) -> dict[Any, Mapping[str, Any]]:
    """Keyed by `_id`, for the same reason the fixtures are keyed by their number."""

    return {row["_id"]: row for row in await database[collection].find().to_list(length=None)}


def only_these_names(path: str, allowed: Iterable[str]) -> dict[str, Any]:
    """A `$jsonSchema` refusing any other value at `<path>.name`, which is how this repo forces a failure mid-transaction."""

    return {"bsonType": "object", "properties": {path: {"bsonType": "object", "properties": {"name": {"enum": sorted(allowed)}}}}}


async def refuse_writes_to_spiele(database: AsyncDatabase, jsonschema: Mapping[str, Any]) -> None:
    """Installed after the seeding, so it constrains only what a fan-out is about to write."""

    await database.command("collMod", Collection.SPIELE.value, validator={"$jsonSchema": jsonschema}, validationLevel="strict")


def renamed(
    url: str, rename: Callable[..., Awaitable[Any]], collection: Collection, record_id: ObjectId
) -> tuple[Any, Mapping[str, Any], dict[int, Mapping[str, Any]]]:
    """The answer, the renamed record as stored, which the answer does not carry, and the fixtures, from one rename."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        response = await rename(database, client, **{_ID_PARAMETER[collection]: record_id})

        return response, (await stored_entities(database, collection))[record_id], await stored_spiele(database)

    return on_a_database(url, body)


_ID_PARAMETER: Mapping[Collection, str] = {
    Collection.TEAMS: "team_id",
}


def after_renaming_the_team(
    url: str, **overrides: Any
) -> tuple[FLPatchTeamResponse, dict[int, Mapping[str, Any]], dict[tuple[Any, str], Mapping[str, Any]]]:
    """The junction rows travel with the fixtures: this rename writes both, and either alone is half a season."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        response = await rename_the_team(database, client, **overrides)

        return response, await stored_spiele(database), await stored_junctions(database)

    return on_a_database(url, body)


class TestAClubRenameReachesBothSidesOfItsFixtures:
    @pytest.mark.db
    def test_both_copies_are_rewritten_wherever_the_club_stands(self, mongo_replica_set_url: str):
        """One `update_many` per slot: a fan-out running only the first leaves every away side stale."""

        _, spiele, _ = after_renaming_the_team(mongo_replica_set_url)
        renamed = (RENAMED_TEAM, RENAMED_SHORTHAND)

        for spiel_nr in RENAMED_SIDES:
            slot = "team1" if spiel_nr in ON_TEAM1 else "team2"
            assert (spiele[spiel_nr][slot]["name"], spiele[spiel_nr][slot]["shorthand"]) == renamed

    def test_both_slots_are_reached(self):
        """The season filter must not have narrowed the corpus to one slot, or the second pass goes unproved."""

        assert set(RENAMED_SIDES) & set(ON_TEAM1)
        assert set(RENAMED_SIDES) & set(ON_TEAM2)

    @pytest.mark.db
    def test_each_side_keeps_the_goals_it_scored(self, mongo_replica_set_url: str):
        """A result is not a display copy: one word more in the `$set` erases every score the club ever played to."""

        _, spiele, _ = after_renaming_the_team(mongo_replica_set_url)

        for spiel_nr in (*ON_TEAM1, *ON_TEAM2):
            home_tore, away_tore = SIDES[spiel_nr][1], SIDES[spiel_nr][3]
            assert (spiele[spiel_nr]["team1"]["tore"], spiele[spiel_nr]["team2"]["tore"]) == (home_tore, away_tore)

    @pytest.mark.db
    def test_a_fixture_the_club_stands_in_on_neither_side_is_untouched(self, mongo_replica_set_url: str):
        """Without this the cases above pass for a pair of passes that ignore their filters."""

        _, spiele, _ = after_renaming_the_team(mongo_replica_set_url)
        home, _, away, _ = SIDES[WITHOUT_THE_TEAM]

        assert spiele[WITHOUT_THE_TEAM]["team1"]["name"] == TEAM_NAMES[home][0]
        assert spiele[WITHOUT_THE_TEAM]["team2"]["name"] == TEAM_NAMES[away][0]

    @pytest.mark.db
    def test_a_fixture_of_a_closed_season_keeps_the_name_it_was_played_under(self, mongo_replica_set_url: str):
        """A `past` season is the record of what happened, so its fixtures are not a stale copy of today's club."""

        _, spiele, _ = after_renaming_the_team(mongo_replica_set_url)
        seeded_name, seeded_shorthand = TEAM_NAMES[TEAM_OID]
        closed = spiele[IN_THE_CLOSED_SAISON]["team1"]

        assert (closed["name"], closed["shorthand"]) == (seeded_name, seeded_shorthand)

    @pytest.mark.db
    def test_the_away_side_of_a_closed_season_keeps_it_too(self, mongo_replica_set_url: str):
        """The case above stands on `team1` alone, and the second pass carries its own filter: dropping that one would pass every test here."""

        _, spiele, _ = after_renaming_the_team(mongo_replica_set_url)
        seeded_name, seeded_shorthand = TEAM_NAMES[TEAM_OID]
        closed = spiele[IN_THE_CLOSED_SAISON_ON_TEAM2]["team2"]

        assert (closed["name"], closed["shorthand"]) == (seeded_name, seeded_shorthand)


@pytest.mark.db
class TestAClubRenameReachesTheJunctionRowsOfItsOpenSeasons:
    """The season's own copy of the identity: without this pass every table would read the name of a closed season."""

    def test_the_open_seasons_row_is_rewritten(self, mongo_replica_set_url: str):
        _, _, junctions = after_renaming_the_team(mongo_replica_set_url)
        row = junctions[(TEAM_OID, SAISON_ID)]

        assert (row["name"], row["shorthand"]) == (RENAMED_TEAM, RENAMED_SHORTHAND)

    def test_a_closed_seasons_row_is_left_alone(self, mongo_replica_set_url: str):
        """The same boundary the fixtures obey, asserted on the row they take their identity from."""

        _, _, junctions = after_renaming_the_team(mongo_replica_set_url)
        row = junctions[(TEAM_OID, PAST_SAISON_ID)]

        assert (row["name"], row["shorthand"]) == TEAM_NAMES[TEAM_OID]

    def test_another_clubs_row_in_the_same_season_is_untouched(self, mongo_replica_set_url: str):
        """Without this the case above passes for a pass that ignores `team_id` and rewrites the season."""

        _, _, junctions = after_renaming_the_team(mongo_replica_set_url)
        row = junctions[(OTHER_TEAM_OID, SAISON_ID)]

        assert (row["name"], row["shorthand"]) == TEAM_NAMES[OTHER_TEAM_OID]

    def test_the_group_survives_the_rewrite(self, mongo_replica_set_url: str):
        """`gruppe` and `austritt` are the row's own state: a `$set` reaching them would move a club between groups on a rename."""

        _, _, junctions = after_renaming_the_team(mongo_replica_set_url)
        row = junctions[(TEAM_OID, SAISON_ID)]

        assert (row["gruppe"], row["austritt"]) == ("A", None)


@pytest.mark.db
class TestTheClubFanOutReportsWhatItRewrote:
    def test_the_count_sums_both_passes(self, mongo_replica_set_url: str):
        """A club never plays itself, so no fixture is counted by both passes and the sum is a count of fixtures."""

        response, team, _ = renamed(mongo_replica_set_url, rename_the_team, Collection.TEAMS, TEAM_OID)

        assert team["name"] == RENAMED_TEAM
        assert response.fanned_out_to_spiele == len(RENAMED_SIDES)

    def test_the_junction_count_is_its_own_figure(self, mongo_replica_set_url: str):
        """Reported separately because it is scoped separately, and a reader cannot derive one from the other."""

        response, _, _ = after_renaming_the_team(mongo_replica_set_url)

        assert response.fanned_out_to_saison_teams == 1
        assert response.fanned_out_to_saison_teams != response.fanned_out_to_spiele

    def test_a_club_entered_in_no_season_reports_none_for_the_junction(self, mongo_replica_set_url: str):
        """The club document and its fixtures are asserted on too, or the zero would also be what a patch that reached nothing reports."""

        response, team, _ = renamed(mongo_replica_set_url, rename_the_team, Collection.TEAMS, THIRD_TEAM_OID)

        assert team["name"] == RENAMED_TEAM
        assert response.fanned_out_to_saison_teams == 0
        assert response.fanned_out_to_spiele > 0


@pytest.mark.db
class TestAMidFlightFailureTakesTheWholeRenameBack:
    """The club write and its fan-out are one transaction, so a refusal in the later write takes the earlier one back."""

    def test_neither_slot_keeps_a_rename_the_other_could_not_take(self, mongo_replica_set_url: str):
        """The validator constrains `team2` alone, so the club document and every `team1` copy have landed when the second pass is refused."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            allowed = [name for name, _ in TEAM_NAMES.values()]
            await refuse_writes_to_spiele(database, only_these_names("team2", allowed))

            with pytest.raises(OperationFailure) as failure:
                await rename_the_team(database, client)

            return (
                failure.value.code,
                await stored_entities(database, Collection.TEAMS),
                await stored_spiele(database),
                await stored_junctions(database),
            )

        code, teams, spiele, junctions = on_a_database(mongo_replica_set_url, body, mutates_schema=True)
        team = teams[TEAM_OID]
        seeded_name, seeded_shorthand = TEAM_NAMES[TEAM_OID]

        assert code == DOCUMENT_VALIDATION_FAILED, f"expected the validator to refuse the second pass, got code {code}"
        # The junction first: it is the earliest write in the transaction, so it is the one a partial rollback leaves standing.
        assert junctions[(TEAM_OID, SAISON_ID)]["name"] == seeded_name, "the junction outlived a rolled-back rename"
        for spiel_nr in ON_TEAM1:
            assert spiele[spiel_nr]["team1"]["name"] == seeded_name, "the first pass outlived a rolled-back rename"
            assert spiele[spiel_nr]["team1"]["shorthand"] == seeded_shorthand
        for spiel_nr in ON_TEAM2:
            assert spiele[spiel_nr]["team2"]["name"] == seeded_name
        assert (team["name"], team["shorthand"]) == (seeded_name, seeded_shorthand), "the club kept a rename none of its fixtures got"
