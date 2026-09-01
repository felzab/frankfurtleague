from typing import Any, Awaitable, Callable, Iterator

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.cache import invalidate_saison_cache
from app.api.spiele.admin_router import get_spiel_for_admin
from app.api.spiele.router import get_spiel, get_spiele
from app.api.spiele.schemas import FLSpieleFilterParams
from app.api.spieler.admin_router import get_spieler_memberships
from app.api.spieler.router import get_spieler
from app.api.spieler.schemas import FLSpielerFilterParams
from app.api.spieltage.admin_router import get_spieltage_for_admin
from app.api.spieltage.router import get_spieltag, get_spieltage
from app.api.spieltage.schemas import FLSpieltageFilterParams
from app.api.teams.admin_router import get_team_memberships
from app.api.teams.router import get_team, get_teams
from app.api.teams.schemas import FLTeamsFilterParams, FLTeamSingleFilterParams
from app.core.collections import Collection
from app.core.exceptions import DocumentNotFoundException
from tests.database import a_clean_database, on_the_seed_loop, shared_client
from tests.worker import worker_database

from .conftest import unwritten

DATABASE_NAME = worker_database("fl_saison_contents_visibility_test")

ARCHIVED = "2024"
RUNNING = "2025"
PLANNED = "2026"
# An id naming no season at all: what the withheld one has to be indistinguishable from.
UNKNOWN = "2099"

STATUS_OF = {ARCHIVED: "past", RUNNING: "active", PLANNED: "future"}

# One shirt number per season, so a squad row served without its `saison_id` still says where it came from.
NUMMER_OF = {saison_id: saison_id[-2:] for saison_id in STATUS_OF}

# `get_spiele` takes the day as an argument; only `spiel_status` reads it, and no test here sets one.
TODAY = "2026-03-20"

TEAM_OID = ObjectId("6890a1b2c3d4e5f607250001")
SPIELER_OID = ObjectId("6890a1b2c3d4e5f607250002")
SPIELER_VORNAME = "Maxim"

# A second person, whose ONLY squad row is the planned season's: the narrowing drops the row, and a
# person is not a season's content.
PLANNED_ONLY_OID = ObjectId("6890a1b2c3d4e5f607250003")
PLANNED_ONLY_VORNAME = "Nadja"


def an_id(kind: str, saison_id: str) -> ObjectId:
    """One id per document per season, so a failure names the same document every run."""

    return ObjectId(f"6890a1b2c3d4e5f6072{kind}{saison_id}")


def saison_document(saison_id: str) -> dict[str, Any]:
    """Complete, because a season read anywhere below is validated on the way back out."""

    return {
        "_id": saison_id,
        "start_date": f"{saison_id}-01-01",
        "end_date": f"{saison_id}-06-30",
        "status": STATUS_OF[saison_id],
        "rules": {
            "win_points": 3,
            "draw_points": 1,
            "qualifiers_per_group": 2,
            "number_of_groups": 4,
            "teams_per_group": 4,
            "tiebreak_order": "tordifferenz",
            "max_kadergroesse": 18,
            "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
            "erlaubte_stufen": ["E1", "Q1", "Q2", "Q3", "Q4"],
        },
    }


def team_document() -> dict[str, Any]:
    """One club, entered in all three seasons: the same id has to read differently per season."""

    return {
        "_id": TEAM_OID,
        "name": "Helmholtz",
        "shorthand": "HG",
        "description": "",
        "full_name": "Helmholtz-Gymnasium",
        "website_url": "https://helmholtz.example.de",
        "address": {
            "strasse": "Hanauer Landstraße",
            "hausnummer": "12a",
            "plz": "60314",
            "stadtteil": "Ostend",
            "stadt": "Frankfurt am Main",
        },
        "inactive_since": None,
    }


def junction_row(saison_id: str) -> dict[str, Any]:
    """A dict rather than a model: `saison_teams` has no model of the row."""

    return {
        "saison_id": saison_id,
        "team_id": TEAM_OID,
        "gruppe": "A",
        "austritt": None,
        "name": "Helmholtz",
        "shorthand": "HG",
    }


