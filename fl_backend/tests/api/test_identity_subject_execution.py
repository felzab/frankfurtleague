import asyncio
import functools
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from bson import ObjectId
from fastapi import FastAPI
from httpx2 import Response
from pymongo.asynchronous.database import AsyncDatabase

from app.api.identity.schemas import FLSignInResponse, FLSubjectPayload, FLSubjectResponse
from app.api.identity.system_router import get_sign_in, get_subject
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.main import create_app
from app.shared.schemas.literals import KONTAKT_ROLLEN
from tests.app_client import app_client
from tests.config import SYSTEM_AUTH
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import (
    SCHIEDSRICHTER_TEXT_VERSIONS,
    kontaktperson_document,
    own_einwilligung_document,
    rules_document,
    saison_document,
    saison_team_document,
    schiedsrichter_document,
    spieler_document,
    team_document,
)
from tests.plans import plans_of_sent_reads
from tests.records import record_collections
from tests.worker import worker_database

from .conftest import config_for

DATABASE_NAME = worker_database("fl_identity_subject_test")

PATH = f"/api/v{API_VERSION}/identity/subject"

# The folded form every record stores the address in. Deliberately unusual, so a hit in a seeded corpus cannot be a
# coincidence.
IDENTIFIER = "ortrud.zwiebelmayer@schule.de"

# Nobody this identifier may reach, in each of the three collections.
BYSTANDER = "baldur.krautzberger@example.com"

# A mailbox whose every record awaits its own person's confirmation, and one whose every record is
# confirmed on a row that has since been retired.
UNCONFIRMED = "ottilie.wartezeit@schule.de"
RETIRED = "rudolf.ruhestand@schule.de"
# Holding nothing, at the unconfirmed mailbox's local part: a read wider than the address takes that mailbox's records.
UNCONFIRMED_ELSEWHERE = UNCONFIRMED.replace("@schule.de", "@anderswo.de")

# A banned address holding a confirmed seat, banned in one spelling and asked in another, the seat
# stored folded; and an address whose ban ended with the season before the running one.
BARRED_STORED = "gerda.gesperrt@schule.de"
BARRED_BANNED = "Gerda.Gesperrt@Schule.de"
BARRED_ASKED = "GERDA.GESPERRT@schule.de"
EXPIRED = "arno.abgelaufen@schule.de"
BAN_ACTIVE_OID = ObjectId("6890a1b2c3d4e5f607820041")
BAN_LAPSED_OID = ObjectId("6890a1b2c3d4e5f607820042")

# The grants, stored folded as every grant is, and one asked in capitals.
ADMIN_OWNER = "inhaberin@frankfurtleague.de"
ADMIN_STORED = "verena.verwaltung@schule.de"
ADMIN_ASKED = "Verena.Verwaltung@SCHULE.de"
GRANT_OWNER_OID = ObjectId("6890a1b2c3d4e5f607820051")
GRANT_STORED_OID = ObjectId("6890a1b2c3d4e5f607820052")

# One mailbox at an internationalised domain, stored as every payload stores it:
# the domain in punycode.
IDN_STORED = "anna@xn--mller-kva.de"

PAST_SAISON = "2425"
ACTIVE_SAISON = "2526"
FUTURE_SAISON = "2627"

# Fixed rather than generated, so a failure names the same row every run. Ordered so the answer's
# own sort is asserted rather than reproduced: A before B before C.
TEAM_A_OID = ObjectId("6890a1b2c3d4e5f607820001")
TEAM_B_OID = ObjectId("6890a1b2c3d4e5f607820002")
TEAM_C_OID = ObjectId("6890a1b2c3d4e5f607820003")
SEAT_ROW_A_OID = ObjectId("6890a1b2c3d4e5f607820011")
SEAT_ROW_B_OID = ObjectId("6890a1b2c3d4e5f607820012")
BYSTANDER_ROW_OID = ObjectId("6890a1b2c3d4e5f607820013")
IDN_ROW_OID = ObjectId("6890a1b2c3d4e5f607820017")
PUPIL_ONE_OID = ObjectId("6890a1b2c3d4e5f607820021")
IDN_PUPIL_OID = ObjectId("6890a1b2c3d4e5f607820023")
BYSTANDER_PUPIL_OID = ObjectId("6890a1b2c3d4e5f607820029")
REFEREE_ONE_OID = ObjectId("6890a1b2c3d4e5f607820031")
REFEREE_TWO_OID = ObjectId("6890a1b2c3d4e5f607820032")
IDN_REFEREE_OID = ObjectId("6890a1b2c3d4e5f607820034")
UNCONFIRMED_REFEREE_OID = ObjectId("6890a1b2c3d4e5f607820035")
RETIRED_REFEREE_OID = ObjectId("6890a1b2c3d4e5f607820036")
BYSTANDER_REFEREE_OID = ObjectId("6890a1b2c3d4e5f607820039")

