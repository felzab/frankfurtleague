"""
API · an administrator's entry of a withdrawal a person asked for by mail, on each kind of consent record

The entry withholds the choices it names wherever the record grants them and never grants, marks its evidence `via`
`mail` where a press names a wording, and names the grant it ended, so the record still proves what was given before.
It moves the same blocks the person's own press moves, past the record's count as that press does, and is recorded in
the Protokoll and journalled as a withdrawal.
"""

import logging
from datetime import datetime
from typing import Any, Final
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from httpx2 import Response
from pymongo.asynchronous.database import AsyncDatabase

from app.core.clock import utc_stamp
from app.core.codes import Code
from app.core.collections import Collection
from app.core.recording import FLAction
from tests.acts import acts_of, journal_records
from tests.app_client import app_client, app_under_test
from tests.config import ADMIN_AUTH, grants_for_the_suite
from tests.database import a_clean_database
from tests.documents import (
    bewerbung_document,
    confirmed_referee_document,
    kontakte_document,
    kontaktperson_document,
    registrierung_confirmed,
    registrierung_document,
    saison_document,
    saison_team_document,
    spieler_document,
    team_document,
)
from tests.worker import worker_database

# Module level: each entry is one transaction on a real mongod.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_einwilligung_withdrawal_by_mail_test")

NOW = datetime(2026, 10, 3, 12, 0, tzinfo=ZoneInfo("Europe/Berlin"))
SAISON_ID = "2026"
TEAM_NAME = "Helmholtz-Gymnasium"
ROW_NAME = "Helmholtz"

TEAM_OID = ObjectId("6890a1b2c3d4e5f607860001")
ROW_OID = ObjectId("6890a1b2c3d4e5f607860002")
APPLICATION_OID = ObjectId("6890a1b2c3d4e5f607860003")
PUPIL_OID = ObjectId("6890a1b2c3d4e5f607860004")
REFEREE_OID = ObjectId("6890a1b2c3d4e5f607860005")
REGISTRATION_OID = ObjectId("6890a1b2c3d4e5f607860006")

# The person whose mail asked, holding two seats of each seat's record, and somebody else holding the third.
PERSON = "kim.kontakt@example.com"
OTHER = "lou.leitner@example.com"


def _seat(email: str) -> dict[str, Any]:
    """A seat its own person confirmed, granting WhatsApp and media."""

    held = kontaktperson_document("Kim", confirmed_at="2026-02-10", einwilligung={"scope": "kontakt_data_whatsapp", "media": True})

    return {**held, "email": email}


KONTAKTE: Final = kontakte_document(
    trainer=_seat(PERSON), ansprechperson=_seat(PERSON), stellvertretung=_seat(OTHER), trainer_is_also="ansprechperson"
)


async def seeded(database: AsyncDatabase) -> None:
    await database[Collection.GRANTS].insert_many(grants_for_the_suite())
    await database[Collection.TEAMS].insert_one(team_document(TEAM_OID, TEAM_NAME, "HEX"))
    await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, "active"))
    await database[Collection.SAISON_TEAMS].insert_one(
        {**saison_team_document(SAISON_ID, TEAM_OID, ROW_NAME, "HEX", kontakte=KONTAKTE), "_id": ROW_OID}
    )
    await database[Collection.BEWERBUNGEN].insert_one(
        bewerbung_document(APPLICATION_OID, SAISON_ID, "submitted", kontakte=KONTAKTE, submitted_at="2026-02-01", team_id=TEAM_OID)
    )
    # Each publishing the name and no media, as their own confirmation left it.
    await database[Collection.SPIELER].insert_one(spieler_document(PUPIL_OID, "Anna", "Muster"))
    await database[Collection.SCHIEDSRICHTER].insert_one(
        confirmed_referee_document(REFEREE_OID, "rita.ref@schule.example.org", "Rita Ref", confirmed_at="2026-02-01")
    )
    await database[Collection.REGISTRIERUNGEN].insert_one(
        registrierung_document(
            REGISTRATION_OID,
            "rosa.reg@schule.example.org",
            saison_id=SAISON_ID,
            team_id=TEAM_OID,
            first_name="Rosa",
            last_name="Reg",
            token="registration-link",
            submitted_at="2026-01-02",
            deadline="2026-01-09",
            confirmed=registrierung_confirmed(
                birth_date="2009-05-04", today="2026-01-03", at="2026-01-03T08:00:00+00:00", scope="kader_public", media=False
            ),
        )
    )


