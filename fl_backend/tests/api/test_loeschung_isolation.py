"""
API · a write keeping a person's seat while that person's erasure runs, against the shipped indexes and the whole database

Each case runs one write to its commit inside the erasure, after the erasure's first read, and asks the whole
database what holds the address once the erasure has answered.
"""

from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.services import compose_decline_update, hash_token
from app.api.teams.admin_router import patch_saison_team, patch_saison_team_kontakte
from app.api.teams.schemas import FLPatchSaisonTeamKontaktePayload, FLPatchSaisonTeamPayload, kontakte_stand_of
from app.core.collections import Collection
from app.shared.einwilligung import LAUFENDE_FASSUNGEN
from app.shared.folding import sign_in_identifier
from tests.actor_tokens import fresh_admin_actor
from tests.bans import ban_list
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import (
    bewerbung_document,
    kontakte_document,
    kontaktperson_document,
    neue_schule_document,
    saison_document,
    saison_team_document,
    schiedsrichter_document,
    spieler_document,
    team_document,
)
from tests.isolation import COMMITTED, InterleavedCollection, outcome_of
from tests.loeschung import geloescht
from tests.postausgang import MAIL_NOW
from tests.whole_database import where_folded_to
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_loeschung_isolation_test")

NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
TODAY = "2026-04-01"
SAISON_ID = "2026"

# Typed as a visitor types it, and the fold every record stores: the fold, never the spelling, says whose a record is.
TYPED = "Zorbanax.Quillfeather@Example.org"
IDENTIFIER = sign_in_identifier(TYPED)

TEAM_OID = ObjectId("6890a1b2c3d4e5f607e10001")
EINLADUNG_OID = ObjectId("6890a1b2c3d4e5f607e10002")
EINLADUNG_TOKEN = "einladung-erasure-isolation"
BEWERBUNG_OID = ObjectId("6890a1b2c3d4e5f607e10003")
PUPIL_OID = ObjectId("6890a1b2c3d4e5f607e10004")
PUPIL_EMAIL = "wraxlington@example.com"
REFEREE_OID = ObjectId("6890a1b2c3d4e5f607e10005")
STEPPED_OUT_OID = ObjectId("6890a1b2c3d4e5f607e10007")

OPEN_WINDOW = {"offen": True, "von": "2026-03-01", "bis": "2026-04-30"}

REFEREE_NAME = "Bernd Kraus"
TELEFON = "+49 69 5550202"

Rival = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


class GrantsReadThenRival(InterleavedCollection):
    """The grants, running the rival to its commit after the erasure's first read: its snapshot is open, and it has written nothing."""

    async def aggregate(self, *args: Any, **kwargs: Any) -> Any:
        cursor = await self._collection.aggregate(*args, **kwargs)
        await self.run_the_rival()
        return cursor


