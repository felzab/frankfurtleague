"""
API · a signed-in person's daily write ceiling, met over HTTP against a real `mongod`

`tests/api/test_drosselung.py` holds which routes count; this file holds what a count does once the
database answers: the boundary under concurrent writes, whose count it is, when it starts again, and
that a withdrawal never spends one.
"""

import asyncio
import functools
import logging
from collections import Counter
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from itertools import cycle, islice
from typing import Annotated, Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from fastapi import Depends, FastAPI
from httpx2 import Response
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.api.einwilligung.services import FASSUNG_UNZULAESSIG, SELBST_MEDIEN_ALTER
from app.api.konto.services import EINWILLIGUNG_STAND_VERALTET, KONTO_SEITE_KONTAKT, KONTO_SEITE_SCHIEDSRICHTER, KONTO_SEITE_SPIELER
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.db import collection_dependency, get_database
from app.core.drosselung import DROSSELUNG_ERREICHT, TAGESBUDGETS, ZAEHLER_BUDGETS, Zaehler, get_drossel
from app.core.exceptions import DOCUMENT_NOT_FOUND, DrosselungException
from app.core.logging import FL_LOGGER_NAME
from app.core.recording import AktorFunktion, PersonActor, actor_var
from app.core.security import akteur_pseudonym
from app.main import create_app
from app.shared.einwilligung import LAUFENDE_FASSUNGEN, Seite
from app.shared.einwilligung_nachweis import nachweis_stand_of
from app.shared.folding import sign_in_identifier
from tests.actor_tokens import SignedActor
from tests.app_client import app_client
from tests.config import ADMIN_AUTH, ADMIN_KEY, grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import (
    eigene_einwilligung_document,
    kontaktperson_document,
    saison_document,
    saison_spieler_document,
    saison_team_document,
    schiedsrichter_document,
    spieler_document,
    team_document,
)
from tests.worker import worker_database

from .conftest import config_for

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_drosselung_test")

CONFIG = config_for(DATABASE_NAME)

BERLIN = ZoneInfo("Europe/Berlin")
# A century ahead of the real clock: a count expires at the midnight ending `NOW`'s day, and the TTL
# monitor deletes an expired one at its next sweep, under a case reading it back. The birthdates move with it.
NOW = datetime(2126, 4, 1, 12, tzinfo=BERLIN)
TODAY = NOW.date().isoformat()
SECONDS_TO_MIDNIGHT = 12 * 60 * 60
# The midnight ending `TODAY`, as the driver reads a stored date back: naive, in UTC.
MIDNIGHT_UTC = datetime(2126, 4, 1, 22)
# Half a minute into the next German day.
NEXT_DAY = datetime(2126, 4, 2, 0, 0, 30, tzinfo=BERLIN)
TOMORROW = NEXT_DAY.date().isoformat()
NEXT_MIDNIGHT_UTC = datetime(2126, 4, 2, 22)

ACTIVE_SAISON = "2026"
TEAM_A = ObjectId("6890a1b2c3d4e5f607930001")
PUPIL = ObjectId("6890a1b2c3d4e5f607930011")
REFEREE = ObjectId("6890a1b2c3d4e5f607930021")
# No squad row holds it, so an admitted squad edit meets the handler's own 404 and writes nothing.
NOT_IN_THE_SQUAD = ObjectId("6890a1b2c3d4e5f607930099")
ANY_REGISTRIERUNG = ObjectId("6890a1b2c3d4e5f607930098")
ANY_SPIELBESTAETIGUNG = ObjectId("6890a1b2c3d4e5f607930097")
ANY_SPIEL = ObjectId("6890a1b2c3d4e5f607930096")

