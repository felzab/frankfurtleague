"""
API · a referee's address in the editor: the save never moves a confirmed one, which an address change alone moves

The change itself, its links and its effect are `tests/api/test_adresswechsel_execution.py`'s; here the editor's save and
read beside a change standing on the referee's address.
"""

from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.adresswechsel.admin_router import post_adresswechsel_verwaltung
from app.api.adresswechsel.schemas import FLAdresswechselVerwaltungPayload
from app.api.bewerbungen.services import hash_token
from app.api.schiedsrichter.admin_router import einladen_schiedsrichter, patch_schiedsrichter
from app.api.schiedsrichter.bestaetigung_router import post_bestaetigung
from app.api.schiedsrichter.router import get_schiedsrichter_by_id
from app.api.schiedsrichter.schemas import FLPatchSchiedsrichterPayload, FLSchiedsrichterBestaetigungPayload
from app.api.schiedsrichter.services import BESTAETIGUNG_FELD, SCHIEDSRICHTER_ADRESSE_NUR_PER_WECHSEL
from app.core.collections import Collection
from app.core.exceptions import WriteRefusalException
from app.shared.einwilligung import LAUFENDE_FASSUNGEN
from tests import documents
from tests.actor_tokens import FRESH_STEP_UP_CHECK
from tests.bans import ban_list
from tests.config import grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.records import record_collections
from tests.worker import worker_database

# Module level: every case below reaches a real mongod, each write being one transaction.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_schiedsrichter_adresswechsel_test")

SAISON_ID = "2026"
TODAY = "2026-04-01"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607830001")

NAME = "Ortwin Pfeiffenberger"
EMAIL = "ortwin.pfeiffenberger@example.com"
NEW_EMAIL = "o.pfeiffenberger@neuepost.example.org"
TELEFON = "+49 69 5550303"
GRUND = "Postfach gelöscht, telefonisch unter der hinterlegten Nummer bestätigt am 21.10.2026"


def referee_document(**overrides: Any) -> dict[str, Any]:
    """A referee as the administrator entered them, before their own answer."""

    return {
        "_id": SCHIEDSRICHTER_OID,
        "name": NAME,
        "schule": "Bettina-Schule",
        "default_payment": 20,
        "kontakt": {"telefon": TELEFON, "email": EMAIL},
        "inactive_since": None,
        **overrides,
    }


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, confirmed: bool = True) -> Any:
    """The SHIPPED validators, a running season, and one referee who answered their own link unless `confirmed` says otherwise."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.BERECHTIGUNGEN].insert_many(grants_for_the_suite())
            await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
            await database[Collection.SCHIEDSRICHTER].insert_one(referee_document())
            minted = await einladen_schiedsrichter(
                schiedsrichter_id=SCHIEDSRICHTER_OID,
                schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                sperrliste=ban_list(database),
                db=client,
                today=TODAY,
            )
            if confirmed:
                await post_bestaetigung(
                    antwort_data=FLSchiedsrichterBestaetigungPayload.model_validate(
                        {
                            "token": minted.bestaetigung.token,
                            "geburtsdatum": "1984-05-09",
                            "umfang": "kader_oeffentlich",
                            "medien": True,
                            "text_version": LAUFENDE_FASSUNGEN["bestaetigung_schiedsrichter"],
                        }
                    ),
                    schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                    sperrliste=ban_list(database),
                    db=client,
                    today=TODAY,
                    germany_now=NOW,
                )

            return await body(database, client)

    return on_the_seed_loop(_run())


async def save(database: AsyncDatabase, client: AsyncMongoClient, *, email: str) -> Any:
    return await patch_schiedsrichter(
        schiedsrichter_id=SCHIEDSRICHTER_OID,
        schiedsrichter_data=FLPatchSchiedsrichterPayload.model_validate(
            {"name": NAME, "schule": "Bettina-Schule", "default_payment": 25, "kontakt": {"telefon": TELEFON, "email": email}}
        ),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        spiele_collection=database[Collection.SPIELE],
        sperrliste=ban_list(database),
        adressanker_collection=database[Collection.ADRESSANKER],
        db=client,
        today=TODAY,
        refuse_unconfirmed=FRESH_STEP_UP_CHECK,
    )


async def request(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    """An administrator's start through the address tool, with a reason, so the new mailbox is minted its link at once."""

    return await post_adresswechsel_verwaltung(
        adresswechsel_data=FLAdresswechselVerwaltungPayload.model_validate({"adresse": EMAIL, "email": NEW_EMAIL, "grund": GRUND}),
        adresswechsel_collection=database[Collection.ADRESSWECHSEL],
        records=record_collections(database),
        spieler_collection=database[Collection.SPIELER],
        berechtigungen_collection=database[Collection.BERECHTIGUNGEN],
        berechtigungen_angekuendigt_collection=database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT],
        berechtigungen_postausgang_collection=database[Collection.BERECHTIGUNGEN_POSTAUSGANG],
        sperrliste=ban_list(database),
        adressanker_collection=database[Collection.ADRESSANKER],
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        operator="admin@frankfurtleague.de",
        auth_time=0,
        germany_now=NOW,
    )


