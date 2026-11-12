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

from app.api.account.services import compose_person_move
from app.api.outbox.services import row_of
from app.api.registrierungen import person_router
from app.api.registrierungen.crud import OPEN_REGISTRIERUNGEN_CAP
from app.api.registrierungen.person_router import get_open_registrierungen
from app.api.registrierungen.person_router import patch_einwilligung as patch_registrierung_einwilligung
from app.api.registrierungen.public_router import post_confirmation
from app.api.registrierungen.schemas import (
    FLRegistrierungAdmitPayload,
    FLRegistrierungConfirmationPayload,
    FLRegistrierungDeclinePayload,
)
from app.api.registrierungen.services import (
    compose_confirmation_update,
    confirmation_mail,
)
from app.core.codes import Code
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.exceptions import APIError, DocumentNotFoundError
from app.main import create_app
from app.shared.einwilligung_evidence import evidence_state_of
from app.shared.schemas.einwilligung import FLAccountEinwilligungPayload, FLSpielerTextVersions
from app.shared.tokens import hash_token
from tests import documents
from tests.acts import acts_of
from tests.app_client import app_client
from tests.config import ADMIN_KEY, build_test_config
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import SPIELER_TEXT_VERSIONS
from tests.isolation import COMMITTED, InterleavedCollection, outcome_of
from tests.outbox import MAIL_NOW, drained
from tests.records import record_collections
from tests.session_headers import StampedHeaders
from tests.whole_database import where_held
from tests.worker import worker_database

# Module level: every case below reaches a real mongod, each write being one transaction.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_registrierung_admission_test")
WIRE_CONFIG = build_test_config().model_copy(update={"db_base_name": DATABASE_NAME})

SAISON_ID = "2026"
NEXT_SAISON_ID = "2027"
PAST_SAISON_ID = "2025"
TODAY = "2026-04-01"
# The active season's start unless a case says so: after `TODAY`, so an admission is an ordinary entry.
AFTER_TODAY = "2026-04-20"
# The day every registration here was submitted, the day its marker is judged on.
SUBMITTED_AT = "2026-03-30"
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

# As a visitor may type it, and the fold every record stores it under.
TYPED_EMAIL = "Thessaly.Okonkwo@beispielschule.de"
FOLDED_EMAIL = "thessaly.okonkwo@beispielschule.de"
BIRTH_DATE = "2009-05-04"
# The label of the media wording a press withdrawing it is given under.
MEDIA_LABEL = SPIELER_TEXT_VERSIONS["media"]
TOKEN = "hwGqQ4kP6yJr3VnZbT8sXeM2dLuF9aCwR1oY5iN7pKg"

RULES: Mapping[str, Any] = documents.rules_document(max_kader_size=3, allowed_stufen=["Q1", "Q2"])


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def kontakte(*, ansprechperson: str, trainer: str | None = None, stellvertretung: str | None = None, confirmed: bool = True) -> dict[str, Any]:
    """`confirmed` is the Stellvertretung's own stamp alone: an unconfirmed seat grants no panel."""

    stamp = "2026-03-21"

    return {
        "trainer": None if trainer is None else documents.kontaktperson_document(trainer, confirmed_at=stamp),
        "ansprechperson": documents.kontaktperson_document(ansprechperson, confirmed_at=stamp),
        "stellvertretung": None
        if stellvertretung is None
        else documents.kontaktperson_document(stellvertretung, confirmed_at=stamp if confirmed else None),
        "trainer_is_also": None,
    }


