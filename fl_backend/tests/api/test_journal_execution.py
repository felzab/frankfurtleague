"""
API · the one line each withdrawal and objection writes

A restore rolls the record back with the log, so this line is what says the person's choice must be made again
(`docs/ops/runbooks.md`). A site losing its line goes unnoticed until a restore brings the withdrawn consent back.
"""

import functools
import logging
from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from fastapi import FastAPI
from httpx2 import AsyncClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.schiedsrichter.services import compose_confirmation, confirmation_deadline_from, erase_at_from
from app.api.teams.services import compose_kontakt_confirmation
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.main import create_app
from app.shared.einwilligung_evidence import TextVersions, evidence_state_of
from app.shared.tokens import hash_token
from tests.app_client import app_client
from tests.config import ADMIN_KEY, BASE_AUTH
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import (
    SCHIEDSRICHTER_TEXT_VERSIONS,
    SEAT_TEXT_VERSIONS,
    SPIELER_TEXT_VERSIONS,
    bewerbung_document,
    kontakte_document,
    kontaktperson_document,
    own_einwilligung_document,
    registrierung_confirmed,
    registrierung_document,
    saison_document,
    saison_team_document,
    schiedsrichter_document,
    spieler_document,
    team_document,
)
from tests.session_headers import StampedHeaders
from tests.worker import worker_database

from .conftest import config_for
from .test_identity_erasure_execution import journal_records

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_journal_test")

# A century ahead of the real clock, as every seeded day here: the TTL monitor deletes an expired row under a case reading it back.
NOW = datetime(2126, 10, 3, 12, 0, tzinfo=ZoneInfo("Europe/Berlin"))
TODAY = "2126-10-03"
SAISON_ID = "2026"
ADULT = "1990-05-09"

V = f"/api/v{API_VERSION}"

# One person holding a pupil row, a referee row and two seats.
PERSON = "ortrud.zwiebelmayer@schule.de"
REGISTRANT = "jonas.jungspund@schule.de"
OBJECTING_REFEREE = "kunigunde@schule.de"
# `kontaktperson_document`'s address for a seat named so.
DECLINER = "ida@example.com"

TEAM_OID = ObjectId("6890a1b2c3d4e5f607870001")
ROW_OID = ObjectId("6890a1b2c3d4e5f607870002")
PUPIL_OID = ObjectId("6890a1b2c3d4e5f607870011")
REFEREE_OID = ObjectId("6890a1b2c3d4e5f607870021")
OBJECTING_REFEREE_OID = ObjectId("6890a1b2c3d4e5f607870023")
APPLICATION_OID = ObjectId("6890a1b2c3d4e5f607870031")
DECLINED_APPLICATION_OID = ObjectId("6890a1b2c3d4e5f607870032")
REGISTRATION_OID = ObjectId("6890a1b2c3d4e5f607870041")

ROW_LINK = "the-season-rows-link"
APPLICATION_LINK = "the-applications-link"
REFEREE_LINK = "the-referees-link"


def own(text_versions: TextVersions) -> dict[str, Any]:
    """A person's own record's consent, both choices granted under its kind's wordings."""

    return own_einwilligung_document(text_versions=text_versions, confirmed_at="2126-09-02", media=True)


def seat(email: str, *, confirmed: bool = True) -> dict[str, Any]:
    held = kontaktperson_document(
        "Ortrud" if confirmed else "Ida",
        confirmed_at="2126-09-03" if confirmed else None,
        birth_date=ADULT if confirmed else None,
        einwilligung={"scope": "kontakt_data_whatsapp", "media": True} if confirmed else {},
    )

    return {**held, "email": email}


