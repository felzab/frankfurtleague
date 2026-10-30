"""
API · a club's fixture confirmation link, opened and answered against the shipped validators and indexes

The view answers every state a link can reach, and the answer writes the row alone: the seat that
pressed, the proposal judged as the administrator's save of that date is judged, and nothing of the
fixture.
"""

import hashlib
import hmac
from collections.abc import Awaitable, Callable, Mapping, Sequence
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pydantic import ValidationError
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.services import hash_token
from app.api.saisons.schemas import FLSaisonRules
from app.api.spielbestaetigungen.admin_router import eintragen_spielbestaetigung, get_spielbestaetigungen, verwerfen_spielbestaetigung
from app.api.spielbestaetigungen.person_router import get_eigene_spielbestaetigungen, post_schiedsrichter_antwort
from app.api.spielbestaetigungen.router import get_spielbestaetigung_ansicht, post_spielbestaetigung
from app.api.spielbestaetigungen.schemas import (
    FLSpielbestaetigungAnsichtPayload,
    FLSpielbestaetigungAnsichtResponse,
    FLSpielbestaetigungAntwortPayload,
    FLSpielbestaetigungAntwortResponse,
    FLSpielbestaetigungEintragenPayload,
    FLSpielbestaetigungenFilterParams,
    FLSpielbestaetigungenListResponse,
    FLSpielbestaetigungSchiedsrichterAntwortPayload,
    FLSpielbestaetigungSchiedsrichterAntwortResponse,
    FLSpielbestaetigungWriteResponse,
)
from app.api.spielbestaetigungen.services import (
    build_held_filter,
)
from app.api.spiele.admin_router import get_spiele_action_required, patch_spiel_data
from app.api.spiele.crud import advance_bracket_winners
from app.api.spiele.schemas import FLPatchSpielDataPayload
from app.api.teams.admin_router import replace_saison_team
from app.api.teams.schemas import FLReplaceSaisonTeamPayload
from app.core.codes import Code
from app.core.collections import Collection
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX
from app.shared.schemas.literals import KONTAKT_ROLLEN
from tests import documents
from tests.bans import ban_list
from tests.config import build_test_config
from tests.database import a_clean_database, on_the_seed_loop
from tests.erasure import erased
from tests.isolation import COMMITTED, InterleavedCollection, outcome_of
from tests.payloads import spiel_patch_body
from tests.plans import plans_of_sent_reads
from tests.records import record_collections
from tests.worker import worker_database

from .test_bewerbung_einwilligung_execution import leaf_paths

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
NAMES = {TEAM1: ("Adler", "ADX"), TEAM2: ("Biber", "BIX")}
REFEREE = "Otto Gruber"

# Spelled out rather than through the code under test: the stellvertretung's address on the sign-in fold, keyed under the
# suite's master by the holder's own label, so an unkeyed digest or another purpose's label fails here.
_HALTER_KEY = hmac.new(build_test_config().sperrliste_schluessel.get_secret_value().encode("utf-8"), b"halter-v1", hashlib.sha256).digest()
KLARA = hmac.new(_HALTER_KEY, b"klara@example.com", hashlib.sha256).hexdigest()


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
        teams_collection=database[Collection.TEAMS],
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
        """Its date and hour alone; the declining club's own link reads its answer and the role that gave it, and no proposal."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ablehnen(database, client, token(TEAM1, "trainer"), ("2027-05-15", "17:00:00"), begruendung="Die Halle ist belegt")

            return await ansicht(database, token(TEAM2, "trainer")), await ansicht(database, token(TEAM1, "stellvertretung"))

        other, own = on_a_fixture(mongo_replica_set_url, body)

        assert other.zustand == "vorschlag" and other.beantwortet_von is None
        assert other.vorschlag is not None and (other.vorschlag.datum, other.vorschlag.uhrzeit) == ("2027-05-15", "17:00:00")
        assert (own.zustand, own.vorschlag) == ("abgelehnt", None)
        assert own.beantwortet_von is not None and own.beantwortet_von.model_dump() == {"art": "kontakt", "rolle": "trainer"}

    def test_a_link_whose_fixture_was_called_off_says_so_whatever_its_club_answered(self, mongo_replica_set_url: str):
        """Ahead of the agreement, which would otherwise send the club to the ground, and before the pass closes the row."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await antworten(database, client, token(TEAM1, "trainer"))
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"sonderereignis": "ausgefallen"}})

            return await ansicht(database, token(TEAM1, "trainer")), await ansicht(database, token(TEAM2, "trainer"))

        agreed, unanswered = on_a_fixture(mongo_replica_set_url, body)

        assert (agreed.zustand, agreed.beantwortet_von, unanswered.zustand) == ("abgesagt", None, "abgesagt")

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
                {"_id": ROW2}, {"$set": {"geschlossen": {"am": TODAY, "grund": "spiel_entschieden"}}}
            )
            closed = await ansicht(database, token(TEAM2, "trainer"))
            unknown = [await outcome_of(ansicht(database, "geraten")), await outcome_of(antworten(database, client, "geraten"))]

            return closed.zustand, unknown

        closed, unknown = on_a_fixture(mongo_replica_set_url, body)

        assert closed == "abgelaufen"
        assert unknown == [Code.ANSETZUNG_TOKEN_UNKNOWN, Code.ANSETZUNG_TOKEN_UNKNOWN]


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

        assert on_a_fixture(mongo_replica_set_url, body) == (Code.ANSETZUNG_TOKEN_UNKNOWN, 1)


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

    def sort(self, *args: Any, **kwargs: Any) -> _ListedInto:
        self._cursor = self._cursor.sort(*args, **kwargs)
        return self

    def limit(self, *args: Any, **kwargs: Any) -> _ListedInto:
        self._cursor = self._cursor.limit(*args, **kwargs)
        return self

    async def to_list(self, length: int | None = None) -> list[Any]:
        documents = await self._cursor.to_list(length=length)
        self._loaded.extend(documents)
        return documents


# What each read resolves, spelled out here rather than read off the projections under test. The seat's bare block
# is the other club's, holding nothing: the address the projection removes leaves its parents.
VIEW_FIXTURE_RESOLVES = frozenset(
    {"datum", "uhrzeit", "ort.spielort_id", "ort.name", "ort.maps_link", "ergebnis", "elfmeterschiessen", "sonderereignis"}
    | {f"{slot}.{part}" for slot in ("team1", "team2") for part in ("team_id", "name", "tore")}
)
VIEW_CLUBS_RESOLVE = frozenset({"team_id", "name", "austritt.datum", "kontakte.stellvertretung.email", "kontakte.stellvertretung"})
ANSWER_CLUBS_RESOLVE = frozenset({"team_id", "name", "austritt.datum", "kontakte.trainer.email", "kontakte.trainer"})


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

    def test_the_answer_loads_no_seat_holders_name_and_only_its_own_seats_address(self, mongo_replica_set_url: str):
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
        assert second == Code.ANSETZUNG_BEANTWORTET
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
            pytest.param(("2027-05-20", "18:00:00"), None, None, Code.FIXTURE_OUTSIDE_SPIELTAG, id="outside-the-matchday"),
            # Four hours apart is the buffer; two is inside it, on the referee's other booking.
            pytest.param(
                ("2027-05-15", "20:00:00"), ("2027-05-15", "18:00:00"), None, Code.FIXTURE_DOUBLE_BOOKED, id="beside-the-referees-other-fixture"
            ),
            pytest.param(("2027-05-15", "18:00:00"), None, "2027-05-15", Code.ELIGIBILITY_DISQUALIFIED, id="on-a-clubs-exit"),
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

        assert on_a_fixture(mongo_replica_set_url, body) == Code.FIXTURE_OUTSIDE_SPIELTAG

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

        assert on_a_fixture(mongo_replica_set_url, body) == ("gesperrt", Code.ANSETZUNG_GESPERRT, None, "gueltig", COMMITTED)


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


