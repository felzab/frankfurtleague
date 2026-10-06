import asyncio
import functools
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime
from typing import Any

import pytest
from bson import ObjectId
from fastapi import FastAPI
from httpx2 import Response
from pymongo.asynchronous.database import AsyncDatabase

from app.api.identitaet import crud as identitaet_crud
from app.api.identitaet.crud import find_subjekt
from app.api.identitaet.router import get_anmeldung
from app.api.identitaet.schemas import FLAnmeldungResponse, FLSubjektPayload
from app.api.identitaet.services import eigene_eintraege
from app.api.registrierungen.services import compose_confirmation_update
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID
from app.main import create_app
from app.shared.folding import sign_in_identifier
from tests.app_client import app_client
from tests.bans import ban_list
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
from tests.records import record_collections
from tests.worker import worker_database

from .conftest import AUSTRITT, config_for

DATABASE_NAME = worker_database("fl_identitaet_anmeldung_test")

PATH = f"/api/v{API_VERSION}/identitaet/anmeldung"

PAST_SAISON = "2425"
ACTIVE_SAISON = "2526"
STAMP = "2026-01-20"

# One mailbox per case, each spelled so that a hit in the corpus cannot be a coincidence.
SITZ_AKTIV = "sitz.aktiv@schule.de"
SITZ_VERGANGEN = "sitz.vergangen@schule.de"
SITZ_AUSGETRETEN = "sitz.ausgetreten@schule.de"
SITZ_OFFEN = "sitz.offen@schule.de"
SITZ_AUSGETRETEN_OFFEN = "sitz.ausgetreten.offen@schule.de"
BEWERBUNG_OFFEN = "bewerbung.offen@schule.de"
BEWERBUNG_ENTSCHIEDEN = "bewerbung.entschieden@schule.de"
BEWERBUNG_UNBESTAETIGT = "bewerbung.unbestaetigt@schule.de"
SPIELER_AKTIV = "spieler.aktiv@schule.de"
SPIELER_EHEMALIG = "spieler.ehemalig@schule.de"
SPIELER_OFFEN = "spieler.offen@schule.de"
SPIELER_EHEMALIG_OFFEN = "spieler.ehemalig.offen@schule.de"
PFEIFE_AKTIV = "pfeife.aktiv@schule.de"
PFEIFE_RUHESTAND = "pfeife.ruhestand@schule.de"
PFEIFE_OFFEN = "pfeife.offen@schule.de"
PFEIFE_RUHESTAND_OFFEN = "pfeife.ruhestand.offen@schule.de"
GEIST = "geist@schule.de"
# A registration stored as its payload keeps an address, the local part's case as typed, and asked folded.
REGISTRIERT_STORED = "Rita.Registriert@Schule.de"
REGISTRIERT = "rita.registriert@schule.de"
REGISTRIERT_ABGELEHNT = "rita.abgelehnt@schule.de"
REGISTRIERT_OFFEN = "rita.offen@schule.de"
REGISTRIERT_OHNE_WAHL = "rita.ohnewahl@schule.de"
GESPERRT = "gerda.gesperrt@schule.de"
VERWALTUNG = "verena.verwaltung@schule.de"
NIEMAND = "niemand.hierverzeichnet@example.com"

