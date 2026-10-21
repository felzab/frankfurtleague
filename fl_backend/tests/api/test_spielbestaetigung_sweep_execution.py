import logging
from collections import Counter
from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any, Literal, cast
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import ExecutionTimeout, OperationFailure

from app.api.bewerbungen.services import SWEEP_PAGE, days_after, hash_token
from app.api.schiedsrichter.services import compose_bestaetigung
from app.api.spielbestaetigungen.person_router import post_schiedsrichter_antwort
from app.api.spielbestaetigungen.router import post_spielbestaetigung
from app.api.spielbestaetigungen.schemas import (
    MITTEILUNGEN_PER_PASS,
    FLSpielbestaetigungAntwortPayload,
    FLSpielbestaetigungSchiedsrichterAntwortPayload,
    FLSpielbestaetigungSweepAngefragtPayload,
    FLSpielbestaetigungSweepMitgeteiltPayload,
    FLSpielbestaetigungSweepResponse,
    FLSpielbestaetigungTermin,
)
from app.api.spielbestaetigungen.services import (
    ANSETZUNG_BEANTWORTET,
    ANSETZUNG_GESCHLOSSEN,
    MITTEILUNG_VERSUCHE_HOECHSTENS,
    build_token_filter,
    compose_antwort_update,
    compose_closing_update,
    compose_spielbestaetigung,
    parteien_of,
    seat_holding,
)
from app.api.spielbestaetigungen.sweep_router import (
    CLOSES_PER_PASS,
    MINTS_PER_PASS,
    angefragt_spielbestaetigungen,
    get_spiel_sweep_saisons,
    mitgeteilt_spielbestaetigungen,
    sweep_spielbestaetigungen,
)
from app.api.spiele.admin_router import patch_spiel_data
from app.api.spiele.schemas import FLPatchSpielDataPayload
from app.api.spiele.services import ANSETZUNG_BESTAETIGT, build_spiele_pipeline
from app.api.teams.admin_router import patch_saison_team_kontakte, replace_saison_team
from app.api.teams.schemas import KONTAKT_ROLLEN, FLPatchSaisonTeamKontaktePayload, FLReplaceSaisonTeamPayload, kontakte_stand_of
from app.core.collections import Collection
from app.core.exception_handlers import DATABASE_FAILED, UNKNOWN_OUTCOME
from app.core.exceptions import WriteRefusalException
from app.core.logging import FL_LOGGER_NAME
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID
from app.core.transactions import UNKNOWN_COMMIT_RESULT
from app.shared.einwilligung import LAUFENDE_FASSUNGEN
from tests import documents
from tests.actor_tokens import FRESH_STEP_UP_CHECK
from tests.api import test_spielbestaetigung_sweep_refusal as budget
from tests.bans import ban_list
from tests.config import build_test_config
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import ban_document, kontaktperson_document
from tests.erasure import erased
from tests.isolation import InterleavedCollection
from tests.payloads import spiel_patch_body
from tests.records import record_collections
from tests.wire import commands_by_name, commands_sent
from tests.worker import worker_database

# Module level, as the other execution suites mark theirs: every test below reaches a real mongod.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spielbestaetigung_sweep_test")

SAISON_ID = "2026"
PAST_SAISON_ID = "2025"
TODAY = "2026-04-01"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
YESTERDAY = "2026-03-31"
NEXT_WEEK = "2026-04-08"

# Fixed rather than generated, so a failure names the same row every run.
ALPHA = ObjectId("6890a1b2c3d4e5f607750001")
BETA = ObjectId("6890a1b2c3d4e5f607750002")
# A club no season row names, so a fixture fielding it is one the pass cannot answer.
GAMMA = ObjectId("6890a1b2c3d4e5f607750003")
NAMES = {ALPHA: ("Alpha", "AL"), BETA: ("Beta", "BE"), GAMMA: ("Gamma", "GA")}
SPIELTAG = ObjectId("6890a1b2c3d4e5f6077500a1")
PAST_SPIELTAG = ObjectId("6890a1b2c3d4e5f6077500a2")
SPIELORT = ObjectId("6890a1b2c3d4e5f6077500b1")
SCHIEDSRICHTER = ObjectId("6890a1b2c3d4e5f6077500c1")
OTHER_SCHIEDSRICHTER = ObjectId("6890a1b2c3d4e5f6077500c2")
SPIEL = ObjectId("6890a1b2c3d4e5f6077500d1")
OTHER_SPIEL = ObjectId("6890a1b2c3d4e5f6077500d2")
PAST_SPIEL = ObjectId("6890a1b2c3d4e5f6077500d3")
TODAYS_SPIEL = ObjectId("6890a1b2c3d4e5f6077500d4")
FRESH_SPIEL = ObjectId("6890a1b2c3d4e5f6077500d5")

REFEREE_EMAIL = "pfeife@example.com"
OTHER_REFEREE_EMAIL = "flagge@example.com"

# One person per seat, each at an address of their own.
SEATS = {
    ALPHA: {"trainer": "Tamsin", "ansprechperson": "Anwen", "stellvertretung": "Stellan"},
    BETA: {"trainer": "Bertil", "ansprechperson": "Brigid", "stellvertretung": "Bodo"},
}


def kontakte(team_id: ObjectId, **overrides: Any) -> dict[str, Any]:
    return {**{seat: kontaktperson_document(vorname) for seat, vorname in SEATS[team_id].items()}, "trainer_ist_zugleich": None, **overrides}


def address(team_id: ObjectId, seat: str) -> str:
    return f"{SEATS[team_id][seat].lower()}@example.com"


def side(team_id: ObjectId, tore: int | None = None) -> dict[str, Any]:
    name, shorthand = NAMES[team_id]

    return {"team_id": team_id, "name": name, "shorthand": shorthand, "tore": tore}


def ort() -> dict[str, Any]:
    return {"spielort_id": SPIELORT, "name": "Sportpark", "maps_link": "Sportpark, Frankfurt", "mietpreis": 80}


def booked(schiedsrichter_id: ObjectId = SCHIEDSRICHTER) -> dict[str, Any]:
    return {"schiedsrichter_id": schiedsrichter_id, "name": None if schiedsrichter_id == GHOST_SCHIEDSRICHTER_ID else "Pfiff", "payment": 20}


def fixture(spiel_id: ObjectId, spiel_nr: int, datum: str | None, *, saison_id: str = SAISON_ID, **fields: Any) -> dict[str, Any]:
    """A fixture every condition of the mint holds for but its date, which each case picks."""

    return documents.spiel_document(
        spiel_id=spiel_id,
        saison_id=saison_id,
        spiel_nr=spiel_nr,
        spieltag_id=SPIELTAG if saison_id == SAISON_ID else PAST_SPIELTAG,
        **{
            "team1": side(ALPHA),
            "team2": side(BETA),
            "datum": datum,
            "uhrzeit": "18:00:00",
            "ort": ort(),
            "schiedsrichter": booked(),
            **fields,
        },
    )


def junction(team_id: ObjectId, *, saison_id: str = SAISON_ID, **fields: Any) -> dict[str, Any]:
    name, shorthand = NAMES[team_id]

    return documents.saison_team_document(saison_id, team_id, name, shorthand, **{"kontakte": kontakte(team_id), **fields})


def referee(schiedsrichter_id: ObjectId, email: str, name: str) -> dict[str, Any]:
    return documents.schiedsrichter_document(schiedsrichter_id, email=email, name=name, default_payment=20, einwilligung=None)


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, spiele: list[dict[str, Any]], junctions: list[dict[str, Any]] | None = None) -> Any:
    """The SHIPPED validators and indexes: a running season and a past one, two clubs, a ground and two referees."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.SAISONS].insert_many(
                [documents.saison_document(SAISON_ID, "active"), documents.saison_document(PAST_SAISON_ID, "past")]
            )
            await database[Collection.TEAMS].insert_many([documents.team_document(team_id, *NAMES[team_id]) for team_id in NAMES])
            await database[Collection.SAISON_TEAMS].insert_many(junctions if junctions is not None else [junction(ALPHA), junction(BETA)])
            await database[Collection.SPIELTAGE].insert_many(
                [
                    {
                        "_id": SPIELTAG,
                        "beginn": "2026-03-01",
                        "ende": "2026-06-30",
                        "position": 1,
                        "saison_id": SAISON_ID,
                        "saison_phase": "gruppenphase",
                    },
                    {
                        "_id": PAST_SPIELTAG,
                        "beginn": "2025-03-01",
                        "ende": "2025-06-30",
                        "position": 1,
                        "saison_id": PAST_SAISON_ID,
                        "saison_phase": "gruppenphase",
                    },
                ]
            )
            await database[Collection.SPIELORTE].insert_one(
                {
                    "_id": SPIELORT,
                    "name": "Sportpark",
                    "address": dict(documents.ADDRESS),
                    "maps_link": "Sportpark, Frankfurt",
                    "default_mietpreis": 80,
                    "inactive_since": None,
                }
            )
            await database[Collection.SCHIEDSRICHTER].insert_many(
                [referee(SCHIEDSRICHTER, REFEREE_EMAIL, "Pfiff"), referee(OTHER_SCHIEDSRICHTER, OTHER_REFEREE_EMAIL, "Flagge")]
            )
            if spiele:
                await database[Collection.SPIELE].insert_many(spiele)

            return await body(database, client)

    return on_the_seed_loop(_run())


async def sweep(
    database: AsyncDatabase, client: AsyncMongoClient, *, saison_id: str = SAISON_ID, today: str = TODAY, passed_over: int = 0
) -> FLSpielbestaetigungSweepResponse:
    """One pass, asserting how many rows it passed over: a pass refusing a fixture for an unrelated reason mints nothing either.

    So a case asserting that nothing was minted, closed or reminded holds only for the reason it names.
    """

    answer = await sweep_spielbestaetigungen(
        saison_id=saison_id,
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        spiele_collection=database[Collection.SPIELE],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        sperrliste=ban_list(database),
        db=client,
        today=today,
    )
    assert answer.fehlgeschlagen == passed_over, answer

    return answer


async def a_pass_through(database: AsyncDatabase, client: AsyncMongoClient, **collections: Any) -> FLSpielbestaetigungSweepResponse:
    """One pass, the collections named handed through a stand-in."""

    return await sweep_spielbestaetigungen(
        saison_id=SAISON_ID,
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        spiele_collection=database[Collection.SPIELE],
        saison_teams_collection=collections.get("saison_teams", database[Collection.SAISON_TEAMS]),
        saisons_collection=database[Collection.SAISONS],
        schiedsrichter_collection=collections.get("schiedsrichter", database[Collection.SCHIEDSRICHTER]),
        sperrliste=ban_list(database),
        db=client,
        today=TODAY,
    )


async def angefragt(
    database: AsyncDatabase, client: AsyncMongoClient, ids: list[Any], *, saison_id: str = SAISON_ID, today: str = TODAY
) -> Any:
    """The stamp, asserting it passed nothing over, for `sweep`'s reason."""

    answer = await angefragt_spielbestaetigungen(
        saison_id=saison_id,
        angefragt_data=FLSpielbestaetigungSweepAngefragtPayload(spielbestaetigung_ids=ids),
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        saisons_collection=database[Collection.SAISONS],
        db=client,
        today=today,
    )
    assert answer.fehlgeschlagen == 0, answer

    return answer


async def mitgeteilt(database: AsyncDatabase, client: AsyncMongoClient, ids: list[Any], *, saison_id: str = SAISON_ID) -> Any:
    """The notices' stamp, as the timer sends it once they went."""

    return await mitgeteilt_spielbestaetigungen(
        saison_id=saison_id,
        mitgeteilt_data=FLSpielbestaetigungSweepMitgeteiltPayload(spielbestaetigung_ids=ids),
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        saisons_collection=database[Collection.SAISONS],
        db=client,
    )


async def move(database: AsyncDatabase, client: AsyncMongoClient, spiel_id: ObjectId, **overrides: Any) -> None:
    """Through the administrator's own save, so the stand the pass compares is the one a real edit leaves."""

    stored = await database[Collection.SPIELE].find_one({"_id": spiel_id})
    assert stored is not None
    await patch_spiel_data(
        spiel_id=spiel_id,
        spiel_data=FLPatchSpielDataPayload.model_validate(spiel_patch_body(stored, **overrides)),
        db=client,
        spiele_collection=database[Collection.SPIELE],
        teams_collection=database[Collection.TEAMS],
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spieltage_collection=database[Collection.SPIELTAGE],
        spielorte_collection=database[Collection.SPIELORTE],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        spielberichte_collection=database[Collection.SPIELBERICHTE],
    )


async def antworten(database: AsyncDatabase, client: AsyncMongoClient, token: str) -> Any:
    """A club's Zusage through the link's own endpoint."""

    return await post_spielbestaetigung(
        antwort_data=FLSpielbestaetigungAntwortPayload(token=token, antwort="zugesagt", vorschlag=None, begruendung=None),
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        spiele_collection=database[Collection.SPIELE],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spieltage_collection=database[Collection.SPIELTAGE],
        sperrliste=ban_list(database),
        db=client,
        today=TODAY,
    )


async def refusal_of(database: AsyncDatabase, client: AsyncMongoClient, token: str) -> str | None:
    """The code a press of this link meets now, or `None` where it is taken."""

    try:
        await antworten(database, client, token)
    except WriteRefusalException as refusal:
        return refusal.error_code

    return None


async def rows(database: AsyncDatabase, **db_filter: Any) -> list[Mapping[str, Any]]:
    return await database[Collection.SPIELBESTAETIGUNGEN].find(db_filter).sort("_id", 1).to_list(length=None)


