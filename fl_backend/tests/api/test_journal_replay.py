"""
API · a restore runs a person's own later choices again: the line each press journals, and the replay writing what the press wrote

A withdrawal, a Widerspruch and a declined address change made after a snapshot are rolled back with the log that recorded
them; the journal line is all that brings one back (`app/api/identitaet/wiederherstellung.py`). Each case presses as the
person, puts the record back as the snapshot held it, replays the line, and requires the very record the press left, its
evidence's instant included; then replays it again and requires nothing to move.
"""

import functools
import io
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from fastapi import FastAPI
from httpx2 import AsyncClient
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.services import hash_token
from app.api.identitaet.wiederherstellung import REPLAY_METHOD, plan, replay, run
from app.api.schiedsrichter.services import compose_adresswechsel
from app.api.spieler.services import compose_spieler_adresswechsel
from app.api.teams.services import compose_kontakt_bestaetigung
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.journal import JOURNAL_TOKEN, JournalLine, parse_line
from app.core.logging import JSONFormatter
from app.core.security import loeschung_journal_hash
from app.main import create_app
from app.shared.einwilligung import LAUFENDE_FASSUNGEN, Seite
from app.shared.einwilligung_nachweis import nachweis_stand_of
from tests.actor_tokens import SignedActor
from tests.app_client import app_client
from tests.config import ADMIN_KEY, BASE_AUTH
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import (
    bewerbung_document,
    eigene_einwilligung_document,
    kontakte_document,
    kontaktperson_document,
    registrierung_bestaetigt,
    registrierung_document,
    saison_document,
    saison_team_document,
    schiedsrichter_document,
    spieler_document,
    team_document,
)
from tests.worker import worker_database

from .conftest import config_for

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_journal_replay_test")
CONFIG = config_for(DATABASE_NAME)
KEY = CONFIG.sperrliste_schluessel

NOW = datetime(2026, 10, 3, 12, 0, tzinfo=ZoneInfo("Europe/Berlin"))
TODAY = "2026-10-03"
# `NOW` as the evidence spells it, written out so a replay stamping its own clock cannot agree with it.
AM = "2026-10-03T10:00:00+00:00"
# The replay runs a day later: whatever it stamps from its own clock differs from what the press stamped.
REPLAY_NOW = datetime(2026, 10, 4, 9, 0, tzinfo=UTC)
SAISON_ID = "2026"
ADULT = "1990-05-09"

# One person holding a pupil row, a referee row and two seats, stored in the spellings each record keeps.
PERSON = "ortrud.zwiebelmayer@schule.de"
PERSON_TYPED = "Ortrud.Zwiebelmayer@Schule.de"
REGISTRANT = "jonas.jungspund@schule.de"
NEW_ADDRESS = "neu.postfach@anderswo.de"
# `kontaktperson_document`'s address for a seat named so.
DECLINER = "ida@example.com"

TEAM_OID = ObjectId("6890a1b2c3d4e5f607870001")
ROW_OID = ObjectId("6890a1b2c3d4e5f607870002")
PUPIL_OID = ObjectId("6890a1b2c3d4e5f607870011")
MOVING_PUPIL_OID = ObjectId("6890a1b2c3d4e5f607870012")
REFEREE_OID = ObjectId("6890a1b2c3d4e5f607870021")
MOVING_REFEREE_OID = ObjectId("6890a1b2c3d4e5f607870022")
APPLICATION_OID = ObjectId("6890a1b2c3d4e5f607870031")
DECLINED_APPLICATION_OID = ObjectId("6890a1b2c3d4e5f607870032")
REGISTRATION_OID = ObjectId("6890a1b2c3d4e5f607870041")

CONFIRMED_LABEL = "2026-09-schiedsrichterseite-3"
SEAT_LABEL = "2026-09-bestaetigungsseite-6"
NO_EVIDENCE = {"umfang": None, "medien": None}

ROW_LINK = "the-season-rows-link"
APPLICATION_LINK = "the-applications-link"
REFEREE_ADDRESS_LINK = "the-referees-address-link"
PUPIL_ADDRESS_LINK = "the-pupils-address-link"


def _own(**fields: Any) -> dict[str, Any]:
    """A person's own record's consent, both choices granted."""

    return eigene_einwilligung_document(text_version=CONFIRMED_LABEL, bestaetigt_am="2026-09-02", medien=True, **fields)


