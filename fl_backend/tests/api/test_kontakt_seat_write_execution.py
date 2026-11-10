from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from bson import ObjectId
from pydantic import TypeAdapter
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.public_router import post_einwilligung
from app.api.bewerbungen.schemas import FLBewerbungEinwilligungAnswerPayload
from app.api.teams.admin_router import put_kontakt_seat
from app.api.teams.schemas import FLKontaktSeatPayload, FLKontaktSeatResponse
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError, DocumentNotFoundError
from app.shared.tokens import hash_token
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import SEAT_TEXT_VERSIONS, kontaktperson_document, saison_document, saison_team_document
from tests.outbox import MAIL_NOW, drained
from tests.worker import worker_database

# Module level: what a seat write leaves is a stored block and an owed mail, in one transaction.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_kontakt_seat_write_test")

SAISON_ID = "2026"
TODAY = "2026-04-01"
CONFIRMED_ON = "2026-03-15"
BIRTH_DATE = "1990-05-17"

TEAM_OID = ObjectId("6890a1b2c3d4e5f607910001")

PHONE = {"Ida": "+4915110000001", "Jonas": "+4915110000002", "Klara": "+4915110000003", "Lea": "+4915110000004"}


def stored_person(first_name: str, *, confirmed_at: str | None = None) -> dict[str, Any]:
    return kontaktperson_document(
        first_name,
        confirmed_at=confirmed_at,
        entered_by="liga",
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


def on_a_row(url: str, body: Body, *, kontakte: dict[str, Any] | None, confirmations: dict[str, Any] | None = None) -> Any:
    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
            await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, "active"))
            await database[Collection.SAISON_TEAMS].insert_one(
                saison_team_document(SAISON_ID, TEAM_OID, "Adler", "ADX", kontakte=kontakte, confirmations=confirmations)
            )

            return await body(database)

    return on_the_seed_loop(_run())


