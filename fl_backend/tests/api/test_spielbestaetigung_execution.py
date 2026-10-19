"""
API · a club's fixture confirmation link, opened and answered against the shipped validators and indexes

The view answers every state a link can reach, and the answer writes the row alone: the seat that
pressed, the proposal judged as the administrator's save of that date is judged, and nothing of the
fixture.
"""

import hashlib
from collections.abc import Awaitable, Callable, Mapping
from typing import Any

import pytest
from bson import ObjectId
from pydantic import ValidationError
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.services import hash_token
from app.api.spielbestaetigungen.router import get_spielbestaetigung_ansicht, post_spielbestaetigung
from app.api.spielbestaetigungen.schemas import (
    FLSpielbestaetigungAnsichtPayload,
    FLSpielbestaetigungAnsichtResponse,
    FLSpielbestaetigungAntwortPayload,
    FLSpielbestaetigungAntwortResponse,
)
from app.api.spielbestaetigungen.services import (
    ANSETZUNG_BEANTWORTET,
    ANSETZUNG_GEAENDERT,
    ANSETZUNG_GESPERRT,
    ANSETZUNG_NAME_IN_BEGRUENDUNG,
    ANSETZUNG_TOKEN_UNKNOWN,
    ANSETZUNG_VORSCHLAG_VERGANGEN,
)
from app.api.spiele.services import ELIGIBILITY_DISQUALIFIED, FIXTURE_DOUBLE_BOOKED, FIXTURE_OUTSIDE_SPIELTAG
from app.api.teams.schemas import KONTAKT_ROLLEN
from app.core.collections import Collection
from tests import documents
from tests.bans import ban_list
from tests.database import a_clean_database, on_the_seed_loop
from tests.isolation import COMMITTED, InterleavedCollection, outcome_of
from tests.plans import plans_of_sent_reads
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spielbestaetigung_test")

SAISON_ID = "2027"
TODAY = "2027-05-01"
FRIST = "2027-05-07"
DATUM = "2027-05-14"
UHRZEIT = "18:30:00"

TEAM1 = ObjectId("6890a1b2c3d4e5f607d50001")
TEAM2 = ObjectId("6890a1b2c3d4e5f607d50002")
SPIEL = ObjectId("6890a1b2c3d4e5f607d50011")
NEIGHBOUR = ObjectId("6890a1b2c3d4e5f607d50012")
HAND_EDITED = ObjectId("6890a1b2c3d4e5f607d50013")
SPIELTAG = ObjectId("6890a1b2c3d4e5f607d50021")
SPIELORT = ObjectId("6890a1b2c3d4e5f607d50031")
SCHIEDSRICHTER = ObjectId("6890a1b2c3d4e5f607d50041")
ROW1 = ObjectId("6890a1b2c3d4e5f607d50051")
ROW2 = ObjectId("6890a1b2c3d4e5f607d50052")

# The matchday the fixture sits on, which a proposal must stay inside.
SPAN = ("2027-05-10", "2027-05-16")

PEOPLE = {
    TEAM1: {"trainer": ("Ida", "Albers"), "ansprechperson": ("Jonas", "Brandt"), "stellvertretung": ("Klara", "Cordes")},
    TEAM2: {"trainer": ("Lea", "Dietz"), "ansprechperson": ("Mats", "Ernst"), "stellvertretung": ("Nora", "Funke")},
}
NAMES = {TEAM1: ("Adler", "AD"), TEAM2: ("Biber", "BI")}
REFEREE = "Otto Gruber"

# Spelled out rather than through the code under test: the stellvertretung's address on the sign-in fold, hashed.
KLARA = hashlib.sha256(b"klara@example.com").hexdigest()


def token(team_id: ObjectId, seat: str, nth: int = 0) -> str:
    return f"{NAMES[team_id][0].lower()}-{seat}-{nth}"


def side(team_id: ObjectId) -> dict[str, Any]:
    name, shorthand = NAMES[team_id]

    return {"team_id": team_id, "name": name, "shorthand": shorthand, "tore": None}


def fixture(spiel_id: ObjectId = SPIEL, *, spiel_nr: int = 1, saison_id: str = SAISON_ID, **fields: Any) -> dict[str, Any]:
    """Dated, both sides seated, at the league's ground and with its referee."""

    stored = {
        "team1": side(TEAM1),
        "team2": side(TEAM2),
        "datum": DATUM,
        "uhrzeit": UHRZEIT,
        "ort": {"spielort_id": SPIELORT, "name": "Halle Ost", "maps_link": "Halle Ost, Frankfurt", "mietpreis": 40},
        "schiedsrichter": {"schiedsrichter_id": SCHIEDSRICHTER, "name": REFEREE, "payment": 20},
        "notiz": "Flutlicht",
    }

    return documents.spiel_document(spiel_id=spiel_id, saison_id=saison_id, spiel_nr=spiel_nr, spieltag_id=SPIELTAG, **{**stored, **fields})


def junction(team_id: ObjectId) -> dict[str, Any]:
    name, shorthand = NAMES[team_id]
    kontakte = documents.kontakte_document(
        **{
            seat: documents.kontaktperson_document(vorname, nachname=nachname, email=f"{vorname.lower()}@example.com")
            for seat, (vorname, nachname) in PEOPLE[team_id].items()
        }
    )

    return documents.saison_team_document(SAISON_ID, team_id, name, shorthand, kontakte=kontakte)


