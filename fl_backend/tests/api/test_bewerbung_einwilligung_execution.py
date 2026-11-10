from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pydantic import TypeAdapter
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.admin_router import post_kontakt_seat, resend_einwilligung
from app.api.bewerbungen.public_router import get_einwilligung_view, post_einwilligung
from app.api.bewerbungen.schemas import FLBewerbungEinwilligungAnswerPayload, FLBewerbungKontaktSeatPayload
from app.core.clock import utc_stamp
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError, DocumentNotFoundError
from app.shared.schemas.bounds import BEWERBUNG_KONTAKT_MAX_AGE_YEARS
from app.shared.schemas.confirmation import FLTokenPayload
from app.shared.schemas.literals import KONTAKT_ROLLEN
from app.shared.tokens import hash_token
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import kontaktperson_document, team_document
from tests.outbox import MAIL_NOW, drained
from tests.worker import worker_database

# Module level, as the submission suite marks its own: every test below reaches a real mongod.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_bewerbung_einwilligung_test")

SAISON_ID = "2026"
TODAY = "2026-04-01"
YESTERDAY = "2026-03-31"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

# Fixed rather than generated, so a failure names the same row every run.
BEWERBUNG_OID = ObjectId("6890a1b2c3d4e5f607950001")
CLUB_OID = ObjectId("6890a1b2c3d4e5f607950011")

CLUB_NAME = "Adler"
SCHOOL_NAME = "Zorbanax"

# The raw tokens the seeded links carry, and what the database holds for each.
RAW_PREFIX = "raw-token-for"
RAW: Mapping[str, str] = {seat: f"{RAW_PREFIX}-{seat}" for seat in KONTAKT_ROLLEN}
HASHES: Mapping[str, str] = {seat: hash_token(raw) for seat, raw in RAW.items()}


A_CHILDS_BIRTHDATE = "2018-01-01"
AN_ADULTS_BIRTHDATE = "1984-05-09"
# 17 years and 364 days against `TODAY`: the one age the two floors answer differently.
A_SEVENTEEN_YEAR_OLDS_BIRTHDATE = "2008-04-02"


# Sought as fragments by the leak searches, so a response carrying any part of a seat's record is caught.
LAST_NAME = "Mustermann"
MAIL_DOMAIN = "example.com"
PHONE = "1234567"


def person(first_name: str) -> dict[str, Any]:
    return kontaktperson_document(
        first_name, last_name=f"{first_name}-{LAST_NAME}", email=f"{first_name.lower()}@{MAIL_DOMAIN}", phone=f"+49 170 {PHONE}"
    )


def kontakte(*, trainer_is_also: str | None = None) -> dict[str, Any]:
    return {
        "trainer": person("Wraxlington"),
        "ansprechperson": person("Wraxlington") if trainer_is_also == "ansprechperson" else person("Quillhilde"),
        "stellvertretung": person("Bramblewick"),
        "trainer_is_also": trainer_is_also,
    }