def row_of(stored: list[Mapping[str, Any]], *, team_id: Any = None, schiedsrichter_id: Any = None) -> Mapping[str, Any]:
    """The one row of a party; two would be the double mint a case is about."""

    found = [
        row
        for row in stored
        if (team_id is not None and row["partei"].get("team_id") == team_id)
        or (schiedsrichter_id is not None and row["partei"].get("schiedsrichter_id") == schiedsrichter_id)
    ]
    assert len(found) == 1, found
    return found[0]


class TestTheSweepAsksAboutNothingItCannotHelp:
    """Both halves driven: `has_taken_place` reads a record and never a date, and the copied listing reads every season."""

    def test_a_pass_asks_about_the_coming_fixture_alone(self, mongo_replica_set_url: str):
        """Today's fixture is the floor's edge; the past season's is dated inside the window, so only the season keeps it out."""

        spiele = [
            fixture(SPIEL, 1, NEXT_WEEK),
            fixture(OTHER_SPIEL, 2, YESTERDAY),
            fixture(TODAYS_SPIEL, 3, TODAY),
            fixture(PAST_SPIEL, 1, NEXT_WEEK, saison_id=PAST_SAISON_ID),
        ]
        # The past season's clubs seated too, so nothing but its status can keep its fixture unasked.
        junctions = [junction(team_id, saison_id=saison_id) for saison_id in (SAISON_ID, PAST_SAISON_ID) for team_id in (ALPHA, BETA)]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            listing = await get_spiel_sweep_saisons(saisons_collection=database[Collection.SAISONS])
            # As the timer runs it, and the past season asked directly as a mistyped call would.
            answers = [await sweep(database, client, saison_id=saison_id) for saison_id in [*listing.saison_ids, PAST_SAISON_ID]]

            return listing.saison_ids, answers, sorted({(row["saison_id"], str(row["spiel_id"])) for row in await rows(database)})

        listed, answers, asked = on_a_league(mongo_replica_set_url, body, spiele=spiele, junctions=junctions)

        assert listed == [SAISON_ID]
        assert len(answers) == 2
        assert asked == [(SAISON_ID, str(SPIEL))]

    def test_a_season_not_running_is_neither_closed_nor_reminded_nor_stamped(self, mongo_replica_set_url: str):
        """A mailed row due a reminder today, and one whose fixture moved: each step would answer one were the mint alone gated."""

        spiel = fixture(PAST_SPIEL, 1, days_after(day=TODAY, days=10), saison_id=PAST_SAISON_ID)
        mailed = [
            {
                **compose_spielbestaetigung(
                    row_id=ObjectId(),
                    saison_id=PAST_SAISON_ID,
                    spiel=asked_about,
                    partei={"art": "team", "team_id": team_id},
                    hashes={seat: hash_token(f"{team_id}-{seat}") for seat in KONTAKT_ROLLEN},
                    today=TODAY,
                ),
                "angefragt_am": TODAY,
            }
            for team_id, asked_about in ((ALPHA, spiel), (BETA, {**spiel, "uhrzeit": "17:00:00"}))
        ]
        junctions = [junction(team_id, saison_id=PAST_SAISON_ID) for team_id in (ALPHA, BETA)]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELBESTAETIGUNGEN].insert_many(mailed)
            answer = await sweep(database, client, saison_id=PAST_SAISON_ID)
            season = await database[Collection.SAISONS].find_one({"_id": PAST_SAISON_ID})

            return answer, await rows(database), (season or {}).get("spiel_sweep_gelaufen_am")

        answer, stored, stamped = on_a_league(mongo_replica_set_url, body, spiele=[spiel], junctions=junctions)

        assert (answer.anfragen, answer.erinnerungen, answer.einteilungen, answer.neue_ansetzungen, answer.geschlossen) == ([], [], [], [], 0)
        assert (stored, stamped) == (mailed, None)

    def test_the_same_pass_twice_mints_once(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await sweep(database, client)
            # Stamped as the timer stamps what it mailed: an unstamped request is asked again, which is no second mint.
            await angefragt(database, client, [row["_id"] for row in await rows(database)])
            second = await sweep(database, client)

            return first, second, await rows(database)

        first, second, stored = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        assert (len(first.anfragen), len(first.einteilungen)) == (2, 1)
        assert (second.anfragen, second.einteilungen) == ([], [])
        assert len(stored) == 3


class TestTheWindow:
    """A link lives at most its answer window, so a fixture is asked once its deadline is that window away and not before."""

    def test_a_fixture_twenty_one_days_out_is_asked_and_twenty_two_is_not(self, mongo_replica_set_url: str):
        spiele = [fixture(SPIEL, 1, days_after(day=TODAY, days=21)), fixture(OTHER_SPIEL, 2, days_after(day=TODAY, days=22))]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            return await rows(database)

        stored = on_a_league(mongo_replica_set_url, body, spiele=spiele)

        assert {row["spiel_id"] for row in stored} == {SPIEL}
        assert {row["frist"] for row in stored} == {days_after(day=TODAY, days=14)}

    def test_a_fixture_inside_the_notice_period_is_due_today(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            return await rows(database)

        stored = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, days_after(day=TODAY, days=3))])

        assert {row["frist"] for row in stored} == {TODAY}


class TestTheMintNeverAsksWhatTheCloseShuts:
    """Each fixture would be closed by the next pass, so a mint here is a fresh request every hour with nothing failing."""

    @pytest.mark.parametrize(
        ("spiel_fields", "austritt_tag"),
        [
            pytest.param({}, NEXT_WEEK, id="a club gone on the fixture's day"),
            pytest.param({}, YESTERDAY, id="a club gone before it"),
            pytest.param({"team1": side(ALPHA, 2)}, None, id="a lone goal count"),
            pytest.param({"elfmeterschiessen": {"team1": 4, "team2": 3}}, None, id="a lone shoot-out"),
        ],
    )
    def test_two_passes_mint_nothing(self, mongo_replica_set_url: str, spiel_fields: dict[str, Any], austritt_tag: str | None):
        austritt = None if austritt_tag is None else {"type": "rueckzug", "grund": "Schulwechsel", "datum": austritt_tag}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first, second = await sweep(database, client), await sweep(database, client)
            return first, second, await rows(database)

        first, second, stored = on_a_league(
            mongo_replica_set_url,
            body,
            spiele=[fixture(SPIEL, 1, NEXT_WEEK, **spiel_fields)],
            junctions=[junction(ALPHA, austritt=austritt), junction(BETA)],
        )

        assert (stored, first.anfragen, second.anfragen, first.geschlossen + second.geschlossen) == ([], [], [], 0)

    def test_a_club_gone_after_the_fixture_is_still_asked(self, mongo_replica_set_url: str):
        austritt = {"type": "rueckzug", "grund": "Schulwechsel", "datum": days_after(day=NEXT_WEEK, days=1)}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            return await rows(database)

        stored = on_a_league(
            mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)], junctions=[junction(ALPHA, austritt=austritt), junction(BETA)]
        )

        assert len(stored) == 3


class TestAFixtureCalledOffAndReinstatedIsAskedAgain:
    """The mint's test is an UNCLOSED row, so the closed rows of a called-off fixture never stand in for a fresh request."""

    def test_the_reinstated_fixture_at_the_same_slot_mints_afresh(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"sonderereignis": "ausgefallen"}})
            abgesagt = await sweep(database, client)
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"sonderereignis": None}})
            reinstated = await sweep(database, client)

            return abgesagt, reinstated, await rows(database)

        abgesagt, reinstated, stored = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        assert (abgesagt.geschlossen, abgesagt.anfragen) == (3, [])
        assert (len(reinstated.anfragen), len(reinstated.einteilungen)) == (2, 1)
        assert Counter((row["geschlossen"] or {}).get("grund") for row in stored) == {"abgesagt": 3, None: 3}


def answered(antwort: Literal["zugesagt", "abgelehnt"]) -> dict[str, Any]:
    """A seat's answer as its press stores it, a decline proposing the day after."""

    return compose_antwort_update(
        antwort=antwort,
        seat="trainer",
        adresse=None,
        schluessel=build_test_config().sperrliste_schluessel,
        vorschlag=FLSpielbestaetigungTermin(datum=days_after(day=NEXT_WEEK, days=1), uhrzeit="18:00:00") if antwort == "abgelehnt" else None,
        begruendung="Klassenfahrt" if antwort == "abgelehnt" else None,
        today=TODAY,
    )


async def discard(database: AsyncDatabase, team_id: ObjectId) -> None:
    """The discard's write as it closes the declining club's own row, its decline standing."""

    declined = {"$set": {**answered("abgelehnt")["$set"], **compose_closing_update(grund="verworfen", today=TODAY)["$set"]}}
    await database[Collection.SPIELBESTAETIGUNGEN].update_one({"partei.team_id": team_id}, declined)


async def verdict(database: AsyncDatabase) -> bool | None:
    cursor = await database[Collection.SPIELE].aggregate(build_spiele_pipeline(db_filter={"_id": SPIEL}))
    (document,) = await cursor.to_list()

    return document[ANSETZUNG_BESTAETIGT]


async def alphas_discard_beside_betas_agreement(database: AsyncDatabase, client: AsyncMongoClient) -> ObjectId:
    """Every row asked and mailed, so a notice the close owed would be answered; the discarded row's id."""

    await sweep(database, client)
    await angefragt(database, client, [row["_id"] for row in await rows(database)])
    await discard(database, ALPHA)
    await database[Collection.SPIELBESTAETIGUNGEN].update_one({"partei.team_id": BETA}, answered("zugesagt"))

    return row_of(await rows(database), team_id=ALPHA)["_id"]


class TestADiscardedDeclineIsNotAskedAgain:
    """`docs/backend/spec.md :: I768`: a club declines once per Ansetzung, so the decline the administrator discarded is its answer."""

    def test_the_declining_club_is_asked_nothing_until_the_fixture_moves(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await angefragt(database, client, [row["_id"] for row in await rows(database)])
            await discard(database, BETA)
            discarded = await sweep(database, client)
            await move(database, client, SPIEL, uhrzeit="19:00:00")
            moved = await sweep(database, client)

            return discarded, moved

        discarded, moved = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        assert (discarded.anfragen, discarded.einteilungen) == ([], [])
        assert sorted(anfrage.seite for anfrage in moved.anfragen) == ["team1", "team2"]


AUSTRITT_ON_THE_DAY = {"austritt": {"type": "rueckzug", "grund": "Schulwechsel", "datum": NEXT_WEEK}}


class TestADiscardEndsWhereAnAgreementBesideItEnds:
    """`docs/backend/spec.md :: I763`: the public verdict counts a discard as its club's agreement only while an agreement would count."""

    @pytest.mark.parametrize(
        ("saison_team", "spiel", "today", "grund"),
        [
            pytest.param(AUSTRITT_ON_THE_DAY, {}, TODAY, "austritt", id="the agreeing club gone by the day"),
            pytest.param({}, {"team1.tore": 2}, TODAY, "spiel_entschieden", id="decided"),
            pytest.param({}, {"sonderereignis": "ausgefallen"}, TODAY, "abgesagt", id="called off"),
            pytest.param({}, {}, days_after(day=NEXT_WEEK, days=1), "spiel_vergangen", id="its day gone by"),
        ],
    )
    def test_the_pass_closing_the_agreement_ends_the_discard_and_tells_nobody(
        self, mongo_replica_set_url: str, saison_team: dict[str, Any], spiel: dict[str, Any], today: str, grund: str
    ):
        """Kept, the discard alone would read the fixture provisional where two agreements read null; ended, it owes no notice."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await alphas_discard_beside_betas_agreement(database, client)
            if saison_team:
                await database[Collection.SAISON_TEAMS].update_one({"team_id": BETA, "saison_id": SAISON_ID}, {"$set": saison_team})
            if spiel:
                await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": spiel})
            before = await verdict(database)
            answer = await sweep(database, client, today=today)

            return before, answer, await verdict(database), await rows(database)

        before, answer, after, stored = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        assert (before, after) == (True, None)
        # Both clubs' rows and the referee's, the discard among them.
        assert (len(stored), {row["geschlossen"]["grund"] for row in stored}) == (3, {grund})
        # The referee's notice among them: a club's ended discard is neither a move nor a referee change.
        assert (answer.neue_ansetzungen, answer.schiedsrichter_neue_ansetzungen, answer.schiedsrichter_gewechselt) == ([], [], [])

    def test_a_discard_about_an_ansetzung_the_fixture_left_ends_once_its_day_has_passed(self, mongo_replica_set_url: str):
        """The move keeps it, the club's answer to that Ansetzung; kept past its day it would be read by every pass for good."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            discarded = await alphas_discard_beside_betas_agreement(database, client)
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"uhrzeit": "19:00:00"}})
            await sweep(database, client)
            kept = await database[Collection.SPIELBESTAETIGUNGEN].find_one({"_id": discarded})
            await sweep(database, client, today=days_after(day=NEXT_WEEK, days=1))
            ended = await database[Collection.SPIELBESTAETIGUNGEN].find_one({"_id": discarded})

            return kept, ended

        kept, ended = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        assert (kept["geschlossen"]["grund"], ended["geschlossen"]["grund"]) == ("verworfen", "spiel_vergangen")