# The name the junction row was entered under, and the one the club has taken since. They differ so
# that serving the club's own would be observable.
ROW_NAME_A = "Helmholtz"
# Past every grant the seed dates.
NOW = datetime(2026, 6, 1, tzinfo=UTC)
CLUB_NAME_A_NOW = "Helmholtz-Gymnasium"
ROW_NAME_B = "Lessing"

STAMP = "2026-01-20"


def _person(email: str, *, confirmed_at: str | None = STAMP) -> dict[str, Any]:
    """Every field `app/api/teams/schemas.py :: FLKontaktperson` requires, the address and the stamp the only ones a case reads.

    Stamped by default: the lookup answers a seat only once its own person has confirmed it.
    """

    return kontaktperson_document("Anna", confirmed_at=confirmed_at, last_name="Müller", email=email, phone="+49 69 5550101")


def _junction(row_id: ObjectId, saison_id: str, team_id: ObjectId, *, name: str, **slots: str | dict[str, Any]) -> dict[str, Any]:
    """A `saison_teams` row seating whoever the caller names, an address as a confirmed seat, the slots it does not name left empty."""

    return saison_team_document(
        saison_id,
        team_id,
        name,
        name[:3].upper(),
        _id=row_id,
        kontakte={
            **{slot: None for slot in KONTAKT_ROLLEN},
            **{slot: _person(seat) if isinstance(seat, str) else seat for slot, seat in slots.items()},
            # A declaration about two slots rather than a slot of its own, so it names nobody and
            # no case here turns on it (`app/api/teams/schemas.py :: KONTAKT_ROLLEN`).
            "trainer_is_also": None,
        },
    )


def _saison(saison_id: str, status: str) -> dict[str, Any]:
    return saison_document(
        saison_id,
        status,
        start_date=f"20{saison_id[:2]}-08-01",
        end_date=f"20{saison_id[2:]}-06-30",
        rules=rules_document(allowed_stufen=["Q1", "Q2"]),
    )


def _club(team_id: ObjectId, name: str, shorthand: str) -> dict[str, Any]:
    # `shorthand` per club rather than one for all: `app/core/constraints.py :: uniq_shorthand`
    # indexes it, so a seed sharing one refuses its second club and fails every case here.
    return team_document(team_id, name, shorthand, website_url=None)


def _pupil(pupil_id: ObjectId, email: str) -> dict[str, Any]:
    """`email` stored in the folded form, which is what S6's admission writes and what the join compares."""

    return spieler_document(pupil_id, "Anna", "Müller", email=email)


def _referee(referee_id: ObjectId, email: str, name: str, **fields: Any) -> dict[str, Any]:
    # A name per referee for `_club`'s reason: `app/core/constraints.py :: uniq_schiedsrichter_name`
    # indexes it. Confirmed unless the caller says otherwise, as `_person` is.
    einwilligung = fields.pop("einwilligung", own_einwilligung_document(text_versions=SCHIEDSRICHTER_TEXT_VERSIONS, confirmed_at=STAMP))
    return schiedsrichter_document(referee_id, email=email, name=name, default_payment=20, einwilligung=einwilligung, **fields)


Body = Callable[[AsyncDatabase], Awaitable[Any]]


