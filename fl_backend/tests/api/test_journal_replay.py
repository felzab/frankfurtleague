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
from bson import ObjectId, decode, encode
from fastapi import FastAPI
from httpx2 import AsyncClient
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.services import hash_token
from app.api.identitaet.wiederherstellung import REPLAY_METHOD, Read, Window, plan_replay, replay_line, run_replay
from app.api.schiedsrichter.services import ADRESSWECHSEL_FELD
from app.api.spielbestaetigungen.services import halter_of
from app.api.spieler.admin_router import delete_adresswechsel as discard_for_a_pupil
from app.api.teams.services import compose_kontakt_bestaetigung
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.constraints import COLLECTION_VALIDATORS
from app.core.dependencies import get_germany_now
from app.core.drosselung import build_counts_filter
from app.core.journal import JOURNAL_TOKEN, JournalLine, parse_line
from app.core.logging import JSONFormatter
from app.core.recording import ERASED_ACTOR_MARKER
from app.core.security import akteur_pseudonym, loeschung_journal_hash
from app.main import create_app
from app.shared.einwilligung import LAUFENDE_FASSUNGEN, Seite
from app.shared.einwilligung_nachweis import nachweis_stand_of
from tests import documents
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
    spiel_document,
    spielbestaetigung_document,
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
# The snapshot taken the morning of the presses, the restore ended the next morning: a link sent on the presses' day is the snapshot's.
WINDOW = Window(since=datetime(2026, 10, 3, 9, 0, tzinfo=UTC), until=datetime(2026, 10, 4, 8, 0, tzinfo=UTC))
# A second after the press, as its day file holds it.
JOURNALLED = datetime(2026, 10, 3, 10, 0, 1, tzinfo=UTC)
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
        einwilligung={"umfang": "kontaktdaten_whatsapp", "medien": True, "text_version": SEAT_LABEL} if confirmed else {},
    )
    return {**seat, "email": email}


# The stand each account page serves for the record as `_seed` stores it, which a press from that page echoes.
SERVED_STAND: dict[Seite, dict[str, str | None]] = {
    "konto_spieler": nachweis_stand_of(bloecke=[_own()]),
    "konto_schiedsrichter": nachweis_stand_of(bloecke=[_own()]),
    "konto_kontakt": nachweis_stand_of(bloecke=[_seat(PERSON_TYPED)["einwilligung"]]),
}


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
                adresswechsel=documents.adresswechsel_document(email=NEW_ADDRESS, token_hash=hash_token(PUPIL_ADDRESS_LINK), day=TODAY),
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
                adresswechsel=documents.adresswechsel_document(email=NEW_ADDRESS, token_hash=hash_token(REFEREE_ADDRESS_LINK), day=TODAY),
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
    return {"text_version": LAUFENDE_FASSUNGEN[page], "nachweis_stand": SERVED_STAND[page], **choices}


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
    "a pupil's stopped address": (
        lambda http, _database: http.post(
            f"{V}/spieler/adresswechsel/stopp", json={"token": f"stop-{hash_token(PUPIL_ADDRESS_LINK)}"}, headers=BASE_AUTH
        ),
        Collection.SPIELER,
        MOVING_PUPIL_OID,
    ),
    "a pupil's address that took effect": (
        lambda http, _database: http.post(
            f"{V}/spieler/adresswechsel", json={"token": PUPIL_ADDRESS_LINK, "antwort": "bestaetigt"}, headers=BASE_AUTH
        ),
        Collection.SPIELER,
        MOVING_PUPIL_OID,
    ),
    "a referee's address that took effect": (
        lambda http, _database: http.post(
            f"{V}/schiedsrichter/adresswechsel", json={"token": REFEREE_ADDRESS_LINK, "antwort": "bestaetigt"}, headers=BASE_AUTH
        ),
        Collection.SCHIEDSRICHTER,
        MOVING_REFEREE_OID,
    ),
}