# Each record holding one person's own block: its entry's address, its collection, its id and its Protokoll act.
OWN_RECORDS: Final[dict[str, tuple[str, Collection, ObjectId, FLAction]]] = {
    "a pupil": (f"/api/spieler/{PUPIL_OID}/einwilligung/withdrawal", Collection.SPIELER, PUPIL_OID, "spieler.einwilligung_withdrawn"),
    "a referee": (
        f"/api/schiedsrichter/{REFEREE_OID}/einwilligung/withdrawal",
        Collection.SCHIEDSRICHTER,
        REFEREE_OID,
        "schiedsrichter.einwilligung_withdrawn",
    ),
    "a registration": (
        f"/api/registrierungen/{REGISTRATION_OID}/einwilligung/withdrawal",
        Collection.REGISTRIERUNGEN,
        REGISTRATION_OID,
        "registrierung.einwilligung_withdrawn",
    ),
}

# Each record of seats: its entry's address for a seat, its collection, its id, its Protokoll act, and the record and
# label the act names.
SEAT_RECORDS: Final[dict[str, tuple[str, Collection, ObjectId, FLAction, ObjectId, str]]] = {
    "a season row": (
        f"/api/teams/{TEAM_OID}/saisons/{SAISON_ID}/kontakte/{{seat}}/einwilligung/withdrawal",
        Collection.SAISON_TEAMS,
        ROW_OID,
        "team.seat_einwilligung_withdrawn",
        TEAM_OID,
        ROW_NAME,
    ),
    "an application": (
        f"/api/bewerbungen/{APPLICATION_OID}/kontakte/{{seat}}/einwilligung/withdrawal",
        Collection.BEWERBUNGEN,
        APPLICATION_OID,
        "bewerbung.seat_einwilligung_withdrawn",
        APPLICATION_OID,
        TEAM_NAME,
    ),
}


async def entered(
    url: str, path: str, choices: list[str], *, collection: Collection, record_id: ObjectId, times: int = 1
) -> tuple[list[Response], dict[str, Any], dict[str, Any], list[Any], list[Any]]:
    """The entry posted `times`, the record before and after, the Protokoll's rows and the action log's labels."""

    async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_client, database):
        await seeded(database)
        before = await database[collection].find_one({"_id": record_id})
        async with app_client(url, app=app_under_test(DATABASE_NAME), now=NOW) as http:
            responses = [await http.post(path, json={"choices": choices}, headers=ADMIN_AUTH) for _ in range(times)]
        after = await database[collection].find_one({"_id": record_id})
        acts = await acts_of(database)
        labels = [row["label"] async for row in database[Collection.ACTION_LOG].find().sort("_id", 1)]
    assert before is not None
    assert after is not None

    return responses, before, after, acts, labels


@pytest.mark.parametrize("kind", OWN_RECORDS, ids=OWN_RECORDS)
async def test_an_own_records_granted_scope_is_withheld_by_mail_and_its_withheld_media_stands(
    mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture, kind: str
):
    path, collection, record_id, action = OWN_RECORDS[kind]

    with caplog.at_level(logging.INFO):
        [response], before, after, acts, _ = await entered(
            mongo_replica_set_url, path, ["scope", "media"], collection=collection, record_id=record_id
        )
    granted = before["einwilligung"]["evidence"]["scope"]
    [line] = journal_records(caplog)

    assert response.status_code == 204
    assert (after["einwilligung"]["scope"], after["einwilligung"]["evidence"]["scope"]) == (
        "internal",
        {"at": utc_stamp(NOW), "via": "mail", "given_before": granted},
    )
    # Withheld already: its own evidence stands, so the record keeps who set it and when.
    assert (after["einwilligung"]["media"], after["einwilligung"]["evidence"]["media"]) == (False, before["einwilligung"]["evidence"]["media"])
    # Past the count, as the person's own press is: no form saves the consent.
    assert after.get("version") == before.get("version")
    assert acts == [(action, ADMIN_AUTH.email, None, record_id)]
    assert (vars(line)["act"], vars(line)["records"], vars(line)["choices"], vars(line)["seats"]) == (
        "withdrawal",
        [f"{collection}/{record_id}"],
        ["scope"],
        [],
    )