class TestAReasonIsStoredAsTyped:
    def test_a_reason_naming_the_fixtures_people_is_stored(self, mongo_replica_set_url: str):
        """The other club's Trainer, a surname of the club's own seat and the booked referee: a reason takes any text."""

        reason = "Leider haben Lea, Cordes und Gruber keine Zeit"

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ablehnen(database, client, token(TEAM1, "trainer"), ("2027-05-15", "18:00:00"), begruendung=reason)

            return (await row_now(database, ROW1))["antwort"]["begruendung"]

        assert on_a_fixture(mongo_replica_set_url, body) == reason


class ConfirmationsRunningARivalBeforeTheWrite(InterleavedCollection):
    """The confirmations the answer writes, a rival run once after the answer's judgement and before its write."""

    async def find_one_and_update(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()
        return await self._collection.find_one_and_update(*args, **kwargs)


class TestAFixtureMovedMidAnswerIsJudgedAgain:
    """The administrator moves the fixture while a club answers: the answer reads the fixture and writes none of it.

    So the move raises no conflict, and only the re-read outside the transaction sees it.
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

        assert outcome == Code.ANSETZUNG_GEAENDERT
        assert antwort is None
        assert passes == 1


# A decline every rival below turns into a refusal: inside the matchday, clear of the referee's other bookings, on a day
# both clubs still play.
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
            pytest.param(narrow_the_matchday, Code.FIXTURE_OUTSIDE_SPIELTAG, id="the-matchday-narrowed"),
            pytest.param(book_the_referee_beside_it, Code.FIXTURE_DOUBLE_BOOKED, id="a-rival-booking-of-the-referee"),
            pytest.param(let_a_club_leave_before_the_proposal, Code.ELIGIBILITY_DISQUALIFIED, id="a-club-leaving-before-the-new-day"),
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

        Driven rather than reasoned: the answer stored is the seat that committed first.
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

        assert (outcome, rolle, answered) == (Code.ANSETZUNG_BEANTWORTET, "ansprechperson", 1)
        # The premise: the write conflicted and the press was judged afresh. Whether the judgement or the write's filter
        # then refuses it, both answer the same code.
        assert judged == 2


class TestALinkToAReplacedClubsFixture:
    def test_the_old_ansetzung_names_the_club_that_left_off_its_own_document(self, mongo_replica_set_url: str):
        """The replacement hands TEAM2's season row and its fixture side to another club, so only `teams` still names Biber."""

        incoming = ObjectId("6890a1b2c3d4e5f607d50003")

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.TEAMS].insert_one(documents.team_document(incoming, "Dachs", "DAX"))
            await replace_saison_team(
                team_id=TEAM2,
                saison_id=SAISON_ID,
                replacement_data=FLReplaceSaisonTeamPayload(incoming_team_id=incoming),
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
                germany_now=datetime(2027, 5, 1, 12, 0, tzinfo=ZoneInfo("Europe/Berlin")),
            )

            return await ansicht(database, token(TEAM1, "trainer"))

        view = on_a_fixture(mongo_replica_set_url, body)

        assert view.zustand == "ungueltig"
        assert (view.ansetzung.team1_name, view.ansetzung.team2_name) == ("Adler", "Biber")


# What a link's own row read resolves: the hashes find the seat, and of an answer which way it went and the role.
LINK_ROW_RESOLVES = frozenset(
    {"_id", "saison_id", "spiel_id", "partei.art", "partei.team_id", "frist", "geschlossen", "antwort.art", "antwort.von.art"}
    | {"antwort.von.rolle", *(f"ansetzung.{key}" for key in ("datum", "uhrzeit", "spielort_id", "team1_id", "team2_id", "stand"))}
    | {f"kontakte.{seat}.token_hashes" for seat in KONTAKT_ROLLEN}
)