def on_a_league(
    url: str,
    body: Body,
    *,
    squad: int = 0,
    registrierung: Any = None,
    stellvertretung_confirmed: bool = True,
) -> Any:
    """Two clubs in one active season, each with seats; `kader` live rows already on the first club.

    The first club also plays the `past` season before and the `future` one after, each seated by
    somebody holding no seat this season.
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.SAISONS].insert_one(
                documents.saison_document(SAISON_ID, "active", start_date=AFTER_TODAY, rules=dict(RULES), registrierung=registrierung)
            )
            await database[Collection.TEAMS].insert_many(
                [documents.team_document(TEAM_OID, "Zorbanax", "ZOX"), documents.team_document(OTHER_TEAM_OID, "Quillhilde", "QUX")]
            )
            await database[Collection.SAISON_TEAMS].insert_many(
                [
                    documents.saison_team_document(
                        SAISON_ID,
                        TEAM_OID,
                        "Zorbanax",
                        "ZOX",
                        kontakte=kontakte(ansprechperson="Anna", trainer="Theo", stellvertretung="Stella", confirmed=stellvertretung_confirmed),
                    ),
                    documents.saison_team_document(SAISON_ID, OTHER_TEAM_OID, "Quillhilde", "QUX", kontakte=kontakte(ansprechperson="Otto")),
                ]
            )
            await database[Collection.SAISONS].insert_many(
                [
                    documents.saison_document(NEXT_SAISON_ID, "future", rules=documents.rules_document(allowed_stufen=["Q1", "Q2"])),
                    documents.saison_document(PAST_SAISON_ID, "past"),
                ]
            )
            await database[Collection.SAISON_TEAMS].insert_many(
                [
                    documents.saison_team_document(
                        NEXT_SAISON_ID, TEAM_OID, "Zorbanax", "ZOX", kontakte=kontakte(ansprechperson="Anna", trainer="Nora")
                    ),
                    documents.saison_team_document(PAST_SAISON_ID, TEAM_OID, "Zorbanax", "ZOX", kontakte=kontakte(ansprechperson="Paula")),
                ]
            )

            if squad:
                await database[Collection.SAISON_SPIELER].insert_many(
                    [documents.saison_spieler_document(ObjectId(), SAISON_ID, TEAM_OID, nummer=str(seat)) for seat in range(squad)]
                )

            return await body(database, client)

    return on_the_seed_loop(_run())


def registrierung_document(
    *,
    confirmed: bool = True,
    saison_id: str = SAISON_ID,
    team_id: ObjectId = TEAM_OID,
    email: str = FOLDED_EMAIL,
    first_name: str = "Thessaly",
    last_name: str = "Okonkwo-Brandt",
    birth_date: str = BIRTH_DATE,
    token: str = TOKEN,
    position: str | None = "Mittelfeld",
    nummer: str | None = "17",
    stufe: str | None = "Q1",
    **fields: Any,
) -> dict[str, Any]:
    """A registration as the submission and, where `confirmed`, the pupil's own confirmation leave it."""

    return documents.registrierung_document(
        ObjectId(),
        email,
        saison_id=saison_id,
        team_id=team_id,
        first_name=first_name,
        last_name=last_name,
        token=token,
        submitted_at=SUBMITTED_AT,
        deadline="2026-04-06",
        position=position,
        nummer=nummer,
        stufe=stufe,
        confirmed=None
        if not confirmed
        else {
            "birth_date": birth_date,
            "scope": "internal",
            "media": False,
            "text_versions": SPIELER_TEXT_VERSIONS,
            "today": "2026-03-31",
            "at": "2026-03-31T08:00:00+00:00",
        },
        **fields,
    )


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

    return await person_router.admit(
        registrierung_id=registrierung_id,
        admit_data=FLRegistrierungAdmitPayload(spieler_id=spieler_id),
        identifier=identifier,
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS] if saisons is None else saisons,
        spieler_collection=database[Collection.SPIELER] if spieler is None else spieler,
        records=record_collections(
            database,
            spieler_collection=database[Collection.SPIELER] if spieler is None else spieler,
        ),
        db=client,
    )


async def decline(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    registrierung_id: Any,
    *,
    reason: Any = None,
    identifier: str = ANNA,
    registrierungen: Any = None,
) -> Any:
    return await person_router.decline(
        registrierung_id=registrierung_id,
        decline_data=FLRegistrierungDeclinePayload(reason=reason),
        identifier=identifier,
        registrierungen_collection=database[Collection.REGISTRIERUNGEN] if registrierungen is None else registrierungen,
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        outbox_collection=database[Collection.OUTBOX],
        records=record_collections(database),
        db=client,
        today=TODAY,
        germany_now=MAIL_NOW,
    )


async def notes_owed(database: AsyncDatabase) -> list[Mapping[str, Any]]:
    return await database[Collection.OUTBOX].find({"kind": "registrierung_absage"}).to_list(length=None)


async def read(
    database: AsyncDatabase, client: AsyncMongoClient, *, identifier: str = ANNA, team_id: ObjectId = TEAM_OID, saison_id: str = SAISON_ID
) -> Any:
    async with client.start_session(snapshot=True) as session:
        return await get_open_registrierungen(
            team_id=team_id,
            saison_id=saison_id,
            identifier=identifier,
            registrierungen_collection=database[Collection.REGISTRIERUNGEN],
            saison_spieler_collection=database[Collection.SAISON_SPIELER],
            saisons_collection=database[Collection.SAISONS],
            spieler_collection=database[Collection.SPIELER],
            records=record_collections(database),
            session=session,
        )


async def refused(call: Awaitable[Any]) -> str:
    with pytest.raises(APIError) as refusal:
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
    stored = {"birth_date": BIRTH_DATE, **fields}
    if email is not None:
        stored["email"] = email

    return documents.spieler_document(spieler_id, stored.pop("first_name", "Thessaly"), stored.pop("last_name", "Okonkwo-Brandt"), **stored)


# A person's record as their own earlier confirmation left it, both choices granted, and the evidence each choice left.
STORED_AT = "2026-01-20T11:00:00+00:00"
STORED_GRANT = {choice: {"at": STORED_AT, "text_version": label} for choice, label in SPIELER_TEXT_VERSIONS.items()}


def granted_by_an_earlier_registration() -> dict[str, Any]:
    return documents.own_einwilligung_document(
        text_versions=documents.SPIELER_TEXT_VERSIONS, confirmed_at="2026-01-20", at=STORED_AT, media=True
    )