# One mailbox writing as all three kinds of person, so a count is seen to be the kind's and not the mailbox's.
PERSON = "anna.drossel@schule.de"
OTHER_SEAT = "bernd.drossel@schule.de"
ADULT_BIRTHDATE = "2100-05-09"
# A second mailbox holding all three, under the media age and with every media choice off, so a grant
# reaches every refusal a consent press can meet.
YOUNG = "carla.drossel@schule.de"
YOUNG_PUPIL = ObjectId("6890a1b2c3d4e5f607930012")
YOUNG_REFEREE = ObjectId("6890a1b2c3d4e5f607930022")
YOUNG_BIRTHDATE = "2110-05-09"

API = f"/api/v{API_VERSION}"
KADER_ROW = f"{API}/spieler/kader/{TEAM_A}/{ACTIVE_SAISON}/{NOT_IN_THE_SQUAD}"
KADER_EDIT = {"nummer": "11", "position": "Tor", "stufe": "Q1", "rolle": None}
SPIELBERICHT = {
    "bericht": {
        "ergebnis_vorschlag": {"team1_tore": 0, "team2_tore": 0, "elfmeterschiessen": None, "sonderereignis": None},
        "torschuetzen": [],
        "karten": [],
        "bemerkungen": None,
    },
    "bericht_stand": None,
}

CEILING_LINE = "A person reached their daily write ceiling"


CONFIRMED_LABEL = "2026-01-bestaetigungsseite-1"


def _consent(*, medien: bool = True) -> dict[str, Any]:
    """A record its own person confirmed, every choice `PERSON`'s is granted, so a withdrawal moves something on each."""

    return eigene_einwilligung_document(text_version=CONFIRMED_LABEL, bestaetigt_am="2026-02-02", medien=medien)


def _seat(email: str, *, geburtsdatum: str = ADULT_BIRTHDATE, medien: bool = True) -> dict[str, Any]:
    return kontaktperson_document(
        "Anna",
        bestaetigt_am="2026-02-02",
        einwilligung={"text_version": CONFIRMED_LABEL, "medien": medien},
        nachname="Drossel",
        email=email,
        telefon="+49 69 5550111",
        geburtsdatum=geburtsdatum,
    )


def _referee(referee_id: ObjectId, name: str, email: str, geburtsdatum: str, *, medien: bool = True) -> dict[str, Any]:
    # A name per referee: `uniq_schiedsrichter_name` indexes it.
    return schiedsrichter_document(
        referee_id,
        email=email,
        name=name,
        default_payment=20,
        einwilligung=_consent(medien=medien),
        schule="Adler-Schule",
        kontakt={"telefon": "+49 69 5550222", "email": email},
        geburtsdatum=geburtsdatum,
    )


# The stand a page served each seeded record echoes: `PERSON`'s granting media, `YOUNG`'s withholding it.
PERSON_STAND = nachweis_stand_of(bloecke=[_consent()])
YOUNG_STAND = nachweis_stand_of(bloecke=[_consent(medien=False)])
PERSON_SEAT_STAND = nachweis_stand_of(bloecke=[_seat(PERSON)["einwilligung"]])
YOUNG_SEAT_STAND = nachweis_stand_of(bloecke=[_seat(YOUNG, geburtsdatum=YOUNG_BIRTHDATE, medien=False)["einwilligung"]])


async def _seed(database: AsyncDatabase) -> None:
    await database[Collection.BERECHTIGUNGEN].insert_many(grants_for_the_suite())
    await database[Collection.SAISONS].insert_one(saison_document(ACTIVE_SAISON, "active"))
    await database[Collection.TEAMS].insert_one(team_document(TEAM_A, "Adler", "ADX"))
    await database[Collection.SAISON_TEAMS].insert_one(
        saison_team_document(
            ACTIVE_SAISON,
            TEAM_A,
            "Adler",
            "ADX",
            kontakte={
                "trainer": _seat(OTHER_SEAT),
                "ansprechperson": _seat(PERSON),
                "stellvertretung": _seat(YOUNG, geburtsdatum=YOUNG_BIRTHDATE, medien=False),
                "trainer_ist_zugleich": None,
            },
        )
    )
    await database[Collection.SPIELER].insert_many(
        [
            spieler_document(PUPIL, "Anna", "Drossel", email=PERSON, geburtsdatum=ADULT_BIRTHDATE, einwilligung=_consent()),
            spieler_document(YOUNG_PUPIL, "Carla", "Drossel", email=YOUNG, geburtsdatum=YOUNG_BIRTHDATE, einwilligung=_consent(medien=False)),
        ]
    )
    await database[Collection.SAISON_SPIELER].insert_many(
        [
            saison_spieler_document(PUPIL, ACTIVE_SAISON, TEAM_A, nummer="7"),
            saison_spieler_document(YOUNG_PUPIL, ACTIVE_SAISON, TEAM_A, nummer="8"),
        ]
    )
    await database[Collection.SCHIEDSRICHTER].insert_many(
        [
            _referee(REFEREE, "Anna Drossel", PERSON, ADULT_BIRTHDATE),
            _referee(YOUNG_REFEREE, "Carla Drossel", YOUNG, YOUNG_BIRTHDATE, medien=False),
        ]
    )


