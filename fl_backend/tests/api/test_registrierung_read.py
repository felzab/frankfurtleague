from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.registrierungen.admin_router import get_registrierungen_admin
from app.api.registrierungen.schemas import FLRegistrierungenAdminFilterParams
from app.core.collections import Collection
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import SPIELER_TEXT_VERSIONS, own_einwilligung_document, rules_document, saison_document, saison_team_document
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_registrierung_read_test")

SAISON_ID = "2026"
OTHER_SAISON_ID = "2027"

TEAM_OID = ObjectId("6890a1b2c3d4e5f607950001")
OTHER_TEAM_OID = ObjectId("6890a1b2c3d4e5f607950002")
INVITATION_OID = ObjectId("6890a1b2c3d4e5f607950003")

OPEN_OID = ObjectId("6890a1b2c3d4e5f607950011")
CONFIRMED_OID = ObjectId("6890a1b2c3d4e5f607950012")
ELSEWHERE_OID = ObjectId("6890a1b2c3d4e5f607950013")
DECLINED_OID = ObjectId("6890a1b2c3d4e5f607950014")
# Ids newer than every seeded row's, for the order case: one on an earlier day, one on the newest.
EARLIER_DAY_OID = ObjectId("6890a1b2c3d4e5f607950015")
SAME_DAY_OID = ObjectId("6890a1b2c3d4e5f607950016")

# The hash of a link nobody minted here: what matters is that no read answers it, whatever it is.
TOKEN_HASH = "b3c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f70819201"

CONSENT: dict[str, Any] = own_einwilligung_document(text_versions=SPIELER_TEXT_VERSIONS, confirmed_at="2026-04-03")


def registrierung_document(
    registrierung_id: ObjectId,
    *,
    first_name: str,
    team_id: ObjectId = TEAM_OID,
    saison_id: str = SAISON_ID,
    einwilligung: Any = None,
    submitted_at: str = "2026-04-01",
    status: str = "submitted",
) -> dict[str, Any]:
    return {
        "_id": registrierung_id,
        "saison_id": saison_id,
        "team_id": team_id,
        "invitation_id": INVITATION_OID,
        "submitted_at": submitted_at,
        "status": status,
        "first_name": first_name,
        "last_name": f"{first_name}-Brandt",
        "email": f"{first_name.lower()}@beispielschule.de",
        "position": None,
        "nummer": None,
        "stufe": "Q1",
        "birth_date": None if einwilligung is None else "2009-05-04",
        "einwilligung": einwilligung,
        "confirmation": {
            "token_hashes": [TOKEN_HASH],
            "sent_at": submitted_at,
            "deadline": "2026-04-08",
        },
        "decision": None,
    }


Body = Callable[[AsyncDatabase], Awaitable[Any]]


def on_a_league(url: str, body: Body) -> Any:
    """A clean database carrying the shipped indexes.

    Four rows: one awaiting its pupil's answer, one they confirmed, one of another season, which is what makes a read
    narrowing nothing fail, and one declined, which waits out its days asking nothing of an administrator.
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
            await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, "active", rules=rules_document()))
            await database[Collection.SAISON_TEAMS].insert_one(saison_team_document(SAISON_ID, TEAM_OID, "Adler", "ADX"))
            await database[Collection.REGISTRIERUNGEN].insert_many(
                [
                    registrierung_document(OPEN_OID, first_name="Thessaly"),
                    registrierung_document(CONFIRMED_OID, first_name="Quillhilde", einwilligung=dict(CONSENT), submitted_at="2026-04-02"),
                    registrierung_document(ELSEWHERE_OID, first_name="Wraxlington", team_id=OTHER_TEAM_OID, saison_id=OTHER_SAISON_ID),
                    registrierung_document(DECLINED_OID, first_name="Ottokar", status="declined"),
                ]
            )

            return await body(database)

    return on_the_seed_loop(_run())


async def read(database: AsyncDatabase, saison_id: str = SAISON_ID) -> Any:
    return await get_registrierungen_admin(
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        filters=FLRegistrierungenAdminFilterParams(saison_id=saison_id),
    )


class TestWhetherThePupilConfirmed:
    """The chip a row carries, over the same two documents."""

    def test_the_verdict_is_read_off_the_consent_and_not_off_the_link(self, mongo_replica_set_url: str):
        """Both rows carry a `confirmation` block, so a verdict taken from it would read true for both."""

        async def body(database: AsyncDatabase) -> Any:
            return await read(database)

        by_id = {row.id: row for row in on_a_league(mongo_replica_set_url, body).registrierungen}

        assert (by_id[OPEN_OID].confirmed, by_id[CONFIRMED_OID].confirmed) == (False, True)

    def test_a_row_owed_no_mail_says_so(self, mongo_replica_set_url: str):
        """An administrator cannot otherwise tell a pupil who has not answered from one who was never asked."""

        async def body(database: AsyncDatabase) -> Any:
            await database[Collection.REGISTRIERUNGEN].update_one({"_id": OPEN_OID}, {"$set": {"confirmation.sent_at": None}})
            return await read(database)

        by_id = {row.id: row for row in on_a_league(mongo_replica_set_url, body).registrierungen}

        assert (by_id[OPEN_OID].unmailed, by_id[CONFIRMED_OID].unmailed) == (True, False)


class TestWhatTheReadServes:
    def test_a_list_past_the_cap_says_it_is_cut(self, mongo_replica_set_url: str):
        """Rows a passed-on link can write: served short rather than a 500, and saying so."""

        async def body(database: AsyncDatabase) -> Any:
            # Beside the seed's two pending rows, one past the cap.
            await database[Collection.REGISTRIERUNGEN].insert_many(
                [
                    {**registrierung_document(ObjectId(), first_name="Flut"), "email": f"flut{index}@beispielschule.de"}
                    for index in range(LIST_LIMIT_DEFAULT - 1)
                ]
            )
            return await read(database)

        answered = on_a_league(mongo_replica_set_url, body)

        assert (len(answered.registrierungen), answered.complete) == (LIST_LIMIT_DEFAULT, False)

    def test_no_token_hash_and_no_address_reaches_the_answer(self, mongo_replica_set_url: str):
        """The list shows neither, and what the read projects is what crosses the wire."""

        async def body(database: AsyncDatabase) -> Any:
            return await read(database)

        answer = on_a_league(mongo_replica_set_url, body).model_dump_json()

        assert TOKEN_HASH not in answer
        assert "@beispielschule.de" not in answer

    def test_the_season_s_pending_rows_alone_lead_with_the_newest(self, mongo_replica_set_url: str):
        """A declined row and another season's stay out, each of which a read narrowing nothing would serve.

        The day leads and the id breaks a tie: a row of an earlier day holding the newest id stands last, and the second row
        of the newest day, its id the newer, first.
        """

        async def body(database: AsyncDatabase) -> Any:
            await database[Collection.REGISTRIERUNGEN].insert_many(
                [
                    registrierung_document(EARLIER_DAY_OID, first_name="Bartholomew", submitted_at="2026-03-30"),
                    registrierung_document(SAME_DAY_OID, first_name="Philippa", submitted_at="2026-04-02"),
                ]
            )
            return await read(database)

        answer = on_a_league(mongo_replica_set_url, body)

        assert [row.id for row in answer.registrierungen] == [SAME_DAY_OID, CONFIRMED_OID, OPEN_OID, EARLIER_DAY_OID]