class TestWhatALinksOwnRowReadLoads:
    def test_an_answered_rows_reason_proposal_and_holder_stay_in_the_database(self, mongo_replica_set_url: str):
        """Declined with a reason by the trainer, then opened and pressed from the Stellvertretung's link."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ablehnen(database, client, token(TEAM1, "trainer"), ("2027-05-15", "17:00:00"), begruendung="Die Halle ist belegt")
            viewed = ReadsRecorded(database[Collection.SPIELBESTAETIGUNGEN])
            view = await ansicht(database, token(TEAM1, "stellvertretung"), spielbestaetigungen=viewed)
            pressed = ReadsRecorded(database[Collection.SPIELBESTAETIGUNGEN])
            outcome = await outcome_of(antworten(database, client, token(TEAM1, "stellvertretung"), spielbestaetigungen=pressed))

            return view, viewed.loaded[0], outcome, pressed.loaded[0]

        view, viewed, outcome, pressed = on_a_fixture(mongo_replica_set_url, body)

        # The premise: each read met the answered row, and both handlers still read its answer.
        assert view.beantwortet_von is not None and (view.zustand, view.beantwortet_von.model_dump()) == (
            "abgelehnt",
            {"art": "kontakt", "rolle": "trainer"},
        )
        assert outcome == Code.ANSETZUNG_BEANTWORTET
        assert leaf_paths(viewed) <= LINK_ROW_RESOLVES and "antwort.art" in leaf_paths(viewed)
        assert leaf_paths(pressed) <= LINK_ROW_RESOLVES and "antwort.art" in leaf_paths(pressed)


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

        assert outcome == Code.ANSETZUNG_VORSCHLAG_VERGANGEN
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


# --- The ADMINISTRATOR's read, settle and discard, and the queue the confirmations put a fixture in.

SETTLE_REASON = "Telefonisch mit dem Trainer abgestimmt"


async def eintragen(
    database: AsyncDatabase, client: AsyncMongoClient, row_id: ObjectId, *, spielbestaetigungen: Any = None
) -> FLSpielbestaetigungWriteResponse:
    return await eintragen_spielbestaetigung(
        spielbestaetigung_id=row_id,
        eintragen_data=FLSpielbestaetigungEintragenPayload(begruendung=SETTLE_REASON),
        spielbestaetigungen_collection=either(database, Collection.SPIELBESTAETIGUNGEN, spielbestaetigungen),
        db=client,
        today=TODAY,
    )


async def verwerfen(
    database: AsyncDatabase, client: AsyncMongoClient, row_id: ObjectId, *, spielbestaetigungen: Any = None
) -> FLSpielbestaetigungWriteResponse:
    return await verwerfen_spielbestaetigung(
        spielbestaetigung_id=row_id,
        spielbestaetigungen_collection=either(database, Collection.SPIELBESTAETIGUNGEN, spielbestaetigungen),
        spiele_collection=database[Collection.SPIELE],
        db=client,
        today=TODAY,
    )


async def lesen(
    database: AsyncDatabase, *, spiel_id: ObjectId | None = None, spielbestaetigungen: Any = None, limit: int = LIST_LIMIT_DEFAULT
) -> FLSpielbestaetigungenListResponse:
    return await get_spielbestaetigungen(
        spielbestaetigungen_collection=either(database, Collection.SPIELBESTAETIGUNGEN, spielbestaetigungen),
        filters=FLSpielbestaetigungenFilterParams(saison_id=SAISON_ID, spiel_id=spiel_id, limit=limit),
    )


class TestTheAdministratorsZusage:
    def test_it_names_nobody_and_a_seats_link_pressed_after_it_finds_the_row_answered(self, mongo_replica_set_url: str):
        """Key for key: a role or a holder on it would let a person's erasure reach the league's reason."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            settled = await eintragen(database, client, ROW1)
            pressed = await outcome_of(antworten(database, client, token(TEAM1, "trainer")))

            return settled, (await row_now(database, ROW1))["antwort"], pressed

        settled, stored, pressed = on_a_fixture(mongo_replica_set_url, body)

        expected = {"art": "zugesagt", "am": TODAY, "von": {"art": "admin"}, "vorschlag": None, "begruendung": SETTLE_REASON}
        assert stored == expected
        assert settled.updated_document.antwort is not None and settled.updated_document.antwort.model_dump() == expected
        assert pressed == Code.ANSETZUNG_BEANTWORTET

    def test_a_settle_after_a_seats_answer_is_refused_and_the_seats_answer_stands(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await antworten(database, client, token(TEAM1, "stellvertretung"))
            outcome = await outcome_of(eintragen(database, client, ROW1))

            return outcome, (await row_now(database, ROW1))["antwort"]["von"]

        assert on_a_fixture(mongo_replica_set_url, body) == (
            Code.ANSETZUNG_NICHT_EINTRAGBAR,
            {"art": "kontakt", "rolle": "stellvertretung", "halter": KLARA},
        )

    def test_a_seats_answer_landing_inside_the_settle_is_the_one_answer(self, mongo_replica_set_url: str):
        """The seat commits between the settle's read and its write: the write conflicts and the retry's read refuses it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def the_seat_presses() -> None:
                await antworten(database, client, token(TEAM1, "stellvertretung"))

            confirmations = ConfirmationsCountingTheJudgements(database[Collection.SPIELBESTAETIGUNGEN], the_seat_presses)
            outcome = await outcome_of(eintragen(database, client, ROW1, spielbestaetigungen=confirmations))
            confirmations.assert_landed_inside(serially=0)

            return outcome, (await row_now(database, ROW1))["antwort"]["von"], confirmations.judged

        outcome, von, judged = on_a_fixture(mongo_replica_set_url, body)

        assert (outcome, von) == (Code.ANSETZUNG_NICHT_EINTRAGBAR, {"art": "kontakt", "rolle": "stellvertretung", "halter": KLARA})
        # Driven, not reasoned: the rival surfaces as a write conflict, so the refusal is the retry's read and never the filter.
        assert judged == 2


class TestTheDiscard:
    def test_it_closes_the_decline_and_leaves_the_clubs_answer_as_given(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ablehnen(database, client, token(TEAM1, "trainer"), PROPOSAL, begruendung=REASON)
            declined = (await row_now(database, ROW1))["antwort"]
            served = await verwerfen(database, client, ROW1)

            return declined, served, await row_now(database, ROW1)

        declined, served, row = on_a_fixture(mongo_replica_set_url, body)

        # Holding the club its notice that the date stands, the fixture's day being to come.
        assert (row["antwort"], row["geschlossen"]) == (declined, {"am": TODAY, "grund": "verworfen", "mitteilung": {"versuche": 0}})
        assert served.updated_document.geschlossen is not None and served.updated_document.geschlossen.grund == "verworfen"

    def test_the_clubs_link_then_reads_the_leagues_decision(self, mongo_replica_set_url: str):
        """Read as its decline alone, the link would still say the league is to decide, and the club might stay away."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ablehnen(database, client, token(TEAM1, "trainer"), PROPOSAL, begruendung=REASON)
            declined = await ansicht(database, token(TEAM1, "stellvertretung"))
            await verwerfen(database, client, ROW1)

            return declined.zustand, (await ansicht(database, token(TEAM1, "stellvertretung"))).zustand

        assert on_a_fixture(mongo_replica_set_url, body) == ("abgelehnt", "verworfen")

    @pytest.mark.parametrize("agreed", [pytest.param(False, id="open"), pytest.param(True, id="agreed")])
    def test_a_row_no_open_decline_with_a_proposal_is_refused_and_closes_nothing(self, mongo_replica_set_url: str, agreed: bool):
        """Closed `verworfen`, either would be its club's one answer to the Ansetzung."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if agreed:
                await antworten(database, client, token(TEAM1, "trainer"))
            outcome = await outcome_of(verwerfen(database, client, ROW1))

            return outcome, (await row_now(database, ROW1))["geschlossen"]

        assert on_a_fixture(mongo_replica_set_url, body) == (Code.ANSETZUNG_NICHT_VERWERFBAR, None)

    def test_a_close_landing_inside_the_discard_keeps_its_own_reason(self, mongo_replica_set_url: str):
        """The hourly pass shuts the row for a move between the discard's read and its write: refused, the move's reason standing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ablehnen(database, client, token(TEAM1, "trainer"), PROPOSAL, begruendung=REASON)

            async def the_pass_closes_it() -> None:
                await database[Collection.SPIELBESTAETIGUNGEN].update_one(
                    {"_id": ROW1}, {"$set": {"geschlossen": {"am": TODAY, "grund": "ansetzung_geaendert"}}}
                )

            confirmations = ConfirmationsCountingTheJudgements(database[Collection.SPIELBESTAETIGUNGEN], the_pass_closes_it)
            outcome = await outcome_of(verwerfen(database, client, ROW1, spielbestaetigungen=confirmations))
            confirmations.assert_landed_inside(serially=0)

            return outcome, (await row_now(database, ROW1))["geschlossen"]["grund"], confirmations.judged

        assert on_a_fixture(mongo_replica_set_url, body) == (Code.ANSETZUNG_NICHT_VERWERFBAR, "ansetzung_geaendert", 2)

    def test_a_decline_about_an_ansetzung_the_fixture_left_is_refused_and_closes_nothing(self, mongo_replica_set_url: str):
        """Closed `verworfen`, it would spare the row the pass's `ansetzung_geaendert` and its club the move's notice."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ablehnen(database, client, token(TEAM1, "trainer"), PROPOSAL, begruendung=REASON)
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"uhrzeit": "19:30:00"}})
            outcome = await outcome_of(verwerfen(database, client, ROW1))

            return outcome, (await row_now(database, ROW1))["geschlossen"]

        assert on_a_fixture(mongo_replica_set_url, body) == (Code.ANSETZUNG_NICHT_VERWERFBAR, None)

    def test_a_move_landing_inside_the_discard_refuses_it(self, mongo_replica_set_url: str):
        """The discard writes no fixture, so the move raises no conflict: only the re-read outside the transaction sees it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ablehnen(database, client, token(TEAM1, "trainer"), PROPOSAL, begruendung=REASON)

            async def move() -> None:
                await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"uhrzeit": "19:30:00"}})

            confirmations = ConfirmationsRunningARivalBeforeTheWrite(database[Collection.SPIELBESTAETIGUNGEN], move)
            outcome = await outcome_of(verwerfen(database, client, ROW1, spielbestaetigungen=confirmations))
            confirmations.assert_landed_inside(serially=0)

            return outcome, (await row_now(database, ROW1))["geschlossen"], confirmations.passes

        assert on_a_fixture(mongo_replica_set_url, body) == (Code.ANSETZUNG_NICHT_VERWERFBAR, None, 1)


# What the administrator's read resolves of a row: every stored path but a seat's hashes and the answer's holder.
ADMIN_READ_WITHHOLDS = ("token_hashes", "halter")
NEIGHBOURS_ROW = ObjectId("6890a1b2c3d4e5f607d50053")
LAST_SEASONS_ROW = ObjectId("6890a1b2c3d4e5f607d50054")


