import functools
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

import pytest
from bson import ObjectId
from fastapi import FastAPI
from pymongo.asynchronous.database import AsyncDatabase

from app.api.identitaet.services import KEIN_INHABER
from app.api.spieler.services import build_ghost_spieler
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID
from app.main import create_app
from tests.app_client import app_client
from tests.config import SYSTEM_AUTH
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import (
    EINWILLIGUNG,
    ban_document,
    bewerbung_document,
    kontakte_document,
    kontaktperson_document,
    neue_schule_document,
    registrierung_document,
    saison_document,
    saison_team_document,
    schiedsrichter_document,
    spieler_document,
)
from tests.worker import worker_database

from .conftest import AUSTRITT, config_for

DATABASE_NAME = worker_database("fl_identitaet_referenzen_test")

PATH = f"/api/v{API_VERSION}/identitaet/referenzen"

PAST_SAISON = "2425"
ACTIVE_SAISON = "2526"
STAMP = "2026-01-20"

# One mailbox per kind of record, each held by that record alone, so an arm the read drops answers
# exactly its own address.
SITZ_VERGANGEN = "sitz.vergangen@schule.de"
SITZ_VERGANGEN_OFFEN = "sitz.vergangen.offen@schule.de"
SITZ_OFFEN = "sitz.offen@schule.de"
SITZ_AUSGETRETEN = "sitz.ausgetreten@schule.de"
BEWERBUNG_OFFEN = "bewerbung.offen@schule.de"
BEWERBUNG_UNBESTAETIGT = "bewerbung.unbestaetigt@schule.de"
SPIELER_EHEMALIG = "spieler.ehemalig@schule.de"
SPIELER_OFFEN = "spieler.offen@schule.de"
PFEIFE_RUHESTAND = "pfeife.ruhestand@schule.de"
REGISTRIERT = "rita.registriert@schule.de"
VERWALTUNG = "verena.verwaltung@schule.de"
# Barred while the running season lasts, the one holding a referee record and the other nothing: a ban
# keeps no account, so the record alone decides.
GESPERRT_PFEIFE = "gesa.pfeife@schule.de"
GESPERRT = "gerda.gesperrt@schule.de"
# Today's address rule refuses a local part beyond ASCII, so no ban can be keyed under this one, and no
# record holds it: a ban keeping no account, it is judged as any other.
AUSSER_DER_REGEL = "jürgen@schule.de"

REGISTRIERT_OFFEN = "rita.offen@schule.de"
GEIST_SCHIEDSRICHTER = "geist.pfeife@schule.de"
GEIST_SPIELER = "geist.spieler@schule.de"
# Asked as an account may store it, so the answer is shown to keep the asker's spelling.
NIEMAND = "Niemand.Hier@Example.COM"

# The league's owner, asked about nowhere: what lets the read answer at all.
INHABERIN = "olga.inhaberin@schule.de"

TEAM_OIDS = [ObjectId(f"6890a1b2c3d4e5f6079900{n:02d}") for n in range(1, 5)]
GRANT_OID = ObjectId("6890a1b2c3d4e5f607990051")

# One pass's batch, as the sweep sends it, one address in it twice. The retired pupil is asked in
# capitals against a row storing the fold, as every record stores it.
ASKED = [
    SITZ_VERGANGEN,
    SITZ_VERGANGEN_OFFEN,
    SITZ_OFFEN,
    SITZ_AUSGETRETEN,
    NIEMAND,
    BEWERBUNG_OFFEN,
    BEWERBUNG_UNBESTAETIGT,
    "Spieler.Ehemalig@Schule.DE",
    SPIELER_OFFEN,
    PFEIFE_RUHESTAND,
    GEIST_SCHIEDSRICHTER,
    GEIST_SPIELER,
    REGISTRIERT,
    REGISTRIERT_OFFEN,
    VERWALTUNG,
    GESPERRT_PFEIFE,
    GESPERRT,
    AUSSER_DER_REGEL,
    NIEMAND,
]


def _seat(email: str, *, bestaetigt_am: str | None = STAMP) -> dict[str, Any]:
    return kontaktperson_document("Anna", bestaetigt_am=bestaetigt_am, email=email)


def _row(team_id: ObjectId, saison_id: str, shorthand: str, **fields: Any) -> dict[str, Any]:
    return saison_team_document(saison_id, team_id, f"Schule {shorthand}", shorthand, **fields)


def _referee(oid: Any, email: str, name: str, **fields: Any) -> dict[str, Any]:
    return schiedsrichter_document(
        oid, email=email, name=name, default_payment=20, **{"einwilligung": {**EINWILLIGUNG, "bestaetigt_am": STAMP}, **fields}
    )


