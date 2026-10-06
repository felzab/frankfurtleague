import functools
import json
from collections.abc import Awaitable, Callable, Iterator, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from fastapi import FastAPI
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.services import hash_token
from app.api.identitaet.services import FUNKTION_NICHT_GEHALTEN
from app.api.konto.services import compose_person_move
from app.api.registrierungen.einwilligung_router import get_bestaetigung_ansicht, post_bestaetigung
from app.api.registrierungen.person_router import ablehnen, aufnehmen, get_offene_registrierungen
from app.api.registrierungen.schemas import (
    FLOffeneRegistrierungenParams,
    FLRegistrierungAblehnenPayload,
    FLRegistrierungAufnehmenPayload,
    FLRegistrierungBestaetigungAnsichtPayload,
    FLRegistrierungBestaetigungPayload,
    FLRegistrierungSelbstEinwilligungPayload,
)
from app.api.registrierungen.selbst_router import patch_einwilligung as patch_registrierung_einwilligung
from app.api.registrierungen.services import (
    REGISTRIERUNG_ADRESSE_GESPERRT,
    REGISTRIERUNG_PERSON_FEHLT,
    REGISTRIERUNG_PERSON_NICHT_BENANNT,
    REGISTRIERUNG_SCHON_IM_KADER,
    REGISTRIERUNG_STUFE_NICHT_ERLAUBT,
    REGISTRIERUNG_UNBESTAETIGT,
    compose_bestaetigung,
    compose_confirmation_update,
    compose_registrierung,
)
from app.api.saisons.cache import invalidate_saison_cache
from app.api.sperrliste.services import compose_gesperrt_bis_saison_id
from app.api.spieler.admin_router import erase_spieler
from app.api.spieler.services import SQUAD_FULL
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.exceptions import DocumentNotFoundException, WriteRefusalException
from app.main import create_app
from app.shared.einwilligung import LAUFENDE_FASSUNGEN
from app.shared.einwilligung_nachweis import WAHLEN, nachweis_stand_of
from tests import documents
from tests.actor_tokens import SignedActor
from tests.app_client import app_client
from tests.bans import ban_list
from tests.config import ADMIN_KEY, build_test_config
from tests.database import a_clean_database, on_the_seed_loop
from tests.isolation import COMMITTED, InterleavedCollection, outcome_of
from tests.records import record_collections
from tests.whole_database import every_collection_as_text
from tests.worker import worker_database

# Module level: every case below reaches a real mongod, each write being one transaction.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_registrierung_aufnahme_test")
WIRE_CONFIG = build_test_config().model_copy(update={"db_base_name": DATABASE_NAME})

SAISON_ID = "2026"
NEXT_SAISON_ID = "2027"
PAST_SAISON_ID = "2025"
TODAY = "2026-04-01"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
# The morning before the admission, when the pupil withdrew on the account page.
WITHDRAWN_AT = datetime(2026, 4, 1, 9, 0, tzinfo=ZoneInfo("Europe/Berlin"))

TEAM_OID = ObjectId("6890a1b2c3d4e5f607970001")
OTHER_TEAM_OID = ObjectId("6890a1b2c3d4e5f607970002")

# Seat holders, as `kontaktperson_document` folds them. This team and season: Anna, Theo
# (Trainer alone), Stella (Stellvertretung). Otto: another team. Paula and Nora: this team in the
# `past` season and the next one only.
ANNA = "anna@example.com"
THEO = "theo@example.com"
STELLA = "stella@example.com"
OTTO = "otto@example.com"
PAULA = "paula@example.com"
NORA = "nora@example.com"

# As typed, a capital in the local part: the fold differs, so this spelling exists in the
# registration alone and a whole-database scan finds it only where the registration's values survive.
TYPED_EMAIL = "Thessaly.Okonkwo@beispielschule.de"
FOLDED_EMAIL = "thessaly.okonkwo@beispielschule.de"
GEBURTSDATUM = "2009-05-04"
# The label of the account page's pupil control a press is given under.
KONTO_LABEL = "2026-10-konto-spieler"
TOKEN = "hwGqQ4kP6yJr3VnZbT8sXeM2dLuF9aCwR1oY5iN7pKg"

RULES: Mapping[str, Any] = documents.rules_document(max_kadergroesse=3, erlaubte_stufen=["Q1", "Q2"])

STANDING = compose_gesperrt_bis_saison_id(massgebliche_saison_id=SAISON_ID)

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def kontakte(*, ansprechperson: str, trainer: str | None = None, stellvertretung: str | None = None, bestaetigt: bool = True) -> dict[str, Any]:
    """`bestaetigt` is the Stellvertretung's own stamp alone: an unconfirmed seat grants no panel."""

    stamp = "2026-03-21"

    return {
        "trainer": None if trainer is None else documents.kontaktperson_document(trainer, bestaetigt_am=stamp),
        "ansprechperson": documents.kontaktperson_document(ansprechperson, bestaetigt_am=stamp),
        "stellvertretung": None
        if stellvertretung is None
        else documents.kontaktperson_document(stellvertretung, bestaetigt_am=stamp if bestaetigt else None),
        "trainer_ist_zugleich": None,
    }


