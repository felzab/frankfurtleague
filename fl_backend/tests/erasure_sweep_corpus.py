"""
TESTS · pupils the erasure's season-after rule judges, the league they play in, and one run of the rule

The league has two seasons ended, one running and one planned, so the rule keeps a squad row in the
latest ended one and every later one. Each suite seeds it on a database of its own.
"""

from collections.abc import Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.identity.schemas import FLErasureSweepParams
from app.api.identity.system_router import sweep_erasure
from app.api.registrierungen.services import compose_decline_update
from app.core.collections import Collection
from tests.documents import (
    registrierung_document,
    saison_document,
    saison_spieler_document,
    spielbericht_document,
    spieler_document,
    team_document,
)
from tests.erasure import erasure_collections

NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

# Two ended, one running, one planned: the rule keeps a squad row in 2025, 2026 and 2027.
LEAGUE = {"2023": "past", "2024": "past", "2025": "past", "2026": "active", "2027": "future"}

TEAM_OID = ObjectId("6890a1b2c3d4e5f607d10001")


def numbered(position: int) -> ObjectId:
    """Ids in seeding order, so the run's `_id` order is the order a case seeds in."""

    return ObjectId(f"6890a1b2c3d4e5f607d2{position:04d}")


def address_of(position: int) -> str:
    return f"schuelerin.{position}@beispielschule.example.org"


def pupil(spieler_id: ObjectId, email: str, *, last_name: str = "Muster", **fields: Any) -> dict[str, Any]:
    return spieler_document(spieler_id, "Quintessa", last_name, email=email, **fields)


def kader_row(spieler_id: ObjectId, saison_id: str, **fields: Any) -> dict[str, Any]:
    return saison_spieler_document(spieler_id, saison_id, TEAM_OID, **fields)


def registration(registrierung_id: ObjectId, email: str, *, declined: bool = False, last_name: str = "Muster") -> dict[str, Any]:
    document = registrierung_document(
        registrierung_id,
        email,
        saison_id="2026",
        team_id=TEAM_OID,
        first_name="Quintessa",
        last_name=last_name,
        token=f"token-{registrierung_id}",
        submitted_at="2026-03-02",
        deadline="2026-03-09",
    )

    return {**document, **compose_decline_update(reason=None, today="2026-03-05")["$set"]} if declined else document


def a_due_pupil(position: int) -> dict[Collection, list[dict[str, Any]]]:
    """The run's largest shape: squad rows only in ended seasons the rule does not keep, and a declined registration."""

    spieler_id = numbered(position)

    return {
        Collection.SPIELER: [pupil(spieler_id, address_of(position))],
        Collection.SAISON_SPIELER: [kader_row(spieler_id, "2023"), kader_row(spieler_id, "2024")],
        Collection.REGISTRIERUNGEN: [registration(numbered(5000 + position), address_of(position), declined=True)],
    }


def a_report_naming(position: int) -> dict[Collection, list[dict[str, Any]]]:
    """A report naming that due pupil among its scorers: what makes a pupil's erasure its costliest."""

    report = spielbericht_document({"_id": numbered(7000 + position), "saison_id": "2024"})
    report["bericht"]["scorers"][0]["spieler_id"] = numbered(position)

    return {Collection.SPIELBERICHTE: [report]}


async def seeded(database: AsyncDatabase, *shapes: Mapping[Collection, list[dict[str, Any]]]) -> None:
    for shape in shapes:
        for collection, documents in shape.items():
            await database[collection].insert_many(documents)


async def the_league(database: AsyncDatabase, *, saisons: Mapping[str, str] = LEAGUE) -> None:
    """The seasons and the one team every pupil a case seeds plays for."""

    await database[Collection.SAISONS].insert_many([saison_document(saison_id, status) for saison_id, status in saisons.items()])
    await database[Collection.TEAMS].insert_one(team_document(TEAM_OID, "Lindenschule", "LSX"))


async def run(database: AsyncDatabase, client: AsyncMongoClient, *, after: Any = None, **replaced: Any) -> Any:
    return await sweep_erasure(
        params=FLErasureSweepParams(after=after),
        **erasure_collections(database, **({"saisons_collection": database[Collection.SAISONS]} | replaced)),
        db=client,
        germany_now=NOW,
    )
