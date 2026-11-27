from collections.abc import Awaitable, Callable, Mapping
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.teams.admin_router import put_kontakt_seat
from app.api.teams.schemas import FLKontaktSeatPayload, FLKontaktSeatResponse
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError
from app.shared.tokens import hash_token
from tests.bewerbung_routes import answered
from tests.database import a_clean_database
from tests.documents import SEAT_TEXT_VERSIONS, kontaktperson_document, saison_document, saison_team_document
from tests.outbox import MAIL_NOW, drained
from tests.stored import the_row
from tests.worker import worker_database

# Module level: what a seat write leaves is a stored block and an owed mail, in one transaction.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_kontakt_seat_write_test")

SAISON_ID = "2026"
PAST_SAISON_ID = "2025"
TODAY = "2026-04-01"
CONFIRMED_ON = "2026-03-15"
BIRTH_DATE = "1990-05-17"

TEAM_OID = ObjectId("6890a1b2c3d4e5f607910001")

PHONE = {"Ida": "+4917604069001", "Jonas": "+4917604069002", "Klara": "+4917604069003", "Lea": "+4917604069004"}


def stored_person(first_name: str, *, confirmed_at: str | None = None) -> dict[str, Any]:
    return kontaktperson_document(
        first_name,
        confirmed_at=confirmed_at,
        last_name="Musterfrau",
        email=f"{first_name.lower()}@example.com",
        phone=PHONE[first_name],
        birth_date=BIRTH_DATE,
    )


def sent_person(first_name: str, **fields: Any) -> dict[str, Any]:
    """What the dialog sends: the four boxes, and `trainer_is_also` only where a case names it."""

    return {
        "first_name": first_name,
        "last_name": "Musterfrau",
        "email": f"{first_name.lower()}@example.com",
        "phone": PHONE[first_name],
        **fields,
    }


def block(**seats: Any) -> dict[str, Any]:
    return {
        "trainer": stored_person("Ida"),
        "ansprechperson": stored_person("Jonas"),
        "stellvertretung": None,
        "trainer_is_also": None,
        **seats,
    }


def link_entry() -> dict[str, Any]:
    return {"token_hashes": ["held"], "sent_at": "2026-03-01", "deadline": "2026-03-15", "declined_at": None}


Body = Callable[[AsyncDatabase], Awaitable[Any]]


async def on_a_row(url: str, body: Body, *, kontakte: dict[str, Any] | None, confirmations: dict[str, Any] | None = None) -> Any:
    async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
        await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, "active"))
        await database[Collection.SAISON_TEAMS].insert_one(
            saison_team_document(SAISON_ID, TEAM_OID, "Adler", "ADX", kontakte=kontakte, confirmations=confirmations)
        )

        return await body(database)


async def write_seat(database: AsyncDatabase, seat: str, sent: dict[str, Any], *, version: int = 0) -> FLKontaktSeatResponse:
    written = await put_kontakt_seat(
        team_id=TEAM_OID,
        saison_id=SAISON_ID,
        seat=seat,
        seat_data=FLKontaktSeatPayload.model_validate({**sent, "version": version}),
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        outbox_collection=database[Collection.OUTBOX],
        db=database.client,
        today=TODAY,
        germany_now=MAIL_NOW,
    )
    # Only a dry run answers the bare 204, and this call asks none.
    assert isinstance(written, FLKontaktSeatResponse)
    return written


async def row_and_mails(database: AsyncDatabase) -> tuple[Mapping[str, Any], list[Any]]:
    return await the_row(database, Collection.SAISON_TEAMS, {"team_id": TEAM_OID}), await drained(database, database.client)


async def refused(
    url: str, seat: str, sent: dict[str, Any], *, kontakte: dict[str, Any] | None, version: int = 0
) -> tuple[Code, Any, Mapping[str, Any]]:
    """The refusal and the row it left, which must be the row as seeded."""

    async def body(database: AsyncDatabase) -> tuple[Code, Any, Mapping[str, Any]]:
        with pytest.raises(APIError) as refusal:
            await write_seat(database, seat, sent, version=version)

        row, _ = await row_and_mails(database)

        return refusal.value.error_code, refusal.value.fields, row

    return await on_a_row(url, body, kontakte=kontakte)