def on_a_league(
    url: str,
    body: Body,
    *,
    squad: int = 0,
    matchday_beginn: str | None = None,
    matchday: bool = False,
    stellvertretung_bestaetigt: bool = True,
) -> Any:
    """Two clubs in one active season, each with seats; `squad` live rows already on the first club.

    The first club also plays the `past` season before and the `future` one after, each seated by
    somebody holding no seat this season.
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            invalidate_saison_cache()

            await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active", rules=dict(RULES)))
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
                        kontakte=kontakte(
                            ansprechperson="Anna", trainer="Theo", stellvertretung="Stella", bestaetigt=stellvertretung_bestaetigt
                        ),
                    ),
                    documents.saison_team_document(SAISON_ID, OTHER_TEAM_OID, "Quillhilde", "QU", kontakte=kontakte(ansprechperson="Otto")),
                ]
            )
            await database[Collection.SAISONS].insert_many(
                [
                    documents.saison_document(NEXT_SAISON_ID, "future", rules=documents.rules_document(erlaubte_stufen=["Q1", "Q2"])),
                    documents.saison_document(PAST_SAISON_ID, "past"),
                ]
            )
            await database[Collection.SAISON_TEAMS].insert_many(
                [
                    documents.saison_team_document(
                        NEXT_SAISON_ID, TEAM_OID, "Zorbanax", "ZO", kontakte=kontakte(ansprechperson="Anna", trainer="Nora")
                    ),
                    documents.saison_team_document(PAST_SAISON_ID, TEAM_OID, "Zorbanax", "ZO", kontakte=kontakte(ansprechperson="Paula")),
                ]
            )

            if squad:
                await database[Collection.SAISON_SPIELER].insert_many(
                    [documents.saison_spieler_document(ObjectId(), SAISON_ID, TEAM_OID, nummer=str(seat)) for seat in range(squad)]
                )

            if matchday:
                await database[Collection.SPIELTAGE].insert_one(
                    {
                        "_id": ObjectId(),
                        "beginn": matchday_beginn,
                        "ende": matchday_beginn,
                        "saison_phase": "gruppenphase",
                        "saison_id": SAISON_ID,
                        "position": 1,
                    }
                )

            return await body(database, client)

    return on_the_seed_loop(_run())


def registrierung_document(
    *,
    confirmed: bool = True,
    saison_id: str = SAISON_ID,
    team_id: ObjectId = TEAM_OID,
    email: str = TYPED_EMAIL,
    vorname: str = "Thessaly",
    nachname: str = "Okonkwo-Brandt",
    geburtsdatum: str = GEBURTSDATUM,
    token: str = TOKEN,
    **fields: Any,
) -> dict[str, Any]:
    """A registration as the submission and, where `confirmed`, the pupil's own confirmation leave it, through their composers."""

    document = {
        "_id": ObjectId(),
        **compose_registrierung(
            saison_id=saison_id,
            team_id=team_id,
            einladung_id=ObjectId(),
            vorname=vorname,
            nachname=nachname,
            email=email,
            position="Mittelfeld",
            nummer="17",
            stufe="Q1",
            bestaetigung=compose_bestaetigung(token_hash=hash_token(token), today="2026-03-30", frist="2026-04-06"),
            today="2026-03-30",
        ),
        "idempotenz_schluessel": str(ObjectId()),
        "idempotenz_fingerabdruck": "f" * 64,
    }
    if confirmed:
        document.update(
            compose_confirmation_update(
                geburtsdatum=geburtsdatum,
                umfang="intern",
                medien=False,
                text_version="2026-09",
                today="2026-03-31",
                am="2026-03-31T08:00:00+00:00",
            )["$set"]
        )

    return {**document, **fields}


async def seed(database: AsyncDatabase, document: Mapping[str, Any]) -> ObjectId:
    await database[Collection.REGISTRIERUNGEN].insert_one(dict(document))

    return document["_id"]


async def admit(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    registrierung_id: Any,
    *,
    spieler_id: Any = None,
    identifier: str = ANNA,
    saisons: Any = None,
    spieler: Any = None,
) -> Any:
    """`saisons` and `spieler` stand in for the two collections a race case interleaves a rival at."""

    return await aufnehmen(
        registrierung_id=registrierung_id,
        aufnahme_data=FLRegistrierungAufnehmenPayload(spieler_id=spieler_id),
        identifier=identifier,
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        saisons_collection=database[Collection.SAISONS] if saisons is None else saisons,
        spieler_collection=database[Collection.SPIELER] if spieler is None else spieler,
        records=record_collections(
            database,
            saisons_collection=database[Collection.SAISONS] if saisons is None else saisons,
            spieler_collection=database[Collection.SPIELER] if spieler is None else spieler,
        ),
        spieltage_collection=database[Collection.SPIELTAGE],
        aktionen_collection=database[Collection.AKTIONEN],
        sperrliste=ban_list(database),
        db=client,
        today=TODAY,
        germany_now=NOW,
    )


