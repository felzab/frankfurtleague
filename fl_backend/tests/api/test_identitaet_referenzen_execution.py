import functools
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

import pytest
from bson import ObjectId
from fastapi import FastAPI
from pymongo.asynchronous.database import AsyncDatabase

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
SITZ_OFFEN = "sitz.offen@schule.de"
SITZ_AUSGETRETEN = "sitz.ausgetreten@schule.de"
BEWERBUNG_OFFEN = "bewerbung.offen@schule.de"
SPIELER_EHEMALIG = "spieler.ehemalig@schule.de"
SPIELER_OFFEN = "spieler.offen@schule.de"
PFEIFE_RUHESTAND = "pfeife.ruhestand@schule.de"
REGISTRIERT = "rita.registriert@schule.de"
VERWALTUNG = "verena.verwaltung@schule.de"
GESPERRT = "gerda.gesperrt@schule.de"
# Today's address rule refuses a local part beyond ASCII, and no record holds this one: only the
# judgement keeps it out of the answer.
UNBEURTEILBAR = "jürgen@schule.de"

GELEERT = "gisela.geleert@schule.de"
GEIST_SCHIEDSRICHTER = "geist.pfeife@schule.de"
GEIST_SPIELER = "geist.spieler@schule.de"
# Asked as an account may store it, so the answer is shown to keep the asker's spelling.
NIEMAND = "Niemand.Hier@Example.COM"

TEAM_OIDS = [ObjectId(f"6890a1b2c3d4e5f6079900{n:02d}") for n in range(1, 6)]
GRANT_OID = ObjectId("6890a1b2c3d4e5f607990051")

# One pass's batch, as the sweep sends it, one address in it twice. The past seat and the registration
# store theirs as typed, and the retired pupil is asked in capitals against a row storing the fold.
ASKED = [
    SITZ_VERGANGEN,
    SITZ_OFFEN,
    SITZ_AUSGETRETEN,
    GELEERT,
    NIEMAND,
    BEWERBUNG_OFFEN,
    "Spieler.Ehemalig@Schule.DE",
    SPIELER_OFFEN,
    PFEIFE_RUHESTAND,
    GEIST_SCHIEDSRICHTER,
    GEIST_SPIELER,
    REGISTRIERT,
    VERWALTUNG,
    GESPERRT,
    UNBEURTEILBAR,
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


async def _seed(database: AsyncDatabase) -> None:
    await database[Collection.SAISONS].insert_many([saison_document(PAST_SAISON, "past"), saison_document(ACTIVE_SAISON, "active")])
    await database[Collection.SAISON_TEAMS].insert_many(
        [
            _row(TEAM_OIDS[0], PAST_SAISON, "SV", kontakte=kontakte_document(trainer=_seat("Sitz.Vergangen@Schule.de"))),
            # As the season-and-one clock leaves a block: no seat, and nothing of who held one.
            _row(TEAM_OIDS[1], PAST_SAISON, "SG", kontakte=None, bestaetigungen=None),
            _row(TEAM_OIDS[2], ACTIVE_SAISON, "SO", kontakte=kontakte_document(trainer=_seat(SITZ_OFFEN, bestaetigt_am=None))),
            _row(TEAM_OIDS[3], ACTIVE_SAISON, "SW", austritt=dict(AUSTRITT), kontakte=kontakte_document(trainer=_seat(SITZ_AUSGETRETEN))),
        ]
    )
    await database[Collection.BEWERBUNGEN].insert_one(
        bewerbung_document(
            ObjectId(),
            ACTIVE_SAISON,
            "eingereicht",
            kontakte=kontakte_document(trainer=_seat(BEWERBUNG_OFFEN)),
            eingereicht_am="2026-01-01",
            bestaetigungsfrist="2026-01-15",
            schule=neue_schule_document("Bewerberschule", "BW"),
        )
    )
    await database[Collection.SPIELER].insert_many(
        [
            spieler_document(ObjectId(), "Anna", "Ehemalig", email=SPIELER_EHEMALIG, inactive_since="2026-03-01"),
            spieler_document(ObjectId(), "Anna", "Offen", email=SPIELER_OFFEN, einwilligung={**EINWILLIGUNG, "bestaetigt_am": None}),
            # The nameless, recordless sentinel as written, given an address by a hand edit: its id alone keeps it out.
            {**build_ghost_spieler(), "email": GEIST_SPIELER},
        ]
    )
    await database[Collection.SCHIEDSRICHTER].insert_many(
        [
            _referee(ObjectId(), PFEIFE_RUHESTAND, "B. Ruhestand", inactive_since="2026-03-01"),
            # The ghost, for the sentinel's reason above.
            _referee(GHOST_SCHIEDSRICHTER_ID, GEIST_SCHIEDSRICHTER, "D. Geist"),
        ]
    )
    await database[Collection.REGISTRIERUNGEN].insert_one(
        registrierung_document(
            ObjectId(),
            "Rita.Registriert@Schule.de",
            saison_id=ACTIVE_SAISON,
            team_id=TEAM_OIDS[4],
            vorname="Rita",
            nachname="Registriert",
            token="rita-registriert",
            eingereicht_am="2026-01-02",
            frist="2026-01-09",
            position="Mittelfeld",
            nummer="17",
            stufe="Q1",
            bestaetigt={
                "geburtsdatum": "2009-05-04",
                "umfang": "intern",
                "medien": False,
                "text_version": "2026-09",
                "today": "2026-01-03",
                "am": "2026-01-03T08:00:00+00:00",
            },
        )
    )
    await database[Collection.SPERRLISTE].insert_one(ban_document(GESPERRT, bis=ACTIVE_SAISON))
    granted = datetime(2026, 1, 1, tzinfo=UTC)
    await database[Collection.BERECHTIGUNGEN].insert_one(
        {"_id": GRANT_OID, "adresse": VERWALTUNG, "verwaltung": "administration", "erteilt_von": "PLAYGROUND", "erteilt_am": granted}
    )
    # The address changed in place in the database, which the comparison has not seen: the grant is in
    # effect for nobody until it does, and its account still stays.
    await database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT].insert_one(
        {"_id": GRANT_OID, "adresse": "verena.vorher@schule.de", "verwaltung": "administration", "angekuendigt_am": granted}
    )