def _seat(email: str, *, confirmed: bool = True) -> dict[str, Any]:
    seat = kontaktperson_document(
        "Ortrud" if confirmed else "Ida",
        bestaetigt_am="2026-09-03" if confirmed else None,
        geburtsdatum=ADULT if confirmed else None,
        einwilligung={"umfang": "kontaktdaten_whatsapp", "medien": True, "erfasst_von": "person", "text_version": SEAT_LABEL}
        if confirmed
        else {},
    )
    return {**seat, "email": email}


async def _seed(database: AsyncDatabase) -> None:
    await database[Collection.TEAMS].insert_one(team_document(TEAM_OID, "Helmholtz-Gymnasium", "HE"))
    await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, "active"))
    await database[Collection.SAISON_TEAMS].insert_one(
        {
            **saison_team_document(
                SAISON_ID,
                TEAM_OID,
                "Helmholtz",
                "HE",
                kontakte=kontakte_document(trainer=_seat(PERSON_TYPED), stellvertretung=_seat(DECLINER, confirmed=False)),
            ),
            "_id": ROW_OID,
            # An administrator seated the Stellvertretung, whose link is still unanswered.
            "bestaetigungen": {
                "trainer": None,
                "ansprechperson": None,
                "stellvertretung": compose_kontakt_bestaetigung(token_hash=hash_token(ROW_LINK), today=TODAY),
            },
        }
    )
    await database[Collection.BEWERBUNGEN].insert_many(
        [
            bewerbung_document(
                APPLICATION_OID,
                SAISON_ID,
                "eingereicht",
                kontakte=kontakte_document(trainer=_seat(PERSON_TYPED)),
                eingereicht_am="2026-09-01",
                bestaetigungsfrist="2026-10-15",
                team_id=TEAM_OID,
            ),
            bewerbung_document(
                DECLINED_APPLICATION_OID,
                SAISON_ID,
                "eingereicht",
                kontakte=kontakte_document(trainer=_seat(DECLINER, confirmed=False)),
                eingereicht_am="2026-10-01",
                bestaetigungsfrist="2026-10-15",
                team_id=TEAM_OID,
                link_prefix=APPLICATION_LINK,
                verschickt_am="2026-10-01",
            ),
        ]
    )
    await database[Collection.SPIELER].insert_many(
        [
            spieler_document(PUPIL_OID, "Ortrud", "Zwiebelmayer", email=PERSON, geburtsdatum=ADULT, einwilligung=_own()),
            spieler_document(
                MOVING_PUPIL_OID,
                "Lenore",
                "Quastenbach",
                email="lenore@schule.de",
                geburtsdatum=ADULT,
                einwilligung=_own(),
                adresswechsel=compose_spieler_adresswechsel(email=NEW_ADDRESS, token_hash=hash_token(PUPIL_ADDRESS_LINK), today=TODAY),
            ),
        ]
    )
    await database[Collection.SCHIEDSRICHTER].insert_many(
        [
            schiedsrichter_document(
                REFEREE_OID, email=PERSON_TYPED, name="Ortrud Zwiebelmayer", default_payment=20, einwilligung=_own(), geburtsdatum=ADULT
            ),
            schiedsrichter_document(
                MOVING_REFEREE_OID,
                email="baldur@schule.de",
                name="Baldur Krautzberger",
                default_payment=20,
                einwilligung=_own(),
                geburtsdatum=ADULT,
                adresswechsel=compose_adresswechsel(email=NEW_ADDRESS, token_hash=hash_token(REFEREE_ADDRESS_LINK), today=TODAY),
            ),
        ]
    )
    await database[Collection.REGISTRIERUNGEN].insert_one(
        registrierung_document(
            REGISTRATION_OID,
            REGISTRANT,
            saison_id=SAISON_ID,
            team_id=TEAM_OID,
            vorname="Jonas",
            nachname="Jungspund",
            token=str(REGISTRATION_OID),
            eingereicht_am="2026-09-20",
            frist="2026-09-27",
            position="Mittelfeld",
            nummer="17",
            stufe="Q1",
            bestaetigt=registrierung_bestaetigt(
                "bestaetigung_spieler",
                geburtsdatum=ADULT,
                today="2026-09-21",
                am="2026-09-21T08:00:00+00:00",
                umfang="kader_oeffentlich",
                medien=True,
            ),
        )
    )


@functools.cache
def _app() -> FastAPI:
    return create_app(CONFIG)


@pytest.fixture(scope="module", autouse=True)
def _built_before_any_case() -> None:
    """Built before `caplog` attaches: the build's logging setup takes every handler off the root, the capture's among them."""

    _app()


def _person(email: str) -> SignedActor:
    return SignedActor(email, ADMIN_KEY, lane="person")


