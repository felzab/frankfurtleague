import logging
from collections import Counter
from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any, cast
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import ExecutionTimeout, OperationFailure

from app.api.bewerbungen.services import days_after, hash_token
from app.api.spielbestaetigungen.router import post_spielbestaetigung
from app.api.spielbestaetigungen.schemas import (
    FLSpielbestaetigungAntwortPayload,
    FLSpielbestaetigungSweepAngefragtPayload,
    FLSpielbestaetigungSweepResponse,
    FLSpielbestaetigungTermin,
)
from app.api.spielbestaetigungen.services import (
    ANSETZUNG_BEANTWORTET,
    ANSETZUNG_GESCHLOSSEN,
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
    sweep_spielbestaetigungen,
)
from app.api.spiele.admin_router import patch_spiel_data
from app.api.spiele.schemas import FLPatchSpielDataPayload
from app.api.teams.admin_router import patch_saison_team_kontakte, replace_saison_team
from app.api.teams.schemas import KONTAKT_ROLLEN, FLPatchSaisonTeamKontaktePayload, FLReplaceSaisonTeamPayload, kontakte_stand_of
from app.core.collections import Collection
from app.core.exception_handlers import DATABASE_FAILED, UNKNOWN_OUTCOME
from app.core.exceptions import WriteRefusalException
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID
from app.core.transactions import UNKNOWN_COMMIT_RESULT
from app.shared.einwilligung import LAUFENDE_FASSUNGEN
from tests import documents
from tests.actor_tokens import FRESH_STEP_UP_CHECK
from tests.api import test_spielbestaetigung_sweep_refusal as budget
from tests.bans import ban_list
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import ban_document, kontaktperson_document
from tests.isolation import InterleavedCollection
from tests.payloads import spiel_patch_body
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