class TestWhatTheAdministratorsReadServes:
    def test_the_seasons_rows_newest_first_with_no_hash_or_holder_loaded(self, mongo_replica_set_url: str):
        """Asserted on what the driver handed back: the read model declares neither, so a response check passes with no projection."""

        rows = [
            confirmation(ROW1, TEAM1),
            confirmation(ROW2, TEAM2),
            confirmation(NEIGHBOURS_ROW, TEAM1, hashes={}, spiel_id=NEIGHBOUR),
            confirmation(LAST_SEASONS_ROW, TEAM1, hashes={}, saison_id="2026", spiel_id=HAND_EDITED),
        ]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ablehnen(database, client, token(TEAM1, "stellvertretung"), PROPOSAL, begruendung=REASON)
            recorded = ReadsRecorded(database[Collection.SPIELBESTAETIGUNGEN])
            season = await lesen(database, spielbestaetigungen=recorded)

            return season, recorded.loaded, await lesen(database, spiel_id=NEIGHBOUR), await row_now(database, ROW1)

        season, loaded, one_fixture, stored = on_a_fixture(mongo_replica_set_url, body, rows=rows)

        # The premise: the row read holds both in the database.
        assert stored["antwort"]["von"]["halter"] == KLARA and stored["kontakte"]["trainer"]["token_hashes"]
        assert [row.id for row in season.spielbestaetigungen] == [NEIGHBOURS_ROW, ROW2, ROW1]
        assert season.vollstaendig
        assert not [path for document in loaded for path in leaf_paths(document) if path.rsplit(".", 1)[-1] in ADMIN_READ_WITHHOLDS]
        assert [row.id for row in one_fixture.spielbestaetigungen] == [NEIGHBOURS_ROW]

    def test_a_season_holding_more_rows_than_one_read_serves_says_so_and_keeps_every_open_one(self, mongo_replica_set_url: str):
        """Cut by age alone, the read would drop the overdue row first, the oldest still open.

        The page is the caller's, so two of three closed rows cut it, and `vollstaendig` says so.
        """

        closed = {"geschlossen": {"am": TODAY, "grund": "ansetzung_geaendert"}}
        overdue = {**confirmation(ObjectId("6890a1b2c3d4e5f600000000"), TEAM2, hashes={}), "frist": "2027-04-30"}
        rows = [overdue, *(confirmation(ObjectId(f"6890a1b2c3d4e5f6{index:08x}"), TEAM1, hashes={}, **closed) for index in range(1, 4))]

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> FLSpielbestaetigungenListResponse:
            return await lesen(database, limit=2)

        served = on_a_fixture(mongo_replica_set_url, body, rows=rows)

        assert ([row.id for row in served.spielbestaetigungen], served.vollstaendig) == (
            [rows[3]["_id"], rows[2]["_id"], overdue["_id"]],
            False,
        )

    def test_a_row_closing_between_the_two_reads_is_served_closed(self, mongo_replica_set_url: str):
        """Served open, the row offers the administrator a press its close refuses."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            async def close() -> None:
                await database[Collection.SPIELBESTAETIGUNGEN].update_one(
                    {"_id": ROW1}, {"$set": {"geschlossen": {"am": TODAY, "grund": "ansetzung_geaendert"}}}
                )

            confirmations = ConfirmationsRunningARivalAfterTheFirstRead(database[Collection.SPIELBESTAETIGUNGEN], close)
            served = await lesen(database, spielbestaetigungen=confirmations)

            return served, confirmations.passes

        served, passes = on_a_fixture(mongo_replica_set_url, body)

        # The premise: both reads went through the collection, so the close landed after the first and before the second.
        assert passes == 2
        assert [(row.id, row.geschlossen and row.geschlossen.grund) for row in served.spielbestaetigungen] == [
            (ROW2, None),
            (ROW1, "ansetzung_geaendert"),
        ]


class ConfirmationsRunningARivalAfterTheFirstRead(InterleavedCollection):
    """The confirmations the administrator's read lists, a rival run once as soon as the first of its reads has answered."""

    def find(self, *args: Any, **kwargs: Any) -> Any:
        return _RivalAfterTheList(self._collection.find(*args, **kwargs), self.run_the_rival)


class _RivalAfterTheList:
    def __init__(self, cursor: Any, rival: Callable[[], Awaitable[None]]) -> None:
        self._cursor, self._rival = cursor, rival

    def sort(self, *args: Any, **kwargs: Any) -> _RivalAfterTheList:
        self._cursor = self._cursor.sort(*args, **kwargs)
        return self

    def limit(self, *args: Any, **kwargs: Any) -> _RivalAfterTheList:
        self._cursor = self._cursor.limit(*args, **kwargs)
        return self

    async def to_list(self, length: int | None = None) -> list[Any]:
        documents = await self._cursor.to_list(length=length)
        await self._rival()
        return documents


DECLINE = {
    "art": "abgelehnt",
    "am": TODAY,
    "von": {"art": "kontakt", "rolle": "trainer", "halter": None},
    "vorschlag": {"datum": PROPOSAL[0], "uhrzeit": PROPOSAL[1]},
    "begruendung": None,
}


class TestTheQueueListsAFixtureItsConfirmationsPutThere:
    """The fixture lacks nothing the other conditions list, so a confirmation is the only way onto the page."""

    @pytest.mark.parametrize(
        ("row1", "today", "moved", "listed"),
        [
            pytest.param({}, TODAY, False, False, id="asked-and-still-in-time"),
            pytest.param({"antwort": DECLINE}, TODAY, False, True, id="a-standing-proposal"),
            pytest.param({}, "2027-05-08", False, True, id="a-deadline-passed-unanswered"),
            pytest.param({"angefragt_am": FRIST}, FRIST, False, True, id="due-the-day-it-was-asked"),
            pytest.param({"angefragt_am": None}, FRIST, False, True, id="due-today-and-never-asked"),
            pytest.param({}, FRIST, False, False, id="due-today-and-asked-days-ago"),
            pytest.param({"antwort": DECLINE}, TODAY, True, False, id="a-proposal-about-an-ansetzung-left"),
            pytest.param(
                {"antwort": DECLINE, "geschlossen": {"am": TODAY, "grund": "verworfen"}}, TODAY, False, False, id="a-discarded-proposal"
            ),
        ],
    )
    def test_the_fixture_is_listed_where_a_clubs_row_asks_for_the_administrator(
        self, mongo_replica_set_url: str, row1: dict[str, Any], today: str, moved: bool, listed: bool
    ):
        # The other club agreed, so ROW1 alone decides; the referee's row is overdue whatever the case, and lists nothing.
        agreed = {"antwort": {**DECLINE, "art": "zugesagt", "vorschlag": None}}
        referee = documents.spielbestaetigung_document(
            fixture(),
            partei={"art": "schiedsrichter", "schiedsrichter_id": SCHIEDSRICHTER},
            frist="2027-04-30",
            angefragt_am=TODAY,
            kontakte=None,
        )
        rows = [{**confirmation(ROW1, TEAM1), **row1}, confirmation(ROW2, TEAM2, **agreed), referee]

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> set[Any]:
            if moved:
                await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"uhrzeit": "19:30:00"}})
            queue = await get_spiele_action_required(
                spiele_collection=database[Collection.SPIELE],
                teams_collection=database[Collection.TEAMS],
                saisons_collection=database[Collection.SAISONS],
                spielorte_collection=database[Collection.SPIELORTE],
                schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
                spielberichte_collection=database[Collection.SPIELBERICHTE],
                saison_id=SAISON_ID,
                today=today,
            )

            return {spiel.id for spiel in queue.spiele}

        assert on_a_fixture(mongo_replica_set_url, body, rows=rows) == ({SPIEL} if listed else set())


# The answering Trainer's address, and the clock their erasure stamps its redactions with.
IDA = "ida@example.com"
ERASED_AT = datetime(2027, 5, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))