def bewerbung_document(
    bewerbung_id: ObjectId = BEWERBUNG_OID, *, confirmation_deadline: str = "2026-04-03", **overrides: Any
) -> dict[str, Any]:
    """One submitted application with its three live links, inside its deadline, that each case moves one thing of."""

    stored = documents.bewerbung_document(
        bewerbung_id,
        SAISON_ID,
        "submitted",
        kontakte=kontakte(),
        submitted_at="2026-03-20",
        confirmation_deadline=confirmation_deadline,
        schule=documents.new_schule_document(SCHOOL_NAME, full_name=f"{SCHOOL_NAME}-Gesamtschule", schulform="gesamtschule"),
        link_prefix=RAW_PREFIX,
    )

    return {**stored, **overrides}


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, documents: list[dict[str, Any]] | None = None) -> Any:
    """A clean database carrying the shipped indexes."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.TEAMS].insert_one(team_document(CLUB_OID, CLUB_NAME, "ADX", website_url=None, schulform="gymnasium_g9"))
            await database[Collection.BEWERBUNGEN].insert_many(documents if documents is not None else [bewerbung_document()])

            return await body(database, client)

    return on_the_seed_loop(_run())


async def read_view(database: AsyncDatabase, token: str, *, bewerbungen: Any = None) -> Any:
    return await get_einwilligung_view(
        view_data=FLTokenPayload(token=token),
        bewerbungen_collection=database[Collection.BEWERBUNGEN] if bewerbungen is None else bewerbungen,
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        teams_collection=database[Collection.TEAMS],
        today=TODAY,
    )


async def answer(
    database: AsyncDatabase, client: AsyncMongoClient, token: str, *, bewerbungen: Any = None, now: datetime = NOW, **overrides: Any
) -> Any:
    """One answer through the seat's link; a case reading the mail it owes passes `MAIL_NOW`, which the stamps then carry."""

    # A Widerspruch carries the token alone: every default below is the consent's.
    given = {
        "answer": "given",
        "birth_date": AN_ADULTS_BIRTHDATE,
        "whatsapp": True,
        "media": False,
        "text_versions": dict(documents.SEAT_TEXT_VERSIONS),
    }
    body = {"token": token, **(overrides if overrides.get("answer") == "declined" else {**given, **overrides})}

    return await post_einwilligung(
        answer_data=TypeAdapter(FLBewerbungEinwilligungAnswerPayload).validate_python(body),
        bewerbungen_collection=database[Collection.BEWERBUNGEN] if bewerbungen is None else bewerbungen,
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        outbox_collection=database[Collection.OUTBOX],
        db=client,
        today=TODAY,
        germany_now=now,
    )


async def resend(database: AsyncDatabase, seat: str, bewerbung_id: ObjectId = BEWERBUNG_OID) -> Any:
    return await resend_einwilligung(
        bewerbung_id=bewerbung_id,
        seat=seat,
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        teams_collection=database[Collection.TEAMS],
        outbox_collection=database[Collection.OUTBOX],
        db=database.client,
        today=TODAY,
        germany_now=MAIL_NOW,
    )


async def stored(database: AsyncDatabase, bewerbung_id: ObjectId = BEWERBUNG_OID) -> Mapping[str, Any]:
    found = await database[Collection.BEWERBUNGEN].find_one({"_id": bewerbung_id})
    assert found is not None, "the seeded application is gone"

    return found


class ReadsRecorded:
    """A collection, keeping what each `find_one` answered: the season rows' link tests read it too.

    A delegating wrapper rather than a stub: mongod applies the projection, and a stub would hand
    back whatever the handler asked for.
    """

    def __init__(self, collection: Any) -> None:
        self._collection = collection
        self.answered: list[tuple[Any, Any]] = []

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    # Spelled `filter` because `fl_backend/app/core/crud.py` passes it by that keyword; a rename here
    # is a TypeError at the first helper this collection is handed to.
    async def find_one(self, filter: Any = None, *args: Any, **kwargs: Any) -> Any:
        document = await self._collection.find_one(filter, *args, **kwargs)
        self.answered.append((filter, document))

        return document


def loaded_by_the_link(recorder: ReadsRecorded) -> list[Any]:
    """Every document the TOKEN filter found.

    `fl_backend/app/core/crud.py :: patch_one_in_db` reads the same application twice more, on `_id`
    and unprojected, its pre-image being the log's.
    """

    return [document for db_filter, document in recorder.answered if "$or" in db_filter]


def leaf_paths(document: Any, prefix: str = "") -> set[str]:
    """Every dotted path this document holds a value at.

    An empty block counts as one: it would otherwise vanish from the comparison, and a projection
    widened onto a block this seed leaves empty would pass.
    """

    if not isinstance(document, Mapping) or not document:
        return {prefix} if prefix else set()

    return {path for key, value in document.items() for path in leaf_paths(value, f"{prefix}.{key}" if prefix else key)}


