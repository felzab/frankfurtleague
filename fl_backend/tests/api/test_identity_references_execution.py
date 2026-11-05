import functools
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

import pytest
from bson import ObjectId
from fastapi import FastAPI
from pymongo.asynchronous.database import AsyncDatabase

from app.core.codes import Code
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID
from app.main import create_app
from tests.app_client import app_client
from tests.config import SYSTEM_AUTH
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import (
    EINWILLIGUNG,
    SPIELER_TEXT_VERSIONS,
    ban_document,
    bewerbung_document,
    kontakte_document,
    kontaktperson_document,
    new_schule_document,
    registrierung_document,
    saison_document,
    saison_team_document,
    schiedsrichter_document,
    spieler_document,
)
from tests.worker import worker_database

from .conftest import AUSTRITT, config_for

DATABASE_NAME = worker_database("fl_identity_references_test")

PATH = f"/api/v{API_VERSION}/identity/references"

PAST_SAISON = "2425"
ACTIVE_SAISON = "2526"
STAMP = "2026-01-20"

# One mailbox per kind of record, each held by that record alone, so an arm the read drops answers
# exactly its own address.
SEAT_PAST = "sitz.vergangen@schule.de"
SEAT_PAST_OPEN = "sitz.vergangen.offen@schule.de"
SEAT_OPEN = "sitz.offen@schule.de"
SEAT_EXITED = "sitz.ausgetreten@schule.de"
BEWERBUNG_OPEN = "bewerbung.offen@schule.de"
BEWERBUNG_UNCONFIRMED = "bewerbung.unbestaetigt@schule.de"
SPIELER_FORMER = "spieler.ehemalig@schule.de"
WHISTLE_RETIRED = "pfeife.ruhestand@schule.de"
REGISTERED = "rita.registriert@schule.de"
ADMIN = "verena.verwaltung@schule.de"
# Barred while the running season lasts, the one holding a referee record and the other nothing: a ban
# keeps no account, so the record alone decides.
BARRED_WHISTLE = "gesa.pfeife@schule.de"
BARRED = "gerda.gesperrt@schule.de"
# Today's address rule refuses a local part beyond ASCII, so no ban can be keyed under this one, and no
# record holds it: a ban keeping no account, it is judged as any other.
OUTSIDE_THE_RULE = "jürgen@schule.de"

REGISTERED_OPEN = "rita.offen@schule.de"
GHOST_SCHIEDSRICHTER = "geist.pfeife@schule.de"
# Asked as an account may store it, so the answer is shown to keep the asker's spelling.
NOBODY = "Niemand.Hier@Example.COM"

# The league's owner, asked about nowhere: what lets the read answer at all.
OWNER = "olga.inhaberin@schule.de"

TEAM_OIDS = [ObjectId(f"6890a1b2c3d4e5f6079900{n:02d}") for n in range(1, 5)]
GRANT_OID = ObjectId("6890a1b2c3d4e5f607990051")

# One pass's batch, as the sweep sends it, one address in it twice. The retired pupil is asked in
# capitals against a row storing the fold, as every record stores it.
ASKED = [
    SEAT_PAST,
    SEAT_PAST_OPEN,
    SEAT_OPEN,
    SEAT_EXITED,
    NOBODY,
    BEWERBUNG_OPEN,
    BEWERBUNG_UNCONFIRMED,
    "Spieler.Ehemalig@Schule.DE",
    WHISTLE_RETIRED,
    GHOST_SCHIEDSRICHTER,
    REGISTERED,
    REGISTERED_OPEN,
    ADMIN,
    BARRED_WHISTLE,
    BARRED,
    OUTSIDE_THE_RULE,
    NOBODY,
]


def _seat(email: str, *, confirmed_at: str | None = STAMP) -> dict[str, Any]:
    return kontaktperson_document("Anna", confirmed_at=confirmed_at, email=email)


