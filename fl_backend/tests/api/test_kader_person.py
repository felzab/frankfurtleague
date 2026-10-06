"""
API · a team's squad as its own contact seats read and change it, through the mounted person routes

Driven over HTTP with a person-lane actor token, so the binder, its ban read and the handler's own
seat re-derivation all run as a representative's request meets them. The captaincy's race alone
calls the handler directly, a rival committing inside the season's anchor.
"""

import functools
from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from fastapi import FastAPI
from httpx2 import Response
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.identitaet.services import FUNKTION_NICHT_GEHALTEN
from app.api.spieler.person_router import patch_kader_zeile
from app.api.spieler.schemas import FLPatchKaderZeilePayload
from app.api.spieler.services import KADER_STUFE_NICHT_ERLAUBT, SQUAD_ROLLE_TAKEN
from app.api.teams.schemas import KONTAKT_ROLLEN
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.exception_handlers import PAYLOAD_REFUSED
from app.core.exceptions import DOCUMENT_NOT_FOUND
from app.core.security import PERSON_BARRED
from app.main import create_app
from tests.actor_tokens import SignedActor
from tests.app_client import app_client
from tests.config import ADMIN_KEY
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import ban_document, rules_document, saison_document, saison_spieler_document, saison_team_document, spieler_document
from tests.isolation import COMMITTED, InterleavedCollection, outcome_of
from tests.records import record_collections
from tests.worker import worker_database

from .conftest import config_for

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_kader_person_test")

PAST_SAISON = "2425"
ACTIVE_SAISON = "2526"
FUTURE_SAISON = "2627"

TODAY = "2026-04-01"
NOW = datetime(2026, 4, 1, 12, tzinfo=ZoneInfo("Europe/Berlin"))

TEAM_A = ObjectId("6890a1b2c3d4e5f607910001")
TEAM_B = ObjectId("6890a1b2c3d4e5f607910002")
TEAM_C = ObjectId("6890a1b2c3d4e5f607910003")

# Team A's squad in the active season: two live rows sharing a shirt, one wearing `07` beside them,
# an ausgetragen row wearing the shared number too, and the captain among the live ones.
KAPITAEN = ObjectId("6890a1b2c3d4e5f607920001")
TEILT_DIE_SIEBEN = ObjectId("6890a1b2c3d4e5f607920002")
NULL_SIEBEN = ObjectId("6890a1b2c3d4e5f607920003")
AUSGETRAGEN = ObjectId("6890a1b2c3d4e5f607920004")
# Outside the season's list, written before the season narrowed it.
ALTE_STUFE = ObjectId("6890a1b2c3d4e5f607920005")
# Team B's and team C's own pupils.
B_PUPIL = ObjectId("6890a1b2c3d4e5f607920011")
C_PUPIL = ObjectId("6890a1b2c3d4e5f607920012")

ERLAUBTE_STUFEN = ["Q1", "Q2"]

# One mailbox per seat, spelled so that a hit cannot be a coincidence.
ANSPRECH = "ansprech.kader@schule.de"
TRAINER_ALLEIN = "trainer.kader@schule.de"
GROSS_STORED = "Gross.Kader@Schule.de"
GROSS_ASKED = "GROSS.KADER@schule.DE"
B_ANSPRECH = "b.ansprech.kader@schule.de"
GESPERRT = "gesperrt.kader@schule.de"

SEAT_TELEFON = "+49 69 5550199"
PUPIL_EMAIL_DOMAIN = "schueler.example.de"

KADER_PATH = f"/api/v{API_VERSION}/spieler/kader"

PAYLOAD: Mapping[str, Any] = {"nummer": "11", "position": "Tor", "stufe": "Q1", "rolle": None}


def _seat(email: str) -> dict[str, Any]:
    return {
        "vorname": "Anna",
        "nachname": "Müller",
        "email": email,
        "telefon": SEAT_TELEFON,
        "einwilligung": {
            "umfang": "kontaktdaten",
            "erfasst_von": "person",
            "text_version": "v1",
            "datum": "2026-01-05",
            "bestaetigt_am": "2026-01-06",
        },
    }


def _junction(saison_id: str, team_id: ObjectId, name: str, **slots: dict[str, Any]) -> dict[str, Any]:
    return saison_team_document(
        saison_id, team_id, name, name[:2].upper(), kontakte={**{slot: None for slot in KONTAKT_ROLLEN}, **slots, "trainer_ist_zugleich": None}
    )