TEAM_OIDS = [ObjectId(f"6890a1b2c3d4e5f6078600{n:02d}") for n in range(1, 8)]
SITZ_AKTIV_ROW = (TEAM_OIDS[0], ACTIVE_SAISON)
SITZ_VERGANGEN_ROW = (TEAM_OIDS[1], PAST_SAISON)
SITZ_AUSGETRETEN_ROW = (TEAM_OIDS[2], ACTIVE_SAISON)
BEWERBUNG_OFFEN_OID = ObjectId("6890a1b2c3d4e5f607860011")
BEWERBUNG_ENTSCHIEDEN_OID = ObjectId("6890a1b2c3d4e5f607860012")
BEWERBUNG_UNBESTAETIGT_OID = ObjectId("6890a1b2c3d4e5f607860013")
SPIELER_AKTIV_OID = ObjectId("6890a1b2c3d4e5f607860021")
SPIELER_EHEMALIG_OID = ObjectId("6890a1b2c3d4e5f607860022")
SPIELER_OFFEN_OID = ObjectId("6890a1b2c3d4e5f607860023")
SPIELER_EHEMALIG_OFFEN_OID = ObjectId("6890a1b2c3d4e5f607860024")
PFEIFE_AKTIV_OID = ObjectId("6890a1b2c3d4e5f607860031")
PFEIFE_RUHESTAND_OID = ObjectId("6890a1b2c3d4e5f607860032")
PFEIFE_OFFEN_OID = ObjectId("6890a1b2c3d4e5f607860033")
PFEIFE_RUHESTAND_OFFEN_OID = ObjectId("6890a1b2c3d4e5f607860034")
REGISTRIERUNG_OID = ObjectId("6890a1b2c3d4e5f607860041")
REGISTRIERUNG_ABGELEHNT_OID = ObjectId("6890a1b2c3d4e5f607860042")
REGISTRIERUNG_OFFEN_OID = ObjectId("6890a1b2c3d4e5f607860043")
REGISTRIERUNG_OHNE_WAHL_OID = ObjectId("6890a1b2c3d4e5f607860044")
GRANT_OID = ObjectId("6890a1b2c3d4e5f607860051")


def _seat(email: str, *, bestaetigt_am: str | None = STAMP) -> dict[str, Any]:
    return kontaktperson_document("Anna", bestaetigt_am=bestaetigt_am, email=email)


def _kontakte(**seats: Any) -> dict[str, Any]:
    return kontakte_document(**seats)


def _row(team_id: ObjectId, saison_id: str, shorthand: str, *, austritt: Mapping[str, Any] | None = None, **seats: Any) -> dict[str, Any]:
    return saison_team_document(saison_id, team_id, f"Schule {shorthand}", shorthand, austritt=austritt, kontakte=_kontakte(**seats))


def _bewerbung(oid: ObjectId, *, status: str, trainer: Mapping[str, Any]) -> dict[str, Any]:
    """An application naming a new school, as the submission stores one."""

    return bewerbung_document(
        oid,
        ACTIVE_SAISON,
        status,
        kontakte=_kontakte(trainer=dict(trainer)),
        eingereicht_am="2026-01-01",
        bestaetigungsfrist="2026-01-15",
        schule=neue_schule_document(f"Bewerberschule {oid}", str(oid)[-4:]),
    )


def _referee(oid: Any, email: str, name: str, **fields: Any) -> dict[str, Any]:
    return schiedsrichter_document(
        oid, email=email, name=name, default_payment=20, **{"einwilligung": {**EINWILLIGUNG, "bestaetigt_am": STAMP}, **fields}
    )


def _registrierung(oid: ObjectId, email: str, *, confirmed: bool = True, **fields: Any) -> dict[str, Any]:
    """A registration as the submission and, where `confirmed`, the pupil's own confirmation leave it."""

    return registrierung_document(
        oid,
        email,
        saison_id=ACTIVE_SAISON,
        team_id=TEAM_OIDS[0],
        vorname="Rita",
        nachname="Registriert",
        token=str(oid),
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
        **fields,
    )


