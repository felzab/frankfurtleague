"""
API · a team's squad as its own contact seats read and change it, through the mounted person routes

Driven over HTTP with a person-lane actor token, so the identifier and the handler's own
seat re-derivation all run as a representative's request meets them. The captaincy's race alone
calls the handler directly, a rival committing inside the season's anchor.
"""

from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from httpx2 import Response
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.spieler.person_router import patch_kader_row
from app.api.spieler.schemas import FLPatchKaderRowPayload
from app.core.codes import Code
from app.core.collections import Collection
from app.shared.schemas.literals import KONTAKT_SEATS
from tests.acts import acts_of
from tests.app_client import app_client, app_under_test
from tests.config import ADMIN_KEY
from tests.database import a_clean_database
from tests.documents import (
    kontaktperson_document,
    rules_document,
    saison_document,
    saison_spieler_document,
    saison_team_document,
    spieler_document,
)
from tests.isolation import COMMITTED, InterleavedCollection, outcome_of
from tests.records import record_collections
from tests.session_headers import StampedHeaders
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_kader_person_test")

PAST_SAISON = "2425"
ACTIVE_SAISON = "2526"
FUTURE_SAISON = "2627"

TODAY = "2026-04-01"
NOW = datetime(2026, 4, 1, 12, tzinfo=ZoneInfo("Europe/Berlin"))

TEAM_A = ObjectId("6890a1b2c3d4e5f607910001")
TEAM_B = ObjectId("6890a1b2c3d4e5f607910002")

# Team A's squad in the active season: two live rows sharing a shirt, one wearing `07` beside them,
# an ausgetragen row wearing the shared number too, and the captain among the live ones.
KAPITAEN = ObjectId("6890a1b2c3d4e5f607920001")
SHARES_THE_SEVEN = ObjectId("6890a1b2c3d4e5f607920002")
ZERO_SEVEN = ObjectId("6890a1b2c3d4e5f607920003")
RETIRED = ObjectId("6890a1b2c3d4e5f607920004")
# Outside the season's list, written before the season narrowed it.
OLD_STUFE = ObjectId("6890a1b2c3d4e5f607920005")
# Team B's and team C's own pupils.
B_PUPIL = ObjectId("6890a1b2c3d4e5f607920011")

ALLOWED_STUFEN = ["Q1", "Q2"]

# One mailbox per seat, spelled so that a hit cannot be a coincidence.
ANSPRECH = "ansprech.kader@schule.example.org"
TRAINER_ALONE = "trainer.kader@schule.example.org"
UPPER_STORED = "gross.kader@schule.example.org"
B_ANSPRECH = "b.ansprech.kader@schule.example.org"

SEAT_PHONE = "+49 69 90009199"
PUPIL_EMAIL_DOMAIN = "pupil.example.net"

SPIELER_PATH = "/api/spieler"

PAYLOAD: Mapping[str, Any] = {"nummer": "11", "position": "Tor", "stufe": "Q1", "rolle": None, "version": 0}


def _seat(email: str) -> dict[str, Any]:
    return kontaktperson_document("Anna", confirmed_at="2026-01-06", email=email, phone=SEAT_PHONE)


def _junction(saison_id: str, team_id: ObjectId, name: str, **seats: dict[str, Any]) -> dict[str, Any]:
    return saison_team_document(
        saison_id, team_id, name, name[:3].upper(), kontakte={**{seat: None for seat in KONTAKT_SEATS}, **seats, "trainer_is_also": None}
    )


def _saison(saison_id: str, status: str) -> dict[str, Any]:
    return saison_document(
        saison_id,
        status,
        start_date=f"20{saison_id[:2]}-08-01",
        end_date=f"20{saison_id[2:]}-06-30",
        rules=rules_document(allowed_stufen=list(ALLOWED_STUFEN)),
    )