class TestAMovedFixtureAsksAgain:
    """The close reaches an ANSWERED row, so a kept agreement records why it stopped applying."""

    def test_the_answered_row_closes_with_its_answer_and_the_new_stand_is_asked(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await sweep(database, client)
            await angefragt(
                database, client, [anfrage.spielbestaetigung_id for anfrage in first.anfragen] + [first.einteilungen[0].spielbestaetigung_id]
            )
            tokens = {anfrage.seite: anfrage.links[0].token for anfrage in first.anfragen}
            await antworten(database, client, tokens["team1"])
            answered = row_of(await rows(database), team_id=ALPHA)
            await move(database, client, SPIEL, uhrzeit="19:00:00")
            second = await sweep(database, client)
            refusals = [await refusal_of(database, client, tokens[seite]) for seite in ("team1", "team2")]

            return answered, second, await rows(database), refusals

        answered, second, stored, refusals = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        answered_id = answered["_id"]
        closed = [row for row in stored if row["geschlossen"] is not None]
        standing = [row for row in stored if row["geschlossen"] is None]
        assert answered_id in {row["_id"] for row in closed}
        assert [row["geschlossen"]["grund"] for row in closed] == ["ansetzung_geaendert"] * 3
        assert (answered["antwort"]["art"], answered["antwort"]["von"]["rolle"]) == ("zugesagt", "trainer")
        assert next(row for row in closed if row["_id"] == answered_id)["antwort"] == answered["antwort"]
        assert [row["antwort"] for row in closed if row["_id"] != answered_id] == [None, None]
        assert refusals == [ANSETZUNG_BEANTWORTET, ANSETZUNG_GESCHLOSSEN]
        assert {row["ansetzung"]["uhrzeit"] for row in standing} == {"19:00:00"}
        assert len(standing) == 3
        assert second.geschlossen == 3
        assert {notice.spielbestaetigung_id for notice in second.neue_ansetzungen} == {
            row["_id"] for row in closed if row["partei"]["art"] == "team"
        }
        assert [(notice.alt.uhrzeit, notice.address) for notice in second.schiedsrichter_neue_ansetzungen] == [("18:00:00", REFEREE_EMAIL)]
        alpha_notice = next(notice for notice in second.neue_ansetzungen if notice.spielbestaetigung_id == answered_id)
        assert sorted(empfaenger.address for empfaenger in alpha_notice.empfaenger) == sorted(address(ALPHA, seat) for seat in KONTAKT_ROLLEN)


class TestTheVoidNoticeGoesAheadOfTheFreshRequest:
    """`docs/backend/spec.md :: I769`: a full close share leaves a moved fixture's mailed rows open for one more pass."""

    def test_the_moved_fixture_is_asked_on_the_pass_that_announces_it(self, mongo_replica_set_url: str):
        decided = [
            fixture(ObjectId(f"6890a1b2c3d4e5f6077{position:05d}"), 10 + position, YESTERDAY, ergebnis="1:0")
            for position in range(CLOSES_PER_PASS)
        ]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await angefragt(database, client, [row["_id"] for row in await rows(database)])
            # Older than the moved fixture's, so the close's share takes them first.
            await database[Collection.SPIELBESTAETIGUNGEN].insert_many(
                [
                    compose_spielbestaetigung(
                        row_id=ObjectId(),
                        saison_id=SAISON_ID,
                        spiel=spiel,
                        partei={"art": "team", "team_id": ALPHA},
                        hashes={},
                        today=days_after(day=TODAY, days=-10),
                    )
                    for spiel in decided
                ]
            )
            await move(database, client, SPIEL, uhrzeit="19:00:00")

            return await sweep(database, client), await sweep(database, client)

        overflowed, announced = on_a_league(mongo_replica_set_url, body, spiele=[*decided, fixture(SPIEL, 1, NEXT_WEEK)])

        assert (overflowed.geschlossen, overflowed.neue_ansetzungen, overflowed.anfragen, overflowed.einteilungen) == (
            CLOSES_PER_PASS,
            [],
            [],
            [],
        )
        assert (len(announced.neue_ansetzungen), len(announced.schiedsrichter_neue_ansetzungen)) == (2, 1)
        assert (len(announced.anfragen), len(announced.einteilungen)) == (2, 1)


class TestAMoveIsAnnouncedOnlyToAPartyMailed:
    def test_an_unstamped_row_closed_by_a_move_is_no_notice(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await move(database, client, SPIEL, uhrzeit="19:00:00")
            return await sweep(database, client)

        second = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        assert (second.geschlossen, second.neue_ansetzungen, second.schiedsrichter_neue_ansetzungen) == (3, [], [])


class TestARefereeChangeClosesTheirRowAlone:
    def test_the_new_referee_is_told_and_the_old_one_is_not(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await angefragt(database, client, [row["_id"] for row in await rows(database)])
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"schiedsrichter": booked(OTHER_SCHIEDSRICHTER)}})
            return await sweep(database, client), await rows(database)

        second, stored = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        old = row_of(stored, schiedsrichter_id=SCHIEDSRICHTER)
        assert old["geschlossen"]["grund"] == "schiedsrichter_gewechselt"
        assert [einteilung.address for einteilung in second.einteilungen] == [OTHER_REFEREE_EMAIL]
        # The referee taken off is told so at their own address, about the slot they were booked for.
        assert [(notice.spielbestaetigung_id, notice.address, notice.alt.datum) for notice in second.schiedsrichter_gewechselt] == [
            (old["_id"], REFEREE_EMAIL, NEXT_WEEK)
        ]
        assert (second.schiedsrichter_neue_ansetzungen, second.anfragen, second.geschlossen) == ([], [], 1)


class TestAReplacedClubsRowsClose:
    """The club leaving takes its season row along, so a notice naming it off that row would hold every mailed row open for good."""

    def test_the_opponent_and_the_referee_are_told_and_every_row_closes(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await angefragt(database, client, [row["_id"] for row in await rows(database)])
            await replace_saison_team(
                team_id=ALPHA,
                saison_id=SAISON_ID,
                replacement_data=FLReplaceSaisonTeamPayload(incoming_team_id=GAMMA),
                teams_collection=database[Collection.TEAMS],
                saison_teams_collection=database[Collection.SAISON_TEAMS],
                saisons_collection=database[Collection.SAISONS],
                spiele_collection=database[Collection.SPIELE],
                saison_spieler_collection=database[Collection.SAISON_SPIELER],
                bewerbungen_collection=database[Collection.BEWERBUNGEN],
                aktionen_collection=database[Collection.AKTIONEN],
                spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
                db=client,
                today=TODAY,
                germany_now=NOW,
            )
            return await sweep(database, client), await rows(database)

        second, stored = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        closed = row_of([row for row in stored if row["geschlossen"] is not None], team_id=BETA)
        assert second.geschlossen == 3
        assert Counter(row["geschlossen"]["grund"] for row in stored if row["geschlossen"] is not None) == {"ansetzung_geaendert": 3}
        # The leaving club's people left with its row, so its own row closes telling nobody.
        assert [(notice.spielbestaetigung_id, notice.team1_name, notice.team2_name) for notice in second.neue_ansetzungen] == [
            (closed["_id"], "Gamma", "Beta")
        ]
        assert [(notice.team1_name, notice.address) for notice in second.schiedsrichter_neue_ansetzungen] == [("Gamma", REFEREE_EMAIL)]


class TestARowClosesOnceItsDayHasPassed:
    """`docs/backend/spec.md :: I749`: a fixture nobody entered a result for keeps no row open past its day."""

    def test_the_day_after_closes_every_row_answered_or_not_and_the_day_itself_none(self, mongo_replica_set_url: str):
        day_after = days_after(day=NEXT_WEEK, days=1)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await sweep(database, client)
            await angefragt(database, client, [row["_id"] for row in await rows(database)])
            await antworten(database, client, next(anfrage.links[0].token for anfrage in first.anfragen if anfrage.seite == "team1"))
            answered = row_of(await rows(database), team_id=ALPHA)

            return (
                answered,
                await sweep(database, client, today=NEXT_WEEK),
                await sweep(database, client, today=day_after),
                await rows(database),
            )

        answered, on_the_day, after, stored = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        assert on_the_day.geschlossen == 0
        assert after.geschlossen == 3
        assert [(row["geschlossen"]["am"], row["geschlossen"]["grund"]) for row in stored] == [(day_after, "spiel_vergangen")] * 3
        assert row_of(stored, team_id=ALPHA)["antwort"] == answered["antwort"]
        # A day gone by is no new Ansetzung: nobody is told it moved, nor asked again.
        assert (after.neue_ansetzungen, after.schiedsrichter_neue_ansetzungen, after.anfragen, after.einteilungen) == ([], [], [], [])


class TestAPageOfPastRowsStallsNoPass:
    """More unclosed rows of past days than the close's page reads: none closable, every pass would refuse at the page and mint nothing."""

    def test_the_close_takes_its_share_and_the_mint_still_asks(self, mongo_replica_set_url: str):
        # Two rows a fixture, the referee left off: one row past the page.
        past = numbered_fixtures(SWEEP_PAGE // 2 + 1, YESTERDAY)
        open_rows = [
            compose_spielbestaetigung(
                row_id=ObjectId(), saison_id=SAISON_ID, spiel=spiel, partei=partei, hashes={}, today=days_after(day=YESTERDAY, days=-10)
            )
            for spiel in past
            for partei in parteien_of(spiel)
        ]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELBESTAETIGUNGEN].insert_many(open_rows)
            return await sweep(database, client)

        answer = on_a_league(mongo_replica_set_url, body, spiele=[*past, fixture(SPIEL, 1, NEXT_WEEK)])

        assert len(open_rows) > SWEEP_PAGE
        assert answer.geschlossen == CLOSES_PER_PASS
        assert (len(answer.anfragen), len(answer.einteilungen)) == (2, 1)


class _ThenTheRival:
    """A cursor running the rival once its rows have arrived; `sort` and `limit` chain as the driver's do."""

    def __init__(self, cursor: Any, rival: Callable[[], Awaitable[None]]) -> None:
        self._cursor = cursor
        self._rival = rival

    def sort(self, *args: Any, **kwargs: Any) -> _ThenTheRival:
        self._cursor = self._cursor.sort(*args, **kwargs)
        return self

    def limit(self, *args: Any, **kwargs: Any) -> _ThenTheRival:
        self._cursor = self._cursor.limit(*args, **kwargs)
        return self

    async def to_list(self, *args: Any, **kwargs: Any) -> list[Any]:
        rows = await self._cursor.to_list(*args, **kwargs)
        await self._rival()

        return rows


class ThenTheRivalAfterTheFirstSessionRead(InterleavedCollection):
    """A collection running the rival once the pass's first in-transaction read of it has answered."""

    def find(self, *args: Any, **kwargs: Any) -> Any:
        cursor = self._collection.find(*args, **kwargs)
        if kwargs.get("session") is None:
            return cursor

        return _ThenTheRival(cursor, self.run_the_rival)


def a_payload_person(vorname: str, nachname: str, telefon: str) -> dict[str, Any]:
    """One person as the contacts editor sends them."""

    return {
        "vorname": vorname,
        "nachname": nachname,
        "email": f"{vorname.lower()}@example.com",
        "telefon": telefon,
        "einwilligung": {"umfang": "kontaktdaten", "text_version": LAUFENDE_FASSUNGEN["bewerbung"], "datum": "2026-03-01"},
    }


async def hand_alphas_trainer_to(database: AsyncDatabase, client: AsyncMongoClient, trainer: Mapping[str, Any]) -> None:
    """Through the contacts editor's own save, its other seats kept, so the void the pass meets is the one a real save writes."""

    stored = await database[Collection.SAISON_TEAMS].find_one({"saison_id": SAISON_ID, "team_id": ALPHA})
    assert stored is not None
    kept = {
        seat: a_payload_person(vorname, f"{vorname}-Mustermann", f"+491701000000{position}")
        for position, (seat, vorname) in enumerate(SEATS[ALPHA].items())
    }
    await patch_saison_team_kontakte(
        team_id=ALPHA,
        saison_id=SAISON_ID,
        kontakte_data=FLPatchSaisonTeamKontaktePayload.model_validate(
            {"kontakte": {**kept, "trainer": trainer, "trainer_ist_zugleich": None}, "kontakte_stand": kontakte_stand_of(stored["kontakte"])}
        ),
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        sperrliste=ban_list(database),
        adressanker_collection=database[Collection.ADRESSANKER],
        db=client,
        refuse_unconfirmed=FRESH_STEP_UP_CHECK,
        today=TODAY,
    )


class TestASeatHandedOnBesideTheMintIsMintedForItsNewHolder:
    """`docs/backend/spec.md :: I770`: the handover voids the open rows it sees, and the mint's rows are not yet among them."""

    def test_the_new_trainer_is_asked_and_the_old_one_holds_no_link(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def hand_the_trainer_on() -> None:
                await hand_alphas_trainer_to(database, client, a_payload_person("Lea", "Musterfrau", "+4917010000009"))

            interleaved = ThenTheRivalAfterTheFirstSessionRead(database[Collection.SAISON_TEAMS], hand_the_trainer_on)
            answer = await a_pass_through(database, client, saison_teams=cast(Any, interleaved))

            return interleaved, answer

        interleaved, answer = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        assert sorted(link.address for anfrage in answer.anfragen if anfrage.seite == "team1" for link in anfrage.links) == sorted(
            ["lea@example.com", address(ALPHA, "ansprechperson"), address(ALPHA, "stellvertretung")]
        )
        # A fresh league: the close reads no row, so the mint's read is the first the pass makes.
        interleaved.assert_landed_inside(serially=1)


class TestTheGhostIsAskedNothing:
    def test_a_fixture_booked_onto_the_ghost_mints_its_two_sides(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await sweep(database, client), await rows(database)

        answer, stored = on_a_league(
            mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK, schiedsrichter=booked(GHOST_SCHIEDSRICHTER_ID))]
        )

        assert ({row["partei"]["art"] for row in stored}, len(stored), answer.einteilungen) == ({"team"}, 2, [])


# Fourteen days out, so the deadline falls a week before the fixture and both reminders inside it.
FORTNIGHT = days_after(day=TODAY, days=14)
FRIST = days_after(day=FORTNIGHT, days=-7)
FIRST_REMINDER = days_after(day=FRIST, days=-3)
SECOND_REMINDER = days_after(day=FRIST, days=-1)


class TestEveryMailedLinkLivesToTheDeadline:
    """Each seat's request link and both reminders' still name the seat after the second reminder went."""

    def test_three_links_a_seat_each_find_the_row_and_the_seat(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            mailed: dict[str, list[str]] = {seat: [] for seat in KONTAKT_ROLLEN}
            answers = [await sweep(database, client)]
            await angefragt(database, client, [row["_id"] for row in await rows(database)])
            answers += [
                await sweep(database, client, today=day)
                for day in (FIRST_REMINDER, days_after(day=FIRST_REMINDER, days=1), SECOND_REMINDER, SECOND_REMINDER)
            ]
            for answer in answers:
                for anfrage in [*answer.anfragen, *answer.erinnerungen]:
                    if anfrage.seite == "team1":
                        for link in anfrage.links:
                            mailed[link.rollen[0]].append(link.token)

            collection = database[Collection.SPIELBESTAETIGUNGEN]
            resolved = {
                seat: [
                    seat_holding(spielbestaetigung_raw=found, token_hash=hash_token(token))
                    if (found := await collection.find_one(build_token_filter(token_hash=hash_token(token)))) is not None
                    else None
                    for token in tokens
                ]
                for seat, tokens in mailed.items()
            }
            return answers, resolved, row_of(await rows(database), team_id=ALPHA)

        answers, resolved, alpha = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, FORTNIGHT)])

        assert [len(answer.erinnerungen) for answer in answers] == [0, 2, 0, 2, 0]
        assert resolved == {seat: [seat, seat, seat] for seat in KONTAKT_ROLLEN}
        assert alpha["erinnert_am"] == [FIRST_REMINDER, SECOND_REMINDER]
        assert alpha["frist"] == FRIST


