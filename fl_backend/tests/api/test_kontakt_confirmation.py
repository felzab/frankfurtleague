"""
API · a contact seat an administrator types into a team's season row is mailed its own confirmation link

The contacts save mints one link per person it newly seats, the per-seat re-send mints one for any
seat still unconfirmed, and the application's two confirmation operations answer the link on the
season row, with the ban list asked at the mint and at the press as the application's links ask it.
"""

import dataclasses
from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any, cast
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.services import SEAT_MIN_AGE_YEARS, confirmation_deadline_from
from app.api.identity.crud import roles_of
from app.api.saisons.admin_router import activate_saison
from app.api.teams.admin_router import replace_saison_team, resend_kontakt_confirmation
from app.api.teams.schemas import FLReplaceSaisonTeamPayload
from app.api.teams.services import (
    compose_kontakt_confirmation,
)
from app.core.codes import Code
from app.core.collections import Collection
from app.shared.tokens import hash_token
from tests import documents
from tests.bans import ban_through_the_route
from tests.bewerbung_routes import answered, viewed
from tests.config import grants_for_the_suite
from tests.database import a_clean_database
from tests.erasure import erased
from tests.isolation import InterleavedCollection, refused_code
from tests.outbox import MAIL_NOW, drained
from tests.records import record_collections
from tests.stored import the_row
from tests.team_writes import write_the_block
from tests.whole_database import where_held
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_kontakt_confirmation_test")

SAISON_ID = "2026"
TODAY = "2026-04-01"
DEADLINE = confirmation_deadline_from(today=TODAY)
# The day after the deadline a link minted on `TODAY` carries.
AFTER_THE_DEADLINE = "2026-04-16"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

TEAM_OID = ObjectId("6890a1b2c3d4e5f607a50001")
ROW_OID = ObjectId("6890a1b2c3d4e5f607a50011")
OTHER_TEAM_OID = ObjectId("6890a1b2c3d4e5f607a50002")
OTHER_ROW_OID = ObjectId("6890a1b2c3d4e5f607a50012")
INCOMING_TEAM_OID = ObjectId("6890a1b2c3d4e5f607a50003")

TEAM_NAME = "Adler"
AN_ADULTS_BIRTHDATE = "1984-05-09"
ADMIN = "admin@frankfurtleague.de"

PHONE = {"Ida": "+491713920001", "Jonas": "+491713920002", "Klara": "+491713920003", "Lea": "+491713920004"}

SEATS = ("trainer", "ansprechperson", "stellvertretung")


def person(first_name: str) -> dict[str, Any]:
    """One person as the editor sends them."""

    return {
        "first_name": first_name,
        "last_name": "Musterfrau",
        "email": f"{first_name.lower()}@example.com",
        "phone": PHONE[first_name],
    }


def stored(first_name: str, *, confirmed_at: str | None = None) -> dict[str, Any]:
    """The same person as a row holds them, the league having seated them, confirmed or not."""

    sent = person(first_name)

    return documents.kontaktperson_document(
        first_name,
        confirmed_at=confirmed_at,
        einwilligung={"date": "2026-03-01"},
        last_name=sent["last_name"],
        email=sent["email"],
        phone=sent["phone"],
        **({} if confirmed_at is None else {"birth_date": AN_ADULTS_BIRTHDATE}),
    )


THREE = {"trainer": person("Ida"), "ansprechperson": person("Jonas"), "stellvertretung": person("Klara"), "trainer_is_also": None}
# The Trainer holding the Stellvertretung's seat too: one person, so one link.
PAIRED = {
    "trainer": person("Ida"),
    "ansprechperson": person("Jonas"),
    "stellvertretung": person("Ida"),
    "trainer_is_also": "stellvertretung",
}

# Three unconfirmed people on a row holding no link entry, so the link a re-send mints is the only one in play.
STORED_UNCONFIRMED = {
    "trainer": stored("Ida"),
    "ansprechperson": stored("Jonas"),
    "stellvertretung": stored("Klara"),
    "trainer_is_also": None,
}


def junction(
    row_id: ObjectId, team_id: ObjectId, kontakte: Any, *, name: str = TEAM_NAME, shorthand: str = "ADX", **fields: Any
) -> dict[str, Any]:
    return {"_id": row_id, **documents.saison_team_document(SAISON_ID, team_id, name, shorthand, kontakte=kontakte, **fields)}


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