def seeded[T](url: str, steps: Callable[[AsyncDatabase], Awaitable[T]]) -> T:
    async def _run() -> T:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_client, database):
            await _seed(database)
            return await steps(database)

    return on_the_seed_loop(_run())


@functools.cache
def _first() -> FastAPI:
    return create_app(CONFIG)


@functools.cache
def _second() -> FastAPI:
    """Another process's application over the same database, which the count must hold across."""

    return create_app(CONFIG)


@pytest.fixture(scope="module", autouse=True)
def _built_before_any_case() -> None:
    """Never inside a case: a build re-runs the logging `dictConfig`, which strips the handler `caplog` reads that case's records from."""

    _first()
    _second()


def as_person(email: str) -> SignedActor:
    return SignedActor(email, ADMIN_KEY, lane="person")


def answered(response: Response) -> tuple[int, str | None]:
    return response.status_code, response.json().get("error_code")


def count_id(funktion: Zaehler, email: str, day: str = TODAY) -> str:
    """The count's key, spelled here from its parts rather than read off the module, so a key that moved fails these cases."""

    return f"{funktion}:{akteur_pseudonym(sign_in_identifier(email), schluessel=CONFIG.sperrliste_schluessel)}:{day}"


async def spend(database: AsyncDatabase, funktion: Zaehler, email: str, units: int) -> None:
    """The person's count for `TODAY` at `units` spent."""

    await database[Collection.DROSSELUNG].insert_one({"_id": count_id(funktion, email), "n": units, "ablauf": MIDNIGHT_UTC})


async def exhaust(database: AsyncDatabase, funktion: Zaehler, email: str) -> None:
    """The person's count for `TODAY` at its ceiling, every unit spent."""

    await spend(database, funktion, email, ZAEHLER_BUDGETS[funktion])


async def counts(database: AsyncDatabase) -> dict[str, int]:
    return {row["_id"]: row["n"] async for row in database[Collection.DROSSELUNG].find({})}


def refused_until_midnight(response: Response) -> bool:
    return answered(response) == (429, DROSSELUNG_ERREICHT) and response.headers.get("retry-after") == str(SECONDS_TO_MIDNIGHT)