class ConfirmationsRunningARivalBeforeTheFirstFanOut(InterleavedCollection):
    """The confirmations an erasure writes, a rival run once ahead of its first fan-out, the void of the person's seats."""

    async def update_many(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()
        return await self._collection.update_many(*args, **kwargs)


class TestAnAnswerAndItsWritersErasureCross:
    """The answer writes its row and the erasure voids the writer's entry on it, so one retries.

    Neither anchors the address: a holder digest stored under an erasure's snapshot would stand until the season's end.
    """

    def test_an_erasure_landing_inside_the_answer_leaves_the_link_dead_and_nothing_stored(self, mongo_replica_set_url: str):
        """The answer run again finds no seat holding its link: the void took it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def erase_the_trainer() -> None:
                await erased(database, client, IDA, germany_now=ERASED_AT)

            confirmations = ConfirmationsRunningARivalBeforeTheWrite(database[Collection.SPIELBESTAETIGUNGEN], erase_the_trainer)
            outcome = await outcome_of(
                ablehnen(database, client, token(TEAM1, "trainer"), PROPOSAL, begruendung=REASON, spielbestaetigungen=confirmations)
            )

            return outcome, confirmations.passes, await row_now(database, ROW1)

        outcome, passes, row = on_a_fixture(mongo_replica_set_url, body)

        # The premise: the erasure ran once, inside the answer's transaction, ahead of its write.
        assert passes == 1
        assert (outcome, row["antwort"], row["kontakte"]["trainer"]) == (Code.ANSETZUNG_TOKEN_UNKNOWN, None, None)

    def test_an_answer_landing_inside_the_erasure_has_its_reason_and_digest_taken(self, mongo_replica_set_url: str):
        """The erasure run again finds the digest the answer stored, and nulls it with the reason; the way and the role stay."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def answer_as_the_trainer() -> None:
                await ablehnen(database, client, token(TEAM1, "trainer"), PROPOSAL, begruendung=REASON)

            confirmations = ConfirmationsRunningARivalBeforeTheFirstFanOut(database[Collection.SPIELBESTAETIGUNGEN], answer_as_the_trainer)
            await erased(database, client, IDA, germany_now=ERASED_AT, spielbestaetigungen_collection=confirmations)

            return confirmations, await row_now(database, ROW1)

        confirmations, row = on_a_fixture(mongo_replica_set_url, body)

        # Serially, the erasure's void and its reasons' write: a third arrival is the void run again after the conflict.
        confirmations.assert_landed_inside(serially=2)
        assert (row["antwort"]["art"], row["antwort"]["von"]) == ("abgelehnt", {"art": "kontakt", "rolle": "trainer", "halter": None})
        assert (row["antwort"]["begruendung"], row["kontakte"]["trainer"]) == (None, None)


# --- A REFEREE'S OWN ROWS: the panel's read and the referee's answer, signed in on the person lane.

OTTO = "otto@example.com"
# A second referee, booked nowhere, so whatever row they reach is somebody else's.
UTE = ObjectId("6890a1b2c3d4e5f607d50042")
UTE_ADDRESS = "ute@example.com"
REFEREE_ROW = ObjectId("6890a1b2c3d4e5f607d50061")
# Minted before `REFEREE_ROW`, as a row about a slot the fixture has left was.
EARLIER_ROW = ObjectId("6890a1b2c3d4e5f607d50060")
NO_SUCH_ROW = ObjectId("6890a1b2c3d4e5f607d50069")
DECLINE_REASON = "An dem Abend habe ich Prüfungen"

# After the club rows' deadline and before the fixture's day: a club's answer is late here, a referee's is not.
PAST_THE_FRIST = "2027-05-10"
# A day before the fixture's, which a moved row may have asked about.
EARLIER_DAY = "2027-05-13"
DAY_AFTER = "2027-05-15"

# A knockout pair beside the fixture: the quarter-final is played and its winner not yet carried into the semi-final, so a
# resolution of the season would write the semi-final.
VIERTELFINALE = ObjectId("6890a1b2c3d4e5f607d50014")
HALBFINALE = ObjectId("6890a1b2c3d4e5f607d50015")
DUE_RESOLUTION = [
    fixture(
        VIERTELFINALE,
        spiel_nr=21,
        saison_phase="viertelfinale",
        schiedsrichter=None,
        ergebnis="2:1",
        team1={**side(TEAM1), "tore": 2},
        team2={**side(TEAM2), "tore": 1},
    ),
    fixture(
        HALBFINALE,
        spiel_nr=22,
        saison_phase="halbfinale",
        schiedsrichter=None,
        team1=None,
        team1_quelle={"type": "spiel", "spiel_nr": 21, "ausgang": "sieger"},
    ),
]


def confirmed_consent() -> dict[str, Any]:
    return documents.eigene_einwilligung_document(text_version="2026-10-schiedsrichterseite-4", bestaetigt_am="2027-04-01")


def referee_row(row_id: ObjectId = REFEREE_ROW, *, schiedsrichter_id: ObjectId = SCHIEDSRICHTER, **fields: Any) -> dict[str, Any]:
    """The open, mailed row the pass minted for the fixture's referee about `fixture()`'s Ansetzung."""

    return documents.spielbestaetigung_document(
        fixture(),
        partei={"art": "schiedsrichter", "schiedsrichter_id": schiedsrichter_id},
        _id=row_id,
        frist=FRIST,
        angefragt_am=TODAY,
        kontakte=None,
        **fields,
    )


def on_a_refereed_fixture(url: str, body: Body, *, rows: list[dict[str, Any]] | None = None, spiele: Sequence[dict[str, Any]] = ()) -> Any:
    """`on_a_fixture` with its referee confirmed, Ute confirmed and booked nowhere, and the referee's row beside the clubs'."""

    async def seeded(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER}, {"$set": {"einwilligung": confirmed_consent()}})
        await database[Collection.SCHIEDSRICHTER].insert_one(
            documents.schiedsrichter_document(UTE, email=UTE_ADDRESS, name="Ute Lang", default_payment=20, einwilligung=confirmed_consent())
        )
        if spiele:
            await database[Collection.SPIELE].insert_many(list(spiele))

        return await body(database, client)

    return on_a_fixture(url, seeded, rows=rows if rows is not None else [confirmation(ROW1, TEAM1), confirmation(ROW2, TEAM2), referee_row()])


async def eigene(database: AsyncDatabase, client: AsyncMongoClient, *, identifier: str = OTTO, today: str = TODAY) -> Any:
    return await get_eigene_spielbestaetigungen(
        identifier=identifier,
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        spiele_collection=database[Collection.SPIELE],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spielorte_collection=database[Collection.SPIELORTE],
        teams_collection=database[Collection.TEAMS],
        records=record_collections(database),
        db=client,
        today=today,
    )


async def einsatz_antworten(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    row_id: ObjectId = REFEREE_ROW,
    *,
    antwort: str = "zugesagt",
    begruendung: str | None = None,
    identifier: str = OTTO,
    today: str = TODAY,
    spielbestaetigungen: Any = None,
) -> FLSpielbestaetigungSchiedsrichterAntwortResponse:
    return await post_schiedsrichter_antwort(
        spielbestaetigung_id=row_id,
        antwort_data=FLSpielbestaetigungSchiedsrichterAntwortPayload.model_validate({"antwort": antwort, "begruendung": begruendung}),
        identifier=identifier,
        spielbestaetigungen_collection=either(database, Collection.SPIELBESTAETIGUNGEN, spielbestaetigungen),
        spiele_collection=database[Collection.SPIELE],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        records=record_collections(database),
        db=client,
        today=today,
    )


async def absagen(database: AsyncDatabase, client: AsyncMongoClient, **kwargs: Any) -> Any:
    return await einsatz_antworten(database, client, antwort="abgelehnt", begruendung=DECLINE_REASON, **kwargs)


async def spiel_now(database: AsyncDatabase, spiel_id: ObjectId = SPIEL) -> Mapping[str, Any]:
    stored = await database[Collection.SPIELE].find_one({"_id": spiel_id})
    assert stored is not None

    return stored