def _saison(saison_id: str, status: str) -> dict[str, Any]:
    return saison_document(
        saison_id,
        status,
        start_date=f"20{saison_id[:2]}-08-01",
        end_date=f"20{saison_id[2:]}-06-30",
        rules=rules_document(erlaubte_stufen=list(ERLAUBTE_STUFEN)),
    )


def _pupil(spieler_id: ObjectId, vorname: str, nachname: str) -> dict[str, Any]:
    # An address on the person row, so a read that joined one in would carry it.
    return spieler_document(spieler_id, vorname, nachname, email=f"{vorname.lower()}@{PUPIL_EMAIL_DOMAIN}")


def _row(spieler_id: ObjectId, team_id: ObjectId, **fields: Any) -> dict[str, Any]:
    return saison_spieler_document(spieler_id, ACTIVE_SAISON, team_id, **fields)


async def _seed(database: AsyncDatabase) -> None:
    await database[Collection.SAISONS].insert_many(
        [_saison(PAST_SAISON, "past"), _saison(ACTIVE_SAISON, "active"), _saison(FUTURE_SAISON, "future")]
    )
    await database[Collection.SAISON_TEAMS].insert_many(
        [
            _junction(
                ACTIVE_SAISON,
                TEAM_A,
                "Adler",
                trainer=_seat(TRAINER_ALLEIN),
                ansprechperson=_seat(ANSPRECH),
                stellvertretung=_seat(GROSS_STORED),
            ),
            # The same seat holder on a `past` season, which grants no panel, and a season holding none of theirs.
            _junction(PAST_SAISON, TEAM_A, "Adler", ansprechperson=_seat(ANSPRECH)),
            _junction(FUTURE_SAISON, TEAM_A, "Adler", ansprechperson=_seat(B_ANSPRECH)),
            _junction(ACTIVE_SAISON, TEAM_B, "Biber", ansprechperson=_seat(B_ANSPRECH)),
            _junction(ACTIVE_SAISON, TEAM_C, "Kranich", ansprechperson=_seat(GESPERRT)),
        ]
    )
    await database[Collection.SPIELER].insert_many(
        [
            _pupil(KAPITAEN, "Karla", "Kapitänsdóttir-Weber"),
            _pupil(TEILT_DIE_SIEBEN, "Tom", "Siebenstein"),
            _pupil(NULL_SIEBEN, "Nora", "Nullsieben"),
            _pupil(AUSGETRAGEN, "Ali", "Ausgetragen"),
            _pupil(ALTE_STUFE, "Olga", "Oberstufe"),
            _pupil(B_PUPIL, "Bea", "Biber"),
            _pupil(C_PUPIL, "Cem", "Kranich"),
        ]
    )
    await database[Collection.SAISON_SPIELER].insert_many(
        [
            _row(KAPITAEN, TEAM_A, nummer="7", rolle="kapitaen"),
            _row(TEILT_DIE_SIEBEN, TEAM_A, nummer="7"),
            _row(NULL_SIEBEN, TEAM_A, nummer="07"),
            _row(AUSGETRAGEN, TEAM_A, nummer="7", inactive_since="2026-02-01"),
            _row(ALTE_STUFE, TEAM_A, nummer="12", stufe="Q4"),
            _row(B_PUPIL, TEAM_B, nummer="3"),
            _row(C_PUPIL, TEAM_C, nummer="4"),
        ]
    )
    await database[Collection.SPERRLISTE].insert_one(ban_document(GESPERRT, bis=FUTURE_SAISON))


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body) -> Any:
    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await _seed(database)

            return await body(database, client)

    return on_the_seed_loop(_run())


@functools.cache
def _served() -> FastAPI:
    """One app for every case serving through it, built on first use rather than at import."""

    return create_app(config_for(DATABASE_NAME))


def as_person(email: str) -> SignedActor:
    return SignedActor(email, ADMIN_KEY, lane="person")


def squad_url(team_id: ObjectId = TEAM_A, saison_id: str = ACTIVE_SAISON) -> str:
    return f"{KADER_PATH}/{team_id}/{saison_id}"


def row_url(spieler_id: ObjectId, team_id: ObjectId = TEAM_A, saison_id: str = ACTIVE_SAISON) -> str:
    return f"{squad_url(team_id, saison_id)}/{spieler_id}"


async def send(url: str, method: str, path: str, email: str, body: Mapping[str, Any] | None = None) -> Response:
    async with app_client(url, app=_served(), now=NOW) as http:
        return await http.request(method, path, headers=as_person(email), json=body)