class TestTheCeilingUnderConcurrency:
    # The units left before the ceiling, and as many writes again past it.
    LEFT = 5

    def test_the_last_units_and_as_many_more_concurrent_writes_admit_exactly_the_last_across_two_applications(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture
    ):
        """The count short of its ceiling, so every write sent is one the ceiling decides; the admitted meet the handler's own 404.

        Never the whole budget: three hundred requests on one event loop each ran near the request's deadline.
        """

        ceiling = TAGESBUDGETS["kontakt"]

        async def steps(database: AsyncDatabase) -> tuple[list[Response], dict[str, int]]:
            await spend(database, "kontakt", PERSON, ceiling - self.LEFT)
            async with (
                app_client(mongo_replica_set_url, app=_first(), now=NOW) as one,
                app_client(mongo_replica_set_url, app=_second(), now=NOW) as two,
            ):
                sent = [http.patch(KADER_ROW, json=KADER_EDIT, headers=as_person(PERSON)) for http in islice(cycle((one, two)), 2 * self.LEFT)]
                answers = await asyncio.gather(*sent)

            return list(answers), await counts(database)

        with caplog.at_level(logging.WARNING, logger=FL_LOGGER_NAME):
            answers, stored = seeded(mongo_replica_set_url, steps)

        assert Counter(answered(response) for response in answers) == {
            (404, DOCUMENT_NOT_FOUND): self.LEFT,
            (429, DROSSELUNG_ERREICHT): self.LEFT,
        }
        assert all(refused_until_midnight(response) for response in answers if response.status_code == 429)
        assert stored == {count_id("kontakt", PERSON): ceiling + self.LEFT}

        # One line however many presses the ceiling refused, naming the person as the log page does and never by address.
        [line] = [record.getMessage() for record in caplog.records if record.getMessage().startswith(CEILING_LINE)]
        pseudonym = akteur_pseudonym(sign_in_identifier(PERSON), schluessel=CONFIG.sperrliste_schluessel)
        assert line == f"{CEILING_LINE}: kontakt {pseudonym[:8]}"

    def test_counts_gathered_from_no_row_race_to_insert_it_and_lose_nothing(self, mongo_replica_set_url: str):
        """The count itself, one closure per request as each request builds it, so every first upsert lands in one pass of the loop.

        The one case starting from no row.
        """

        ceiling = TAGESBUDGETS["spieler"]
        actor = PersonActor(pseudonym=akteur_pseudonym(sign_in_identifier(PERSON), schluessel=CONFIG.sperrliste_schluessel), funktion="spieler")

        async def steps(database: AsyncDatabase) -> tuple[list[BaseException | None], dict[str, int], Any]:
            bound = actor_var.set(actor)
            try:
                counted = [get_drossel(database[Collection.DROSSELUNG], NOW)() for _ in range(ceiling + 5)]
                outcomes = await asyncio.gather(*counted, return_exceptions=True)
            finally:
                actor_var.reset(bound)
            row = await database[Collection.DROSSELUNG].find_one({"_id": count_id("spieler", PERSON)})
            return list(outcomes), await counts(database), row

        outcomes, stored, row = seeded(mongo_replica_set_url, steps)

        # A duplicate key here is a first insert the server refused rather than retried as an update.
        assert Counter(type(outcome).__name__ for outcome in outcomes) == {"NoneType": ceiling, DrosselungException.__name__: 5}
        assert stored == {count_id("spieler", PERSON): ceiling + 5}
        # Set by the insert alone, which this race is the only case to make.
        assert row["ablauf"] == MIDNIGHT_UTC


# Every route counting each call, each refused at an exhausted count of its Funktion before its handler reads the body.
COUNTED_ON_EVERY_CALL = [
    pytest.param("PATCH", KADER_ROW, KADER_EDIT, "kontakt", id="a squad row's edit"),
    pytest.param("DELETE", KADER_ROW, None, "kontakt", id="a squad row's austragen"),
    pytest.param("POST", f"{API}/registrierungen/{ANY_REGISTRIERUNG}/aufnehmen", {}, "kontakt", id="an admission"),
    pytest.param("POST", f"{API}/registrierungen/{ANY_REGISTRIERUNG}/ablehnen", {}, "kontakt", id="a decline"),
    pytest.param(
        "POST",
        f"{API}/spielbestaetigungen/{ANY_SPIELBESTAETIGUNG}/antwort",
        {"antwort": "zugesagt", "begruendung": None},
        "schiedsrichter",
        id="a referee's answer",
    ),
    pytest.param("PUT", f"{API}/spielberichte/{ANY_SPIEL}/bericht", SPIELBERICHT, "schiedsrichter", id="a referee's report"),
]