async def a_league(database: AsyncDatabase) -> None:
    """A season open to both windows, a club entered seatless with its live link, two applications, a pupil and an unconfirmed referee.

    Nothing here holds the erased address: what the case's writer commits is all of it.
    """

    await database[Collection.SAISONS].insert_one(
        saison_document(SAISON_ID, "active", registrierung=dict(OPEN_WINDOW), bewerbung=dict(OPEN_WINDOW))
    )
    await database[Collection.TEAMS].insert_one(team_document(TEAM_OID, "Lindenschule", "LSX"))
    await database[Collection.SAISON_TEAMS].insert_one(saison_team_document(SAISON_ID, TEAM_OID, "Lindenschule", "LSX", kontakte=None))
    await database[Collection.EINLADUNGEN].insert_one(
        {
            "_id": EINLADUNG_OID,
            "saison_id": SAISON_ID,
            "team_id": TEAM_OID,
            "token_hashes": [hash_token(EINLADUNG_TOKEN)],
            "erstellt_am": "2026-03-15",
            "erstellt_von": "admin@frankfurtleague.de",
            "widerrufen_am": None,
        }
    )
    await database[Collection.BEWERBUNGEN].insert_one(
        bewerbung_document(
            BEWERBUNG_OID,
            SAISON_ID,
            "eingereicht",
            kontakte=kontakte_document(
                ansprechperson=kontaktperson_document("Quillhilde"),
                stellvertretung=kontaktperson_document("Bramblewick"),
                trainer=kontaktperson_document("Wigglesworth"),
            ),
            eingereicht_am="2026-03-10",
            bestaetigungsfrist="2026-04-10",
            schule=neue_schule_document("Neue", "NEX"),
        )
    )
    await database[Collection.BEWERBUNGEN].insert_one(
        bewerbung_document(
            STEPPED_OUT_OID,
            SAISON_ID,
            "eingereicht",
            kontakte=kontakte_document(
                ansprechperson=kontaktperson_document("Quintessa"),
                stellvertretung=kontaktperson_document("Brunhilde"),
                trainer=kontaktperson_document("Ottokar"),
            ),
            eingereicht_am="2026-03-10",
            bestaetigungsfrist="2026-04-10",
            schule=neue_schule_document("Ander", "ANX"),
        )
    )
    # As the Stellvertretung's own Widerspruch leaves it, the one state a seat is filled again from.
    await database[Collection.BEWERBUNGEN].update_one(
        {"_id": STEPPED_OUT_OID}, compose_decline_update(seats=["stellvertretung"], today="2026-03-20")
    )
    await database[Collection.SPIELER].insert_one(spieler_document(PUPIL_OID, "Wraxlington", "Muster", email=PUPIL_EMAIL))
    await database[Collection.SCHIEDSRICHTER].insert_one(
        schiedsrichter_document(REFEREE_OID, email="kraus.bernd@example.com", name=REFEREE_NAME, default_payment=25, einwilligung=None)
    )


def on_a_league(url: str, body: Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]) -> Any:
    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await a_league(database)

            return await body(database, client)

    return on_the_seed_loop(_run())


# The erased person in the club's trainer seat, and somebody a save seats beside them, each as the editor sends a seat.
SEATED = {
    "vorname": "Zorbanax",
    "nachname": "Quillfeather",
    "email": TYPED,
    "telefon": TELEFON,
    "einwilligung": {"umfang": "kontaktdaten", "text_version": LAUFENDE_FASSUNGEN["bewerbung"], "datum": "2026-03-01"},
}
BESIDE = {**SEATED, "vorname": "Ottilie", "nachname": "Andere", "email": "ottilie.andere@example.com", "telefon": "+49 69 5550404"}


async def club_row(database: AsyncDatabase) -> dict[str, Any]:
    found = await database[Collection.SAISON_TEAMS].find_one({"team_id": TEAM_OID, "saison_id": SAISON_ID})
    assert found is not None, "the seeded row is gone"
    return found


async def contacts_saved(database: AsyncDatabase, client: AsyncMongoClient, kontakte: Any, stand: str) -> Any:
    return await patch_saison_team_kontakte(
        team_id=TEAM_OID,
        saison_id=SAISON_ID,
        kontakte_data=FLPatchSaisonTeamKontaktePayload.model_validate({"kontakte": kontakte, "kontakte_stand": stand}),
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        postausgang_collection=database[Collection.POSTAUSGANG],
        sperrliste=ban_list(database),
        db=client,
        actor=fresh_admin_actor(),
        today=TODAY,
        germany_now=MAIL_NOW,
    )


async def junction_patched(database: AsyncDatabase, client: AsyncMongoClient, values: dict[str, Any]) -> Any:
    return await patch_saison_team(
        team_id=TEAM_OID,
        saison_id=SAISON_ID,
        saison_team_data=FLPatchSaisonTeamPayload.model_validate(values),
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        db=client,
    )