class SeasonsRunningARivalAtTheAnchor(InterleavedCollection):
    """`saisons` with a rival run once just before the squad cap's anchor write, inside the admission's transaction."""

    async def update_many(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()

        return await self._collection.update_many(*args, **kwargs)


class PersonsRunningARivalBeforeTheInsert(InterleavedCollection):
    """`spieler` with a rival run once just before a new person is inserted: after the address was read and found nobody."""

    async def insert_one(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()

        return await self._collection.insert_one(*args, **kwargs)


async def decline(
    database: AsyncDatabase, client: AsyncMongoClient, registrierung_id: Any, *, grund: Any = None, identifier: str = ANNA
) -> Any:
    return await ablehnen(
        registrierung_id=registrierung_id,
        ablehnung_data=FLRegistrierungAblehnenPayload(grund=grund),
        identifier=identifier,
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        records=record_collections(database),
        db=client,
        today=TODAY,
    )


async def read(
    database: AsyncDatabase, client: AsyncMongoClient, *, identifier: str = ANNA, team_id: ObjectId = TEAM_OID, saison_id: str = SAISON_ID
) -> Any:
    return await get_offene_registrierungen(
        team_id=team_id,
        saison_id=saison_id,
        params=FLOffeneRegistrierungenParams(),
        identifier=identifier,
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        spieler_collection=database[Collection.SPIELER],
        records=record_collections(database),
        db=client,
    )


async def refused(call: Awaitable[Any]) -> str:
    with pytest.raises(WriteRefusalException) as refusal:
        await call

    return refusal.value.error_code


async def snapshot(database: AsyncDatabase) -> dict[str, list[Any]]:
    """Every collection as it stands, the action log and the season's anchor included, so "wrote nothing" means nothing."""

    return {name: await database[name].find().sort("_id", 1).to_list(length=None) for name in sorted(await database.list_collection_names())}


async def persons(database: AsyncDatabase) -> list[Mapping[str, Any]]:
    return await database[Collection.SPIELER].find().sort("_id", 1).to_list(length=None)


async def squad_rows(database: AsyncDatabase, *, spieler_id: Any) -> list[Mapping[str, Any]]:
    return await database[Collection.SAISON_SPIELER].find({"spieler_id": spieler_id}).to_list(length=None)


def a_stored_person(spieler_id: ObjectId, *, email: str | None = FOLDED_EMAIL, **fields: Any) -> dict[str, Any]:
    stored = {"geburtsdatum": GEBURTSDATUM, **fields}
    if email is not None:
        stored["email"] = email

    return documents.spieler_document(spieler_id, stored.pop("vorname", "Thessaly"), stored.pop("nachname", "Okonkwo-Brandt"), **stored)


class TestWhatAnAdmissionWrites:
    def test_a_new_person_is_written_with_the_folded_address_and_the_registrations_record(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            registrierung_id = await seed(database, registrierung_document())
            answer = await admit(database, client, registrierung_id)

            return answer, await persons(database), await squad_rows(database, spieler_id=answer.spieler_id)

        answer, stored, rows = on_a_league(mongo_replica_set_url, body)

        assert [person["_id"] for person in stored] == [answer.spieler_id]
        person = stored[0]
        assert (person["email"], person["vorname"], person["nachname"], person["geburtsdatum"]) == (
            FOLDED_EMAIL,
            "Thessaly",
            "Okonkwo-Brandt",
            GEBURTSDATUM,
        )
        assert person["einwilligung"]["bestaetigt_am"] == "2026-03-31" and person["einwilligung"]["umfang"] == "intern"
        assert len(rows) == 1
        assert {key: rows[0][key] for key in ("team_id", "saison_id", "nummer", "position", "stufe", "rolle", "inactive_since")} == {
            "team_id": TEAM_OID,
            "saison_id": SAISON_ID,
            "nummer": "17",
            "position": "Mittelfeld",
            "stufe": "Q1",
            "rolle": None,
            "inactive_since": None,
        }

    def test_the_registration_is_gone_and_its_values_survive_nowhere(self, mongo_replica_set_url: str):
        """A real confirmation first, so the log holds an image of the registration for the redaction to reach.

        The as-typed address and the link's hash exist in the registration alone; the name and the birthdate became the person.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            registrierung_id = await seed(database, registrierung_document(confirmed=False))
            await post_bestaetigung(
                antwort_data=FLRegistrierungBestaetigungPayload(
                    token=TOKEN,
                    geburtsdatum=GEBURTSDATUM,
                    umfang="intern",
                    medien=False,
                    text_version=LAUFENDE_FASSUNGEN["bestaetigung_spieler"],
                ),
                registrierungen_collection=database[Collection.REGISTRIERUNGEN],
                spieler_collection=database[Collection.SPIELER],
                sperrliste=ban_list(database),
                db=client,
                today=TODAY,
                germany_now=NOW,
            )
            imaged = await database[Collection.AKTIONEN].count_documents(
                {"collection": Collection.REGISTRIERUNGEN, "document_id": registrierung_id, "before": {"$ne": None}}
            )
            await admit(database, client, registrierung_id)
            naming = (
                await database[Collection.AKTIONEN].find({"collection": Collection.REGISTRIERUNGEN, "document_id": registrierung_id}).to_list()
            )

            return imaged, naming, await database[Collection.REGISTRIERUNGEN].count_documents({}), await every_collection_as_text(database)

        imaged, naming, remaining, everything = on_a_league(mongo_replica_set_url, body)

        # The premise: without an image the redaction below would pass reaching nothing.
        assert imaged >= 1
        assert remaining == 0
        assert naming and all(row["before"] is None and row["redacted_at"] is not None for row in naming)
        assert TYPED_EMAIL not in everything
        assert hash_token(TOKEN) not in everything

    def test_it_writes_nothing_beyond_the_person_the_squad_row_the_anchor_and_the_log(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            registrierung_id = await seed(database, registrierung_document())
            before = await snapshot(database)
            await admit(database, client, registrierung_id)

            return before, await snapshot(database)

        before, after = on_a_league(mongo_replica_set_url, body)

        moved = {name for name in before.keys() | after.keys() if before.get(name) != after.get(name)}
        assert moved == {Collection.SPIELER, Collection.SAISON_SPIELER, Collection.REGISTRIERUNGEN, Collection.SAISONS, Collection.AKTIONEN}

    def test_a_second_admission_answers_404_and_writes_nothing(self, mongo_replica_set_url: str):
        """The anchor and the log included: a second press that took the season's `$inc` would be a write nobody sees."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            registrierung_id = await seed(database, registrierung_document())
            await admit(database, client, registrierung_id)
            before = await snapshot(database)
            with pytest.raises(DocumentNotFoundException):
                await admit(database, client, registrierung_id)

            return before, await snapshot(database)

        before, after = on_a_league(mongo_replica_set_url, body)

        assert after == before

    def test_a_shirt_already_worn_is_admitted_and_the_read_marked_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISON_SPIELER].insert_one(
                documents.saison_spieler_document(ObjectId(), SAISON_ID, TEAM_OID, nummer="17")
            )
            # A different string for the same figure, which is no shared shirt: numbers are worn as stored.
            other = await seed(database, registrierung_document(email="zweite@beispielschule.de", nummer="017"))
            registrierung_id = await seed(database, registrierung_document())
            listed = await read(database, client)
            await admit(database, client, registrierung_id)

            return listed, other, registrierung_id, await database[Collection.SAISON_SPIELER].count_documents({"nummer": "17"})

        listed, other, registrierung_id, wearing = on_a_league(mongo_replica_set_url, body)

        marks = {row.registrierung_id: row.nummer_doppelt for row in listed.registrierungen}
        assert marks == {registrierung_id: True, other: False}
        assert wearing == 2


class TestTheLateEntry:
    @pytest.mark.parametrize(
        ("matchday", "beginn", "flagged"),
        [
            (True, "2026-03-15", True),
            (True, "2026-04-20", False),
            # The null arm: an undated matchday 1 has not begun, and reading `None` as a passed date
            # would flag every admission into an undated season.
            (True, None, False),
            (False, None, False),
        ],
        ids=("after the first day", "before it", "an undated matchday 1", "no matchday 1"),
    )
    def test_the_marker_is_derived_at_the_admission(self, mongo_replica_set_url: str, matchday: bool, beginn: str | None, flagged: bool):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            answer = await admit(database, client, await seed(database, registrierung_document()))
            rows = await squad_rows(database, spieler_id=answer.spieler_id)

            return answer.ist_nachnominiert, rows[0]["ist_nachnominiert"]

        assert on_a_league(mongo_replica_set_url, body, matchday=matchday, matchday_beginn=beginn) == (flagged, flagged)


class TestTheStufe:
    def test_a_stufe_the_season_no_longer_offers_is_refused_and_writes_nothing(self, mongo_replica_set_url: str):
        """Seeded past the submission's own refusal, which is how a season narrowed after the pupil registered reaches the admission."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            registrierung_id = await seed(database, registrierung_document(stufe="Q4"))
            before = await snapshot(database)
            code = await refused(admit(database, client, registrierung_id))

            return code, before, await snapshot(database)

        code, before, after = on_a_league(mongo_replica_set_url, body)

        assert code == REGISTRIERUNG_STUFE_NICHT_ERLAUBT
        assert after == before

    def test_a_stufe_still_offered_is_admitted_before_and_after_the_boundary(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return (await admit(database, client, await seed(database, registrierung_document(stufe="Q2")))).stufe

        assert on_a_league(mongo_replica_set_url, body, matchday=True, matchday_beginn="2026-03-15") == "Q2"


class TestTheSquadCap:
    def test_the_registration_past_the_cap_is_refused_and_every_collection_stays(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            registrierung_id = await seed(database, registrierung_document())
            before = await snapshot(database)
            code = await refused(admit(database, client, registrierung_id))

            return code, before, await snapshot(database)

        code, before, after = on_a_league(mongo_replica_set_url, body, squad=3)

        assert code == SQUAD_FULL
        assert after == before

    def test_a_rival_admission_landing_inside_takes_the_last_place(self, mongo_replica_set_url: str):
        """The rival commits after this admission read the season, before its anchor write and its count.

        The count reads the earlier snapshot, so it misses the rival's row: the anchor conflicts, the retry
        counts the row, and the cap refuses.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await seed(database, registrierung_document())
            second = await seed(database, registrierung_document(email="zweite@beispielschule.de", vorname="Zweite"))

            async def the_rival_takes_the_place() -> None:
                await admit(database, client, second)

            seasons = SeasonsRunningARivalAtTheAnchor(database[Collection.SAISONS], the_rival_takes_the_place)
            outcome = await outcome_of(admit(database, client, first, saisons=seasons))
            # Serially the refused admission reaches the anchor once; landing inside, its retry reaches it again.
            seasons.assert_landed_inside(serially=1)

            live = await database[Collection.SAISON_SPIELER].count_documents({"team_id": TEAM_OID, "inactive_since": None})

            return outcome, live, await database[Collection.REGISTRIERUNGEN].count_documents({"_id": first})

        outcome, live, still_pending = on_a_league(mongo_replica_set_url, body, squad=2)

        assert outcome == SQUAD_FULL
        assert (live, still_pending) == (3, 1)


class TestAnUnconfirmedRegistration:
    def test_it_is_listed_marked_inadmissible_and_resolved_to_nobody(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_one(a_stored_person(ObjectId()))
            await seed(database, registrierung_document(confirmed=False))

            return (await read(database, client)).registrierungen

        (row,) = on_a_league(mongo_replica_set_url, body)

        assert (row.aufnehmbar, row.person, row.vorschlag) == (False, None, None)

    def test_the_admission_refuses_it_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            registrierung_id = await seed(database, registrierung_document(confirmed=False))
            before = await snapshot(database)
            code = await refused(admit(database, client, registrierung_id))

            return code, before, await snapshot(database)

        code, before, after = on_a_league(mongo_replica_set_url, body)

        assert code == REGISTRIERUNG_UNBESTAETIGT
        assert after == before


class TestABarredAddress:
    def test_the_admission_refuses_it_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            registrierung_id = await seed(database, registrierung_document())
            await database[Collection.SPERRLISTE].insert_one(documents.ban_document(FOLDED_EMAIL, bis=STANDING))
            before = await snapshot(database)
            code = await refused(admit(database, client, registrierung_id))

            return code, before, await snapshot(database)

        code, before, after = on_a_league(mongo_replica_set_url, body)

        assert code == REGISTRIERUNG_ADRESSE_GESPERRT
        assert after == before

    def test_a_ban_entered_between_the_read_and_the_press_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            registrierung_id = await seed(database, registrierung_document())
            listed = await read(database, client)
            await database[Collection.SPERRLISTE].insert_one(documents.ban_document(TYPED_EMAIL, bis=STANDING))

            return listed.registrierungen[0].aufnehmbar, await refused(admit(database, client, registrierung_id)), await persons(database)

        aufnehmbar, code, stored = on_a_league(mongo_replica_set_url, body)

        assert aufnehmbar is True
        assert code == REGISTRIERUNG_ADRESSE_GESPERRT
        assert stored == []


class TestThePersonAnAdmissionNames:
    @pytest.mark.parametrize(
        "differs",
        [{"vorname": "Thessa"}, {"geburtsdatum": "2009-05-05"}],
        ids=("another name", "another birthdate"),
    )
    def test_an_address_match_that_differs_is_refused_unless_the_body_names_it(self, mongo_replica_set_url: str, differs: Mapping[str, Any]):
        stored_id = ObjectId()

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_one(a_stored_person(stored_id, **differs))
            registrierung_id = await seed(database, registrierung_document())
            listed = await read(database, client)
            before = await snapshot(database)
            code = await refused(admit(database, client, registrierung_id))
            untouched = await snapshot(database) == before
            answer = await admit(database, client, registrierung_id, spieler_id=stored_id)

            return listed.registrierungen[0].person, code, untouched, answer, await persons(database)

        person, code, untouched, answer, stored = on_a_league(mongo_replica_set_url, body)

        assert person is not None and (person.spieler_id, person.weicht_ab) == (stored_id, True)
        assert (code, untouched) == (REGISTRIERUNG_PERSON_NICHT_BENANNT, True)
        # No second person: the yes overwrites the stored name and birthdate with the confirmed ones.
        assert answer.spieler_id == stored_id
        assert [(row["_id"], row["vorname"], row["geburtsdatum"]) for row in stored] == [(stored_id, "Thessaly", GEBURTSDATUM)]

    def test_an_address_match_under_the_same_name_is_admitted_with_no_spieler_id(self, mongo_replica_set_url: str):
        stored_id = ObjectId()

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            # Stored in another case and spacing, which the name fold reads as the same person.
            await database[Collection.SPIELER].insert_one(a_stored_person(stored_id, vorname="THESSALY", geburtsdatum=None))
            registrierung_id = await seed(database, registrierung_document())
            listed = await read(database, client)
            answer = await admit(database, client, registrierung_id)

            return listed.registrierungen[0].person, answer.spieler_id, await persons(database)

        person, admitted, stored = on_a_league(mongo_replica_set_url, body)

        assert person is not None and person.weicht_ab is False
        assert admitted == stored_id
        assert len(stored) == 1 and stored[0]["geburtsdatum"] == GEBURTSDATUM

    def test_a_returning_persons_record_is_renewed_with_the_registrations_evidence(self, mongo_replica_set_url: str):
        """The confirmation page promises renewal, a narrowed answer left under the older record being ignored.

        The registration's confirmation is the person's own act, so its evidence is what the renewed record proves.
        """

        stored_id = ObjectId()

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_one(a_stored_person(stored_id))
            registrierung_id = await seed(database, registrierung_document())
            fresh = (await database[Collection.REGISTRIERUNGEN].find_one({"_id": registrierung_id}) or {})["einwilligung"]
            await admit(database, client, registrierung_id)

            return fresh, (await persons(database))[0]["einwilligung"]

        fresh, einwilligung = on_a_league(mongo_replica_set_url, body)

        assert fresh["nachweis"], "the registration carries no evidence, so nothing proves it was carried"
        assert einwilligung == fresh

    def test_a_withdrawal_the_person_made_after_confirming_the_registration_stands(self, mongo_replica_set_url: str):
        """The interleaving the per-choice renewal exists for: media granted at the registration, withdrawn on the account page, then admitted.

        The press is the account page's own composer over the stored block, so the case drives what that write leaves.
        """

        stored_id = ObjectId()
        bestaetigt = compose_confirmation_update(
            geburtsdatum=GEBURTSDATUM, umfang="intern", medien=True, text_version="2026-09", today="2026-03-31", am="2026-03-31T08:00:00+00:00"
        )["$set"]["einwilligung"]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_one(
                a_stored_person(stored_id, einwilligung={**documents.EINWILLIGUNG, "text_version": "2025-09", "medien": True})
            )
            registrierung_id = await seed(database, registrierung_document(einwilligung=bestaetigt))
            stored = (await database[Collection.SPIELER].find_one({"_id": stored_id}) or {})["einwilligung"]
            press = compose_person_move(
                gespeichert=stored, gewaehlt={"medien": False}, am="2026-04-01T09:00:00+00:00", text_version=KONTO_LABEL
            )
            assert press is not None, "the press moved nothing, so this case proves nothing"
            await database[Collection.SPIELER].update_one({"_id": stored_id}, press)
            await admit(database, client, registrierung_id)

            return (await persons(database))[0]["einwilligung"]

        einwilligung = on_a_league(mongo_replica_set_url, body)

        # The withdrawal is newer than the registration's grant, so it stands with its own evidence,
        # naming the stored grant it ended by that record's confirmation day.
        assert (einwilligung["medien"], einwilligung["nachweis"]["medien"]) == (
            False,
            {
                "am": "2026-04-01T09:00:00+00:00",
                "text_version": KONTO_LABEL,
                "erteilt_zuvor": {"am": "2026-01-19T23:00:00+00:00", "text_version": "2025-09"},
            },
        )
        # The scope set at the registration is newer than the person's stored grant, so it is renewed,
        # naming that grant by its record's confirmation day.
        assert (einwilligung["umfang"], einwilligung["nachweis"]["umfang"]) == (
            "intern",
            {
                "am": "2026-03-31T08:00:00+00:00",
                "text_version": "2026-09",
                "erteilt_zuvor": {"am": "2026-01-19T23:00:00+00:00", "text_version": "2025-09"},
            },
        )
        assert (einwilligung["bestaetigt_am"], einwilligung["text_version"]) == ("2026-03-31", "2026-09")

    def test_a_withdrawal_the_pupil_made_on_the_pending_registration_is_carried(self, mongo_replica_set_url: str):
        """The account page's registration control, then the admission: the withdrawal is newer than every grant, so it stands."""

        stored_id = ObjectId()
        bestaetigt = compose_confirmation_update(
            geburtsdatum=GEBURTSDATUM, umfang="intern", medien=True, text_version="2026-09", today="2026-03-31", am="2026-03-31T08:00:00+00:00"
        )["$set"]["einwilligung"]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_one(
                a_stored_person(stored_id, einwilligung={**documents.EINWILLIGUNG, "text_version": "2025-09", "medien": True})
            )
            registrierung_id = await seed(database, registrierung_document(einwilligung=bestaetigt))
            await patch_registrierung_einwilligung(
                registrierung_id=registrierung_id,
                einwilligung_data=FLRegistrierungSelbstEinwilligungPayload.model_validate(
                    {
                        "umfang": "intern",
                        "medien": False,
                        "text_version": KONTO_LABEL,
                        "nachweis_stand": nachweis_stand_of(bloecke=[bestaetigt], wahlen=WAHLEN),
                    }
                ),
                identifier=FOLDED_EMAIL,
                registrierungen_collection=database[Collection.REGISTRIERUNGEN],
                db=client,
                germany_now=WITHDRAWN_AT,
            )
            await admit(database, client, registrierung_id)

            return (await persons(database))[0]["einwilligung"]

        einwilligung = on_a_league(mongo_replica_set_url, body)

        # Carried onto the person, the withdrawal ends the grant the PERSON's record held, named by that
        # record's confirmation day, as the account page's own press on it would.
        assert (einwilligung["medien"], einwilligung["nachweis"]["medien"]) == (
            False,
            {
                "am": "2026-04-01T07:00:00+00:00",
                "text_version": KONTO_LABEL,
                "erteilt_zuvor": {"am": "2026-01-19T23:00:00+00:00", "text_version": "2025-09"},
            },
        )

    def test_a_body_naming_anyone_but_the_address_match_is_refused(self, mongo_replica_set_url: str):
        legacy_id = ObjectId()

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_many([a_stored_person(ObjectId()), a_stored_person(legacy_id, email=None)])
            registrierung_id = await seed(database, registrierung_document())

            return await refused(admit(database, client, registrierung_id, spieler_id=legacy_id))

        assert on_a_league(mongo_replica_set_url, body) == REGISTRIERUNG_PERSON_NICHT_BENANNT

    def test_the_proposed_person_takes_the_registrations_address(self, mongo_replica_set_url: str):
        legacy_id = ObjectId()

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_one(a_stored_person(legacy_id, email=None, geburtsdatum=None))
            registrierung_id = await seed(database, registrierung_document())
            listed = await read(database, client)
            answer = await admit(database, client, registrierung_id, spieler_id=legacy_id)

            return listed.registrierungen[0], answer.spieler_id, await persons(database)

        row, admitted, stored = on_a_league(mongo_replica_set_url, body)

        assert row.person is None and row.vorschlag is not None and row.vorschlag.spieler_id == legacy_id
        assert admitted == legacy_id
        assert [(person["_id"], person["email"]) for person in stored] == [(legacy_id, FOLDED_EMAIL)]

    def test_two_addressless_namesakes_are_proposed_neither(self, mongo_replica_set_url: str):
        """No birthdate is served, so the two would read identically and the team would be guessing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_many(
                [a_stored_person(ObjectId(), email=None, geburtsdatum=None), a_stored_person(ObjectId(), email=None, geburtsdatum=None)]
            )
            await seed(database, registrierung_document())

            return (await read(database, client)).registrierungen[0].vorschlag

        assert on_a_league(mongo_replica_set_url, body) is None

    @pytest.mark.parametrize(
        "named",
        [
            a_stored_person(ObjectId(), email="andere@beispielschule.de"),
            a_stored_person(ObjectId(), email=None, vorname="Lysander"),
            a_stored_person(ObjectId(), email=None, geburtsdatum="2008-01-01"),
        ],
        ids=("a person holding another address", "another name", "another birthdate"),
    )
    def test_a_body_naming_no_admissible_proposal_is_refused_and_writes_nothing(self, mongo_replica_set_url: str, named: Mapping[str, Any]):
        """A person holding another address is never proposed: a yes would hand their record to whoever holds the registering mailbox."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_one(dict(named))
            registrierung_id = await seed(database, registrierung_document())
            before = await snapshot(database)
            code = await refused(admit(database, client, registrierung_id, spieler_id=named["_id"]))

            return code, before, await snapshot(database)

        code, before, after = on_a_league(mongo_replica_set_url, body)

        assert code == REGISTRIERUNG_PERSON_NICHT_BENANNT
        assert after == before


async def confirm_as_returning(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    """The returning pupil's page pressed: a birthdate, its label, and no choice."""

    return await post_bestaetigung(
        antwort_data=FLRegistrierungBestaetigungPayload(
            token=TOKEN,
            geburtsdatum=GEBURTSDATUM,
            umfang=None,
            medien=None,
            text_version=LAUFENDE_FASSUNGEN["bestaetigung_spieler_wiederkehrend"],
        ),
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
        spieler_collection=database[Collection.SPIELER],
        sperrliste=ban_list(database),
        db=client,
        today=TODAY,
        germany_now=NOW,
    )


class TestAReturningRegistration:
    """`docs/backend/spec.md :: I867`: a registration confirmed on the returning pupil's page moves nothing on the person's record."""

    # Confirmed under an older label, its media grant standing, so a renewal of either choice or a
    # restamp of the label would each move a byte.
    HELD = {**documents.EINWILLIGUNG, "text_version": "2025-09", "medien": True}

    @pytest.mark.parametrize("namesake", [False, True], ids=("a new person", "an addressless namesake the body names"))
    def test_its_person_erased_before_the_admission_admits_nobody(self, mongo_replica_set_url: str, namesake: bool):
        """Erased through the administrator's own erasure between the press and the admission, which needs the person retired first.

        Neither a new person nor a namesake: the registration carries no choice for either to stand on.
        """

        stored_id = ObjectId()
        legacy_id = ObjectId()

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_one(a_stored_person(stored_id, einwilligung=dict(self.HELD), inactive_since="2025-07-01"))
            if namesake:
                await database[Collection.SPIELER].insert_one(a_stored_person(legacy_id, email=None, geburtsdatum=None))
            registrierung_id = await seed(database, registrierung_document(confirmed=False))
            await confirm_as_returning(database, client)
            await erase_spieler(
                spieler_id=stored_id,
                spieler_collection=database[Collection.SPIELER],
                saison_spieler_collection=database[Collection.SAISON_SPIELER],
                aktionen_collection=database[Collection.AKTIONEN],
                db=client,
                germany_now=NOW,
            )
            before = await snapshot(database)
            code = await refused(admit(database, client, registrierung_id, spieler_id=legacy_id if namesake else None))

            return code, before, await snapshot(database)

        code, before, after = on_a_league(mongo_replica_set_url, body)

        assert code == REGISTRIERUNG_PERSON_FEHLT
        assert after == before

    def test_the_admission_leaves_the_persons_record_byte_for_byte(self, mongo_replica_set_url: str):
        stored_id = ObjectId()

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_one(a_stored_person(stored_id, einwilligung=dict(self.HELD)))
            registrierung_id = await seed(database, registrierung_document(confirmed=False))
            await confirm_as_returning(database, client)
            answer = await admit(database, client, registrierung_id)

            return answer.spieler_id, (await persons(database))[0]

        admitted, person = on_a_league(mongo_replica_set_url, body)

        assert admitted == person["_id"] == stored_id
        assert person["einwilligung"] == self.HELD
        # The rest of the admission still lands on the person: the registration's birthdate and address.
        assert (person["geburtsdatum"], person["email"]) == (GEBURTSDATUM, FOLDED_EMAIL)

    def test_a_withdrawal_made_while_the_page_stood_open_stands(self, mongo_replica_set_url: str):
        """The page opened showing media on, the account page withdrew it, the page was pressed, the team admitted.

        A press sending the choices its page showed would stamp that grant after the withdrawal, and the admission carry it.
        """

        stored_id = ObjectId()

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_one(a_stored_person(stored_id, einwilligung=dict(self.HELD)))
            registrierung_id = await seed(database, registrierung_document(confirmed=False))
            view = await get_bestaetigung_ansicht(
                ansicht_data=FLRegistrierungBestaetigungAnsichtPayload(token=TOKEN),
                registrierungen_collection=database[Collection.REGISTRIERUNGEN],
                teams_collection=database[Collection.TEAMS],
                spieler_collection=database[Collection.SPIELER],
                sperrliste=ban_list(database),
                today=TODAY,
            )
            held = (await database[Collection.SPIELER].find_one({"_id": stored_id}) or {})["einwilligung"]
            press = compose_person_move(gespeichert=held, gewaehlt={"medien": False}, am="2026-04-01T09:00:00+00:00", text_version=KONTO_LABEL)
            assert press is not None, "the withdrawal moved nothing, so this case proves nothing"
            await database[Collection.SPIELER].update_one({"_id": stored_id}, press)
            await confirm_as_returning(database, client)
            await admit(database, client, registrierung_id)

            return view, (await persons(database))[0]["einwilligung"]

        view, einwilligung = on_a_league(mongo_replica_set_url, body)

        assert (view.seite, view.medien) == ("bestaetigung_spieler_wiederkehrend", True)
        assert (einwilligung["medien"], einwilligung["nachweis"]["medien"]["text_version"]) == (False, KONTO_LABEL)


class TestARetiredPerson:
    def test_the_person_comes_back_and_no_second_one_is_written(self, mongo_replica_set_url: str):
        stored_id = ObjectId()

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_one(a_stored_person(stored_id, inactive_since="2025-07-01"))
            await admit(database, client, await seed(database, registrierung_document()))

            return await persons(database)

        stored = on_a_league(mongo_replica_set_url, body)

        assert [(person["_id"], person["inactive_since"]) for person in stored] == [(stored_id, None)]

    @pytest.mark.parametrize("team_id", [TEAM_OID, OTHER_TEAM_OID], ids=("on this team", "on another team"))
    def test_their_retired_row_of_the_season_is_rewritten_rather_than_a_second_written(self, mongo_replica_set_url: str, team_id: ObjectId):
        """`uniq_spieler_id_saison_id` keeps one row per player per season, a retired one included."""

        stored_id = ObjectId()

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_one(a_stored_person(stored_id))
            await database[Collection.SAISON_SPIELER].insert_one(
                documents.saison_spieler_document(stored_id, SAISON_ID, team_id, nummer="9", rolle="kapitaen", inactive_since="2026-03-01")
            )
            await admit(database, client, await seed(database, registrierung_document()))

            return await squad_rows(database, spieler_id=stored_id)

        rows = on_a_league(mongo_replica_set_url, body)

        assert len(rows) == 1
        assert {key: rows[0][key] for key in ("team_id", "nummer", "rolle", "inactive_since")} == {
            "team_id": TEAM_OID,
            "nummer": "17",
            "rolle": None,
            "inactive_since": None,
        }


class TestAPersonAlreadyInASquad:
    @pytest.mark.parametrize("team_id", [TEAM_OID, OTHER_TEAM_OID], ids=("this team", "another team"))
    def test_a_live_row_this_season_refuses_the_admission(self, mongo_replica_set_url: str, team_id: ObjectId):
        stored_id = ObjectId()

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_one(a_stored_person(stored_id))
            await database[Collection.SAISON_SPIELER].insert_one(documents.saison_spieler_document(stored_id, SAISON_ID, team_id, nummer="9"))
            registrierung_id = await seed(database, registrierung_document())
            before = await snapshot(database)
            code = await refused(admit(database, client, registrierung_id))

            return code, before, await snapshot(database)

        code, before, after = on_a_league(mongo_replica_set_url, body)

        assert code == REGISTRIERUNG_SCHON_IM_KADER
        assert after == before


class TestOneAddressAdmittedTwiceAtOnce:
    def test_a_rival_admission_of_the_address_landing_inside_leaves_one_person(self, mongo_replica_set_url: str):
        """The rival commits the person after this admission found the address unheld, before its insert.

        Two seasons, so the address alone is shared: the insert conflicts, and the retry admits into
        the rival's person.
        """

        answers: list[Any] = []

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await seed(database, registrierung_document())
            second = await seed(database, registrierung_document(saison_id=NEXT_SAISON_ID, token="Zt5rYb8nK2wQ7xM4jL9cV6sD1fH3gP0aU5eI7oT2mXk"))

            async def the_rival_writes_the_person() -> None:
                answers.append(await admit(database, client, second))

            spieler = PersonsRunningARivalBeforeTheInsert(database[Collection.SPIELER], the_rival_writes_the_person)
            outcome = await outcome_of(admit(database, client, first, spieler=spieler))
            # Serially the address resolves before any insert; landing inside, the first attempt reaches it.
            spieler.assert_landed_inside(serially=0)

            return outcome, await persons(database), await squad_rows(database, spieler_id=answers[0].spieler_id)

        outcome, stored, rows = on_a_league(mongo_replica_set_url, body)

        assert outcome == COMMITTED
        assert [person["_id"] for person in stored] == [answers[0].spieler_id]
        assert sorted(row["saison_id"] for row in rows) == [SAISON_ID, NEXT_SAISON_ID]


class TestEverySeatActsAlike:
    @pytest.mark.parametrize("identifier", [ANNA, THEO, STELLA], ids=("an Ansprechperson", "a Trainer-only seat", "a Stellvertretung"))
    def test_a_seat_reads_admits_and_declines(self, mongo_replica_set_url: str, identifier: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            admitted = await seed(database, registrierung_document())
            declined = await seed(database, registrierung_document(email="zweite@beispielschule.de", vorname="Zweite"))
            listed = await read(database, client, identifier=identifier)
            await admit(database, client, admitted, identifier=identifier)
            await decline(database, client, declined, identifier=identifier)

            return len(listed.registrierungen), await database[Collection.REGISTRIERUNGEN].find_one({"_id": declined})

        listed, declined = on_a_league(mongo_replica_set_url, body)

        assert listed == 2
        assert declined is not None and declined["status"] == "abgelehnt"

    @pytest.mark.parametrize("operation", ["read", "admit", "decline"])
    @pytest.mark.parametrize(
        ("identifier", "stellvertretung_bestaetigt", "saison_id"),
        [(OTTO, True, SAISON_ID), (STELLA, False, SAISON_ID), (PAULA, True, PAST_SAISON_ID), (NORA, True, SAISON_ID)],
        ids=("another team's seat", "an unconfirmed seat", "a past season's seat on its own registration", "a seat in another season"),
    )
    def test_a_seat_granting_nothing_here_is_refused_and_writes_nothing(
        self, mongo_replica_set_url: str, operation: str, identifier: str, stellvertretung_bestaetigt: bool, saison_id: str
    ):
        """Paula's registration is in her own seat's season: one submitted before a rollover stays pending past it.

        There the season matches, and the `past` status alone refuses (`docs/backend/spec.md :: I375`).
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            registrierung_id = await seed(database, registrierung_document(saison_id=saison_id))
            before = await snapshot(database)
            call = {
                "read": lambda: read(database, client, identifier=identifier, saison_id=saison_id),
                "admit": lambda: admit(database, client, registrierung_id, identifier=identifier),
                "decline": lambda: decline(database, client, registrierung_id, identifier=identifier),
            }[operation]
            code = await refused(call())

            return code, before, await snapshot(database)

        code, before, after = on_a_league(mongo_replica_set_url, body, stellvertretung_bestaetigt=stellvertretung_bestaetigt)

        assert code == FUNKTION_NICHT_GEHALTEN
        assert after == before


class TestTheDecline:
    @pytest.mark.parametrize("grund", [None, "andere_person"])
    def test_it_writes_the_state_and_the_decision_and_nothing_else(self, mongo_replica_set_url: str, grund: str | None):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            registrierung_id = await seed(database, registrierung_document())
            before = await database[Collection.REGISTRIERUNGEN].find_one({"_id": registrierung_id})
            answer = await decline(database, client, registrierung_id, grund=grund, identifier=THEO)

            return before, await database[Collection.REGISTRIERUNGEN].find_one({"_id": registrierung_id}), answer

        before, after, answer = on_a_league(mongo_replica_set_url, body)

        assert after == {**before, "status": "abgelehnt", "entscheidung": {"getroffen_am": TODAY, "von": THEO, "grund": grund}}
        assert (answer.email, answer.bestaetigt, answer.team, answer.grund) == (TYPED_EMAIL, True, "Zorbanax", grund)

    def test_a_decided_registration_answers_404_to_either_press(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            registrierung_id = await seed(database, registrierung_document())
            await decline(database, client, registrierung_id)
            before = await snapshot(database)
            for press in (decline, admit):
                with pytest.raises(DocumentNotFoundException):
                    await press(database, client, registrierung_id)

            return before, await snapshot(database)

        before, after = on_a_league(mongo_replica_set_url, body)

        assert after == before

    def test_an_unconfirmed_registration_may_be_declined_and_says_so(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return (await decline(database, client, await seed(database, registrierung_document(confirmed=False)))).bestaetigt

        assert on_a_league(mongo_replica_set_url, body) is False


@functools.cache
def _served() -> FastAPI:
    return create_app(WIRE_CONFIG)


def keys_at_every_depth(value: Any) -> Iterator[str]:
    if isinstance(value, Mapping):
        for key, inner in value.items():
            yield key
            yield from keys_at_every_depth(inner)
    elif isinstance(value, list):
        for inner in value:
            yield from keys_at_every_depth(inner)


class TestThePendingReadServesNoAddress:
    def test_no_key_or_value_of_an_address_birthdate_or_consent_at_any_depth(self, mongo_replica_set_url: str):
        """Over the serialised body, so a nested block cannot smuggle one in.

        A match, a proposal and an unconfirmed row at once, each with a stored address and birthdate to find.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_many(
                [a_stored_person(ObjectId(), vorname="Thessa"), a_stored_person(ObjectId(), email=None, vorname="Zweite", geburtsdatum=None)]
            )
            await seed(database, registrierung_document())
            await seed(database, registrierung_document(email="zweite@beispielschule.de", vorname="Zweite"))
            await seed(database, registrierung_document(confirmed=False, email="dritte@beispielschule.de", vorname="Dritte"))

            async with app_client(mongo_replica_set_url, app=_served(), now=NOW) as http:
                response = await http.get(
                    f"/api/v{API_VERSION}/registrierungen/kader/{TEAM_OID}/{SAISON_ID}", headers=SignedActor(ANNA, ADMIN_KEY, lane="person")
                )

            return response.status_code, response.json()

        status, served = on_a_league(mongo_replica_set_url, body)

        assert status == 200
        assert len(served["registrierungen"]) == 3
        assert {"person", "vorschlag"} <= set(keys_at_every_depth(served))
        assert not {"email", "telefon", "geburtsdatum", "einwilligung"} & set(keys_at_every_depth(served))
        text = json.dumps(served)
        assert not any(value in text for value in ("beispielschule.de", GEBURTSDATUM, "@"))