def _row(team_id: ObjectId, saison_id: str, shorthand: str, **fields: Any) -> dict[str, Any]:
    return saison_team_document(saison_id, team_id, f"Schule {shorthand}", shorthand, **fields)


def _referee(oid: Any, email: str, name: str, **fields: Any) -> dict[str, Any]:
    return schiedsrichter_document(
        oid, email=email, name=name, default_payment=20, **{"einwilligung": {**EINWILLIGUNG, "confirmed_at": STAMP}, **fields}
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
        submitted_at="2026-01-02",
        frist="2026-01-09",
        position="Mittelfeld",
        nummer="17",
        stufe="Q1",
        confirmed=None
        if not confirmed
        else {
            "geburtsdatum": "2009-05-04",
            "umfang": "intern",
            "media": False,
            "text_versions": SPIELER_TEXT_VERSIONS,
            "today": "2026-01-03",
            "am": "2026-01-03T08:00:00+00:00",
        },
    )


async def _seed(database: AsyncDatabase, *, owner: str | None) -> None:
    """`owner` is the `owner` grant's address as stored, or `None` for a league whose grants hold no owner."""

    await database[Collection.SAISONS].insert_many([saison_document(PAST_SAISON, "past"), saison_document(ACTIVE_SAISON, "active")])
    await database[Collection.SAISON_TEAMS].insert_many(
        [
            _row(
                TEAM_OIDS[0],
                PAST_SAISON,
                "SVX",
                kontakte=kontakte_document(trainer=_seat("Sitz.Vergangen@Schule.de"), ansprechperson=_seat(SEAT_PAST_OPEN, confirmed_at=None)),
            ),
            _row(TEAM_OIDS[1], ACTIVE_SAISON, "SOX", kontakte=kontakte_document(trainer=_seat(SEAT_OPEN, confirmed_at=None))),
            _row(TEAM_OIDS[2], ACTIVE_SAISON, "SWX", austritt=dict(AUSTRITT), kontakte=kontakte_document(trainer=_seat(SEAT_EXITED))),
        ]
    )
    await database[Collection.BEWERBUNGEN].insert_one(
        bewerbung_document(
            ObjectId(),
            ACTIVE_SAISON,
            "submitted",
            kontakte=kontakte_document(trainer=_seat(BEWERBUNG_OPEN), ansprechperson=_seat(BEWERBUNG_UNCONFIRMED, confirmed_at=None)),
            submitted_at="2026-01-01",
            confirmation_deadline="2026-01-15",
            schule=new_schule_document("Bewerberschule", "BWX"),
        )
    )
    await database[Collection.SPIELER].insert_many(
        [
            spieler_document(ObjectId(), "Anna", "Ehemalig", email=SPIELER_FORMER, inactive_since="2026-03-01"),
        ]
    )
    await database[Collection.SCHIEDSRICHTER].insert_many(
        [
            _referee(ObjectId(), WHISTLE_RETIRED, "B. Ruhestand", inactive_since="2026-03-01"),
            _referee(ObjectId(), BARRED_WHISTLE, "G. Pfeife"),
            # The ghost, for the sentinel's reason above.
            _referee(GHOST_SCHIEDSRICHTER_ID, GHOST_SCHIEDSRICHTER, "D. Geist"),
        ]
    )
    await database[Collection.REGISTRIERUNGEN].insert_many(
        [_registrierung(REGISTERED, confirmed=True), _registrierung(REGISTERED_OPEN, confirmed=False)]
    )
    await database[Collection.BAN_LIST].insert_many([ban_document(BARRED_WHISTLE, bis=ACTIVE_SAISON), ban_document(BARRED, bis=ACTIVE_SAISON)])
    granted = datetime(2026, 1, 1, tzinfo=UTC)
    await database[Collection.GRANTS].insert_one(
        {"_id": GRANT_OID, "adresse": ADMIN, "admin_tier": "administration", "granted_by": "PLAYGROUND", "granted_at": granted}
    )
    # The address changed in place in the database, which the comparison has not seen: the grant is in
    # effect for nobody until it does, and its account still stays.
    await database[Collection.GRANTS_ANNOUNCED].insert_one(
        {"_id": GRANT_OID, "adresse": "verena.vorher@schule.de", "admin_tier": "administration", "angekuendigt_am": granted}
    )
    if owner is not None:
        await database[Collection.GRANTS].insert_one(
            {"_id": ObjectId(), "adresse": owner, "admin_tier": "owner", "granted_by": "PLAYGROUND", "granted_at": granted}
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
            await _seed(database, owner=OWNER)

            return await _ask(url, ASKED)

    return on_the_seed_loop(_run())


@pytest.mark.db
class TestWhatKeepsAnAccount:
    @pytest.mark.parametrize(
        "email",
        [
            pytest.param(SEAT_PAST, id="a past season's block not yet cleared"),
            pytest.param(SEAT_PAST_OPEN, id="an unconfirmed seat on a past season"),
            pytest.param(SEAT_OPEN, id="an unconfirmed seat on the running season, which the gate admits"),
            pytest.param(SEAT_EXITED, id="a withdrawn team's seat"),
            pytest.param(BEWERBUNG_OPEN, id="a pending application's confirmed seat"),
            pytest.param(BEWERBUNG_UNCONFIRMED, id="a pending application's unconfirmed seat"),
            pytest.param("Spieler.Ehemalig@Schule.DE", id="a retired pupil, asked in capitals"),
            pytest.param(WHISTLE_RETIRED, id="a retired referee"),
            pytest.param(REGISTERED, id="a confirmed pending registration"),
            pytest.param(ADMIN, id="a grant the comparison has not seen"),
            pytest.param(BARRED_WHISTLE, id="a referee record at a barred address"),
        ],
    )
    def test_an_address_a_record_or_grant_holds_is_never_answered(self, mongo_replica_set_url: str, email: str):
        status, body = answered(mongo_replica_set_url)

        assert status == 200, body
        assert email not in body["unreferenced"]


@pytest.mark.db
class TestWhatLetsAnAccountGo:
    @pytest.mark.parametrize(
        "email",
        [
            pytest.param(REGISTERED_OPEN, id="a pending registration its pupil has not confirmed"),
            pytest.param(BARRED, id="a standing ban and no record"),
            pytest.param(OUTSIDE_THE_RULE, id="an address today's rule refuses and no record holds"),
            pytest.param(GHOST_SCHIEDSRICHTER, id="the referee placeholder, by its id"),
            pytest.param(NOBODY, id="nothing at all"),
        ],
    )
    def test_an_address_nothing_holds_is_answered(self, mongo_replica_set_url: str, email: str):
        status, body = answered(mongo_replica_set_url)

        assert status == 200, body
        assert email in body["unreferenced"]

    def test_the_answer_holds_each_once_in_the_spelling_asked_and_nothing_else(self, mongo_replica_set_url: str):
        assert answered(mongo_replica_set_url) == (
            200,
            {
                "unreferenced": [NOBODY, GHOST_SCHIEDSRICHTER, REGISTERED_OPEN, BARRED, OUTSIDE_THE_RULE],
            },
        )


@pytest.mark.db
class TestALeagueWithoutAnOwner:
    """An empty or foreign database answers every address unreferenced, and the sweep would delete every account on it."""

    def test_the_whole_batch_is_refused(self, mongo_replica_set_url: str):
        async def _run() -> tuple[int, Mapping[str, Any]]:
            async with a_clean_database(mongo_replica_set_url, DATABASE_NAME, constraints=True):
                return await _ask(mongo_replica_set_url, [NOBODY, SEAT_OPEN])

        status, body = on_the_seed_loop(_run())

        assert (status, body["error_code"]) == (409, Code.NO_OWNER), body
        assert "unreferenced" not in body