class TestARefereesDeclineReturnsTheFixture:
    def test_the_slot_alone_empties_and_the_season_is_resolved_by_nobody(self, mongo_replica_set_url: str):
        """The semi-final's due winner is the case: a decline running the season's resolution would write it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await spiel_now(database)
            await absagen(database, client)
            after, halbfinale = await spiel_now(database), await spiel_now(database, HALBFINALE)

            # The premise: the resolution is due, so a decline that ran it would have filled the semi-final.
            async def resolve(session: Any) -> Any:
                rules = FLSaisonRules.model_validate(documents.rules_document())
                return await advance_bracket_winners(database[Collection.SPIELE], database[Collection.TEAMS], SAISON_ID, rules, session)

            async with client.start_session() as session:
                await session.with_transaction(resolve)

            return before, after, halbfinale, await spiel_now(database, HALBFINALE), await row_now(database, REFEREE_ROW)

        before, after, halbfinale, resolved, row = on_a_refereed_fixture(mongo_replica_set_url, body, spiele=DUE_RESOLUTION)

        assert after == {**before, "schiedsrichter": None}
        assert halbfinale["team1"] is None and resolved["team1"]["team_id"] == TEAM1
        assert row["antwort"] == {
            "art": "abgelehnt",
            "am": TODAY,
            "von": {"art": "schiedsrichter"},
            "vorschlag": None,
            "begruendung": DECLINE_REASON,
        }
        assert row["geschlossen"] == {"am": TODAY, "grund": "schiedsrichter_abgelehnt"}

    def test_the_panel_reads_the_closed_row_as_the_referees_own_decline(self, mongo_replica_set_url: str):
        """Closed in the decline's write, the row must not read `ungueltig`, which a referee change ranks ahead of any answer."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await absagen(database, client)

            return (await eigene(database, client)).spielbestaetigungen

        (eintrag,) = on_a_refereed_fixture(mongo_replica_set_url, body)

        assert (eintrag.id, eintrag.zustand, eintrag.begruendung, eintrag.eingetragen) == (REFEREE_ROW, "abgelehnt", DECLINE_REASON, False)

    def test_booking_the_same_referee_again_leaves_them_unheld(self, mongo_replica_set_url: str):
        """Held, the declined row would keep the next pass from asking them about the booking at all."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await absagen(database, client)
            await database[Collection.SPIELE].update_one(
                {"_id": SPIEL}, {"$set": {"schiedsrichter": {"schiedsrichter_id": SCHIEDSRICHTER, "name": REFEREE, "payment": 20}}}
            )

            return await database[Collection.SPIELBESTAETIGUNGEN].count_documents(
                {**build_held_filter(saison_id=SAISON_ID, spiel_ids=[SPIEL]), "partei.art": "schiedsrichter"}
            )

        assert on_a_refereed_fixture(mongo_replica_set_url, body) == 0


# Enough of the season's other referees' rows that a walk of the season-leading index costs the planner a season.
OTHER_REFEREES_ROWS = 2000

REFEREE_INDEX_SCAN = "IXSCAN { partei.schiedsrichter_id: 1, saison_id: 1 }"


def reads_a_referees_rows(collection: str, command: Mapping[str, Any]) -> bool:
    """The panel's aggregate and the erasure's, each matching the referee's id first."""

    stages = command.get("pipeline") or [{}]
    return collection == Collection.SPIELBESTAETIGUNGEN and "partei.schiedsrichter_id" in (stages[0].get("$match") or {})


class TestARefereesOwnRowsAreReadThroughTheirIndex:
    """`fl_backend/app/core/constraints.py :: SUPPORT_INDEXES`'s referee index, which nothing else would keep the planner on."""

    @pytest.mark.parametrize(
        "read",
        [
            pytest.param(lambda watched, watching: eigene(watched, watching), id="the panel"),
            pytest.param(lambda watched, watching: erased(watched, watching, OTTO, germany_now=ERASED_AT), id="the erasure"),
        ],
    )
    def test_the_read_walks_the_referee_index_past_a_season_of_other_rows(
        self, mongo_replica_set_url: str, read: Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]
    ):
        others = [
            documents.spielbestaetigung_document(
                fixture(ObjectId(), spiel_nr=100 + position),
                partei={"art": "schiedsrichter", "schiedsrichter_id": ObjectId()},
                kontakte=None,
            )
            for position in range(OTHER_REFEREES_ROWS)
        ]

        async def body(database: AsyncDatabase, _client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELBESTAETIGUNGEN].insert_many(others)
            _, sent = await plans_of_sent_reads(mongo_replica_set_url, database, read, reads_a_referees_rows)

            return sent

        sent = on_a_refereed_fixture(mongo_replica_set_url, body)

        # The premise: the read was sent, or the plan below would pass vacuously.
        assert sent, "the read sent no aggregate matching the referee's id"
        for _, plan in sent:
            assert plan == REFEREE_INDEX_SCAN, plan


async def book_ute(database: AsyncDatabase) -> None:
    await database[Collection.SPIELE].update_one(
        {"_id": SPIEL}, {"$set": {"schiedsrichter": {"schiedsrichter_id": UTE, "name": "Ute Lang", "payment": 20}}}
    )


class TestAReassignmentLandingMidAnswer:
    def test_an_acceptance_is_refused_on_the_re_read(self, mongo_replica_set_url: str):
        """The acceptance writes no fixture, so the reassignment raises no conflict: the re-read outside it alone refuses."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            confirmations = ConfirmationsRunningARivalBeforeTheWrite(database[Collection.SPIELBESTAETIGUNGEN], lambda: book_ute(database))
            outcome = await outcome_of(einsatz_antworten(database, client, spielbestaetigungen=confirmations))
            confirmations.assert_landed_inside(serially=0)

            return outcome, (await row_now(database, REFEREE_ROW))["antwort"], confirmations.passes

        assert on_a_refereed_fixture(mongo_replica_set_url, body) == (Code.ANSETZUNG_GEAENDERT, None, 1)

    def test_a_decline_never_takes_the_new_referee_off(self, mongo_replica_set_url: str):
        """The decline writes the fixture the reassignment wrote, so it is retried and judged afresh rather than emptying Ute's slot."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            confirmations = ConfirmationsRunningARivalBeforeTheWrite(database[Collection.SPIELBESTAETIGUNGEN], lambda: book_ute(database))
            outcome = await outcome_of(absagen(database, client, spielbestaetigungen=confirmations))
            confirmations.assert_landed_inside(serially=0)

            return outcome, (await spiel_now(database))["schiedsrichter"]["schiedsrichter_id"], await row_now(database, REFEREE_ROW)

        outcome, booked, row = on_a_refereed_fixture(mongo_replica_set_url, body)

        assert (outcome, booked) == (Code.ANSETZUNG_GEAENDERT, UTE)
        assert (row["antwort"], row["geschlossen"]) == (None, None)


async def speichern(
    database: AsyncDatabase, client: AsyncMongoClient, geladen: Mapping[str, Any], *, spiele: Any = None, **overrides: Any
) -> Any:
    """The administrator's save from an editor that loaded `geladen`, changing what `overrides` names."""

    return await patch_spiel_data(
        spiel_id=SPIEL,
        spiel_data=FLPatchSpielDataPayload.model_validate(spiel_patch_body(geladen, **overrides)),
        db=client,
        spiele_collection=either(database, Collection.SPIELE, spiele),
        teams_collection=database[Collection.TEAMS],
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spieltage_collection=database[Collection.SPIELTAGE],
        spielorte_collection=database[Collection.SPIELORTE],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        spielberichte_collection=database[Collection.SPIELBERICHTE],
        dry_run=False,
    )


