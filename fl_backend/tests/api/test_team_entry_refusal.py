from typing import Any, Awaitable, Callable

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.schemas import FLSaisonForfeitErgebnis, FLSaisonRules
from app.api.spieler.schemas import FLSpielerStufe
from app.api.teams.admin_router import post_saison_team
from app.api.teams.schemas import FLPostSaisonTeamPayload
from app.api.teams.services import (
    CLUB_RETIRED,
    ENTRY_GRUPPE_FULL,
    ENTRY_GRUPPE_NOT_OFFERED,
    ENTRY_SAISON_NOT_FUTURE,
    find_club_entry_refusal,
    find_entry_refusal,
    offered_gruppen,
)
from app.core.collections import Collection
from app.core.exceptions import DocumentConflictException, DocumentNotFoundException
from tests.database import a_clean_database, on_the_seed_loop

# Typed as the `Literal` list `FLSaisonRules` declares: a bare `list[str]` is invariant against it.
STUFEN: list[FLSpielerStufe] = ["E1", "Q1", "Q2", "Q3", "Q4"]

RULES = FLSaisonRules(
    win_points=3,
    draw_points=1,
    qualifiers_per_group=2,
    number_of_groups=2,
    teams_per_group=4,
    tiebreak_order="tordifferenz",
    max_kadergroesse=50,
    forfeit_ergebnis=FLSaisonForfeitErgebnis(sieger_tore=3, verlierer_tore=0),
    erlaubte_stufen=STUFEN,
)


class TestOfferedGruppen:
    def test_the_count_takes_the_first_names_of_the_closed_set_in_order(self):
        assert offered_gruppen(2) == ("A", "B")

    def test_four_is_the_whole_set(self):
        assert offered_gruppen(4) == ("A", "B", "C", "D")


class TestEnteringASeason:
    def test_a_future_season_with_space_takes_the_team(self):
        assert find_entry_refusal(saison_status="future", gruppe="A", rules=RULES, occupied=3) is None

    def test_the_active_season_is_refused(self):
        refusal = find_entry_refusal(saison_status="active", gruppe="A", rules=RULES, occupied=0)
        assert refusal is not None
        assert refusal.error_code == ENTRY_SAISON_NOT_FUTURE

    def test_a_past_season_is_refused(self):
        refusal = find_entry_refusal(saison_status="past", gruppe="A", rules=RULES, occupied=0)
        assert refusal is not None
        assert refusal.error_code == ENTRY_SAISON_NOT_FUTURE

    def test_a_group_the_season_does_not_run_is_refused(self):
        refusal = find_entry_refusal(saison_status="future", gruppe="C", rules=RULES, occupied=0)
        assert refusal is not None
        assert refusal.error_code == ENTRY_GRUPPE_NOT_OFFERED

    def test_a_full_group_is_refused(self):
        refusal = find_entry_refusal(saison_status="future", gruppe="B", rules=RULES, occupied=4)
        assert refusal is not None
        assert refusal.error_code == ENTRY_GRUPPE_FULL

    def test_the_season_gate_outranks_the_group_gates(self):
        """The first rule an admin can act on is named first: a past season's full group reports the season."""
        refusal = find_entry_refusal(saison_status="past", gruppe="C", rules=RULES, occupied=4)
        assert refusal is not None
        assert refusal.error_code == ENTRY_SAISON_NOT_FUTURE


class TestWhetherTheClubIsStillInTheLeague:
    """Its own question, asked of the club rather than of the season — which is why a group move does not ask it."""

    def test_a_live_club_is_admitted(self):
        assert find_club_entry_refusal(inactive_since=None) is None

    def test_a_retired_club_is_refused(self):
        refusal = find_club_entry_refusal(inactive_since="2026-03-01")

        assert refusal is not None
        assert refusal.error_code == CLUB_RETIRED

    def test_the_refusal_names_the_day_it_left(self):
        """The message is what an admin acts on: `reactivate` is one click, but only if the state is legible."""
        refusal = find_club_entry_refusal(inactive_since="2026-03-01")

        assert refusal is not None
        assert "2026-03-01" in refusal.message


DATABASE_NAME = "fl_team_entry_test"
SAISON_ID = "2026"

# Fixed rather than generated, so a failure names the same club every run.
LIVE_OID = ObjectId("6890a1b2c3d4e5f607230001")
RETIRED_OID = ObjectId("6890a1b2c3d4e5f607230002")
ABSENT_OID = ObjectId("6890a1b2c3d4e5f607230003")