async def _seed(database: AsyncDatabase) -> None:
    """One corpus for every case: the mailbox in all three collections twice over, a bystander beside each, and the refused spellings.

    Beside them, one mailbox whose records are all unconfirmed and one whose rows are all retired.
    """

    await database[Collection.SAISONS].insert_many(
        [_saison(PAST_SAISON, "past"), _saison(ACTIVE_SAISON, "active"), _saison(FUTURE_SAISON, "future")]
    )
    await database[Collection.TEAMS].insert_many(
        [_club(TEAM_A_OID, CLUB_NAME_A_NOW, "HEX"), _club(TEAM_B_OID, ROW_NAME_B, "LEX"), _club(TEAM_C_OID, "Krautzberg", "KRX")]
    )
    await database[Collection.SAISON_TEAMS].insert_many(
        [
            _junction(SEAT_ROW_A_OID, PAST_SAISON, TEAM_A_OID, name=ROW_NAME_A, trainer=IDENTIFIER),
            # One address in TWO person slots of one row, which is what a person entered twice is.
            _junction(SEAT_ROW_B_OID, ACTIVE_SAISON, TEAM_B_OID, name=ROW_NAME_B, trainer=IDENTIFIER, ansprechperson=IDENTIFIER),
            _junction(
                BYSTANDER_ROW_OID,
                ACTIVE_SAISON,
                TEAM_C_OID,
                name="Krautzberg",
                trainer=BYSTANDER,
                ansprechperson=_person(UNCONFIRMED, confirmed_at=None),
                stellvertretung=BARRED_STORED,
            ),
            _junction(IDN_ROW_OID, PAST_SAISON, TEAM_C_OID, name="Krautzberg", trainer=IDN_STORED),
        ]
    )
    await database[Collection.SPIELER].insert_many(
        [
            _pupil(PUPIL_ONE_OID, IDENTIFIER),
            _pupil(IDN_PUPIL_OID, IDN_STORED),
            _pupil(BYSTANDER_PUPIL_OID, BYSTANDER),
        ]
    )
    await database[Collection.SCHIEDSRICHTER].insert_many(
        [
            _referee(REFEREE_ONE_OID, IDENTIFIER, "A. Referee"),
            _referee(REFEREE_TWO_OID, IDENTIFIER, "C. Zweitpfeife"),
            _referee(IDN_REFEREE_OID, IDN_STORED, "E. Umlaut"),
            _referee(BYSTANDER_REFEREE_OID, BYSTANDER, "B. Krautzberger"),
            _referee(UNCONFIRMED_REFEREE_OID, UNCONFIRMED, "F. Wartezeit", einwilligung=None),
            _referee(RETIRED_REFEREE_OID, RETIRED, "G. Ruhestand", inactive_since="2026-03-01"),
        ]
    )
    await database[Collection.GRANTS].insert_many(
        [_grant(GRANT_OWNER_OID, ADMIN_OWNER, "owner"), _grant(GRANT_STORED_OID, ADMIN_STORED, "administration")]
    )


GRANT_TYPED = datetime(2026, 1, 1, tzinfo=UTC)


def _grant(grant_id: ObjectId, address: str, admin_tier: str) -> dict[str, Any]:
    """A grant as the Playground or the grant route stores one: the folded identifier and its tier."""

    return {"_id": grant_id, "address": address, "admin_tier": admin_tier, "effective_from": GRANT_TYPED}


