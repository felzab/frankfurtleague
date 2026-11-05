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

from app.api.identity import crud as identity_crud
from app.api.identity.crud import roles_from
from app.api.identity.schemas import FLSignInResponse, FLSubjectPayload
from app.api.identity.services import own_entries, seat_saison_statuses
from app.api.identity.system_router import get_sign_in
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
from tests.records import record_collections
from tests.worker import worker_database

from .conftest import AUSTRITT, config_for

DATABASE_NAME = worker_database("fl_identity_sign_in_test")

PATH = f"/api/v{API_VERSION}/identity/sign_in"

PAST_SAISON = "2425"
ACTIVE_SAISON = "2526"
STAMP = "2026-01-20"

# One mailbox per case, each spelled so that a hit in the corpus cannot be a coincidence.
SEAT_ACTIVE = "sitz.aktiv@schule.de"
SEAT_PAST = "sitz.vergangen@schule.de"
SEAT_EXITED = "sitz.ausgetreten@schule.de"
SEAT_OPEN = "sitz.offen@schule.de"
SEAT_EXITED_OPEN = "sitz.ausgetreten.offen@schule.de"
BEWERBUNG_OPEN = "bewerbung.offen@schule.de"
BEWERBUNG_DECIDED = "bewerbung.entschieden@schule.de"
BEWERBUNG_UNCONFIRMED = "bewerbung.unbestaetigt@schule.de"
SPIELER_ACTIVE = "spieler.aktiv@schule.de"
SPIELER_FORMER = "spieler.ehemalig@schule.de"
SCHIEDSRICHTER_ACTIVE = "pfeife.aktiv@schule.de"
SCHIEDSRICHTER_RETIRED = "pfeife.ruhestand@schule.de"
SCHIEDSRICHTER_OPEN = "pfeife.offen@schule.de"
SCHIEDSRICHTER_RETIRED_OPEN = "pfeife.ruhestand.offen@schule.de"
GHOST = "geist@schule.de"
# A registration stored as every payload stores an address, folded, and asked in another spelling.
REGISTERED = "rita.registriert@schule.de"
REGISTERED_STORED = REGISTERED
REGISTERED_DECLINED = "rita.abgelehnt@schule.de"
REGISTERED_OPEN = "rita.offen@schule.de"
REGISTERED_WITHOUT_CHOICE = "rita.ohnewahl@schule.de"
BARRED = "gerda.gesperrt@schule.de"
ADMIN = "verena.verwaltung@schule.de"
NOBODY = "niemand.hierverzeichnet@example.com"

TEAM_OIDS = [ObjectId(f"6890a1b2c3d4e5f6078600{n:02d}") for n in range(1, 8)]
SEAT_ACTIVE_ROW = (TEAM_OIDS[0], ACTIVE_SAISON)
SEAT_PAST_ROW = (TEAM_OIDS[1], PAST_SAISON)
SEAT_EXITED_ROW = (TEAM_OIDS[2], ACTIVE_SAISON)
BEWERBUNG_OPEN_OID = ObjectId("6890a1b2c3d4e5f607860011")
BEWERBUNG_DECIDED_OID = ObjectId("6890a1b2c3d4e5f607860012")
BEWERBUNG_UNCONFIRMED_OID = ObjectId("6890a1b2c3d4e5f607860013")
SPIELER_ACTIVE_OID = ObjectId("6890a1b2c3d4e5f607860021")
SPIELER_FORMER_OID = ObjectId("6890a1b2c3d4e5f607860022")
SCHIEDSRICHTER_ACTIVE_OID = ObjectId("6890a1b2c3d4e5f607860031")
SCHIEDSRICHTER_RETIRED_OID = ObjectId("6890a1b2c3d4e5f607860032")
SCHIEDSRICHTER_OPEN_OID = ObjectId("6890a1b2c3d4e5f607860033")
SCHIEDSRICHTER_RETIRED_OPEN_OID = ObjectId("6890a1b2c3d4e5f607860034")
REGISTRIERUNG_OID = ObjectId("6890a1b2c3d4e5f607860041")
REGISTRIERUNG_DECLINED_OID = ObjectId("6890a1b2c3d4e5f607860042")
REGISTRIERUNG_OPEN_OID = ObjectId("6890a1b2c3d4e5f607860043")
REGISTRIERUNG_WITHOUT_CHOICE_OID = ObjectId("6890a1b2c3d4e5f607860044")
GRANT_OID = ObjectId("6890a1b2c3d4e5f607860051")