@pytest.mark.parametrize("kind", SEAT_RECORDS, ids=SEAT_RECORDS)
async def test_a_seats_entry_withdraws_on_every_seat_of_its_person_and_on_no_other(
    mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture, kind: str
):
    """Named by the Ansprechperson's seat, it reaches the Trainer's too, the person's account page showing both as one entry."""

    path, collection, record_id, action, act_record, label = SEAT_RECORDS[kind]

    with caplog.at_level(logging.INFO):
        [response], before, after, acts, labels = await entered(
            mongo_replica_set_url, path.format(seat="ansprechperson"), ["media"], collection=collection, record_id=record_id
        )
    [line] = journal_records(caplog)

    assert response.status_code == 204
    for slot in ("trainer", "ansprechperson"):
        held, was = after["kontakte"][slot]["einwilligung"], before["kontakte"][slot]["einwilligung"]
        assert (held["media"], held["evidence"]["media"]) == (
            False,
            {"at": utc_stamp(NOW), "via": "mail", "given_before": was["evidence"]["media"]},
        ), slot
        # Not named, so the WhatsApp consent stands.
        assert (held["scope"], held["evidence"]["scope"]) == (was["scope"], was["evidence"]["scope"]), slot
    assert after["kontakte"]["stellvertretung"] == before["kontakte"]["stellvertretung"]
    assert after.get("version") == before.get("version")
    assert (acts, labels) == ([(action, ADMIN_AUTH.email, None, act_record)], [label])
    assert (vars(line)["records"], vars(line)["choices"], vars(line)["seats"]) == (
        [f"{collection}/{record_id}"],
        ["media"],
        ["trainer", "ansprechperson"],
    )


ENTRIES: Final = {
    **{kind: (path, collection, record_id) for kind, (path, collection, record_id, _) in OWN_RECORDS.items()},
    **{kind: (path.format(seat="trainer"), collection, record_id) for kind, (path, collection, record_id, *_) in SEAT_RECORDS.items()},
}


@pytest.mark.parametrize("kind", ENTRIES, ids=ENTRIES)
async def test_a_second_mail_moves_nothing_and_records_nothing(mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture, kind: str):
    """The first entry's evidence stands, and the Protokoll and the journal hold one act."""

    path, collection, record_id = ENTRIES[kind]

    async with a_clean_database(mongo_replica_set_url, DATABASE_NAME, constraints=True) as (_client, database):
        await seeded(database)
        async with app_client(mongo_replica_set_url, app=app_under_test(DATABASE_NAME), now=NOW) as http:
            first = await http.post(path, json={"choices": ["scope", "media"]}, headers=ADMIN_AUTH)
            once = await database[collection].find_one({"_id": record_id})
            with caplog.at_level(logging.INFO):
                second = await http.post(path, json={"choices": ["scope", "media"]}, headers=ADMIN_AUTH)
        twice = await database[collection].find_one({"_id": record_id})
        acts = await acts_of(database)

    assert (first.status_code, second.status_code) == (204, 204)
    assert twice == once
    assert len(acts) == 1
    assert journal_records(caplog) == []


@pytest.mark.parametrize("kind", SEAT_RECORDS, ids=SEAT_RECORDS)
async def test_a_seat_no_record_has_answers_404(mongo_replica_set_url: str, kind: str):
    path, collection, record_id, *_ = SEAT_RECORDS[kind]

    [response], before, after, acts, _ = await entered(
        mongo_replica_set_url, path.format(seat="kapitaen"), ["media"], collection=collection, record_id=record_id
    )

    assert (response.status_code, response.json()["error_code"]) == (404, Code.DOCUMENT_NOT_FOUND)
    assert (after, acts) == (before, [])