async def _seed(database: AsyncDatabase) -> None:
    await database[Collection.SAISONS].insert_many([saison_document(PAST_SAISON, "past"), saison_document(ACTIVE_SAISON, "active")])
    await database[Collection.SAISON_TEAMS].insert_many(
        [
            _row(*SITZ_AKTIV_ROW, "SA", trainer=_seat(SITZ_AKTIV), ansprechperson=_seat(GESPERRT)),
            _row(*SITZ_VERGANGEN_ROW, "SV", trainer=_seat(SITZ_VERGANGEN)),
            _row(
                *SITZ_AUSGETRETEN_ROW,
                "SW",
                austritt=dict(AUSTRITT),
                trainer=_seat(SITZ_AUSGETRETEN),
                ansprechperson=_seat(SITZ_AUSGETRETEN_OFFEN, bestaetigt_am=None),
            ),
            _row(TEAM_OIDS[3], ACTIVE_SAISON, "SO", trainer=_seat(SITZ_OFFEN, bestaetigt_am=None)),
        ]
    )
    await database[Collection.BEWERBUNGEN].insert_many(
        [
            _bewerbung(BEWERBUNG_OFFEN_OID, status="eingereicht", trainer=_seat(BEWERBUNG_OFFEN)),
            _bewerbung(BEWERBUNG_ENTSCHIEDEN_OID, status="abgelehnt", trainer=_seat(BEWERBUNG_ENTSCHIEDEN)),
            _bewerbung(BEWERBUNG_UNBESTAETIGT_OID, status="eingereicht", trainer=_seat(BEWERBUNG_UNBESTAETIGT, bestaetigt_am=None)),
        ]
    )
    await database[Collection.SPIELER].insert_many(
        [
            spieler_document(SPIELER_AKTIV_OID, "Anna", "Aktiv", email=SPIELER_AKTIV),
            spieler_document(SPIELER_EHEMALIG_OID, "Anna", "Ehemalig", email=SPIELER_EHEMALIG, inactive_since="2026-03-01"),
            spieler_document(SPIELER_OFFEN_OID, "Anna", "Offen", email=SPIELER_OFFEN, einwilligung={**EINWILLIGUNG, "bestaetigt_am": None}),
            spieler_document(
                SPIELER_EHEMALIG_OFFEN_OID,
                "Anna",
                "Ehemalig-Offen",
                email=SPIELER_EHEMALIG_OFFEN,
                inactive_since="2026-03-01",
                einwilligung={**EINWILLIGUNG, "bestaetigt_am": None},
            ),
        ]
    )
    await database[Collection.SCHIEDSRICHTER].insert_many(
        [
            _referee(PFEIFE_AKTIV_OID, PFEIFE_AKTIV, "A. Aktiv"),
            _referee(PFEIFE_RUHESTAND_OID, PFEIFE_RUHESTAND, "B. Ruhestand", inactive_since="2026-03-01"),
            _referee(PFEIFE_OFFEN_OID, PFEIFE_OFFEN, "C. Offen", einwilligung=None),
            _referee(PFEIFE_RUHESTAND_OFFEN_OID, PFEIFE_RUHESTAND_OFFEN, "E. Ruhestand-Offen", inactive_since="2026-03-01", einwilligung=None),
            # The ghost as no write leaves it: an address, a stamp, not retired, so its id alone keeps it out.
            _referee(GHOST_SCHIEDSRICHTER_ID, GEIST, "D. Geist"),
        ]
    )
    await database[Collection.REGISTRIERUNGEN].insert_many(
        [
            _registrierung(REGISTRIERUNG_OID, REGISTRIERT_STORED),
            _registrierung(REGISTRIERUNG_ABGELEHNT_OID, REGISTRIERT_ABGELEHNT, status="abgelehnt"),
            _registrierung(REGISTRIERUNG_OFFEN_OID, REGISTRIERT_OFFEN, confirmed=False),
        ]
    )
    await database[Collection.REGISTRIERUNGEN].insert_one(
        _registrierung(
            REGISTRIERUNG_OHNE_WAHL_OID,
            REGISTRIERT_OHNE_WAHL,
            confirmed=False,
            **compose_confirmation_update(
                geburtsdatum="2009-05-04", umfang=None, medien=None, text_version="2026-09", today="2026-01-03", am="2026-01-03T08:00:00+00:00"
            )["$set"],
        )
    )
    await database[Collection.SPERRLISTE].insert_one(ban_document(GESPERRT, bis=ACTIVE_SAISON))
    granted = datetime(2026, 1, 1, tzinfo=UTC)
    await database[Collection.BERECHTIGUNGEN].insert_one(
        {"_id": GRANT_OID, "adresse": VERWALTUNG, "verwaltung": "administration", "erteilt_von": "PLAYGROUND", "erteilt_am": granted}
    )
    await database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT].insert_one(
        {"_id": GRANT_OID, "adresse": VERWALTUNG, "verwaltung": "administration", "angekuendigt_am": granted}
    )


Body = Callable[[AsyncDatabase], Awaitable[Any]]


