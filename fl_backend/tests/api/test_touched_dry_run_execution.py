"""
API · a touched write's dry run refuses what the write refuses, and writes nothing

Each write an administrator's passkey touch guards takes a `dry_run`, which the frontend sends before it asks the
touch, so a fault stands on its field while the input is still there. A dry run that judges less than the write lets a
refusal through to after the touch, and one that writes anything is a write the contract marks safe
(`x-safe-when`), which clears no cached read and drains no mail. So each write here is sent twice on an input it
refuses, once dry and once not, and both must answer the same refusal; then dry on an input it takes, which must
answer 204. Every collection of the database is compared before and after the module (`held_corpus`), so neither a
refused write nor a passing dry run may have moved a document.
"""

from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from httpx2 import Response
from pymongo.asynchronous.database import AsyncDatabase

from app.core.codes import Code
from app.core.collections import Collection
from tests import documents
from tests.app_client import app_client, app_under_test
from tests.config import ADMIN_AUTH, ADMIN_KEY, ADMINISTRATORS, grants_for_the_suite
from tests.database import held_corpus
from tests.session_headers import StampedHeaders
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_touched_dry_run_test")

SAISON_ID = "2026"
NOW = datetime(2026, 4, 1, 12, tzinfo=ZoneInfo("Europe/Berlin"))

# Fixed rather than generated, so a failure names the same row every run.
TEAM_OID = ObjectId("6890a1b2c3d4e5f607930001")
BEWERBUNG_OID = ObjectId("6890a1b2c3d4e5f607930002")
REFEREE_OID = ObjectId("6890a1b2c3d4e5f607930003")
OTHER_REFEREE_OID = ObjectId("6890a1b2c3d4e5f607930004")

# The owner's own row, which no handover may name, and an administrator in effect the suite's grants seed beside it.
ADMINISTRATOR = ADMINISTRATORS[1]
OWNER_GRANT_OID, ADMINISTRATOR_GRANT_OID = (grant["_id"] for grant in grants_for_the_suite()[:2])

BARRED = "barred@example.com"
REFEREE = "ref.holder@example.com"
REFEREE_NAME, OTHER_REFEREE_NAME = "Ada Kern", "Bo Lindqvist"

# Inside the range the Bundesnetzagentur keeps for media productions, one number a person.
PHONE = {"Ida": "+49 171 3920001", "Jonas": "+49 171 3920002", "Lea": "+49 171 3920003"}


def seated(first_name: str) -> dict[str, Any]:
    return documents.kontaktperson_document(first_name, last_name="Musterfrau", phone=PHONE[first_name])


def sent_seat(first_name: str, *, version: int) -> dict[str, Any]:
    return {
        "first_name": first_name,
        "last_name": "Musterfrau",
        "email": f"{first_name.lower()}@example.com",
        "phone": PHONE[first_name],
        "version": version,
    }


def referee_body(name: str, **fields: Any) -> dict[str, Any]:
    return {"name": name, "schule": None, "default_payment": 20, "kontakt": {"phone": "+49 69 90009202", "email": REFEREE}, **fields}


@pytest.fixture(scope="module")
async def seeded_url(mongo_replica_set_url: str) -> AsyncIterator[str]:
    """The suite's grants, a running season, a listed address, a club's seats, an application and two referees."""

    async def seed(database: AsyncDatabase) -> None:
        await database[Collection.GRANTS].insert_many(grants_for_the_suite())
        await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
        await database[Collection.BAN_LIST].insert_one(documents.ban_document(BARRED, until=SAISON_ID))
        await database[Collection.TEAMS].insert_one(documents.team_document(TEAM_OID, "Adler", "ADX"))
        await database[Collection.SAISON_TEAMS].insert_one(
            documents.saison_team_document(
                SAISON_ID, TEAM_OID, "Adler", "ADX", kontakte=documents.kontakte_document(trainer=seated("Ida"), ansprechperson=seated("Jonas"))
            )
        )
        await database[Collection.BEWERBUNGEN].insert_one(
            documents.bewerbung_document(
                BEWERBUNG_OID,
                SAISON_ID,
                "submitted",
                kontakte=documents.kontakte_document(trainer=seated("Ida")),
                submitted_at="2026-03-10",
                team_id=TEAM_OID,
            )
        )
        # Confirmed, so the address holds a record of its own an address change moves; the second holds the name a
        # create is refused.
        await database[Collection.SCHIEDSRICHTER].insert_many(
            [
                documents.confirmed_referee_document(REFEREE_OID, REFEREE, REFEREE_NAME, confirmed_at="2026-01-20"),
                documents.schiedsrichter_document(
                    OTHER_REFEREE_OID, email="bo.lindqvist@example.com", name=OTHER_REFEREE_NAME, default_payment=20, einwilligung=None
                ),
            ]
        )

    async with held_corpus(mongo_replica_set_url, DATABASE_NAME, seed):
        yield mongo_replica_set_url