def confirmation(row_id: ObjectId, team_id: ObjectId, *, hashes: Mapping[str, list[str]] | None = None, **fields: Any) -> dict[str, Any]:
    """An open, mailed row about `fixture()`'s Ansetzung, each seat holding its own one link unless `hashes` says otherwise."""

    held = hashes if hashes is not None else {seat: [hash_token(token(team_id, seat))] for seat in KONTAKT_ROLLEN}

    return documents.spielbestaetigung_document(
        fixture(),
        partei={"art": "team", "team_id": team_id},
        _id=row_id,
        frist=FRIST,
        angefragt_am=TODAY,
        kontakte={seat: {"token_hashes": held[seat]} if seat in held else None for seat in KONTAKT_ROLLEN},
        **fields,
    )


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_fixture(url: str, body: Body, *, rows: list[dict[str, Any]] | None = None, mutates_schema: bool = False) -> Any:
    """The running season, its two clubs with three seats each, the fixture, its ground and referee, and one open row per club."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, mutates_schema=mutates_schema) as (client, database):
            await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
            for team_id, (name, shorthand) in NAMES.items():
                await database[Collection.TEAMS].insert_one(documents.team_document(team_id, name, shorthand))
                await database[Collection.SAISON_TEAMS].insert_one(junction(team_id))
            await database[Collection.SPIELTAGE].insert_one(
                {"_id": SPIELTAG, "beginn": SPAN[0], "ende": SPAN[1], "position": 1, "saison_id": SAISON_ID, "saison_phase": "gruppenphase"}
            )
            await database[Collection.SPIELORTE].insert_one(
                {
                    "_id": SPIELORT,
                    "name": "Halle Ost",
                    "address": dict(documents.ADDRESS),
                    "maps_link": "Halle Ost, Frankfurt",
                    "default_mietpreis": 40,
                    "inactive_since": None,
                }
            )
            await database[Collection.SCHIEDSRICHTER].insert_one(
                documents.schiedsrichter_document(SCHIEDSRICHTER, email="otto@example.com", name=REFEREE, default_payment=20, einwilligung=None)
            )
            await database[Collection.SPIELE].insert_one(fixture())
            await database[Collection.SPIELBESTAETIGUNGEN].insert_many(
                rows if rows is not None else [confirmation(ROW1, TEAM1), confirmation(ROW2, TEAM2)]
            )

            return await body(database, client)

    return on_the_seed_loop(_run())


def either(database: AsyncDatabase, collection: Collection, stand_in: Any) -> Any:
    """The collection, or the wrapper a case reaches it through."""

    return database[collection] if stand_in is None else stand_in


async def ansicht(
    database: AsyncDatabase,
    raw: str,
    *,
    today: str = TODAY,
    spielbestaetigungen: Any = None,
    spiele: Any = None,
    saison_teams: Any = None,
) -> FLSpielbestaetigungAnsichtResponse:
    return await get_spielbestaetigung_ansicht(
        ansicht_data=FLSpielbestaetigungAnsichtPayload(token=raw),
        spielbestaetigungen_collection=either(database, Collection.SPIELBESTAETIGUNGEN, spielbestaetigungen),
        spiele_collection=either(database, Collection.SPIELE, spiele),
        saison_teams_collection=either(database, Collection.SAISON_TEAMS, saison_teams),
        spielorte_collection=database[Collection.SPIELORTE],
        sperrliste=ban_list(database),
        today=today,
    )


async def antworten(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    raw: str,
    *,
    antwort: str = "zugesagt",
    vorschlag: tuple[str, str] | None = None,
    begruendung: str | None = None,
    today: str = TODAY,
    spielbestaetigungen: Any = None,
    spiele: Any = None,
    saison_teams: Any = None,
    spieltage: Any = None,
) -> FLSpielbestaetigungAntwortResponse:
    body = {
        "token": raw,
        "antwort": antwort,
        "vorschlag": None if vorschlag is None else {"datum": vorschlag[0], "uhrzeit": vorschlag[1]},
        "begruendung": begruendung,
    }

    return await post_spielbestaetigung(
        antwort_data=FLSpielbestaetigungAntwortPayload.model_validate(body),
        spielbestaetigungen_collection=either(database, Collection.SPIELBESTAETIGUNGEN, spielbestaetigungen),
        spiele_collection=either(database, Collection.SPIELE, spiele),
        saison_teams_collection=either(database, Collection.SAISON_TEAMS, saison_teams),
        spieltage_collection=either(database, Collection.SPIELTAGE, spieltage),
        sperrliste=ban_list(database),
        db=client,
        today=today,
    )


async def ablehnen(database: AsyncDatabase, client: AsyncMongoClient, raw: str, vorschlag: tuple[str, str], **kwargs: Any) -> Any:
    return await antworten(database, client, raw, antwort="abgelehnt", vorschlag=vorschlag, **kwargs)


async def row_now(database: AsyncDatabase, row_id: ObjectId) -> Mapping[str, Any]:
    stored = await database[Collection.SPIELBESTAETIGUNGEN].find_one({"_id": row_id})
    assert stored is not None

    return stored


class TestWhatALinkOpens:
    def test_an_open_link_states_the_fixture_its_side_and_its_deadline(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            return await ansicht(database, token(TEAM2, "ansprechperson"))

        view = on_a_fixture(mongo_replica_set_url, body)

        assert view.model_dump(mode="json") == {
            "acknowledged": 1,
            "zustand": "gueltig",
            "seite": "team2",
            "ansetzung": {
                "team1_name": "Adler",
                "team2_name": "Biber",
                "datum": DATUM,
                "uhrzeit": UHRZEIT,
                # The public ground: what this fixture pays for it stays off a link a stranger may hold.
                "spielort": {"spielort_id": str(SPIELORT), "name": "Halle Ost", "maps_link": "Halle Ost, Frankfurt"},
            },
            "frist": FRIST,
            "vorschlag": None,
            "beantwortet_von": None,
        }

    def test_the_other_clubs_open_decline_is_the_proposal_in_front_of_the_reader(self, mongo_replica_set_url: str):
        """Its date and hour alone; the declining club's own link reads its answer and the role that gave it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ablehnen(database, client, token(TEAM1, "trainer"), ("2027-05-15", "17:00:00"), begruendung="Die Halle ist belegt")

            return await ansicht(database, token(TEAM2, "trainer")), await ansicht(database, token(TEAM1, "stellvertretung"))

        other, own = on_a_fixture(mongo_replica_set_url, body)

        assert (other.zustand, other.vorschlag, other.beantwortet_von) == ("vorschlag", own.vorschlag, None)
        assert own.zustand == "abgelehnt"
        assert own.vorschlag is not None and (own.vorschlag.datum, own.vorschlag.uhrzeit) == ("2027-05-15", "17:00:00")
        assert own.beantwortet_von is not None and own.beantwortet_von.model_dump() == {"art": "kontakt", "rolle": "trainer"}

    def test_a_link_whose_fixture_moved_states_the_ansetzung_it_asked_about_whole(self, mongo_replica_set_url: str):
        """Moved to another ground and an open day: the old ground and the old day and hour, never the new ground beside the old day."""

        elsewhere = ObjectId("6890a1b2c3d4e5f607d50032")

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            await database[Collection.SPIELORTE].insert_one(
                {
                    "_id": elsewhere,
                    "name": "Halle West",
                    "address": dict(documents.ADDRESS),
                    "maps_link": "Halle West, Frankfurt",
                    "default_mietpreis": 30,
                    "inactive_since": None,
                }
            )
            ort = {"spielort_id": elsewhere, "name": "Halle West", "maps_link": "Halle West, Frankfurt", "mietpreis": 30}
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"ort": ort, "datum": None}})

            return await ansicht(database, token(TEAM1, "trainer"))

        view = on_a_fixture(mongo_replica_set_url, body)

        assert view.zustand == "ungueltig"
        assert view.ansetzung.model_dump(mode="json") == {
            "team1_name": "Adler",
            "team2_name": "Biber",
            "datum": DATUM,
            "uhrzeit": UHRZEIT,
            "spielort": {"spielort_id": str(SPIELORT), "name": "Halle Ost", "maps_link": "Halle Ost, Frankfurt"},
        }

    def test_a_spent_link_is_shown_its_state_and_an_unknown_one_is_refused(self, mongo_replica_set_url: str):
        """Only a token no row holds is refused, by the view and the answer alike; a closed row's link opens its page."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELBESTAETIGUNGEN].update_one(
                {"_id": ROW2}, {"$set": {"geschlossen": {"am": TODAY, "grund": "verworfen"}}}
            )
            closed = await ansicht(database, token(TEAM2, "trainer"))
            unknown = [await outcome_of(ansicht(database, "geraten")), await outcome_of(antworten(database, client, "geraten"))]

            return closed.zustand, unknown

        closed, unknown = on_a_fixture(mongo_replica_set_url, body)

        assert closed == "abgelaufen"
        assert unknown == [ANSETZUNG_TOKEN_UNKNOWN, ANSETZUNG_TOKEN_UNKNOWN]


class ConfirmationsRunningARivalAfterTheRowRead(InterleavedCollection):
    """The confirmations the view reads its row from, a rival run once after that read and before the fixture's."""

    async def find_one(self, *args: Any, **kwargs: Any) -> Any:
        document = await self._collection.find_one(*args, **kwargs)
        await self.run_the_rival()
        return document