async def seeded(database: AsyncDatabase) -> None:
    await database[Collection.TEAMS].insert_one(team_document(TEAM_OID, "Helmholtz-Gymnasium", "HEX"))
    await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, "active"))
    await database[Collection.SAISON_TEAMS].insert_one(
        {
            **saison_team_document(
                SAISON_ID,
                TEAM_OID,
                "Helmholtz",
                "HEX",
                kontakte=kontakte_document(trainer=seat(PERSON), stellvertretung=seat(DECLINER, confirmed=False)),
            ),
            "_id": ROW_OID,
            # An administrator seated the Stellvertretung, whose link is still unanswered.
            "confirmations": {
                "trainer": None,
                "ansprechperson": None,
                "stellvertretung": {**compose_kontakt_confirmation(today=TODAY), "token_hashes": [hash_token(ROW_LINK)]},
            },
        }
    )
    await database[Collection.BEWERBUNGEN].insert_many(
        [
            bewerbung_document(
                APPLICATION_OID,
                SAISON_ID,
                "submitted",
                kontakte=kontakte_document(trainer=seat(PERSON)),
                submitted_at="2126-09-01",
                confirmation_deadline="2126-10-15",
                team_id=TEAM_OID,
            ),
            bewerbung_document(
                DECLINED_APPLICATION_OID,
                SAISON_ID,
                "submitted",
                kontakte=kontakte_document(trainer=seat(DECLINER, confirmed=False), ansprechperson=seat(PERSON)),
                submitted_at="2126-10-01",
                confirmation_deadline="2126-10-15",
                team_id=TEAM_OID,
                link_prefix=APPLICATION_LINK,
                sent_at="2126-10-01",
            ),
        ]
    )
    await database[Collection.SPIELER].insert_one(
        spieler_document(PUPIL_OID, "Ortrud", "Zwiebelmayer", email=PERSON, birth_date=ADULT, einwilligung=own(SPIELER_TEXT_VERSIONS))
    )
    await database[Collection.SCHIEDSRICHTER].insert_many(
        [
            schiedsrichter_document(
                REFEREE_OID,
                email=PERSON,
                name="Ortrud Zwiebelmayer",
                default_payment=20,
                einwilligung=own(SCHIEDSRICHTER_TEXT_VERSIONS),
                birth_date=ADULT,
            ),
            # Entered and mailed earlier, and unanswered: the link the objection is pressed through.
            schiedsrichter_document(
                OBJECTING_REFEREE_OID,
                email=OBJECTING_REFEREE,
                name="Kunigunde Wackelstein",
                default_payment=20,
                einwilligung=None,
                confirmation={**compose_confirmation(today="2126-10-01"), "token_hashes": [hash_token(REFEREE_LINK)]},
                erase_at=erase_at_from(deadline=confirmation_deadline_from(today="2126-10-01")),
            ),
        ]
    )
    await database[Collection.REGISTRIERUNGEN].insert_one(
        registrierung_document(
            REGISTRATION_OID,
            REGISTRANT,
            saison_id=SAISON_ID,
            team_id=TEAM_OID,
            first_name="Jonas",
            last_name="Jungspund",
            token=str(REGISTRATION_OID),
            submitted_at="2126-09-20",
            deadline="2126-09-27",
            position="Mittelfeld",
            nummer="17",
            stufe="Q1",
            confirmed=registrierung_confirmed(
                birth_date=ADULT,
                today="2126-09-21",
                at="2126-09-21T08:00:00+00:00",
                scope="kader_public",
                media=True,
            ),
        )
    )


@functools.cache
def _app() -> FastAPI:
    return create_app(config_for(DATABASE_NAME))


@pytest.fixture(scope="module", autouse=True)
def _built_before_any_case() -> None:
    """Built before `caplog` attaches: the build's logging setup takes every handler off the root, the capture's among them."""

    _app()


def as_person(email: str) -> StampedHeaders:
    return StampedHeaders(email, ADMIN_KEY, lane="person")


def withdrawal(text_versions: TextVersions, block: dict[str, Any], **choices: Any) -> dict[str, Any]:
    return {"text_versions": dict(text_versions), "evidence_state": evidence_state_of(blocks=[block]), **choices}


def declined(token: str) -> dict[str, str]:
    return {"token": token, "answer": "declined"}


async def registration_withdrawal(http: AsyncClient, database: AsyncDatabase) -> Any:
    """Its confirmation stamped evidence, so the page serves that evidence's stand."""

    stored = await database[Collection.REGISTRIERUNGEN].find_one({"_id": REGISTRATION_OID})
    assert stored is not None

    return await http.patch(
        f"{V}/registrierungen/account/{REGISTRATION_OID}/einwilligung",
        json=withdrawal(SPIELER_TEXT_VERSIONS, stored["einwilligung"], scope="internal", media=True),
        headers=as_person(REGISTRANT),
    )