async def read(database: AsyncDatabase) -> Any:
    return await get_schiedsrichter_by_id(
        schiedsrichter_id=SCHIEDSRICHTER_OID,
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        adresswechsel_collection=database[Collection.ADRESSWECHSEL],
        today=TODAY,
    )


async def stored(database: AsyncDatabase) -> Mapping[str, Any]:
    found = await database[Collection.SCHIEDSRICHTER].find_one({"_id": SCHIEDSRICHTER_OID})
    assert found is not None, "the referee this case seeded is gone"

    return found


async def refused_code(call: Awaitable[Any]) -> str:
    with pytest.raises(WriteRefusalException) as refused:
        await call

    return refused.value.error_code


class TestTheSaveOnAConfirmedReferee:
    """`REQ-SCHIEDSRICHTER-011`: a confirmed referee's address is who signs in as them, and the save moves it never."""

    @pytest.mark.parametrize("retired", [False, True], ids=["serving", "retired"])
    def test_a_save_moving_it_is_refused_and_nothing_of_the_save_lands(self, mongo_replica_set_url: str, retired: bool):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if retired:
                await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER_OID}, {"$set": {"inactive_since": "2026-03-01"}})
            before = await stored(database)

            return await refused_code(save(database, client, email=NEW_EMAIL)), before, await stored(database)

        code, before, row = on_a_league(mongo_replica_set_url, body)

        assert code == SCHIEDSRICHTER_ADRESSE_NUR_PER_WECHSEL
        assert row == before

    def test_a_save_keeping_it_with_its_domain_respelled_lands_and_leaves_a_pending_change_standing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await request(database, client)
            saved = await save(database, client, email="ortwin.pfeiffenberger@EXAMPLE.com")

            return minted, saved, await stored(database), await database[Collection.ADRESSWECHSEL].find_one({"_id": minted.id})

        minted, saved, row, change = on_a_league(mongo_replica_set_url, body)

        assert saved.bestaetigung is None
        assert row["default_payment"] == 25
        assert (change["beendet"], change["token_hash"]) == (None, hash_token(str(minted.token)))


class TestAnUnconfirmedReferee:
    """The control on the class above: an unanswered referee's address is still replaced at once and mailed a fresh consent link."""

    def test_the_address_moves_at_once_and_a_fresh_consent_link_is_answered(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await save(database, client, email=NEW_EMAIL), await stored(database)

        saved, row = on_a_league(mongo_replica_set_url, body, confirmed=False)

        assert saved.bestaetigung is not None
        assert row["kontakt"]["email"] == NEW_EMAIL
        assert row[BESTAETIGUNG_FELD]["token_hash"] == hash_token(saved.bestaetigung.token)


class TestTheEditorsRead:
    def test_it_names_the_live_change_of_the_referee_s_address(self, mongo_replica_set_url: str):
        """Read off the folded address the referee stores, as the change keys it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await read(database)
            minted = await request(database, client)
            return before.adresswechsel_id, (await read(database)).adresswechsel_id, minted.id

        before, after, minted = on_a_league(mongo_replica_set_url, body)

        assert (before, after) == (None, minted)

    def test_an_unconfirmed_referees_lapsed_consent_link_is_answered_apart_from_any_change(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            answered = await get_schiedsrichter_by_id(
                schiedsrichter_id=SCHIEDSRICHTER_OID,
                schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                adresswechsel_collection=database[Collection.ADRESSWECHSEL],
                today="2026-04-16",
            )
            return answered.bestaetigung_abgelaufen, answered.adresswechsel_id

        assert on_a_league(mongo_replica_set_url, body, confirmed=False) == (True, None)