def _seat(email: str, *, confirmed_at: str | None = STAMP) -> dict[str, Any]:
    return kontaktperson_document("Anna", confirmed_at=confirmed_at, email=email)


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
        submitted_at="2026-01-01",
        confirmation_deadline="2026-01-15",
        schule=new_schule_document(f"Bewerberschule {oid}", str(oid)[-4:]),
    )


def _referee(oid: Any, email: str, name: str, **fields: Any) -> dict[str, Any]:
    return schiedsrichter_document(
        oid, email=email, name=name, default_payment=20, **{"einwilligung": {**EINWILLIGUNG, "confirmed_at": STAMP}, **fields}
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
        submitted_at="2026-01-02",
        frist="2026-01-09",
        position="Mittelfeld",
        nummer="17",
        stufe="Q1",
        confirmed=None
        if not confirmed
        else {
            "geburtsdatum": "2009-05-04",
            "scope": "intern",
            "media": False,
            "text_versions": SPIELER_TEXT_VERSIONS,
            "today": "2026-01-03",
            "at": "2026-01-03T08:00:00+00:00",
        },
        **fields,
    )


async def _seed(database: AsyncDatabase) -> None:
    await database[Collection.SAISONS].insert_many([saison_document(PAST_SAISON, "past"), saison_document(ACTIVE_SAISON, "active")])
    await database[Collection.SAISON_TEAMS].insert_many(
        [
            _row(*SEAT_ACTIVE_ROW, "SAX", trainer=_seat(SEAT_ACTIVE), ansprechperson=_seat(BARRED)),
            _row(*SEAT_PAST_ROW, "SVX", trainer=_seat(SEAT_PAST)),
            _row(
                *SEAT_EXITED_ROW,
                "SWX",
                austritt=dict(AUSTRITT),
                trainer=_seat(SEAT_EXITED),
                ansprechperson=_seat(SEAT_EXITED_OPEN, confirmed_at=None),
            ),
            _row(TEAM_OIDS[3], ACTIVE_SAISON, "SOX", trainer=_seat(SEAT_OPEN, confirmed_at=None)),
        ]
    )
    await database[Collection.BEWERBUNGEN].insert_many(
        [
            _bewerbung(BEWERBUNG_OPEN_OID, status="submitted", trainer=_seat(BEWERBUNG_OPEN)),
            _bewerbung(BEWERBUNG_DECIDED_OID, status="declined", trainer=_seat(BEWERBUNG_DECIDED)),
            _bewerbung(BEWERBUNG_UNCONFIRMED_OID, status="submitted", trainer=_seat(BEWERBUNG_UNCONFIRMED, confirmed_at=None)),
        ]
    )
    await database[Collection.SPIELER].insert_many(
        [
            spieler_document(SPIELER_ACTIVE_OID, "Anna", "Aktiv", email=SPIELER_ACTIVE),
            spieler_document(SPIELER_FORMER_OID, "Anna", "Ehemalig", email=SPIELER_FORMER, inactive_since="2026-03-01"),
        ]
    )
    await database[Collection.SCHIEDSRICHTER].insert_many(
        [
            _referee(SCHIEDSRICHTER_ACTIVE_OID, SCHIEDSRICHTER_ACTIVE, "A. Aktiv"),
            _referee(SCHIEDSRICHTER_RETIRED_OID, SCHIEDSRICHTER_RETIRED, "B. Ruhestand", inactive_since="2026-03-01"),
            _referee(SCHIEDSRICHTER_OPEN_OID, SCHIEDSRICHTER_OPEN, "C. Offen", einwilligung=None),
            _referee(
                SCHIEDSRICHTER_RETIRED_OPEN_OID,
                SCHIEDSRICHTER_RETIRED_OPEN,
                "E. Ruhestand-Offen",
                inactive_since="2026-03-01",
                einwilligung=None,
            ),
            # The ghost as no write leaves it: an address, a stamp, not retired, so its id alone keeps it out.
            _referee(GHOST_SCHIEDSRICHTER_ID, GHOST, "D. Geist"),
        ]
    )
    await database[Collection.REGISTRIERUNGEN].insert_many(
        [
            _registrierung(REGISTRIERUNG_OID, REGISTERED_STORED),
            _registrierung(REGISTRIERUNG_DECLINED_OID, REGISTERED_DECLINED, status="declined"),
            _registrierung(REGISTRIERUNG_OPEN_OID, REGISTERED_OPEN, confirmed=False),
        ]
    )
    await database[Collection.REGISTRIERUNGEN].insert_one(
        _registrierung(
            REGISTRIERUNG_WITHOUT_CHOICE_OID,
            REGISTERED_WITHOUT_CHOICE,
            confirmed=False,
            **compose_confirmation_update(
                geburtsdatum="2009-05-04", scope=None, media=None, text_versions=None, today="2026-01-03", at="2026-01-03T08:00:00+00:00"
            )["$set"],
        )
    )
    await database[Collection.BAN_LIST].insert_one(ban_document(BARRED, until=ACTIVE_SAISON))
    granted = datetime(2026, 1, 1, tzinfo=UTC)
    await database[Collection.GRANTS].insert_one(
        {"_id": GRANT_OID, "address": ADMIN, "admin_tier": "administration", "granted_by": "PLAYGROUND", "granted_at": granted}
    )
    await database[Collection.GRANTS_ANNOUNCED].insert_one(
        {"_id": GRANT_OID, "address": ADMIN, "admin_tier": "administration", "announced_at": granted}
    )