def on_a_league(url: str, body: Body) -> Any:
    """The REAL validators, so every seeded row is one the shipped schema admits."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
            await _seed(database)

            return await body(database)

    return on_the_seed_loop(_run())


async def call_anmeldung(database: AsyncDatabase, email: str) -> FLAnmeldungResponse:
    return await get_anmeldung(
        anmeldung_data=FLSubjektPayload(email=email),
        records=record_collections(database),
        sperrliste=ban_list(database),
        berechtigungen_collection=database[Collection.BERECHTIGUNGEN],
    )


def answered(url: str, email: str) -> FLAnmeldungResponse:
    return on_a_league(url, lambda database: call_anmeldung(database, email))


def own_records(url: str, email: str) -> frozenset[tuple[str, Any]]:
    async def body(database: AsyncDatabase) -> frozenset[tuple[str, Any]]:
        _, eintraege = await identitaet_crud.find_eigene_eintraege(sign_in_identifier(email), record_collections(database))

        return eintraege

    return on_a_league(url, body)


@pytest.mark.db
class TestWhatCountsAsAnOwnRecord:
    """`konto` per kind and state, one mailbox each, so a kind dropped from the gate fails its own case."""

    @pytest.mark.parametrize(
        ("email", "eintrag"),
        [
            pytest.param(SITZ_AKTIV, ("sitze", SITZ_AKTIV_ROW), id="a seat on the running season"),
            pytest.param(SITZ_VERGANGEN, ("sitze", SITZ_VERGANGEN_ROW), id="a past season's seat"),
            pytest.param(SITZ_AUSGETRETEN, ("sitze", SITZ_AUSGETRETEN_ROW), id="a withdrawn team's seat"),
            pytest.param(BEWERBUNG_OFFEN, ("bewerbungen", BEWERBUNG_OFFEN_OID), id="a seat on a pending application"),
            pytest.param(SPIELER_AKTIV, ("spieler", SPIELER_AKTIV_OID), id="a live pupil"),
            pytest.param(SPIELER_EHEMALIG, ("spieler", SPIELER_EHEMALIG_OID), id="a retired pupil"),
            pytest.param(PFEIFE_AKTIV, ("schiedsrichter", PFEIFE_AKTIV_OID), id="a live referee"),
            pytest.param(PFEIFE_RUHESTAND, ("schiedsrichter", PFEIFE_RUHESTAND_OID), id="a retired referee"),
            pytest.param(REGISTRIERT, ("registrierungen", REGISTRIERUNG_OID), id="a registration confirmed with a choice"),
            pytest.param(
                REGISTRIERT_OHNE_WAHL, ("registrierungen", REGISTRIERUNG_OHNE_WAHL_OID), id="a returning pupil's registration, asking no choice"
            ),
        ],
    )
    def test_a_confirmed_record_is_the_mailbox_s_own_and_admits_it(self, mongo_replica_set_url: str, email: str, eintrag: tuple[str, Any]):
        """The whole set, so a case naming the right record beside a wrong one fails too."""

        assert own_records(mongo_replica_set_url, email) == {eintrag}
        assert answered(mongo_replica_set_url, email).konto is True

    @pytest.mark.parametrize(
        "email",
        [
            pytest.param(SITZ_OFFEN, id="an unconfirmed seat"),
            pytest.param(BEWERBUNG_ENTSCHIEDEN, id="a seat on a decided application"),
            pytest.param(BEWERBUNG_UNBESTAETIGT, id="an unconfirmed seat on a pending application"),
            pytest.param(SPIELER_OFFEN, id="an unconfirmed pupil"),
            pytest.param(PFEIFE_OFFEN, id="an unconfirmed referee"),
            pytest.param(SPIELER_EHEMALIG_OFFEN, id="an unconfirmed retired pupil"),
            pytest.param(PFEIFE_RUHESTAND_OFFEN, id="an unconfirmed retired referee"),
            pytest.param(SITZ_AUSGETRETEN_OFFEN, id="an unconfirmed seat on a withdrawn team's row"),
            pytest.param(GEIST, id="the placeholder referee"),
            pytest.param(REGISTRIERT_ABGELEHNT, id="a declined registration"),
            pytest.param(REGISTRIERT_OFFEN, id="an unconfirmed registration"),
            pytest.param(NIEMAND, id="nothing at all"),
        ],
    )
    def test_a_record_holding_no_consent_of_its_own_person_admits_nothing(self, mongo_replica_set_url: str, email: str):
        assert own_records(mongo_replica_set_url, email) == frozenset()
        assert answered(mongo_replica_set_url, email).konto is False


@pytest.mark.db
class TestTheFlagsBesideIt:
    def test_records_awaiting_confirmation_raise_the_subject_s_flag_and_admit_nothing_else(self, mongo_replica_set_url: str):
        """The flag is `POST /identitaet/subjekt`'s own; only the records granting a panel raise it."""

        assert [(answered(mongo_replica_set_url, email).unbestaetigt) for email in (SITZ_OFFEN, SPIELER_OFFEN, BEWERBUNG_UNBESTAETIGT)] == [
            True,
            True,
            False,
        ]

    def test_a_barred_address_is_flagged_and_still_counted(self, mongo_replica_set_url: str):
        """The ban narrows nothing beside it: refusing the barred holder is the gate's own decision."""

        answer = answered(mongo_replica_set_url, GESPERRT)

        assert (answer.gesperrt, answer.konto) == (True, True)

    def test_a_grant_is_answered_beside_records_it_does_not_need(self, mongo_replica_set_url: str):
        answer = answered(mongo_replica_set_url, VERWALTUNG)

        assert (answer.verwaltung, answer.konto, answer.gesperrt) == ("administration", False, False)