async def stored(database: AsyncDatabase) -> tuple[list[Any], list[Any]]:
    """Every squad row and every season as they stand, so a refused request can be shown to have written neither."""

    return (
        await database[Collection.SAISON_SPIELER].find({}, sort=[("spieler_id", 1), ("saison_id", 1)]).to_list(),
        await database[Collection.SAISONS].find({}, sort=[("_id", 1)]).to_list(),
    )


def answered(response: Response) -> tuple[int, str | None]:
    return response.status_code, response.json().get("error_code")


def refused_and_untouched(
    url: str, method: str, path: str, email: str, body: Mapping[str, Any] | None = None
) -> tuple[tuple[int, str | None], bool]:
    async def run(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[tuple[int, str | None], bool]:
        before = await stored(database)
        response = await send(url, method, path, email, body)

        return answered(response), before == await stored(database)

    return on_a_league(url, run)


class TestTheSquadRead:
    """What a seat holder is served: whole surnames, the shirt marker, the season's Stufen, and nobody's address."""

    def _read(self, url: str, email: str) -> Response:
        return on_a_league(url, lambda database, client: send(url, "GET", squad_url(), email))

    def test_a_seat_holder_reads_every_row_of_the_squad_with_whole_surnames(self, mongo_replica_set_url: str):
        response = self._read(mongo_replica_set_url, ANSPRECH)

        assert response.status_code == 200, response.text
        body = response.json()
        rows = {row["spieler_id"]: row for row in body["kader"]}

        assert set(rows) == {str(spieler_id) for spieler_id in (KAPITAEN, TEILT_DIE_SIEBEN, NULL_SIEBEN, AUSGETRAGEN, ALTE_STUFE)}
        assert rows[str(KAPITAEN)]["nachname"] == "Kapitänsdóttir-Weber"
        assert rows[str(KAPITAEN)]["rolle"] == "kapitaen"
        assert rows[str(AUSGETRAGEN)]["inactive_since"] == "2026-02-01"
        assert body["erlaubte_stufen"] == ERLAUBTE_STUFEN
        assert (body["team_id"], body["saison_id"]) == (str(TEAM_A), ACTIVE_SAISON)

    def test_the_shirt_marker_compares_live_rows_by_the_stored_string(self, mongo_replica_set_url: str):
        """`7` twice live is marked; `07` is another shirt; the ausgetragen `7` wears nothing and marks nothing."""

        response = self._read(mongo_replica_set_url, ANSPRECH)
        marked = {row["spieler_id"]: row["nummer_doppelt"] for row in response.json()["kader"]}

        assert marked == {
            str(KAPITAEN): True,
            str(TEILT_DIE_SIEBEN): True,
            str(NULL_SIEBEN): False,
            str(AUSGETRAGEN): False,
            str(ALTE_STUFE): False,
        }

    def test_no_address_and_no_telephone_reaches_the_body_at_any_depth(self, mongo_replica_set_url: str):
        """The serialised body scanned whole, so a nested carrier no model field names is caught too."""

        text = self._read(mongo_replica_set_url, ANSPRECH).text

        assert "@" not in text
        assert PUPIL_EMAIL_DOMAIN not in text
        assert SEAT_TELEFON not in text
        assert "telefon" not in text
        assert "email" not in text
        assert "einwilligung" not in text

    def test_an_identifier_stored_in_another_case_reads_the_squad(self, mongo_replica_set_url: str):
        response = self._read(mongo_replica_set_url, GROSS_ASKED)

        assert response.status_code == 200, response.text
        assert len(response.json()["kader"]) == 5


# Each operation, as the request that would otherwise succeed: the row is team A's own.
OPERATIONS = [
    pytest.param("GET", lambda team_id, saison_id: squad_url(team_id, saison_id), None, id="GET"),
    pytest.param("PATCH", lambda team_id, saison_id: row_url(TEILT_DIE_SIEBEN, team_id, saison_id), PAYLOAD, id="PATCH"),
    pytest.param("DELETE", lambda team_id, saison_id: row_url(TEILT_DIE_SIEBEN, team_id, saison_id), None, id="DELETE"),
]

# A seat on team B asking for team A; team A's seat holder asking for a season of team A they hold
# no seat in; and for one whose seat they hold on a `past` season, which grants no panel.
ELSEWHERE = [
    pytest.param(B_ANSPRECH, TEAM_A, ACTIVE_SAISON, id="another team"),
    pytest.param(ANSPRECH, TEAM_A, FUTURE_SAISON, id="another season of the same team"),
    pytest.param(ANSPRECH, TEAM_A, PAST_SAISON, id="a past season"),
]


class TestASeatNotHeld:
    """`REQ-FUNKTION-001`, judged by each handler itself: drop the check from one and its three cases go red."""

    @pytest.mark.parametrize(("method", "path", "body"), OPERATIONS)
    @pytest.mark.parametrize(("email", "team_id", "saison_id"), ELSEWHERE)
    def test_each_operation_is_refused_and_writes_nothing(
        self,
        mongo_replica_set_url: str,
        method: str,
        path: Callable[[ObjectId, str], str],
        body: Mapping[str, Any] | None,
        email: str,
        team_id: ObjectId,
        saison_id: str,
    ):
        answer, untouched = refused_and_untouched(mongo_replica_set_url, method, path(team_id, saison_id), email, body)

        assert answer == (403, FUNKTION_NICHT_GEHALTEN)
        assert untouched

    def test_the_control_the_same_seat_reads_its_own_team(self, mongo_replica_set_url: str):
        """A refusal answered to everybody would pass the case above on every row."""

        answer, _ = refused_and_untouched(mongo_replica_set_url, "GET", squad_url(), ANSPRECH)

        assert answer[0] == 200


class TestAnotherTeamsPupil:
    """Team A's seat holder naming team B's pupil under team A's path: the row filter carries the team, so nothing matches."""

    @pytest.mark.parametrize(("method", "body"), [("PATCH", PAYLOAD), ("DELETE", None)], ids=["PATCH", "DELETE"])
    def test_a_write_answers_not_found_and_writes_nothing(self, mongo_replica_set_url: str, method: str, body: Mapping[str, Any] | None):
        answer, untouched = refused_and_untouched(mongo_replica_set_url, method, row_url(B_PUPIL), ANSPRECH, body)

        assert answer == (404, DOCUMENT_NOT_FOUND)
        assert untouched

    def test_a_patch_is_not_found_before_any_rule_judges_the_other_team_s_row(self, mongo_replica_set_url: str):
        """A Stufe the season refuses, so a filter without the team finds team B's row and answers 409 rather than 404.

        The case above cannot tell: there the read-back after the write answers 404 whatever the filter matched.
        """

        answer, untouched = refused_and_untouched(mongo_replica_set_url, "PATCH", row_url(B_PUPIL), ANSPRECH, {**PAYLOAD, "stufe": "E1"})

        assert answer == (404, DOCUMENT_NOT_FOUND)
        assert untouched


# A live row of team A whose `spieler` record a hand edit removed.
ORPHAN = ObjectId("6890a1b2c3d4e5f607920021")


class TestARowWhosePersonIsGone:
    """Answered as a missed row rather than a server fault, the transaction undoing the write it follows."""

    @pytest.mark.parametrize(("method", "body"), [("PATCH", PAYLOAD), ("DELETE", None)], ids=["PATCH", "DELETE"])
    def test_a_write_answers_not_found_and_writes_nothing(self, mongo_replica_set_url: str, method: str, body: Mapping[str, Any] | None):
        async def run(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[tuple[int, str | None], bool]:
            await database[Collection.SAISON_SPIELER].insert_one(_row(ORPHAN, TEAM_A, nummer="5"))
            before = await stored(database)
            response = await send(mongo_replica_set_url, method, row_url(ORPHAN), ANSPRECH, body)

            return answered(response), before == await stored(database)

        answer, untouched = on_a_league(mongo_replica_set_url, run)

        assert answer == (404, DOCUMENT_NOT_FOUND)
        assert untouched


class TestAnAusgetragenRow:
    """Read-only to a representative: only the administrator's reactivate brings it back."""

    @pytest.mark.parametrize(("method", "body"), [("PATCH", PAYLOAD), ("DELETE", None)], ids=["PATCH", "DELETE"])
    def test_a_write_answers_not_found_and_writes_nothing(self, mongo_replica_set_url: str, method: str, body: Mapping[str, Any] | None):
        answer, untouched = refused_and_untouched(mongo_replica_set_url, method, row_url(AUSGETRAGEN), ANSPRECH, body)

        assert answer == (404, DOCUMENT_NOT_FOUND)
        assert untouched


class TestABarredSeatHolder:
    """The binder's ban read, on every method: the seat on team C stands, and the person is still refused."""

    @pytest.mark.parametrize(
        ("method", "path", "body"),
        [("GET", squad_url(TEAM_C), None), ("PATCH", row_url(C_PUPIL, TEAM_C), PAYLOAD), ("DELETE", row_url(C_PUPIL, TEAM_C), None)],
        ids=["GET", "PATCH", "DELETE"],
    )
    def test_each_operation_is_refused_and_writes_nothing(
        self, mongo_replica_set_url: str, method: str, path: str, body: Mapping[str, Any] | None
    ):
        answer, untouched = refused_and_untouched(mongo_replica_set_url, method, path, GESPERRT, body)

        assert answer == (403, PERSON_BARRED)
        assert untouched


class TestATrainerOnlySeat:
    """Every operation open to the Trainer's seat exactly as to the Ansprechperson's: the case that goes red if a check narrows by slot."""

    def test_it_reads_edits_all_four_fields_and_austraegt(self, mongo_replica_set_url: str):
        async def run(database: AsyncDatabase, _: AsyncMongoClient) -> list[tuple[int, Any]]:
            read = await send(mongo_replica_set_url, "GET", squad_url(), TRAINER_ALLEIN)
            edit = await send(
                mongo_replica_set_url,
                "PATCH",
                row_url(TEILT_DIE_SIEBEN),
                TRAINER_ALLEIN,
                {"nummer": "9", "position": "Tor", "stufe": "Q1", "rolle": "co_kapitaen"},
            )
            out = await send(mongo_replica_set_url, "DELETE", row_url(NULL_SIEBEN), TRAINER_ALLEIN)

            return [(response.status_code, response.json()) for response in (read, edit, out)]

        (read_status, _), (edit_status, edited), (out_status, out) = on_a_league(mongo_replica_set_url, run)

        assert (read_status, edit_status, out_status) == (200, 200, 200)
        assert {key: edited[key] for key in ("nummer", "position", "stufe", "rolle")} == {
            "nummer": "9",
            "position": "Tor",
            "stufe": "Q1",
            "rolle": "co_kapitaen",
        }
        assert out["inactive_since"] == TODAY


class TestAnEdit:
    def test_the_four_fields_are_written_and_the_rest_of_the_row_stays(self, mongo_replica_set_url: str):
        async def run(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[Response, Any]:
            response = await send(mongo_replica_set_url, "PATCH", row_url(TEILT_DIE_SIEBEN), ANSPRECH, {**PAYLOAD, "nummer": "07"})

            return response, await database[Collection.SAISON_SPIELER].find_one({"spieler_id": TEILT_DIE_SIEBEN})

        response, row = on_a_league(mongo_replica_set_url, run)

        assert response.status_code == 200, response.text
        assert (row["nummer"], row["position"], row["stufe"], row["rolle"]) == ("07", "Tor", "Q1", None)
        assert (row["team_id"], row["ist_nachnominiert"], row["inactive_since"]) == (TEAM_A, False, None)
        # Now wearing `07` beside `NULL_SIEBEN`, judged against the squad after the write.
        assert response.json()["nummer_doppelt"] is True

    @pytest.mark.parametrize("extra", [{"team_id": str(TEAM_B)}, {"ist_nachnominiert": True}], ids=["team_id", "ist_nachnominiert"])
    def test_a_field_the_payload_does_not_declare_is_refused_and_nothing_is_written(self, mongo_replica_set_url: str, extra: Mapping[str, Any]):
        answer, untouched = refused_and_untouched(mongo_replica_set_url, "PATCH", row_url(TEILT_DIE_SIEBEN), ANSPRECH, {**PAYLOAD, **extra})

        assert answer == (422, PAYLOAD_REFUSED)
        assert untouched


class TestAStufeTheSeasonDoesNotOffer:
    """`REQ-SQUAD-005`: a server refusal, the form's offer being no rule."""

    def test_a_stufe_outside_the_season_s_list_is_refused_and_nothing_is_written(self, mongo_replica_set_url: str):
        answer, untouched = refused_and_untouched(
            mongo_replica_set_url, "PATCH", row_url(TEILT_DIE_SIEBEN), ANSPRECH, {**PAYLOAD, "stufe": "E1"}
        )

        assert answer == (409, KADER_STUFE_NICHT_ERLAUBT)
        assert untouched

    @pytest.mark.parametrize("stufe", ["Q4", None], ids=["the stored one", "none"])
    def test_the_stufe_the_row_already_holds_and_none_pass(self, mongo_replica_set_url: str, stufe: str | None):
        """A season narrowed after the row was written leaves the row editable, its own Stufe included."""

        answer, _ = refused_and_untouched(mongo_replica_set_url, "PATCH", row_url(ALTE_STUFE), ANSPRECH, {**PAYLOAD, "stufe": stufe})

        assert answer[0] == 200


class TestTheCaptaincy:
    def test_a_rolle_another_live_row_holds_is_refused_and_nothing_is_written(self, mongo_replica_set_url: str):
        answer, untouched = refused_and_untouched(
            mongo_replica_set_url, "PATCH", row_url(TEILT_DIE_SIEBEN), ANSPRECH, {**PAYLOAD, "rolle": "kapitaen"}
        )

        assert answer == (409, SQUAD_ROLLE_TAKEN)
        assert untouched

    def test_two_edits_naming_one_rolle_leave_one_holder(self, mongo_replica_set_url: str):
        """A rival edit commits inside this one, before its anchor or, where it takes none, before its count.

        Without the captaincy's own anchor, this route taking no cap's, both commit.
        """

        async def give_the_armband(
            database: AsyncDatabase, client: AsyncMongoClient, spieler_id: ObjectId, saisons: Any, squad_rows: Any = None
        ) -> Any:
            return await patch_kader_zeile(
                team_id=TEAM_A,
                saison_id=ACTIVE_SAISON,
                spieler_id=spieler_id,
                zeile_data=FLPatchKaderZeilePayload(nummer=None, position=None, stufe=None, rolle="co_kapitaen"),
                identifier=ANSPRECH,
                saison_spieler_collection=squad_rows if squad_rows is not None else database[Collection.SAISON_SPIELER],
                saisons_collection=saisons,
                records=record_collections(database, saisons_collection=saisons),
                db=client,
            )

        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, int, int]:
            async def the_rival_takes_the_armband() -> None:
                await give_the_armband(database, client, NULL_SIEBEN, database[Collection.SAISONS])

            seasons = SeasonsRunningARivalAtTheAnchor(database[Collection.SAISONS], the_rival_takes_the_armband)
            squad_rows = SquadRowsRunningTheSameRival(database[Collection.SAISON_SPIELER], seasons)
            outcome = await outcome_of(give_the_armband(database, client, TEILT_DIE_SIEBEN, seasons, squad_rows))
            holders = await database[Collection.SAISON_SPIELER].count_documents(
                {"saison_id": ACTIVE_SAISON, "team_id": TEAM_A, "rolle": "co_kapitaen", "inactive_since": None}
            )

            return outcome, holders, seasons.passes

        outcome, holders, passes = on_a_league(mongo_replica_set_url, run)

        assert passes >= 1, "the rival never ran, so the edit was raced by nobody"
        assert (outcome, holders) == (SQUAD_ROLLE_TAKEN, 1), (
            f"the edit answered {outcome!r} ({COMMITTED!r} is no refusal), leaving {holders} holders"
        )


class SeasonsRunningARivalAtTheAnchor(InterleavedCollection):
    """A `saisons` stand-in running one rival just before the captaincy's anchor write."""

    async def update_many(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()

        return await self._collection.update_many(*args, **kwargs)


class SquadRowsRunningTheSameRival:
    """A `saison_spieler` stand-in handing the captaincy's count to the season stand-in's one-shot rival.

    So a write taking no anchor still meets the rival inside its transaction, where it can only miss it.
    """

    def __init__(self, collection: Any, seasons: SeasonsRunningARivalAtTheAnchor) -> None:
        self._collection = collection
        self._seasons = seasons

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def count_documents(self, *args: Any, **kwargs: Any) -> Any:
        await self._seasons.run_the_rival()

        return await self._collection.count_documents(*args, **kwargs)


class TestAustragen:
    def test_it_stamps_the_row_and_leaves_the_person(self, mongo_replica_set_url: str):
        async def run(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[Response, Any, Any]:
            response = await send(mongo_replica_set_url, "DELETE", row_url(TEILT_DIE_SIEBEN), ANSPRECH)

            return (
                response,
                await database[Collection.SAISON_SPIELER].find_one({"spieler_id": TEILT_DIE_SIEBEN}),
                await database[Collection.SPIELER].find_one({"_id": TEILT_DIE_SIEBEN}),
            )

        response, row, person = on_a_league(mongo_replica_set_url, run)

        assert response.status_code == 200, response.text
        assert row["inactive_since"] == TODAY
        assert person is not None and person["inactive_since"] is None
        # The live `7` it shared is the captain's alone now, and an ausgetragen row wears nothing.
        assert response.json()["nummer_doppelt"] is False