# Whose hash each line names: the signed-in person, or the new address of a change declined, stopped or taking effect.
PERSONS = {
    "a pending registration's withdrawal": REGISTRANT,
    "a Widerspruch on an application": DECLINER,
    "a Widerspruch on a season row": DECLINER,
    "a referee's declined address": NEW_ADDRESS,
    "a pupil's declined address": NEW_ADDRESS,
    "a pupil's stopped address": NEW_ADDRESS,
    "a pupil's address that took effect": NEW_ADDRESS,
    "a referee's address that took effect": NEW_ADDRESS,
}

Steps = Callable[[AsyncClient, AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def served(url: str, steps: Steps, *, mutates_schema: bool = False) -> Any:
    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True, mutates_schema=mutates_schema) as (client, database):
            await _seed(database)
            async with app_client(url, app=_app(), now=NOW) as http:
                return await steps(http, database, client)

    return on_the_seed_loop(_run())


def journalled(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [record.getMessage() for record in caplog.records if record.getMessage().startswith(JOURNAL_TOKEN)]


def _entry(text: str) -> Read:
    line = parse_line(text)
    assert line is not None, "a message opening on the journal's token read as no line"
    return Read(timestamp=JOURNALLED, line=line)


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
        replayed = [(await replay_line(_entry(line), client, database, schluessel=KEY, now=REPLAY_NOW, window=WINDOW)).stand for line in lines]
        after_one = await _record(database, collection, record_id)
        again = [(await replay_line(_entry(line), client, database, schluessel=KEY, now=REPLAY_NOW, window=WINDOW)).stand for line in lines]
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
        # One log row, the system's, naming the line it replayed by its act alone: neither its person nor the erasure journal's token.
        assert [(row["actor"], row["request"]) for row in outcome["rows"]] == [
            ({"kind": "system", "email": "SYSTEM"}, {"method": REPLAY_METHOD, "path": f"{line.act()} journalled={JOURNALLED.isoformat()}"})
        ]
        assert JOURNAL_TOKEN not in outcome["rows"][0]["request"]["path"]

    def test_a_grant_and_a_press_moving_nothing_journal_nothing(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """A grant a restore takes back leaves the person less exposed, so only a withdrawal is journalled."""

        async def steps(http: AsyncClient, database: AsyncDatabase, _client: AsyncMongoClient) -> list[int]:
            await database[Collection.SCHIEDSRICHTER].update_one({"_id": REFEREE_OID}, {"$set": {"einwilligung.medien": False}})
            path, body = (
                f"{V}/schiedsrichter/selbst/{REFEREE_OID}/einwilligung",
                {
                    **_withdrawal("konto_schiedsrichter", umfang="kader_oeffentlich", medien=True),
                    "nachweis_stand": nachweis_stand_of(bloecke=[{**_own(), "medien": False}]),
                },
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
            planned = await replay_line(Read(timestamp=JOURNALLED, line=line), client, database, schluessel=KEY, now=REPLAY_NOW, window=WINDOW)
            return planned.stand, before, await _record(database, Collection.SPIELER, MOVING_PUPIL_OID)

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
            return (await plan_replay(line, database, schluessel=KEY, session=None, now=REPLAY_NOW, window=WINDOW)).stand

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
        # Its pseudonym named, and its address held: the page's erasure takes the pseudonym's rows with everything else.
        erased = JournalLine(
            person_hash=loeschung_journal_hash(PERSON, schluessel=KEY), art="loeschung", pseudonym=akteur_pseudonym(PERSON, schluessel=KEY)
        )
        withdrawal = JournalLine(
            person_hash=loeschung_journal_hash(PERSON, schluessel=KEY),
            art="widerruf",
            collection=Collection.SPIELER,
            record_id=PUPIL_OID,
            am=AM,
            text_version=LAUFENDE_FASSUNGEN["konto_spieler"],
            wahlen={"medien": False},
        )
        on_the_restored_site = JournalLine(
            person_hash=loeschung_journal_hash(PERSON, schluessel=KEY),
            art="widerruf",
            collection=Collection.SCHIEDSRICHTER,
            record_id=REFEREE_OID,
            am="2026-10-03T12:30:00+00:00",
            text_version=LAUFENDE_FASSUNGEN["konto_schiedsrichter"],
            wahlen={"medien": False},
        )
        day = _day_file(
            # Before the snapshot: the snapshot holds its write, so it is not listed.
            ("2026-10-03T09:00:00+00:00", erased.text()),
            ("2026-10-03T11:00:00+00:00", erased.text()),
            ("2026-10-03T11:30:00+00:00", withdrawal.text()),
            ("2026-10-03T11:40:00+00:00", f"{JOURNAL_TOKEN} {'b' * 64} vergessen"),
            # An id bson's own reader would raise `InvalidId` on: counted as unreadable, never a traceback.
            ("2026-10-03T11:50:00+00:00", f"{JOURNAL_TOKEN} {'b' * 64} adresswechsel_abgelehnt spieler/{'z' * 24} am={AM}"),
            # After the restore's end: the restored site's own act, which stands as its person made it.
            ("2026-10-03T12:30:01+00:00", on_the_restored_site.text()),
        )

        async def steps(_http: AsyncClient, database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            listed, applied, settled = io.StringIO(), io.StringIO(), io.StringIO()
            since, until = datetime(2026, 10, 3, 10, 0, tzinfo=UTC), datetime(2026, 10, 3, 12, 0, tzinfo=UTC)
            common = {"since": since, "until": until, "client": client, "database": database, "schluessel": KEY, "now": REPLAY_NOW}
            codes = [
                await run_replay(day, apply=False, out=listed, **common),
                await run_replay(day, apply=True, out=applied, **common),
                await run_replay(day[2:3], apply=True, out=settled, **common),
            ]
            return codes, listed.getvalue(), applied.getvalue(), settled.getvalue()

        codes, listed, applied, settled = served(mongo_replica_set_url, steps)

        # Left while an erasure is to run, a line unreadable or a choice to replay; nothing left once the replay ran.
        assert codes == [1, 1, 0]
        assert "Journal lines written after 2026-10-03T10:00:00+00:00 and no later than 2026-10-03T12:00:00+00:00: 2." in listed
        assert "widerruf schiedsrichter/" not in listed + applied
        assert "held in spieler: 1 field(s), " in listed and "held in schiedsrichter: 1 field(s), " in listed
        assert "    to replay" in listed and "    replayed" in applied and "    already done" in settled
        assert "2 unreadable lines" in listed
        for output in (listed, applied, settled):
            assert "@" not in output
            assert erased.person_hash not in output
            assert str(erased.pseudonym) not in output
            assert KEY.get_secret_value() not in output


ERASURE = f"{V}/identitaet/selbst/erasure"
# An hour after the presses: the person's own later act.
AN_HOUR_LATER = datetime(2026, 10, 3, 13, 0, tzinfo=ZoneInfo("Europe/Berlin"))
PSEUDONYM = akteur_pseudonym(PERSON, schluessel=KEY)

# The snapshot and the restore's end on the presses' own day: a link sent that day may fall before the one or after the other.
ONE_DAY = Window(since=datetime(2026, 10, 3, 9, 0, tzinfo=UTC), until=datetime(2026, 10, 3, 11, 0, tzinfo=UTC))

# What the restored site sends again on a day after the restore: a new link for the declined seat, a new change to the declined address.
SENT_AGAIN: dict[str, Callable[[str], dict[str, Any]]] = {
    "a Widerspruch on a season row": lambda day: {
        "bestaetigungen.stellvertretung": compose_kontakt_bestaetigung(token_hash=hash_token("a-new-link"), today=day)
    },
    "a referee's declined address": lambda day: {
        ADRESSWECHSEL_FELD: documents.adresswechsel_document(email=NEW_ADDRESS, token_hash=hash_token("asked-again"), day=day)
    },
}


async def _withdrawn_and_granted_again(http: AsyncClient, database: AsyncDatabase, caplog: pytest.LogCaptureFixture) -> str:
    """A pupil's withdrawal of their media consent and, an hour later, their grant of it again: the line the withdrawal journalled."""

    with caplog.at_level(logging.INFO):
        withdrawn = await PRESSES["a pupil's withdrawal"][0](http, database)
    [line] = journalled(caplog)
    # The app's clock moved on; `app_client` puts back the overrides it found as it leaves.
    _app().dependency_overrides[get_germany_now] = lambda: AN_HOUR_LATER
    body = {**_withdrawal("konto_spieler", umfang="intern", medien=True), "nachweis_stand": withdrawn.json()["nachweis_stand"]}
    granted = await http.patch(f"{V}/spieler/selbst/einwilligung", json=body, headers=_person(PERSON))
    assert (withdrawn.status_code, granted.status_code) == (200, 200), granted.text

    return line


class TestALaterActStands:
    def test_a_grant_after_the_withdrawal_is_its_person_s_last_word(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """Replayed over it, the line would date a withdrawal before the grant it claims to end."""

        async def steps(http: AsyncClient, database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            line = await _withdrawn_and_granted_again(http, database, caplog)
            granted = await _record(database, Collection.SPIELER, PUPIL_OID)
            planned = await replay_line(_entry(line), client, database, schluessel=KEY, now=REPLAY_NOW, window=WINDOW)
            return planned.stand, granted, await _record(database, Collection.SPIELER, PUPIL_OID)

        stand, granted, after = served(mongo_replica_set_url, steps)

        assert granted["einwilligung"]["medien"] is True
        assert (stand, after) == ("already done", granted)

    @pytest.mark.parametrize("press", SENT_AGAIN)
    @pytest.mark.parametrize(
        ("sent", "window", "expected"),
        [
            pytest.param("2026-10-04", WINDOW, "already done", id="sent after the snapshot's day"),
            pytest.param(TODAY, ONE_DAY, "left for review", id="sent on the day of both"),
        ],
    )
    def test_a_link_the_restored_site_sent_again_stands(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture, press: str, sent: str, window: Window, expected: str
    ):
        """A decline replays only onto what the snapshot held; where the link's day cannot tell, it is reviewed, never guessed."""
        _, collection, record_id = PRESSES[press]

        async def steps(http: AsyncClient, database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            snapshot = await _record(database, collection, record_id)
            with caplog.at_level(logging.INFO):
                await PRESSES[press][0](http, database)
            [line] = journalled(caplog)
            # The restore, then the restored site's own act on the same record.
            await database[collection].replace_one({"_id": record_id}, snapshot)
            await database[collection].update_one({"_id": record_id}, {"$set": SENT_AGAIN[press](sent)})
            sent_again = await _record(database, collection, record_id)
            planned = await replay_line(_entry(line), client, database, schluessel=KEY, now=REPLAY_NOW, window=window)
            return planned.stand, sent_again, await _record(database, collection, record_id)

        stand, sent_again, after = served(mongo_replica_set_url, steps)

        assert (stand, after) == (expected, sent_again)


async def _listed(day: list[str], client: AsyncMongoClient, database: AsyncDatabase, *, apply: bool) -> tuple[int, str]:
    out = io.StringIO()
    code = await run_replay(
        day, since=WINDOW.since, until=WINDOW.until, apply=apply, client=client, database=database, schluessel=KEY, now=REPLAY_NOW, out=out
    )

    return code, out.getvalue()


class TestAnErasureSettlesItsPersonsChoices:
    def test_a_withdrawal_whose_person_has_been_erased_is_settled_and_held_nowhere_alone_is_reviewed(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture
    ):
        """The runbook runs each erasure again before its last listing, which then finds nothing of theirs to replay.

        Without the erasure's line, a person held nowhere stays a review: a pupil whose address changed reads the same.
        """

        async def steps(http: AsyncClient, database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with caplog.at_level(logging.INFO):
                withdrawn = await PRESSES["a season seat's withdrawal"][0](http, database)
                erased = await http.post(ERASURE, headers=_person(PERSON))
            assert (withdrawn.status_code, erased.status_code) == (200, 200), erased.text
            withdrawal, erasure = journalled(caplog)
            day = _day_file(("2026-10-03T10:00:01+00:00", withdrawal), ("2026-10-03T10:00:02+00:00", erasure))
            return await _listed(day, client, database, apply=False), await _listed(day[:1], client, database, apply=False)

        (both_code, both), (alone_code, alone) = served(mongo_replica_set_url, steps)

        assert (both_code, alone_code) == (0, 1), both
        assert "    its person's erasure has run: nothing to replay" in both
        assert "    left for review" in alone


class TestAnErasedPersonsPseudonym:
    def test_the_rows_a_restore_brings_back_under_it_are_marked_again_once(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """Where the restored database holds the address nowhere, the erasure's line alone finds what its pseudonym marks.

        Restored as a snapshot holds a person whose records went before it: their rows' pseudonym and count, no address.
        """

        async def steps(http: AsyncClient, database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            withdrawal = await _withdrawn_and_granted_again(http, database, caplog)
            rows = [row["_id"] async for row in database[Collection.AKTIONEN].find({"actor.pseudonym": PSEUDONYM}, {"_id": 1})]
            counts = await database[Collection.DROSSELUNG].find(build_counts_filter(PSEUDONYM)).to_list()
            with caplog.at_level(logging.INFO):
                erased = await http.post(ERASURE, headers=_person(PERSON))
            assert erased.status_code == 200, erased.text
            _, erasure = journalled(caplog)

            # The restore: the attribution the erasure marked, and the count it erased.
            await database[Collection.AKTIONEN].update_many({"_id": {"$in": rows}}, {"$set": {"actor.pseudonym": PSEUDONYM}})
            await database[Collection.DROSSELUNG].insert_many(counts)
            day = _day_file(("2026-10-03T10:00:01+00:00", withdrawal), ("2026-10-03T11:00:01+00:00", erasure))
            runs = [await _listed(day, client, database, apply=apply) for apply in (False, True, True)]

            left = (
                await database[Collection.AKTIONEN].count_documents({"actor.pseudonym": PSEUDONYM}),
                await database[Collection.AKTIONEN].count_documents({"_id": {"$in": rows}, "actor.pseudonym": ERASED_ACTOR_MARKER}),
                await database[Collection.DROSSELUNG].count_documents(build_counts_filter(PSEUDONYM)),
            )
            acts = await database[Collection.AKTIONEN].find({"collection": "pseudonyme"}).to_list()
            return len(rows), len(counts), runs, left, acts

        rows, counts, runs, left, acts = served(mongo_replica_set_url, steps)
        [(listed_code, listed), (applied_code, applied), (again_code, again)] = runs

        # The withdrawal's row and the grant's, and the count the grant took.
        assert (rows, counts) == (2, 1)
        # None still attributed, each marked, no count left.
        assert left == (0, rows, 0)
        assert (listed_code, applied_code, again_code) == (1, 0, 0), listed
        assert f"but its pseudonym still marks {rows} log row(s) (" in listed and "and 1 day count(s)" in listed
        assert "    to replay" in listed and "    replayed" in applied and "    already done" in again
        # One row, the system's, naming the erasure's line: the second run found nothing and wrote nothing.
        assert [(row["actor"], row["request"]) for row in acts] == [
            ({"kind": "system", "email": "SYSTEM"}, {"method": REPLAY_METHOD, "path": "loeschung journalled=2026-10-03T11:00:01+00:00"})
        ]
        for output in (listed, applied, again):
            assert "@" not in output
            assert PSEUDONYM not in output
            assert loeschung_journal_hash(PERSON, schluessel=KEY) not in output


def _without(value: Any, member: str) -> Any:
    """`value` as a build before `member` would have declared it: in none of its lists."""

    if isinstance(value, dict):
        return {key: _without(item, member) for key, item in value.items()}
    if isinstance(value, list):
        return [_without(item, member) for item in value if item != member]
    return value


class TestAValidatorOlderThanThisBuild:
    def test_it_refuses_the_run_before_anything_is_judged_or_written(self, mongo_replica_set_url: str):
        """As a restore can leave it: the snapshot's log validator, which refuses the row an erasure's replay writes."""
        withdrawal = JournalLine(
            person_hash=loeschung_journal_hash(PERSON, schluessel=KEY),
            art="widerruf",
            collection=Collection.SPIELER,
            record_id=PUPIL_OID,
            am=AM,
            text_version=LAUFENDE_FASSUNGEN["konto_spieler"],
            wahlen={"medien": False},
        )
        day = _day_file(("2026-10-03T10:00:01+00:00", withdrawal.text()))
        declared = decode(encode(COLLECTION_VALIDATORS[Collection.AKTIONEN]))
        older = _without(declared, "pseudonyme")

        async def steps(_http: AsyncClient, database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database.command(
                {"collMod": Collection.AKTIONEN, "validator": older, "validationLevel": "strict", "validationAction": "error"}
            )
            before = await _record(database, Collection.SPIELER, PUPIL_OID)
            code, output = await _listed(day, client, database, apply=True)
            return code, output, before, await _record(database, Collection.SPIELER, PUPIL_OID)

        code, output, before, after = served(mongo_replica_set_url, steps, mutates_schema=True)

        assert older != declared, "this build's log validator names no `pseudonyme`, so the case plants nothing"
        assert (code, after) == (2, before)
        assert "The validators on aktionen are not this build's, so no line was judged" in output
        assert "python -m app.core.constraints --apply" in output


def _their_answered_confirmation() -> dict[str, Any]:
    """A fixture answer the person gave from a seat they have since left: the row holds their holder digest and no address."""

    team_id = ObjectId("6890a1b2c3d4e5f6078600f1")
    sides = {f"team{n}": {"team_id": ObjectId(f"6890a1b2c3d4e5f6078600f{n}")} for n in (1, 2)}
    spiel = spiel_document(
        spiel_id=ObjectId(), saison_id=SAISON_ID, spiel_nr=1, spieltag_id=None, datum="2026-10-20", uhrzeit="18:00:00", **sides
    )
    antwort = {
        "art": "abgelehnt",
        "am": TODAY,
        "von": {"art": "kontakt", "rolle": "trainer", "halter": halter_of(PERSON, schluessel=KEY)},
        "vorschlag": {"datum": "2026-10-21", "uhrzeit": "18:00:00"},
        "begruendung": "Wir sind auf Klassenfahrt",
    }

    return spielbestaetigung_document(spiel, partei={"art": "team", "team_id": team_id}, antwort=antwort)


class TestAnErasedPersonsReasons:
    def test_the_reasons_a_restore_brings_back_with_no_address_are_removed_again_once(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture
    ):
        """The erasure's line alone finds them: the row holds the person's holder digest, which `where_held` cannot read as an address."""

        async def steps(http: AsyncClient, database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            snapshot = _their_answered_confirmation()
            confirmations = database[Collection.SPIELBESTAETIGUNGEN]
            await confirmations.insert_one(snapshot)
            with caplog.at_level(logging.INFO):
                erased = await http.post(ERASURE, headers=_person(PERSON))
            assert erased.status_code == 200, erased.text
            erasure = journalled(caplog)[-1]
            removed = (await confirmations.find_one({"_id": snapshot["_id"]}) or {})["antwort"]

            # The restore: the row as the snapshot held it.
            await confirmations.replace_one({"_id": snapshot["_id"]}, snapshot)
            day = _day_file(("2026-10-03T11:00:01+00:00", erasure))
            runs = [await _listed(day, client, database, apply=apply) for apply in (False, True, True)]

            return removed, runs, (await confirmations.find_one({"_id": snapshot["_id"]}) or {})["antwort"]

        removed, runs, after = served(mongo_replica_set_url, steps)
        [(listed_code, listed), (applied_code, applied), (again_code, again)] = runs

        # The premise: the erasure itself took the reason, which the restore then brought back.
        assert (removed["begruendung"], removed["von"]["halter"]) == (None, None)
        assert (listed_code, applied_code, again_code) == (1, 0, 0), listed
        assert "1 confirmation(s) or log image(s) hold a reason of theirs" in listed and "    to replay" in listed
        assert "    replayed" in applied and "    already done" in again
        # The answer itself stays: its day, its way and its role are the club's.
        assert after == {**removed, "art": "abgelehnt"}
        for output in (listed, applied, again):
            assert halter_of(PERSON, schluessel=KEY) not in output


class TestAnErasureAfterAChangeTookEffect:
    @pytest.mark.parametrize(
        ("erased", "code", "listed_line", "absent"),
        [
            pytest.param("2026-10-03T10:00:02+00:00", 1, "held in spieler: 1 field(s), ", "nothing to replay", id="erased after the effect"),
            pytest.param(
                "2026-10-03T10:00:00+00:00",
                0,
                "its person's erasure has run: nothing to replay",
                "held in spieler",
                id="an earlier erasure of the address it moved to",
            ),
        ],
    )
    def test_a_restore_from_before_the_start_lists_it_at_the_replaced_address(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture, erased: str, code: int, listed_line: str, absent: str
    ):
        """A snapshot from before the start holds the person's records at the address they left, which an erasure already run leaves standing.

        An erasure older than the effect is somebody else's, and lists nothing against the person who moved.
        """

        async def steps(http: AsyncClient, database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            snapshot = await _record(database, Collection.SPIELER, MOVING_PUPIL_OID)
            del snapshot[ADRESSWECHSEL_FELD]
            with caplog.at_level(logging.INFO):
                moved = await PRESSES["a pupil's address that took effect"][0](http, database)
                gone = await http.post(ERASURE, headers=_person(NEW_ADDRESS))
            assert (moved.status_code, gone.status_code) == (200, 200), gone.text
            effect, erasure = journalled(caplog)

            # The restore: the pupil as the snapshot held it, before the change was started.
            await database[Collection.SPIELER].replace_one({"_id": MOVING_PUPIL_OID}, snapshot, upsert=True)
            day = _day_file(("2026-10-03T10:00:01+00:00", effect), (erased, erasure))
            return await _listed(day, client, database, apply=False)

        exited, listed = served(mongo_replica_set_url, steps)

        assert exited == code, listed
        assert listed_line in listed and absent not in listed
        assert "@" not in listed and loeschung_journal_hash(NEW_ADDRESS, schluessel=KEY) not in listed


class TestADiscardedChange:
    def test_a_confirmed_change_in_its_waiting_time_stays_discarded_after_a_restore_from_inside_the_hold(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture
    ):
        """Brought back confirmed and due, the hourly pass would make it take effect with nobody pressing anything."""

        waiting = {
            **documents.adresswechsel_document(email=NEW_ADDRESS, token_hash=hash_token(PUPIL_ADDRESS_LINK), day=TODAY, weg="wartezeit"),
            "token_hash": None,
            "gueltig_bis": None,
            "grund": "Postfach gelöscht, telefonisch bestätigt",
            "bestaetigt_am": datetime(2026, 10, 3, 9, 30, tzinfo=UTC),
            "wirksam_ab": datetime(2026, 10, 10, 9, 30, tzinfo=UTC),
        }

        async def steps(_http: AsyncClient, database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].update_one({"_id": MOVING_PUPIL_OID}, {"$set": {ADRESSWECHSEL_FELD: waiting}})
            snapshot = await _record(database, Collection.SPIELER, MOVING_PUPIL_OID)
            with caplog.at_level(logging.INFO):
                await discard_for_a_pupil(
                    spieler_id=MOVING_PUPIL_OID,
                    spieler_collection=database[Collection.SPIELER],
                    aktionen_collection=database[Collection.AKTIONEN],
                    db=client,
                    config=CONFIG,
                    germany_now=NOW,
                )
            [line] = journalled(caplog)

            await database[Collection.SPIELER].replace_one({"_id": MOVING_PUPIL_OID}, snapshot)
            planned = await replay_line(_entry(line), client, database, schluessel=KEY, now=REPLAY_NOW, window=WINDOW)
            return parse_line(line), planned.stand, await _record(database, Collection.SPIELER, MOVING_PUPIL_OID)

        line, stand, after = served(mongo_replica_set_url, steps)

        assert line is not None
        assert (line.art, line.collection, line.record_id) == ("adresswechsel_verworfen", Collection.SPIELER, MOVING_PUPIL_OID)
        assert line.person_hash == loeschung_journal_hash(NEW_ADDRESS, schluessel=KEY)
        assert stand == "replayed"
        assert ADRESSWECHSEL_FELD not in after