class FixturesRunningARivalBeforeTheSave(InterleavedCollection):
    """The fixtures the save writes, a rival run once after the save's judgement and before its write."""

    async def find_one_and_update(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()
        return await self._collection.find_one_and_update(*args, **kwargs)


class TestASaveFromAnEditorOpenedBeforeTheDecline:
    """`REQ-BOOKING-003`: the wholesale save carries the referee its editor loaded, so it never books a decliner again unasked."""

    def test_a_save_keeping_the_referee_who_declined_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            geladen = await spiel_now(database)
            await absagen(database, client)
            outcome = await outcome_of(speichern(database, client, geladen, notiz="Halle umgebucht"))

            return outcome, await spiel_now(database)

        outcome, stored = on_a_refereed_fixture(mongo_replica_set_url, body)

        assert (outcome, stored["schiedsrichter"], stored["notiz"]) == (Code.BOOKING_REFEREE_MOVED, None, "Flutlicht")

    @pytest.mark.parametrize(
        ("loaded_after", "referee"),
        [
            pytest.param(True, SCHIEDSRICHTER, id="the decliner again, from an editor loaded after the decline"),
            pytest.param(False, UTE, id="another referee, from the editor opened before it"),
        ],
    )
    def test_a_booking_decided_on_the_empty_slot_lands(self, mongo_replica_set_url: str, loaded_after: bool, referee: ObjectId):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            vorher = await spiel_now(database)
            await absagen(database, client)
            geladen = await spiel_now(database) if loaded_after else vorher
            await speichern(database, client, geladen, schiedsrichter={"schiedsrichter_id": referee, "payment": 20})

            return (await spiel_now(database))["schiedsrichter"]["schiedsrichter_id"]

        assert on_a_refereed_fixture(mongo_replica_set_url, body) == referee

    def test_a_decline_landing_mid_save_refuses_the_retry(self, mongo_replica_set_url: str):
        """Both write the fixture, so the save conflicts and its retry judges the slot the decline left."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            geladen = await spiel_now(database)
            fixtures = FixturesRunningARivalBeforeTheSave(database[Collection.SPIELE], lambda: absagen(database, client))
            outcome = await outcome_of(speichern(database, client, geladen, spiele=fixtures, notiz="Halle umgebucht"))
            fixtures.assert_landed_inside(serially=0)

            return outcome, (await spiel_now(database))["schiedsrichter"], fixtures.passes

        assert on_a_refereed_fixture(mongo_replica_set_url, body) == (Code.BOOKING_REFEREE_MOVED, None, 1)


class TestARowAnswersOnlyToItsOwnReferee:
    """`REQ-FUNKTION-001` and `REQ-ANSETZUNG-015` pinned apart: holding no referee Funktion, and holding one this row does not name."""

    def test_the_referee_named_answers_their_own_row(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            answered = await einsatz_antworten(database, client)

            return answered, await row_now(database, REFEREE_ROW)

        answered, row = on_a_refereed_fixture(mongo_replica_set_url, body)

        assert (answered.spielbestaetigung_id, answered.zustand) == (REFEREE_ROW, "zugesagt")
        assert (row["antwort"]["art"], row["antwort"]["von"], row["geschlossen"]) == ("zugesagt", {"art": "schiedsrichter"}, None)

    @pytest.mark.parametrize(
        ("identifier", "row_id"),
        [
            pytest.param(UTE_ADDRESS, REFEREE_ROW, id="another referee's row"),
            pytest.param(OTTO, NO_SUCH_ROW, id="an id naming no row"),
            pytest.param(OTTO, ROW1, id="a club's row"),
        ],
    )
    def test_a_row_naming_none_of_the_addresss_records_is_refused(self, mongo_replica_set_url: str, identifier: str, row_id: ObjectId):
        """Every row compared whole, the one the press named among them: watching one row alone would miss a write to another."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            confirmations = database[Collection.SPIELBESTAETIGUNGEN]
            before = await confirmations.find().sort("_id", 1).to_list(length=None)
            outcome = await outcome_of(einsatz_antworten(database, client, row_id, identifier=identifier))

            return outcome, await confirmations.find().sort("_id", 1).to_list(length=None) == before

        assert on_a_refereed_fixture(mongo_replica_set_url, body) == (Code.ANSETZUNG_FREMDE_ZEILE, True)

    def test_a_row_of_a_season_ended_since_is_refused_as_none_of_theirs(self, mongo_replica_set_url: str):
        """The panel lists the active seasons' rows alone: answered, a decline would empty a slot of the archive."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISONS].update_one({"_id": SAISON_ID}, {"$set": {"status": "past"}})
            outcome = await outcome_of(absagen(database, client))

            return outcome, (await row_now(database, REFEREE_ROW))["antwort"], (await spiel_now(database))["schiedsrichter"] is not None

        assert on_a_refereed_fixture(mongo_replica_set_url, body) == (Code.ANSETZUNG_FREMDE_ZEILE, None, True)

    @pytest.mark.parametrize(
        "record",
        [
            pytest.param({"einwilligung": None}, id="their record unconfirmed"),
            pytest.param({"inactive_since": "2027-04-20"}, id="their record retired"),
        ],
    )
    def test_the_referee_named_holding_no_funktion_is_refused_first(self, mongo_replica_set_url: str, record: dict[str, Any]):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER}, {"$set": record})
            outcome = await outcome_of(einsatz_antworten(database, client))

            return outcome, (await row_now(database, REFEREE_ROW))["antwort"]

        assert on_a_refereed_fixture(mongo_replica_set_url, body) == (Code.FUNKTION_NICHT_GEHALTEN, None)


class TestARefereeAnswersUntilTheDayNotTheDeadline:
    """The Einteilung names no deadline: a club row of the same fixture is late where the referee's is not."""

    def test_past_the_rows_deadline_the_referee_still_answers(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            (offen,) = (await eigene(database, client, today=PAST_THE_FRIST)).spielbestaetigungen
            answered = await einsatz_antworten(database, client, today=PAST_THE_FRIST)
            # The control: the club's row, the same deadline stored, refuses on the same day.
            club = await outcome_of(antworten(database, client, token(TEAM1, "trainer"), today=PAST_THE_FRIST))

            return offen.zustand, answered.zustand, club

        assert on_a_refereed_fixture(mongo_replica_set_url, body) == ("gueltig", "zugesagt", Code.ANSETZUNG_FRIST_VORBEI)

    def test_after_the_fixtures_day_the_answer_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await outcome_of(einsatz_antworten(database, client, today=DAY_AFTER))

        assert on_a_refereed_fixture(mongo_replica_set_url, body) == Code.ANSETZUNG_FRIST_VORBEI


def a_booking(spiel_id: ObjectId, row_id: ObjectId, datum: str, *, saison_id: str = SAISON_ID, **fields: Any) -> tuple[dict, dict]:
    """Another fixture booked to the referee, and their row about it, answered or not as `fields` say."""

    spiel = fixture(spiel_id, spiel_nr=int(str(row_id)[-2:]), saison_id=saison_id, datum=datum)
    row = documents.spielbestaetigung_document(
        spiel,
        partei={"art": "schiedsrichter", "schiedsrichter_id": SCHIEDSRICHTER},
        _id=row_id,
        frist=datum,
        angefragt_am=TODAY,
        kontakte=None,
        **fields,
    )

    return spiel, row


ZUGESAGT = {"art": "zugesagt", "am": TODAY, "von": {"art": "schiedsrichter"}, "vorschlag": None, "begruendung": None}


class TestTheRefereesOwnRows:
    def test_one_card_per_fixture_its_current_request(self, mongo_replica_set_url: str):
        """The row about the slot the fixture left was minted first, and the fresh request answers alone.

        Another referee's row of the same fixture is not theirs at all.
        """

        moved = {**referee_row()["ansetzung"], "datum": EARLIER_DAY, "uhrzeit": "17:00:00", "stand": "alt"}
        earlier = referee_row(EARLIER_ROW, ansetzung=moved, geschlossen={"am": TODAY, "grund": "ansetzung_geaendert"})
        utes = referee_row(ObjectId("6890a1b2c3d4e5f607d50063"), schiedsrichter_id=UTE)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return (await eigene(database, client)).spielbestaetigungen

        eintraege = on_a_refereed_fixture(mongo_replica_set_url, body, rows=[confirmation(ROW1, TEAM1), earlier, referee_row(), utes])

        assert [(eintrag.id, eintrag.zustand, eintrag.ansetzung.datum) for eintrag in eintraege] == [(REFEREE_ROW, "gueltig", DATUM)]

    def test_a_moved_row_still_its_fixtures_newest_names_the_slot_it_asked_about(self, mongo_replica_set_url: str):
        """Moved past the answer window, so no fresh request exists: the card shows what the referee was asked, not the new slot."""

        other_ground = ObjectId("6890a1b2c3d4e5f607d50032")
        asked = referee_row()["ansetzung"]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELORTE].insert_one(
                {
                    "_id": other_ground,
                    "name": "Halle West",
                    "address": dict(documents.ADDRESS),
                    "maps_link": "Halle West, Frankfurt",
                    "default_mietpreis": 40,
                    "inactive_since": None,
                }
            )
            await database[Collection.SPIELE].update_one(
                {"_id": SPIEL},
                {
                    "$set": {
                        "datum": "2027-07-01",
                        "uhrzeit": "19:30:00",
                        "ort": {"spielort_id": other_ground, "name": "Halle West", "maps_link": "Halle West, Frankfurt", "mietpreis": 40},
                    }
                },
            )
            return (await eigene(database, client)).spielbestaetigungen

        (eintrag,) = on_a_refereed_fixture(mongo_replica_set_url, body)

        assert (eintrag.zustand, eintrag.ansetzung.datum, eintrag.ansetzung.uhrzeit) == ("ungueltig", asked["datum"], asked["uhrzeit"])
        assert eintrag.ansetzung.spielort is not None
        assert eintrag.ansetzung.spielort.name == "Halle Ost"

    def test_a_fixture_moved_past_one_reads_worth_of_rows_is_still_one_card(self, mongo_replica_set_url: str):
        """Its history rows outrun one read, its fixtures do not: the cap counts the cards the panel shows."""

        moved = {**referee_row()["ansetzung"], "datum": EARLIER_DAY, "stand": "alt"}
        history = [
            referee_row(
                ObjectId(f"6890a1b2c3d4e5f6070{number:05x}"), ansetzung=moved, geschlossen={"am": TODAY, "grund": "ansetzung_geaendert"}
            )
            for number in range(LIST_LIMIT_MAX)
        ]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return (await eigene(database, client)).spielbestaetigungen

        eintraege = on_a_refereed_fixture(mongo_replica_set_url, body, rows=[*history, referee_row()])

        assert [(eintrag.id, eintrag.zustand) for eintrag in eintraege] == [(REFEREE_ROW, "gueltig")]

    def test_the_read_walks_the_referees_index(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _client: AsyncMongoClient) -> Any:
            return await plans_of_sent_reads(
                mongo_replica_set_url,
                database,
                eigene,
                lambda collection, command: collection == Collection.SPIELBESTAETIGUNGEN and "pipeline" in command,
            )

        _, [(_, plan)] = on_a_refereed_fixture(mongo_replica_set_url, body)

        assert plan == "IXSCAN { partei.schiedsrichter_id: 1, saison_id: 1 }", plan

    def test_the_days_to_come_first_open_ahead_then_the_days_gone_by_latest_first(self, mongo_replica_set_url: str):
        """By day alone a past fixture would lead an upcoming one, and a season's twelfth past card the next Saturday's.

        An open booking dated after an agreed one leads it: by day alone it would sit below.
        """

        open_later_spiel, open_later = a_booking(ObjectId("6890a1b2c3d4e5f607d50020"), ObjectId("6890a1b2c3d4e5f607d50068"), "2027-05-27")
        later_spiel, later = a_booking(
            ObjectId("6890a1b2c3d4e5f607d50016"), ObjectId("6890a1b2c3d4e5f607d50064"), "2027-05-20", antwort=ZUGESAGT
        )
        long_ago_spiel, long_ago = a_booking(
            ObjectId("6890a1b2c3d4e5f607d50017"), ObjectId("6890a1b2c3d4e5f607d50065"), "2027-04-03", antwort=ZUGESAGT
        )
        lately_spiel, lately = a_booking(
            ObjectId("6890a1b2c3d4e5f607d50018"), ObjectId("6890a1b2c3d4e5f607d50066"), "2027-04-24", antwort=ZUGESAGT
        )

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return (await eigene(database, client)).spielbestaetigungen

        eintraege = on_a_refereed_fixture(
            mongo_replica_set_url,
            body,
            rows=[referee_row(), later, long_ago, lately, open_later],
            spiele=[later_spiel, long_ago_spiel, lately_spiel, open_later_spiel],
        )

        assert [(eintrag.id, eintrag.vergangen) for eintrag in eintraege] == [
            (REFEREE_ROW, False),
            (open_later["_id"], False),
            (later["_id"], False),
            (lately["_id"], True),
            (long_ago["_id"], True),
        ]

    def test_a_row_of_a_season_ended_since_is_not_listed(self, mongo_replica_set_url: str):
        """The panel lists the seasons the pass asks in; a past season's booking is the archive's."""

        past_spiel, past_row = a_booking(
            ObjectId("6890a1b2c3d4e5f607d50019"), ObjectId("6890a1b2c3d4e5f607d50067"), "2026-05-14", saison_id="2026"
        )

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISONS].insert_one(documents.saison_document("2026", "past"))
            return (await eigene(database, client)).spielbestaetigungen

        eintraege = on_a_refereed_fixture(mongo_replica_set_url, body, rows=[referee_row(), past_row], spiele=[past_spiel])

        assert [eintrag.id for eintrag in eintraege] == [REFEREE_ROW]

    # A no-show entered before the day decides the fixture, yet nobody is due at the ground either.
    @pytest.mark.parametrize("sonderereignis", ["annulliert", "nichtantreten_team2"])
    def test_an_agreed_fixture_called_off_reads_as_called_off(self, mongo_replica_set_url: str, sonderereignis: str):
        """Ahead of the agreement, before the pass has closed the row: a referee checking the panel must not travel."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"sonderereignis": sonderereignis}})
            return (await eigene(database, client)).spielbestaetigungen

        (eintrag,) = on_a_refereed_fixture(mongo_replica_set_url, body, rows=[referee_row(antwort=ZUGESAGT)])

        assert eintrag.zustand == "abgesagt"

    def test_the_leagues_zusage_is_marked_and_its_reason_not_theirs_to_read(self, mongo_replica_set_url: str):
        """The settle recorded through its endpoint, so the row is one a writer leaves."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await eintragen(database, client, REFEREE_ROW)

            return (await eigene(database, client)).spielbestaetigungen

        (eintrag,) = on_a_refereed_fixture(mongo_replica_set_url, body)

        assert (eintrag.zustand, eintrag.begruendung, eintrag.eingetragen) == ("zugesagt", None, True)

    def test_an_address_holding_no_live_confirmed_record_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER}, {"$set": {"einwilligung": None}})

            return await outcome_of(eigene(database, client))

        assert on_a_refereed_fixture(mongo_replica_set_url, body) == Code.FUNKTION_NICHT_GEHALTEN