def spieler_document(spieler_id: ObjectId, vorname: str) -> dict[str, Any]:
    """A player of that club. `SPIELER_OID` holds a row in all three seasons, so the same person has to read differently per season."""

    return {
        "_id": spieler_id,
        "vorname": vorname,
        "nachname": "Müller",
        "inactive_since": None,
        "einwilligung": {
            "umfang": "kader_oeffentlich",
            "erteilt_von": "erziehungsberechtigt",
            "datum": "2026-01-15",
            "bestaetigt_am": "2026-01-20",
        },
    }


def squad_row(saison_id: str, spieler_id: ObjectId = SPIELER_OID, kind: str = "4") -> dict[str, Any]:
    """A dict for `junction_row`'s reason: `saison_spieler` has no model of the row either."""

    return {
        "_id": an_id(kind, saison_id),
        "spieler_id": spieler_id,
        "saison_id": saison_id,
        "team_id": TEAM_OID,
        # The season, worn as a shirt: a base-tier squad row names no season, so an unnarrowed read
        # serving three identical rows could otherwise only be counted, never read.
        "nummer": NUMMER_OF[saison_id],
        "position": "Angriff",
        "stufe": "Q3",
        "is_nachgetragen": False,
        "rolle": None,
        "inactive_since": None,
    }


def spiel_document(saison_id: str) -> dict[str, Any]:
    return {
        "_id": an_id("2", saison_id),
        "spiel_nr": 1,
        "saison_id": saison_id,
        "saison_phase": "gruppenphase",
        "spieltag_id": an_id("3", saison_id),
        "team1": {"team_id": TEAM_OID, "name": "Helmholtz", "shorthand": "HG", "tore": None},
        "team2": None,
        "team1_quelle": None,
        "team2_quelle": None,
        "datum": f"{saison_id}-03-15",
        "uhrzeit": "14:00:00",
        "ort": None,
        "schiedsrichter": None,
        "ergebnis": None,
        "elfmeterschiessen": None,
        "sonderereignis": None,
        "notiz": None,
    }


def spieltag_document(saison_id: str) -> dict[str, Any]:
    return {
        "_id": an_id("3", saison_id),
        "beginn": f"{saison_id}-03-15",
        "ende": f"{saison_id}-03-15",
        "position": 1,
        "saison_phase": "gruppenphase",
        "saison_id": saison_id,
    }


Body = Callable[[AsyncDatabase], Awaitable[Any]]


# Module-scoped: every case below reads this corpus and none writes it, which `unwritten` keeps
# from being left as a claim.
@pytest.fixture(scope="module")
def seeded_league(mongo_replica_set_url: str) -> Iterator[str]:
    """Three seasons, one club entered in each, and a fixture, a matchday and squad rows per season."""

    async def _seed() -> None:
        async with a_clean_database(mongo_replica_set_url, DATABASE_NAME) as (_, database):
            await database[Collection.SAISONS].insert_many([saison_document(saison_id) for saison_id in STATUS_OF])
            await database[Collection.TEAMS].insert_one(team_document())
            await database[Collection.SAISON_TEAMS].insert_many([junction_row(saison_id) for saison_id in STATUS_OF])
            await database[Collection.SPIELE].insert_many([spiel_document(saison_id) for saison_id in STATUS_OF])
            await database[Collection.SPIELTAGE].insert_many([spieltag_document(saison_id) for saison_id in STATUS_OF])
            await database[Collection.SPIELER].insert_many(
                [spieler_document(SPIELER_OID, SPIELER_VORNAME), spieler_document(PLANNED_ONLY_OID, PLANNED_ONLY_VORNAME)]
            )
            await database[Collection.SAISON_SPIELER].insert_many(
                [*(squad_row(saison_id) for saison_id in STATUS_OF), squad_row(PLANNED, PLANNED_ONLY_OID, kind="5")]
            )

    on_the_seed_loop(_seed())

    with unwritten(mongo_replica_set_url, DATABASE_NAME):
        yield mongo_replica_set_url