class TestAFixtureRemovedBetweenTheViewsTwoReads:
    def test_the_link_opens_nothing_rather_than_answering_500(self, mongo_replica_set_url: str):
        """An undraw or a replace takes the fixture and its rows in one transaction, landing between the view's two reads."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            async def undraw() -> None:
                await database[Collection.SPIELBESTAETIGUNGEN].delete_many({"spiel_id": SPIEL})
                await database[Collection.SPIELE].delete_one({"_id": SPIEL})

            confirmations = ConfirmationsRunningARivalAfterTheRowRead(database[Collection.SPIELBESTAETIGUNGEN], undraw)
            outcome = await outcome_of(ansicht(database, token(TEAM1, "trainer"), spielbestaetigungen=confirmations))

            return outcome, confirmations.passes

        assert on_a_fixture(mongo_replica_set_url, body) == (ANSETZUNG_TOKEN_UNKNOWN, 1)


class ReadsRecorded:
    """A collection keeping every document its `find_one` and its `find` answered.

    Delegating rather than a stub: mongod applies the projection, and a stub would hand back whatever the handler asked for.
    """

    def __init__(self, collection: Any) -> None:
        self._collection = collection
        self.loaded: list[Mapping[str, Any]] = []

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def find_one(self, *args: Any, **kwargs: Any) -> Any:
        document = await self._collection.find_one(*args, **kwargs)
        self.loaded.append(document)
        return document

    def find(self, *args: Any, **kwargs: Any) -> Any:
        return _ListedInto(self._collection.find(*args, **kwargs), self.loaded)


class _ListedInto:
    def __init__(self, cursor: Any, loaded: list[Mapping[str, Any]]) -> None:
        self._cursor, self._loaded = cursor, loaded

    async def to_list(self, length: int | None = None) -> list[Any]:
        documents = await self._cursor.to_list(length=length)
        self._loaded.extend(documents)
        return documents


def leaf_paths(document: Any, prefix: str = "") -> set[str]:
    """Every dotted path this document holds a value at, an empty block counting as one."""

    if not isinstance(document, Mapping) or not document:
        return {prefix} if prefix else set()

    return {path for key, value in document.items() for path in leaf_paths(value, f"{prefix}.{key}" if prefix else key)}


# What each read resolves, spelled out here rather than read off the projections under test. The seat's bare block
# is the other club's, holding nothing: the address the projection removes leaves its parents.
VIEW_FIXTURE_RESOLVES = frozenset(
    {"datum", "uhrzeit", "ort.spielort_id", "ort.name", "ort.maps_link", "ergebnis", "elfmeterschiessen", "sonderereignis"}
    | {f"{slot}.{part}" for slot in ("team1", "team2") for part in ("team_id", "name", "tore")}
)
VIEW_CLUBS_RESOLVE = frozenset({"team_id", "name", "austritt.datum", "kontakte.stellvertretung.email", "kontakte.stellvertretung"})
ANSWER_CLUBS_RESOLVE = frozenset(
    {"team_id", "austritt.datum", "kontakte.trainer.email"}
    | {f"kontakte.{seat}.{part}" for seat in KONTAKT_ROLLEN for part in ("vorname", "nachname")}
)


def addresses_loaded(loaded: list[Mapping[str, Any]]) -> set[tuple[Any, str]]:
    return {(document.get("team_id"), path) for document in loaded for path in leaf_paths(document) if path.endswith(".email")}


class TestWhatAnAnonymousReadLoads:
    """The narrowing alone: a projection too short is `test_spielbestaetigung_refusal.py :: TestTheProjectionsHoldEverythingTheJudgesRead`'s."""

    def test_the_view_holds_the_fixture_it_states_and_one_address_and_no_name(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            spiele = ReadsRecorded(database[Collection.SPIELE])
            saison_teams = ReadsRecorded(database[Collection.SAISON_TEAMS])
            await ansicht(database, token(TEAM1, "stellvertretung"), spiele=spiele, saison_teams=saison_teams)

            return spiele.loaded, saison_teams.loaded

        fixtures, clubs = on_a_fixture(mongo_replica_set_url, body)

        # The premise: each read ran, the clubs' over both sides.
        assert len(fixtures) == 1 and len(clubs) == 2
        assert set().union(*(leaf_paths(document) for document in fixtures)) <= VIEW_FIXTURE_RESOLVES
        assert set().union(*(leaf_paths(document) for document in clubs)) <= VIEW_CLUBS_RESOLVE
        # The seat's own, which the ban list is asked about; never the other club's same seat.
        assert addresses_loaded(clubs) == {(TEAM1, "kontakte.stellvertretung.email")}

    def test_the_answer_holds_the_names_it_judges_and_only_its_own_seats_address(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            saison_teams = ReadsRecorded(database[Collection.SAISON_TEAMS])
            await antworten(database, client, token(TEAM1, "trainer"), saison_teams=saison_teams)

            return saison_teams.loaded

        clubs = on_a_fixture(mongo_replica_set_url, body)

        assert clubs, "the answer's read of the clubs did not run"
        assert set().union(*(leaf_paths(document) for document in clubs)) <= ANSWER_CLUBS_RESOLVE
        assert addresses_loaded(clubs) == {(TEAM1, "kontakte.trainer.email")}


class WritesRecorded:
    """The confirmations a write reaches, every filter the write was sent with kept."""

    def __init__(self, collection: Any) -> None:
        self._collection = collection
        self.filters: list[Mapping[str, Any]] = []

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def find_one_and_update(self, *args: Any, **kwargs: Any) -> Any:
        self.filters.append(kwargs["filter"])
        return await self._collection.find_one_and_update(*args, **kwargs)


class TestTheSeatTheAnswerRecords:
    def test_the_stellvertretung_answers_and_the_trainers_link_then_finds_it_answered(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            answered = await antworten(database, client, token(TEAM1, "stellvertretung"))
            second = await outcome_of(antworten(database, client, token(TEAM1, "trainer")))

            return answered, second, await row_now(database, ROW1), await row_now(database, ROW2)

        answered, second, row, other = on_a_fixture(mongo_replica_set_url, body)

        assert answered.beantwortet_von.model_dump() == {"art": "kontakt", "rolle": "stellvertretung"}
        assert row["antwort"] == {
            "art": "zugesagt",
            "am": TODAY,
            "von": {"art": "kontakt", "rolle": "stellvertretung", "halter": KLARA},
            "vorschlag": None,
            "begruendung": None,
        }
        assert second == ANSETZUNG_BEANTWORTET
        # The other club's row is its own question.
        assert other["antwort"] is None

    def test_the_holder_recorded_is_the_seats_address_as_it_stands_on_the_fold_a_holder_is_told_apart_by(self, mongo_replica_set_url: str):
        """Re-typed since the mint, a spelling the fold reads as the same inbox: the person's erasure must still find the reason."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISON_TEAMS].update_one(
                {"team_id": TEAM1}, {"$set": {"kontakte.stellvertretung.email": " Klara@EXAMPLE.com "}}
            )
            await ablehnen(database, client, token(TEAM1, "stellvertretung"), ("2027-05-15", "18:00:00"), begruendung="Die Halle ist belegt")

            return await row_now(database, ROW1), await ansicht(database, token(TEAM1, "stellvertretung"))

        row, view = on_a_fixture(mongo_replica_set_url, body)

        assert row["antwort"]["von"] == {"art": "kontakt", "rolle": "stellvertretung", "halter": KLARA}
        # Stored for the erasure alone: the reopened link names the role and nothing of the holder.
        assert view.beantwortet_von is not None and view.beantwortet_von.model_dump() == {"art": "kontakt", "rolle": "stellvertretung"}

    def test_a_mirrored_pair_sharing_one_link_records_the_first_seat_in_order(self, mongo_replica_set_url: str):
        """One person on two seats holds one hash: resolved to a seat rather than to nothing."""

        shared = hash_token("ida-zweimal")
        rows = [confirmation(ROW1, TEAM1, hashes={"trainer": [shared], "stellvertretung": [shared]}), confirmation(ROW2, TEAM2)]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await antworten(database, client, "ida-zweimal")

            return await row_now(database, ROW1)

        assert on_a_fixture(mongo_replica_set_url, body, rows=rows)["antwort"]["von"]["rolle"] == "trainer"

    def test_the_write_itself_takes_only_a_row_neither_answered_nor_closed(self, mongo_replica_set_url: str):
        """The first press binds through the write's own filter, which the in-session judgement before it does not replace."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            recorded = WritesRecorded(database[Collection.SPIELBESTAETIGUNGEN])
            await antworten(database, client, token(TEAM1, "trainer"), spielbestaetigungen=recorded)

            return recorded.filters

        [sent] = on_a_fixture(mongo_replica_set_url, body)

        pressed = hash_token(token(TEAM1, "trainer"))

        assert sent == {"$or": [{f"kontakte.{seat}.token_hashes": pressed} for seat in KONTAKT_ROLLEN], "antwort": None, "geschlossen": None}


class TestEveryMailedLinkLivesToTheDeadline:
    @pytest.mark.parametrize("nth", [0, 1, 2], ids=["request", "first-reminder", "second-reminder"])
    def test_each_link_a_seat_was_mailed_still_answers_after_both_reminders(self, mongo_replica_set_url: str, nth: int):
        mailed = {seat: [hash_token(token(TEAM1, seat, n)) for n in range(3)] for seat in KONTAKT_ROLLEN}
        rows = [confirmation(ROW1, TEAM1, hashes=mailed), confirmation(ROW2, TEAM2)]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            view = await ansicht(database, token(TEAM1, "ansprechperson", nth))
            await antworten(database, client, token(TEAM1, "ansprechperson", nth))

            return view.zustand, await row_now(database, ROW1)

        zustand, row = on_a_fixture(mongo_replica_set_url, body, rows=rows)

        assert zustand == "gueltig"
        assert row["antwort"]["von"]["rolle"] == "ansprechperson"


class TestAProposalIsJudgedWhereTheAdminIsJudged:
    """The administrator's three judges, each through the route, and the standing clash the save itself accepts."""

    @pytest.mark.parametrize(
        ("vorschlag", "neighbour", "austritt", "code"),
        [
            pytest.param(("2027-05-20", "18:00:00"), None, None, FIXTURE_OUTSIDE_SPIELTAG, id="outside-the-matchday"),
            # Four hours apart is the buffer; two is inside it, on the referee's other booking.
            pytest.param(
                ("2027-05-15", "20:00:00"), ("2027-05-15", "18:00:00"), None, FIXTURE_DOUBLE_BOOKED, id="beside-the-referees-other-fixture"
            ),
            pytest.param(("2027-05-15", "18:00:00"), None, "2027-05-15", ELIGIBILITY_DISQUALIFIED, id="on-a-clubs-exit"),
        ],
    )
    def test_a_refused_proposal_writes_no_row_and_no_span(
        self, mongo_replica_set_url: str, vorschlag: tuple[str, str], neighbour: tuple[str, str] | None, austritt: str | None, code: str
    ):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if neighbour is not None:
                await database[Collection.SPIELE].insert_one(
                    fixture(NEIGHBOUR, spiel_nr=2, datum=neighbour[0], uhrzeit=neighbour[1], ort=None, team1=None, team2=None)
                )
            if austritt is not None:
                exit_record = {"type": "rueckzug", "grund": "Schule zieht zurück", "datum": austritt}
                await database[Collection.SAISON_TEAMS].update_one({"team_id": TEAM2}, {"$set": {"austritt": exit_record}})

            outcome = await outcome_of(ablehnen(database, client, token(TEAM1, "trainer"), vorschlag))

            return outcome, await row_now(database, ROW1), await database[Collection.SPIELTAGE].find_one({"_id": SPIELTAG})

        outcome, row, spieltag = on_a_fixture(mongo_replica_set_url, body)

        assert outcome == code
        assert row["antwort"] is None
        assert (spieltag["beginn"], spieltag["ende"]) == SPAN

    def test_a_clash_the_fixture_already_stands_in_is_no_reason_to_refuse_the_same_slot(self, mongo_replica_set_url: str):
        """`find_claims_made`'s set: a proposal of the slot the fixture holds makes no claim, as the administrator's save of it makes none."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELE].insert_one(
                fixture(NEIGHBOUR, spiel_nr=2, datum=DATUM, uhrzeit="20:00:00", ort=None, team1=None, team2=None)
            )
            outcome = await outcome_of(ablehnen(database, client, token(TEAM1, "trainer"), (DATUM, UHRZEIT)))

            return outcome, await row_now(database, ROW1)

        outcome, row = on_a_fixture(mongo_replica_set_url, body)

        assert outcome == COMMITTED
        assert row["antwort"]["vorschlag"] == {"datum": DATUM, "uhrzeit": UHRZEIT}


class TestAHandEditedFixtureOfAnotherSeasonAnswersTheRefusal:
    """The booking read validates every season's fixtures, so it sits below every refusal it does not feed.

    Read earlier, a hand-stored `uhrzeit` no read model admits answers 500 where the date rule refuses.
    """

    def test_a_proposal_outside_the_matchday_is_refused_rather_than_raising(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            hand_edited = fixture(HAND_EDITED, spiel_nr=9, saison_id="2026", datum="2027-05-20", uhrzeit="18:00", team1=None, team2=None)
            await database[Collection.SPIELE].insert_one(hand_edited)

            return await outcome_of(ablehnen(database, client, token(TEAM1, "trainer"), ("2027-05-20", "19:00:00")))

        assert on_a_fixture(mongo_replica_set_url, body) == FIXTURE_OUTSIDE_SPIELTAG

    def test_the_premise_the_hand_edited_fixture_does_raise_at_the_booking_read(self, mongo_replica_set_url: str):
        """Inside the matchday the read is reached, and raises: without that the case above proves nothing about the order."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            hand_edited = fixture(HAND_EDITED, spiel_nr=9, saison_id="2026", datum="2027-05-15", uhrzeit="18:00", team1=None, team2=None)
            await database[Collection.SPIELE].insert_one(hand_edited)

            with pytest.raises(ValidationError):
                await ablehnen(database, client, token(TEAM1, "trainer"), ("2027-05-15", "19:00:00"))

        on_a_fixture(mongo_replica_set_url, body)


class TestALinkToAnAddressBarredAfterTheMint:
    def test_the_view_shows_the_ban_the_answer_is_refused_and_a_lift_lets_it_answer(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            ban = documents.ban_document("klara@example.com", bis=SAISON_ID)
            await database[Collection.SPERRLISTE].insert_one(ban)

            view = await ansicht(database, token(TEAM1, "stellvertretung"))
            refused = await outcome_of(antworten(database, client, token(TEAM1, "stellvertretung")))
            unwritten = (await row_now(database, ROW1))["antwort"]
            # Another seat of the same club holds an address the list does not.
            other_seat = (await ansicht(database, token(TEAM1, "trainer"))).zustand

            await database[Collection.SPERRLISTE].delete_one({"_id": ban["_id"]})
            lifted = await outcome_of(antworten(database, client, token(TEAM1, "stellvertretung")))

            return view.zustand, refused, unwritten, other_seat, lifted

        assert on_a_fixture(mongo_replica_set_url, body) == ("gesperrt", ANSETZUNG_GESPERRT, None, "gueltig", COMMITTED)


class TestTheLinkLookupWalksAnIndex:
    """Strangers drive both lookups and the answer's write, so none may scan the collection, on every clause of the seat `$or`."""

    def test_the_view_the_answer_and_its_write_each_plan_an_index_scan_on_every_seat(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _client: AsyncMongoClient) -> Any:
            plans = []
            for call in (
                lambda watched, _watching: ansicht(watched, token(TEAM1, "trainer")),
                lambda watched, watching: antworten(watched, watching, token(TEAM1, "trainer")),
            ):
                _, sent = await plans_of_sent_reads(
                    mongo_replica_set_url,
                    database,
                    call,
                    # A find's `filter`, the write's `query`.
                    lambda collection, command: (
                        collection == Collection.SPIELBESTAETIGUNGEN and "$or" in (command.get("filter") or command.get("query") or {})
                    ),
                )
                plans.append(sent)

            return plans

        [view], [answer, write] = on_a_fixture(mongo_replica_set_url, body)

        # The premise: the view's lookup, the answer's, and its write, or the scans below would pass vacuously.
        for _, plan in (view, answer, write):
            assert "COLLSCAN" not in plan, plan
            assert {f"IXSCAN {{ kontakte.{seat}.token_hashes: 1 }}" for seat in KONTAKT_ROLLEN} <= set(plan.split(", ")), plan


class TestANameInTheReasonLeavesTheRowUnwritten:
    """The two reads the names come from, through the route: the other club's row, a surname, and the fixture's referee."""

    @pytest.mark.parametrize(
        "name",
        [
            pytest.param("Cordes", id="own-club-stellvertretung-surname"),
            pytest.param("Lea", id="other-club-trainer-first-name"),
            pytest.param("Gruber", id="the-booked-referee"),
        ],
    )
    def test_a_name_of_the_fixtures_people_is_refused(self, mongo_replica_set_url: str, name: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            outcome = await outcome_of(
                ablehnen(database, client, token(TEAM1, "trainer"), ("2027-05-15", "18:00:00"), begruendung=f"Leider hat {name} keine Zeit")
            )

            return outcome, (await row_now(database, ROW1))["antwort"]

        assert on_a_fixture(mongo_replica_set_url, body) == (ANSETZUNG_NAME_IN_BEGRUENDUNG, None)

    def test_a_reason_naming_nobody_is_stored(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ablehnen(database, client, token(TEAM1, "trainer"), ("2027-05-15", "18:00:00"), begruendung="Die Halle ist belegt")

            return (await row_now(database, ROW1))["antwort"]["begruendung"]

        assert on_a_fixture(mongo_replica_set_url, body) == "Die Halle ist belegt"


class ConfirmationsRunningARivalBeforeTheWrite(InterleavedCollection):
    """The confirmations the answer writes, a rival run once after the answer's judgement and before its write."""

    async def find_one_and_update(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()
        return await self._collection.find_one_and_update(*args, **kwargs)


class TestAFixtureMovedMidAnswerIsJudgedAgain:
    """The administrator moves the fixture while a club answers: the answer reads the fixture and writes none of it.

    So the move raises no conflict, and only the re-read outside the transaction (`docs/backend/spec.md :: I118`) sees it.
    """

    def test_the_answer_is_refused_on_the_move_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def move() -> None:
                await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"uhrzeit": "19:30:00"}})

            confirmations = ConfirmationsRunningARivalBeforeTheWrite(database[Collection.SPIELBESTAETIGUNGEN], move)
            outcome = await outcome_of(antworten(database, client, token(TEAM1, "trainer"), spielbestaetigungen=confirmations))
            # Once: a second arrival would be a retry, which a write conflict causes and a move must not.
            confirmations.assert_landed_inside(serially=0)

            return outcome, (await row_now(database, ROW1))["antwort"], confirmations.passes

        outcome, antwort, passes = on_a_fixture(mongo_replica_set_url, body)

        assert outcome == ANSETZUNG_GEAENDERT
        assert antwort is None
        assert passes == 1


# A decline every rival below turns into a refusal: inside the matchday, clear of the referee's other bookings, on a day
# both clubs still play, its reason naming nobody.
PROPOSAL = ("2027-05-15", "18:00:00")
REASON = "Leider hat Zora an dem Tag Prüfungen"


async def narrow_the_matchday(database: AsyncDatabase) -> None:
    await database[Collection.SPIELTAGE].update_one({"_id": SPIELTAG}, {"$set": {"ende": "2027-05-14"}})


async def book_the_referee_beside_it(database: AsyncDatabase) -> None:
    await database[Collection.SPIELE].insert_one(
        fixture(NEIGHBOUR, spiel_nr=2, datum=PROPOSAL[0], uhrzeit="19:00:00", ort=None, team1=None, team2=None)
    )


async def let_a_club_leave_before_the_proposal(database: AsyncDatabase) -> None:
    exit_record = {"type": "rueckzug", "grund": "Schule zieht zurück", "datum": PROPOSAL[0]}
    await database[Collection.SAISON_TEAMS].update_one({"team_id": TEAM2}, {"$set": {"austritt": exit_record}})


async def rename_a_seat_to_the_name_in_the_reason(database: AsyncDatabase) -> None:
    await database[Collection.SAISON_TEAMS].update_one({"team_id": TEAM2}, {"$set": {"kontakte.trainer.vorname": "Zora"}})


async def rename_the_referee_to_the_name_in_the_reason(database: AsyncDatabase) -> None:
    await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"schiedsrichter.name": "Zora Gruber"}})


class TestWhatTheProposalIsJudgedOnMovingMidAnswerIsJudgedAgain:
    """Each a write the answer's transaction reads and never writes, so none conflicts: the re-judgement outside it is all that sees them."""

    def test_the_decline_commits_where_nothing_moves(self, mongo_replica_set_url: str):
        """The premise: without its rival each case below would commit."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await outcome_of(ablehnen(database, client, token(TEAM1, "trainer"), PROPOSAL, begruendung=REASON))

        assert on_a_fixture(mongo_replica_set_url, body) == COMMITTED

    @pytest.mark.parametrize(
        ("rival", "code"),
        [
            pytest.param(narrow_the_matchday, FIXTURE_OUTSIDE_SPIELTAG, id="the-matchday-narrowed"),
            pytest.param(book_the_referee_beside_it, FIXTURE_DOUBLE_BOOKED, id="a-rival-booking-of-the-referee"),
            pytest.param(let_a_club_leave_before_the_proposal, ELIGIBILITY_DISQUALIFIED, id="a-club-leaving-before-the-new-day"),
            pytest.param(rename_a_seat_to_the_name_in_the_reason, ANSETZUNG_NAME_IN_BEGRUENDUNG, id="a-seat-renamed"),
            pytest.param(rename_the_referee_to_the_name_in_the_reason, ANSETZUNG_NAME_IN_BEGRUENDUNG, id="the-referee-renamed"),
        ],
    )
    def test_the_answer_is_refused_on_what_moved_and_writes_nothing(
        self, mongo_replica_set_url: str, rival: Callable[[AsyncDatabase], Awaitable[None]], code: str
    ):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            confirmations = ConfirmationsRunningARivalBeforeTheWrite(database[Collection.SPIELBESTAETIGUNGEN], lambda: rival(database))
            outcome = await outcome_of(
                ablehnen(database, client, token(TEAM1, "trainer"), PROPOSAL, begruendung=REASON, spielbestaetigungen=confirmations)
            )
            confirmations.assert_landed_inside(serially=0)

            return outcome, (await row_now(database, ROW1))["antwort"], confirmations.passes

        outcome, antwort, passes = on_a_fixture(mongo_replica_set_url, body)

        assert outcome == code
        assert antwort is None
        # Once: none of these conflicts, so a retry would mean the rival was caught some other way.
        assert passes == 1


class ConfirmationsCountingTheJudgements(ConfirmationsRunningARivalBeforeTheWrite):
    """`ConfirmationsRunningARivalBeforeTheWrite`, counting each time the answer reads its row to judge it."""

    def __init__(self, collection: Any, rival: Any) -> None:
        super().__init__(collection, rival)
        self.judged = 0

    async def find_one(self, *args: Any, **kwargs: Any) -> Any:
        self.judged += 1
        return await self._collection.find_one(*args, **kwargs)


class TestTwoSeatsPressingAtOnce:
    def test_the_second_press_landing_under_the_first_is_one_answer_and_one_refusal(self, mongo_replica_set_url: str):
        """The other seat commits between this press's judgement and its write: the write conflicts, and the retry finds the row answered.

        `docs/backend/spec.md :: I755`, driven rather than reasoned: the answer stored is the seat that committed first.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def the_other_seat_presses() -> None:
                await antworten(database, client, token(TEAM1, "ansprechperson"))

            confirmations = ConfirmationsCountingTheJudgements(database[Collection.SPIELBESTAETIGUNGEN], the_other_seat_presses)
            outcome = await outcome_of(antworten(database, client, token(TEAM1, "trainer"), spielbestaetigungen=confirmations))
            confirmations.assert_landed_inside(serially=0)
            answered = await database[Collection.SPIELBESTAETIGUNGEN].count_documents({"partei.team_id": TEAM1, "antwort": {"$ne": None}})

            return outcome, (await row_now(database, ROW1))["antwort"]["von"]["rolle"], answered, confirmations.judged

        outcome, rolle, answered, judged = on_a_fixture(mongo_replica_set_url, body)

        assert (outcome, rolle, answered) == (ANSETZUNG_BEANTWORTET, "ansprechperson", 1)
        # The premise: the write conflicted and the press was judged afresh. Whether the judgement or the write's filter
        # then refuses it, both answer the same code.
        assert judged == 2


class TestAProposalOfAPastDayIsRefusedThroughTheRoute:
    def test_yesterday_inside_the_matchday_writes_nothing(self, mongo_replica_set_url: str):
        """A deadline of today, as a fixture inside the notice period is minted with.

        The matchday's span admits yesterday, so this rule alone refuses it.
        """

        today = "2027-05-12"

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            outcome = await outcome_of(ablehnen(database, client, token(TEAM1, "trainer"), ("2027-05-11", "18:00:00"), today=today))

            return outcome, await row_now(database, ROW1)

        outcome, row = on_a_fixture(
            mongo_replica_set_url, body, rows=[{**confirmation(ROW1, TEAM1), "frist": today}, confirmation(ROW2, TEAM2)]
        )

        assert outcome == ANSETZUNG_VORSCHLAG_VERGANGEN
        assert row["antwort"] is None


class TestADiscardedDeclineIsNoProposalInFrontOfTheOtherClub:
    def test_the_other_link_opens_as_asked_once_the_decline_is_closed(self, mongo_replica_set_url: str):
        """Closed `verworfen`, which keeps the decline's proposal stored: a read blind to the close serves a discarded date."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ablehnen(database, client, token(TEAM1, "trainer"), ("2027-05-15", "17:00:00"))
            standing = await ansicht(database, token(TEAM2, "trainer"))
            await database[Collection.SPIELBESTAETIGUNGEN].update_one(
                {"_id": ROW1}, {"$set": {"geschlossen": {"am": TODAY, "grund": "verworfen"}}}
            )

            return standing, await ansicht(database, token(TEAM2, "trainer"))

        standing, discarded = on_a_fixture(mongo_replica_set_url, body)

        # The premise: while the decline stood, the other club's link opened on its proposal.
        assert (standing.zustand, standing.vorschlag is not None) == ("vorschlag", True)
        assert (discarded.zustand, discarded.vorschlag) == ("gueltig", None)