async def write_seat(database: AsyncDatabase, seat: str, sent: dict[str, Any], *, version: int = 0) -> FLKontaktSeatResponse:
    return await put_kontakt_seat(
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


async def row_and_mails(database: AsyncDatabase) -> tuple[dict[str, Any], list[Any]]:
    row = await database[Collection.SAISON_TEAMS].find_one({"team_id": TEAM_OID})
    assert row is not None

    return row, await drained(database, database.client)


def refused(
    url: str, seat: str, sent: dict[str, Any], *, kontakte: dict[str, Any] | None, version: int = 0
) -> tuple[Code, Any, dict[str, Any]]:
    """The refusal and the row it left, which must be the row as seeded."""

    async def body(database: AsyncDatabase) -> tuple[Code, Any, dict[str, Any]]:
        with pytest.raises(APIError) as refusal:
            await write_seat(database, seat, sent, version=version)

        row, _ = await row_and_mails(database)

        return refusal.value.error_code, refusal.value.fields, row

    return on_a_row(url, body, kontakte=kontakte)


class TestTheSeatsStateDecidesTheWrite:
    """One write for every state of a seat, each state owing what its person is told."""

    def test_a_confirmed_person_gives_way_and_the_next_is_seated_unconfirmed_with_a_link(self, mongo_replica_set_url: str):
        """A stamp left on the seat would say the new person answered, and no link would ever ask them."""

        async def body(database: AsyncDatabase) -> Any:
            answer = await write_seat(database, "trainer", sent_person("Lea"))

            return (answer, *await row_and_mails(database))

        answer, row, mails = on_a_row(
            mongo_replica_set_url,
            body,
            kontakte=block(trainer=stored_person("Ida", confirmed_at=CONFIRMED_ON)),
            confirmations={"trainer": link_entry(), "ansprechperson": link_entry(), "stellvertretung": None},
        )

        assert answer.email == "lea@example.com"
        seat = row["kontakte"]["trainer"]
        assert (seat["first_name"], seat["birth_date"]) == ("Lea", None)
        assert (seat["einwilligung"]["scope"], seat["einwilligung"]["date"]) == ("kontakt_data", TODAY)
        assert (seat["einwilligung"]["confirmed_at"], seat["einwilligung"]["entered_by"], seat["einwilligung"]["media"]) == (
            None,
            "liga",
            False,
        )
        assert [(mail.to, mail.data.rollen) for mail in mails] == [("lea@example.com", ["trainer"])]
        # The seat beside it keeps its person, and with them the link they already hold.
        assert row["confirmations"]["ansprechperson"] == link_entry()

    def test_a_corrected_number_keeps_the_person_their_record_and_their_link(self, mongo_replica_set_url: str):
        """A fresh link here would void the one the person is about to answer."""

        async def body(database: AsyncDatabase) -> Any:
            answer = await write_seat(database, "trainer", {**sent_person("Ida"), "phone": "+4915110000009"})
            acts = database[Collection.ACTION_LOG].find({"action": "team.seat_changed"})

            return (answer, *await row_and_mails(database), [(act["record_id"], act["label"]) async for act in acts])

        seated = stored_person("Ida", confirmed_at=CONFIRMED_ON)
        answer, row, mails, acts = on_a_row(
            mongo_replica_set_url,
            body,
            kontakte=block(trainer=seated),
            confirmations={"trainer": link_entry(), "ansprechperson": None, "stellvertretung": None},
        )

        assert answer.email is None
        assert mails == []
        assert row["kontakte"]["trainer"] == {**seated, "phone": "+4915110000009"}
        assert acts == [(TEAM_OID, "Adler")]
        assert row["confirmations"]["trainer"] == link_entry()

    @pytest.mark.parametrize("kontakte", [block(), None], ids=["an emptied seat", "a row holding no block"])
    def test_an_empty_seat_is_filled_and_its_person_owed_a_link(self, mongo_replica_set_url: str, kontakte: dict[str, Any] | None):
        async def body(database: AsyncDatabase) -> Any:
            answer = await write_seat(database, "stellvertretung", sent_person("Lea"))

            return (answer, *await row_and_mails(database))

        answer, row, mails = on_a_row(mongo_replica_set_url, body, kontakte=kontakte)

        assert answer.email == "lea@example.com"
        assert row["kontakte"]["stellvertretung"]["first_name"] == "Lea"
        assert [mail.to for mail in mails] == ["lea@example.com"]


class TestTheTrainersSecondSeat:
    """`trainer_is_also` names one person in two seats: the pair moves as one, and only the Trainer's seat moves the claim."""

    PAIRED = block(ansprechperson=stored_person("Ida"), trainer_is_also="ansprechperson")

    @pytest.mark.parametrize("seat", ["trainer", "ansprechperson"])
    def test_a_write_on_either_seat_of_a_pair_writes_both_under_one_link(self, mongo_replica_set_url: str, seat: str):
        """One seat written alone would leave the pair naming two people, each holding the other's link."""

        async def body(database: AsyncDatabase) -> Any:
            await write_seat(database, seat, sent_person("Lea"))

            return await row_and_mails(database)

        row, mails = on_a_row(mongo_replica_set_url, body, kontakte=self.PAIRED)

        assert (row["kontakte"]["trainer"]["first_name"], row["kontakte"]["ansprechperson"]["first_name"]) == ("Lea", "Lea")
        assert row["kontakte"]["trainer_is_also"] == "ansprechperson"
        assert [(mail.to, sorted(mail.data.rollen)) for mail in mails] == [("lea@example.com", ["ansprechperson", "trainer"])]

    @pytest.mark.parametrize(
        ("sent", "claim", "ansprechperson"),
        [
            pytest.param({"trainer_is_also": None}, None, "Ida", id="null ends the claim and the other seat keeps its person"),
            pytest.param({}, "ansprechperson", "Lea", id="left out, the claim stands"),
        ],
    )
    def test_the_trainers_write_moves_the_claim_only_where_it_names_one(
        self, mongo_replica_set_url: str, sent: dict[str, Any], claim: str | None, ansprechperson: str
    ):
        async def body(database: AsyncDatabase) -> Any:
            await write_seat(database, "trainer", sent_person("Lea", **sent))

            return await row_and_mails(database)

        row, _ = on_a_row(mongo_replica_set_url, body, kontakte=self.PAIRED)

        assert row["kontakte"]["trainer_is_also"] == claim
        assert row["kontakte"]["ansprechperson"]["first_name"] == ansprechperson

    def test_a_claim_sent_on_another_seat_moves_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            await write_seat(database, "stellvertretung", sent_person("Lea", trainer_is_also=None))

            return await row_and_mails(database)

        row, _ = on_a_row(mongo_replica_set_url, body, kontakte=self.PAIRED)

        assert row["kontakte"]["trainer_is_also"] == "ansprechperson"

    def test_a_claim_taken_up_seats_the_trainer_in_the_seat_it_names(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            await write_seat(database, "trainer", sent_person("Ida", trainer_is_also="ansprechperson"))

            return await row_and_mails(database)

        row, mails = on_a_row(mongo_replica_set_url, body, kontakte=block())

        assert row["kontakte"]["ansprechperson"]["first_name"] == "Ida"
        assert [mail.to for mail in mails] == ["ida@example.com"]


LINK = "seat-write-trainer-link"


async def confirm_by_link(database: AsyncDatabase) -> None:
    """The trainer's own confirmation through the link their seat holds."""

    await post_einwilligung(
        answer_data=TypeAdapter(FLBewerbungEinwilligungAnswerPayload).validate_python(
            {
                "answer": "given",
                "token": LINK,
                "birth_date": BIRTH_DATE,
                "whatsapp": False,
                "media": False,
                "text_versions": dict(SEAT_TEXT_VERSIONS),
            }
        ),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        outbox_collection=database[Collection.OUTBOX],
        db=database.client,
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

    def pressed_then_written(self, url: str, sent: dict[str, Any]) -> tuple[dict[str, Any], list[Any]]:
        async def body(database: AsyncDatabase) -> tuple[dict[str, Any], list[Any]]:
            await confirm_by_link(database)
            await write_seat(database, "trainer", sent, version=0)

            return await row_and_mails(database)

        return on_a_row(url, body, kontakte=self.UNCONFIRMED, confirmations=self.LINKED)

    def test_the_same_person_keeps_the_fresh_confirmation(self, mongo_replica_set_url: str):
        row, mails = self.pressed_then_written(mongo_replica_set_url, {**sent_person("Ida"), "phone": "+4915110000009"})

        seat = row["kontakte"]["trainer"]
        assert (seat["phone"], seat["birth_date"], seat["einwilligung"]["confirmed_at"]) == ("+4915110000009", BIRTH_DATE, TODAY)
        assert mails == []

    def test_another_address_takes_the_seat_unconfirmed_with_a_new_link(self, mongo_replica_set_url: str):
        row, mails = self.pressed_then_written(mongo_replica_set_url, sent_person("Lea"))

        seat = row["kontakte"]["trainer"]
        assert (seat["first_name"], seat["birth_date"], seat["einwilligung"]["confirmed_at"]) == ("Lea", None, None)
        assert [(mail.to, mail.data.rollen) for mail in mails] == [("lea@example.com", ["trainer"])]


class TestTheRefusals:
    @pytest.mark.parametrize(
        ("sent", "code", "field"),
        [
            pytest.param({"email": "JONAS@example.com"}, Code.KONTAKT_EMAIL_TAKEN, "email", id="an address on the sign-in fold"),
            pytest.param({"phone": "0151 10000002"}, Code.KONTAKT_PHONE_TAKEN, "phone", id="a number in another spelling"),
        ],
    )
    def test_what_another_seats_person_holds_is_refused_on_its_box(
        self, mongo_replica_set_url: str, sent: dict[str, Any], code: Code, field: str
    ):
        """The block's rule, which no payload can judge here: the other seats are stored, not sent."""

        seated = block()
        answer, fields, row = refused(mongo_replica_set_url, "trainer", {**sent_person("Lea"), **sent}, kontakte=seated)

        assert (answer, fields) == (code, ((field,),))
        assert row["kontakte"] == seated

    def test_a_write_composed_before_the_row_moved_is_refused(self, mongo_replica_set_url: str):
        """An erasure raises the count: written over it, the seat it emptied would come back."""

        seated = block()
        answer, _, row = refused(mongo_replica_set_url, "trainer", sent_person("Lea"), kontakte=seated, version=7)

        assert answer == Code.VERSION_STALE
        assert row["kontakte"] == seated

    def test_a_path_naming_no_seat_is_a_miss(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> None:
            with pytest.raises(DocumentNotFoundError):
                await write_seat(database, "kassenwart", sent_person("Lea"))

        on_a_row(mongo_replica_set_url, body, kontakte=block())