class TestAReminderOfARequestNeverStampedIsARequest:
    """A first request the timer never recorded as sent may never have arrived, so its reminder goes out worded as the request."""

    def test_the_unstamped_side_is_asked_and_the_stamped_one_reminded(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            stored = await rows(database)
            await angefragt(database, client, [row_of(stored, team_id=ALPHA)["_id"]])
            answer = await sweep(database, client, today=FIRST_REMINDER)
            stamped = await angefragt(database, client, [anfrage.spielbestaetigung_id for anfrage in answer.anfragen], today=FIRST_REMINDER)
            return stored, answer, stamped

        stored, answer, stamped = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, FORTNIGHT, schiedsrichter=None)])

        assert [anfrage.spielbestaetigung_id for anfrage in answer.erinnerungen] == [row_of(stored, team_id=ALPHA)["_id"]]
        assert [anfrage.spielbestaetigung_id for anfrage in answer.anfragen] == [row_of(stored, team_id=BETA)["_id"]]
        assert stamped.angefragt == 1


class TestAPassListsNoMoreThanOneStampTakes:
    """The timer stamps a pass's requests in one `/angefragt` call: a list past its bound is refused whole, every row left unstamped."""

    def test_a_window_fuller_than_the_share_is_asked_over_two_passes_each_stamped_whole(self, mongo_replica_set_url: str):
        spiele = [fixture(ObjectId(f"6890a1b2c3d4e5f6079{position:05d}"), 200 + position, NEXT_WEEK) for position in range(14)]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            listed: list[tuple[int, int]] = []
            for _ in range(2):
                answer = await sweep(database, client)
                ids = [entry.spielbestaetigung_id for entry in [*answer.anfragen, *answer.einteilungen]]
                listed.append((len(ids), (await angefragt(database, client, ids)).angefragt))
            return listed

        listed = on_a_league(mongo_replica_set_url, body, spiele=spiele)

        # Whole fixtures of three rows each, so the first pass takes the share's last whole fixture.
        first = MINTS_PER_PASS - MINTS_PER_PASS % 3
        assert listed == [(first, first), (42 - first, 42 - first)]


class TestABarredSeatIsMintedNothingAndStaysDue:
    """Nothing of a ban is stored, so the lift is what mints the seat."""

    def test_the_seat_is_minted_once_the_ban_is_lifted(self, mongo_replica_set_url: str):
        barred = address(ALPHA, "stellvertretung")

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            ban = ban_document(barred, bis=SAISON_ID)
            await database[Collection.SPERRLISTE].insert_one(ban)
            first = await sweep(database, client)
            # Stamped as mailed, so the second pass is about the barred seat alone and not a request asked again.
            await angefragt(database, client, [anfrage.spielbestaetigung_id for anfrage in first.anfragen])
            after_first = row_of(await rows(database), team_id=ALPHA)
            second = await sweep(database, client)
            after_second = row_of(await rows(database), team_id=ALPHA)
            await database[Collection.SPERRLISTE].delete_one({"_id": ban["_id"]})
            lifted = await sweep(database, client)

            return first, after_first, second, after_second, lifted, row_of(await rows(database), team_id=ALPHA)

        first, after_first, second, after_second, lifted, after_lift = on_a_league(
            mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)]
        )

        alpha_links = [link for anfrage in first.anfragen if anfrage.seite == "team1" for link in anfrage.links]
        assert sorted(link.address for link in alpha_links) == sorted([address(ALPHA, "trainer"), address(ALPHA, "ansprechperson")])
        assert after_first["kontakte"]["stellvertretung"] is None
        assert (second.anfragen, after_second) == ([], after_first)
        assert [(anfrage.spielbestaetigung_id, [link.address for link in anfrage.links]) for anfrage in lifted.anfragen] == [
            (after_first["_id"], [barred])
        ]
        assert len(after_lift["kontakte"]["stellvertretung"]["token_hashes"]) == 1


class TestAMirroredPairIsOneLink:
    def test_a_person_on_two_seats_gets_one_link_naming_both(self, mongo_replica_set_url: str):
        mirrored = kontakte(ALPHA, ansprechperson=kontaktperson_document("Tamsin"), trainer_ist_zugleich="ansprechperson")

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await sweep(database, client), row_of(await rows(database), team_id=ALPHA)

        answer, alpha = on_a_league(
            mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)], junctions=[junction(ALPHA, kontakte=mirrored), junction(BETA)]
        )

        links = next(anfrage.links for anfrage in answer.anfragen if anfrage.seite == "team1")
        assert [link.rollen for link in links] == [["trainer", "ansprechperson"], ["stellvertretung"]]
        assert alpha["kontakte"]["trainer"]["token_hashes"] == alpha["kontakte"]["ansprechperson"]["token_hashes"]


class TestTheReminderSkipsARowTheCloseWouldShut:
    """A full close share ahead of it leaves a decided fixture's row standing for one more pass; a reminder to it would be a dead link."""

    def test_a_row_past_the_close_share_is_not_reminded(self, mongo_replica_set_url: str):
        # Due a reminder today, on a fixture already decided: the close reaches it on the pass after.
        datum = days_after(day=TODAY, days=10)
        decided = [
            fixture(ObjectId(f"6890a1b2c3d4e5f6077{position:05d}"), 10 + position, YESTERDAY, ergebnis="1:0")
            for position in range(CLOSES_PER_PASS)
        ]
        reminded_spiel = fixture(SPIEL, 1, datum, ergebnis="1:0", team1=side(ALPHA, 1), team2=side(BETA, 0))

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            # The rows the mint wrote once these fixtures were still open, on the day each was minted and mailed: a
            # reminder of a request never stamped would be answered in `anfragen` instead.
            seeded = [
                {
                    **compose_spielbestaetigung(
                        row_id=ObjectId(),
                        saison_id=SAISON_ID,
                        spiel=spiel,
                        partei={"art": "team", "team_id": ALPHA},
                        hashes={seat: hash_token(f"{spiel['_id']}-{seat}") for seat in KONTAKT_ROLLEN},
                        today=days_after(day=TODAY, days=-10),
                    ),
                    "angefragt_am": days_after(day=TODAY, days=-10),
                }
                for spiel in [*decided, reminded_spiel]
            ]
            await database[Collection.SPIELBESTAETIGUNGEN].insert_many(seeded)
            answer = await sweep(database, client)

            return answer, row_of(await rows(database, spiel_id=SPIEL), team_id=ALPHA)

        answer, standing = on_a_league(mongo_replica_set_url, body, spiele=[*decided, reminded_spiel])

        assert standing["frist"] == days_after(day=TODAY, days=3)
        assert (answer.geschlossen, standing["geschlossen"]) == (CLOSES_PER_PASS, None)
        assert (answer.erinnerungen, answer.anfragen, standing["erinnert_am"]) == ([], [], [])


class TestTheRequestStamp:
    """`/angefragt` records that a request went out, whatever became of its row since: a moved fixture's notice is owed on that."""

    def test_a_row_answered_before_its_stamp_is_stamped_and_its_move_announced(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await sweep(database, client)
            alpha = row_of(await rows(database), team_id=ALPHA)
            await antworten(database, client, next(anfrage.links[0].token for anfrage in first.anfragen if anfrage.seite == "team1"))
            stamped = await angefragt(database, client, [alpha["_id"]])
            await move(database, client, SPIEL, uhrzeit="19:00:00")
            return alpha["_id"], stamped, await sweep(database, client)

        alpha_id, stamped, moved = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        assert (stamped.angefragt, stamped.fehlgeschlagen) == (1, 0)
        assert [notice.spielbestaetigung_id for notice in moved.neue_ansetzungen] == [alpha_id]

    def test_a_row_closed_before_its_stamp_is_stamped(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            ids = [row["_id"] for row in await rows(database)]
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"sonderereignis": "ausgefallen"}})
            await sweep(database, client)
            return await angefragt(database, client, ids), {row["angefragt_am"] for row in await rows(database, _id={"$in": ids})}

        stamped, days = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        assert (stamped.angefragt, days) == (3, {TODAY})

    def test_a_stamp_keeps_its_day_and_another_seasons_row_is_skipped(self, mongo_replica_set_url: str):
        foreign = compose_spielbestaetigung(
            row_id=ObjectId(),
            saison_id=PAST_SAISON_ID,
            spiel=fixture(PAST_SPIEL, 1, NEXT_WEEK),
            partei={"art": "team", "team_id": ALPHA},
            hashes={},
            today=TODAY,
        )

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            ids = [row["_id"] for row in await rows(database)]
            await database[Collection.SPIELBESTAETIGUNGEN].insert_one(foreign)
            first = await angefragt(database, client, ids[:1])
            again = await angefragt(database, client, [*ids, foreign["_id"]], today=days_after(day=TODAY, days=1))
            return first, again, {row["_id"]: row["angefragt_am"] for row in await rows(database)}

        first, again, days = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        assert (first.angefragt, again.angefragt) == (1, 2)
        assert sorted(day for day in days.values() if day is not None) == [TODAY, *[days_after(day=TODAY, days=1)] * 2]
        assert days[foreign["_id"]] is None


async def a_pass_owing_every_message(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    """Seeds the pass on `FIRST_REMINDER` to answer every list: a moved fixture's notices and fresh rows, and a reminder."""

    await sweep(database, client, today=days_after(day=FIRST_REMINDER, days=-1))
    await angefragt(database, client, [row["_id"] for row in await rows(database)])
    await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"uhrzeit": "19:00:00"}})


def a_held_notice(
    spiel: Mapping[str, Any], *, partei: Mapping[str, Any] | None = None, grund: Any = "ansetzung_geaendert", versuche: int = 0
) -> dict[str, Any]:
    """A row an earlier pass closed, mailed the day before and still holding its notice, about a slot the fixture has left."""

    row = {
        **compose_spielbestaetigung(
            row_id=ObjectId(),
            saison_id=SAISON_ID,
            spiel={**spiel, "uhrzeit": "16:00:00"},
            partei=partei or {"art": "team", "team_id": ALPHA},
            hashes={},
            today=YESTERDAY,
        ),
        "angefragt_am": YESTERDAY,
        **compose_closing_update(grund=grund, today=YESTERDAY, mitteilung=True)["$set"],
    }
    row["geschlossen"]["mitteilung"]["versuche"] = versuche

    return row


def a_spent_notice(spiel: Mapping[str, Any]) -> dict[str, Any]:
    """Handed out as often as the cap allows, so the next pass gives it up."""

    return a_held_notice(spiel, versuche=MITTEILUNG_VERSUCHE_HOECHSTENS)


EVERY_MESSAGE = [fixture(SPIEL, 1, NEXT_WEEK), fixture(OTHER_SPIEL, 2, FORTNIGHT, schiedsrichter=None)]


# Every first name a seat of either club holds.
NAMED = [vorname for seated in SEATS.values() for vorname in seated.values()]