def _withdrawal(page: Seite, **choices: Any) -> dict[str, Any]:
    return {"text_version": LAUFENDE_FASSUNGEN[page], "nachweis_stand": NO_EVIDENCE, **choices}


Press = Callable[[AsyncClient, AsyncDatabase], Awaitable[Any]]


async def _registration_withdrawal(http: AsyncClient, database: AsyncDatabase) -> Any:
    # Its confirmation stamped evidence, so the page serves that evidence's stand.
    stored = await database[Collection.REGISTRIERUNGEN].find_one({"_id": REGISTRATION_OID})
    assert stored is not None
    body = {**_withdrawal("konto_spieler", umfang="intern", medien=True), "nachweis_stand": nachweis_stand_of(bloecke=[stored["einwilligung"]])}

    return await http.patch(f"{V}/registrierungen/selbst/{REGISTRATION_OID}/einwilligung", json=body, headers=_person(REGISTRANT))


def _declined(token: str) -> dict[str, Any]:
    return {"token": token, "antwort": "abgelehnt", "geburtsdatum": None, "whatsapp": False, "medien": False, "text_version": "v1"}


V = f"/api/v{API_VERSION}"

# Every journalled press, as the person makes it, with the record it changes.
PRESSES: dict[str, tuple[Press, Collection, ObjectId]] = {
    "a pupil's withdrawal": (
        lambda http, _database: http.patch(
            f"{V}/spieler/selbst/einwilligung",
            json=_withdrawal("konto_spieler", umfang="intern", medien=False),
            headers=_person(PERSON),
        ),
        Collection.SPIELER,
        PUPIL_OID,
    ),
    "a referee's withdrawal": (
        lambda http, _database: http.patch(
            f"{V}/schiedsrichter/selbst/{REFEREE_OID}/einwilligung",
            json=_withdrawal("konto_schiedsrichter", umfang="kader_oeffentlich", medien=False),
            headers=_person(PERSON),
        ),
        Collection.SCHIEDSRICHTER,
        REFEREE_OID,
    ),
    "a season seat's withdrawal": (
        lambda http, _database: http.patch(
            f"{V}/teams/{TEAM_OID}/saisons/{SAISON_ID}/person/einwilligung",
            json=_withdrawal("konto_kontakt", umfang="kontaktdaten", medien=True),
            headers=_person(PERSON),
        ),
        Collection.SAISON_TEAMS,
        ROW_OID,
    ),
    "a pending application seat's withdrawal": (
        lambda http, _database: http.patch(
            f"{V}/bewerbungen/{APPLICATION_OID}/person/einwilligung",
            json=_withdrawal("konto_kontakt", umfang="kontaktdaten_whatsapp", medien=False),
            headers=_person(PERSON),
        ),
        Collection.BEWERBUNGEN,
        APPLICATION_OID,
    ),
    "a pending registration's withdrawal": (_registration_withdrawal, Collection.REGISTRIERUNGEN, REGISTRATION_OID),
    "a Widerspruch on an application": (
        lambda http, _database: http.post(
            f"{V}/bewerbungen/einwilligung",
            json=_declined(f"{APPLICATION_LINK}-trainer"),
            headers=BASE_AUTH,
        ),
        Collection.BEWERBUNGEN,
        DECLINED_APPLICATION_OID,
    ),
    "a Widerspruch on a season row": (
        lambda http, _database: http.post(
            f"{V}/bewerbungen/einwilligung",
            json=_declined(ROW_LINK),
            headers=BASE_AUTH,
        ),
        Collection.SAISON_TEAMS,
        ROW_OID,
    ),
    "a referee's declined address": (
        lambda http, _database: http.post(
            f"{V}/schiedsrichter/adresswechsel", json={"token": REFEREE_ADDRESS_LINK, "antwort": "abgelehnt"}, headers=BASE_AUTH
        ),
        Collection.SCHIEDSRICHTER,
        MOVING_REFEREE_OID,
    ),
    "a pupil's declined address": (
        lambda http, _database: http.post(
            f"{V}/spieler/adresswechsel", json={"token": PUPIL_ADDRESS_LINK, "antwort": "abgelehnt"}, headers=BASE_AUTH
        ),
        Collection.SPIELER,
        MOVING_PUPIL_OID,
    ),
}

# Whose hash each line names: the signed-in person, or the address whose link was declined.
PERSONS = {
    "a pending registration's withdrawal": REGISTRANT,
    "a Widerspruch on an application": DECLINER,
    "a Widerspruch on a season row": DECLINER,
    "a referee's declined address": NEW_ADDRESS,
    "a pupil's declined address": NEW_ADDRESS,
}