def junction_values(row: dict[str, Any], **changed: Any) -> dict[str, Any]:
    return {"gruppe": row["gruppe"], "austritt": row.get("austritt"), "trikot_farbe": row.get("trikot_farbe"), **changed}


async def the_block_it_was_served(database: AsyncDatabase, client: AsyncMongoClient) -> Rival:
    stand = kontakte_stand_of((await club_row(database))["kontakte"])

    return lambda database, client: contacts_saved(database, client, kontakte_document(trainer=SEATED), stand)


async def another_seat_filled(database: AsyncDatabase, client: AsyncMongoClient) -> Rival:
    stand = kontakte_stand_of((await club_row(database))["kontakte"])

    return lambda database, client: contacts_saved(database, client, kontakte_document(trainer=SEATED, ansprechperson=BESIDE), stand)


async def the_row_as_it_stands(database: AsyncDatabase, client: AsyncMongoClient) -> Rival:
    # Sent once ahead, so the row already holds what the same PATCH writes.
    await junction_patched(database, client, junction_values(await club_row(database)))
    values = junction_values(await club_row(database))

    return lambda database, client: junction_patched(database, client, values)


async def another_kit_colour(database: AsyncDatabase, client: AsyncMongoClient) -> Rival:
    values = junction_values(await club_row(database), trikot_farbe="gruen")

    return lambda database, client: junction_patched(database, client, values)


# Each write an administrator can make to the club's row keeping the erased person's seat, with the log rows it files there.
KEEPING_WRITES: dict[str, tuple[Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Rival]], int]] = {
    "a contacts save sending the block it was served": (the_block_it_was_served, 0),
    "a contacts save filling another seat": (another_seat_filled, 1),
    "a junction PATCH sending the row as it stands": (the_row_as_it_stands, 0),
    "a junction PATCH changing the kit colour": (another_kit_colour, 1),
}


class TestAWriteKeepingTheirSeatInsideTheLoeschungLeavesNothing:
    """The row is what the erasure writes, so a write changing it meets the erasure there and one of the two runs again.

    A write leaving the row unchanged writes nothing the erasure writes, and files no log row either.
    """

    @pytest.mark.parametrize("write", list(KEEPING_WRITES))
    def test_nothing_holds_the_address_and_the_log_keeps_each_change(self, mongo_replica_set_url: str, write: str):
        """Record every patch and an unchanged row's log row keeps the address; record none inside a transaction and a change loses its row."""

        prepare, rows_filed = KEEPING_WRITES[write]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            # Saved twice, the first minting the person's link, so the stored block is what a later send of it composes.
            await contacts_saved(database, client, kontakte_document(trainer=SEATED), kontakte_stand_of(None))
            await contacts_saved(database, client, kontakte_document(trainer=SEATED), kontakte_stand_of((await club_row(database))["kontakte"]))
            keeping = await prepare(database, client)
            on_the_row = {"collection": str(Collection.SAISON_TEAMS)}
            written: list[str] = []
            filed: list[int] = []

            async def keep_the_seat() -> None:
                rows_before = await database[Collection.AKTIONEN].count_documents(on_the_row)
                written.append(await outcome_of(keeping(database, client)))
                filed.append(await database[Collection.AKTIONEN].count_documents(on_the_row) - rows_before)

            grants = GrantsReadThenRival(database[Collection.BERECHTIGUNGEN], keep_the_seat)
            outcome = await outcome_of(geloescht(database, client, TYPED, germany_now=NOW, berechtigungen_collection=grants))

            return outcome, written, filed, (await club_row(database))["kontakte"]["trainer"], await where_folded_to(database, IDENTIFIER)

        outcome, written, filed, trainer, held = on_a_league(mongo_replica_set_url, body)

        assert (outcome, written) == (COMMITTED, [COMMITTED]), "the write or the erasure never committed, so this case proves nothing"
        assert trainer is None, "the erased person's seat stands"
        assert held == [], f"{held} still hold the address the erasure answered for"
        assert filed == [rows_filed]
