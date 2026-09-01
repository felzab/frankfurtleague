import asyncio
import copy
from typing import Any, Awaitable, Callable, Sequence

import pytest
from bson import ObjectId
from pydantic import ValidationError
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.teams.admin_router import replace_saison_team
from app.api.teams.schemas import FLReplaceSaisonTeamPayload
from app.api.teams.services import (
    CLUB_RETIRED,
    REPLACE_INCOMING_ALREADY_ENTERED,
    REPLACE_OUTGOING_HAS_A_RECORD,
    REPLACE_SAISON_FINISHED,
)
from app.core.collections import Collection
from app.core.exceptions import DocumentConflictException, DocumentNotFoundException
from tests.database import a_clean_database

pytestmark = pytest.mark.db

DATABASE_NAME = "fl_replacement_test"

SAISON_ID = "2026"
PRIOR_SAISON_ID = "2025"

# Fixed rather than generated, so a failure names the same club every run.
WITHDRAWN = ObjectId("6890a1b2c3d4e5f607260001")
INCOMING = ObjectId("6890a1b2c3d4e5f607260002")
RIVAL = ObjectId("6890a1b2c3d4e5f607260003")
ENTERED = ObjectId("6890a1b2c3d4e5f607260004")
RETIRED = ObjectId("6890a1b2c3d4e5f607260005")
# A junction row points at this id and NO `teams` document does: the phantom D43 exists to repair.
PHANTOM = ObjectId("6890a1b2c3d4e5f607260006")
ABSENT = ObjectId("6890a1b2c3d4e5f607260009")

# The club's CURRENT identity, which is what a replacement seeds the row and the fixtures from.
CLUB_NAMES = {
    WITHDRAWN: ("Withdrawn", "WD"),
    INCOMING: ("Incoming", "IN"),
    RIVAL: ("Rival", "RI"),
    ENTERED: ("Entered", "EN"),
    RETIRED: ("Retired", "RE"),
}

# The season's own copy, deliberately NOT the club's current one: a reseed taken off the junction
# row rather than off `teams` would leave these spellings in place and pass every other assertion.
PLAYED_AS = {
    WITHDRAWN: ("Withdrawn-Alt", "WX"),
    RIVAL: ("Rival-Alt", "RX"),
    ENTERED: ("Entered-Alt", "EX"),
    PHANTOM: ("Phantom", "PH"),
}

EXIT = {"type": "rueckzug", "grund": "Zu wenige Spieler", "datum": "2026-04-01"}

# Required by the shipped `saisons` validator and read by nothing below: no case here turns on a rule.
RULES = {
    "win_points": 3,
    "draw_points": 1,
    "qualifiers_per_group": 2,
    "number_of_groups": 4,
    "teams_per_group": 4,
    "tiebreak_order": "tordifferenz",
    "max_kadergroesse": 18,
    "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
    "erlaubte_stufen": ["E1", "Q1", "Q2", "Q3", "Q4"],
}

# Likewise for `teams`: a club carries an address and nothing in this suite reads one.
CLUB_ADDRESS = {"strasse": "Hanauer Landstrasse", "hausnummer": "12a", "plz": "60314", "stadtteil": "Ostend", "stadt": "Frankfurt am Main"}

# The `spiele` keys the shipped validator requires and no case here moves: a fixture nobody has
# assigned a source, a pitch, a referee or a shoot-out.
UNFILLED_SPIEL_FIELDS: dict[str, Any] = {
    "team1_quelle": None,
    "team2_quelle": None,
    "ort": None,
    "schiedsrichter": None,
    "elfmeterschiessen": None,
}

SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f6072600f1")

INCOMING_SIDE = {"team_id": INCOMING, "name": "Incoming", "shorthand": "IN", "tore": None}

# The day the replacement runs, and a departure from the same squad that predates it.
REPLACED_ON = "2026-04-15"
LEFT_EARLIER_ON = "2026-03-01"

