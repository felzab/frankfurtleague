from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.registrierungen.public_router import get_confirmation_view, post_confirmation
from app.api.registrierungen.schemas import FLRegistrierungConfirmationPayload
from app.api.registrierungen.services import compose_confirmation
from app.core.codes import Code
from app.core.collections import Collection
from app.shared.schemas.confirmation import FLTokenPayload
from app.shared.tokens import hash_token
from tests import documents
from tests.database import a_clean_database
from tests.isolation import refused_code
from tests.stored import the_row
from tests.worker import worker_database

# Module level, as the application's confirmation suite marks its own: every test below reaches a
# real mongod.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_registrierung_einwilligung_test")

SAISON_ID = "2026"
TODAY = "2026-04-01"
# The press's instant, and the UTC spelling its entry records it under.
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
AT = "2026-04-01T10:30:00+00:00"
YESTERDAY = "2026-03-31"
TOMORROW = "2026-04-02"

# Fixed rather than generated, so a failure names the same row every run.
REGISTRIERUNG_OID = ObjectId("6890a1b2c3d4e5f607960001")
INVITATION_OID = ObjectId("6890a1b2c3d4e5f607960002")
TEAM_OID = ObjectId("6890a1b2c3d4e5f607960011")
OTHER_TEAM_OID = ObjectId("6890a1b2c3d4e5f607960012")

TEAM_NAME = "Adler"
TEAM_FULL_NAME = "Zorbanax-Gesamtschule"

# The other team in the league, whose name no link to this team may carry.
OTHER_TEAM_NAME = "Falken"
OTHER_SCHOOL = "Wraxlington"

RAW = "raw-token-for-this-pupil"
TOKEN_HASH = hash_token(RAW)

# Folded, as every address payload stores it, the registration's and the person's alike.
FOLDED_EMAIL = "quillhilde@example.com"

# Against `TODAY`, `2010-04-01` is 16 to the day and `2010-04-02` is 15 years and 364 days.
AT_THE_FLOOR = "2010-04-01"
A_DAY_SHORT = "2010-04-02"
# The labels the confirmation page names.
THIS_SEASONS_LABELS = dict(documents.SPIELER_TEXT_VERSIONS)


def team_document(team_id: ObjectId, name: str, full_name: str) -> dict[str, Any]:
    return documents.team_document(team_id, name, name[:3].upper(), full_name=full_name, website_url=None, schulform="gymnasium_g9")


def registrierung_document(**overrides: Any) -> dict[str, Any]:
    """One submitted registration with its live link, inside its deadline, that each case moves one thing of."""

    return {
        "_id": REGISTRIERUNG_OID,
        "saison_id": SAISON_ID,
        "team_id": TEAM_OID,
        "invitation_id": INVITATION_OID,
        "submitted_at": "2026-03-26",
        "status": "submitted",
        "first_name": "Quillhilde",
        "last_name": "Brackenmoor",
        "email": FOLDED_EMAIL,
        "position": "Abwehr",
        "nummer": "7",
        "stufe": "Q1",
        "birth_date": None,
        "einwilligung": None,
        "confirmation": {**compose_confirmation(today="2026-03-26", deadline=TOMORROW, mailed=True), "token_hashes": [TOKEN_HASH]},
        "decision": None,
        "idempotency_key": str(REGISTRIERUNG_OID),
        **overrides,
    }


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


async def on_a_league(url: str, body: Body, *, registrierungen: list[dict[str, Any]] | None = None) -> Any:
    """A clean database carrying the shipped indexes."""

    async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
        # The other club first, so a link reading whichever club comes first names that one rather than its own.
        await database[Collection.TEAMS].insert_many(
            [
                team_document(OTHER_TEAM_OID, OTHER_TEAM_NAME, f"{OTHER_SCHOOL}-Gymnasium"),
                team_document(TEAM_OID, TEAM_NAME, TEAM_FULL_NAME),
            ]
        )
        await database[Collection.SAISON_TEAMS].insert_many(
            [
                documents.saison_team_document(SAISON_ID, TEAM_OID, TEAM_NAME, "ADX"),
                documents.saison_team_document(SAISON_ID, OTHER_TEAM_OID, OTHER_TEAM_NAME, "OTX"),
            ]
        )
        await database[Collection.REGISTRIERUNGEN].insert_many(registrierungen if registrierungen is not None else [registrierung_document()])

        return await body(database, client)