Body = Callable[[AsyncDatabase], Awaitable[Any]]


def on_a_league(url: str, body: Body) -> Any:
    """The shipped indexes, so every seeded row meets the constraints a real one meets."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
            await _seed(database)

            return await body(database)

    return on_the_seed_loop(_run())


async def call_sign_in(database: AsyncDatabase, email: str) -> FLSignInResponse:
    async with database.client.start_session(snapshot=True) as session:
        return await get_sign_in(
            sign_in_data=FLSubjectPayload(email=email),
            records=record_collections(database),
            ban_list=ban_list(database),
            grants_collection=database[Collection.GRANTS],
            session=session,
        )


def answered(url: str, email: str) -> FLSignInResponse:
    return on_a_league(url, lambda database: call_sign_in(database, email))


def own_records(url: str, email: str) -> frozenset[tuple[str, Any]]:
    async def body(database: AsyncDatabase) -> frozenset[tuple[str, Any]]:
        _, entries = await identity_crud.find_own_entries(sign_in_identifier(email), record_collections(database))

        return entries

    return on_a_league(url, body)


@pytest.mark.db
class TestWhatCountsAsAnOwnRecord:
    """`account` per kind and state, one mailbox each, so a kind dropped from the gate fails its own case."""

    @pytest.mark.parametrize(
        ("email", "entry"),
        [
            pytest.param(SEAT_ACTIVE, ("seats", SEAT_ACTIVE_ROW), id="a seat on the running season"),
            pytest.param(SEAT_PAST, ("seats", SEAT_PAST_ROW), id="a past season's seat"),
            pytest.param(SEAT_EXITED, ("seats", SEAT_EXITED_ROW), id="a withdrawn team's seat"),
            pytest.param(BEWERBUNG_OPEN, ("bewerbungen", BEWERBUNG_OPEN_OID), id="a seat on a pending application"),
            pytest.param(SPIELER_ACTIVE, ("spieler", SPIELER_ACTIVE_OID), id="a live pupil"),
            pytest.param(SPIELER_FORMER, ("spieler", SPIELER_FORMER_OID), id="a retired pupil"),
            pytest.param(SCHIEDSRICHTER_ACTIVE, ("schiedsrichter", SCHIEDSRICHTER_ACTIVE_OID), id="a live referee"),
            pytest.param(SCHIEDSRICHTER_RETIRED, ("schiedsrichter", SCHIEDSRICHTER_RETIRED_OID), id="a retired referee"),
            pytest.param(REGISTERED, ("registrierungen", REGISTRIERUNG_OID), id="a registration confirmed with a choice"),
            pytest.param(
                REGISTERED_WITHOUT_CHOICE,
                ("registrierungen", REGISTRIERUNG_WITHOUT_CHOICE_OID),
                id="a returning pupil's registration, asking no choice",
            ),
        ],
    )
    def test_a_confirmed_record_is_the_mailbox_s_own_and_admits_it(self, mongo_replica_set_url: str, email: str, entry: tuple[str, Any]):
        """The whole set, so a case naming the right record beside a wrong one fails too."""

        assert own_records(mongo_replica_set_url, email) == {entry}
        assert answered(mongo_replica_set_url, email).account is True

    @pytest.mark.parametrize(
        "email",
        [
            pytest.param(SEAT_OPEN, id="an unconfirmed seat"),
            pytest.param(BEWERBUNG_DECIDED, id="a seat on a decided application"),
            pytest.param(BEWERBUNG_UNCONFIRMED, id="an unconfirmed seat on a pending application"),
            pytest.param(SCHIEDSRICHTER_OPEN, id="an unconfirmed referee"),
            pytest.param(SCHIEDSRICHTER_RETIRED_OPEN, id="an unconfirmed retired referee"),
            pytest.param(SCHIEDSRICHTER_ACTIVE.replace("@schule.de", "@anderswo.de"), id="a confirmed referee's local part at another domain"),
            pytest.param(SEAT_EXITED_OPEN, id="an unconfirmed seat on a withdrawn team's row"),
            pytest.param(GHOST, id="the placeholder referee"),
            pytest.param(REGISTERED_DECLINED, id="a declined registration"),
            pytest.param(REGISTERED_OPEN, id="an unconfirmed registration"),
            pytest.param(NOBODY, id="nothing at all"),
        ],
    )
    def test_a_record_holding_no_consent_of_its_own_person_admits_nothing(self, mongo_replica_set_url: str, email: str):
        assert own_records(mongo_replica_set_url, email) == frozenset()
        assert answered(mongo_replica_set_url, email).account is False


@pytest.mark.db
class TestTheFlagsBesideIt:
    def test_records_awaiting_confirmation_raise_the_subject_s_flag_and_admit_nothing_else(self, mongo_replica_set_url: str):
        """The flag is `POST /identity/subject`'s own; only the records granting a panel raise it."""

        assert [(answered(mongo_replica_set_url, email).unconfirmed) for email in (SEAT_OPEN, BEWERBUNG_UNCONFIRMED)] == [
            True,
            False,
        ]

    def test_an_address_sharing_only_a_local_part_with_an_unconfirmed_referee_awaits_nothing(self, mongo_replica_set_url: str):
        """The address pre-filter reads that referee's row, and only the fold after the read keeps the flag down and the gate shut."""

        answer = answered(mongo_replica_set_url, SCHIEDSRICHTER_OPEN.replace("@schule.de", "@anderswo.de"))

        assert (answer.unconfirmed, answer.account) == (False, False)

    def test_a_barred_address_is_flagged_and_still_counted(self, mongo_replica_set_url: str):
        """The ban narrows nothing beside it: refusing the barred holder is the gate's own decision."""

        answer = answered(mongo_replica_set_url, BARRED)

        assert (answer.barred, answer.account) == (True, True)

    def test_a_grant_is_answered_beside_records_it_does_not_need(self, mongo_replica_set_url: str):
        answer = answered(mongo_replica_set_url, ADMIN)

        assert (answer.admin_tier, answer.account, answer.barred) == ("administration", False, False)