def _pupil(spieler_id: ObjectId, first_name: str, last_name: str) -> dict[str, Any]:
    # An address on the person row, so a read that joined one in would carry it.
    return spieler_document(spieler_id, first_name, last_name, email=f"{first_name.lower()}@{PUPIL_EMAIL_DOMAIN}")


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
                trainer=_seat(TRAINER_ALONE),
                ansprechperson=_seat(ANSPRECH),
                stellvertretung=_seat(UPPER_STORED),
            ),
            # The same seat holder on a `past` season, which grants no panel, and a season holding none of theirs.
            _junction(PAST_SAISON, TEAM_A, "Adler", ansprechperson=_seat(ANSPRECH)),
            _junction(FUTURE_SAISON, TEAM_A, "Adler", ansprechperson=_seat(B_ANSPRECH)),
            _junction(ACTIVE_SAISON, TEAM_B, "Biber", ansprechperson=_seat(B_ANSPRECH)),
        ]
    )
    await database[Collection.SPIELER].insert_many(
        [
            _pupil(KAPITAEN, "Karla", "Kapitänsdóttir-Weber"),
            _pupil(SHARES_THE_SEVEN, "Tom", "Siebenstein"),
            _pupil(ZERO_SEVEN, "Nora", "Nullsieben"),
            _pupil(RETIRED, "Ali", "Ausgetragen"),
            _pupil(OLD_STUFE, "Olga", "Oberstufe"),
            _pupil(B_PUPIL, "Bea", "Biber"),
        ]
    )
    await database[Collection.SAISON_SPIELER].insert_many(
        [
            _row(KAPITAEN, TEAM_A, nummer="7", rolle="kapitaen"),
            _row(SHARES_THE_SEVEN, TEAM_A, nummer="7"),
            _row(ZERO_SEVEN, TEAM_A, nummer="07"),
            _row(RETIRED, TEAM_A, nummer="7", inactive_since="2026-02-01"),
            _row(OLD_STUFE, TEAM_A, nummer="12", stufe="Q4"),
            _row(B_PUPIL, TEAM_B, nummer="3"),
        ]
    )


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


async def on_a_league(url: str, body: Body) -> Any:
    async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
        await _seed(database)

        return await body(database, client)


def as_person(email: str) -> StampedHeaders:
    return StampedHeaders(email, ADMIN_KEY, lane="person")


def kader_url(team_id: ObjectId = TEAM_A, saison_id: str = ACTIVE_SAISON) -> str:
    return f"{SPIELER_PATH}/teams/{team_id}/saisons/{saison_id}"


def row_url(spieler_id: ObjectId, team_id: ObjectId = TEAM_A, saison_id: str = ACTIVE_SAISON) -> str:
    return f"{SPIELER_PATH}/{spieler_id}/teams/{team_id}/saisons/{saison_id}"


async def send(url: str, method: str, path: str, email: str, body: Mapping[str, Any] | None = None) -> Response:
    async with app_client(url, app=app_under_test(DATABASE_NAME), now=NOW) as http:
        return await http.request(method, path, headers=as_person(email), json=body)


async def stored(database: AsyncDatabase) -> tuple[list[Any], list[Any]]:
    """Every squad row and every season as they stand, so a refused request can be shown to have written neither."""

    return (
        await database[Collection.SAISON_SPIELER].find({}, sort=[("spieler_id", 1), ("saison_id", 1)]).to_list(),
        await database[Collection.SAISONS].find({}, sort=[("_id", 1)]).to_list(),
    )


def answered(response: Response) -> tuple[int, str | None]:
    # A write that lands answers no body.
    return response.status_code, response.json().get("error_code") if response.content else None