class TestWhatAnAdmissionWrites:
    def test_a_new_person_is_written_with_the_folded_address_and_the_registrations_record(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            registrierung_id = await seed(database, registrierung_document())
            answer = await admit(database, client, registrierung_id)

            return answer, await persons(database), await squad_rows(database, spieler_id=answer.spieler_id), await acts_of(database)

        answer, stored, rows, acts = on_a_league(mongo_replica_set_url, body)

        assert acts == [("registrierung.admitted", "kontakt", "Zorbanax", answer.registrierung_id)]
        assert [person["_id"] for person in stored] == [answer.spieler_id]
        person = stored[0]
        assert (person["email"], person["first_name"], person["last_name"], person["birth_date"]) == (
            FOLDED_EMAIL,
            "Thessaly",
            "Okonkwo-Brandt",
            BIRTH_DATE,
        )
        assert person["einwilligung"]["confirmed_at"] == "2026-03-31" and person["einwilligung"]["scope"] == "internal"
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
        """The as-typed address and the link's hash exist in the registration alone; the name and the birthdate became the person."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            registrierung_id = await seed(database, registrierung_document(confirmed=False))
            await post_confirmation(
                answer_data=FLRegistrierungConfirmationPayload(
                    token=TOKEN,
                    birth_date=BIRTH_DATE,
                    scope="internal",
                    media=False,
                    text_versions=FLSpielerTextVersions.model_validate(SPIELER_TEXT_VERSIONS),
                ),
                registrierungen_collection=database[Collection.REGISTRIERUNGEN],
                saison_teams_collection=database[Collection.SAISON_TEAMS],
                db=client,
                today=TODAY,
                germany_now=NOW,
            )
            await admit(database, client, registrierung_id)

            remaining = await database[Collection.REGISTRIERUNGEN].count_documents({})

            # The link's hash alone: the address is the person's too, whom the admission writes.
            return remaining, await where_held(database, hash_token(TOKEN))

        remaining, held = on_a_league(mongo_replica_set_url, body)

        assert remaining == 0
        assert held == {hash_token(TOKEN): []}

    def test_it_writes_nothing_beyond_the_person_the_squad_row_the_anchor_and_the_log(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            registrierung_id = await seed(database, registrierung_document())
            before = await snapshot(database)
            await admit(database, client, registrierung_id)

            return before, await snapshot(database)

        before, after = on_a_league(mongo_replica_set_url, body)

        moved = {name for name in before.keys() | after.keys() if before.get(name) != after.get(name)}
        assert moved == {Collection.SPIELER, Collection.SAISON_SPIELER, Collection.REGISTRIERUNGEN, Collection.SAISONS, Collection.ACTION_LOG}

    def test_a_second_admission_is_refused_and_writes_nothing(self, mongo_replica_set_url: str):
        """The anchor and the log included: a second press that took the season's `$inc` would be a write nobody sees.

        The admitted row is gone, so its id answers as one no row ever held.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            registrierung_id = await seed(database, registrierung_document())
            await admit(database, client, registrierung_id)
            before = await snapshot(database)
            code = await refused(admit(database, client, registrierung_id))

            return code, before, await snapshot(database)

        code, before, after = on_a_league(mongo_replica_set_url, body)

        assert code == Code.ROLE_NOT_HELD
        assert after == before


class TestTheLateEntry:
    """The marker is judged on the day the pupil submitted, so a team admitting late costs nobody a place in the cap."""

    @pytest.mark.parametrize(
        ("window", "flagged"),
        [({"open": True, "end": "2026-03-29"}, True), ({"open": True, "end": SUBMITTED_AT}, False), (None, False)],
        ids=("submitted past the end", "submitted on the last day", "no window stored"),
    )
    def test_the_marker_is_derived_at_the_admission(self, mongo_replica_set_url: str, window: Any, flagged: bool):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            answer = await admit(database, client, await seed(database, registrierung_document()))
            rows = await squad_rows(database, spieler_id=answer.spieler_id)

            return answer.is_nachnominiert, rows[0]["is_nachnominiert"]

        assert on_a_league(mongo_replica_set_url, body, registrierung=window) == (flagged, flagged)

    def test_a_retired_nominee_keeps_the_mark_whatever_the_window_has_moved_to(self, mongo_replica_set_url: str):
        """The mark is never lifted within its season: derived afresh, a moved window would put a nominee back inside the cap."""

        stored_id = ObjectId()

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_one(a_stored_person(stored_id))
            await database[Collection.SAISON_SPIELER].insert_one(
                documents.saison_spieler_document(stored_id, SAISON_ID, TEAM_OID, is_nachnominiert=True, inactive_since="2026-03-01")
            )
            answer = await admit(database, client, await seed(database, registrierung_document()))

            return answer.is_nachnominiert

        assert on_a_league(mongo_replica_set_url, body, registrierung={"open": True, "end": SUBMITTED_AT}) is True


class TestTheStufe:
    def test_a_stufe_the_season_no_longer_offers_is_refused_and_writes_nothing(self, mongo_replica_set_url: str):
        """Seeded past the submission's own refusal, which is how a season narrowed after the pupil registered reaches the admission."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            registrierung_id = await seed(database, registrierung_document(stufe="Q4"))
            before = await snapshot(database)
            code = await refused(admit(database, client, registrierung_id))

            return code, before, await snapshot(database)

        code, before, after = on_a_league(mongo_replica_set_url, body)

        assert code == Code.REGISTRIERUNG_STUFE_NOT_ALLOWED
        assert after == before


class TestTheSquadCap:
    def test_a_nominee_enters_a_full_squad(self, mongo_replica_set_url: str):
        """The cap holds no nominee: refused here, a pupil the league let register late could never be admitted."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await admit(database, client, await seed(database, registrierung_document()))

        answer = on_a_league(mongo_replica_set_url, body, squad=3, registrierung={"open": True, "end": "2026-03-29"})

        assert answer.is_nachnominiert is True

    def test_the_registration_past_the_cap_is_refused_and_every_collection_stays(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            registrierung_id = await seed(database, registrierung_document())
            before = await snapshot(database)
            code = await refused(admit(database, client, registrierung_id))

            return code, before, await snapshot(database)

        code, before, after = on_a_league(mongo_replica_set_url, body, squad=3)

        assert code == Code.KADER_FULL
        assert after == before

    def test_a_rival_admission_landing_inside_takes_the_last_place(self, mongo_replica_set_url: str):
        """The rival commits after this admission read the season, before its anchor write and its count.

        The count reads the earlier snapshot, so it misses the rival's row: the anchor conflicts, the retry
        counts the row, and the cap refuses.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await seed(database, registrierung_document())
            second = await seed(database, registrierung_document(email="zweite@beispielschule.de", first_name="Zweite"))

            async def the_rival_takes_the_place() -> None:
                await admit(database, client, second)

            seasons = InterleavedCollection(database[Collection.SAISONS], the_rival_takes_the_place, before="update_many")
            outcome = await outcome_of(admit(database, client, first, saisons=seasons))
            # Serially the refused admission reaches the anchor once; landing inside, its retry reaches it again.
            seasons.assert_landed_inside(serially=1)

            live = await database[Collection.SAISON_SPIELER].count_documents({"team_id": TEAM_OID, "inactive_since": None})

            return outcome, live, await database[Collection.REGISTRIERUNGEN].count_documents({"_id": first})

        outcome, live, still_pending = on_a_league(mongo_replica_set_url, body, squad=2)

        assert outcome == Code.KADER_FULL
        assert (live, still_pending) == (3, 1)

    @pytest.mark.parametrize(
        ("squad", "window", "retired_nominee", "full"),
        [
            (2, None, False, False),
            (3, None, False, True),
            (3, {"open": True, "end": "2026-03-29"}, False, False),
            (3, {"open": True, "end": SUBMITTED_AT}, True, False),
        ],
        ids=("room left", "at the cap", "a nominee by the window", "a nominee by their stored mark"),
    )
    def test_the_read_marks_a_row_full_exactly_where_its_admission_meets_the_cap(
        self, mongo_replica_set_url: str, squad: int, window: Any, retired_nominee: bool, full: bool
    ):
        """The page locks „Aufnehmen“ on `kader_full`: a mark the admission's own verdict contradicts misleads the team."""

        stored_id = ObjectId()

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if retired_nominee:
                await database[Collection.SPIELER].insert_one(a_stored_person(stored_id))
                await database[Collection.SAISON_SPIELER].insert_one(
                    documents.saison_spieler_document(stored_id, SAISON_ID, OTHER_TEAM_OID, is_nachnominiert=True, inactive_since="2026-03-01")
                )
            registrierung_id = await seed(database, registrierung_document())
            (row,) = (await read(database, client)).registrierungen

            return row.kader_full, await outcome_of(admit(database, client, registrierung_id))

        marked, outcome = on_a_league(mongo_replica_set_url, body, squad=squad, registrierung=window)

        assert (marked, outcome) == (full, Code.KADER_FULL if full else COMMITTED)


class TestAnUnconfirmedRegistration:
    def test_it_is_listed_marked_inadmissible_and_resolved_to_nobody(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_one(a_stored_person(ObjectId()))
            await seed(database, registrierung_document(confirmed=False))

            return (await read(database, client)).registrierungen

        (row,) = on_a_league(mongo_replica_set_url, body)

        assert (row.admissible, row.person) == (False, None)

    def test_the_admission_refuses_it_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            registrierung_id = await seed(database, registrierung_document(confirmed=False))
            before = await snapshot(database)
            code = await refused(admit(database, client, registrierung_id))

            return code, before, await snapshot(database)

        code, before, after = on_a_league(mongo_replica_set_url, body)

        assert code == Code.REGISTRIERUNG_UNCONFIRMED
        assert after == before


class TestThePersonAnAdmissionNames:
    @pytest.mark.parametrize(
        "differs",
        [{"first_name": "Thessa"}, {"birth_date": "2009-05-05"}],
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

        assert person is not None and (person.spieler_id, person.deviates_from) == (stored_id, True)
        assert (code, untouched) == (Code.REGISTRIERUNG_PERSON_NOT_NAMED, True)
        # No second person: the yes overwrites the stored name and birthdate with the confirmed ones.
        assert answer.spieler_id == stored_id
        assert [(row["_id"], row["first_name"], row["birth_date"]) for row in stored] == [(stored_id, "Thessaly", BIRTH_DATE)]

    def test_an_address_match_under_the_same_name_is_admitted_with_no_spieler_id(self, mongo_replica_set_url: str):
        stored_id = ObjectId()

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            # Stored in another case and spacing, which the name fold reads as the same person.
            await database[Collection.SPIELER].insert_one(a_stored_person(stored_id, first_name="THESSALY"))
            registrierung_id = await seed(database, registrierung_document())
            listed = await read(database, client)
            answer = await admit(database, client, registrierung_id)

            return listed.registrierungen[0].person, answer.spieler_id, await persons(database)

        person, admitted, stored = on_a_league(mongo_replica_set_url, body)

        assert person is not None and person.deviates_from is False
        assert admitted == stored_id
        assert len(stored) == 1 and stored[0]["birth_date"] == BIRTH_DATE

    def test_a_returning_persons_record_is_renewed_with_the_registrations_evidence(self, mongo_replica_set_url: str):
        """The confirmation page promises renewal, a narrowed answer left under the older record being ignored.

        The registration's confirmation is the person's own act, so its evidence is what the renewed record proves.
        """

        stored_id = ObjectId()

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_one(
                a_stored_person(stored_id, einwilligung={**granted_by_an_earlier_registration(), "media": False})
            )
            registrierung_id = await seed(database, registrierung_document())
            fresh = (await database[Collection.REGISTRIERUNGEN].find_one({"_id": registrierung_id}) or {})["einwilligung"]
            await admit(database, client, registrierung_id)

            return fresh, (await persons(database))[0]["einwilligung"]

        fresh, einwilligung = on_a_league(mongo_replica_set_url, body)

        assert fresh["evidence"], "the registration carries no evidence, so nothing proves it was carried"
        # The narrowed scope names the grant the stored record held, which its own confirmation evidenced.
        assert fresh["scope"] == "internal", "the registration narrows nothing, so no grant ends here"
        assert einwilligung == {
            **fresh,
            "evidence": {
                **fresh["evidence"],
                "scope": {**fresh["evidence"]["scope"], "given_before": STORED_GRANT["scope"]},
            },
        }

    def test_a_withdrawal_the_person_made_after_confirming_the_registration_stands(self, mongo_replica_set_url: str):
        """The interleaving the per-choice renewal exists for: media granted at the registration, withdrawn on the account page, then admitted.

        The press is the account page's own composer over the stored block, so the case drives what that write leaves.
        """

        stored_id = ObjectId()
        confirmed = compose_confirmation_update(
            birth_date=BIRTH_DATE,
            scope="internal",
            media=True,
            text_versions=SPIELER_TEXT_VERSIONS,
            today="2026-03-31",
            at="2026-03-31T08:00:00+00:00",
        )["$set"]["einwilligung"]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_one(a_stored_person(stored_id, einwilligung=granted_by_an_earlier_registration()))
            registrierung_id = await seed(database, registrierung_document(einwilligung=confirmed))
            stored = (await database[Collection.SPIELER].find_one({"_id": stored_id}) or {})["einwilligung"]
            press = compose_person_move(
                saved=stored, chosen={"media": False}, at="2026-04-01T09:00:00+00:00", text_versions=SPIELER_TEXT_VERSIONS
            )
            assert press is not None, "the press moved nothing, so this case proves nothing"
            await database[Collection.SPIELER].update_one({"_id": stored_id}, press)
            await admit(database, client, registrierung_id)

            return (await persons(database))[0]["einwilligung"]

        einwilligung = on_a_league(mongo_replica_set_url, body)

        # The withdrawal is newer than the registration's grant, so it stands with its own evidence,
        # naming the stored grant it ended.
        assert (einwilligung["media"], einwilligung["evidence"]["media"]) == (
            False,
            {
                "at": "2026-04-01T09:00:00+00:00",
                "text_version": MEDIA_LABEL,
                "given_before": STORED_GRANT["media"],
            },
        )
        # The scope set at the registration is newer than the person's stored grant, so it is renewed,
        # naming that grant.
        assert (einwilligung["scope"], einwilligung["evidence"]["scope"]) == (
            "internal",
            {
                "at": "2026-03-31T08:00:00+00:00",
                "text_version": SPIELER_TEXT_VERSIONS["scope"],
                "given_before": STORED_GRANT["scope"],
            },
        )
        assert einwilligung["confirmed_at"] == "2026-03-31"

    def test_a_withdrawal_the_pupil_made_on_the_pending_registration_is_carried(self, mongo_replica_set_url: str):
        """The account page's registration control, then the admission: the withdrawal is newer than every grant, so it stands."""

        stored_id = ObjectId()
        confirmed = compose_confirmation_update(
            birth_date=BIRTH_DATE,
            scope="internal",
            media=True,
            text_versions=SPIELER_TEXT_VERSIONS,
            today="2026-03-31",
            at="2026-03-31T08:00:00+00:00",
        )["$set"]["einwilligung"]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_one(a_stored_person(stored_id, einwilligung=granted_by_an_earlier_registration()))
            registrierung_id = await seed(database, registrierung_document(einwilligung=confirmed))
            await patch_registrierung_einwilligung(
                registrierung_id=registrierung_id,
                einwilligung_data=FLAccountEinwilligungPayload.model_validate(
                    {
                        "scope": "internal",
                        "media": False,
                        "text_versions": dict(SPIELER_TEXT_VERSIONS),
                        "evidence_state": evidence_state_of(blocks=[confirmed]),
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

        # Carried onto the person, the withdrawal ends the grant the PERSON's record held, as the account
        # page's own press on it would.
        assert (einwilligung["media"], einwilligung["evidence"]["media"]) == (
            False,
            {
                "at": "2026-04-01T07:00:00+00:00",
                "text_version": MEDIA_LABEL,
                "given_before": STORED_GRANT["media"],
            },
        )

    def test_a_body_naming_anyone_but_the_address_match_is_refused(self, mongo_replica_set_url: str):
        other_id = ObjectId()

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_many(
                [a_stored_person(ObjectId()), a_stored_person(other_id, email="andere@beispielschule.de")]
            )
            registrierung_id = await seed(database, registrierung_document())

            return await refused(admit(database, client, registrierung_id, spieler_id=other_id))

        assert on_a_league(mongo_replica_set_url, body) == Code.REGISTRIERUNG_PERSON_NOT_NAMED

    def test_a_body_naming_anyone_where_the_address_resolves_to_nobody_is_refused_and_writes_nothing(self, mongo_replica_set_url: str):
        """A person holding another address is never admitted into: a yes would hand their record to whoever holds the registering mailbox."""

        named = a_stored_person(ObjectId(), email="andere@beispielschule.de")

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_one(dict(named))
            registrierung_id = await seed(database, registrierung_document())
            before = await snapshot(database)
            code = await refused(admit(database, client, registrierung_id, spieler_id=named["_id"]))

            return code, before, await snapshot(database)

        code, before, after = on_a_league(mongo_replica_set_url, body)

        assert code == Code.REGISTRIERUNG_PERSON_NOT_NAMED
        assert after == before


class TestARetiredRow:
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

        assert code == Code.REGISTRIERUNG_ALREADY_IN_KADER
        assert after == before


class TestTheAddressesOtherPendingRows:
    @pytest.mark.parametrize(
        ("team_id", "confirmed"),
        [(TEAM_OID, True), (TEAM_OID, False), (OTHER_TEAM_OID, True)],
        ids=("confirmed on this team", "unconfirmed on this team", "confirmed on another team"),
    )
    def test_they_go_with_the_admission_and_nobody_is_mailed(self, mongo_replica_set_url: str, team_id: ObjectId, confirmed: bool):
        """Left standing, each is refused as already in a squad, and declining a confirmed one mails the pupil just admitted.

        A plus-tagged form of the address stays: it resolves to another person, whom an admission still takes.
        """

        seat = ANNA if team_id == TEAM_OID else OTTO

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            admitted = await seed(database, registrierung_document())
            other = await seed(
                database, registrierung_document(team_id=team_id, confirmed=confirmed, token="Zt5rYb8nK2wQ7xM4jL9cV6sD1fH3gP0aU5eI7oT2mXk")
            )
            tagged = await seed(
                database,
                registrierung_document(
                    email="thessaly.okonkwo+zwei@beispielschule.de", first_name="Zweite", token="Qm3vB7xL1cR9sT4yN6wK2pD8fJ5hG0aZ3eU1iO7kXbc"
                ),
            )
            await admit(database, client, admitted)
            code = await refused(decline(database, client, other, identifier=seat))

            listed = (await read(database, client, identifier=seat, team_id=team_id)).registrierungen
            stored = await database[Collection.REGISTRIERUNGEN].find({}, {"_id": 1}).to_list(length=None)
            counted = await database[Collection.ACTION_LOG].distinct("count", {"action": "registrierung.admitted"})

            return code, tagged, [row.registrierung_id for row in listed], [row["_id"] for row in stored], await notes_owed(database), counted

        code, tagged, listed, stored, owed, counted = on_a_league(mongo_replica_set_url, body)

        assert code == Code.ROLE_NOT_HELD
        # The admission's one act counts the other row it took, so a team asking after it finds why it went.
        assert counted == [1]
        assert stored == [tagged]
        assert listed == ([tagged] if team_id == TEAM_OID else [])
        assert owed == []


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

            # Before the new person's insert, after the address was read and found nobody.
            spieler = InterleavedCollection(database[Collection.SPIELER], the_rival_writes_the_person, before="insert_one")
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
            declined = await seed(database, registrierung_document(email="zweite@beispielschule.de", first_name="Zweite"))
            listed = await read(database, client, identifier=identifier)
            await admit(database, client, admitted, identifier=identifier)
            await decline(database, client, declined, identifier=identifier)

            return len(listed.registrierungen), await database[Collection.REGISTRIERUNGEN].find_one({"_id": declined})

        listed, declined = on_a_league(mongo_replica_set_url, body)

        assert listed == 2
        assert declined is not None and declined["status"] == "declined"

    @pytest.mark.parametrize("operation", ["admit", "decline"])
    def test_an_id_no_registration_holds_answers_as_another_teams_row(self, mongo_replica_set_url: str, operation: str):
        """A seat holder learns nothing of which ids exist: the answer is the seat check's, never a 404."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seed(database, registrierung_document())
            before = await snapshot(database)
            press = admit if operation == "admit" else decline
            code = await refused(press(database, client, ObjectId(), identifier=ANNA))

            return code, before, await snapshot(database)

        code, before, after = on_a_league(mongo_replica_set_url, body)

        assert code == Code.ROLE_NOT_HELD
        assert after == before

    @pytest.mark.parametrize("operation", ["read", "admit", "decline"])
    @pytest.mark.parametrize(
        ("identifier", "stellvertretung_confirmed", "saison_id"),
        [(OTTO, True, SAISON_ID), (STELLA, False, SAISON_ID), (PAULA, True, PAST_SAISON_ID), (NORA, True, SAISON_ID)],
        ids=("another team's seat", "an unconfirmed seat", "a past season's seat on its own registration", "a seat in another season"),
    )
    def test_a_seat_granting_nothing_here_is_refused_and_writes_nothing(
        self, mongo_replica_set_url: str, operation: str, identifier: str, stellvertretung_confirmed: bool, saison_id: str
    ):
        """Paula's registration is in her own seat's season: one submitted before a rollover stays pending past it.

        There the season matches, and the `past` status alone refuses.
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

        code, before, after = on_a_league(mongo_replica_set_url, body, stellvertretung_confirmed=stellvertretung_confirmed)

        assert code == Code.ROLE_NOT_HELD
        assert after == before


class TestTheDecline:
    def test_a_rival_decision_landing_after_its_read_makes_it_retry_and_miss(self, mongo_replica_set_url: str):
        """The rival's decision stands: the decline's write conflicts with it, and the retry's read finds nothing pending."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            registrierung_id = await seed(database, registrierung_document())

            async def the_rival_declines() -> None:
                await decline(database, client, registrierung_id, reason="other_person", identifier=THEO)

            # After the decline read the pending registration, before it writes.
            registrierungen = InterleavedCollection(database[Collection.REGISTRIERUNGEN], the_rival_declines, after="find_one")
            with pytest.raises(DocumentNotFoundError):
                await decline(database, client, registrierung_id, registrierungen=registrierungen)

            return registrierungen.passes, await database[Collection.REGISTRIERUNGEN].find_one({"_id": registrierung_id})

        passes, stored = on_a_league(mongo_replica_set_url, body)

        assert stored is not None and stored["decision"] == {"made_at": TODAY, "reason": "other_person"}
        assert passes == 2, "one read is a decline that wrote over the rival's decision without a retry"

    @pytest.mark.parametrize("reason", [None, "other_person"])
    def test_it_writes_the_state_and_the_decision_and_nothing_else(self, mongo_replica_set_url: str, reason: str | None):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            registrierung_id = await seed(database, registrierung_document())
            before = await database[Collection.REGISTRIERUNGEN].find_one({"_id": registrierung_id})
            await decline(database, client, registrierung_id, reason=reason, identifier=THEO)

            stored = await database[Collection.REGISTRIERUNGEN].find_one({"_id": registrierung_id})

            return before, stored, await notes_owed(database), await acts_of(database)

        before, after, owed, acts = on_a_league(mongo_replica_set_url, body)

        assert after == {**before, "status": "declined", "decision": {"made_at": TODAY, "reason": reason}}
        assert acts == [("registrierung.declined", "kontakt", "Zorbanax", before["_id"])]
        # The confirmed pupil's note, owed in the decline's own transaction.
        assert [(row["to"], row["data"]["team"], row["data"]["reason"]) for row in owed] == [(FOLDED_EMAIL, "Zorbanax", reason)]

    def test_a_decided_registration_answers_404_to_either_press(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            registrierung_id = await seed(database, registrierung_document())
            await decline(database, client, registrierung_id)
            before = await snapshot(database)
            for press in (decline, admit):
                with pytest.raises(DocumentNotFoundError):
                    await press(database, client, registrierung_id)

            return before, await snapshot(database)

        before, after = on_a_league(mongo_replica_set_url, body)

        assert after == before

    def test_an_unconfirmed_registration_may_be_declined_and_owes_nobody_a_note(self, mongo_replica_set_url: str):
        """An unconfirmed address is anybody's typing, and a note to it tells a stranger about a team's decision."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await decline(database, client, await seed(database, registrierung_document(confirmed=False)))

            return await notes_owed(database)

        assert on_a_league(mongo_replica_set_url, body) == []

    def test_its_confirmation_still_owed_goes_with_it_and_no_other_does(self, mongo_replica_set_url: str):
        """Left owed, the mail goes out after the decision with a link the confirmation refuses on a declined row."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            declined = await seed(database, registrierung_document(confirmed=False))
            pending = await seed(database, registrierung_document(confirmed=False, email="zweite@beispielschule.de", first_name="Zweite"))
            for registrierung_id, address in ((declined, FOLDED_EMAIL), (pending, "zweite@beispielschule.de")):
                owed = confirmation_mail(
                    registrierung_id=registrierung_id,
                    key=f"{Collection.REGISTRIERUNGEN}/{registrierung_id}/confirmation",
                    address=address,
                    team="Zorbanax",
                    saison_id=SAISON_ID,
                )
                await database[Collection.OUTBOX].insert_one(row_of(owed, now=MAIL_NOW, secret=None, valid_until=None))
            await decline(database, client, declined)

            return [(mail.to, mail.data.kind) for mail in await drained(database, client)]

        assert on_a_league(mongo_replica_set_url, body) == [("zweite@beispielschule.de", "registrierung_confirmation")]


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


class TestThePendingReadServesTheShirtNumbers:
    def test_each_row_carries_its_number_and_one_the_squad_wears_is_marked(self, mongo_replica_set_url: str):
        """The team decides on the mark before it admits: a number left unread would serve none and mark no double."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seed(database, registrierung_document())
            # The one squad row of `on_a_league` wears „0“.
            await seed(database, registrierung_document(email="doppelt@beispielschule.de", first_name="Doppelt", nummer="0"))

            return (await read(database, client)).registrierungen

        listed = on_a_league(mongo_replica_set_url, body, squad=1)

        assert {row.first_name: (row.nummer, row.nummer_double) for row in listed} == {"Thessaly": ("17", False), "Doppelt": ("0", True)}


class TestThePendingReadsCap:
    def test_a_flood_of_unconfirmed_rows_hides_no_confirmed_one(self, mongo_replica_set_url: str):
        """Anybody holding the link types an unconfirmed row per press, newer than every row a pupil confirmed before.

        A full cap of unconfirmed rows past one confirmed row: newest first alone, the confirmed row is the one cut.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            confirmed = await seed(database, registrierung_document())
            # One insert, in order: each `ObjectId` is newer than the one before, which the read's sort breaks its tie on.
            flood = [
                registrierung_document(confirmed=False, email=f"flut{index}@beispielschule.de", first_name=f"Flut{index}")
                for index in range(OPEN_REGISTRIERUNGEN_CAP)
            ]
            await database[Collection.REGISTRIERUNGEN].insert_many(flood)
            answered = await read(database, client)

            return confirmed, [row["_id"] for row in flood], [row.registrierung_id for row in answered.registrierungen], answered.complete

        confirmed, flood, served, complete = on_a_league(mongo_replica_set_url, body)

        # The confirmed row kept, the room left taken by the newest unconfirmed rows, newest first: the oldest is the one cut.
        assert served == [*reversed(flood[1:]), confirmed]
        assert complete is False

    def test_a_list_inside_the_cap_is_complete(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seed(database, registrierung_document())
            await seed(database, registrierung_document(confirmed=False, email="zweite@beispielschule.de", first_name="Zweite"))

            return (await read(database, client)).complete

        assert on_a_league(mongo_replica_set_url, body) is True


class TestThePendingReadServesNoAddress:
    def test_no_key_or_value_of_an_address_birthdate_or_consent_at_any_depth(self, mongo_replica_set_url: str):
        """Over the serialised body, so a nested block cannot smuggle one in.

        A match, a confirmed row resolving to nobody and an unconfirmed row at once, each with a stored address and birthdate to find.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_one(a_stored_person(ObjectId(), first_name="Thessa"))
            await seed(database, registrierung_document())
            await seed(database, registrierung_document(email="zweite@beispielschule.de", first_name="Zweite"))
            await seed(database, registrierung_document(confirmed=False, email="dritte@beispielschule.de", first_name="Dritte"))

            async with app_client(mongo_replica_set_url, app=_served(), now=NOW) as http:
                response = await http.get(
                    f"/api/v{API_VERSION}/registrierungen/kader/{TEAM_OID}/{SAISON_ID}", headers=StampedHeaders(ANNA, ADMIN_KEY, lane="person")
                )

            return response.status_code, response.json()

        status, served = on_a_league(mongo_replica_set_url, body)

        assert status == 200
        assert len(served["registrierungen"]) == 3
        assert "person" in keys_at_every_depth(served)
        assert not {"email", "phone", "birth_date", "einwilligung"} & set(keys_at_every_depth(served))
        text = json.dumps(served)
        assert not any(value in text for value in ("beispielschule.de", BIRTH_DATE, "@"))
