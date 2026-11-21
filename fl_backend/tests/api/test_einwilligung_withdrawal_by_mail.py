"""
API · an administrator's entry of a withdrawal a person asked for by mail, on every record the address holds

The entry withholds each choice the mail names wherever a record at the address grants it and never grants: the name
on a pupil's, a referee's and a registration's own record, WhatsApp on a seat, the media consent on every one. Each
receipt is marked `via` `mail` where a press names a wording, and names the grant it ended, so the record still proves
what was given before. It moves past each record's count, as the person's own press does, and is recorded in the
Protokoll and journalled per record. Its dry run answers the same report and writes nothing.
"""

import logging
from collections.abc import Mapping
from datetime import datetime
from typing import Any, Final
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from httpx2 import Response
from pymongo.asynchronous.database import AsyncDatabase

from app.core.clock import utc_stamp
from app.core.collections import Collection
from app.shared.einwilligung_evidence import compose_initial
from tests.acts import acts_of, journal_records
from tests.app_client import app_client, app_under_test
from tests.config import ADMIN_AUTH, grants_for_the_suite
from tests.database import a_clean_database
from tests.documents import (
    SPIELER_TEXT_VERSIONS,
    bewerbung_document,
    confirmed_instant,
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
from tests.erasure_corpus import everything_in
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

# The person whose mail asked, holding a record of every kind and two seats of each seat's record, and somebody else
# holding the third seat. Typed as the mail's sender wrote it, which the entry folds as the records store it.
PERSON = "kim.kontakt@example.com"
TYPED = "Kim.Kontakt@Example.com"
OTHER = "lou.leitner@example.com"

URL = "/api/identity/withdrawal"
EVERY_CHOICE: Final = ["name", "whatsapp", "media"]


def _seat(email: str) -> dict[str, Any]:
    """A seat its own person confirmed, granting WhatsApp and media."""

    held = kontaktperson_document("Kim", confirmed_at="2026-02-10", einwilligung={"scope": "kontakt_data_whatsapp", "media": True})

    return {**held, "email": email}


KONTAKTE: Final = kontakte_document(
    trainer=_seat(PERSON), ansprechperson=_seat(PERSON), stellvertretung=_seat(OTHER), trainer_is_also="ansprechperson"
)

# The pupil's own confirmation, publishing the name and granting media.
PUPIL_EINWILLIGUNG: Final = compose_initial(
    block={"scope": "kader_public", "date": "2026-01-20", "confirmed_at": "2026-01-20", "media": True},
    at=confirmed_instant("2026-01-20"),
    text_versions=SPIELER_TEXT_VERSIONS,
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
    await database[Collection.SPIELER].insert_one(spieler_document(PUPIL_OID, "Anna", "Muster", email=PERSON, einwilligung=PUPIL_EINWILLIGUNG))
    # Retired, which a withdrawal reaches too; publishing the name and no media, as their own confirmation left it.
    await database[Collection.SCHIEDSRICHTER].insert_one(
        confirmed_referee_document(REFEREE_OID, PERSON, "Rita Ref", confirmed_at="2026-02-01", inactive_since="2026-07-01")
    )
    await database[Collection.REGISTRIERUNGEN].insert_one(
        registrierung_document(
            REGISTRATION_OID,
            PERSON,
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


# Each record at the address: its collection, its id, the blocks the person holds there, by path, and the seats they sit in.
RECORDS: Final[dict[str, tuple[Collection, ObjectId, tuple[str, ...], list[str]]]] = {
    "spieler": (Collection.SPIELER, PUPIL_OID, ("einwilligung",), []),
    "schiedsrichter": (Collection.SCHIEDSRICHTER, REFEREE_OID, ("einwilligung",), []),
    "kontakt_seats": (
        Collection.SAISON_TEAMS,
        ROW_OID,
        ("kontakte.trainer.einwilligung", "kontakte.ansprechperson.einwilligung"),
        ["trainer", "ansprechperson"],
    ),
    "bewerbung_seats": (
        Collection.BEWERBUNGEN,
        APPLICATION_OID,
        ("kontakte.trainer.einwilligung", "kontakte.ansprechperson.einwilligung"),
        ["trainer", "ansprechperson"],
    ),
    "registrierungen": (Collection.REGISTRIERUNGEN, REGISTRATION_OID, ("einwilligung",), []),
}

# What the mail naming every choice ends on each kind: every grant the seed gives, the referee's and the registration's
# media consent being withheld already.
EVERY_CHOICE_ENDS: Final = {
    "spieler": ["name", "media"],
    "schiedsrichter": ["name"],
    "kontakt_seats": ["whatsapp", "media"],
    "bewerbung_seats": ["whatsapp", "media"],
    "registrierungen": ["name"],
}

# The same, as each record's own choices, which its blocks and its journal line name.
EVERY_CHOICE_MOVES: Final = {
    "spieler": ["scope", "media"],
    "schiedsrichter": ["scope"],
    "kontakt_seats": ["scope", "media"],
    "bewerbung_seats": ["scope", "media"],
    "registrierungen": ["scope"],
}

# The Protokoll's row of each kind, as `acts_of` reads it, and its label.
ACTS: Final = {
    "spieler": (("spieler.einwilligung_withdrawn", ADMIN_AUTH.email, None, PUPIL_OID), None),
    "schiedsrichter": (("schiedsrichter.einwilligung_withdrawn", ADMIN_AUTH.email, None, REFEREE_OID), None),
    "kontakt_seats": (("team.seat_einwilligung_withdrawn", ADMIN_AUTH.email, None, TEAM_OID), ROW_NAME),
    "bewerbung_seats": (("bewerbung.seat_einwilligung_withdrawn", ADMIN_AUTH.email, None, APPLICATION_OID), TEAM_NAME),
    "registrierungen": (("registrierung.einwilligung_withdrawn", ADMIN_AUTH.email, None, REGISTRATION_OID), None),
}


def block(document: Mapping[str, Any], path: str) -> Mapping[str, Any]:
    """The consent block at a dotted path."""

    held: Any = document
    for name in path.split("."):
        held = held[name]

    return held


async def records_of(database: AsyncDatabase) -> dict[str, dict[str, Any]]:
    """Each kind's record at the address as it stands."""

    found = {kind: await database[collection].find_one({"_id": record_id}) for kind, (collection, record_id, *_) in RECORDS.items()}
    assert all(record is not None for record in found.values())

    return {kind: dict(record or {}) for kind, record in found.items()}


async def entered(url: str, choices: list[str]) -> tuple[Response, dict[str, dict[str, Any]], dict[str, dict[str, Any]], list[Any], list[Any]]:
    """The entry posted once, each kind's record before and after, the Protokoll's rows and their labels."""

    async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_client, database):
        await seeded(database)
        before = await records_of(database)
        async with app_client(url, app=app_under_test(DATABASE_NAME), now=NOW) as http:
            response = await http.post(URL, json={"email": TYPED, "choices": choices}, headers=ADMIN_AUTH)
        after = await records_of(database)
        acts = await acts_of(database)
        labels = [row["label"] async for row in database[Collection.ACTION_LOG].find().sort("_id", 1)]

    return response, before, after, acts, labels


def report(**ended: list[str]) -> dict[str, list[str]]:
    """The entry's answer: per kind what it ends, nothing where a kind is not named."""

    return {kind: ended.get(kind, []) for kind in RECORDS}


def withdrawn(was: Mapping[str, Any], choice: str) -> tuple[Any, Any]:
    """A choice and its evidence as the entry leaves a block that granted it: withheld, marked `via` `mail`, naming the grant."""

    withheld = {"scope": "kontakt_data" if was["scope"].startswith("kontakt") else "internal", "media": False}[choice]

    return withheld, {"at": utc_stamp(NOW), "via": "mail", "given_before": was["evidence"][choice]}


def kept(was: Mapping[str, Any], choice: str) -> tuple[Any, Any]:
    return was[choice], was["evidence"][choice]


@pytest.mark.parametrize("kind", RECORDS, ids=RECORDS)
async def test_every_kind_at_the_address_ends_each_named_choice_it_grants(
    mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture, kind: str
):
    """Each kind's record moves, recorded under its own act and journalled once, and the other person's seat stays."""

    collection, record_id, paths, seats = RECORDS[kind]
    moves = EVERY_CHOICE_MOVES[kind]

    with caplog.at_level(logging.INFO):
        response, before, after, acts, labels = await entered(mongo_replica_set_url, EVERY_CHOICE)
    lines = [vars(line) for line in journal_records(caplog) if vars(line)["records"] == [f"{collection}/{record_id}"]]

    assert (response.status_code, response.json()) == (200, report(**EVERY_CHOICE_ENDS))
    for path in paths:
        was, held = block(before[kind], path), block(after[kind], path)
        for choice in ("scope", "media"):
            # A choice withheld already keeps its own evidence, so the record keeps who set it and when.
            expected = withdrawn(was, choice) if choice in moves else kept(was, choice)
            assert (held[choice], held["evidence"][choice]) == expected, (path, choice)
    if seats:
        assert after[kind]["kontakte"]["stellvertretung"] == before[kind]["kontakte"]["stellvertretung"]
    # Past the count, as the person's own press is: no form saves the consent.
    assert after[kind].get("version") == before[kind].get("version")
    act, label = ACTS[kind]
    assert act in acts
    assert labels[acts.index(act)] == label
    assert len(acts) == len(RECORDS)
    assert [(line["act"], line["choices"], line["seats"]) for line in lines] == [("withdrawal", moves, seats)]


# Each choice alone, on an address holding a pupil and seats: the kinds it ends and the record choice it moves there.
ONE_CHOICE: Final = {
    "name": ({"spieler": ["name"], "schiedsrichter": ["name"], "registrierungen": ["name"]}, "scope"),
    "whatsapp": ({"kontakt_seats": ["whatsapp"], "bewerbung_seats": ["whatsapp"]}, "scope"),
    "media": ({"spieler": ["media"], "kontakt_seats": ["media"], "bewerbung_seats": ["media"]}, "media"),
}


@pytest.mark.parametrize("choice", ONE_CHOICE, ids=ONE_CHOICE)
async def test_each_choice_ends_its_own_consent_and_leaves_the_others_granted(mongo_replica_set_url: str, choice: str):
    """The name off the website leaves a seat's WhatsApp consent granted, and WhatsApp leaves the pupil's name published."""

    ends, record_choice = ONE_CHOICE[choice]

    response, before, after, acts, _ = await entered(mongo_replica_set_url, [choice])

    assert (response.status_code, response.json()) == (200, report(**ends))
    for kind, (_collection, _record_id, paths, _seats) in RECORDS.items():
        for path in paths:
            was, held = block(before[kind], path), block(after[kind], path)
            for each in ("scope", "media"):
                expected = withdrawn(was, each) if kind in ends and each == record_choice else kept(was, each)
                assert (held[each], held["evidence"][each]) == expected, (kind, path, each)
    assert len(acts) == len(ends)


async def test_the_dry_run_answers_the_entrys_report_and_writes_nothing(mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
    async with a_clean_database(mongo_replica_set_url, DATABASE_NAME, constraints=True) as (_client, database):
        await seeded(database)
        before = await everything_in(database)
        with caplog.at_level(logging.INFO):
            async with app_client(mongo_replica_set_url, app=app_under_test(DATABASE_NAME), now=NOW) as http:
                response = await http.post(URL, params={"dry_run": "true"}, json={"email": TYPED, "choices": EVERY_CHOICE}, headers=ADMIN_AUTH)
        after = await everything_in(database)

    assert (response.status_code, response.json()) == (200, report(**EVERY_CHOICE_ENDS))
    assert after == before
    assert journal_records(caplog) == []


async def test_a_choice_already_withheld_is_left_out_and_a_second_mail_moves_nothing(
    mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture
):
    """The second mail's answer names nothing, the first entry's evidence stands, and the Protokoll holds the first's acts alone."""

    async with a_clean_database(mongo_replica_set_url, DATABASE_NAME, constraints=True) as (_client, database):
        await seeded(database)
        async with app_client(mongo_replica_set_url, app=app_under_test(DATABASE_NAME), now=NOW) as http:
            first = await http.post(URL, json={"email": TYPED, "choices": EVERY_CHOICE}, headers=ADMIN_AUTH)
            once = await records_of(database)
            with caplog.at_level(logging.INFO):
                second = await http.post(URL, json={"email": TYPED, "choices": EVERY_CHOICE}, headers=ADMIN_AUTH)
        twice = await records_of(database)
        acts = await acts_of(database)

    assert (first.status_code, first.json()) == (200, report(**EVERY_CHOICE_ENDS))
    assert (second.status_code, second.json()) == (200, report())
    assert twice == once
    assert len(acts) == len(RECORDS)
    assert journal_records(caplog) == []