# A prefix of their own, so a squad row's id cannot be mistaken for a club's in a failure message.
SQUAD_ROW_ID = "6890a1b2c3d4e5f60726a{:03d}"
SQUAD_PERSON_ID = "6890a1b2c3d4e5f60726b{:03d}"

LIVE_IN_THE_OUTGOING_SQUAD = 2


# What the OUTGOING school filled in. Seeded on every row so the clearing below has something to
# clear: a test over a row that carried no contacts would pass against an endpoint that clears none.
OUTGOING_KONTAKTPERSON = {
    "vorname": "Anke",
    "nachname": "Koerner",
    "email": "a.koerner@outgoing.example.de",
    "telefon": "+49 170 1234567",
    "geburtsdatum": "1984-05-09",
    "einwilligung": {"umfang": "kontaktdaten", "erteilt_von": "person", "text_version": "v1", "datum": "2026-01-15"},
}

OUTGOING_KONTAKTE = {
    "trainer": dict(OUTGOING_KONTAKTPERSON),
    "ansprechperson": dict(OUTGOING_KONTAKTPERSON),
    "stellvertretung": dict(OUTGOING_KONTAKTPERSON),
    "trainer_ist_zugleich": "ansprechperson",
}

OUTGOING_TRIKOT_FARBE = "bordeaux"


def junction(team_id: ObjectId, gruppe: str, austritt: dict[str, Any] | None = None) -> dict[str, Any]:
    """A dict rather than a model: `saison_teams` is the one collection with no model of the row."""

    name, shorthand = PLAYED_AS[team_id]

    return {
        "saison_id": SAISON_ID,
        "team_id": team_id,
        "gruppe": gruppe,
        "austritt": austritt,
        "name": name,
        "shorthand": shorthand,
        "trikot_farbe": OUTGOING_TRIKOT_FARBE,
        "kontakte": copy.deepcopy(OUTGOING_KONTAKTE),
    }


def default_junctions() -> list[dict[str, Any]]:
    """The season's four rows, built per call so a test may seed a different set without editing this one."""

    return [junction(WITHDRAWN, "A", dict(EXIT)), junction(RIVAL, "A"), junction(ENTERED, "B"), junction(PHANTOM, "B")]


def squad_row(
    index: int,
    *,
    team_id: ObjectId,
    inactive_since: str | None,
    saison_id: str = SAISON_ID,
    person: int | None = None,
) -> dict[str, Any]:
    """One `saison_spieler` row, keyed back by its `nummer`. A live one carries an explicit `None`, which is what the retirement matches on.

    `person` names the `spieler_id`, so one player can hold a row in two seasons.
    """

    return {
        "_id": ObjectId(SQUAD_ROW_ID.format(index)),
        "spieler_id": ObjectId(SQUAD_PERSON_ID.format(index if person is None else person)),
        "saison_id": saison_id,
        "team_id": team_id,
        "is_nachgetragen": False,
        "rolle": None,
        "stufe": "Q2",
        "position": "Angriff",
        "nummer": str(index),
        "inactive_since": inactive_since,
    }


# The outgoing club's live squad, a row that left it earlier, another club's squad in the same
# season, and row 1's own player one season back -- the four sets the retirement has to tell apart.
SQUAD_ROWS = [
    squad_row(1, team_id=WITHDRAWN, inactive_since=None),
    squad_row(2, team_id=WITHDRAWN, inactive_since=None),
    squad_row(3, team_id=WITHDRAWN, inactive_since=LEFT_EARLIER_ON),
    squad_row(4, team_id=RIVAL, inactive_since=None),
    squad_row(5, team_id=WITHDRAWN, inactive_since=None, saison_id=PRIOR_SAISON_ID, person=1),
]


def club(team_id: ObjectId, inactive_since: str | None = None) -> dict[str, Any]:
    name, shorthand = CLUB_NAMES[team_id]

    return {
        "_id": team_id,
        "name": name,
        "shorthand": shorthand,
        "description": "",
        "full_name": f"{name}-Schule Frankfurt",
        "website_url": f"https://{shorthand.lower()}.example.de",
        "address": dict(CLUB_ADDRESS),
        "inactive_since": inactive_since,
    }