class TestWhatThePassAnswers:
    """`READ-ANSETZUNG-002`: a message's raw link and its mailbox, and nobody's name nor any stored hash."""

    def test_no_name_and_no_hash_reaches_the_answer(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_pass_owing_every_message(database, client)
            answer = await sweep(database, client, today=FIRST_REMINDER)
            stored = [entry for row in await rows(database) for entry in (row["kontakte"] or {}).values() if entry is not None]

            return answer, {token_hash for entry in stored for token_hash in entry["token_hashes"]}

        answer, hashes = on_a_league(mongo_replica_set_url, body, spiele=EVERY_MESSAGE)
        served = answer.model_dump_json()
        tokens = [link.token for anfrage in [*answer.anfragen, *answer.erinnerungen] for link in anfrage.links]

        assert all([answer.anfragen, answer.erinnerungen, answer.einteilungen, answer.neue_ansetzungen, answer.schiedsrichter_neue_ansetzungen])
        # Capitalised as the seat and the referee hold them, where a mailbox spells a first name in lower case.
        assert [name for name in [*NAMED, "Mustermann", "Pfiff", "Flagge"] if name in served] == []
        assert [token_hash for token_hash in hashes if token_hash in served] == []
        assert {hash_token(token) for token in tokens} <= hashes


class _Refusing:
    """A collection whose one named operation raises where `refused` holds of its keyword arguments, every other call delegated."""

    def __init__(self, collection: Any, operation: str, refused: Callable[[Mapping[str, Any]], bool], failure: Callable[[], Exception]) -> None:
        self._collection = collection
        self._operation = operation
        self._refused = refused
        self._failure = failure

    def __getattr__(self, name: str) -> Any:
        attribute = getattr(self._collection, name)
        if name != self._operation:
            return attribute

        def guarded(*args: Any, **kwargs: Any) -> Any:
            if self._refused(kwargs):
                raise self._failure()
            return attribute(*args, **kwargs)

        return guarded


def the_mints_read(sent: Mapping[str, Any]) -> bool:
    return "$gt" in (sent.get("filter") or {}).get("datum", {})


def a_deadline() -> Exception:
    return ExecutionTimeout("operation exceeded time limit")


def a_commit_unanswered() -> Exception:
    """What `with_transaction` raises once a commit's answer is lost, which no halving can carry either."""

    return ExecutionTimeout("operation exceeded time limit", 50, {"ok": 0, "code": 50, "errorLabels": [UNKNOWN_COMMIT_RESULT]})


async def a_pass_failing(database: AsyncDatabase, client: AsyncMongoClient, **collections: Any) -> tuple[Any, Any]:
    """The pass on `FIRST_REMINDER` owing every message, `collections` standing in for the database's own; and the season's day."""

    await a_pass_owing_every_message(database, client)
    answer = await sweep_spielbestaetigungen(
        saison_id=SAISON_ID,
        spielbestaetigungen_collection=collections.get("spielbestaetigungen", database[Collection.SPIELBESTAETIGUNGEN]),
        spiele_collection=collections.get("spiele", database[Collection.SPIELE]),
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=collections.get("saisons", database[Collection.SAISONS]),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        sperrliste=ban_list(database),
        db=client,
        today=FIRST_REMINDER,
    )

    return answer, (await database[Collection.SAISONS].find_one({"_id": SAISON_ID}) or {}).get("spiel_sweep_gelaufen_am")


def warnings_of(caplog: pytest.LogCaptureFixture) -> list[tuple[Any, str]]:
    return [(getattr(record, "error_code", None), record.getMessage()) for record in caplog.records if record.levelname == "WARNING"]


class TestALaterStepFailingAnswersWhatCommitted:
    """`docs/backend/spec.md :: I753`: the close's notices committed, so a later step's failure is no error."""

    def test_the_notices_are_answered_and_the_day_is_not_stamped(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await a_pass_failing(database, client, spiele=_Refusing(database[Collection.SPIELE], "find", the_mints_read, a_deadline))

        with caplog.at_level(logging.WARNING):
            answer, stamped = on_a_league(mongo_replica_set_url, body, spiele=EVERY_MESSAGE)

        assert (len(answer.neue_ansetzungen), answer.anfragen, answer.erinnerungen) == (2, [], [])
        assert stamped == days_after(day=FIRST_REMINDER, days=-1)
        assert [code for code, _ in warnings_of(caplog)] == [DATABASE_FAILED]

    def test_a_commit_whose_answer_was_lost_names_what_may_stand(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """The mint's rows may stand holding links nobody was mailed: logged as an unknown outcome, never as an ordinary failure."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            rows_written = _Refusing(database[Collection.SPIELBESTAETIGUNGEN], "insert_many", lambda _: True, a_commit_unanswered)
            return await a_pass_failing(database, client, spielbestaetigungen=rows_written)

        with caplog.at_level(logging.WARNING):
            answer, _ = on_a_league(mongo_replica_set_url, body, spiele=EVERY_MESSAGE)

        assert (len(answer.neue_ansetzungen), answer.anfragen) == (2, [])
        assert warnings_of(caplog) == [
            (
                UNKNOWN_OUTCOME,
                f"The mint clock's commit went unanswered after the call committed messages it owes: the rows minted for fixture(s) {SPIEL} "
                "may have been written with nobody told, the call answers what else committed, and the rest stay due",
            )
        ]

    def test_the_runs_stamp_failing_alone_answers_the_notices(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """Every reminder refused, so the day is stamped in a transaction of its own after the notices and requests committed."""

        def a_refusal() -> Exception:
            return OperationFailure("refused", code=2)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await a_pass_failing(
                database,
                client,
                spielbestaetigungen=_Refusing(
                    database[Collection.SPIELBESTAETIGUNGEN], "find_one_and_update", lambda sent: "$push" in sent["update"], a_refusal
                ),
                saisons=_Refusing(database[Collection.SAISONS], "update_many", lambda _: True, a_refusal),
            )

        with caplog.at_level(logging.WARNING):
            answer, stamped = on_a_league(mongo_replica_set_url, body, spiele=EVERY_MESSAGE)

        assert (len(answer.neue_ansetzungen), len(answer.anfragen), answer.erinnerungen, answer.fehlgeschlagen) == (2, 2, [], 2)
        assert stamped == days_after(day=FIRST_REMINDER, days=-1)
        assert [message.split(" (")[0] for _, message in warnings_of(caplog)] == ["The run stamp clock stopped at a failure"]


class TestOneRowHoldsBackNoOther:
    """`docs/backend/spec.md :: I720`: a fixture the pass cannot answer is passed over alone, every pass, and its neighbour is asked."""

    def test_a_fixture_fielding_a_club_without_a_season_row(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client, passed_over=1)
            await sweep(database, client, passed_over=1)
            return await rows(database)

        stored = on_a_league(
            mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK, team2=side(GAMMA)), fixture(OTHER_SPIEL, 2, NEXT_WEEK)]
        )

        assert {row["spiel_id"] for row in stored} == {OTHER_SPIEL}


class TestThePassRecordsTheDayItRan:
    def test_the_listing_answers_the_newest_day_among_the_running_seasons(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await get_spiel_sweep_saisons(saisons_collection=database[Collection.SAISONS])
            await sweep(database, client)
            await sweep(database, client)
            after = await get_spiel_sweep_saisons(saisons_collection=database[Collection.SAISONS])
            stamps = await database[Collection.AKTIONEN].count_documents({"collection": str(Collection.SAISONS)})
            return before.spiel_sweep_gelaufen_am, after.spiel_sweep_gelaufen_am, stamps

        assert on_a_league(mongo_replica_set_url, body, spiele=[]) == (None, TODAY, 1)


# Under the driver's first batch, so a page read is one command however many rows it holds.
FEW = 6


def numbered_fixtures(count: int, datum: str, **fields: Any) -> list[dict[str, Any]]:
    """One fixture per position, the referee left off so each fixture's rows are its two sides' alone."""

    return [
        fixture(ObjectId(f"6890a1b2c3d4e5f6078{position:05d}"), 100 + position, datum, schiedsrichter=None, **fields)
        for position in range(count)
    ]


async def _counted(url: str, database: AsyncDatabase, call: Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]) -> int:
    # Stamped already, so the run's own stamp changes nothing in either run.
    await database[Collection.SAISONS].update_many({}, {"$set": {"spiel_sweep_gelaufen_am": TODAY}})

    return await commands_sent(url, DATABASE_NAME, call)


class TestEachPerRowLoopCostsTheRoundTripsItsShareIsSizedAt:
    """Counted on the wire, two runs apart by `FEW` rows: a second write a row, or `AFTER` at a call site, turns a case red."""

    def _twice(
        self,
        url: str,
        seed: Callable[[AsyncDatabase, AsyncMongoClient, int], Awaitable[Any]],
        call: Body,
        junctions: list[dict[str, Any]] | None = None,
    ) -> tuple[int, int]:
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[int, int]:
            async def counted(due: int) -> int:
                for collection in (Collection.SPIELE, Collection.SPIELBESTAETIGUNGEN, Collection.AKTIONEN):
                    await database[collection].delete_many({})
                await seed(database, client, due)
                return await _counted(url, database, call)

            return await counted(FEW), await counted(2 * FEW)

        return on_a_league(url, body, spiele=[], junctions=junctions)

    def test_a_closed_row(self, mongo_replica_set_url: str):
        async def seed(database: AsyncDatabase, client: AsyncMongoClient, due: int) -> None:
            await database[Collection.SPIELE].insert_many(numbered_fixtures(due, NEXT_WEEK))
            await sweep(database, client)
            # One side's rows closed by the pass counted: the other side stays open.
            await database[Collection.SPIELBESTAETIGUNGEN].delete_many({"partei.team_id": BETA})
            await database[Collection.SPIELE].update_many({}, {"$set": {"ergebnis": "1:0", "team1": side(ALPHA, 1), "team2": side(BETA, 0)}})

        few, twice = self._twice(mongo_replica_set_url, seed, sweep)

        assert (twice - few) / FEW == budget.ROUND_TRIPS_A_ROW

    def test_a_seat_minted_afresh(self, mongo_replica_set_url: str):
        async def seed(database: AsyncDatabase, client: AsyncMongoClient, due: int) -> None:
            await database[Collection.SPIELE].insert_many(numbered_fixtures(due, NEXT_WEEK))
            await sweep(database, client)
            await angefragt(database, client, [row["_id"] for row in await rows(database)])
            # The seat a write voided, on one side of each fixture.
            await database[Collection.SPIELBESTAETIGUNGEN].update_many({"partei.team_id": ALPHA}, {"$set": {"kontakte.trainer": None}})

        few, twice = self._twice(mongo_replica_set_url, seed, sweep)

        assert (twice - few) / FEW == budget.ROUND_TRIPS_A_ROW

    def test_a_minted_row_costs_its_call_nothing_more(self, mongo_replica_set_url: str):
        """One `insert_many` takes every row of the share, so a row of its own costs no command."""

        async def seed(database: AsyncDatabase, client: AsyncMongoClient, due: int) -> None:
            await database[Collection.SPIELE].insert_many(numbered_fixtures(due, NEXT_WEEK))

        few, twice = self._twice(mongo_replica_set_url, seed, sweep)

        assert twice == few

    def test_a_reminded_row(self, mongo_replica_set_url: str):
        async def seed(database: AsyncDatabase, client: AsyncMongoClient, due: int) -> None:
            await database[Collection.SPIELE].insert_many(numbered_fixtures(due, FORTNIGHT))
            await sweep(database, client)

        # One side reachable, so a fixture is one reminded row: the other's row holds no link to remind.
        few, twice = self._twice(
            mongo_replica_set_url,
            seed,
            lambda database, client: sweep(database, client, today=FIRST_REMINDER),
            junctions=[junction(ALPHA), junction(BETA, kontakte=None)],
        )

        assert (twice - few) / FEW == budget.ROUND_TRIPS_A_ROW

    def test_a_stamped_request(self, mongo_replica_set_url: str):
        stamped: list[Any] = []

        async def seed(database: AsyncDatabase, client: AsyncMongoClient, due: int) -> None:
            await database[Collection.SPIELE].insert_many(numbered_fixtures(due, NEXT_WEEK))
            await sweep(database, client)
            stamped[:] = [row["_id"] for row in await rows(database, **{"partei.team_id": ALPHA})]

        few, twice = self._twice(mongo_replica_set_url, seed, lambda database, client: angefragt(database, client, list(stamped)))

        assert (twice - few) / FEW == budget.ROUND_TRIPS_A_ROW


class TestTheWorstCallSendsTheCommandsItsBudgetCounts:
    """`tests/api/test_spielbestaetigung_sweep_refusal.py`'s budget: its rows at the per-row cost and the rest as it names them.

    A command added to either call turns its case red, so the shares are judged against the deadline again.
    """

    def test_the_sweep(self, mongo_replica_set_url: str):
        """Every step takes rows and every conditional read and write is made.

        Three notices owed and one given up, a fresh row, a seat minted afresh beside its row's reminder, a reminder, an
        Einteilung told again, the day's first stamp.
        """

        moved = fixture(SPIEL, 1, NEXT_WEEK)
        reminded = fixture(OTHER_SPIEL, 2, FORTNIGHT)
        fresh = fixture(FRESH_SPIEL, 3, NEXT_WEEK)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[Any, Counter[str]]:
            await database[Collection.SPIELE].insert_many([moved, reminded])
            await a_pass_owing_every_message(database, client)
            confirmations = database[Collection.SPIELBESTAETIGUNGEN]
            await confirmations.update_one({"spiel_id": OTHER_SPIEL, "partei.team_id": ALPHA}, {"$set": {"kontakte.trainer": None}})
            await confirmations.update_one({"spiel_id": OTHER_SPIEL, "partei.art": "schiedsrichter"}, {"$set": {"angefragt_am": None}})
            await confirmations.insert_one(a_spent_notice(moved))
            await database[Collection.SPIELE].insert_one(fresh)
            await database[Collection.AKTIONEN].delete_many({})

            return await commands_by_name(
                mongo_replica_set_url, DATABASE_NAME, lambda database, client: sweep(database, client, today=FIRST_REMINDER)
            )

        answer, names = on_a_league(mongo_replica_set_url, body, spiele=[])

        # The close's three rows, the two reminded rows, the afresh seat's own write; the Einteilung asked again writes no row.
        patched = answer.geschlossen + len(answer.erinnerungen) + 1
        assert (
            answer.geschlossen,
            len(answer.neue_ansetzungen),
            len(answer.schiedsrichter_neue_ansetzungen),
            len(answer.erinnerungen),
            sorted(einteilung.spiel_id for einteilung in answer.einteilungen),
        ) == (3, 2, 1, 2, sorted([SPIEL, OTHER_SPIEL, FRESH_SPIEL]))
        assert answer.mitteilungen_aufgegeben == 1
        assert sum(names.values()) - budget.ROUND_TRIPS_A_ROW * patched == budget.SWEEP_OTHER_COMMANDS, names

    def test_angefragt(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[Any, Counter[str]]:
            await database[Collection.SPIELE].insert_many(numbered_fixtures(FEW, NEXT_WEEK))
            await sweep(database, client)
            ids = [row["_id"] for row in await rows(database)]
            return await commands_by_name(mongo_replica_set_url, DATABASE_NAME, lambda database, client: angefragt(database, client, ids))

        answer, names = on_a_league(mongo_replica_set_url, body, spiele=[])

        assert answer.angefragt == 2 * FEW
        assert sum(names.values()) - budget.ROUND_TRIPS_A_ROW * 2 * FEW == budget.ANGEFRAGT_OTHER_COMMANDS, names


# The server's first batch for a cursor naming no size: one row more takes a read a `getMore`.
FIRST_BATCH = 101


class TestEverySeasonSizedReadSendsOneGetMore:
    """`tests/api/test_spielbestaetigung_sweep_refusal.py :: SWEEP_GET_MORES`, every season-sized population past the first batch.

    Fixtures moved since their rows were mailed, each with its own clubs and referee, due a reminder, a seat of each club
    barred; and lone unstamped referee rows.
    """

    def test_one_get_more_a_read(self, mongo_replica_set_url: str):
        # The close shuts some fixtures' rows and the mint asks them afresh, neither of which the day's reminders then read:
        # past the first batch by more than the close's share, so the reminders' own reads stay past it too.
        count = FIRST_BATCH + 1 + CLOSES_PER_PASS
        datum = days_after(day=TODAY, days=10)
        unstamped = FIRST_BATCH + 1

        def club(position: int) -> ObjectId:
            return ObjectId(f"6890a1b2c3d4e5f6071{position:05d}")

        def club_side(position: int) -> dict[str, Any]:
            return {"team_id": club(position), "name": f"Verein {position}", "shorthand": "VE", "tore": None}

        def seats(position: int) -> dict[str, Any]:
            return {
                **{seat: kontaktperson_document(f"Sitz{position}x{index}") for index, seat in enumerate(KONTAKT_ROLLEN)},
                "trainer_ist_zugleich": None,
            }

        referees = [ObjectId(f"6890a1b2c3d4e5f6072{position:05d}") for position in range(count + unstamped)]
        spiele = [
            fixture(
                ObjectId(f"6890a1b2c3d4e5f6073{position:05d}"),
                300 + position,
                datum,
                team1=club_side(2 * position),
                team2=club_side(2 * position + 1),
                schiedsrichter=booked(referees[position]),
            )
            for position in range(count)
        ]
        refereed_alone = [
            fixture(
                ObjectId(f"6890a1b2c3d4e5f6074{position:05d}"),
                600 + position,
                datum,
                team1=club_side(0),
                team2=club_side(1),
                schiedsrichter=booked(referees[count + position]),
            )
            for position in range(unstamped)
        ]
        mailed = [
            {
                **compose_spielbestaetigung(
                    row_id=ObjectId(),
                    saison_id=SAISON_ID,
                    spiel={**spiel, "uhrzeit": "17:00:00"},
                    partei=partei,
                    hashes={seat: hash_token(f"{spiel['_id']}-{partei.get('team_id')}-{seat}") for seat in KONTAKT_ROLLEN},
                    today=TODAY,
                ),
                # Mailed on an earlier day: a row whose request went today is reminded of nothing today.
                "angefragt_am": YESTERDAY,
            }
            for spiel in spiele
            for partei in parteien_of(spiel)
        ] + [
            compose_spielbestaetigung(
                row_id=ObjectId(),
                saison_id=SAISON_ID,
                spiel={**spiel, "uhrzeit": "17:00:00"},
                partei={"art": "schiedsrichter", "schiedsrichter_id": spiel["schiedsrichter"]["schiedsrichter_id"]},
                hashes={},
                today=TODAY,
            )
            for spiel in refereed_alone
        ]
        junctions = [
            documents.saison_team_document(SAISON_ID, club(position), f"Verein {position}", "VE", kontakte=seats(position))
            for position in range(2 * count)
        ]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[Any, Counter[str]]:
            await database[Collection.SCHIEDSRICHTER].insert_many(
                [referee(referee_id, f"pfeife{position}@example.com", f"Pfiff {position}") for position, referee_id in enumerate(referees)]
            )
            await database[Collection.SPIELBESTAETIGUNGEN].insert_many(mailed)
            # Notices held from earlier passes, past the first batch, each fixture, club and referee their own: the
            # notice step's page takes a `getMore`, and the fixtures, clubs and referees it reads for its share none.
            await database[Collection.SPIELBESTAETIGUNGEN].insert_many(
                [a_held_notice(spiel, partei=partei) for spiel in spiele for partei in parteien_of(spiel)]
            )
            await database[Collection.SPERRLISTE].insert_many(
                [ban_document(f"sitz{position}x0@example.com", bis=SAISON_ID) for position in range(2 * count)]
            )

            return await commands_by_name(mongo_replica_set_url, DATABASE_NAME, lambda database, client: sweep(database, client))

        answer, names = on_a_league(mongo_replica_set_url, body, spiele=[*spiele, *refereed_alone], junctions=junctions)

        # The premise first: the close's share taken, the notices' share answered, and every row due a message about an
        # Ansetzung its fixture left.
        assert (answer.geschlossen, answer.erinnerungen) == (CLOSES_PER_PASS, [])
        assert len(answer.neue_ansetzungen) + len(answer.schiedsrichter_neue_ansetzungen) == MITTEILUNGEN_PER_PASS
        assert not {einteilung.spiel_id for einteilung in answer.einteilungen} & {spiel["_id"] for spiel in refereed_alone}
        assert names["getMore"] == budget.SWEEP_GET_MORES, names


class ThenTheRivalAfterTheSecondSessionRead(ThenTheRivalAfterTheFirstSessionRead):
    """The rival at the pass's second in-session read of the collection: the close reads the season rows first wherever a row stands open."""

    def __init__(self, collection: Any, rival: Callable[[], Awaitable[None]]) -> None:
        super().__init__(collection, rival)
        self.reads = 0

    def find(self, *args: Any, **kwargs: Any) -> Any:
        if kwargs.get("session") is not None:
            self.reads += 1
            if self.reads >= 2:
                return super().find(*args, **kwargs)

        return self._collection.find(*args, **kwargs)


class TestAnEmptiedEntryFilledBesideAHandoverIsMintedForTheNewHolder:
    """`docs/backend/spec.md :: I770`'s second shape: the handover's void finds the open row's entry already empty and writes nothing.

    So only the anchor parts the two, on a club the mint writes no new row for.
    """

    def test_the_new_trainer_is_asked_and_the_old_one_holds_no_link(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            # Recorded as sent, as the timer records a pass's mail, so the second pass owes the emptied seat alone.
            await angefragt(database, client, [row["_id"] for row in await rows(database)])
            # Emptied as a ban or an earlier void leaves an entry, for the mint to fill.
            await database[Collection.SPIELBESTAETIGUNGEN].update_one({"partei.team_id": ALPHA}, {"$set": {"kontakte.trainer": None}})

            async def hand_the_trainer_on() -> None:
                await hand_alphas_trainer_to(database, client, a_payload_person("Lea", "Musterfrau", "+4917010000009"))

            interleaved = ThenTheRivalAfterTheSecondSessionRead(database[Collection.SAISON_TEAMS], hand_the_trainer_on)
            answer = await a_pass_through(database, client, saison_teams=cast(Any, interleaved))

            return interleaved, answer, row_of(await rows(database), team_id=ALPHA)

        interleaved, answer, alpha = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        links = [link for anfrage in answer.anfragen if anfrage.seite == "team1" for link in anfrage.links]
        assert [(link.address, link.rollen) for link in links] == [("lea@example.com", ["trainer"])]
        assert alpha["kontakte"]["trainer"]["token_hashes"] == [hash_token(links[0].token)]
        interleaved.assert_landed_inside(serially=1)


def withheld_lines(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [record.getMessage() for record in caplog.records if "withheld" in record.getMessage()]


def no_line_names(caplog: pytest.LogCaptureFixture, *names: Any) -> bool:
    return not any(str(name) in record.getMessage() for record in caplog.records for name in names)


class TestEachPassCountsTheSeatsABanKeptFromALink:
    """A count and never an id, one line a pass, each pass having asked the ban afresh: a line naming the row ties its club to the ban."""

    def test_the_mint_counts_a_barred_seat_once_through_a_retried_attempt(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """The first pass's mint runs twice, a seat handed on inside it: a count kept across attempts says two."""

        barred = address(BETA, "stellvertretung")

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPERRLISTE].insert_one(ban_document(barred, bis=SAISON_ID))

            async def hand_the_trainer_on() -> None:
                handed = await database[Collection.SAISON_TEAMS].update_one(
                    {"saison_id": SAISON_ID, "team_id": ALPHA}, {"$set": {"kontakte.trainer": kontaktperson_document("Lea")}}
                )
                assert handed.modified_count == 1

            interleaved = ThenTheRivalAfterTheFirstSessionRead(database[Collection.SAISON_TEAMS], hand_the_trainer_on)
            # Inside both passes: the level outside is whatever an earlier case on this worker left.
            with caplog.at_level(logging.INFO, logger=FL_LOGGER_NAME):
                await a_pass_through(database, client, saison_teams=cast(Any, interleaved))
                # Recorded as sent, as the timer records a pass's mail, so the second pass owes nothing but the barred seat.
                await angefragt(database, client, [row["_id"] for row in await rows(database)])
                await sweep(database, client)

            return interleaved, await rows(database)

        interleaved, stored = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        interleaved.assert_landed_inside(serially=1)
        assert (
            withheld_lines(caplog)
            == [f"Links withheld from barred addresses in season {SAISON_ID}: 1 seat(s) unminted, 0 seat(s) unreminded"] * 2
        )
        assert no_line_names(caplog, barred, BETA, *[row["_id"] for row in stored])

    def test_the_reminder_counts_a_seat_barred_since_its_link_went(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        barred = address(BETA, "stellvertretung")

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await angefragt(database, client, [row["_id"] for row in await rows(database)])
            await database[Collection.SPERRLISTE].insert_one(ban_document(barred, bis=SAISON_ID))
            with caplog.at_level(logging.INFO, logger=FL_LOGGER_NAME):
                reminded = [await sweep(database, client, today=day) for day in (FIRST_REMINDER, SECOND_REMINDER)]

            return reminded, await rows(database)

        reminded, stored = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, FORTNIGHT, schiedsrichter=None)])

        # The premise: each pass reminded the barred seat's row, its other seats.
        assert [sorted(anfrage.seite for anfrage in answer.erinnerungen) for answer in reminded] == [["team1", "team2"]] * 2
        assert (
            withheld_lines(caplog)
            == [f"Links withheld from barred addresses in season {SAISON_ID}: 0 seat(s) unminted, 1 seat(s) unreminded"] * 2
        )
        assert no_line_names(caplog, barred, BETA, *[row["_id"] for row in stored])


class TestARefereeErasedBesideTheMintIsToldNothing:
    """`docs/backend/spec.md :: I760`: the erasure deletes the referee's rows its snapshot holds, and the mint's is not yet one."""

    def test_the_mint_runs_again_and_writes_the_erased_referee_no_row(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def erase_the_referee() -> None:
                await erased(database, client, REFEREE_EMAIL, germany_now=NOW)

            interleaved = ThenTheRivalAfterTheFirstSessionRead(database[Collection.SCHIEDSRICHTER], erase_the_referee)
            answer = await a_pass_through(database, client, schiedsrichter=cast(Any, interleaved))

            erased_since = await database[Collection.SCHIEDSRICHTER].count_documents({"_id": SCHIEDSRICHTER}) == 0
            return interleaved, erased_since, answer, await rows(database)

        interleaved, erased_since, answer, stored = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        # The premise: the erasure committed under the mint's read, the first a fresh league's pass makes of the referees;
        # the mint run again reads none, the fixture now booked onto the ghost.
        assert (interleaved.passes, erased_since) == (1, True)
        assert answer.einteilungen == []
        assert [row["partei"]["art"] for row in stored] == ["team", "team"]


class TestAnErasedContactIsNotToldTheirFixtureMoved:
    """`docs/backend/spec.md :: I762`: a seat holding no link on the closed row is one the erasure's void writes nothing for."""

    def test_the_close_runs_again_and_leaves_the_erased_trainer_out_of_the_notice(self, mongo_replica_set_url: str):
        erased_address = address(ALPHA, "trainer")

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await angefragt(database, client, [row["_id"] for row in await rows(database)])
            # The trainer seated after the request went: their seat holds no link on the row the move closes.
            await database[Collection.SPIELBESTAETIGUNGEN].update_many({"partei.team_id": ALPHA}, {"$set": {"kontakte.trainer": None}})
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"uhrzeit": "19:00:00"}})

            async def erase_the_trainer() -> None:
                await erased(database, client, erased_address, germany_now=NOW)

            interleaved = ThenTheRivalAfterTheFirstSessionRead(database[Collection.SAISON_TEAMS], erase_the_trainer)
            answer = await a_pass_through(database, client, saison_teams=cast(Any, interleaved))

            return interleaved, answer

        interleaved, answer = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        interleaved.assert_landed_inside(serially=1)
        # The premise: ALPHA's row was closed and its notice went to its other seats.
        told = {empfaenger.address for notice in answer.neue_ansetzungen for empfaenger in notice.empfaenger}
        assert address(ALPHA, "ansprechperson") in told
        assert erased_address not in told


# Eight and ten days out: each row's deadline is one of today's reminder days.
ON_REMINDER_DAYS = [fixture(SPIEL, 1, days_after(day=TODAY, days=8)), fixture(OTHER_SPIEL, 2, days_after(day=TODAY, days=10))]


class TestARowMintedOnAReminderDayIsRemindedOfNothingThatDay:
    def test_its_request_is_the_days_one_message_on_its_pass_and_after_its_stamp(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await sweep(database, client)
            await angefragt(database, client, [anfrage.spielbestaetigung_id for anfrage in minted.anfragen])
            later = await sweep(database, client)

            return minted, later, await rows(database, **{"partei.art": "team"})

        minted, later, stored = on_a_league(mongo_replica_set_url, body, spiele=ON_REMINDER_DAYS)

        # The premise: both fixtures' deadlines fall on today's reminders, and every side was asked.
        assert sorted({str(row["frist"]) for row in stored}) == sorted({days_after(day=TODAY, days=1), days_after(day=TODAY, days=3)})
        assert (len(minted.anfragen), minted.erinnerungen) == (4, [])
        assert (later.anfragen, later.erinnerungen) == ([], [])
        assert {len(entry["token_hashes"]) for row in stored for entry in row["kontakte"].values()} == {1}


class TestARequestNeverStampedIsAskedAgain:
    """The mint's answer may never have reached the timer, or its mail never gone: its rows stand, holding links nobody got."""

    def test_the_next_pass_asks_every_unstamped_side_again_and_a_stamped_one_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            again = await sweep(database, client)
            await angefragt(database, client, [anfrage.spielbestaetigung_id for anfrage in again.anfragen])
            settled = await sweep(database, client)

            return again, settled, await rows(database, **{"partei.art": "team"})

        again, settled, stored = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        assert sorted(anfrage.seite for anfrage in again.anfragen) == ["team1", "team2"]
        assert {len(entry["token_hashes"]) for row in stored for entry in row["kontakte"].values()} == {2}
        assert (settled.anfragen, settled.erinnerungen) == ([], [])

    def test_a_seat_the_provider_refused_is_passed_over_and_a_row_refused_whole_stays_unasked(self, mongo_replica_set_url: str):
        refused = {"nachricht_id": "", "stand": "unzustellbar", "grund": "NoEmail", "am": "2026-04-01T10:00:00+00:00"}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            confirmations = database[Collection.SPIELBESTAETIGUNGEN]
            await confirmations.update_one({"partei.team_id": ALPHA}, {"$set": {"kontakte.trainer.zustellung": refused}})
            await confirmations.update_one(
                {"partei.team_id": BETA}, {"$set": {f"kontakte.{seat}.zustellung": refused for seat in KONTAKT_ROLLEN}}
            )
            again = await sweep(database, client)

            return again, row_of(await rows(database), team_id=BETA)

        again, beta = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK, schiedsrichter=None)])

        assert [sorted(link.address for link in anfrage.links) for anfrage in again.anfragen] == [
            sorted([address(ALPHA, "ansprechperson"), address(ALPHA, "stellvertretung")])
        ]
        # Nothing written, so it reads as never asked.
        assert (beta["angefragt_am"], {len(entry["token_hashes"]) for entry in beta["kontakte"].values()}) == (None, {1})

    def test_a_refused_seat_whose_address_is_corrected_is_asked_at_once(self, mongo_replica_set_url: str):
        refused = {"nachricht_id": "", "stand": "unzustellbar", "grund": "NoEmail", "am": "2026-04-01T10:00:00+00:00"}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await database[Collection.SPIELBESTAETIGUNGEN].update_one(
                {"partei.team_id": ALPHA}, {"$set": {"kontakte.trainer.zustellung": refused}}
            )
            tamsin = a_payload_person("Tamsin", "Tamsin-Mustermann", "+4917010000000")
            await hand_alphas_trainer_to(database, client, {**tamsin, "email": "tamsin.neu@example.com"})

            return await sweep(database, client)

        answer = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK, schiedsrichter=None)])

        assert "tamsin.neu@example.com" in {link.address for anfrage in answer.anfragen for link in anfrage.links}

    def test_a_request_never_stamped_is_not_asked_once_its_deadline_has_passed(self, mongo_replica_set_url: str):
        """Minted inside the notice period, so due the day it went: from the day after, its link answers a press `-003`.

        A club's alone: the referee's row, answered until the day, is held by `TestAnEinteilungNeverStampedIsToldAgain`.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            return await sweep(database, client, today=days_after(day=TODAY, days=1)), await rows(database)

        late, stored = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK, schiedsrichter=None)])

        # The premise: every row stands unstamped and open, its deadline yesterday.
        assert {(row["angefragt_am"], row["geschlossen"], str(row["frist"])) for row in stored} == {(None, None, TODAY)}
        assert late.anfragen == []

    def test_a_seat_minted_afresh_on_an_unstamped_row_leaves_its_other_seats_asked_again(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            # Emptied as a handover's void leaves it, so the next pass's mint asks this seat alone on the row.
            await database[Collection.SPIELBESTAETIGUNGEN].update_one({"partei.team_id": ALPHA}, {"$set": {"kontakte.trainer": None}})
            return await sweep(database, client)

        again = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK, schiedsrichter=None)])

        alpha = sorted(link.address for anfrage in again.anfragen if anfrage.seite == "team1" for link in anfrage.links)
        assert alpha == sorted(address(ALPHA, seat) for seat in KONTAKT_ROLLEN)


class TestASeatMintedAfreshOnAReminderDay:
    """`docs/backend/spec.md :: I767`: the seat's request is its message of the day, and its row's other seats are reminded beside it."""

    def _passes(self, url: str, emptied: list[str]) -> Any:
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await angefragt(database, client, [row["_id"] for row in await rows(database)])
            await database[Collection.SPIELBESTAETIGUNGEN].update_one(
                {"partei.team_id": ALPHA}, {"$set": {f"kontakte.{seat}": None for seat in emptied}}
            )
            first = await sweep(database, client, today=FIRST_REMINDER)
            later = await sweep(database, client, today=FIRST_REMINDER)

            return first, later, row_of(await rows(database), team_id=ALPHA)

        return on_a_league(url, body, spiele=[fixture(SPIEL, 1, FORTNIGHT, schiedsrichter=None)])

    def test_the_rows_other_seats_are_reminded_on_that_pass_and_nobody_on_the_next(self, mongo_replica_set_url: str):
        first, later, alpha = self._passes(mongo_replica_set_url, ["trainer"])

        asked = [(anfrage.seite, sorted(link.address for link in anfrage.links)) for anfrage in first.anfragen]
        reminded = {anfrage.seite: sorted(link.address for link in anfrage.links) for anfrage in first.erinnerungen}
        assert asked == [("team1", [address(ALPHA, "trainer")])]
        assert reminded["team1"] == sorted([address(ALPHA, "ansprechperson"), address(ALPHA, "stellvertretung")])
        assert (later.anfragen, later.erinnerungen, alpha["erinnert_am"]) == ([], [], [FIRST_REMINDER])

    def test_a_row_whose_every_seat_was_minted_afresh_is_marked_reminded_and_sent_no_reminder_later(self, mongo_replica_set_url: str):
        first, later, alpha = self._passes(mongo_replica_set_url, list(KONTAKT_ROLLEN))

        assert [anfrage.seite for anfrage in first.anfragen] == ["team1"]
        assert [anfrage.seite for anfrage in first.erinnerungen] == ["team2"]
        assert (later.anfragen, later.erinnerungen, alpha["erinnert_am"]) == ([], [], [FIRST_REMINDER])


class TestALinkMailedBeforeALostStampLivesToTheDeadline:
    """`docs/backend/spec.md :: I752` across a request asked again: its first mail may have arrived, so its link stays live."""

    def test_the_first_requests_links_name_their_seats_after_the_resend_and_both_reminders(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await sweep(database, client)
            again = await sweep(database, client)
            await angefragt(database, client, [anfrage.spielbestaetigung_id for anfrage in again.anfragen])
            reminded = [await sweep(database, client, today=day) for day in (FIRST_REMINDER, SECOND_REMINDER)]
            collection = database[Collection.SPIELBESTAETIGUNGEN]
            resolved = []
            for link in [link for anfrage in first.anfragen if anfrage.seite == "team1" for link in anfrage.links]:
                found = await collection.find_one(build_token_filter(token_hash=hash_token(link.token)))
                resolved.append(None if found is None else seat_holding(spielbestaetigung_raw=found, token_hash=hash_token(link.token)))

            return reminded, resolved, row_of(await rows(database), team_id=ALPHA)

        reminded, resolved, alpha = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, FORTNIGHT, schiedsrichter=None)])

        # The premise: four links a seat, the request, the request asked again and both reminders.
        assert [len(answer.erinnerungen) for answer in reminded] == [2, 2]
        assert {len(entry["token_hashes"]) for entry in alpha["kontakte"].values()} == {4}
        assert resolved == list(KONTAKT_ROLLEN)


class TestTheReminderPassesOverASeatTheProviderRefused:
    """As the request asked again does: its one message would buy nothing, and a corrected address voids the seat for the mint."""

    def test_the_refused_seat_is_left_out_and_its_rows_other_seats_reminded(self, mongo_replica_set_url: str):
        refused = {"nachricht_id": "", "stand": "unzustellbar", "grund": "NoEmail", "am": "2026-04-01T10:00:00+00:00"}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await angefragt(database, client, [row["_id"] for row in await rows(database)])
            await database[Collection.SPIELBESTAETIGUNGEN].update_one(
                {"partei.team_id": ALPHA}, {"$set": {"kontakte.trainer.zustellung": refused}}
            )
            return await sweep(database, client, today=FIRST_REMINDER)

        answer = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, FORTNIGHT, schiedsrichter=None)])

        alpha = next(anfrage for anfrage in answer.erinnerungen if anfrage.seite == "team1")
        assert sorted(link.address for link in alpha.links) == sorted([address(ALPHA, "ansprechperson"), address(ALPHA, "stellvertretung")])


def a_referee_link(zustellung: Mapping[str, Any] | None) -> dict[str, Any]:
    """A referee's confirmation link block, carrying what the provider said of the message it went out in."""

    return {**compose_bestaetigung(token_hash="c" * 64, today=YESTERDAY), "zustellung": zustellung}