async def refused_and_untouched(
    url: str, method: str, path: str, email: str, body: Mapping[str, Any] | None = None
) -> tuple[tuple[int, str | None], bool]:
    async def run(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[tuple[int, str | None], bool]:
        before = await stored(database)
        response = await send(url, method, path, email, body)

        return answered(response), before == await stored(database)

    return await on_a_league(url, run)


class TestTheKaderRead:
    """What a seat holder is served: whole surnames, the shirt marker, the season's Stufen, and nobody's address."""

    async def test_a_seat_holder_reads_every_row_whole_with_its_shirt_marked_and_no_address(self, mongo_replica_set_url: str):
        response = await on_a_league(mongo_replica_set_url, lambda database, client: send(mongo_replica_set_url, "GET", kader_url(), ANSPRECH))

        assert response.status_code == 200, response.text
        body = response.json()
        rows = {row["spieler_id"]: row for row in body["kader"]}

        assert set(rows) == {str(spieler_id) for spieler_id in (KAPITAEN, SHARES_THE_SEVEN, ZERO_SEVEN, RETIRED, OLD_STUFE)}
        assert rows[str(KAPITAEN)]["last_name"] == "Kapitänsdóttir-Weber"
        assert rows[str(KAPITAEN)]["rolle"] == "kapitaen"
        assert rows[str(RETIRED)]["inactive_since"] == "2026-02-01"
        assert body["allowed_stufen"] == ALLOWED_STUFEN
        # The pair wearing `7` beside a row wearing a shirt of its own: that the read marks them. Which rows share is the
        # marker's own rule.
        marked = [rows[str(spieler_id)]["nummer_double"] for spieler_id in (KAPITAEN, SHARES_THE_SEVEN, OLD_STUFE)]
        assert marked == [True, True, False]

        # The serialised body scanned whole, so a nested carrier no model field names is caught too.
        text = response.text

        assert "@" not in text
        assert PUPIL_EMAIL_DOMAIN not in text
        assert SEAT_PHONE not in text
        assert "phone" not in text
        assert "email" not in text
        assert "einwilligung" not in text


# Each operation, as the request that would otherwise succeed (the row is team A's own), paired with one
# seat that grants it nothing: a seat on team B asking for team A; team A's seat holder asking for a
# season of team A they hold no seat in; and for one whose seat they hold on a `past` season, which
# grants no panel.
NOT_HELD = [
    pytest.param(
        B_ANSPRECH, TEAM_A, ACTIVE_SAISON, "GET", lambda team_id, saison_id: kader_url(team_id, saison_id), None, id="another team-GET"
    ),
    pytest.param(
        ANSPRECH,
        TEAM_A,
        FUTURE_SAISON,
        "PATCH",
        lambda team_id, saison_id: row_url(SHARES_THE_SEVEN, team_id, saison_id),
        PAYLOAD,
        id="another season of the same team-PATCH",
    ),
    pytest.param(
        ANSPRECH,
        TEAM_A,
        PAST_SAISON,
        "DELETE",
        lambda team_id, saison_id: row_url(SHARES_THE_SEVEN, team_id, saison_id),
        None,
        id="a past season-DELETE",
    ),
]


class TestASeatNotHeld:
    """`role_not_held`, judged by each handler itself: drop the check from one and its case goes red."""

    @pytest.mark.parametrize(("email", "team_id", "saison_id", "method", "path", "body"), NOT_HELD)
    async def test_each_operation_is_refused_and_writes_nothing(
        self,
        mongo_replica_set_url: str,
        method: str,
        path: Callable[[ObjectId, str], str],
        body: Mapping[str, Any] | None,
        email: str,
        team_id: ObjectId,
        saison_id: str,
    ):
        answer, untouched = await refused_and_untouched(mongo_replica_set_url, method, path(team_id, saison_id), email, body)

        assert answer == (403, Code.ROLE_NOT_HELD)
        assert untouched


class TestAnotherTeamsPupil:
    """Team A's seat holder naming team B's pupil under team A's path: the row filter carries the team, so nothing matches."""

    async def test_a_delete_answers_not_found_and_writes_nothing(self, mongo_replica_set_url: str):
        answer, untouched = await refused_and_untouched(mongo_replica_set_url, "DELETE", row_url(B_PUPIL), ANSPRECH)

        assert answer == (404, Code.DOCUMENT_NOT_FOUND)
        assert untouched

    async def test_a_patch_is_not_found_before_any_rule_judges_the_other_team_s_row(self, mongo_replica_set_url: str):
        """A Stufe the season refuses, so a filter without the team finds team B's row and answers 409 rather than 404.

        A patch the rules pass cannot tell: its read-back after the write answers 404 whatever the filter matched.
        """

        answer, untouched = await refused_and_untouched(mongo_replica_set_url, "PATCH", row_url(B_PUPIL), ANSPRECH, {**PAYLOAD, "stufe": "E1"})

        assert answer == (404, Code.DOCUMENT_NOT_FOUND)
        assert untouched


class TestARetiredRow:
    """Read-only to a representative: only the administrator's reactivate brings it back."""

    @pytest.mark.parametrize(("method", "body"), [("PATCH", PAYLOAD), ("DELETE", None)], ids=["PATCH", "DELETE"])
    async def test_a_write_answers_not_found_and_writes_nothing(self, mongo_replica_set_url: str, method: str, body: Mapping[str, Any] | None):
        answer, untouched = await refused_and_untouched(mongo_replica_set_url, method, row_url(RETIRED), ANSPRECH, body)

        assert answer == (404, Code.DOCUMENT_NOT_FOUND)
        assert untouched


class TestATrainerOnlySeat:
    """Every operation open to the Trainer's seat exactly as to the Ansprechperson's: the case that goes red if a check narrows by seat."""

    async def test_it_reads_edits_all_four_fields_and_retires(self, mongo_replica_set_url: str):
        async def run(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[list[int], Any, Any]:
            read = await send(mongo_replica_set_url, "GET", kader_url(), TRAINER_ALONE)
            edit = await send(
                mongo_replica_set_url,
                "PATCH",
                row_url(SHARES_THE_SEVEN),
                TRAINER_ALONE,
                {"nummer": "9", "position": "Tor", "stufe": "Q1", "rolle": "co_kapitaen", "version": 0},
            )
            out = await send(mongo_replica_set_url, "DELETE", row_url(ZERO_SEVEN), TRAINER_ALONE)
            rows = database[Collection.SAISON_SPIELER]

            return (
                [response.status_code for response in (read, edit, out)],
                await rows.find_one({"spieler_id": SHARES_THE_SEVEN}),
                await rows.find_one({"spieler_id": ZERO_SEVEN}),
            )

        statuses, edited, out = await on_a_league(mongo_replica_set_url, run)

        assert statuses == [200, 204, 204]
        assert {key: edited[key] for key in ("nummer", "position", "stufe", "rolle")} == {
            "nummer": "9",
            "position": "Tor",
            "stufe": "Q1",
            "rolle": "co_kapitaen",
        }
        assert out["inactive_since"] == TODAY


class TestAnEdit:
    async def test_the_four_fields_are_written_and_the_rest_of_the_row_stays(self, mongo_replica_set_url: str):
        async def run(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[Response, Any, Any, Any, Response]:
            response = await send(mongo_replica_set_url, "PATCH", row_url(SHARES_THE_SEVEN), ANSPRECH, {**PAYLOAD, "nummer": "07"})
            seasons = await database[Collection.ACTION_LOG].distinct("saison_id", {"action": "spieler.changed"})

            return (
                response,
                await database[Collection.SAISON_SPIELER].find_one({"spieler_id": SHARES_THE_SEVEN}),
                await acts_of(database),
                seasons,
                await send(mongo_replica_set_url, "GET", kader_url(), ANSPRECH),
            )

        response, row, acts, seasons, read = await on_a_league(mongo_replica_set_url, run)

        assert response.status_code == 204, response.text
        assert acts == [("spieler.changed", "kontakt", "Adler", SHARES_THE_SEVEN)]
        # A pupil's row is the season's, and the row names the pupil by id alone.
        assert seasons == [ACTIVE_SAISON]
        assert (row["nummer"], row["position"], row["stufe"], row["rolle"]) == ("07", "Tor", "Q1", None)
        assert (row["team_id"], row["is_nachnominiert"], row["inactive_since"]) == (TEAM_A, False, None)
        # Now wearing `07` beside `ZERO_SEVEN`, judged against the squad after the write.
        marked = {row["spieler_id"]: row["nummer_double"] for row in read.json()["kader"]}
        assert (marked[str(SHARES_THE_SEVEN)], marked[str(ZERO_SEVEN)]) == (True, True)

    async def test_a_save_on_the_version_another_save_moved_is_refused_and_the_first_stands(self, mongo_replica_set_url: str):
        """Two seat holders open the row on one version and both save: unchecked, the second overwrites the first unseen."""

        async def run(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[int, tuple[int, str | None], Any]:
            first = await send(mongo_replica_set_url, "PATCH", row_url(SHARES_THE_SEVEN), ANSPRECH, {**PAYLOAD, "nummer": "9"})
            second = await send(mongo_replica_set_url, "PATCH", row_url(SHARES_THE_SEVEN), TRAINER_ALONE, {**PAYLOAD, "nummer": "10"})

            return first.status_code, answered(second), await database[Collection.SAISON_SPIELER].find_one({"spieler_id": SHARES_THE_SEVEN})

        first, second, row = await on_a_league(mongo_replica_set_url, run)

        assert first == 204
        assert second == (409, Code.VERSION_STALE)
        assert (row["nummer"], row["version"]) == ("9", 1)


class TestAStufeTheSeasonDoesNotOffer:
    """`kader_stufe_not_allowed`: a server refusal, the form's offer being no rule."""

    async def test_a_stufe_outside_the_season_s_list_is_refused_and_nothing_is_written(self, mongo_replica_set_url: str):
        answer, untouched = await refused_and_untouched(
            mongo_replica_set_url, "PATCH", row_url(SHARES_THE_SEVEN), ANSPRECH, {**PAYLOAD, "stufe": "E1"}
        )

        assert answer == (409, Code.KADER_STUFE_NOT_ALLOWED)
        assert untouched

    async def test_the_stufe_the_row_already_holds_passes(self, mongo_replica_set_url: str):
        """A season narrowed after the row was written leaves the row editable, its own Stufe included."""

        answer, _ = await refused_and_untouched(mongo_replica_set_url, "PATCH", row_url(OLD_STUFE), ANSPRECH, {**PAYLOAD, "stufe": "Q4"})

        assert answer == (204, None)


class TestTheCaptaincy:
    async def test_a_rolle_another_live_row_holds_is_refused_and_nothing_is_written(self, mongo_replica_set_url: str):
        answer, untouched = await refused_and_untouched(
            mongo_replica_set_url, "PATCH", row_url(SHARES_THE_SEVEN), ANSPRECH, {**PAYLOAD, "rolle": "kapitaen"}
        )

        assert answer == (409, Code.KADER_ROLLE_TAKEN)
        assert untouched

    async def test_two_edits_naming_one_rolle_leave_one_holder(self, mongo_replica_set_url: str):
        """A rival edit commits inside this one, before its anchor or, where it takes none, before its count.

        Without the captaincy's own anchor, this route taking no cap's, both commit.
        """

        async def give_the_armband(
            database: AsyncDatabase, client: AsyncMongoClient, spieler_id: ObjectId, saisons: Any, kader_rows: Any = None
        ) -> Any:
            return await patch_kader_row(
                team_id=TEAM_A,
                saison_id=ACTIVE_SAISON,
                spieler_id=spieler_id,
                row_data=FLPatchKaderRowPayload(nummer=None, position=None, stufe=None, rolle="co_kapitaen", version=0),
                identifier=ANSPRECH,
                saison_spieler_collection=kader_rows if kader_rows is not None else database[Collection.SAISON_SPIELER],
                saisons_collection=saisons,
                records=record_collections(database),
                db=client,
            )

        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, int, int]:
            async def the_rival_takes_the_armband() -> None:
                await give_the_armband(database, client, ZERO_SEVEN, database[Collection.SAISONS])

            seasons = InterleavedCollection(database[Collection.SAISONS], the_rival_takes_the_armband, before="update_many")
            kader_rows = KaderRowsRunningTheSameRival(database[Collection.SAISON_SPIELER], seasons)
            outcome = await outcome_of(give_the_armband(database, client, SHARES_THE_SEVEN, seasons, kader_rows))
            holders = await database[Collection.SAISON_SPIELER].count_documents(
                {"saison_id": ACTIVE_SAISON, "team_id": TEAM_A, "rolle": "co_kapitaen", "inactive_since": None}
            )

            return outcome, holders, seasons.passes

        outcome, holders, passes = await on_a_league(mongo_replica_set_url, run)

        assert passes >= 1, "the rival never ran, so the edit was raced by nobody"
        assert (outcome, holders) == (Code.KADER_ROLLE_TAKEN, 1), (
            f"the edit answered {outcome!r} ({COMMITTED!r} is no refusal), leaving {holders} holders"
        )


class KaderRowsRunningTheSameRival:
    """A `saison_spieler` stand-in handing the captaincy's count to the season stand-in's one-shot rival.

    So a write taking no anchor still meets the rival inside its transaction, where it can only miss it.
    """

    def __init__(self, collection: Any, seasons: InterleavedCollection) -> None:
        self._collection = collection
        self._seasons = seasons

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def count_documents(self, *args: Any, **kwargs: Any) -> Any:
        await self._seasons.run_the_rival()

        return await self._collection.count_documents(*args, **kwargs)


class TestRetire:
    async def test_it_stamps_the_row_and_leaves_the_person(self, mongo_replica_set_url: str):
        async def run(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[Response, Any, Any, Response]:
            response = await send(mongo_replica_set_url, "DELETE", row_url(SHARES_THE_SEVEN), ANSPRECH)
            row = await database[Collection.SAISON_SPIELER].find_one({"spieler_id": SHARES_THE_SEVEN})

            return response, row, await acts_of(database), await send(mongo_replica_set_url, "GET", kader_url(), ANSPRECH)

        response, row, acts, read = await on_a_league(mongo_replica_set_url, run)

        assert response.status_code == 204, response.text
        assert acts == [("spieler.deregistered", "kontakt", "Adler", SHARES_THE_SEVEN)]
        assert row["inactive_since"] == TODAY
        # The live `7` it shared is the captain's alone now, and an ausgetragen row wears nothing.
        marked = {row["spieler_id"]: row["nummer_double"] for row in read.json()["kader"]}
        assert (marked[str(SHARES_THE_SEVEN)], marked[str(KAPITAEN)]) == (False, False)