def test_a_seat_whose_season_has_no_row_is_raised_rather_than_dropped():
    """A silently shorter list is a person shown no panel at all; the control reads a joined season's status."""

    assert seat_saison_statuses([{"saison_id": ACTIVE_SAISON, "saison": [{"status": "active"}]}]) == {ACTIVE_SAISON: "active"}
    with pytest.raises(RuntimeError):
        seat_saison_statuses([{"saison_id": ACTIVE_SAISON, "saison": []}])


def test_every_role_list_is_drawn_from_the_own_records():
    """One row seating the mailbox confirmed and again unconfirmed in another spelling, and an unconfirmed referee row.

    Kills a Funktion list built from the rows the pre-filter matched rather than from the own records. Both judgements
    are pure over the rows the subject's reads hand them, so the rows are given as those reads leave them.
    """

    identifier = "ortrud.zwiebelmayer@schule.de"
    seat_rows: list[Mapping[str, Any]] = [
        {
            **_row(TEAM_OIDS[4], ACTIVE_SAISON, "OZX", trainer=_seat(identifier), ansprechperson=_seat(identifier.upper(), confirmed_at=None)),
            # As `app/api/identity/services.py :: saison_status_lookup` joins the row's season.
            "saison": [{"status": "active"}],
        }
    ]
    referee_rows: list[Mapping[str, Any]] = [_referee(ObjectId(), identifier, "O. Zwiebelmayer", einwilligung=None)]
    pupil_rows: list[Mapping[str, Any]] = [spieler_document(ObjectId(), "Ortrud", "Zwiebelmayer", email=identifier)]

    subject = roles_from(identifier, seat_rows=seat_rows, referee_rows=referee_rows, pupil_rows=pupil_rows)
    entries = own_entries(
        identifier, seat_rows=seat_rows, referee_rows=referee_rows, pupil_rows=pupil_rows, bewerbung_rows=[], registrierung_rows=[]
    )

    assert [seat.rolle for seat in subject.seats] == ["trainer"]
    assert {("seats", (seat.team_id, seat.saison_id)) for seat in subject.seats} | {
        ("spieler", e.spieler_id) for e in subject.spieler
    } <= entries
    assert subject.schiedsrichter == []


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
            return await http.post(PATH, headers=SYSTEM_AUTH, json={"email": REGISTERED_STORED.upper()})

    response = asyncio.run(_answered())

    assert response.status_code == 200
    assert response.json() == {"unconfirmed": False, "account": True, "barred": False, "admin_tier": None}