def test_every_funktion_list_is_drawn_from_the_own_records(monkeypatch: pytest.MonkeyPatch):
    """Rows the reads answer with, judged without a database: an unconfirmed seat, a retired pupil and a withdrawn row among them.

    Kills a Funktion list built from the rows the pre-filter matched rather than from the own records.
    """

    identifier = "ortrud.zwiebelmayer@schule.de"
    team_id = ObjectId("6890a1b2c3d4e5f607860061")
    rows: dict[str, list[Mapping[str, Any]]] = {
        "saison_teams": [
            {
                "_id": ObjectId(),
                "saison_id": ACTIVE_SAISON,
                "team_id": team_id,
                "name": "Helmholtz",
                "austritt": None,
                "kontakte": {
                    "trainer": {"email": identifier, "einwilligung": {"bestaetigt_am": STAMP}},
                    "ansprechperson": {"email": identifier.upper(), "einwilligung": {"bestaetigt_am": None}},
                },
            }
        ],
        "spieler": [{"_id": ObjectId(), "inactive_since": None, "einwilligung": {"bestaetigt_am": STAMP}}],
        "schiedsrichter": [{"_id": ObjectId(), "inactive_since": None, "kontakt": {"email": identifier}, "einwilligung": None}],
        "saisons": [{"_id": ACTIVE_SAISON, "status": "active"}],
    }

    async def aggregate_many_from_db(*, collection: str, pipeline: Any, session: object = None) -> list[Mapping[str, Any]]:
        return rows.get(collection, [])

    monkeypatch.setattr(identitaet_crud, "aggregate_many_from_db", aggregate_many_from_db)
    records = record_collections(
        {Collection(name): name for name in ("saison_teams", "saisons", "spieler", "schiedsrichter", "bewerbungen", "registrierungen")}
    )

    subjekt = asyncio.run(find_subjekt(identifier, records))
    eintraege = eigene_eintraege(
        identifier,
        seat_rows=rows["saison_teams"],
        referee_rows=rows["schiedsrichter"],
        pupil_rows=rows["spieler"],
        bewerbung_rows=[],
        registrierung_rows=[],
    )

    assert [sitz.rolle for sitz in subjekt.sitze] == ["trainer"]
    assert {("sitze", (sitz.team_id, sitz.saison_id)) for sitz in subjekt.sitze} | {
        ("spieler", e.spieler_id) for e in subjekt.spieler
    } <= eintraege
    assert subjekt.schiedsrichter == []


@functools.cache
def _served() -> FastAPI:
    return create_app(config_for(DATABASE_NAME))


@pytest.mark.db
def test_the_mounted_route_answers_the_four_flags_and_nothing_else(mongo_replica_set_url: str):
    """The whole body through the mounted route: a lookup bound to the wrong handle answers a flag false, which no keyword call can tell."""

    async def _no_body(_: AsyncDatabase) -> None:
        return None

    on_a_league(mongo_replica_set_url, _no_body)

    async def _answered() -> Response:
        async with app_client(mongo_replica_set_url, app=_served()) as http:
            return await http.post(PATH, headers=SYSTEM_AUTH, json={"email": REGISTRIERT_STORED.upper()})

    response = asyncio.run(_answered())

    assert response.status_code == 200
    assert response.json() == {"acknowledged": 1, "unbestaetigt": False, "konto": True, "gesperrt": False, "verwaltung": None}