async def a_lost_einteilung_stamp(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    """A pass whose team rows' requests were stamped and whose Einteilung's stamp never landed."""

    await sweep(database, client)
    await angefragt(database, client, [row["_id"] for row in await rows(database, **{"partei.art": "team"})])


class TestAnEinteilungNeverStampedIsToldAgain:
    """`docs/backend/spec.md :: I765` for a referee row: the referee is told on every later pass until a stamp records it."""

    def test_the_next_pass_tells_the_referee_again(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_lost_einteilung_stamp(database, client)
            again = await sweep(database, client)
            await angefragt(database, client, [einteilung.spielbestaetigung_id for einteilung in again.einteilungen])
            return again, await sweep(database, client), row_of(await rows(database), schiedsrichter_id=SCHIEDSRICHTER)

        again, settled, stored = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        assert [(einteilung.spielbestaetigung_id, einteilung.address) for einteilung in again.einteilungen] == [(stored["_id"], REFEREE_EMAIL)]
        assert (again.anfragen, settled.einteilungen, stored["angefragt_am"]) == ([], [], TODAY)

    def test_a_referee_is_told_again_past_the_rows_deadline_until_the_fixtures_day(self, mongo_replica_set_url: str):
        """The deadline is a club's alone: a referee answers until the day, so their Einteilung is told again until then."""

        the_day_after = days_after(day=TODAY, days=1)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_lost_einteilung_stamp(database, client)
            return await sweep(database, client, today=the_day_after), row_of(await rows(database), schiedsrichter_id=SCHIEDSRICHTER)

        again, stored = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        # The premise: the row's deadline lies before the pass's day, the fixture's after it.
        assert stored["frist"] < the_day_after < stored["ansetzung"]["datum"]
        assert [einteilung.spielbestaetigung_id for einteilung in again.einteilungen] == [stored["_id"]]

    def test_a_referee_whose_last_mail_the_provider_refused_is_passed_over_and_the_row_stays_unasked(self, mongo_replica_set_url: str):
        refused = {"nachricht_id": "", "stand": "unzustellbar", "grund": "NoEmail", "am": "2026-03-31T10:00:00+00:00"}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_lost_einteilung_stamp(database, client)
            await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER}, {"$set": {"bestaetigung": a_referee_link(refused)}})
            return await sweep(database, client), row_of(await rows(database), schiedsrichter_id=SCHIEDSRICHTER)

        again, stored = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        assert (again.einteilungen, stored["angefragt_am"]) == ([], None)

    def test_a_referee_erased_beside_the_pass_is_told_nothing(self, mongo_replica_set_url: str):
        """The rival at the pass's second in-session read of the referees, the reminder's: the mint's comes first.

        The reminder run again reads no referee row, so its rival point is met once whether the erasure landed inside or not.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_lost_einteilung_stamp(database, client)

            async def erase_the_referee() -> None:
                await erased(database, client, REFEREE_EMAIL, germany_now=NOW)

            interleaved = ThenTheRivalAfterTheSecondSessionRead(database[Collection.SCHIEDSRICHTER], erase_the_referee)
            answer = await a_pass_through(database, client, schiedsrichter=cast(Any, interleaved))
            return interleaved, answer, await rows(database, **{"partei.art": "schiedsrichter"})

        interleaved, answer, stored = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        # The premise: the erasure ran under the reminder's read and took the referee's row with it.
        assert (interleaved.passes, stored) == (1, [])
        assert answer.einteilungen == []


# --- A REFEREE TAKEN OFF a fixture after their Einteilung went out.


async def told_and_taken_off(database: AsyncDatabase, client: AsyncMongoClient, *, stamped: bool = True) -> None:
    """The first pass asks the referee, its request is stamped as mailed or not, and the fixture is handed to another referee."""

    await sweep(database, client)
    if stamped:
        await angefragt(database, client, [row["_id"] for row in await rows(database)])
    await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"schiedsrichter": booked(OTHER_SCHIEDSRICHTER)}})


class TestARefereeTakenOffIsToldOnlyWhereTheyWereTold:
    def test_a_referee_never_mailed_is_told_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await told_and_taken_off(database, client, stamped=False)
            return await sweep(database, client)

        second = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        # The premise: the row closed for the referee change all the same.
        assert (second.geschlossen, second.schiedsrichter_gewechselt) == (1, [])

    def test_a_day_gone_by_tells_nobody(self, mongo_replica_set_url: str):
        """The fixture unplayed past its day: a slot of a day gone by is no booking taken away, so nobody is told."""

        after_the_day = days_after(day=NEXT_WEEK, days=1)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await told_and_taken_off(database, client)
            return await sweep(database, client, today=after_the_day), await rows(database, **{"partei.schiedsrichter_id": SCHIEDSRICHTER})

        second, (old,) = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        assert old["geschlossen"] == {"am": after_the_day, "grund": "schiedsrichter_gewechselt"}
        assert second.schiedsrichter_gewechselt == []

    def test_their_own_decline_tells_them_nothing(self, mongo_replica_set_url: str):
        """The decline took them off and closed the row in one write, so no pass meets the row open."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await angefragt(database, client, [row["_id"] for row in await rows(database)])
            await database[Collection.SCHIEDSRICHTER].update_one(
                {"_id": SCHIEDSRICHTER},
                {"$set": {"einwilligung": documents.eigene_einwilligung_document(text_version="v1", bestaetigt_am=YESTERDAY)}},
            )
            (own,) = await rows(database, **{"partei.schiedsrichter_id": SCHIEDSRICHTER})
            await post_schiedsrichter_antwort(
                spielbestaetigung_id=own["_id"],
                antwort_data=FLSpielbestaetigungSchiedsrichterAntwortPayload(antwort="abgelehnt", begruendung="Verhindert"),
                identifier=REFEREE_EMAIL,
                spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
                spiele_collection=database[Collection.SPIELE],
                saison_teams_collection=database[Collection.SAISON_TEAMS],
                saisons_collection=database[Collection.SAISONS],
                records=record_collections(database),
                db=client,
                today=TODAY,
            )
            return await sweep(database, client)

        second = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        assert (second.geschlossen, second.schiedsrichter_gewechselt) == (0, [])