# The address change's two counted presses, on a count of their own: each mails a mailbox the person typed.
ADDRESS_CHANGE_COUNTED = [
    pytest.param("POST", f"{API}/konto/adresswechsel", {"email": "neu.postfach@anderswo.example"}, id="a start"),
    pytest.param("POST", f"{API}/konto/adresswechsel/freigabe", None, id="an approval"),
]


class TestTheAddressChangesOwnCount:
    @pytest.mark.parametrize(("method", "path", "body"), ADDRESS_CHANGE_COUNTED)
    def test_its_exhausted_count_refuses_until_midnight_and_the_funktion_s_count_moves_not(
        self, mongo_replica_set_url: str, method: str, path: str, body: Any
    ):
        """Count it on the binder's `kontakt` instead and the first case is a 404 or a start, the second count never reached."""

        async def steps(database: AsyncDatabase) -> tuple[Response, dict[str, int]]:
            await exhaust(database, "adresswechsel", PERSON)
            async with app_client(mongo_replica_set_url, app=_first(), now=NOW) as http:
                response = await http.request(method, path, json=body, headers=as_person(PERSON))
            return response, await counts(database)

        response, stored = seeded(mongo_replica_set_url, steps)

        assert refused_until_midnight(response), response.text
        assert stored == {count_id("adresswechsel", PERSON): ZAEHLER_BUDGETS["adresswechsel"] + 1}

    def test_an_exhausted_funktion_count_refuses_no_start(self, mongo_replica_set_url: str):
        """The control: the seat holder's day of panel work spends nothing a start counts on."""

        async def steps(database: AsyncDatabase) -> tuple[Response, dict[str, int]]:
            await exhaust(database, "kontakt", PERSON)
            async with app_client(mongo_replica_set_url, app=_first(), now=NOW) as http:
                response = await http.post(
                    f"{API}/konto/adresswechsel", json={"email": "neu.postfach@anderswo.example"}, headers=as_person(PERSON)
                )
            return response, await counts(database)

        response, stored = seeded(mongo_replica_set_url, steps)

        assert response.status_code == 200, response.text
        assert stored == {count_id("kontakt", PERSON): TAGESBUDGETS["kontakt"], count_id("adresswechsel", PERSON): 1}


class TestAnExhaustedCount:
    @pytest.mark.parametrize(("method", "path", "body", "funktion"), COUNTED_ON_EVERY_CALL)
    def test_each_route_counting_every_call_refuses_until_midnight(
        self, mongo_replica_set_url: str, method: str, path: str, body: Any, funktion: AktorFunktion
    ):
        async def steps(database: AsyncDatabase) -> tuple[Response, dict[str, int]]:
            await exhaust(database, funktion, PERSON)
            async with app_client(mongo_replica_set_url, app=_first(), now=NOW) as http:
                response = await http.request(method, path, json=body, headers=as_person(PERSON))
            return response, await counts(database)

        response, stored = seeded(mongo_replica_set_url, steps)

        assert refused_until_midnight(response), response.text
        assert stored == {count_id(funktion, PERSON): TAGESBUDGETS[funktion] + 1}

    def test_another_person_and_the_same_person_s_other_funktion_keep_their_own_count(self, mongo_replica_set_url: str):
        """The control and the two keys at once: every answer below but the first would be a 429 were the count shared."""

        async def steps(database: AsyncDatabase) -> tuple[Response, Response, Response, dict[str, int]]:
            await exhaust(database, "kontakt", PERSON)
            async with app_client(mongo_replica_set_url, app=_first(), now=NOW) as http:
                own = await http.patch(KADER_ROW, json=KADER_EDIT, headers=as_person(PERSON))
                other_person = await http.patch(KADER_ROW, json=KADER_EDIT, headers=as_person(OTHER_SEAT))
                # Withdrawn first, so the grant after it is one the pupil's record can count.
                withdrawn = await http.patch(SPIELER.path, json=SPIELER.press(False), headers=as_person(PERSON))
                other_funktion = await http.patch(
                    SPIELER.path, json=SPIELER.press(True, withdrawn.json()["nachweis_stand"]), headers=as_person(PERSON)
                )
            return own, other_person, other_funktion, await counts(database)

        own, other_person, other_funktion, stored = seeded(mongo_replica_set_url, steps)

        assert refused_until_midnight(own)
        assert answered(other_person) == (404, DOCUMENT_NOT_FOUND)
        assert other_funktion.status_code == 200, other_funktion.text
        assert stored == {
            count_id("kontakt", PERSON): TAGESBUDGETS["kontakt"] + 1,
            count_id("kontakt", OTHER_SEAT): 1,
            count_id("spieler", PERSON): 1,
        }

    def test_the_next_german_day_counts_afresh(self, mongo_replica_set_url: str):
        async def steps(database: AsyncDatabase) -> tuple[Response, Response, Any]:
            await exhaust(database, "kontakt", PERSON)
            async with app_client(mongo_replica_set_url, app=_first(), now=NOW) as http:
                today = await http.patch(KADER_ROW, json=KADER_EDIT, headers=as_person(PERSON))
            async with app_client(mongo_replica_set_url, app=_first(), now=NEXT_DAY) as http:
                tomorrow = await http.patch(KADER_ROW, json=KADER_EDIT, headers=as_person(PERSON))
            return today, tomorrow, await database[Collection.DROSSELUNG].find_one({"_id": count_id("kontakt", PERSON, TOMORROW)})

        today, tomorrow, fresh = seeded(mongo_replica_set_url, steps)

        assert refused_until_midnight(today)
        assert answered(tomorrow) == (404, DOCUMENT_NOT_FOUND)
        # Its own row, expiring at the midnight ending the day it counts.
        assert (fresh["n"], fresh["ablauf"]) == (1, NEXT_MIDNIGHT_UTC)