@dataclass(frozen=True)
class Write:
    """One touched write as the frontend sends it: its request, and the input it refuses beside the one it takes."""

    name: str
    method: str
    path: str
    refused: Mapping[str, Any]
    taken: Mapping[str, Any]
    # The refusal the seed sets up, so a refusal for another reason fails the premise rather than passing.
    refusal: tuple[int, Code]
    # The administrator's session the suite's owner holds unless a person's names another.
    headers: Mapping[str, str] = field(default_factory=lambda: ADMIN_AUTH)
    # Where the input taken is sent, where the path itself names what the write refuses.
    taken_path: str | None = None


SEAT_PATH = f"/api/teams/{TEAM_OID}/saisons/{SAISON_ID}/kontakte/stellvertretung"

WRITES = (
    Write(
        "ban",
        "post",
        "/api/ban_list",
        refused={"email": BARRED, "ban_reason": "Spam", "notify": False},
        taken={"email": "new.barred@example.com", "ban_reason": "Spam", "notify": False},
        refusal=(409, Code.DUPLICATE_KEY),
    ),
    Write(
        "administrator added",
        "post",
        "/api/grants",
        refused={"email": ADMINISTRATOR},
        taken={"email": "new.admin@example.com"},
        refusal=(409, Code.GRANT_EXISTS),
    ),
    Write(
        "handover",
        "post",
        f"/api/grants/{OWNER_GRANT_OID}/handover",
        refused={},
        taken={},
        refusal=(409, Code.GRANT_OWNER),
        taken_path=f"/api/grants/{ADMINISTRATOR_GRANT_OID}/handover",
    ),
    Write(
        "lost-mailbox change",
        "post",
        "/api/address_change",
        refused={"address": REFEREE, "email": REFEREE},
        taken={"address": REFEREE, "email": "ref.new@example.com"},
        refusal=(409, Code.ADDRESS_CHANGE_UNCHANGED),
    ),
    Write(
        "own address change",
        "post",
        "/api/account/address_change",
        refused={"email": REFEREE},
        taken={"email": "ref.new@example.com"},
        refusal=(409, Code.ADDRESS_CHANGE_UNCHANGED),
        headers=StampedHeaders(REFEREE, ADMIN_KEY, lane="person"),
    ),
    Write(
        "club seat",
        "put",
        SEAT_PATH,
        refused=sent_seat("Lea", version=3),
        taken=sent_seat("Lea", version=0),
        refusal=(409, Code.VERSION_STALE),
    ),
    Write(
        "application seat",
        "post",
        f"/api/bewerbungen/{BEWERBUNG_OID}/kontakte/trainer",
        refused=sent_seat("Lea", version=3),
        taken=sent_seat("Lea", version=0),
        refusal=(409, Code.VERSION_STALE),
    ),
    Write(
        "referee created",
        "post",
        "/api/schiedsrichter",
        refused=referee_body(OTHER_REFEREE_NAME),
        taken=referee_body("Cem Arslan"),
        refusal=(409, Code.DUPLICATE_KEY),
    ),
    Write(
        "referee saved",
        "patch",
        f"/api/schiedsrichter/{REFEREE_OID}",
        refused=referee_body(REFEREE_NAME, version=3),
        taken=referee_body(REFEREE_NAME, version=0),
        refusal=(409, Code.VERSION_STALE),
    ),
)


async def sent(url: str, write: Write, path: str, body: Mapping[str, Any], *, dry_run: bool) -> Response:
    """The write as a real request, guards and middleware included, which a write could hide in as well."""

    async with app_client(url, app=app_under_test(DATABASE_NAME), now=NOW) as http:
        return await http.request(
            write.method.upper(), path, params={"dry_run": "true"} if dry_run else None, json=dict(body), headers=write.headers
        )


def answer(response: Response) -> tuple[int, str | None]:
    # A passing dry run's 204 holds no body, which a dry run judging less than the write answers.
    return response.status_code, response.json()["error_code"] if response.content else None


@pytest.mark.parametrize("write", WRITES, ids=lambda write: write.name)
async def test_the_dry_run_refuses_what_the_write_refuses(seeded_url: str, write: Write):
    dry = await sent(seeded_url, write, write.path, write.refused, dry_run=True)
    written = await sent(seeded_url, write, write.path, write.refused, dry_run=False)

    assert answer(dry) == write.refusal, dry.text
    assert answer(written) == write.refusal, written.text


@pytest.mark.parametrize("write", WRITES, ids=lambda write: write.name)
async def test_a_dry_run_the_write_would_take_answers_204(seeded_url: str, write: Write):
    """Its premise beside the refusal's: the input the write takes, which the module's comparison holds unwritten."""

    response = await sent(seeded_url, write, write.taken_path or write.path, write.taken, dry_run=True)

    assert (response.status_code, response.content) == (204, b""), response.text