class ConfirmationsRunningARivalAtTheErasuresRead(InterleavedCollection):
    """The confirmations a referee's erasure reads its rows off, a rival run once after that read and before its removal."""

    async def aggregate(self, *args: Any, **kwargs: Any) -> Any:
        cursor = await self._collection.aggregate(*args, **kwargs)
        await self.run_the_rival()
        return cursor


class TestATakenOffRefereesErasureAndTheCloseCross:
    """The close and the notice step each write the very row the erasure removes, so the two conflict and one runs again."""

    def test_an_erasure_landing_inside_the_close_leaves_nobody_told(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await told_and_taken_off(database, client)

            async def erase_the_referee() -> None:
                await erased(database, client, REFEREE_EMAIL, germany_now=NOW)

            interleaved = ThenTheRivalAfterTheFirstSessionRead(database[Collection.SCHIEDSRICHTER], erase_the_referee)
            answer = await a_pass_through(database, client, schiedsrichter=cast(Any, interleaved))

            return interleaved, answer, await rows(database, **{"partei.art": "schiedsrichter"})

        interleaved, answer, stored = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        # Serially the erased referee's row is gone before the notice step reads any address, so it reads none.
        interleaved.assert_landed_inside(serially=0)
        assert answer.schiedsrichter_gewechselt == []
        assert [row["partei"]["schiedsrichter_id"] for row in stored] == [OTHER_SCHIEDSRICHTER]

    def test_a_close_landing_inside_the_erasure_leaves_no_row_of_theirs(self, mongo_replica_set_url: str):
        """The close commits first and its notice stands, the order being close then erasure; the row it closed goes with them."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await told_and_taken_off(database, client)
            answers: list[Any] = []

            async def a_pass() -> None:
                answers.append(await sweep(database, client))

            interleaved = ConfirmationsRunningARivalAtTheErasuresRead(database[Collection.SPIELBESTAETIGUNGEN], a_pass)
            await erased(database, client, REFEREE_EMAIL, germany_now=NOW, spielbestaetigungen_collection=interleaved)

            return interleaved, answers, await rows(database, **{"partei.schiedsrichter_id": SCHIEDSRICHTER})

        interleaved, (answer,), stored = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        # Serially the erasure reads its rows once; the second read is its run again after the close's write.
        interleaved.assert_landed_inside(serially=1)
        assert [notice.address for notice in answer.schiedsrichter_gewechselt] == [REFEREE_EMAIL]
        assert stored == []


async def as_the_referee(database: AsyncDatabase, client: AsyncMongoClient, antwort: Any, begruendung: str | None = None) -> None:
    """The booked referee, their record confirmed, answering their one row on their own panel."""

    await database[Collection.SCHIEDSRICHTER].update_one(
        {"_id": SCHIEDSRICHTER},
        {"$set": {"einwilligung": documents.eigene_einwilligung_document(text_version="v1", bestaetigt_am=YESTERDAY)}},
    )
    (own,) = await rows(database, **{"partei.schiedsrichter_id": SCHIEDSRICHTER})
    await post_schiedsrichter_antwort(
        spielbestaetigung_id=own["_id"],
        antwort_data=FLSpielbestaetigungSchiedsrichterAntwortPayload(antwort=antwort, begruendung=begruendung),
        identifier=REFEREE_EMAIL,
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        spiele_collection=database[Collection.SPIELE],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        records=record_collections(database),
        db=client,
        today=TODAY,
    )


class TestARefereeWhoAcceptedIsToldTheyWereTakenOff:
    """`docs/backend/spec.md :: I780` reaches an answered row: the close shuts it answered or not, and the notice follows."""

    def test_their_acceptance_is_no_reason_to_tell_them_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            await angefragt(database, client, [row["_id"] for row in await rows(database)])
            await as_the_referee(database, client, "zugesagt")
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"schiedsrichter": booked(OTHER_SCHIEDSRICHTER)}})
            return await sweep(database, client)

        second = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        assert [notice.address for notice in second.schiedsrichter_gewechselt] == [REFEREE_EMAIL]


# --- The NOTICES a close owes, held on the rows it closed (`docs/backend/spec.md :: I834`).


class TestANoticeOutlivesALostAnswer:
    def test_a_notice_nobody_stamped_is_answered_again_and_one_stamped_never(self, mongo_replica_set_url: str):
        """The first answer lost, as a frontend stopped mid-mail loses it; the second stamped, as the timer stamps what it sent."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await told_and_taken_off(database, client)
            first = await sweep(database, client)
            again = await sweep(database, client)
            stamped = await mitgeteilt(database, client, [notice.spielbestaetigung_id for notice in again.schiedsrichter_gewechselt])
            return first, again, stamped, await sweep(database, client)

        first, again, stamped, settled = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        assert [notice.address for notice in first.schiedsrichter_gewechselt] == [REFEREE_EMAIL]
        assert again.schiedsrichter_gewechselt == first.schiedsrichter_gewechselt
        assert (stamped.mitgeteilt, settled.schiedsrichter_gewechselt, settled.mitteilungen_aufgegeben) == (1, [], 0)

    def test_a_notice_handed_out_as_often_as_the_cap_allows_is_given_up(self, mongo_replica_set_url: str):
        spiel = fixture(SPIEL, 1, NEXT_WEEK)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELBESTAETIGUNGEN].insert_one(a_held_notice(spiel, versuche=MITTEILUNG_VERSUCHE_HOECHSTENS - 1))
            last = await sweep(database, client)
            after = await sweep(database, client)
            return last, after, await rows(database, geschlossen={"$ne": None})

        last, after, (held,) = on_a_league(mongo_replica_set_url, body, spiele=[spiel])

        assert ([notice.spiel_id for notice in last.neue_ansetzungen], last.mitteilungen_aufgegeben) == ([SPIEL], 0)
        assert (after.neue_ansetzungen, after.mitteilungen_aufgegeben) == ([], 1)
        assert held["geschlossen"]["mitteilung"] is None

    def test_a_notice_about_a_day_gone_by_is_given_up(self, mongo_replica_set_url: str):
        spiel = fixture(SPIEL, 1, NEXT_WEEK)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELBESTAETIGUNGEN].insert_one(a_held_notice(spiel))
            return await sweep(database, client, today=days_after(day=NEXT_WEEK, days=1))

        late = on_a_league(mongo_replica_set_url, body, spiele=[spiel])

        assert (late.neue_ansetzungen, late.mitteilungen_aufgegeben) == ([], 1)

    def test_the_stamp_reaches_no_row_of_another_season_nor_one_holding_no_notice(self, mongo_replica_set_url: str):
        spiel = fixture(SPIEL, 1, NEXT_WEEK)
        held = a_held_notice(spiel)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELBESTAETIGUNGEN].insert_one(held)
            elsewhere = await mitgeteilt(database, client, [held["_id"]], saison_id=PAST_SAISON_ID)
            here = await mitgeteilt(database, client, [held["_id"]])
            return elsewhere, here, await mitgeteilt(database, client, [held["_id"]])

        elsewhere, here, again = on_a_league(mongo_replica_set_url, body, spiele=[spiel])

        assert (elsewhere.mitgeteilt, here.mitgeteilt, again.mitgeteilt) == (0, 1, 0)