class TestTheSeatsStateDecidesTheWrite:
    """One write for every state of a seat, each state owing what its person is told."""

    async def test_a_confirmed_person_gives_way_and_the_next_is_seated_unconfirmed_with_a_link(self, mongo_replica_set_url: str):
        """A stamp left on the seat would say the new person answered, and no link would ever ask them."""

        async def body(database: AsyncDatabase) -> Any:
            answer = await write_seat(database, "trainer", sent_person("Lea"))

            return (answer, *await row_and_mails(database))

        answer, row, mails = await on_a_row(
            mongo_replica_set_url,
            body,
            kontakte=block(trainer=stored_person("Ida", confirmed_at=CONFIRMED_ON)),
            confirmations={"trainer": link_entry(), "ansprechperson": link_entry(), "stellvertretung": None},
        )

        assert answer.email == "lea@example.com"
        seat = row["kontakte"]["trainer"]
        assert (seat["first_name"], seat["birth_date"]) == ("Lea", None)
        assert (seat["einwilligung"]["scope"], seat["einwilligung"]["date"]) == ("kontakt_data", TODAY)
        assert (seat["einwilligung"]["confirmed_at"], seat["einwilligung"]["media"]) == (None, False)
        assert [(mail.to, mail.data.seats) for mail in mails] == [("lea@example.com", ["trainer"])]
        # The seat beside it keeps its person, and with them the link they already hold.
        assert row["confirmations"]["ansprechperson"] == link_entry()

    async def test_a_corrected_number_keeps_the_person_their_record_and_their_link(self, mongo_replica_set_url: str):
        """A fresh link here would void the one the person is about to answer."""

        async def body(database: AsyncDatabase) -> Any:
            answer = await write_seat(database, "trainer", {**sent_person("Ida"), "phone": "+4917604069009"})
            acts = database[Collection.ACTION_LOG].find({"action": "team.seat_changed"})

            return (answer, *await row_and_mails(database), [(act["record_id"], act["label"]) async for act in acts])

        seated = stored_person("Ida", confirmed_at=CONFIRMED_ON)
        answer, row, mails, acts = await on_a_row(
            mongo_replica_set_url,
            body,
            kontakte=block(trainer=seated),
            confirmations={"trainer": link_entry(), "ansprechperson": None, "stellvertretung": None},
        )

        assert answer.email is None
        assert mails == []
        assert row["kontakte"]["trainer"] == {**seated, "phone": "+4917604069009"}
        assert acts == [(TEAM_OID, "Adler")]
        assert row["confirmations"]["trainer"] == link_entry()

    async def test_an_emptied_seat_is_filled_and_its_person_owed_a_link(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            answer = await write_seat(database, "stellvertretung", sent_person("Lea"))

            return (answer, *await row_and_mails(database))

        answer, row, mails = await on_a_row(mongo_replica_set_url, body, kontakte=block())

        assert answer.email == "lea@example.com"
        assert row["kontakte"]["stellvertretung"]["first_name"] == "Lea"
        assert [mail.to for mail in mails] == ["lea@example.com"]


class TestTheSeasonsOwnRowIsWritten:
    async def test_a_write_reads_and_writes_the_block_of_the_season_it_names(self, mongo_replica_set_url: str):
        """The club's row of a season before, stored first, holds other people: read in its place, they would be seated here."""

        async def body(database: AsyncDatabase) -> Any:
            await database[Collection.SAISONS].insert_one(saison_document(PAST_SAISON_ID, "past"))
            await database[Collection.SAISON_TEAMS].insert_one(
                saison_team_document(PAST_SAISON_ID, TEAM_OID, "Adler", "ADX", kontakte=block(trainer=stored_person("Lea")))
            )
            # Moved behind the past season's row, so a read naming no season meets that one first.
            row = await database[Collection.SAISON_TEAMS].find_one_and_delete({"team_id": TEAM_OID, "saison_id": SAISON_ID})
            await database[Collection.SAISON_TEAMS].insert_one(row)
            await write_seat(database, "stellvertretung", sent_person("Klara"))

            return {
                stored["saison_id"]: {
                    seat: (stored["kontakte"][seat] or {}).get("first_name") for seat in ("trainer", "ansprechperson", "stellvertretung")
                }
                async for stored in database[Collection.SAISON_TEAMS].find({"team_id": TEAM_OID})
            }

        seated = await on_a_row(mongo_replica_set_url, body, kontakte=block())

        assert seated == {
            SAISON_ID: {"trainer": "Ida", "ansprechperson": "Jonas", "stellvertretung": "Klara"},
            PAST_SAISON_ID: {"trainer": "Lea", "ansprechperson": "Jonas", "stellvertretung": None},
        }


class TestTheTrainersSecondSeat:
    """`trainer_is_also` names one person in two seats: the Trainer's write moves the pair as one, a claim it leaves out standing."""

    PAIRED = block(ansprechperson=stored_person("Ida"), trainer_is_also="ansprechperson")

    async def test_the_trainers_write_leaving_the_claim_out_keeps_it_and_moves_the_pair(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            await write_seat(database, "trainer", sent_person("Lea"))

            return await row_and_mails(database)

        row, _ = await on_a_row(mongo_replica_set_url, body, kontakte=self.PAIRED)

        assert row["kontakte"]["trainer_is_also"] == "ansprechperson"
        assert row["kontakte"]["ansprechperson"]["first_name"] == "Lea"


LINK = "seat-write-trainer-link"


async def confirm_by_link(database: AsyncDatabase) -> None:
    """The trainer's own confirmation through the link their seat holds."""

    await answered(
        database,
        database.client,
        {
            "answer": "given",
            "token": LINK,
            "birth_date": BIRTH_DATE,
            "whatsapp": False,
            "media": False,
            "text_versions": dict(SEAT_TEXT_VERSIONS),
        },
        today=TODAY,
        germany_now=MAIL_NOW,
    )


class TestAConfirmationLandingBeforeTheSave:
    """The confirmation is the person's own press, so a „Sitz bearbeiten“ on the version read before it lands.

    The save composes the seat from its own read, so the confirmation is judged as the seat stands after it.
    """

    UNCONFIRMED = block(trainer={**stored_person("Ida"), "birth_date": None})
    LINKED = {
        "trainer": {**link_entry(), "token_hashes": [hash_token(LINK)], "deadline": "2026-04-15"},
        "ansprechperson": None,
        "stellvertretung": None,
    }

    async def pressed_then_written(self, url: str, sent: dict[str, Any]) -> tuple[Mapping[str, Any], list[Any]]:
        async def body(database: AsyncDatabase) -> tuple[Mapping[str, Any], list[Any]]:
            await confirm_by_link(database)
            await write_seat(database, "trainer", sent, version=0)

            return await row_and_mails(database)

        return await on_a_row(url, body, kontakte=self.UNCONFIRMED, confirmations=self.LINKED)

    async def test_the_same_person_keeps_the_fresh_confirmation(self, mongo_replica_set_url: str):
        row, mails = await self.pressed_then_written(mongo_replica_set_url, {**sent_person("Ida"), "phone": "+4917604069009"})

        seat = row["kontakte"]["trainer"]
        assert (seat["phone"], seat["birth_date"], seat["einwilligung"]["confirmed_at"]) == ("+4917604069009", BIRTH_DATE, TODAY)
        assert mails == []

    async def test_another_address_takes_the_seat_unconfirmed_with_a_new_link(self, mongo_replica_set_url: str):
        row, mails = await self.pressed_then_written(mongo_replica_set_url, sent_person("Lea"))

        seat = row["kontakte"]["trainer"]
        assert (seat["first_name"], seat["birth_date"], seat["einwilligung"]["confirmed_at"]) == ("Lea", None, None)
        assert [(mail.to, mail.data.seats) for mail in mails] == [("lea@example.com", ["trainer"])]


class TestTheRefusals:
    async def test_another_seats_address_sent_in_capitals_is_refused_on_its_box(self, mongo_replica_set_url: str):
        """The block's rule, which no payload can judge here: the other seats are stored, not sent, each address folded."""

        seated = block()
        answer, fields, row = await refused(
            mongo_replica_set_url, "trainer", {**sent_person("Lea"), "email": "JONAS@example.com"}, kontakte=seated
        )

        assert (answer, fields) == (Code.KONTAKT_EMAIL_TAKEN, (("email",),))
        assert row["kontakte"] == seated

    async def test_a_write_composed_before_the_row_moved_is_refused(self, mongo_replica_set_url: str):
        """An erasure raises the count: written over it, the seat it emptied would come back."""

        seated = block()
        answer, _, row = await refused(mongo_replica_set_url, "trainer", sent_person("Lea"), kontakte=seated, version=7)

        assert answer == Code.VERSION_STALE
        assert row["kontakte"] == seated