CLUB_NAMES = {LIVE_OID: ("Adler", "AD"), RETIRED_OID: ("Bieber", "BI")}

ADDRESS = {"strasse": "Hanauer Landstraße", "hausnummer": "12a", "plz": "60314", "stadtteil": "Ostend", "stadt": "Frankfurt am Main"}


def club_document(team_id: ObjectId, inactive_since: str | None) -> dict[str, Any]:
    name, shorthand = CLUB_NAMES[team_id]

    return {
        "_id": team_id,
        "name": name,
        "shorthand": shorthand,
        "description": "",
        "full_name": f"{name}-Schule",
        "website_url": "https://example.com",
        "address": dict(ADDRESS),
        "inactive_since": inactive_since,
    }


Body = Callable[[AsyncDatabase], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, saison_status: str = "future") -> Any:
    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, collections=(Collection.SAISON_TEAMS,)) as (_, database):
            await database[Collection.SAISONS].insert_one(
                # Only what the endpoint reads: this database installs no validator, and the rest would be decoration.
                {"_id": SAISON_ID, "status": saison_status, "rules": RULES.model_dump(mode="json")}
            )
            await database[Collection.TEAMS].insert_many([club_document(LIVE_OID, None), club_document(RETIRED_OID, "2026-03-01")])

            return await body(database)

    return on_the_seed_loop(_run())


async def enter(database: AsyncDatabase, team_id: ObjectId, gruppe: str = "A") -> Any:
    return await post_saison_team(
        team_id=team_id,
        saison_team_data=FLPostSaisonTeamPayload.model_validate({"saison_id": SAISON_ID, "gruppe": gruppe}),
        teams_collection=database[Collection.TEAMS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
    )


async def junction_rows(database: AsyncDatabase) -> list[dict[str, Any]]:
    return await database[Collection.SAISON_TEAMS].find().to_list(length=None)


@pytest.mark.db
class TestEnteringAClubThroughTheEndpoint:
    """`REQ-ENTER-005` and D52 against a real mongod: a refusal that exists is not a refusal that is reached."""

    def test_a_retired_club_is_refused_with_the_rule_that_stopped_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(DocumentConflictException) as conflict:
                await enter(database, RETIRED_OID)

            return conflict.value.error_code, await junction_rows(database)

        code, rows = on_a_league(mongo_replica_set_url, body)

        assert code == CLUB_RETIRED
        # The refusal has to stop the write, not merely accompany it.
        assert rows == []

    def test_the_clubs_standing_is_reported_before_the_group_it_asked_for(self, mongo_replica_set_url: str):
        """A group the season does not run would refuse too; naming it sends an admin to fix the wrong thing."""

        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(DocumentConflictException) as conflict:
                await enter(database, RETIRED_OID, gruppe="D")

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body) == CLUB_RETIRED

    def test_a_club_no_document_names_is_a_404_and_writes_nothing(self, mongo_replica_set_url: str):
        """The referential hole D52 closes: without the read, the row would name a club `teams` does not hold."""

        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(DocumentNotFoundException):
                await enter(database, ABSENT_OID)

            return await junction_rows(database)

        assert on_a_league(mongo_replica_set_url, body) == []

    def test_a_live_club_is_entered_under_the_name_it_carries_today(self, mongo_replica_set_url: str):
        """The other half of that one read: the season's copy is seeded here or it is seeded nowhere."""

        async def body(database: AsyncDatabase) -> Any:
            response = await enter(database, LIVE_OID)

            return response, await junction_rows(database)

        response, rows = on_a_league(mongo_replica_set_url, body)
        name, shorthand = CLUB_NAMES[LIVE_OID]

        assert (response.name, response.shorthand) == (name, shorthand)
        assert len(rows) == 1
        assert (rows[0]["name"], rows[0]["shorthand"]) == (name, shorthand)
        assert rows[0]["austritt"] is None

    def test_the_season_gate_still_reaches_a_live_club(self, mongo_replica_set_url: str):
        """So the club gate above cannot be passing by refusing everything before the season is ever judged."""

        async def body(database: AsyncDatabase) -> Any:
            with pytest.raises(DocumentConflictException) as conflict:
                await enter(database, LIVE_OID)

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body, saison_status="active") == ENTRY_SAISON_NOT_FUTURE