def _registrierung(email: str, *, confirmed: bool) -> dict[str, Any]:
    return registrierung_document(
        ObjectId(),
        email,
        saison_id=ACTIVE_SAISON,
        team_id=TEAM_OIDS[0],
        vorname="Rita",
        nachname="Registriert",
        token=email,
        eingereicht_am="2026-01-02",
        frist="2026-01-09",
        position="Mittelfeld",
        nummer="17",
        stufe="Q1",
        bestaetigt=None
        if not confirmed
        else {
            "geburtsdatum": "2009-05-04",
            "umfang": "intern",
            "medien": False,
            "text_version": "2026-09",
            "today": "2026-01-03",
            "am": "2026-01-03T08:00:00+00:00",
        },
    )


async def _seed(database: AsyncDatabase, *, inhaberin: str | None) -> None:
    """`inhaberin` is the `owner` grant's address as stored, or `None` for a league whose grants hold no owner."""

    await database[Collection.SAISONS].insert_many([saison_document(PAST_SAISON, "past"), saison_document(ACTIVE_SAISON, "active")])
    await database[Collection.SAISON_TEAMS].insert_many(
        [
            _row(
                TEAM_OIDS[0],
                PAST_SAISON,
                "SVX",
                kontakte=kontakte_document(
                    trainer=_seat("Sitz.Vergangen@Schule.de"), ansprechperson=_seat(SITZ_VERGANGEN_OFFEN, bestaetigt_am=None)
                ),
            ),
            _row(TEAM_OIDS[1], ACTIVE_SAISON, "SOX", kontakte=kontakte_document(trainer=_seat(SITZ_OFFEN, bestaetigt_am=None))),
            _row(TEAM_OIDS[2], ACTIVE_SAISON, "SWX", austritt=dict(AUSTRITT), kontakte=kontakte_document(trainer=_seat(SITZ_AUSGETRETEN))),
        ]
    )
    await database[Collection.BEWERBUNGEN].insert_one(
        bewerbung_document(
            ObjectId(),
            ACTIVE_SAISON,
            "eingereicht",
            kontakte=kontakte_document(trainer=_seat(BEWERBUNG_OFFEN), ansprechperson=_seat(BEWERBUNG_UNBESTAETIGT, bestaetigt_am=None)),
            eingereicht_am="2026-01-01",
            bestaetigungsfrist="2026-01-15",
            schule=neue_schule_document("Bewerberschule", "BWX"),
        )
    )
    await database[Collection.SPIELER].insert_many(
        [
            spieler_document(ObjectId(), "Anna", "Ehemalig", email=SPIELER_EHEMALIG, inactive_since="2026-03-01"),
            # A pupil's record is born confirmed, so a stamp a hand edit blanked is the unconfirmed pupil the gate meets.
            spieler_document(ObjectId(), "Anna", "Offen", email=SPIELER_OFFEN, einwilligung={**EINWILLIGUNG, "bestaetigt_am": ""}),
            # The nameless, recordless sentinel as written, given an address by a hand edit: its id alone keeps it out.
            {**build_ghost_spieler(), "email": GEIST_SPIELER},
        ]
    )
    await database[Collection.SCHIEDSRICHTER].insert_many(
        [
            _referee(ObjectId(), PFEIFE_RUHESTAND, "B. Ruhestand", inactive_since="2026-03-01"),
            _referee(ObjectId(), GESPERRT_PFEIFE, "G. Pfeife"),
            # The ghost, for the sentinel's reason above.
            _referee(GHOST_SCHIEDSRICHTER_ID, GEIST_SCHIEDSRICHTER, "D. Geist"),
        ]
    )
    await database[Collection.REGISTRIERUNGEN].insert_many(
        [_registrierung(REGISTRIERT, confirmed=True), _registrierung(REGISTRIERT_OFFEN, confirmed=False)]
    )
    await database[Collection.SPERRLISTE].insert_many(
        [ban_document(GESPERRT_PFEIFE, bis=ACTIVE_SAISON), ban_document(GESPERRT, bis=ACTIVE_SAISON)]
    )
    granted = datetime(2026, 1, 1, tzinfo=UTC)
    await database[Collection.BERECHTIGUNGEN].insert_one(
        {"_id": GRANT_OID, "adresse": VERWALTUNG, "verwaltung": "administration", "erteilt_von": "PLAYGROUND", "erteilt_am": granted}
    )
    # The address changed in place in the database, which the comparison has not seen: the grant is in
    # effect for nobody until it does, and its account still stays.
    await database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT].insert_one(
        {"_id": GRANT_OID, "adresse": "verena.vorher@schule.de", "verwaltung": "administration", "angekuendigt_am": granted}
    )
    if inhaberin is not None:
        await database[Collection.BERECHTIGUNGEN].insert_one(
            {"_id": ObjectId(), "adresse": inhaberin, "verwaltung": "owner", "erteilt_von": "PLAYGROUND", "erteilt_am": granted}
        )