Press = Callable[[AsyncClient, AsyncDatabase], Awaitable[Any]]

# Every press writing a line, as the person makes it: its act and the record the line names.
PRESSES: dict[str, tuple[Press, str, Collection, ObjectId]] = {
    "a pupil's withdrawal": (
        lambda http, _database: http.patch(
            f"{V}/spieler/account/einwilligung",
            json=withdrawal(SPIELER_TEXT_VERSIONS, own(SPIELER_TEXT_VERSIONS), scope="internal", media=False),
            headers=as_person(PERSON),
        ),
        "withdrawal",
        Collection.SPIELER,
        PUPIL_OID,
    ),
    "a referee's withdrawal": (
        lambda http, _database: http.patch(
            f"{V}/schiedsrichter/account/{REFEREE_OID}/einwilligung",
            json=withdrawal(SCHIEDSRICHTER_TEXT_VERSIONS, own(SCHIEDSRICHTER_TEXT_VERSIONS), scope="kader_public", media=False),
            headers=as_person(PERSON),
        ),
        "withdrawal",
        Collection.SCHIEDSRICHTER,
        REFEREE_OID,
    ),
    "a season seat's withdrawal": (
        lambda http, _database: http.patch(
            f"{V}/teams/{TEAM_OID}/saisons/{SAISON_ID}/account/einwilligung",
            json=withdrawal(SEAT_TEXT_VERSIONS, seat(PERSON)["einwilligung"], scope="kontakt_data", media=True),
            headers=as_person(PERSON),
        ),
        "withdrawal",
        Collection.SAISON_TEAMS,
        ROW_OID,
    ),
    "a pending application seat's withdrawal": (
        lambda http, _database: http.patch(
            f"{V}/bewerbungen/{APPLICATION_OID}/account/einwilligung",
            json=withdrawal(SEAT_TEXT_VERSIONS, seat(PERSON)["einwilligung"], scope="kontakt_data_whatsapp", media=False),
            headers=as_person(PERSON),
        ),
        "withdrawal",
        Collection.BEWERBUNGEN,
        APPLICATION_OID,
    ),
    "a pending registration's withdrawal": (registration_withdrawal, "withdrawal", Collection.REGISTRIERUNGEN, REGISTRATION_OID),
    "an objection on an application": (
        lambda http, _database: http.post(f"{V}/bewerbungen/einwilligung", json=declined(f"{APPLICATION_LINK}-trainer"), headers=BASE_AUTH),
        "objection",
        Collection.BEWERBUNGEN,
        DECLINED_APPLICATION_OID,
    ),
    "an objection on a season row": (
        lambda http, _database: http.post(f"{V}/bewerbungen/einwilligung", json=declined(ROW_LINK), headers=BASE_AUTH),
        "objection",
        Collection.SAISON_TEAMS,
        ROW_OID,
    ),
    "a referee's objection": (
        lambda http, _database: http.post(f"{V}/schiedsrichter/confirmation/decline", json={"token": REFEREE_LINK}, headers=BASE_AUTH),
        "objection",
        Collection.SCHIEDSRICHTER,
        OBJECTING_REFEREE_OID,
    ),
}


@pytest.mark.parametrize("press", PRESSES, ids=PRESSES)
def test_each_press_writes_one_line_naming_its_record_and_no_address(mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture, press: str):
    """No address: the line outlives the erasure it may later have to sit beside."""

    act, kind, collection, record_id = PRESSES[press]

    async def run() -> int:
        async with a_clean_database(mongo_replica_set_url, DATABASE_NAME, constraints=True) as (_client, database):
            await seeded(database)
            async with app_client(mongo_replica_set_url, app=_app(), now=NOW) as http:
                with caplog.at_level(logging.INFO):
                    return (await act(http, database)).status_code

    status = on_the_seed_loop(run())
    [record] = journal_records(caplog)
    line = {key: vars(record)[key] for key in ("act", "records", "choices", "seats")}

    assert status < 300
    assert (line["act"], line["records"]) == (kind, [f"{collection}/{record_id}"])
    assert "@" not in str(line)