async def read_view(database: AsyncDatabase, token: str) -> Any:
    return await get_confirmation_view(
        view_data=FLTokenPayload(token=token),
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        teams_collection=database[Collection.TEAMS],
        today=TODAY,
    )


async def answer(database: AsyncDatabase, client: AsyncMongoClient, token: str, *, today: str = TODAY, **overrides: Any) -> Any:
    body = {
        "token": token,
        "birth_date": AT_THE_FLOOR,
        "scope": "kader_public",
        # Off, because the default date is sixteen: a media consent is refused below eighteen.
        "media": False,
        "text_versions": THIS_SEASONS_LABELS,
        **overrides,
    }

    return await post_confirmation(
        answer_data=FLRegistrierungConfirmationPayload.model_validate(body),
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        db=client,
        today=today,
        germany_now=NOW,
    )


async def stored(database: AsyncDatabase) -> Mapping[str, Any]:
    return await the_row(database, Collection.REGISTRIERUNGEN, {"_id": REGISTRIERUNG_OID}, "the seeded registration is gone")


class TestWhatALinkOpens:
    async def test_the_link_carries_no_other_teams_name_and_nothing_else_of_the_registration(self, mongo_replica_set_url: str):
        """A leaked link learns what the mail it arrived in already said, and never a name, the address, the number or the Stufe."""

        rendered = (await on_a_league(mongo_replica_set_url, lambda database, _: read_view(database, RAW))).model_dump_json()

        registration = registrierung_document()
        assert OTHER_TEAM_NAME not in rendered and OTHER_SCHOOL not in rendered
        assert registration["first_name"] not in rendered and registration["last_name"] not in rendered
        assert FOLDED_EMAIL not in rendered
        assert registration["position"] not in rendered and registration["stufe"] not in rendered


class TestWhatAConfirmationWrites:
    """One `$set`: the pairing lands whole, and the hash stays where it is."""

    async def test_the_date_and_the_whole_record_land_together(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW)

            return await stored(database)

        document = await on_a_league(mongo_replica_set_url, body)

        assert document["birth_date"] == AT_THE_FLOOR
        assert document["einwilligung"] == {
            "scope": "kader_public",
            "date": TODAY,
            "confirmed_at": TODAY,
            "media": False,
            "evidence": {
                "scope": {"at": AT, "text_version": THIS_SEASONS_LABELS["scope"]},
                "media": {"at": AT, "text_version": THIS_SEASONS_LABELS["media"]},
            },
        }
        # NOT nulled on use: single use is the stamp's doing, so the reopened link can show its state.
        assert document["confirmation"]["token_hashes"] == [TOKEN_HASH]