@dataclass(frozen=True)
class Consent:
    """One of the three consent writes a person's account page sends, pressed for `medien` alone."""

    funktion: AktorFunktion
    path: str
    seite: Seite
    # The choices a press names beside `medien`, unmoved, and the evidence a page served each seeded record echoes.
    beside: Mapping[str, Any]
    stand: Mapping[str, Any]
    young_stand: Mapping[str, Any]
    # The dependency handing the handler the collection its press writes.
    collection: Callable[..., Awaitable[AsyncCollection]]
    # The same operation naming `YOUNG`'s own record.
    young_path: str

    def press(self, medien: bool, stand: Mapping[str, Any] | None = None) -> dict[str, Any]:
        return {
            **self.beside,
            "medien": medien,
            "text_version": LAUFENDE_FASSUNGEN[self.seite],
            "nachweis_stand": dict(self.stand if stand is None else stand),
        }


SPIELER = Consent(
    "spieler",
    f"{API}/spieler/selbst/einwilligung",
    KONTO_SEITE_SPIELER,
    {"umfang": "kader_oeffentlich"},
    PERSON_STAND,
    YOUNG_STAND,
    collection_dependency(Collection.SPIELER),
    f"{API}/spieler/selbst/einwilligung",
)
CONSENTS = [
    pytest.param(SPIELER, id="a pupil's record"),
    pytest.param(
        Consent(
            "schiedsrichter",
            f"{API}/schiedsrichter/selbst/{REFEREE}/einwilligung",
            KONTO_SEITE_SCHIEDSRICHTER,
            {"umfang": "kader_oeffentlich"},
            PERSON_STAND,
            YOUNG_STAND,
            collection_dependency(Collection.SCHIEDSRICHTER),
            f"{API}/schiedsrichter/selbst/{YOUNG_REFEREE}/einwilligung",
        ),
        id="a referee's record",
    ),
    pytest.param(
        Consent(
            "kontakt",
            f"{API}/teams/{TEAM_A}/saisons/{ACTIVE_SAISON}/person/einwilligung",
            KONTO_SEITE_KONTAKT,
            {"umfang": "kontaktdaten"},
            PERSON_SEAT_STAND,
            YOUNG_SEAT_STAND,
            collection_dependency(Collection.SAISON_TEAMS),
            f"{API}/teams/{TEAM_A}/saisons/{ACTIVE_SAISON}/person/einwilligung",
        ),
        id="a contact seat",
    ),
]