@functools.cache
def _served() -> FastAPI:
    return create_app(config_for(DATABASE_NAME))


async def _ask(url: str, identifiers: list[str]) -> tuple[int, Mapping[str, Any]]:
    async with app_client(url, app=_served()) as http:
        response = await http.post(PATH, headers=SYSTEM_AUTH, json={"identifiers": identifiers})

    return response.status_code, response.json()


@functools.cache
def answered(url: str) -> tuple[int, Mapping[str, Any]]:
    """One pass's batch through the MOUNTED route over the whole league, which every case reads.

    One request rather than one per address: a judgement mixing two addresses of one batch shows only in a batch.
    """

    async def _run() -> tuple[int, Mapping[str, Any]]:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
            await _seed(database, inhaberin=INHABERIN)

            return await _ask(url, ASKED)

    return on_the_seed_loop(_run())


@pytest.mark.db
class TestWhatKeepsAnAccount:
    @pytest.mark.parametrize(
        "email",
        [
            pytest.param(SITZ_VERGANGEN, id="a past season's block not yet cleared"),
            pytest.param(SITZ_VERGANGEN_OFFEN, id="an unconfirmed seat on a past season"),
            pytest.param(SITZ_OFFEN, id="an unconfirmed seat on the running season, which the gate admits"),
            pytest.param(SITZ_AUSGETRETEN, id="a withdrawn team's seat"),
            pytest.param(BEWERBUNG_OFFEN, id="a pending application's confirmed seat"),
            pytest.param(BEWERBUNG_UNBESTAETIGT, id="a pending application's unconfirmed seat"),
            pytest.param("Spieler.Ehemalig@Schule.DE", id="a retired pupil, asked in capitals"),
            pytest.param(SPIELER_OFFEN, id="an unconfirmed live pupil, which the gate admits"),
            pytest.param(PFEIFE_RUHESTAND, id="a retired referee"),
            pytest.param(REGISTRIERT, id="a confirmed pending registration"),
            pytest.param(VERWALTUNG, id="a grant the comparison has not seen"),
            pytest.param(GESPERRT_PFEIFE, id="a referee record at a barred address"),
        ],
    )
    def test_an_address_a_record_or_grant_holds_is_never_answered(self, mongo_replica_set_url: str, email: str):
        status, body = answered(mongo_replica_set_url)

        assert status == 200, body
        assert email not in body["unreferenziert"]


@pytest.mark.db
class TestWhatLetsAnAccountGo:
    @pytest.mark.parametrize(
        "email",
        [
            pytest.param(REGISTRIERT_OFFEN, id="a pending registration its pupil has not confirmed"),
            pytest.param(GESPERRT, id="a standing ban and no record"),
            pytest.param(AUSSER_DER_REGEL, id="an address today's rule refuses and no record holds"),
            pytest.param(GEIST_SCHIEDSRICHTER, id="the referee placeholder, by its id"),
            pytest.param(GEIST_SPIELER, id="the pupil placeholder, by its id"),
            pytest.param(NIEMAND, id="nothing at all"),
        ],
    )
    def test_an_address_nothing_holds_is_answered(self, mongo_replica_set_url: str, email: str):
        status, body = answered(mongo_replica_set_url)

        assert status == 200, body
        assert email in body["unreferenziert"]

    def test_the_answer_holds_each_once_in_the_spelling_asked_and_nothing_else(self, mongo_replica_set_url: str):
        assert answered(mongo_replica_set_url) == (
            200,
            {
                "acknowledged": 1,
                "unreferenziert": [NIEMAND, GEIST_SCHIEDSRICHTER, GEIST_SPIELER, REGISTRIERT_OFFEN, GESPERRT, AUSSER_DER_REGEL],
            },
        )


@pytest.mark.db
class TestALeagueWithoutAnOwner:
    """An empty or foreign database answers every address unreferenced, and the sweep would delete every account on it."""

    @pytest.mark.parametrize(
        "seeded",
        [
            pytest.param(False, id="an empty database"),
            pytest.param(True, id="a league whose only owner row no request matches"),
        ],
    )
    def test_the_whole_batch_is_refused(self, mongo_replica_set_url: str, seeded: bool):
        """The second case holds an administrator's live grant and an owner's dead one: only a live `owner` lets the read answer."""

        async def _run() -> tuple[int, Mapping[str, Any]]:
            async with a_clean_database(mongo_replica_set_url, DATABASE_NAME, constraints=True) as (_, database):
                if seeded:
                    await _seed(database, inhaberin=INHABERIN.capitalize())

                return await _ask(mongo_replica_set_url, [NIEMAND, SITZ_OFFEN])

        status, body = on_the_seed_loop(_run())

        assert (status, body["error_code"]) == (409, KEIN_INHABER), body
        assert "unreferenziert" not in body