@functools.cache
def _served() -> FastAPI:
    return create_app(config_for(DATABASE_NAME))


@functools.cache
def answered(url: str) -> tuple[int, Mapping[str, Any]]:
    """One pass's batch through the MOUNTED route over the whole league, which every case reads.

    One request rather than one per address: a judgement mixing two addresses of one batch shows only in a batch.
    """

    async def _run() -> tuple[int, Mapping[str, Any]]:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
            await _seed(database)
            async with app_client(url, app=_served()) as http:
                response = await http.post(PATH, headers=SYSTEM_AUTH, json={"identifiers": ASKED})

            return response.status_code, response.json()

    return on_the_seed_loop(_run())


@pytest.mark.db
class TestWhatKeepsAnAccount:
    @pytest.mark.parametrize(
        "email",
        [
            pytest.param(SITZ_VERGANGEN, id="a past season's block not yet cleared"),
            pytest.param(SITZ_OFFEN, id="an unconfirmed seat on the running season, which the gate admits"),
            pytest.param(SITZ_AUSGETRETEN, id="a withdrawn team's seat"),
            pytest.param(BEWERBUNG_OFFEN, id="a pending application's confirmed seat"),
            pytest.param("Spieler.Ehemalig@Schule.DE", id="a retired pupil, asked in capitals"),
            pytest.param(SPIELER_OFFEN, id="an unconfirmed live pupil, which the gate admits"),
            pytest.param(PFEIFE_RUHESTAND, id="a retired referee"),
            pytest.param(REGISTRIERT, id="a confirmed pending registration"),
            pytest.param(VERWALTUNG, id="a grant the comparison has not seen"),
            pytest.param(GESPERRT, id="a standing ban"),
            pytest.param(UNBEURTEILBAR, id="an address no ban can be keyed under"),
        ],
    )
    def test_an_address_a_record_or_a_ban_holds_is_never_answered(self, mongo_replica_set_url: str, email: str):
        status, body = answered(mongo_replica_set_url)

        assert status == 200, body
        assert email not in body["unreferenziert"]


@pytest.mark.db
class TestTheAnswer:
    def test_the_rest_of_the_batch_is_answered_once_each_in_the_spelling_asked(self, mongo_replica_set_url: str):
        """The premise of every case above, which an empty answer would pass.

        The cleared block and the two placeholders each hold nothing, the placeholders by their ids alone.
        """

        assert answered(mongo_replica_set_url) == (
            200,
            {"acknowledged": 1, "unreferenziert": [GELEERT, NIEMAND, GEIST_SCHIEDSRICHTER, GEIST_SPIELER]},
        )