async def on_a_league(
    url: str,
    body: Body,
    *,
    kontakte: Any = None,
    rows: list[dict[str, Any]] | None = None,
    saison_status: str = "active",
    row_fields: Mapping[str, Any] | None = None,
    mutates_schema: bool = False,
) -> Any:
    """The season, its club, and the club's row holding `kontakte`; `rows` seeded FIRST, so a filter missing the row reaches them."""

    async with a_clean_database(url, DATABASE_NAME, constraints=True, mutates_schema=mutates_schema) as (client, database):
        # A ban entered through its route re-judges its actor's grant.
        await database[Collection.GRANTS].insert_many(grants_for_the_suite())
        # Starting the day after `TODAY`, so the club's replacement is still open to it.
        await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, saison_status, start_date="2026-04-02"))
        for team_id, name, shorthand in (
            (TEAM_OID, TEAM_NAME, "ADX"),
            (OTHER_TEAM_OID, "Falken", "FAX"),
            (INCOMING_TEAM_OID, "Eulen", "EUX"),
        ):
            await database[Collection.TEAMS].insert_one(
                documents.team_document(team_id, name, shorthand, website_url=None, schulform="gymnasium_g9")
            )
        for row in rows or []:
            await database[Collection.SAISON_TEAMS].insert_one(row)
        await database[Collection.SAISON_TEAMS].insert_one(junction(ROW_OID, TEAM_OID, kontakte, **(row_fields or {})))

        return await body(database, client)


@dataclasses.dataclass(frozen=True)
class Link:
    """One link a write owed, as the Postausgang handed its mail out: where it went, what it names, and the raw link."""

    seats: list[str]
    email: str
    token: str
    deadline: str
    schule: str
    row: str


@dataclasses.dataclass(frozen=True)
class Mailed:
    """A write's answer, beside each link it owed as the mail carrying it went out, in the answer's order."""

    answer: Any
    confirmations: list[Link]

    @property
    def confirmation(self) -> Link:
        [link] = self.confirmations
        return link


async def mailed(database: AsyncDatabase, answer: Any, owed: list[Any] | None) -> Mailed:
    """The outbox drained as the frontend drains it after the write, each mail matched to the person the answer names.

    `owed` is `None` for a write answering no body, whose mails are read as they went out.
    """

    mails = await drained(database, database.client)
    links = [
        Link(
            seats=list(mail.data.seats),
            email=mail.to,
            token=str(mail.token),
            deadline=str(mail.data.deadline),
            schule=mail.data.schule,
            row=mail.data.row,
        )
        for mail in mails
        if mail.data.kind == "kontakt_confirmation"
    ]
    if owed is not None:
        assert [(link.seats, link.email) for link in links] == [(mint.seats, mint.email) for mint in owed], "the answer and the mails part"

    return Mailed(answer=answer, confirmations=links)


async def save(database: AsyncDatabase, kontakte: Any) -> Mailed:
    """The block over whatever the row holds now, and the links it owed."""

    row = await database[Collection.SAISON_TEAMS].find_one({"_id": ROW_OID})
    assert row is not None

    answer = await write_the_block(
        database,
        kontakte,
        team_id=TEAM_OID,
        saison_id=SAISON_ID,
        version=row["version"],
        today=TODAY,
        germany_now=MAIL_NOW,
    )

    return await mailed(database, answer, answer.confirmations)


async def resend(database: AsyncDatabase, seat: str, *, today: str = TODAY) -> Mailed:
    await resend_kontakt_confirmation(
        team_id=TEAM_OID,
        saison_id=SAISON_ID,
        seat=seat,
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        outbox_collection=database[Collection.OUTBOX],
        db=database.client,
        today=today,
        germany_now=MAIL_NOW,
    )

    return await mailed(database, None, None)


