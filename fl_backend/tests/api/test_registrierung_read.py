from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.registrierungen.router import get_registrierungen
from app.api.registrierungen.schemas import FLRegistrierungenFilterParams
from app.core.collections import Collection
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_registrierung_read_test")

SAISON_ID = "2026"
OTHER_SAISON_ID = "2027"

TEAM_OID = ObjectId("6890a1b2c3d4e5f607950001")
OTHER_TEAM_OID = ObjectId("6890a1b2c3d4e5f607950002")
EINLADUNG_OID = ObjectId("6890a1b2c3d4e5f607950003")

OFFEN_OID = ObjectId("6890a1b2c3d4e5f607950011")
BESTAETIGT_OID = ObjectId("6890a1b2c3d4e5f607950012")
FREMDES_TEAM_OID = ObjectId("6890a1b2c3d4e5f607950013")

# The hash of a link nobody minted here: what matters is that no read answers it, whatever it is.
TOKEN_HASH = "b3c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f70819201"

CONSENT: dict[str, Any] = {
    "umfang": "kader_oeffentlich",
    "erteilt_von": "volljaehrig",
    "datum": "2026-04-03",
    "bestaetigt_am": "2026-04-03",
    "text_version": "2026-04-spielerseite",
    "medien": False,
}


def registrierung_document(
    registrierung_id: ObjectId,
    *,
    vorname: str,
    team_id: ObjectId = TEAM_OID,
    saison_id: str = SAISON_ID,
    einwilligung: Any = None,
    eingereicht_am: str = "2026-04-01",
) -> dict[str, Any]:
    return {
        "_id": registrierung_id,
        "saison_id": saison_id,
        "team_id": team_id,
        "einladung_id": EINLADUNG_OID,
        "eingereicht_am": eingereicht_am,
        "status": "eingereicht",
        "vorname": vorname,
        "nachname": f"{vorname}-Brandt",
        "email": f"{vorname.lower()}@beispielschule.de",
        "position": None,
        "nummer": None,
        "stufe": "Q1",
        "geburtsdatum": None if einwilligung is None else "2009-05-04",
        "einwilligung": einwilligung,
        "bestaetigung": {
            "token_hash": TOKEN_HASH,
            "verschickt_am": eingereicht_am,
            "erinnert_am": None,
            "frist": "2026-04-08",
        },
        "entscheidung": None,
    }


Body = Callable[[AsyncDatabase], Awaitable[Any]]


def on_a_league(url: str, body: Body) -> Any:
    """The SHIPPED validators, so a seeded row production would refuse fails here too.

    Three rows: one awaiting its pupil's answer, one they confirmed, and one of another team, which
    is what makes a narrowing that narrows nothing fail.
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
            await database[Collection.REGISTRIERUNGEN].insert_many(
                [
                    registrierung_document(OFFEN_OID, vorname="Thessaly"),
                    registrierung_document(BESTAETIGT_OID, vorname="Quillhilde", einwilligung=dict(CONSENT), eingereicht_am="2026-04-02"),
                    registrierung_document(FREMDES_TEAM_OID, vorname="Wraxlington", team_id=OTHER_TEAM_OID, saison_id=OTHER_SAISON_ID),
                ]
            )

            return await body(database)

    return on_the_seed_loop(_run())


async def read(database: AsyncDatabase, **filters: Any) -> Any:
    return await get_registrierungen(
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
        filters=FLRegistrierungenFilterParams.model_validate(filters),
    )


class TestWhetherThePupilConfirmed:
    """The field an admission is offered on, over the same two documents."""

    def test_a_row_awaiting_its_pupils_answer_reads_false(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            return await read(database, saison_id=SAISON_ID, team_id=str(TEAM_OID))

        answer = on_a_league(mongo_replica_set_url, body)
        by_id = {row.id: row for row in answer.registrierungen}

        assert by_id[OFFEN_OID].bestaetigt is False

    def test_a_row_whose_consent_carries_a_stamp_reads_true(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            return await read(database, saison_id=SAISON_ID, team_id=str(TEAM_OID))

        answer = on_a_league(mongo_replica_set_url, body)
        by_id = {row.id: row for row in answer.registrierungen}

        assert by_id[BESTAETIGT_OID].bestaetigt is True

    def test_the_verdict_is_read_off_the_consent_and_not_off_the_link(self, mongo_replica_set_url: str):
        """Both rows carry a `bestaetigung` block, so a verdict taken from it would read true for both."""

        async def body(database: AsyncDatabase) -> Any:
            return await read(database, saison_id=SAISON_ID, team_id=str(TEAM_OID))

        answer = on_a_league(mongo_replica_set_url, body)

        assert sorted(row.bestaetigt for row in answer.registrierungen) == [False, True]


class TestWhatTheReadServes:
    def test_no_token_hash_reaches_the_answer(self, mongo_replica_set_url: str):
        """The projection keeps it off the wire, where a model would drop it only after it had crossed."""

        async def body(database: AsyncDatabase) -> Any:
            return await read(database, saison_id=SAISON_ID)

        answer = on_a_league(mongo_replica_set_url, body)

        assert TOKEN_HASH not in answer.model_dump_json()
        assert all(row.bestaetigung is not None for row in answer.registrierungen)

    def test_a_narrowing_answers_that_team_and_season_alone(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            return await read(database, saison_id=SAISON_ID, team_id=str(TEAM_OID))

        answer = on_a_league(mongo_replica_set_url, body)

        # ObjectIds on both sides: `CustomObjectId` keeps the stored type in Python and spells a
        # string on the wire alone, so a comparison against `str(...)` matches nothing.
        assert {row.id for row in answer.registrierungen} == {OFFEN_OID, BESTAETIGT_OID}
        assert answer.vollstaendig is True

    def test_an_unnarrowed_read_answers_every_season(self, mongo_replica_set_url: str):
        """The other arm: a filter term written for an absent parameter would narrow this to nothing."""

        async def body(database: AsyncDatabase) -> Any:
            return await read(database)

        assert len(on_a_league(mongo_replica_set_url, body).registrierungen) == 3

    def test_the_newest_row_leads(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            return await read(database, saison_id=SAISON_ID, team_id=str(TEAM_OID))

        answer = on_a_league(mongo_replica_set_url, body)

        assert [row.id for row in answer.registrierungen] == [BESTAETIGT_OID, OFFEN_OID]

    def test_a_cut_list_reports_the_cut(self, mongo_replica_set_url: str):
        """`vollstaendig` is what says an administrator is looking at part of a queue."""

        async def body(database: AsyncDatabase) -> Any:
            return await read(database, limit=1)

        answer = on_a_league(mongo_replica_set_url, body)

        assert len(answer.registrierungen) == 1
        assert answer.vollstaendig is False