class TestWhatALinkOpens:
    def test_a_live_link_shows_the_seat_and_no_contact_record(self, mongo_replica_set_url: str):
        """`READ-BEWERBUNG-002`: a school, a season and a role, and no name, no stored record or anything a leaked link could act on."""

        response = on_a_league(mongo_replica_set_url, lambda database, _: read_view(database, RAW["ansprechperson"]))

        assert (response.state, response.saison_id, response.schule, response.rolle) == ("valid", SAISON_ID, SCHOOL_NAME, "ansprechperson")
        assert response.also_rolle is None
        rendered = response.model_dump_json()
        assert "Quillhilde" not in rendered and LAST_NAME not in rendered and MAIL_DOMAIN not in rendered and PHONE not in rendered

    @pytest.mark.parametrize(
        ("seat", "also_rolle"),
        [("ansprechperson", "trainer"), ("trainer", "ansprechperson"), ("stellvertretung", None)],
    )
    def test_a_double_seated_persons_link_names_their_second_seat_and_no_other_link_does(
        self, mongo_replica_set_url: str, seat: str, also_rolle: str | None
    ):
        """The third seat is load-bearing: serving the declaration itself would tell the Stellvertretung that two OTHER seats are one person."""

        paired = bewerbung_document(kontakte=kontakte(trainer_is_also="ansprechperson"))

        response = on_a_league(mongo_replica_set_url, lambda database, _: read_view(database, RAW[seat]), documents=[paired])

        assert (response.rolle, response.also_rolle) == (seat, also_rolle)

    def test_the_seats_the_view_names_are_the_seats_the_answer_writes(self, mongo_replica_set_url: str):
        paired = bewerbung_document(kontakte=kontakte(trainer_is_also="ansprechperson"))

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            view = await read_view(database, RAW["trainer"])
            await answer(database, client, RAW["trainer"])

            return view, await stored(database)

        view, document = on_a_league(mongo_replica_set_url, body, documents=[paired])

        stamped = {seat for seat in KONTAKT_ROLLEN if document["kontakte"][seat]["einwilligung"]["confirmed_at"] == TODAY}
        assert stamped == {view.rolle, view.also_rolle}

    def test_a_token_no_seat_holds_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> str:
            with pytest.raises(APIError) as conflict:
                await read_view(database, "a-stranger's-guess")

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body) == Code.LINK_INVALID