def side(team_id: ObjectId, tore: int | None = None) -> dict[str, Any]:
    """Composed as production composes one: the SEASON's copy of the identity, off the junction row."""

    name, shorthand = PLAYED_AS[team_id]

    return {"team_id": team_id, "name": name, "shorthand": shorthand, "tore": tore}


def gruppen_fixture(
    spiel_nr: int,
    home: ObjectId,
    away: ObjectId,
    *,
    ergebnis: str | None = None,
    sonderereignis: str | None = None,
    tore: tuple[int | None, int | None] = (None, None),
    saison_id: str = SAISON_ID,
) -> dict[str, Any]:
    """`datum`, `uhrzeit` and `spieltag_id` are the schedule D43 promises survives, so every fixture carries all three."""

    return {
        "saison_id": saison_id,
        "saison_phase": "gruppenphase",
        "spiel_nr": spiel_nr,
        "spieltag_id": SPIELTAG_OID,
        "datum": "2026-03-15",
        "uhrzeit": "18:00:00",
        "team1": side(home, tore[0]),
        "team2": side(away, tore[1]),
        **UNFILLED_SPIEL_FIELDS,
        "ergebnis": ergebnis,
        "sonderereignis": sonderereignis,
    }


def knockout_fixture(spiel_nr: int, home: ObjectId) -> dict[str, Any]:
    """A bracket slot with its second side still unfilled -- a shape the replacement has to survive."""

    return {
        "saison_id": SAISON_ID,
        "saison_phase": "viertelfinale",
        "spiel_nr": spiel_nr,
        "spieltag_id": SPIELTAG_OID,
        "datum": "2026-05-20",
        "uhrzeit": "18:00:00",
        "team1": side(home),
        "team2": None,
        **UNFILLED_SPIEL_FIELDS,
        "ergebnis": None,
        "sonderereignis": None,
    }


# Three fixtures field the outgoing club and three do not: a group fixture on each slot, a bracket
# slot, one fixture between two other clubs, the phantom row's own, and one from the season before.
SEASON_FIXTURES = [
    gruppen_fixture(1, WITHDRAWN, RIVAL),
    gruppen_fixture(2, RIVAL, WITHDRAWN),
    gruppen_fixture(3, RIVAL, ENTERED),
    knockout_fixture(4, WITHDRAWN),
    gruppen_fixture(5, WITHDRAWN, RIVAL, ergebnis="3:1", tore=(3, 1), saison_id=PRIOR_SAISON_ID),
    gruppen_fixture(6, PHANTOM, ENTERED),
]

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_seeded_season(
    url: str,
    body: Body,
    *,
    spiele: Sequence[dict[str, Any]] | None = None,
    saison_status: str = "active",
    junctions: Sequence[dict[str, Any]] | None = None,
    constrained: bool = True,
) -> Any:
    """One client and event loop per call: `AsyncMongoClient` binds to the loop it first ran on.

    `active` by default: this endpoint is for a mid-season withdrawal. The SHIPPED validators too,
    `constrained=False` being the case whose subject they forbid.
    """

    # `spiele` by hand where no validator is installed: a transaction cannot create a collection.
    collections = () if constrained else (Collection.SPIELE,)

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=constrained, collections=collections) as (client, database):
            # Each season spans its own calendar year, so the two seeded spans do not overlap.
            await database[Collection.SAISONS].insert_many(
                [
                    {"_id": year, "start_date": f"{year}-01-01", "end_date": f"{year}-06-30", "status": status, "rules": dict(RULES)}
                    for year, status in ((SAISON_ID, saison_status), (PRIOR_SAISON_ID, "past"))
                ]
            )
            await database[Collection.SAISON_TEAMS].insert_many(list(default_junctions() if junctions is None else junctions))
            # No document for PHANTOM, which is the whole point of that junction row.
            await database[Collection.TEAMS].insert_many(
                [club(WITHDRAWN), club(INCOMING), club(RIVAL), club(ENTERED), club(RETIRED, inactive_since="2026-02-01")]
            )
            await database[Collection.SAISON_SPIELER].insert_many(list(SQUAD_ROWS))
            await database[Collection.SPIELE].insert_many(list(SEASON_FIXTURES if spiele is None else spiele))

            return await body(database, client)

    return asyncio.run(_run())