def on_a_league(url: str, body: Body) -> Any:
    """The shipped indexes, so a seeded row this read has to answer meets the constraints a real one meets."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
            await _seed(database)

            return await body(database)

    return on_the_seed_loop(_run())


async def _no_body(_: AsyncDatabase) -> None:
    """For a caller that wants the corpus and nothing else: the request below runs on a loop of its own."""

    return None


async def call_subject(database: AsyncDatabase, email: str) -> FLSubjectResponse:
    async with database.client.start_session(snapshot=True) as session:
        return await get_subject(
            subject_data=FLSubjectPayload(email=email),
            records=record_collections(database),
            grants_collection=database[Collection.GRANTS],
            session=session,
            germany_now=NOW,
        )


async def call_sign_in(database: AsyncDatabase, email: str) -> FLSignInResponse:
    async with database.client.start_session(snapshot=True) as session:
        return await get_sign_in(
            sign_in_data=FLSubjectPayload(email=email),
            records=record_collections(database),
            ban_list_collection=database[Collection.BAN_LIST],
            grants_collection=database[Collection.GRANTS],
            session=session,
            germany_now=NOW,
        )


def answered(url: str, email: str = IDENTIFIER) -> FLSubjectResponse:
    return on_a_league(url, lambda database: call_subject(database, email))


@pytest.mark.db
def test_an_address_the_league_holds_nothing_for_answers_three_empty_lists(mongo_replica_set_url: str):
    """A lookup answering everything it is asked would hand this mailbox records of others, which nobody it reaches would see."""

    answer = answered(mongo_replica_set_url, "niemand.hierverzeichnet@example.com")

    assert (answer.seats, answer.spieler, answer.schiedsrichter) == ([], [], [])


@pytest.mark.db
def test_an_address_sharing_only_a_local_part_with_unconfirmed_records_awaits_no_confirmation(mongo_replica_set_url: str):
    """The flag raised, the sign-in gate admits a mailbox the league holds nothing for."""

    answer = answered(mongo_replica_set_url, UNCONFIRMED_ELSEWHERE)

    assert (answer.unconfirmed, answer.seats, answer.spieler, answer.schiedsrichter) == (False, [], [], [])


@pytest.mark.db
def test_a_seat_carries_its_own_season_s_status(mongo_replica_set_url: str):
    """The one read of `saisons` a seat costs. Two seasons of differing status, so a status taken from whichever sorted first is wrong here."""

    assert [seat.saison_status for seat in answered(mongo_replica_set_url).seats] == ["past", "active", "active"]


@functools.cache
def _served() -> FastAPI:
    """One app for every case serving through it: building one costs more than the request a case sends through it.

    Built on first use rather than at import, which every xdist worker pays at collection.
    """

    return create_app(config_for(DATABASE_NAME))


def served_over_http(url: str, email: str = IDENTIFIER) -> Response:
    """The corpus seeded, then one request through the MOUNTED route."""

    on_a_league(url, _no_body)

    async def _answered() -> Response:
        async with app_client(url, app=_served()) as http:
            return await http.post(PATH, headers=SYSTEM_AUTH, json={"email": email})

    return asyncio.run(_answered())


@pytest.mark.db
def test_the_mounted_route_answers_a_retired_person_as_it_answers_nobody(mongo_replica_set_url: str):
    """A confirmed referee row, retired: empty lists and the flag down, as for a mailbox holding nothing."""

    response = served_over_http(mongo_replica_set_url, RETIRED)

    assert response.status_code == 200
    assert response.json() == {
        "seats": [],
        "spieler": [],
        "schiedsrichter": [],
        "unconfirmed": False,
        "admin_tier": None,
        "granted_since": None,
    }


# The two collections a public form grows that the gate reads by address on every sign-in attempt.
GATE_READS = frozenset(str(name) for name in (Collection.BEWERBUNGEN, Collection.REGISTRIERUNGEN))


def _selects_by_address(collection: str, command: Mapping[str, Any]) -> bool:
    """A read of a gate collection whose selection names an address, never a join by ids the same handler sends."""

    selection = command.get("filter") or next((stage["$match"] for stage in command.get("pipeline", []) if "$match" in stage), {})

    return collection in GATE_READS and "email" in str(selection)


@pytest.mark.db
class TestTheGateWalksAnIndex:
    """Anybody can send a sign-in attempt, and a stranger grows both collections through the public forms.

    Each read the handler sends is explained by the server: a filter losing its index answers the same over a scan, so
    only the plan shows it.
    """

    def test_every_address_read_of_the_gate_plans_an_index_scan(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> list[tuple[str, str]]:
            _, plans = await plans_of_sent_reads(
                mongo_replica_set_url, database, lambda watched, _client: call_sign_in(watched, IDENTIFIER), _selects_by_address
            )

            return plans

        plans = on_a_league(mongo_replica_set_url, body)

        # The premise: a read the handler never sent would pass the next line vacuously.
        assert {collection for collection, _ in plans} == GATE_READS, plans
        assert [(collection, plan) for collection, plan in plans if "IXSCAN" not in plan or "COLLSCAN" in plan] == []


@pytest.mark.db
class TestTheGrant:
    """`admin_tier`: the one stored answer, read off `grants` on the folded identifier."""

    def test_a_mailbox_holding_records_and_no_grant_is_answered_null(self, mongo_replica_set_url: str):
        """A lookup answering a tier for every address would hand this mailbox the administration."""

        answer = answered(mongo_replica_set_url)

        assert (answer.admin_tier, answer.granted_since) == (None, None)
        assert answer.seats

    def test_a_grant_is_answered_with_its_tier_and_the_day_it_took_effect(self, mongo_replica_set_url: str):
        answer = answered(mongo_replica_set_url, ADMIN_STORED)

        assert (answer.admin_tier, answer.granted_since) == ("administration", GRANT_TYPED)

    def test_a_waiting_row_answers_no_tier_on_either_route(self, mongo_replica_set_url: str):
        """A named person is no administrator until the wait ends, which the owner may yet stop: a tier here admits them early."""

        async def body(database: AsyncDatabase) -> tuple[Any, ...]:
            await database[Collection.GRANTS].update_one({"_id": GRANT_STORED_OID}, {"$set": {"effective_from": NOW + timedelta(hours=1)}})
            subject = await call_subject(database, ADMIN_STORED)
            sign_in = await call_sign_in(database, ADMIN_STORED)

            return subject.admin_tier, subject.granted_since, sign_in.admin_tier

        assert on_a_league(mongo_replica_set_url, body) == (None, None, None)

    def test_the_instant_is_served_with_its_offset(self, mongo_replica_set_url: str):
        """The driver reads a stored instant back with no offset, which the frontend would compare as its own local time."""

        response = served_over_http(mongo_replica_set_url, ADMIN_STORED)

        assert response.json()["granted_since"] == "2026-01-01T00:00:00Z"
