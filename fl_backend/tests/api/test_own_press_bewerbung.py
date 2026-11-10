"""
API · a contact person's own press on a pending application, and the decision an administrator read before it

The press moves the person's own block and is judged by the state it moves, so it is no edit of the application: a
decision on the version read before it lands, and the press stands, on the application and on the season row the
acceptance copies the block to.
"""

from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from bson import ObjectId
from pydantic import TypeAdapter
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.admin_router import accept_bewerbung
from app.api.bewerbungen.person_router import patch_einwilligung
from app.api.bewerbungen.public_router import post_einwilligung
from app.api.bewerbungen.schemas import FLAcceptBewerbungPayload, FLBewerbungEinwilligungAnswerPayload
from app.core.collections import Collection
from app.shared.einwilligung_evidence import evidence_state_of
from app.shared.schemas.einwilligung import FLSeatEinwilligungPayload
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop
from tests.outbox import MAIL_NOW
from tests.worker import worker_database

# Module level: the press and the decision are each one transaction on a real mongod.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_own_press_bewerbung_test")

SAISON_ID = "2026"
TODAY = "2026-04-01"
TEAM_OID = ObjectId("6890a1b2c3d4e5f607840001")
BEWERBUNG_OID = ObjectId("6890a1b2c3d4e5f607840002")

# The trainer's address, as the sign-in binds it, and the seat as their own confirmation left it, media granted.
TRAINER = "wraxlington@example.com"
TRAINER_SEAT = documents.kontaktperson_document("Wraxlington", confirmed_at="2026-02-10", einwilligung={"media": True})

# What the administrator's page was served before the press.
SERVED_VERSION = 0


def bewerbung_document(*, ansprechperson_confirmed_at: str | None) -> dict[str, Any]:
    """Each seat's link minted today, the Ansprechperson's seat confirmed or still open."""

    kontakte = documents.kontakte_document(
        trainer=TRAINER_SEAT,
        ansprechperson=documents.kontaktperson_document("Quillhilde", confirmed_at=ansprechperson_confirmed_at),
        stellvertretung=documents.kontaktperson_document("Bramblewick", confirmed_at="2026-02-10"),
    )

    return documents.bewerbung_document(
        BEWERBUNG_OID, SAISON_ID, "submitted", kontakte=kontakte, submitted_at="2026-02-01", sent_at=TODAY, team_id=TEAM_OID
    )


async def withdraw_media(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    await patch_einwilligung(
        bewerbung_id=BEWERBUNG_OID,
        einwilligung_data=FLSeatEinwilligungPayload.model_validate(
            {
                "scope": TRAINER_SEAT["einwilligung"]["scope"],
                "media": False,
                "text_versions": dict(documents.SEAT_TEXT_VERSIONS),
                "evidence_state": evidence_state_of(blocks=[TRAINER_SEAT["einwilligung"]]),
            }
        ),
        identifier=TRAINER,
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        db=client,
        germany_now=MAIL_NOW,
    )


async def confirm_the_last_seat(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    """The Ansprechperson's own confirmation through the link their seat was mailed, `bewerbung_document`'s token."""

    await post_einwilligung(
        answer_data=TypeAdapter(FLBewerbungEinwilligungAnswerPayload).validate_python(
            {
                "answer": "given",
                "token": f"{BEWERBUNG_OID}-ansprechperson",
                "birth_date": "1984-05-09",
                "whatsapp": False,
                "media": False,
                "text_versions": dict(documents.SEAT_TEXT_VERSIONS),
            }
        ),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        outbox_collection=database[Collection.OUTBOX],
        db=client,
        today=TODAY,
        germany_now=MAIL_NOW,
    )


Press = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[None]]


def pressed_then_accepted(url: str, press: Press, *, ansprechperson_confirmed_at: str | None) -> tuple[dict[str, Any], dict[str, Any]]:
    """The application and the season row its acceptance entered, the acceptance sent on the version served before the press."""

    async def _run() -> tuple[dict[str, Any], dict[str, Any]]:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "future"))
            await database[Collection.TEAMS].insert_one(documents.team_document(TEAM_OID, "Adler", "ADX"))
            await database[Collection.BEWERBUNGEN].insert_one(bewerbung_document(ansprechperson_confirmed_at=ansprechperson_confirmed_at))
            await press(database, client)
            await accept_bewerbung(
                bewerbung_id=BEWERBUNG_OID,
                acceptance_data=FLAcceptBewerbungPayload.model_validate(
                    {"gruppe": "A", "trikot_farbe": "blau", "shorthand": None, "version": SERVED_VERSION}
                ),
                bewerbungen_collection=database[Collection.BEWERBUNGEN],
                teams_collection=database[Collection.TEAMS],
                saison_teams_collection=database[Collection.SAISON_TEAMS],
                saisons_collection=database[Collection.SAISONS],
                outbox_collection=database[Collection.OUTBOX],
                db=client,
                today=TODAY,
                germany_now=MAIL_NOW,
            )
            bewerbung = await database[Collection.BEWERBUNGEN].find_one({"_id": BEWERBUNG_OID})
            row = await database[Collection.SAISON_TEAMS].find_one({"team_id": TEAM_OID})
            assert bewerbung is not None and row is not None

            return bewerbung, row

    return on_the_seed_loop(_run())


class TestTheAcceptanceLandsOverThePress:
    def test_a_withdrawn_media_consent_stands_on_the_application_and_on_the_season_row(self, mongo_replica_set_url: str):
        bewerbung, row = pressed_then_accepted(mongo_replica_set_url, withdraw_media, ansprechperson_confirmed_at="2026-02-10")

        assert bewerbung["status"] == "accepted"
        assert (bewerbung["kontakte"]["trainer"]["einwilligung"]["media"], row["kontakte"]["trainer"]["einwilligung"]["media"]) == (
            False,
            False,
        )

    def test_the_last_seats_confirmation_stands_and_lets_the_acceptance_in(self, mongo_replica_set_url: str):
        """The page was read while the seat was open; the acceptance judges the seat as the confirmation left it."""

        bewerbung, row = pressed_then_accepted(mongo_replica_set_url, confirm_the_last_seat, ansprechperson_confirmed_at=None)

        assert bewerbung["status"] == "accepted"
        seat = row["kontakte"]["ansprechperson"]
        assert (seat["birth_date"], seat["einwilligung"]["confirmed_at"]) == ("1984-05-09", TODAY)