async def call_replace(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    team_id: ObjectId = WITHDRAWN,
    incoming_team_id: ObjectId = INCOMING,
    *,
    saison_id: str = SAISON_ID,
) -> Any:
    return await replace_saison_team(
        team_id=team_id,
        saison_id=saison_id,
        replacement_data=FLReplaceSaisonTeamPayload(incoming_team_id=incoming_team_id),
        teams_collection=database[Collection.TEAMS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        db=client,
        today=REPLACED_ON,
    )


async def rows_now(database: AsyncDatabase) -> list[dict[str, Any]]:
    """Read outside any transaction -- what a later request would see."""

    return await database[Collection.SAISON_TEAMS].find({"saison_id": SAISON_ID}).to_list(length=None)


async def row_of(database: AsyncDatabase, team_id: ObjectId) -> dict[str, Any] | None:
    return await database[Collection.SAISON_TEAMS].find_one({"saison_id": SAISON_ID, "team_id": team_id})


async def spiele_now(database: AsyncDatabase) -> dict[int, dict[str, Any]]:
    rows = await database[Collection.SPIELE].find({}).to_list(length=None)

    return {row["spiel_nr"]: row for row in rows}


async def squad_now(database: AsyncDatabase) -> dict[int, dict[str, Any]]:
    """Every squad row of every season, keyed by the `nummer` its seed carries."""

    rows = await database[Collection.SAISON_SPIELER].find({}).to_list(length=None)

    return {int(row["nummer"]): row for row in rows}


async def _row_after(database: AsyncDatabase, client: AsyncMongoClient, team_id: ObjectId = WITHDRAWN) -> Any:
    await call_replace(database, client, team_id=team_id)

    return await row_of(database, INCOMING)


async def _spiele_after(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    await call_replace(database, client)

    return await spiele_now(database)


async def _squad_after(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    await call_replace(database, client)

    return await squad_now(database)


async def _refused(database: AsyncDatabase, client: AsyncMongoClient, incoming: ObjectId = INCOMING) -> Any:
    """The code, plus the two surfaces a refusal has to have left alone."""

    with pytest.raises(DocumentConflictException) as refusal:
        await call_replace(database, client, incoming_team_id=incoming)

    return refusal.value.error_code, await row_of(database, WITHDRAWN), await spiele_now(database)


class TestAllFourLayersMoveTogether:
    """A replacement touching three of the four is half done, and each half passes the other's assertions."""

    def test_the_row_names_the_incoming_club(self, mongo_replica_set_url: str):
        """Layer one. Kills a fan-out that rewrites the fixtures and leaves the junction row where it was."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_replace(database, client)
            return await row_of(database, INCOMING), await row_of(database, WITHDRAWN)

        arrived, departed = on_a_seeded_season(mongo_replica_set_url, body)

        assert arrived is not None
        assert departed is None, "the outgoing club still holds a row, so the season fields one club too many"

    def test_the_rows_identity_is_reseeded_from_the_incoming_club(self, mongo_replica_set_url: str):
        """Layer two. Kills a rewrite of `team_id` alone, which leaves the season's row spelling the OUTGOING club's name."""

        row = on_a_seeded_season(mongo_replica_set_url, _row_after)

        assert row is not None
        assert (row["name"], row["shorthand"]) == ("Incoming", "IN")

    def test_every_side_the_club_held_moves_and_is_counted(self, mongo_replica_set_url: str):
        """Layer three, on both slots and past the group phase. Kills a single-pass rewrite, and a count assumed rather than returned."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await call_replace(database, client)
            return response.fanned_out_to_spiele, await spiele_now(database)

        fanned_out, spiele = on_a_seeded_season(mongo_replica_set_url, body)

        assert fanned_out == 3, "the fixtures the club held, counted once each"
        assert spiele[1]["team1"] == INCOMING_SIDE
        assert spiele[2]["team2"] == INCOMING_SIDE
        assert spiele[4]["team1"] == INCOMING_SIDE, "a bracket slot is part of the schedule the incoming club inherits"

    def test_the_fixture_copies_are_reseeded_too(self, mongo_replica_set_url: str):
        """Kills rewriting `team_id` and leaving the display copy: every card would show the outgoing club over the incoming club's fixture."""

        spiele = on_a_seeded_season(mongo_replica_set_url, _spiele_after)

        assert (spiele[1]["team1"]["name"], spiele[1]["team1"]["shorthand"]) == ("Incoming", "IN")

    def test_the_row_and_the_fixtures_spell_the_club_the_same_way(self, mongo_replica_set_url: str):
        """One read feeds both layers, so the two cannot part company (`docs/backend/spec.md :: I11`)."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_replace(database, client)
            return await row_of(database, INCOMING), await spiele_now(database)

        row, spiele = on_a_seeded_season(mongo_replica_set_url, body)

        assert row is not None
        assert (row["name"], row["shorthand"]) == (spiele[1]["team1"]["name"], spiele[1]["team1"]["shorthand"])

    def test_the_austritt_is_cleared(self, mongo_replica_set_url: str):
        """Layer four. Kills leaving it standing, which would mark the INCOMING club withdrawn and drop it from the table."""

        row = on_a_seeded_season(mongo_replica_set_url, _row_after)

        assert row is not None
        assert row["austritt"] is None

    def test_the_kit_colour_and_the_contacts_are_cleared_with_it(self, mongo_replica_set_url: str):
        """Kills leaving them standing, which would hold the OUTGOING school's three people against a club that never gave them."""

        row = on_a_seeded_season(mongo_replica_set_url, _row_after)

        assert row is not None
        assert row["trikot_farbe"] is None
        assert row["kontakte"] is None

    def test_the_seed_really_carried_them(self, mongo_replica_set_url: str):
        """The floor under the case above: read back after the write, a null proves nothing about a row that went in holding nothing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await row_of(database, WITHDRAWN)

        seeded = on_a_seeded_season(mongo_replica_set_url, body)

        assert seeded is not None
        assert seeded["trikot_farbe"] == OUTGOING_TRIKOT_FARBE
        assert seeded["kontakte"]["ansprechperson"]["email"] == OUTGOING_KONTAKTPERSON["email"]

    def test_the_group_and_the_row_count_are_left_alone(self, mongo_replica_set_url: str):
        """The row is rewritten IN PLACE. Kills a delete-and-insert, which frees the place and lets the group refill."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_replace(database, client)
            return await rows_now(database), await row_of(database, INCOMING)

        rows, row = on_a_seeded_season(mongo_replica_set_url, body)

        assert row is not None
        assert row["gruppe"] == "A"
        assert len(rows) == 4, "the season gained or lost a junction row"

    def test_the_schedule_survives_intact(self, mongo_replica_set_url: str):
        """D43's promise. Kills a rewrite that redraws the fixture rather than replacing one side of it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await spiele_now(database)
            await call_replace(database, client)
            return before, await spiele_now(database)

        before, after = on_a_seeded_season(mongo_replica_set_url, body)

        for spiel_nr in before:
            for field in ("_id", "datum", "uhrzeit", "spieltag_id", "saison_phase", "spiel_nr"):
                assert after[spiel_nr][field] == before[spiel_nr][field], f"spiel {spiel_nr} lost its {field}"

        assert after[1]["team2"] == before[1]["team2"], "the opponent was rewritten"

    def test_the_echo_describes_the_row_that_landed(self, mongo_replica_set_url: str):
        """Built off the after-image. Kills an echo assembled from the payload, which cannot disagree with itself."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await call_replace(database, client)
            return response, await row_of(database, INCOMING)

        response, row = on_a_seeded_season(mongo_replica_set_url, body)

        assert row is not None
        assert (response.outgoing_team_id, response.incoming_team_id) == (WITHDRAWN, INCOMING)
        assert (response.gruppe, response.name, response.shorthand) == (row["gruppe"], row["name"], row["shorthand"])
        # The pair the admin has to act on: the season now has no way at all to reach this team.
        assert (response.trikot_farbe, response.kontakte) == (None, None)


class TestTheOutgoingClubsSquadIsRetired:
    """The fifth surface, the one that does not move: `REQ-SQUAD-001` refuses a squad row whose club holds no junction row for the season."""

    def test_the_live_rows_are_stamped_with_the_day_of_the_replacement(self, mongo_replica_set_url: str):
        """Kills leaving them standing: a season-and-team read of `GET /spieler` goes on serving the outgoing club's squad."""

        squad = on_a_seeded_season(mongo_replica_set_url, _squad_after)

        assert (squad[1]["inactive_since"], squad[2]["inactive_since"]) == (REPLACED_ON, REPLACED_ON)

    def test_a_row_that_left_the_squad_earlier_keeps_its_own_date(self, mongo_replica_set_url: str):
        """Kills dropping `inactive_since: None` from the filter, which rewrites the date of a departure that had already happened."""

        squad = on_a_seeded_season(mongo_replica_set_url, _squad_after)

        assert squad[3]["inactive_since"] == LEFT_EARLIER_ON

    def test_the_players_stay_with_the_club_they_registered_for(self, mongo_replica_set_url: str):
        """Kills repointing `team_id` at the incoming club: nobody transferred, and that club registers a squad of its own."""

        squad = on_a_seeded_season(mongo_replica_set_url, _squad_after)

        assert {squad[index]["team_id"] for index in (1, 2, 3)} == {WITHDRAWN}

    def test_another_clubs_squad_in_the_same_season_is_untouched(self, mongo_replica_set_url: str):
        """Kills a filter missing `team_id`, which would empty every squad in the season."""

        squad = on_a_seeded_season(mongo_replica_set_url, _squad_after)

        assert squad[4]["inactive_since"] is None

    def test_the_same_player_in_another_season_is_untouched(self, mongo_replica_set_url: str):
        """Kills a filter missing `saison_id`: row 5 is row 1's own player, in the same club, one season back."""

        squad = on_a_seeded_season(mongo_replica_set_url, _squad_after)

        assert squad[5]["inactive_since"] is None

    def test_the_count_reports_what_the_write_touched(self, mongo_replica_set_url: str):
        """`docs/backend/spec.md :: I13`. Kills a count assumed rather than taken from the write, which the rows themselves then contradict."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await call_replace(database, client)
            return response.ausgetragene_squad_rows, await squad_now(database)

        ausgetragen, squad = on_a_seeded_season(mongo_replica_set_url, body)

        assert ausgetragen == LIVE_IN_THE_OUTGOING_SQUAD
        assert ausgetragen == sum(1 for row in squad.values() if row["inactive_since"] == REPLACED_ON)

    def test_an_abort_takes_the_retirement_back(self, mongo_replica_set_url: str):
        """Kills dropping `session=`, which retires a squad for a replacement that never landed. The echo rejects the stored `gruppe`."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(ValidationError):
                await call_replace(database, client)
            return await squad_now(database)

        # UNCONSTRAINED, alone in this file: `Z` is no group the shipped validator admits, and the
        # defence under test is the endpoint's own guard against a stored one that got past it.
        squad = on_a_seeded_season(
            mongo_replica_set_url,
            body,
            junctions=[junction(WITHDRAWN, "Z", dict(EXIT)), junction(RIVAL, "A")],
            constrained=False,
        )

        assert [squad[index]["inactive_since"] for index in (1, 2)] == [None, None]


class TestTheReplacementReachesNothingElse:
    def test_a_fixture_between_two_other_clubs_is_untouched(self, mongo_replica_set_url: str):
        """Kills a fan-out filtered on the season alone, which passes every assertion about the sides that did move."""

        spiele = on_a_seeded_season(mongo_replica_set_url, _spiele_after)

        assert (spiele[3]["team1"]["team_id"], spiele[3]["team2"]["team_id"]) == (RIVAL, ENTERED)

    def test_another_seasons_fixture_is_untouched(self, mongo_replica_set_url: str):
        """Kills a fan-out missing `saison_id`, and a played-check missing it: spiel 5 is the same club, with a result, one season back."""

        spiele = on_a_seeded_season(mongo_replica_set_url, _spiele_after)

        assert spiele[5]["team1"] == side(WITHDRAWN, 3), "a past season keeps the name it was played under"

    def test_the_other_junction_rows_are_untouched(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_replace(database, client)
            return await row_of(database, RIVAL)

        row = on_a_seeded_season(mongo_replica_set_url, body)

        assert row is not None
        assert (row["gruppe"], row["name"]) == ("A", "Rival-Alt")


class TestAPhantomRowIsRepaired:
    """D43 names this as one of the operation's purposes, so no refusal here may require the outgoing club to exist."""

    def test_a_row_whose_club_is_gone_is_replaced(self, mongo_replica_set_url: str):
        """Kills a guard reading the outgoing club for its name or its standing, which would 404 on exactly the row this repairs."""

        row = on_a_seeded_season(mongo_replica_set_url, lambda database, client: _row_after(database, client, team_id=PHANTOM))

        assert row is not None
        assert (row["gruppe"], row["name"], row["shorthand"]) == ("B", "Incoming", "IN")

    def test_its_fixtures_move_with_it(self, mongo_replica_set_url: str):
        """Kills a fan-out composing the new side out of the OUTGOING club, which here has no document to read."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await call_replace(database, client, team_id=PHANTOM)
            return response.fanned_out_to_spiele, await spiele_now(database)

        fanned_out, spiele = on_a_seeded_season(mongo_replica_set_url, body)

        assert fanned_out == 1
        assert spiele[6]["team1"] == INCOMING_SIDE

    def test_a_row_with_no_austritt_is_replaceable(self, mongo_replica_set_url: str):
        """The phantom row carries none. Kills a gate demanding a recorded exit, which a replacement before activation never has."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await row_of(database, PHANTOM)
            await call_replace(database, client, team_id=PHANTOM)
            return before, await row_of(database, INCOMING)

        seeded, row = on_a_seeded_season(mongo_replica_set_url, body)

        # The floor is the seed: read back after the write, `austritt` is `None` whether the
        # endpoint cleared it or never named it, so the case rests on the row going in without one.
        assert seeded is not None and seeded["austritt"] is None

        assert row is not None, "a gate refused the row this endpoint exists to repair"


class TestAClubThatHasPlayedIsNotReplaced:
    def test_a_played_fixture_refuses_it(self, mongo_replica_set_url: str):
        """`REQ-REPLACE-002` through the route, with the whole write rolled back."""

        code, row, spiele = on_a_seeded_season(
            mongo_replica_set_url,
            _refused,
            spiele=[gruppen_fixture(1, WITHDRAWN, RIVAL, ergebnis="2:1", tore=(2, 1)), gruppen_fixture(2, RIVAL, WITHDRAWN)],
        )

        assert code == REPLACE_OUTGOING_HAS_A_RECORD
        assert row is not None, "the junction row was handed over anyway"
        assert spiele[2]["team2"] == side(WITHDRAWN), "the fan-out ran before the refusal, or outside the transaction"

    def test_a_fixture_called_off_still_permits_it(self, mongo_replica_set_url: str):
        """Kills trusting `REQ-SWAP-002`/`-004`'s summaries: `ausgefallen` is "called off" and leaves NO record to rewrite."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_replace(database, client)
            return await row_of(database, INCOMING)

        row = on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=[gruppen_fixture(1, WITHDRAWN, RIVAL, sonderereignis="ausgefallen")],
        )

        assert row is not None

    def test_a_goal_count_with_no_result_refuses_it(self, mongo_replica_set_url: str):
        """The hand-edited shape. Kills a check reading `ergebnis` alone, which would hand another club somebody's goals."""

        code, row, _ = on_a_seeded_season(
            mongo_replica_set_url,
            _refused,
            spiele=[gruppen_fixture(1, WITHDRAWN, RIVAL, tore=(1, None))],
        )

        assert code == REPLACE_OUTGOING_HAS_A_RECORD
        assert row is not None


class TestTheSeasonGateOnTheRoute:
    def test_a_finished_season_refuses_it_and_writes_nothing(self, mongo_replica_set_url: str):
        """`REQ-REPLACE-001` through the route: a past season's fixtures are the record of who played."""

        code, row, spiele = on_a_seeded_season(mongo_replica_set_url, _refused, saison_status="past")

        assert code == REPLACE_SAISON_FINISHED
        assert row is not None
        assert spiele[1]["team1"] == side(WITHDRAWN)

    @pytest.mark.parametrize("saison_status", ["future", "active"])
    def test_a_planned_or_started_season_permits_it(self, mongo_replica_set_url: str, saison_status: str):
        """Kills borrowing D34's `future`-only window: a club withdraws from a season that has already started."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_replace(database, client)
            return await row_of(database, INCOMING)

        assert on_a_seeded_season(mongo_replica_set_url, body, saison_status=saison_status) is not None


class TestWhoMayArrive:
    def test_a_club_already_in_the_season_is_refused(self, mongo_replica_set_url: str):
        """`REQ-REPLACE-003`. Without it the write hits `uniq_saison_id_team_id` and answers a duplicate-key error instead."""

        code, row, _ = on_a_seeded_season(mongo_replica_set_url, lambda database, client: _refused(database, client, incoming=ENTERED))

        assert code == REPLACE_INCOMING_ALREADY_ENTERED
        assert row is not None

    def test_one_club_named_on_both_ends_is_refused(self, mongo_replica_set_url: str):
        """The same arm: the row being replaced is itself a row the incoming club holds."""

        code, _, _ = on_a_seeded_season(mongo_replica_set_url, lambda database, client: _refused(database, client, incoming=WITHDRAWN))

        assert code == REPLACE_INCOMING_ALREADY_ENTERED

    def test_a_club_that_left_the_league_is_refused(self, mongo_replica_set_url: str):
        """The entry gate's own code, because a replacement is one more way of bringing a club into a season."""

        code, _, _ = on_a_seeded_season(mongo_replica_set_url, lambda database, client: _refused(database, client, incoming=RETIRED))

        assert code == CLUB_RETIRED

    def test_an_id_naming_no_club_is_a_404(self, mongo_replica_set_url: str):
        """Kills pointing the row at a club that is not there -- which is the phantom this endpoint exists to repair."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentNotFoundException):
                await call_replace(database, client, incoming_team_id=ABSENT)
            return await row_of(database, WITHDRAWN)

        row = on_a_seeded_season(mongo_replica_set_url, body)

        assert row is not None, "the row was rewritten before the incoming club was resolved"


class TestWhatIsAddressed:
    def test_a_club_holding_no_row_in_the_season_is_a_404(self, mongo_replica_set_url: str):
        """A replacement addresses a junction row, not a club: `RETIRED` holds a `teams` document and no row here."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentNotFoundException):
                await call_replace(database, client, team_id=RETIRED)
            return await spiele_now(database)

        spiele = on_a_seeded_season(mongo_replica_set_url, body)

        assert spiele[1]["team1"] == side(WITHDRAWN)

    def test_an_unknown_season_is_a_404(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentNotFoundException):
                await call_replace(database, client, saison_id="1999")
            return await row_of(database, WITHDRAWN)

        assert on_a_seeded_season(mongo_replica_set_url, body) is not None