class TestWhatAConfirmationWrites:
    """The one `$set`: the pairing lands whole, and the hash stays where it is."""

    def test_the_date_the_stamp_the_source_the_wording_and_the_scope_land_together(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await answer(database, client, RAW["trainer"])

            return response, await stored(database)

        response, document = on_a_league(mongo_replica_set_url, body)

        trainer = document["kontakte"]["trainer"]
        assert trainer["birth_date"] == AN_ADULTS_BIRTHDATE
        # No label on the block and the stored speaker gone: whether the person answered is the stamp's
        # to say, and which words each choice was given under its evidence's.
        assert trainer["einwilligung"] == {
            "scope": "kontakt_data_whatsapp",
            "date": "2026-03-20",
            "confirmed_at": TODAY,
            "media": False,
            # The seating's, which the answer leaves standing.
            "entered_by": "bewerbung",
            # Each choice's evidence under its own wording: the WhatsApp grant, and the media answer
            # withholding.
            "evidence": {
                "scope": {"at": "2026-04-01T10:30:00+00:00", "text_version": documents.SEAT_TEXT_VERSIONS["scope"]},
                "media": {"at": "2026-04-01T10:30:00+00:00", "text_version": documents.SEAT_TEXT_VERSIONS["media"]},
            },
        }
        # NOT nulled on use: single use is the stamp's doing, so the reopened link can show its state.
        assert document["confirmations"]["trainer"]["token_hashes"] == [HASHES["trainer"]]
        assert (response.ergebnis, response.birth_date, response.whatsapp) == ("confirmed", AN_ADULTS_BIRTHDATE, True)

    def test_a_declined_whatsapp_tick_keeps_the_narrow_scope(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW["trainer"], whatsapp=False)

            return await stored(database)

        assert on_a_league(mongo_replica_set_url, body)["kontakte"]["trainer"]["einwilligung"]["scope"] == "kontakt_data"

    def test_the_other_seats_are_untouched(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW["trainer"])

            return await stored(database)

        document = on_a_league(mongo_replica_set_url, body)

        for seat in ("ansprechperson", "stellvertretung"):
            assert document["kontakte"][seat] == bewerbung_document()["kontakte"][seat]

    def test_the_double_seated_trainer_is_answered_on_both_seats_by_one_click(self, mongo_replica_set_url: str):
        """Without the mirror the two blocks can hold two dates, and the equality the submission asserted becomes a claim about the form."""

        paired = bewerbung_document(kontakte=kontakte(trainer_is_also="ansprechperson"))

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await answer(database, client, RAW["ansprechperson"])

            return response, await stored(database)

        response, document = on_a_league(mongo_replica_set_url, body, documents=[paired])

        assert response.outcome == "confirmed"
        for seat in ("trainer", "ansprechperson"):
            assert document["kontakte"][seat]["birth_date"] == AN_ADULTS_BIRTHDATE
            assert document["kontakte"][seat]["einwilligung"]["confirmed_at"] == TODAY
        assert document["kontakte"]["trainer"] == document["kontakte"]["ansprechperson"]


class TestTheMediaConsent:
    """A seat's own media consent, asked on its confirmation page as on a pupil's and a referee's (`media_age`)."""

    def test_a_confirmation_giving_media_from_a_person_of_age_stores_it_on_the_seat_with_its_evidence(self, mongo_replica_set_url: str):

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await answer(database, client, RAW["trainer"], media=True)

            return response, await stored(database)

        response, document = on_a_league(mongo_replica_set_url, body)
        einwilligung = document["kontakte"]["trainer"]["einwilligung"]

        # The answer carries what it stored, as the referee's answer does.
        assert response.media is einwilligung["media"] is True
        assert einwilligung["evidence"]["media"] == {"at": "2026-04-01T10:30:00+00:00", "text_version": documents.SEAT_TEXT_VERSIONS["media"]}

    def test_a_trainer_below_the_media_age_giving_media_is_refused_and_spends_nothing(self, mongo_replica_set_url: str):
        """Seventeen clears the Trainer's own floor and not the media one, so the age refusal stays silent and this one speaks."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(APIError) as refused:
                await answer(database, client, RAW["trainer"], birth_date=A_SEVENTEEN_YEAR_OLDS_BIRTHDATE, media=True)

            return refused.value, await stored(database)

        refusal, document = on_a_league(mongo_replica_set_url, body)

        assert (refusal.error_code, refusal.status_code) == (Code.MEDIA_AGE, 422)
        assert document == bewerbung_document()


class TestTheDaysTheViewNames:
    """The page states them, so a seat's day read off the wrong seat, or an answer's day dropped, is a false sentence to its person."""

    def test_an_open_link_names_its_own_seats_day(self, mongo_replica_set_url: str):
        fresher = bewerbung_document()
        fresher["confirmations"]["trainer"] = {**fresher["confirmations"]["trainer"], "deadline": "2026-04-09"}

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            return await read_view(database, RAW["trainer"]), await read_view(database, RAW["ansprechperson"])

        trainer, ansprechperson = on_a_league(mongo_replica_set_url, body, documents=[fresher])

        assert (trainer.deadline, ansprechperson.deadline) == ("2026-04-09", "2026-04-03")
        assert (trainer.answered_at, trainer.maximum_age) == (None, BEWERBUNG_KONTAKT_MAX_AGE_YEARS)

    @pytest.mark.parametrize("given", [pytest.param({}, id="a confirmation"), pytest.param({"answer": "declined"}, id="an objection")])
    def test_a_reopened_link_names_the_day_it_was_answered(self, mongo_replica_set_url: str, given: Mapping[str, Any]):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW["stellvertretung"], **given)

            return await read_view(database, RAW["stellvertretung"])

        assert on_a_league(mongo_replica_set_url, body).answered_at == TODAY


class TestTheLinkIsSpentByTheStamp:
    def test_a_second_answer_on_the_same_link_is_refused_and_the_reopened_link_shows_confirmed(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW["trainer"])

            with pytest.raises(APIError) as conflict:
                await answer(database, client, RAW["trainer"], birth_date="1990-01-01")

            return (
                conflict.value.error_code,
                (await stored(database))["kontakte"]["trainer"]["birth_date"],
                await read_view(database, RAW["trainer"]),
            )

        code, birth_date, view = on_a_league(mongo_replica_set_url, body)

        assert code == Code.BEWERBUNG_SEAT_ALREADY_ANSWERED
        assert birth_date == AN_ADULTS_BIRTHDATE
        assert view.state == "confirmed"

    def test_an_age_refusal_spends_nothing(self, mongo_replica_set_url: str):
        """A mistyped year is the commonest error on a date field; a link voided by one has no remedy but a re-send."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(APIError) as conflict:
                await answer(database, client, RAW["trainer"], birth_date=A_CHILDS_BIRTHDATE)

            return conflict.value.error_code, await read_view(database, RAW["trainer"]), await stored(database)

        code, view, document = on_a_league(mongo_replica_set_url, body)

        assert code == Code.CONFIRMATION_AGE
        assert view.state == "valid"
        assert document == bewerbung_document()

    def test_the_seat_that_signs_for_the_school_is_refused_a_day_short_of_eighteen_and_nothing_is_written(self, mongo_replica_set_url: str):
        """The same date the Trainer's link takes: a floor judged for the application rather than the seat admits this person."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(APIError) as conflict:
                await answer(database, client, RAW["ansprechperson"], birth_date=A_SEVENTEEN_YEAR_OLDS_BIRTHDATE)

            return conflict.value.error_code, await stored(database)

        code, document = on_a_league(mongo_replica_set_url, body)

        assert code == Code.CONFIRMATION_AGE
        assert document == bewerbung_document()

    def test_a_link_past_its_deadline_is_refused_before_the_seat_is_judged(self, mongo_replica_set_url: str):
        expired = bewerbung_document(confirmation_deadline=YESTERDAY)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            with pytest.raises(APIError) as conflict:
                await answer(database, client, RAW["trainer"])

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body, documents=[expired]) == Code.LINK_EXPIRED

    def test_a_decided_application_refuses_every_link_as_spent(self, mongo_replica_set_url: str):
        """`link_expired`: nothing sets `status` back to `submitted`, and a decided application takes no re-send."""

        decided = bewerbung_document(status="declined")

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            with pytest.raises(APIError) as refused:
                await answer(database, client, RAW["trainer"])

            return refused.value.error_code

        assert on_a_league(mongo_replica_set_url, body, documents=[decided]) == Code.LINK_EXPIRED


class TestADecline:
    """The person's slot is emptied in ONE transaction, as an erasure does: a person who refuses is not held."""

    def test_the_slot_is_emptied_the_day_recorded_beside_it_and_the_seat_still_outstanding(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await answer(database, client, RAW["stellvertretung"], answer="declined")

            return response, await stored(database), await read_view(database, RAW["stellvertretung"])

        response, document, view = on_a_league(mongo_replica_set_url, body)

        assert document["kontakte"]["stellvertretung"] is None
        assert document["confirmations"]["stellvertretung"]["declined_at"] == TODAY
        # The Ansprechperson's objection notice names the deletion day, so no second notice follows it.
        assert document["erasure_announced_at"] == TODAY
        assert (response.ergebnis, response.birth_date, response.media) == ("declined", None, False)
        assert view.state == "declined"

    def test_the_submissions_digest_goes_with_the_person_it_was_taken_over(self, mongo_replica_set_url: str):
        """A hash of personal data is personal data, and it outlives the seat on no page."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW["stellvertretung"], answer="declined")

            return await stored(database)

        document = on_a_league(mongo_replica_set_url, body, documents=[bewerbung_document(idempotency_fingerprint="a" * 64)])

        assert "idempotency_fingerprint" not in document

    def test_a_declined_seat_takes_no_second_answer(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            await answer(database, client, RAW["stellvertretung"], answer="declined")

            with pytest.raises(APIError) as conflict:
                await answer(database, client, RAW["stellvertretung"])

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body) == Code.BEWERBUNG_SEAT_ALREADY_ANSWERED


async def owed(database: AsyncDatabase) -> list[Mapping[str, Any]]:
    """Every mail the Postausgang holds, as owed: its key, its recipient and its facts."""

    return await database[Collection.OUTBOX].find({}, {"_id": 0, "key": 1, "to": 1, "data": 1}).to_list(length=None)


class TestWhatAnObjectionOwesTheAnsprechperson:
    """The notice naming who refused, owed in the decline's own transaction; a confirmation owes nobody anything."""

    def test_another_seats_decline_owes_the_ansprechperson_the_notice_naming_who_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW["stellvertretung"], answer="declined", now=MAIL_NOW)

            return await owed(database)

        assert on_a_league(mongo_replica_set_url, body) == [
            {
                "key": f"{Collection.BEWERBUNGEN}/{BEWERBUNG_OID}/objection/stellvertretung/{utc_stamp(MAIL_NOW)}",
                "to": "quillhilde@example.com",
                "data": {
                    "kind": "bewerbung_objection",
                    "saison_id": SAISON_ID,
                    "rollen": ["ansprechperson"],
                    # Off the read before the decline: nothing left in the record names whose entry was refused.
                    "declined": {"first_name": "Bramblewick", "rollen": ["stellvertretung"]},
                    "deadline": "2026-04-03",
                },
            }
        ]

    def test_a_second_objection_on_a_refilled_seat_owes_its_own_notice(self, mongo_replica_set_url: str):
        """The seat write took the first notice's stamp back, so a notice swallowed here leaves the deletion stamped and untold."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW["stellvertretung"], answer="declined", now=MAIL_NOW)
            await post_kontakt_seat(
                bewerbung_id=BEWERBUNG_OID,
                seat="stellvertretung",
                seat_data=FLBewerbungKontaktSeatPayload(
                    first_name="Thessaly",
                    last_name=LAST_NAME,
                    email=f"thessaly@{MAIL_DOMAIN}",
                    phone="+49 170 7654321",
                    version=(await stored(database))["version"],
                ),
                bewerbungen_collection=database[Collection.BEWERBUNGEN],
                teams_collection=database[Collection.TEAMS],
                outbox_collection=database[Collection.OUTBOX],
                db=client,
                today=TODAY,
                germany_now=MAIL_NOW,
            )
            links = [mail.token for mail in await drained(database, client) if mail.token is not None]
            await answer(database, client, links[-1], answer="declined", now=MAIL_NOW + timedelta(minutes=1))

            return await database[Collection.OUTBOX].count_documents({"kind": "bewerbung_objection"}), await stored(database)

        notices, document = on_a_league(mongo_replica_set_url, body)

        assert (notices, document["erasure_announced_at"]) == (2, TODAY)

    def test_an_ansprechperson_never_mailed_is_told_nothing(self, mongo_replica_set_url: str):
        """A stranger names a mailbox past the bound as Ansprechperson and declines their own link: that mailbox has heard of nothing."""

        never_mailed = bewerbung_document()
        never_mailed["confirmations"]["ansprechperson"]["sent_at"] = None

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW["stellvertretung"], answer="declined", now=MAIL_NOW)

            return await owed(database), await stored(database)

        mails, document = on_a_league(mongo_replica_set_url, body, documents=[never_mailed])

        assert mails == []
        assert document.get("erasure_announced_at") is None

    def test_the_ansprechpersons_own_decline_owes_nobody(self, mongo_replica_set_url: str):
        """The seat the notice would address is the seat that just emptied itself."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW["ansprechperson"], answer="declined", now=MAIL_NOW)

            return await owed(database)

        assert on_a_league(mongo_replica_set_url, body) == []

    def test_the_ansprechpersons_own_decline_announces_no_deletion(self, mongo_replica_set_url: str):
        """Nobody is told of it, so the deletion notice still goes to whoever holds that seat at the deadline."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW["ansprechperson"], answer="declined")

            return await stored(database)

        assert on_a_league(mongo_replica_set_url, body).get("erasure_announced_at") is None

    @pytest.mark.parametrize(
        ("answering", "announced"),
        [pytest.param("trainer", None, id="the earliest seat moves the day"), pytest.param("ansprechperson", "2026-03-30", id="a later seat")],
    )
    def test_a_confirmation_takes_the_notice_back_only_where_the_day_it_named_moves(
        self, mongo_replica_set_url: str, answering: str, announced: str | None
    ):
        """A person told a day that has since moved is told again; a second notice for a day that stands announces one deletion twice."""

        application = bewerbung_document(erasure_announced_at="2026-03-30")
        application["confirmations"]["trainer"]["deadline"] = "2026-04-02"

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW[answering])

            return await stored(database)

        assert on_a_league(mongo_replica_set_url, body, documents=[application])["erasure_announced_at"] == announced

    def test_no_other_seats_address_reaches_the_answer(self, mongo_replica_set_url: str):
        """The answer is the browser's: an address or a name in it is one nothing here would send to."""

        rendered = on_a_league(mongo_replica_set_url, lambda database, client: answer(database, client, RAW["trainer"])).model_dump_json()

        assert MAIL_DOMAIN not in rendered
        assert LAST_NAME not in rendered and PHONE not in rendered


class TestAResend:
    def test_a_fresh_link_voids_the_old_and_restarts_the_deadline(self, mongo_replica_set_url: str):
        """The link reaches the seat through the hand-out of the mail the re-send owes, which mints it into `token_hashes`."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await resend(database, "trainer")
            [mail] = await drained(database, client)

            with pytest.raises(APIError) as conflict:
                await read_view(database, RAW["trainer"])

            assert mail.token is not None
            return response, mail, conflict.value.error_code, await read_view(database, mail.token), await stored(database)

        response, mail, old_code, view, document = on_a_league(mongo_replica_set_url, body)

        assert old_code == Code.LINK_INVALID
        assert (view.state, view.rolle) == ("valid", "trainer")
        assert (response.rolle, response.confirmation_deadline) == ("trainer", "2026-04-15")
        assert (mail.to, mail.data.kind) == ("wraxlington@example.com", "bewerbung_confirmation")
        # That seat's alone: the other two keep the days their own links carry.
        assert {seat: entry["deadline"] for seat, entry in document["confirmations"].items()} == {
            "trainer": "2026-04-15",
            "ansprechperson": "2026-04-03",
            "stellvertretung": "2026-04-03",
        }
        assert document["confirmations"]["trainer"] == {
            "token_hashes": [hash_token(mail.token or "")],
            "sent_at": TODAY,
            "deadline": "2026-04-15",
            "reminded_at": None,
            "chase_closed_at": None,
            "declined_at": None,
        }
        # The other seats' links still open.
        assert document["confirmations"]["ansprechperson"]["token_hashes"] == [HASHES["ansprechperson"]]

    def test_it_sends_a_seat_the_submission_left_unmailed(self, mongo_replica_set_url: str):
        """The administration's way to a seat past the bound: its press is nobody's flood, so no count stands in it."""

        never_mailed = bewerbung_document()
        never_mailed["confirmations"]["trainer"]["sent_at"] = None

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await resend(database, "trainer")

            return await stored(database), [row["to"] for row in await owed(database)]

        document, addresses = on_a_league(mongo_replica_set_url, body, documents=[never_mailed])

        assert document["confirmations"]["trainer"]["sent_at"] == TODAY
        assert addresses == ["wraxlington@example.com"]

    def test_another_seats_restart_leaves_the_announcement(self, mongo_replica_set_url: str):
        """The notice named the declining seat's day, which this write does not move: a second notice would announce the same deletion."""

        announced = bewerbung_document(erasure_announced_at="2026-03-30")

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            await resend(database, "trainer")

            return await stored(database)

        assert on_a_league(mongo_replica_set_url, body, documents=[announced])["erasure_announced_at"] == "2026-03-30"

    def test_a_confirmed_seat_gets_no_new_link(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            await answer(database, client, RAW["trainer"])

            with pytest.raises(APIError) as conflict:
                await resend(database, "trainer")

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body) == Code.BEWERBUNG_SEAT_ALREADY_ANSWERED

    def test_a_decided_application_gets_no_new_link(self, mongo_replica_set_url: str):
        decided = bewerbung_document(status="declined", decision={"made_at": YESTERDAY, "reason": "kein Platz"})

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> str:
            with pytest.raises(APIError) as conflict:
                await resend(database, "trainer")

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body, documents=[decided]) == Code.BEWERBUNG_ALREADY_DECIDED

    def test_a_path_naming_no_seat_is_a_miss(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentNotFoundError):
                await resend(database, "trainer_is_also")

            return await stored(database)

        assert on_a_league(mongo_replica_set_url, body) == bewerbung_document()


def decline(database: AsyncDatabase, client: AsyncMongoClient, seat: str) -> Any:
    return answer(database, client, RAW[seat], answer="declined")