class TestTheLinkIsSpentByTheStamp:
    async def test_a_second_press_is_refused_and_the_first_answer_stands(self, mongo_replica_set_url: str):
        """The first answer carries `media`, so a refused press that overwrote either half of the pair turns this red."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW, birth_date=AT_THE_MEDIA_AGE, media=True)

            return (
                await refused_code(answer(database, client, RAW, scope="internal", media=False)),
                await stored(database),
                await read_view(database, RAW),
            )

        code, document, view = await on_a_league(mongo_replica_set_url, body)

        assert code == Code.CONFIRMATION_EXISTS
        assert (document["einwilligung"]["scope"], document["einwilligung"]["media"]) == ("kader_public", True)
        assert (view.state, view.answered_at) == ("confirmed", TODAY)

    async def test_an_age_refusal_spends_nothing(self, mongo_replica_set_url: str):
        """A mistyped year is the commonest error on a date field, and a link voided by one has no remedy but registering again."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return (
                await refused_code(answer(database, client, RAW, birth_date=A_DAY_SHORT)),
                await read_view(database, RAW),
                await stored(database),
            )

        code, view, document = await on_a_league(mongo_replica_set_url, body)

        assert code == Code.CONFIRMATION_AGE
        assert (view.state, view.deadline) == ("valid", TOMORROW)
        assert document == registrierung_document()

    async def test_a_confirmed_pupil_pressing_again_after_the_deadline_is_told_the_answer_stands(self, mongo_replica_set_url: str):
        """Judged as the reopened link shows it: an expired link would tell them to doubt an answer that counted."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            await answer(database, client, RAW)

            # The day after the seeded deadline.
            return await refused_code(answer(database, client, RAW, today="2026-04-03"))

        assert await on_a_league(mongo_replica_set_url, body) == Code.CONFIRMATION_EXISTS

    async def test_an_unanswered_link_past_its_deadline_is_refused(self, mongo_replica_set_url: str):
        expired = registrierung_document(
            confirmation={**compose_confirmation(today="2026-03-20", deadline=YESTERDAY, mailed=True), "token_hashes": [TOKEN_HASH]}
        )

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await refused_code(answer(database, client, RAW)), await stored(database)

        code, document = await on_a_league(mongo_replica_set_url, body, registrierungen=[expired])

        assert code == Code.LINK_EXPIRED
        assert document["einwilligung"] is None

    async def test_a_decided_registration_takes_no_answer_either(self, mongo_replica_set_url: str):
        """One code for both: a pupil whose registration was declined while their link stood open is told the link is over, not why."""

        decision = {"made_at": YESTERDAY, "reason": "other_person"}
        declined = registrierung_document(status="declined", decision=decision)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            return await refused_code(answer(database, client, RAW))

        assert await on_a_league(mongo_replica_set_url, body, registrierungen=[declined]) == Code.LINK_EXPIRED

    @pytest.mark.parametrize("route", ["austritt", "replacement"])
    async def test_a_departed_teams_link_reads_over_and_takes_no_answer(self, mongo_replica_set_url: str, route: str):
        """Its club takes no one in, so the pupil's answer would stand on a registration nobody can ever admit.

        Either way out: a replacement hands the club's row to another club, so it leaves no record to read, only no row.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            junction_row = {"saison_id": SAISON_ID, "team_id": TEAM_OID}
            if route == "austritt":
                austritt = {"type": "rueckzug", "reason": "Schulwechsel", "date": YESTERDAY}
                await database[Collection.SAISON_TEAMS].update_one(junction_row, {"$set": {"austritt": austritt}})
            else:
                await database[Collection.SAISON_TEAMS].delete_one(junction_row)
            view = await read_view(database, RAW)
            return view.state, await refused_code(answer(database, client, RAW)), await stored(database)

        state, code, document = await on_a_league(mongo_replica_set_url, body)

        assert (state, code) == ("expired", Code.LINK_EXPIRED)
        assert document["einwilligung"] is None


# Against `TODAY`, 18 to the day and 17 years and 364 days.
AT_THE_MEDIA_AGE = "2008-04-01"
A_DAY_SHORT_OF_THE_MEDIA_AGE = "2008-04-02"


class TestTheMediaAge:
    """`media_age` at the endpoint: the refusal is wired in, and judged before the write."""

    async def test_a_yes_a_day_short_of_the_media_age_is_refused_and_spends_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return (
                await refused_code(answer(database, client, RAW, birth_date=A_DAY_SHORT_OF_THE_MEDIA_AGE, media=True)),
                await stored(database),
            )

        code, document = await on_a_league(mongo_replica_set_url, body)

        assert code == Code.MEDIA_AGE
        assert document == registrierung_document()
