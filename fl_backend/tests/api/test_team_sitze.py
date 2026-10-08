import functools
import json
from collections.abc import Iterator, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from fastapi import FastAPI
from pymongo.asynchronous.database import AsyncDatabase

from app.core.collections import Collection
from app.core.config import API_VERSION
from app.main import create_app
from tests import documents
from tests.actor_tokens import SignedActor
from tests.app_client import app_client
from tests.config import ADMIN_KEY, build_test_config
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

# Module level: the read opens a snapshot session against a real mongod.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_team_sitze_test")
WIRE_CONFIG = build_test_config().model_copy(update={"db_base_name": DATABASE_NAME})

SAISON_ID = "2026"
PAST_SAISON_ID = "2025"
NEXT_SAISON_ID = "2027"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

TEAM_OID = ObjectId("6890a1b2c3d4e5f607980001")
OTHER_TEAM_OID = ObjectId("6890a1b2c3d4e5f607980002")

# This season: a confirmed Trainer alone, an unanswered Ansprechperson and an empty Stellvertretung,
# the widest the landing ever is. Past season: Paula. Next season: Nora and Stella, confirmed.
THEO = "theo@example.com"
ANNA = "anna@example.com"
OTTO = "otto@example.com"
PAULA = "paula@example.com"
NORA = "nora@example.com"
STELLA = "stella@example.com"


@functools.cache
def _served() -> FastAPI:
    return create_app(WIRE_CONFIG)


def sitze_read(url: str, *, identifier: str, team_id: ObjectId = TEAM_OID, saison_id: str = SAISON_ID) -> tuple[int, Any]:
    async def _run() -> tuple[int, Any]:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
            await seed(database)
            async with app_client(url, app=_served(), now=NOW) as http:
                response = await http.get(
                    f"/api/v{API_VERSION}/teams/{team_id}/saisons/{saison_id}/person/sitze",
                    headers=SignedActor(identifier, ADMIN_KEY, lane="person"),
                )

            return response.status_code, response.json()

    return on_the_seed_loop(_run())


async def seed(database: AsyncDatabase) -> None:
    await database[Collection.SAISONS].insert_many(
        [
            documents.saison_document(SAISON_ID, "active"),
            documents.saison_document(PAST_SAISON_ID, "past"),
            documents.saison_document(NEXT_SAISON_ID, "future"),
        ]
    )
    await database[Collection.TEAMS].insert_many(
        [documents.team_document(TEAM_OID, "Zorbanax", "ZO"), documents.team_document(OTHER_TEAM_OID, "Quillhilde", "QU")]
    )
    await database[Collection.SAISON_TEAMS].insert_many(
        [
            documents.saison_team_document(
                SAISON_ID,
                TEAM_OID,
                "Zorbanax",
                "ZO",
                kontakte={
                    "trainer": documents.kontaktperson_document("Theo", bestaetigt_am="2026-03-21"),
                    "ansprechperson": documents.kontaktperson_document("Anna"),
                    "stellvertretung": None,
                    "trainer_ist_zugleich": None,
                },
            ),
            documents.saison_team_document(
                PAST_SAISON_ID,
                TEAM_OID,
                "Zorbanax",
                "ZO",
                kontakte={
                    "trainer": None,
                    "ansprechperson": documents.kontaktperson_document("Paula", bestaetigt_am="2025-03-21"),
                    "stellvertretung": None,
                    "trainer_ist_zugleich": None,
                },
            ),
            documents.saison_team_document(
                NEXT_SAISON_ID,
                TEAM_OID,
                "Zorbanax",
                "ZO",
                kontakte={
                    "trainer": None,
                    "ansprechperson": documents.kontaktperson_document("Nora", bestaetigt_am="2026-03-21"),
                    "stellvertretung": documents.kontaktperson_document("Stella", bestaetigt_am="2026-03-21"),
                    "trainer_ist_zugleich": None,
                },
            ),
            documents.saison_team_document(
                SAISON_ID,
                OTHER_TEAM_OID,
                "Quillhilde",
                "QU",
                kontakte={
                    "trainer": None,
                    "ansprechperson": documents.kontaktperson_document("Otto", bestaetigt_am="2026-03-21"),
                    "stellvertretung": None,
                    "trainer_ist_zugleich": None,
                },
            ),
        ]
    )


def keys_at_every_depth(value: Any) -> Iterator[str]:
    if isinstance(value, Mapping):
        for key, inner in value.items():
            yield key
            yield from keys_at_every_depth(inner)
    elif isinstance(value, list):
        for inner in value:
            yield from keys_at_every_depth(inner)


class TestTheSeatRead:
    def test_a_seat_holder_reads_three_lines_for_their_own_team_pending_confirmed_and_empty(self, mongo_replica_set_url: str):
        """An emptied slot is answered rather than omitted, which would say the team has two seats rather than one unfilled."""

        status, served = sitze_read(mongo_replica_set_url, identifier=THEO)

        assert status == 200
        assert served["sitze"] == [
            {"rolle": "trainer", "name": "Theo Theo-Mustermann", "bestaetigt": True},
            {"rolle": "ansprechperson", "name": "Anna Anna-Mustermann", "bestaetigt": False},
            {"rolle": "stellvertretung", "name": None, "bestaetigt": False},
        ]

    def test_a_stellvertretung_reads_the_lines_of_their_own_season(self, mongo_replica_set_url: str):
        status, served = sitze_read(mongo_replica_set_url, identifier=STELLA, saison_id=NEXT_SAISON_ID)

        assert status == 200
        assert [(sitz["rolle"], sitz["name"]) for sitz in served["sitze"]] == [
            ("trainer", None),
            ("ansprechperson", "Nora Nora-Mustermann"),
            ("stellvertretung", "Stella Stella-Mustermann"),
        ]

    @pytest.mark.parametrize(
        ("identifier", "saison_id"),
        [(OTTO, SAISON_ID), (ANNA, SAISON_ID), (PAULA, PAST_SAISON_ID), (NORA, SAISON_ID)],
        ids=("another team's seat", "an unconfirmed seat", "the team's past season", "the same team in another season"),
    )
    def test_a_seat_granting_nothing_here_is_refused(self, mongo_replica_set_url: str, identifier: str, saison_id: str):
        status, served = sitze_read(mongo_replica_set_url, identifier=identifier, saison_id=saison_id)

        assert (status, served["error_code"]) == (403, "REQ-FUNKTION-001")

    def test_no_address_telephone_or_birthdate_at_any_depth(self, mongo_replica_set_url: str):
        """Over the serialised body, keys and values both, so a nested block cannot smuggle one in.

        Seeded with every seat carrying all three, so the scan has something to find.
        """

        _, served = sitze_read(mongo_replica_set_url, identifier=THEO)

        assert not {"email", "telefon", "geburtsdatum", "einwilligung", "bestaetigt_am"} & set(keys_at_every_depth(served))
        text = json.dumps(served)
        assert not any(value in text for value in ("@", "+49", "1984-05-09", "2026-03-21"))