Steps = Callable[[AsyncClient, AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def served(url: str, steps: Steps) -> Any:
    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await _seed(database)
            async with app_client(url, app=_app(), now=NOW) as http:
                return await steps(http, database, client)

    return on_the_seed_loop(_run())


def journalled(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [record.getMessage() for record in caplog.records if record.getMessage().startswith(JOURNAL_TOKEN)]


def _parsed(text: str) -> JournalLine:
    line = parse_line(text)
    assert line is not None, "a message opening on the journal's token read as no line"
    return line


async def _record(database: AsyncDatabase, collection: Collection, record_id: ObjectId) -> Any:
    return await database[collection].find_one({"_id": record_id})


def restored_and_replayed(url: str, caplog: pytest.LogCaptureFixture, press: str) -> dict[str, Any]:
    """The press, the record put back as it stood before it, and two replays of the line the press journalled."""

    act, collection, record_id = PRESSES[press]

    async def steps(http: AsyncClient, database: AsyncDatabase, client: AsyncMongoClient) -> dict[str, Any]:
        snapshot = await _record(database, collection, record_id)
        with caplog.at_level(logging.INFO):
            response = await act(http, database)
        lines = journalled(caplog)
        pressed = await _record(database, collection, record_id)

        # The restore, for this record: the snapshot's document back in place of the one the press left.
        await database[collection].replace_one({"_id": record_id}, snapshot)
        replayed = [await replay(_parsed(line), client, database, schluessel=KEY, now=REPLAY_NOW) for line in lines]
        after_one = await _record(database, collection, record_id)
        again = [await replay(_parsed(line), client, database, schluessel=KEY, now=REPLAY_NOW) for line in lines]
        rows = await database[Collection.AKTIONEN].find({"document_id": record_id, "request.method": REPLAY_METHOD}).to_list()

        return {
            "status": response.status_code,
            "lines": lines,
            "pressed": pressed,
            "replayed": replayed,
            "after_one": after_one,
            "again": again,
            "after_two": await _record(database, collection, record_id),
            "rows": rows,
        }

    return served(url, steps)


class TestEachPressAndItsReplay:
    @pytest.mark.parametrize("press", PRESSES, ids=PRESSES)
    def test_its_one_line_replays_onto_the_restored_record_once(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture, press: str):
        """The press's own instant in the evidence, so a replay a day later puts back the very record the press left."""
        outcome = restored_and_replayed(mongo_replica_set_url, caplog, press)
        _, collection, record_id = PRESSES[press]
        [line] = [parse_line(text) for text in outcome["lines"]]
        assert line is not None

        assert outcome["status"] == 200
        assert (line.collection, line.record_id, line.am) == (collection, record_id, AM)
        assert line.person_hash == loeschung_journal_hash(PERSONS.get(press, PERSON), schluessel=KEY)
        # No address: the day files keep the line thirty days.
        assert "@" not in outcome["lines"][0]

        assert (outcome["replayed"], outcome["after_one"]) == (["replayed"], outcome["pressed"])
        assert (outcome["again"], outcome["after_two"]) == (["already done"], outcome["pressed"])
        # One log row, the system's, naming the line it replayed without its person.
        assert [(row["actor"], row["request"]) for row in outcome["rows"]] == [
            ({"kind": "system", "email": "SYSTEM"}, {"method": REPLAY_METHOD, "path": line.text(with_person=False)})
        ]

    def test_a_grant_and_a_press_moving_nothing_journal_nothing(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """A grant a restore takes back leaves the person less exposed, so only a withdrawal is journalled."""

        async def steps(http: AsyncClient, database: AsyncDatabase, _client: AsyncMongoClient) -> list[int]:
            await database[Collection.SCHIEDSRICHTER].update_one({"_id": REFEREE_OID}, {"$set": {"einwilligung.medien": False}})
            path, body = (
                f"{V}/schiedsrichter/selbst/{REFEREE_OID}/einwilligung",
                _withdrawal("konto_schiedsrichter", umfang="kader_oeffentlich", medien=True),
            )
            with caplog.at_level(logging.INFO):
                granted = await http.patch(path, json=body, headers=_person(PERSON))
                unmoved = await http.patch(path, json={**body, "nachweis_stand": granted.json()["nachweis_stand"]}, headers=_person(PERSON))
            return [granted.status_code, unmoved.status_code]

        assert served(mongo_replica_set_url, steps) == [200, 200]
        assert journalled(caplog) == []


class TestARecordTheLineNoLongerFits:
    def test_a_record_now_holding_somebody_else_is_left_for_review_and_unchanged(self, mongo_replica_set_url: str):
        line = JournalLine(
            person_hash=loeschung_journal_hash(PERSON, schluessel=KEY),
            art="widerruf",
            collection=Collection.SPIELER,
            record_id=MOVING_PUPIL_OID,
            am=AM,
            text_version=LAUFENDE_FASSUNGEN["konto_spieler"],
            wahlen={"medien": False},
        )

        async def steps(_http: AsyncClient, database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await _record(database, Collection.SPIELER, MOVING_PUPIL_OID)
            stand = await replay(line, client, database, schluessel=KEY, now=REPLAY_NOW)
            return stand, before, await _record(database, Collection.SPIELER, MOVING_PUPIL_OID)

        stand, before, after = served(mongo_replica_set_url, steps)

        assert stand == "left for review"
        assert after == before

    def test_a_record_the_restore_does_not_hold_is_named_so(self, mongo_replica_set_url: str):
        line = JournalLine(
            person_hash=loeschung_journal_hash(PERSON, schluessel=KEY),
            art="adresswechsel_abgelehnt",
            collection=Collection.SCHIEDSRICHTER,
            record_id=ObjectId("6890a1b2c3d4e5f607879999"),
            am=AM,
        )

        async def steps(_http: AsyncClient, database: AsyncDatabase, _client: AsyncMongoClient) -> Any:
            return (await plan(line, database, schluessel=KEY, session=None, now=REPLAY_NOW)).stand

        assert served(mongo_replica_set_url, steps) == "no such record"


def _day_file(*entries: tuple[str, str]) -> list[str]:
    """Day-file lines through the backend's own formatter, each `(instant, message)`."""

    formatter = JSONFormatter()
    lines = []
    for moment, message in entries:
        record = logging.LogRecord("frankfurtleague.loeschung", logging.INFO, "journal.py", 1, message, None, None)
        record.created = datetime.fromisoformat(moment).timestamp()
        lines.append(formatter.format(record))
    return lines


class TestTheListing:
    def test_it_names_where_an_erasure_s_address_is_held_and_prints_no_address_and_no_hash(self, mongo_replica_set_url: str):
        erased = JournalLine(person_hash=loeschung_journal_hash(PERSON, schluessel=KEY), art="loeschung")
        withdrawal = JournalLine(
            person_hash=loeschung_journal_hash(PERSON, schluessel=KEY),
            art="widerruf",
            collection=Collection.SPIELER,
            record_id=PUPIL_OID,
            am=AM,
            text_version=LAUFENDE_FASSUNGEN["konto_spieler"],
            wahlen={"medien": False},
        )
        day = _day_file(
            # Before the snapshot: the snapshot holds its write, so it is not listed.
            ("2026-10-03T09:00:00+00:00", erased.text()),
            ("2026-10-03T11:00:00+00:00", erased.text()),
            ("2026-10-03T11:30:00+00:00", withdrawal.text()),
            ("2026-10-03T11:40:00+00:00", f"{JOURNAL_TOKEN} {'b' * 64} vergessen"),
        )

        async def steps(_http: AsyncClient, database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            listed, applied, settled = io.StringIO(), io.StringIO(), io.StringIO()
            since = datetime(2026, 10, 3, 10, 0, tzinfo=UTC)
            common = {"since": since, "client": client, "database": database, "schluessel": KEY, "now": REPLAY_NOW}
            codes = [
                await run(day, apply=False, out=listed, **common),
                await run(day, apply=True, out=applied, **common),
                await run(day[2:3], apply=True, out=settled, **common),
            ]
            return codes, listed.getvalue(), applied.getvalue(), settled.getvalue()

        codes, listed, applied, settled = served(mongo_replica_set_url, steps)

        # Left while an erasure is to run, a line unreadable or a choice to replay; nothing left once the replay ran.
        assert codes == [1, 1, 0]
        assert "Journal lines written after 2026-10-03T10:00:00+00:00: 2." in listed
        assert "held in spieler: 1 field(s), " in listed and "held in schiedsrichter: 1 field(s), " in listed
        assert "    to replay" in listed and "    replayed" in applied and "    already done" in settled
        assert "1 unreadable lines" in listed
        for output in (listed, applied, settled):
            assert "@" not in output
            assert erased.person_hash not in output
            assert KEY.get_secret_value() not in output