class TestADiscardedDeclineIsNotAskedAgain:
    """`docs/backend/spec.md :: I768`: a club declines once per Ansetzung, so the decline the administrator discarded is its answer."""

    def test_the_declining_club_is_asked_nothing_until_the_fixture_moves(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            # The discard's write as it closes the declining club's own row, its decline standing.
            declined = {
                "$set": {
                    **compose_antwort_update(
                        antwort="abgelehnt",
                        seat="trainer",
                        vorschlag=FLSpielbestaetigungTermin(datum=days_after(day=NEXT_WEEK, days=1), uhrzeit="18:00:00"),
                        begruendung="Klassenfahrt",
                        today=TODAY,
                    )["$set"],
                    **compose_closing_update(grund="verworfen", today=TODAY)["$set"],
                }
            }
            await database[Collection.SPIELBESTAETIGUNGEN].update_one({"partei.team_id": BETA}, declined)
            discarded = await sweep(database, client)
            await move(database, client, SPIEL, uhrzeit="19:00:00")
            moved = await sweep(database, client)

            return discarded, moved

        discarded, moved = on_a_league(mongo_replica_set_url, body, spiele=[fixture(SPIEL, 1, NEXT_WEEK)])

        assert (discarded.anfragen, discarded.einteilungen) == ([], [])
        assert sorted(anfrage.seite for anfrage in moved.anfragen) == ["team1", "team2"]


class TestAMovedFixtureAsksAgain:
    """Acceptance (a): the close reaches an ANSWERED row, so a kept agreement records why it stopped applying."""

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


class HandedOnAfterTheMintRead(InterleavedCollection):
    """The season rows, a seat handed on once the mint's own transaction has read the holders it mints links for."""

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


class TestASeatHandedOnBesideTheMintIsMintedForItsNewHolder:
    """`docs/backend/spec.md :: I770`: the handover voids the open rows it sees, and the mint's rows are not yet among them."""

    def test_the_new_trainer_is_asked_and_the_old_one_holds_no_link(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def hand_the_trainer_on() -> None:
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
                        {
                            "kontakte": {
                                **kept,
                                "trainer": a_payload_person("Lea", "Musterfrau", "+4917010000009"),
                                "trainer_ist_zugleich": None,
                            },
                            "kontakte_stand": kontakte_stand_of(stored["kontakte"]),
                        }
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

            interleaved = HandedOnAfterTheMintRead(database[Collection.SAISON_TEAMS], hand_the_trainer_on)
            answer = await sweep_spielbestaetigungen(
                saison_id=SAISON_ID,
                spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
                spiele_collection=database[Collection.SPIELE],
                saison_teams_collection=cast(Any, interleaved),
                saisons_collection=database[Collection.SAISONS],
                schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                sperrliste=ban_list(database),
                db=client,
                today=TODAY,
            )

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
    """Acceptance (h): each seat's request link and both reminders' still name the seat after the second reminder went."""

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
    """Acceptance (k): nothing of a ban is stored, so the lift is what mints the seat."""

    def test_the_seat_is_minted_once_the_ban_is_lifted(self, mongo_replica_set_url: str):
        barred = address(ALPHA, "stellvertretung")

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            ban = ban_document(barred, bis=SAISON_ID)
            await database[Collection.SPERRLISTE].insert_one(ban)
            first = await sweep(database, client)
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
    # Stamped already, so the run's own stamp costs both runs the same guard read.
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

        A close owing a notice to a club and a referee, a fresh row, a seat minted afresh, a reminder, the day's first stamp.
        """

        moved = fixture(SPIEL, 1, NEXT_WEEK)
        reminded = fixture(OTHER_SPIEL, 2, FORTNIGHT, schiedsrichter=None)
        fresh = fixture(FRESH_SPIEL, 3, NEXT_WEEK)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[Any, Counter[str]]:
            await database[Collection.SPIELE].insert_many([moved, reminded])
            await a_pass_owing_every_message(database, client)
            await database[Collection.SPIELBESTAETIGUNGEN].update_one(
                {"spiel_id": OTHER_SPIEL, "partei.team_id": ALPHA}, {"$set": {"kontakte.trainer": None}}
            )
            await database[Collection.SPIELE].insert_one(fresh)
            await database[Collection.AKTIONEN].delete_many({})

            return await commands_by_name(
                mongo_replica_set_url, DATABASE_NAME, lambda database, client: sweep(database, client, today=FIRST_REMINDER)
            )

        answer, names = on_a_league(mongo_replica_set_url, body, spiele=[])

        # The close's three rows, the moved fixture's two sides minted afresh, the reminder's two rows, the afresh seat.
        patched = answer.geschlossen + len(answer.erinnerungen) + 1
        assert (answer.geschlossen, len(answer.neue_ansetzungen), len(answer.schiedsrichter_neue_ansetzungen), len(answer.erinnerungen)) == (
            3,
            2,
            1,
            2,
        )
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

    Fixtures moved since their rows were mailed, each with its own clubs and referee, due a reminder, a seat of each club barred.
    """

    def test_one_get_more_a_read(self, mongo_replica_set_url: str):
        count = FIRST_BATCH + 1
        datum = days_after(day=TODAY, days=10)

        def club(position: int) -> ObjectId:
            return ObjectId(f"6890a1b2c3d4e5f6071{position:05d}")

        def club_side(position: int) -> dict[str, Any]:
            return {"team_id": club(position), "name": f"Verein {position}", "shorthand": "VE", "tore": None}

        def seats(position: int) -> dict[str, Any]:
            return {
                **{seat: kontaktperson_document(f"Sitz{position}x{index}") for index, seat in enumerate(KONTAKT_ROLLEN)},
                "trainer_ist_zugleich": None,
            }

        referees = [ObjectId(f"6890a1b2c3d4e5f6072{position:05d}") for position in range(count)]
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
                "angefragt_am": TODAY,
            }
            for spiel in spiele
            for partei in parteien_of(spiel)
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
            await database[Collection.SPERRLISTE].insert_many(
                [ban_document(f"sitz{position}x0@example.com", bis=SAISON_ID) for position in range(2 * count)]
            )

            return await commands_by_name(mongo_replica_set_url, DATABASE_NAME, lambda database, client: sweep(database, client))

        answer, names = on_a_league(mongo_replica_set_url, body, spiele=spiele, junctions=junctions)

        # The premise first: the close's share taken, and every row due a reminder about an Ansetzung its fixture left.
        assert (answer.geschlossen, answer.erinnerungen) == (CLOSES_PER_PASS, [])
        assert names["getMore"] == budget.SWEEP_GET_MORES, names