def on_a_league(url: str, body: Body) -> Any:
    async def _run() -> Any:
        # Process-global and keyed by season id, so an entry another test left would answer here.
        invalidate_saison_cache()

        return await body(shared_client(url)[DATABASE_NAME])

    return on_the_seed_loop(_run())


def raised_by(url: str, body: Body) -> DocumentNotFoundException:
    """The refusal a read answered with, so a test asserts on its status rather than only that it refused."""

    async def _catching(database: AsyncDatabase) -> DocumentNotFoundException:
        with pytest.raises(DocumentNotFoundException) as refusal:
            await body(database)

        return refusal.value

    return on_a_league(url, _catching)


async def read_teams(database: AsyncDatabase, saison_id: str | None) -> Any:
    return await get_teams(
        teams_collection=database[Collection.TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        filters=FLTeamsFilterParams(saison_id=saison_id),
    )


async def read_team(database: AsyncDatabase, saison_id: str | None) -> Any:
    return await get_team(
        team_id=TEAM_OID,
        teams_collection=database[Collection.TEAMS],
        saisons_collection=database[Collection.SAISONS],
        filters=FLTeamSingleFilterParams(saison_id=saison_id),
    )


async def read_spieler(database: AsyncDatabase, saison_id: str | None, team_id: ObjectId | None = None) -> Any:
    return await get_spieler(
        spieler_collection=database[Collection.SPIELER],
        saisons_collection=database[Collection.SAISONS],
        filters=FLSpielerFilterParams(saison_id=saison_id, team_id=team_id),
    )


def squad_rows_served(response: Any) -> set[tuple[str, str | None]]:
    """Each served row as its forename and its shirt -- and the shirt is the season `squad_row` seeded it with."""

    return {(row.vorname, row.nummer) for row in response.spieler}


async def read_spiele(database: AsyncDatabase, saison_id: str | None) -> Any:
    return await get_spiele(
        spiele_collection=database[Collection.SPIELE],
        saisons_collection=database[Collection.SAISONS],
        filters=FLSpieleFilterParams(saison_id=saison_id),
        today=TODAY,
    )


async def read_spiel(database: AsyncDatabase, saison_id: str) -> Any:
    return await get_spiel(
        spiel_id=an_id("2", saison_id),
        spiele_collection=database[Collection.SPIELE],
        saisons_collection=database[Collection.SAISONS],
    )


async def read_spieltage(database: AsyncDatabase, saison_id: str | None) -> Any:
    return await get_spieltage(
        spieltage_collection=database[Collection.SPIELTAGE],
        saisons_collection=database[Collection.SAISONS],
        filters=FLSpieltageFilterParams(saison_id=saison_id),
    )


async def read_spieltag(database: AsyncDatabase, saison_id: str) -> Any:
    return await get_spieltag(
        spieltag_id=an_id("3", saison_id),
        spieltage_collection=database[Collection.SPIELTAGE],
        saisons_collection=database[Collection.SAISONS],
    )


@pytest.mark.db
class TestThePlannedSeasonsContentsAreWithheldFromTheBaseTier:
    """The season RESOURCE is closed by `base_tier_status_term`; these are the reads scoped by one."""

    def test_its_squads_are_not_listed(self, seeded_league: str):
        assert raised_by(seeded_league, lambda database: read_teams(database, PLANNED)).status_code == 404

    def test_a_club_is_not_served_with_the_planned_seasons_figures(self, seeded_league: str):
        """The club is season-independent; `gruppe` and `statistik` are not, so the season decides."""

        assert raised_by(seeded_league, lambda database: read_team(database, PLANNED)).status_code == 404

    def test_its_fixtures_list_as_nothing(self, seeded_league: str):
        """Empty rather than a refusal: an id naming no season already lists nothing here."""

        assert on_a_league(seeded_league, lambda database: read_spiele(database, PLANNED)).spiele == []

    def test_one_of_its_fixtures_is_not_served_by_id(self, seeded_league: str):
        assert raised_by(seeded_league, lambda database: read_spiel(database, PLANNED)).status_code == 404

    def test_its_players_are_not_listed(self, seeded_league: str):
        """Empty rather than a refusal, as the fixtures are: this read resolves no season, so an id naming none already lists nothing here."""

        assert on_a_league(seeded_league, lambda database: read_spieler(database, PLANNED)).spieler == []

    def test_its_squad_rows_are_absent_from_a_list_nothing_narrowed(self, seeded_league: str):
        """The planned shirt is gone, the readable ones are not, and the planned-only person is still a person.

        The middle claim is what stops this passing against a read that serves nothing at all.
        """

        served = on_a_league(seeded_league, lambda database: read_spieler(database, None))

        assert squad_rows_served(served) == {
            (SPIELER_VORNAME, NUMMER_OF[ARCHIVED]),
            (SPIELER_VORNAME, NUMMER_OF[RUNNING]),
            (PLANNED_ONLY_VORNAME, None),
        }

    def test_its_squad_rows_are_absent_from_a_list_narrowed_by_club(self, seeded_league: str):
        """The other route in: the club plays in all three seasons, and `?team_id=` alone names no season for the id gate to judge.

        Naming a team makes the junction join strict, so the player left with no row drops out here rather than reading as a player.
        """

        served = on_a_league(seeded_league, lambda database: read_spieler(database, None, team_id=TEAM_OID))

        assert squad_rows_served(served) == {(SPIELER_VORNAME, NUMMER_OF[ARCHIVED]), (SPIELER_VORNAME, NUMMER_OF[RUNNING])}

    def test_its_matchdays_are_not_listed(self, seeded_league: str):
        assert raised_by(seeded_league, lambda database: read_spieltage(database, PLANNED)).status_code == 404

    def test_one_of_its_matchdays_is_not_served_by_id(self, seeded_league: str):
        assert raised_by(seeded_league, lambda database: read_spieltag(database, PLANNED)).status_code == 404


@pytest.mark.db
class TestTheWithheldSeasonReadsAsOneThatWasNeverCreated:
    """No 403 and no answer of its own: nothing tells the planned season from an id naming none."""

    def test_the_squad_list_refuses_an_unknown_season_the_same_way(self, seeded_league: str):
        assert raised_by(seeded_league, lambda database: read_teams(database, UNKNOWN)).status_code == 404

    def test_the_matchday_list_refuses_an_unknown_season_the_same_way(self, seeded_league: str):
        assert raised_by(seeded_league, lambda database: read_spieltage(database, UNKNOWN)).status_code == 404

    def test_the_fixture_list_answers_an_unknown_season_with_the_same_empty_list(self, seeded_league: str):
        assert on_a_league(seeded_league, lambda database: read_spiele(database, UNKNOWN)).spiele == []

    def test_the_player_list_answers_an_unknown_season_with_the_same_empty_list(self, seeded_league: str):
        """The pair the planned season has to be indistinguishable from: a non-empty answer there would confirm the season exists."""

        assert on_a_league(seeded_league, lambda database: read_spieler(database, UNKNOWN)).spieler == []


@pytest.mark.db
@pytest.mark.parametrize("saison_id", [ARCHIVED, RUNNING])
class TestAReadableSeasonIsServedInFull:
    """The control for every refusal above: the same reads, one status along."""

    def test_its_squads_are_listed(self, saison_id: str, seeded_league: str):
        response = on_a_league(seeded_league, lambda database: read_teams(database, saison_id))

        assert [team.id for team in response.teams] == [TEAM_OID]

    def test_a_club_is_served_with_that_seasons_figures(self, saison_id: str, seeded_league: str):
        assert on_a_league(seeded_league, lambda database: read_team(database, saison_id)).team.gruppe == "A"

    def test_its_fixtures_are_listed(self, saison_id: str, seeded_league: str):
        response = on_a_league(seeded_league, lambda database: read_spiele(database, saison_id))

        assert [spiel.saison_id for spiel in response.spiele] == [saison_id]

    def test_one_of_its_fixtures_is_served_by_id(self, saison_id: str, seeded_league: str):
        assert on_a_league(seeded_league, lambda database: read_spiel(database, saison_id)).spiel.saison_id == saison_id

    def test_its_matchdays_are_listed(self, saison_id: str, seeded_league: str):
        response = on_a_league(seeded_league, lambda database: read_spieltage(database, saison_id))

        assert [spieltag.saison_id for spieltag in response.spieltage] == [saison_id]

    def test_one_of_its_matchdays_is_served_by_id(self, saison_id: str, seeded_league: str):
        assert on_a_league(seeded_league, lambda database: read_spieltag(database, saison_id)).spieltag.saison_id == saison_id

    def test_its_players_are_listed(self, saison_id: str, seeded_league: str):
        """The shirt as well as the name: the same person holds a row in all three seasons, so only the number says which one was served."""

        response = on_a_league(seeded_league, lambda database: read_spieler(database, saison_id))

        assert squad_rows_served(response) == {(SPIELER_VORNAME, NUMMER_OF[saison_id])}


@pytest.mark.db
class TestTheResolvedSeasonNeedsNoGate:
    """An omitted `saison_id` resolves the `active` season, which no status can withhold."""

    def test_the_fixture_list_still_answers_the_running_season(self, seeded_league: str):
        response = on_a_league(seeded_league, lambda database: read_spiele(database, None))

        assert [spiel.saison_id for spiel in response.spiele] == [RUNNING]

    def test_the_squad_list_still_answers_the_running_season(self, seeded_league: str):
        assert on_a_league(seeded_league, lambda database: read_teams(database, None)).teams != []

    def test_the_matchday_list_still_answers_the_running_season(self, seeded_league: str):
        response = on_a_league(seeded_league, lambda database: read_spieltage(database, None))

        assert [spieltag.saison_id for spieltag in response.spieltage] == [RUNNING]


@pytest.mark.db
class TestTheAdminTierStillReadsThePlannedSeason:
    """Non-vacuity as well as the rule: every refusal above ran on a season that HOLDS these documents."""

    def test_a_planned_fixture_is_served_to_the_editor(self, seeded_league: str):
        async def body(database: AsyncDatabase) -> Any:
            return await get_spiel_for_admin(spiel_id=an_id("2", PLANNED), spiele_collection=database[Collection.SPIELE])

        assert on_a_league(seeded_league, body).spiel.saison_id == PLANNED

    def test_the_planned_membership_is_listed(self, seeded_league: str):
        async def body(database: AsyncDatabase) -> Any:
            return await get_team_memberships(teams_collection=database[Collection.TEAMS])

        response = on_a_league(seeded_league, body)

        assert PLANNED in [membership.saison_id for team in response.teams for membership in team.memberships]

    def test_the_planned_squad_rows_are_listed(self, seeded_league: str):
        """What makes the empty base-tier answers above mean something: the planned season really holds BOTH rows they withheld.

        The second one especially -- a loose join serves that person with no row either way, so nothing else here would notice it missing.
        """

        async def body(database: AsyncDatabase) -> Any:
            return await get_spieler_memberships(spieler_collection=database[Collection.SPIELER])

        response = on_a_league(seeded_league, body)
        planned = {person.vorname for person in response.spieler for membership in person.memberships if membership.saison_id == PLANNED}

        assert planned == {SPIELER_VORNAME, PLANNED_ONLY_VORNAME}

    def test_the_planned_matchday_is_listed(self, seeded_league: str):
        async def body(database: AsyncDatabase) -> Any:
            return await get_spieltage_for_admin(
                spieltage_collection=database[Collection.SPIELTAGE],
                saisons_collection=database[Collection.SAISONS],
                filters=FLSpieltageFilterParams(saison_id=PLANNED),
            )

        response = on_a_league(seeded_league, body)

        assert [spieltag.saison_id for spieltag in response.spieltage] == [PLANNED]