class TestAnAddressMovedBesideTheNoticeIsTheOneTold:
    """The notice step writes each referee whose address it read, so an address change crossing it conflicts and it reads again."""

    def test_the_notice_goes_to_the_address_the_referee_holds_once_it_commits(self, mongo_replica_set_url: str):
        moved_to = "neue-pfeife@example.com"

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await told_and_taken_off(database, client)

            async def move_the_address() -> None:
                await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER}, {"$set": {"kontakt.email": moved_to}})

            interleaved = ThenTheRivalAfterTheFirstSessionRead(database[Collection.SCHIEDSRICHTER], move_the_address)
            return interleaved, await a_pass_through(database, client, schiedsrichter=cast(Any, interleaved))

        interleaved, answer = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        # Serially the notice step and the mint each read the referees once.
        interleaved.assert_landed_inside(serially=2)
        assert [notice.address for notice in answer.schiedsrichter_gewechselt] == [moved_to]


# --- A FIXTURE CALLED OFF after its parties were asked (`docs/backend/spec.md :: I835`).


async def asked_and_called_off(database: AsyncDatabase, client: AsyncMongoClient, *, stamped: bool = True) -> Any:
    """The first pass asks both clubs and the referee, its requests stamped as mailed or not, and the fixture is called off."""

    first = await sweep(database, client)
    if stamped:
        await angefragt(database, client, [row["_id"] for row in await rows(database)])
    await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"sonderereignis": "ausgefallen"}})

    return first


class TestACalledOffFixtureTellsEveryPartyItAsked:
    def test_both_clubs_and_the_referee_are_told_whatever_each_answered(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await sweep(database, client)
            await angefragt(database, client, [row["_id"] for row in await rows(database)])
            # One club agreed before the call-off, which tells it no less.
            await antworten(database, client, next(anfrage for anfrage in first.anfragen if anfrage.seite == "team1").links[0].token)
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"sonderereignis": "ausgefallen"}})
            return await sweep(database, client)

        second = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        assert second.geschlossen == 3
        assert sorted(empfaenger.address for notice in second.spiel_abgesagt for empfaenger in notice.empfaenger) == sorted(
            address(team_id, seat) for team_id in (ALPHA, BETA) for seat in KONTAKT_ROLLEN
        )
        assert [notice.address for notice in second.schiedsrichter_spiel_abgesagt] == [REFEREE_EMAIL]
        assert {(notice.alt.datum, notice.alt.uhrzeit) for notice in [*second.spiel_abgesagt, *second.schiedsrichter_spiel_abgesagt]} == {
            (NEXT_WEEK, "18:00:00")
        }

    def test_a_party_never_mailed_is_told_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await asked_and_called_off(database, client, stamped=False)
            return await sweep(database, client)

        second = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        # The premise: every row closed for the call-off all the same.
        assert (second.geschlossen, second.spiel_abgesagt, second.schiedsrichter_spiel_abgesagt) == (3, [], [])

    def test_a_day_gone_by_tells_nobody(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await asked_and_called_off(database, client)
            return await sweep(database, client, today=days_after(day=NEXT_WEEK, days=1))

        second = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        # None owed rather than owed and given up: a notice given up is a warning sending the administrator to tell by hand.
        assert (second.geschlossen, second.spiel_abgesagt, second.schiedsrichter_spiel_abgesagt, second.mitteilungen_aufgegeben) == (
            3,
            [],
            [],
            0,
        )