async def replace(database: AsyncDatabase) -> Any:
    """Another club takes this team's place in the season."""

    return await replace_saison_team(
        team_id=TEAM_OID,
        saison_id=SAISON_ID,
        replacement_data=FLReplaceSaisonTeamPayload(incoming_team_id=INCOMING_TEAM_OID),
        teams_collection=database[Collection.TEAMS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        aufstellungen_collection=database[Collection.AUFSTELLUNGEN],
        db=database.client,
        today=TODAY,
    )


async def read_view(database: AsyncDatabase, token: str, *, today: str = TODAY) -> Any:
    return await viewed(database, token, today=today)


async def answer(
    database: AsyncDatabase,
    token: str,
    *,
    answer: str = "given",
    today: str = TODAY,
    media: bool = False,
    saisons: Any = None,
) -> Any:
    body: dict[str, Any] = {"token": token, "answer": answer}
    if answer == "given":
        body |= {"birth_date": AN_ADULTS_BIRTHDATE, "whatsapp": True, "media": media, "text_versions": dict(documents.SEAT_TEXT_VERSIONS)}

    return await answered(
        database,
        database.client,
        body,
        today=today,
        germany_now=NOW,
        saisons_collection=database[Collection.SAISONS] if saisons is None else saisons,
    )


async def ban(database: AsyncDatabase, client: AsyncMongoClient, email: str) -> Any:
    return await ban_through_the_route(database, client, email=email, ban_reason="Wiederholte Falschangaben", by=ADMIN, today=TODAY)


async def row_now(database: AsyncDatabase, row_id: ObjectId = ROW_OID) -> Mapping[str, Any]:
    return await the_row(database, Collection.SAISON_TEAMS, {"_id": row_id}, "the seeded row is gone")


async def seats_of(database: AsyncDatabase, client: AsyncMongoClient, email: str) -> list[tuple[str, str]]:
    async with client.start_session() as session:
        subject = await roles_of(email, record_collections(database), session=session)

    return [(seat.saison_id, seat.seat) for seat in subject.seats]


class TestTheSaveMintsForEachPersonItNewlySeats:
    async def test_a_new_person_on_a_seat_is_minted_one_link_stored_as_its_hash_alone(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, {**THREE, "ansprechperson": None, "stellvertretung": None})

            return response, await row_now(database), await where_held(database, response.confirmations[0].token)

        response, row, held = await on_a_league(mongo_replica_set_url, body)

        assert [(mint.seats, mint.email, mint.deadline, mint.schule, mint.row) for mint in response.confirmations] == [
            (["trainer"], "ida@example.com", DEADLINE, TEAM_NAME, "open")
        ]
        token = response.confirmations[0].token
        assert row["confirmations"] == {
            "trainer": {"token_hashes": [hash_token(token)], "sent_at": TODAY, "deadline": DEADLINE, "declined_at": None},
            "ansprechperson": None,
            "stellvertretung": None,
        }
        assert held[token] == [], "the raw link is stored somewhere, so a read of the database recovers it"

    async def test_three_new_people_are_minted_three_links_each_opening_its_own_seat(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)

            return response, [await read_view(database, mint.token) for mint in response.confirmations]

        response, views = await on_a_league(mongo_replica_set_url, body)

        assert [mint.seats for mint in response.confirmations] == [["trainer"], ["ansprechperson"], ["stellvertretung"]]
        assert [(view.record, view.seat, view.state, view.schule) for view in views] == [
            ("saison", "trainer", "valid", TEAM_NAME),
            ("saison", "ansprechperson", "valid", TEAM_NAME),
            ("saison", "stellvertretung", "valid", TEAM_NAME),
        ]

    async def test_a_trainer_holding_a_second_seat_is_minted_one_link_for_both(self, mongo_replica_set_url: str):
        """One link per person: two would leave the first answering for a seat the second has already answered."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, PAIRED)

            return response, await row_now(database), await read_view(database, response.confirmations[0].token)

        response, row, view = await on_a_league(mongo_replica_set_url, body)

        assert [mint.seats for mint in response.confirmations] == [["trainer", "stellvertretung"], ["ansprechperson"]]
        assert row["confirmations"]["trainer"] == row["confirmations"]["stellvertretung"]
        assert (view.seat, view.also_seat) == ("trainer", "stellvertretung")
        # The floor of both seats, the Stellvertretung's being the higher: the page judges the birthdate by it.
        assert SEAT_MIN_AGE_YEARS["stellvertretung"] > SEAT_MIN_AGE_YEARS["trainer"]
        assert view.minimum_age == SEAT_MIN_AGE_YEARS["stellvertretung"]

    async def test_re_saving_a_person_whose_link_is_out_keeps_that_link(self, mongo_replica_set_url: str):
        """A second save of the same people mails nobody twice: the link already in their inbox stays the one that works."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            first = await save(database, THREE)
            again = await save(database, THREE)

            return first, again, await read_view(database, first.confirmations[0].token)

        first, again, view = await on_a_league(mongo_replica_set_url, body)

        assert len(first.confirmations) == 3
        assert again.confirmations == []
        assert view.state == "valid"

    async def test_a_seat_handed_to_another_person_leaves_the_first_link_opening_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            first = await save(database, THREE)
            handed = await save(database, {**THREE, "ansprechperson": person("Lea")})
            old_token = next(mint.token for mint in first.confirmations if mint.seats == ["ansprechperson"])

            return handed, await refused_code(read_view(database, old_token)), await read_view(database, handed.confirmations[0].token)

        handed, code, view = await on_a_league(mongo_replica_set_url, body)

        assert [mint.seats for mint in handed.confirmations] == [["ansprechperson"]]
        assert code == Code.LINK_INVALID
        assert view.seat == "ansprechperson"


class TestTheResend:
    async def test_a_seat_holding_no_link_is_sent_its_first(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await resend(database, "ansprechperson")

            return response, await row_now(database), await read_view(database, response.confirmation.token)

        response, row, view = await on_a_league(mongo_replica_set_url, body, kontakte=STORED_UNCONFIRMED)

        assert (response.confirmation.seats, response.confirmation.email, response.confirmation.deadline) == (
            ["ansprechperson"],
            "jonas@example.com",
            DEADLINE,
        )
        assert response.confirmation.schule == TEAM_NAME
        assert (row["confirmations"]["trainer"], row["confirmations"]["stellvertretung"]) == (None, None)
        assert (view.seat, view.state) == ("ansprechperson", "valid")

    async def test_a_resend_replaces_the_link_and_restarts_the_deadline(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            first = await save(database, THREE)
            again = await resend(database, "trainer", today="2026-04-05")

            return first, again, await refused_code(read_view(database, first.confirmations[0].token)), await row_now(database)

        first, again, code, row = await on_a_league(mongo_replica_set_url, body)

        assert code == Code.LINK_INVALID
        assert row["confirmations"]["trainer"]["deadline"] == confirmation_deadline_from(today="2026-04-05") == again.confirmation.deadline
        # The two seats the re-send did not name keep the links already in their inboxes.
        assert row["confirmations"]["ansprechperson"]["token_hashes"] == [hash_token(first.confirmations[1].token)]

    async def test_a_resend_for_a_trainer_holding_a_second_seat_answers_both(self, mongo_replica_set_url: str):
        paired = {**STORED_UNCONFIRMED, "stellvertretung": stored("Ida"), "trainer_is_also": "stellvertretung"}

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await resend(database, "stellvertretung")

            return response, await row_now(database)

        response, row = await on_a_league(mongo_replica_set_url, body, kontakte=paired)

        assert response.confirmation.seats == ["trainer", "stellvertretung"]
        assert row["confirmations"]["trainer"] == row["confirmations"]["stellvertretung"] is not None

    @pytest.mark.parametrize(
        "kontakte",
        [
            pytest.param({**STORED_UNCONFIRMED, "trainer": stored("Ida", confirmed_at="2026-03-20")}, id="a seat its person has confirmed"),
        ],
    )
    async def test_a_seat_with_nothing_left_to_confirm_is_refused_and_writes_nothing(
        self, mongo_replica_set_url: str, kontakte: dict[str, Any]
    ):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            before = await row_now(database)

            return await refused_code(resend(database, "trainer")), before, await row_now(database)

        code, before, after = await on_a_league(mongo_replica_set_url, body, kontakte=kontakte)

        assert code == Code.KONTAKT_SEAT_WITHOUT_CONFIRMATION
        assert after == before


class TestTheLinkConfirms:
    async def test_confirming_stamps_the_seat_and_the_seat_then_grants_its_panel(self, mongo_replica_set_url: str):
        """`roles_of` answers a seat only once its own person has confirmed it, so before the press it answers nothing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            before = await seats_of(database, client, "jonas@example.com")
            await answer(database, response.confirmations[1].token)

            return before, await row_now(database), await seats_of(database, client, "jonas@example.com")

        before, row, after = await on_a_league(mongo_replica_set_url, body)

        assert before == []
        seat = row["kontakte"]["ansprechperson"]
        assert (seat["birth_date"], seat["einwilligung"]["confirmed_at"]) == (AN_ADULTS_BIRTHDATE, TODAY)
        assert seat["einwilligung"]["scope"] == "kontakt_data_whatsapp"
        assert row["kontakte"]["trainer"]["einwilligung"]["confirmed_at"] is None, "the press reached a seat its link does not open"
        assert after == [(SAISON_ID, "ansprechperson")]

    async def test_a_trainer_holding_a_second_seat_confirms_both_with_one_press(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, PAIRED)
            await answer(database, response.confirmations[0].token)

            return await row_now(database)

        row = await on_a_league(mongo_replica_set_url, body)

        assert [row["kontakte"][seat]["einwilligung"]["confirmed_at"] for seat in SEATS] == [TODAY, None, TODAY]

    @pytest.mark.parametrize(
        ("confirmed", "newly"),
        [
            pytest.param("trainer", "stellvertretung", id="the Trainer confirmed, the seat they come to hold not"),
            pytest.param("stellvertretung", "trainer", id="the seat they also hold confirmed, the Trainer's not"),
        ],
    )
    async def test_a_half_confirmed_pair_offers_and_confirms_only_the_seat_its_link_was_minted_for(
        self, mongo_replica_set_url: str, confirmed: str, newly: str
    ):
        """The page names what the press writes: no second seat, and the floor of the one seat the link answers.

        The earlier answer stands: its stamp, its date and its scope are the person's own, given on another day.
        """

        before = {**STORED_UNCONFIRMED, confirmed: stored("Ida", confirmed_at="2026-03-20"), newly: stored("Lea")}
        spent = {**compose_kontakt_confirmation(today="2026-03-10"), "token_hashes": [hash_token("the-link-already-answered")]}

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, PAIRED)
            view = await read_view(database, response.confirmations[0].token)
            await answer(database, response.confirmations[0].token)

            return response, view, await row_now(database)

        response, view, row = await on_a_league(
            mongo_replica_set_url,
            body,
            kontakte=before,
            row_fields={"confirmations": {seat: spent if seat == confirmed else None for seat in SEATS}},
        )

        assert [mint.seats for mint in response.confirmations] == [[newly]]
        assert (view.seat, view.also_seat, view.minimum_age) == (newly, None, SEAT_MIN_AGE_YEARS[newly])
        held = row["kontakte"][confirmed]
        assert (held["einwilligung"]["confirmed_at"], held["einwilligung"]["scope"]) == ("2026-03-20", "kontakt_data")
        assert row["kontakte"][newly]["einwilligung"]["confirmed_at"] == TODAY, "the press confirmed nothing, so this case proves nothing"

    async def test_an_objection_empties_the_seat_and_records_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            token = response.confirmations[2].token
            await answer(database, token, answer="declined")

            return await row_now(database), await read_view(database, token)

        row, view = await on_a_league(mongo_replica_set_url, body)

        assert row["kontakte"]["stellvertretung"] is None
        assert row["confirmations"]["stellvertretung"]["declined_at"] == TODAY
        assert view.state == "declined"

    async def test_a_second_answer_on_the_link_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            await answer(database, response.confirmations[0].token)

            return await refused_code(answer(database, response.confirmations[0].token))

        assert await on_a_league(mongo_replica_set_url, body) == Code.BEWERBUNG_SEAT_ALREADY_ANSWERED

    async def test_a_link_opens_its_own_row_with_another_rows_link_seeded_first(self, mongo_replica_set_url: str):
        """The other club's row comes first in natural order, so a lookup that does not match on the hash lands there."""

        other = junction(
            OTHER_ROW_OID,
            OTHER_TEAM_OID,
            STORED_UNCONFIRMED,
            confirmations={
                "trainer": {**compose_kontakt_confirmation(today=TODAY), "token_hashes": [hash_token("the-other-clubs-link")]},
                "ansprechperson": None,
                "stellvertretung": None,
            },
            name="Falken",
            shorthand="FAX",
        )

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            view = await read_view(database, response.confirmations[0].token)
            await answer(database, response.confirmations[0].token)

            return view, await row_now(database), await row_now(database, OTHER_ROW_OID)

        view, row, other_row = await on_a_league(mongo_replica_set_url, body, rows=[other])

        assert view.schule == TEAM_NAME
        assert row["kontakte"]["trainer"]["einwilligung"]["confirmed_at"] == TODAY
        assert other_row["kontakte"]["trainer"]["einwilligung"]["confirmed_at"] is None


class TestTheDeadline:
    async def test_a_link_past_its_deadline_reads_as_over_and_takes_no_consent(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            token = response.confirmations[0].token

            return (
                await read_view(database, token, today=DEADLINE),
                await read_view(database, token, today=AFTER_THE_DEADLINE),
                await refused_code(answer(database, token, today=AFTER_THE_DEADLINE)),
            )

        on_the_day, after, code = await on_a_league(mongo_replica_set_url, body)

        assert on_the_day.state == "valid", "the deadline's own day still takes the link"
        assert after.state == "expired"
        assert code == Code.LINK_EXPIRED

    async def test_a_confirmed_person_pressing_again_after_it_is_told_the_answer_stands(self, mongo_replica_set_url: str):
        """Judged as the reopened link shows it: an expired link would tell them to doubt an answer that counted."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            token = response.confirmations[0].token
            await answer(database, token)

            return await refused_code(answer(database, token, today=AFTER_THE_DEADLINE))

        assert await on_a_league(mongo_replica_set_url, body) == Code.BEWERBUNG_SEAT_ALREADY_ANSWERED


class TestARowsPeopleLeavingTakeTheirLinks:
    async def test_a_replaced_team_s_links_open_nothing_on_the_incoming_team_s_row(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            await replace(database)

            return [await refused_code(read_view(database, mint.token)) for mint in response.confirmations], await row_now(database)

        codes, row = await on_a_league(mongo_replica_set_url, body)

        assert codes == [Code.LINK_INVALID] * 3
        assert (row["team_id"], row["confirmations"]) == (INCOMING_TEAM_OID, None)

    async def test_an_erased_person_s_link_opens_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            await erased(database, database.client, "jonas@example.com", germany_now=NOW)

            return await refused_code(read_view(database, response.confirmations[1].token))

        assert await on_a_league(mongo_replica_set_url, body) == Code.LINK_INVALID

    async def test_a_seat_emptied_beside_its_live_link_opens_nothing(self, mongo_replica_set_url: str):
        """The state no route leaves and a hand edit can: the seat gone, its link live, no Widerspruch recorded."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            await database[Collection.SAISON_TEAMS].update_one({"_id": ROW_OID}, {"$set": {"kontakte.ansprechperson": None}})

            return await refused_code(read_view(database, response.confirmations[1].token))

        assert await on_a_league(mongo_replica_set_url, body) == Code.LINK_INVALID


class TestAnApplicationsLinkIsAnsweredAsBefore:
    async def test_an_application_seat_link_reads_as_the_application_s(self, mongo_replica_set_url: str):
        """The application is asked first: a token a season row holds as well, which no mint can make, still reads as the application's."""

        raw = "an-applications-link"
        hashes: Mapping[str, str] = {seat: hash_token(f"{raw}-{seat}") for seat in SEATS}

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            # The season row holds the application's Trainer hash too, so only the order decides which record answers.
            await database[Collection.SAISON_TEAMS].update_one(
                {"_id": ROW_OID},
                {
                    "$set": {
                        "kontakte": STORED_UNCONFIRMED,
                        "confirmations": {
                            "trainer": {**compose_kontakt_confirmation(today=TODAY), "token_hashes": [hashes["trainer"]]},
                            "ansprechperson": None,
                            "stellvertretung": None,
                        },
                    }
                },
            )
            await database[Collection.BEWERBUNGEN].insert_one(
                documents.bewerbung_document(
                    ObjectId("6890a1b2c3d4e5f607a50021"),
                    SAISON_ID,
                    "submitted",
                    kontakte={seat: documents.kontaktperson_document(name) for seat, name in zip(SEATS, ("Ida", "Jonas", "Klara"), strict=True)}
                    | {"trainer_is_also": None},
                    submitted_at="2026-03-20",
                    confirmation_deadline=DEADLINE,
                    team_id=TEAM_OID,
                    link_prefix=raw,
                    sent_at=TODAY,
                )
            )
            view = await read_view(database, f"{raw}-trainer")
            await answer(database, f"{raw}-trainer")
            application = await database[Collection.BEWERBUNGEN].find_one({"_id": ObjectId("6890a1b2c3d4e5f607a50021")})
            assert application is not None

            return view, application["kontakte"]["trainer"]["einwilligung"]["confirmed_at"]

        view, confirmed_at = await on_a_league(mongo_replica_set_url, body)

        assert (view.record, view.schule, view.seat) == ("bewerbung", TEAM_NAME, "trainer")
        # The press confirmed the application's seat.
        assert confirmed_at == TODAY


class TestARowNoLongerInTheSeason:
    """Neither a `past` season nor a withdrawn team offers a seat to confirm, so a link there takes a Widerspruch alone."""

    @pytest.mark.parametrize(
        ("saison_status", "row_fields", "kontakt_row"),
        [
            pytest.param("past", {}, "saison_past", id="a season that has ended"),
            pytest.param(
                "active",
                {"austritt": {"type": "rueckzug", "reason": "Keine Mannschaft mehr", "date": "2026-03-01"}},
                "exited",
                id="a team that left",
            ),
        ],
    )
    async def test_a_person_the_save_newly_seats_is_minted_a_link_taking_their_objection(
        self, mongo_replica_set_url: str, saison_status: str, row_fields: dict[str, Any], kontakt_row: str
    ):
        """The link is how a person entered there learns of it (Art. 14 (3)(a) GDPR), so the save mints one all the same."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            token = response.confirmations[0].token
            view = await read_view(database, token)
            consent = await refused_code(answer(database, token))
            await answer(database, token, answer="declined")

            return response, view, consent, await row_now(database)

        response, view, consent, row = await on_a_league(mongo_replica_set_url, body, saison_status=saison_status, row_fields=row_fields)

        assert [(mint.seats, mint.row) for mint in response.confirmations] == [
            (["trainer"], kontakt_row),
            (["ansprechperson"], kontakt_row),
            (["stellvertretung"], kontakt_row),
        ]
        assert (view.state, consent) == ("saison_past", Code.KONTAKT_SAISON_PAST)
        assert row["kontakte"]["trainer"] is None
        assert row["confirmations"]["trainer"]["declined_at"] == TODAY

    @pytest.mark.parametrize(
        ("saison_status", "row_fields"),
        [
            pytest.param("past", {}, id="a season that has ended"),
            pytest.param(
                "active",
                {"austritt": {"type": "rueckzug", "reason": "Keine Mannschaft mehr", "date": "2026-03-01"}},
                id="a team that left",
            ),
        ],
    )
    async def test_a_resend_is_refused_and_writes_nothing(self, mongo_replica_set_url: str, saison_status: str, row_fields: dict[str, Any]):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            before = await row_now(database)

            return await refused_code(resend(database, "trainer")), before, await row_now(database)

        code, before, after = await on_a_league(
            mongo_replica_set_url, body, kontakte=STORED_UNCONFIRMED, saison_status=saison_status, row_fields=row_fields
        )

        assert code == Code.KONTAKT_ROW_WITHOUT_SAISON
        assert after == before


ITS_TEAM_LEFT: dict[str, Any] = {"$set": {"austritt": {"type": "rueckzug", "reason": "Keine Mannschaft mehr", "date": "2026-04-01"}}}


class TestALinkOutlivingItsSeason:
    """A link minted while the season ran asks no consent once it has ended or the team left it."""

    async def closed(self, database: AsyncDatabase, how: str) -> None:
        if how == "past":
            await database[Collection.SAISONS].update_one({"_id": SAISON_ID}, {"$set": {"status": "past"}})
        if how == "austritt":
            await database[Collection.SAISON_TEAMS].update_one({"_id": ROW_OID}, ITS_TEAM_LEFT)

    @pytest.mark.parametrize(
        ("how", "row"),
        [
            pytest.param("past", "saison_past", id="the season ended"),
            pytest.param("austritt", "exited", id="the team left"),
        ],
    )
    async def test_its_view_offers_an_objection_alone_and_its_refused_consent_writes_nothing(
        self, mongo_replica_set_url: str, how: str, row: str
    ):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            token = (await save(database, THREE)).confirmations[0].token
            open_view = await read_view(database, token)
            await self.closed(database, how)
            before = await row_now(database)

            return open_view, await read_view(database, token), await refused_code(answer(database, token)), before, await row_now(database)

        open_view, view, code, before, after = await on_a_league(mongo_replica_set_url, body)

        assert open_view.state == "valid"
        assert (view.state, view.row) == ("saison_past", row)
        assert code == Code.KONTAKT_SAISON_PAST
        assert after == before

    @pytest.mark.parametrize("how", [pytest.param("past", id="the season ended"), pytest.param("austritt", id="the team left")])
    async def test_an_objection_on_it_is_still_taken(self, mongo_replica_set_url: str, how: str):
        """The person may always remove themselves, whatever became of the season."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            token = (await save(database, THREE)).confirmations[0].token
            await self.closed(database, how)
            await answer(database, token, answer="declined")

            return await row_now(database), await read_view(database, token)

        row, reopened = await on_a_league(mongo_replica_set_url, body)

        assert row["kontakte"]["trainer"] is None
        assert row["confirmations"]["trainer"]["declined_at"] == TODAY
        # Its answer outranks the closed row, as `confirmed` does.
        assert reopened.state == "declined"


NEXT_SAISON_ID = "2027"


class TestARolloverInsideTheConsentPress:
    """The rollover reads nothing the press writes, so a press that read `active` commits across one landing inside it.

    An anchor on the season would make it retry against every write to the season document instead.
    """

    async def test_a_press_that_read_the_season_active_commits_across_a_rollover_inside_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISONS].insert_one(documents.saison_document(NEXT_SAISON_ID, "future"))
            # What makes the next season activatable (`activate_target_undrawn`).
            await database[Collection.SPIELE].insert_one(
                documents.spiel_document(spiel_id=ObjectId(), saison_id=NEXT_SAISON_ID, spiel_nr=1, spieltag_id=ObjectId())
            )
            token = (await save(database, THREE)).confirmations[0].token

            async def roll_over() -> None:
                await activate_saison(
                    saison_id=NEXT_SAISON_ID,
                    saisons_collection=database[Collection.SAISONS],
                    spiele_collection=database[Collection.SPIELE],
                    spieltage_collection=database[Collection.SPIELTAGE],
                    ban_list_collection=database[Collection.BAN_LIST],
                    db=client,
                )

            # Once the press holds the season's status, and before it writes the row.
            seasons = InterleavedCollection(database[Collection.SAISONS], roll_over, after="find_one")
            await answer(database, token, saisons=cast(AsyncCollection, seasons))
            saison = await database[Collection.SAISONS].find_one({"_id": SAISON_ID}, projection={"status": 1})

            return seasons.passes, saison, await row_now(database)

        passes, saison, row = await on_a_league(mongo_replica_set_url, body)

        # Both landed: the season ended under the press, and the press it read as running committed.
        assert saison is not None and saison["status"] == "past"
        assert row["kontakte"]["trainer"]["einwilligung"]["confirmed_at"] == TODAY
        assert passes == 1, "the press read the season again, so something it writes now conflicts with the rollover"


class TestAConfirmedPersonMovedToANewMailbox:
    async def test_is_linked_there_unconfirmed(self, mongo_replica_set_url: str):
        """The league's route for a person holding contact seats alone: the new mailbox confirms afresh."""

        confirmed = {**STORED_UNCONFIRMED, "trainer": stored("Ida", confirmed_at="2026-03-20")}

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, {**THREE, "trainer": {**person("Ida"), "email": "ida@neu.example.com"}})

            return response, await row_now(database)

        response, row = await on_a_league(mongo_replica_set_url, body, kontakte=confirmed)

        assert [(mint.seats, mint.email) for mint in response.confirmations] == [(["trainer"], "ida@neu.example.com")]
        assert row["kontakte"]["trainer"]["einwilligung"]["confirmed_at"] is None