def transient_conflict() -> OperationFailure:
    """What a rival writer committing first costs an attempt: `with_transaction` runs the callback again."""

    return OperationFailure("write conflict", 112, {"ok": 0, "code": 112, "errorLabels": ["TransientTransactionError"]})


class _ConflictsOnce:
    """The real collection, the request's first write through it failing as a write conflict does."""

    def __init__(self, collection: AsyncCollection) -> None:
        self._collection = collection
        self.conflicted = False

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def find_one_and_update(self, *args: Any, **kwargs: Any) -> Any:
        if not self.conflicted:
            self.conflicted = True
            raise transient_conflict()

        return await self._collection.find_one_and_update(*args, **kwargs)


class TestAConsentPress:
    """A grant counts and a withdrawal never does: taking a consent back stays as easy as giving it was (Art. 7(3) DSGVO)."""

    @pytest.mark.parametrize("consent", CONSENTS)
    def test_at_the_ceiling_a_withdrawal_is_taken_and_a_grant_refused(self, mongo_replica_set_url: str, consent: Consent):
        async def steps(database: AsyncDatabase) -> tuple[Response, Response, dict[str, int]]:
            await exhaust(database, consent.funktion, PERSON)
            async with app_client(mongo_replica_set_url, app=_first(), now=NOW) as http:
                withdrawn = await http.patch(consent.path, json=consent.press(False), headers=as_person(PERSON))
                granted = await http.patch(
                    consent.path, json=consent.press(True, withdrawn.json()["nachweis_stand"]), headers=as_person(PERSON)
                )
            return withdrawn, granted, await counts(database)

        withdrawn, granted, stored = seeded(mongo_replica_set_url, steps)

        assert withdrawn.status_code == 200, withdrawn.text
        assert refused_until_midnight(granted), granted.text
        # The withdrawal spent nothing: the one unit past the ceiling is the refused grant's.
        assert stored == {count_id(consent.funktion, PERSON): TAGESBUDGETS[consent.funktion] + 1}

    @pytest.mark.parametrize("consent", CONSENTS)
    def test_below_the_ceiling_a_grant_spends_one_unit_and_a_withdrawal_none(self, mongo_replica_set_url: str, consent: Consent):
        """The control for the case above: a count that never moved would pass it."""

        async def steps(database: AsyncDatabase) -> tuple[list[Response], dict[str, int]]:
            async with app_client(mongo_replica_set_url, app=_first(), now=NOW) as http:
                withdrawn = await http.patch(consent.path, json=consent.press(False), headers=as_person(PERSON))
                granted = await http.patch(
                    consent.path, json=consent.press(True, withdrawn.json()["nachweis_stand"]), headers=as_person(PERSON)
                )
                # The same answer again moves nothing, so it grants nothing either.
                again = await http.patch(consent.path, json=consent.press(True, granted.json()["nachweis_stand"]), headers=as_person(PERSON))
            return [withdrawn, granted, again], await counts(database)

        answers, stored = seeded(mongo_replica_set_url, steps)

        assert [response.status_code for response in answers] == [200, 200, 200], [response.text for response in answers]
        assert stored == {count_id(consent.funktion, PERSON): 1}

    @pytest.mark.parametrize("consent", CONSENTS)
    def test_a_grant_retried_after_a_transient_error_spends_one_unit(self, mongo_replica_set_url: str, consent: Consent):
        """With the day's last unit: an attempt counting again would refuse the very grant the first attempt admitted."""

        wrappers: list[_ConflictsOnce] = []

        async def conflicting_once(db: Annotated[AsyncDatabase, Depends(get_database)]) -> _ConflictsOnce:
            wrappers.append(_ConflictsOnce(await consent.collection(db)))
            return wrappers[-1]

        async def steps(database: AsyncDatabase) -> tuple[Response, dict[str, int]]:
            await spend(database, consent.funktion, PERSON, TAGESBUDGETS[consent.funktion] - 1)
            async with app_client(mongo_replica_set_url, app=_first(), now=NOW) as http:
                # The withdrawal first, through the real collection, so the grant after it has something to switch on.
                withdrawn = await http.patch(consent.path, json=consent.press(False), headers=as_person(PERSON))
                # Inside the client, which restores the app's overrides as it closes.
                _first().dependency_overrides[consent.collection] = conflicting_once
                granted = await http.patch(
                    consent.path, json=consent.press(True, withdrawn.json()["nachweis_stand"]), headers=as_person(PERSON)
                )
            return granted, await counts(database)

        granted, stored = seeded(mongo_replica_set_url, steps)

        assert granted.status_code == 200, granted.text
        # The grant's first attempt met the conflict, so the count was asked twice for one write.
        assert [wrapper.conflicted for wrapper in wrappers] == [True]
        assert stored == {count_id(consent.funktion, PERSON): TAGESBUDGETS[consent.funktion]}


# Each a grant `YOUNG` presses that another rule refuses, and the code that rule answers.
REFUSED_GRANTS = [
    pytest.param(
        lambda consent: {**consent.press(True), "nachweis_stand": {**consent.young_stand, "medien": "2026-03-01T10:00:00+00:00"}},
        (409, EINWILLIGUNG_STAND_VERALTET),
        id="a stale page",
    ),
    pytest.param(
        lambda consent: {**consent.press(True, consent.young_stand), "text_version": "2000-01-unbekannt"},
        (409, FASSUNG_UNZULAESSIG),
        id="an unknown label",
    ),
    pytest.param(lambda consent: consent.press(True, consent.young_stand), (422, SELBST_MEDIEN_ALTER), id="under the media age"),
]


class TestAGrantAnotherRuleRefuses:
    """Counted only once every other refusal has passed: its own reason, never the day's, and no unit spent."""

    @pytest.mark.parametrize("exhausted", [False, True], ids=("an empty count", "an exhausted count"))
    @pytest.mark.parametrize(("pressed", "refusal"), REFUSED_GRANTS)
    @pytest.mark.parametrize("consent", CONSENTS)
    def test_answers_its_own_reason_and_spends_nothing(
        self,
        mongo_replica_set_url: str,
        consent: Consent,
        pressed: Callable[[Consent], dict[str, Any]],
        refusal: tuple[int, str],
        exhausted: bool,
    ):
        async def steps(database: AsyncDatabase) -> tuple[Response, dict[str, int]]:
            if exhausted:
                await exhaust(database, consent.funktion, YOUNG)
            async with app_client(mongo_replica_set_url, app=_first(), now=NOW) as http:
                response = await http.patch(consent.young_path, json=pressed(consent), headers=as_person(YOUNG))
            return response, await counts(database)

        response, stored = seeded(mongo_replica_set_url, steps)

        assert answered(response) == refusal, response.text
        assert stored == ({count_id(consent.funktion, YOUNG): TAGESBUDGETS[consent.funktion]} if exhausted else {})


class TestAnAdministrator:
    def test_an_administrator_s_writes_count_nothing(self, mongo_replica_set_url: str):
        """Past any person's ceiling, on the administrator's own squad route: the count is never asked, so no row is written."""

        async def steps(database: AsyncDatabase) -> tuple[list[int], int]:
            async with app_client(mongo_replica_set_url, app=_first(), now=NOW) as http:
                presses = [
                    await http.delete(f"{API}/spieler/{PUPIL}/saisons/{ACTIVE_SAISON}", headers=ADMIN_AUTH)
                    for _ in range(TAGESBUDGETS["spieler"] + 5)
                ]
            return [response.status_code for response in presses], await database[Collection.DROSSELUNG].count_documents({})

        statuses, stored = seeded(mongo_replica_set_url, steps)

        assert set(statuses) == {200}
        assert stored == 0
