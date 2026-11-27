from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any, Final, cast
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId, encode
from pymongo import AsyncMongoClient, monitoring
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.api.bewerbungen.admin_router import (
    accept_bewerbung,
    decline_bewerbung,
    post_kontakt_seat,
)
from app.api.bewerbungen.schemas import (
    FLAcceptBewerbungPayload,
    FLBewerbungKontaktSeatPayload,
    FLDeclineBewerbungPayload,
)
from app.api.bewerbungen.services import compose_new_team, confirmation_deadline_from
from app.api.outbox.crud import states_of
from app.api.outbox.schemas import FLBewerbungAbsageData, FLBewerbungLinkData
from app.api.teams.crud import found_a_team
from app.api.teams.schemas import FLPostTeamPayload
from app.core.codes import Code
from app.core.collections import Collection
from app.core.db import new_client
from app.core.exceptions import APIError, DocumentNotFoundError
from app.core.transactions import transaction_session
from app.shared.tokens import hash_token
from tests import documents
from tests.app_client import app_client, app_under_test
from tests.bewerbung_routes import answered, resent, viewed
from tests.config import ADMIN_AUTH, ADMIN_KEY, grants_for_the_suite
from tests.database import DOCUMENT_VALIDATION_FAILED, a_clean_database
from tests.delivery import a_mail_that_bounced
from tests.documents import (
    ADDRESS,
    kontaktperson_document,
    minted_confirmations,
    rules_document,
    saison_document,
    saison_team_document,
    team_document,
)
from tests.erasure import erased
from tests.isolation import InterleavedCollection, refused_code
from tests.outbox import MAIL_NOW, drained
from tests.session_headers import StampedHeaders
from tests.stored import the_row
from tests.worker import worker_database

DATABASE_NAME = worker_database("fl_bewerbung_triage_test")


SAISON_ID = "2026"

# Injected through `get_germany_now`, so the stamp the decision carries is not the wall clock; a century ahead of it, every
# seeded day and birthdate with it: the TTL monitor deletes a row whose delete date has passed, under a case reading it back.
NOW = datetime(2126, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
TODAY = "2126-04-01"

# The administrator the request is attributed to. Distinctive, so a sweep for it cannot hit seed data.
ADMIN_EMAIL = "triage.quillhilde@example.com"
# The administrator the suite binds for a handler called directly, outside any request.
BOUND_ADMINISTRATOR = "admin@frankfurtleague.de"

# Fixed rather than generated, so a failure names the same row every run.
EXISTING_OID = ObjectId("6890a1b2c3d4e5f607910001")
RETIRED_OID = ObjectId("6890a1b2c3d4e5f607910002")
FILLER_OIDS = (ObjectId("6890a1b2c3d4e5f607910003"), ObjectId("6890a1b2c3d4e5f607910004"))

PICKED_BEWERBUNG = ObjectId("6890a1b2c3d4e5f607920001")
NEW_SCHOOL_BEWERBUNG = ObjectId("6890a1b2c3d4e5f607920002")
RETIRED_BEWERBUNG = ObjectId("6890a1b2c3d4e5f607920003")
CLASHING_BEWERBUNG = ObjectId("6890a1b2c3d4e5f607920004")
# Seeded by its own class: `bewerbungen` types `website_url` as a bare string, so nothing in the database refuses it.
UNUSABLE_BEWERBUNG = ObjectId("6890a1b2c3d4e5f607920007")

# An XSS sink once React renders it into the club page's href, and a value `FLTeam` refuses on read.
UNUSABLE_URL = "javascript:alert(1)"

EXISTING_NAME, EXISTING_SHORTHAND = "Adler", "ADX"
RETIRED_NAME, RETIRED_SHORTHAND = "Bieber", "BIX"

# The club the new school becomes. Its letters are free, unlike `EXISTING_SHORTHAND`.
NEW_SCHOOL_NAME, NEW_SCHOOL_SHORTHAND = "Zorbanax", "ZXX"

# Two groups of two, so one seeded pair fills `A` and `entry_gruppe_full` is reachable without twenty rows.
RULES: Mapping[str, Any] = rules_document(number_of_gruppen=2, teams_per_gruppe=2)


# The seat as its applicant named the person, and as that person then confirmed it.
SEATED: Final = {"date": "2126-01-15"}


def kontaktperson(first_name: str, *, phone: str) -> dict[str, Any]:
    """One of the three people an application is filled in by, in the shape the junction stores them."""

    return kontaktperson_document(first_name, confirmed_at="2126-01-16", einwilligung=SEATED, phone=phone, birth_date="2080-05-04")


# Distinct per seat, so a block copied across with two seats swapped fails rather than compares equal.
KONTAKTE: Mapping[str, Any] = {
    "trainer": kontaktperson("Wraxlington", phone="+49 69 90009111"),
    "ansprechperson": kontaktperson("Quillhilde", phone="+49 69 90009222"),
    "stellvertretung": kontaktperson("Bramblewick", phone="+49 69 90009333"),
    # Null, never a seat name: the three seats hold three people, and the flag is a claim of its own.
    "trainer_is_also": None,
}


def seeded_team(team_id: ObjectId, name: str, shorthand: str, *, inactive_since: str | None = None) -> dict[str, Any]:
    return team_document(team_id, name, shorthand, schulform="gymnasium_g9", inactive_since=inactive_since)


def schule_block(team_name: str) -> dict[str, Any]:
    """What a school proposes when it picked no existing club, spelled as `teams` spells it."""

    return {
        "team_name": team_name,
        "full_name": f"{team_name}-Gesamtschule",
        "schulform": "gesamtschule",
        "address": dict(ADDRESS),
        "website_url": f"https://{team_name.lower()}.example.net",
    }


def bewerbung_document(
    bewerbung_id: ObjectId, *, team_id: ObjectId | None = None, schule: dict[str, Any] | None = None, **overrides: Any
) -> dict[str, Any]:
    """One submitted application, undecided. Every field the record model requires, and nothing the triage writes.

    Every seat is confirmed by its own person, so acceptance is not held back by `bewerbung_kontakte_unconfirmed` unless a case opens one.
    """

    fields = {
        "kontakte": {seat: dict(person) if isinstance(person, dict) else person for seat, person in KONTAKTE.items()},
        "submitted_at": "2126-02-01",
        "trikot": {"existing_set": "16 rote Trikots, Größe M", "wunschfarbe": "rot"},
        **overrides,
    }

    return documents.bewerbung_document(bewerbung_id, SAISON_ID, "submitted", team_id=team_id, schule=schule, **fields)


def junction_document(team_id: ObjectId, name: str, shorthand: str, gruppe: str) -> dict[str, Any]:
    """A club already standing in the season, which is how a group comes to be full."""

    return saison_team_document(SAISON_ID, team_id, name, shorthand, gruppe=gruppe)


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


async def on_a_league(url: str, body: Body, *, saison_status: str = "future", occupied: int = 0, mutates_schema: bool = False) -> Any:
    """A clean database carrying the shipped indexes, so a duplicate production would refuse fails here too.

    `occupied` fills group `A`, the only route to `entry_gruppe_full`.
    """

    async with a_clean_database(url, DATABASE_NAME, constraints=True, mutates_schema=mutates_schema) as (client, database):
        await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, saison_status, rules=dict(RULES)))
        await database[Collection.GRANTS].insert_many(grants_for_the_suite())
        await database[Collection.TEAMS].insert_many(
            [
                seeded_team(EXISTING_OID, EXISTING_NAME, EXISTING_SHORTHAND),
                seeded_team(RETIRED_OID, RETIRED_NAME, RETIRED_SHORTHAND, inactive_since="2126-03-01"),
            ]
        )
        if occupied:
            await database[Collection.SAISON_TEAMS].insert_many(
                [junction_document(FILLER_OIDS[index], f"Fueller {index}", f"F{index}", "A") for index in range(occupied)]
            )
        await database[Collection.BEWERBUNGEN].insert_many(
            [
                bewerbung_document(PICKED_BEWERBUNG, team_id=EXISTING_OID),
                bewerbung_document(NEW_SCHOOL_BEWERBUNG, schule=schule_block(NEW_SCHOOL_NAME)),
                bewerbung_document(RETIRED_BEWERBUNG, team_id=RETIRED_OID),
                bewerbung_document(CLASHING_BEWERBUNG, schule=schule_block("Kollision")),
            ]
        )

        return await body(database, client)


async def accept(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    bewerbung_id: ObjectId,
    *,
    gruppe: str = "A",
    trikot_farbe: str | None = "blau",
    shorthand: str | None = None,
    version: int | None = None,
) -> Any:
    """`version` for a case watching this call's own reads; by default as a page reading the application now would send it."""

    version = (await stored_bewerbung(database, bewerbung_id))["version"] if version is None else version

    return await accept_bewerbung(
        bewerbung_id=bewerbung_id,
        acceptance_data=FLAcceptBewerbungPayload.model_validate(
            {"gruppe": gruppe, "trikot_farbe": trikot_farbe, "shorthand": shorthand, "version": version}
        ),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        teams_collection=database[Collection.TEAMS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        outbox_collection=database[Collection.OUTBOX],
        db=client,
        today=TODAY,
        germany_now=MAIL_NOW,
    )


DECISION_REASON = "Die Gruppen sind für diese Saison bereits besetzt."


async def decline(database: AsyncDatabase, bewerbung_id: ObjectId, *, reason: str = DECISION_REASON) -> Any:
    version = (await stored_bewerbung(database, bewerbung_id))["version"]

    return await decline_bewerbung(
        bewerbung_id=bewerbung_id,
        decline_data=FLDeclineBewerbungPayload(reason=reason, version=version),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        teams_collection=database[Collection.TEAMS],
        outbox_collection=database[Collection.OUTBOX],
        today=TODAY,
        db=database.client,
        germany_now=MAIL_NOW,
    )


async def stored_bewerbung(database: AsyncDatabase, bewerbung_id: ObjectId) -> Mapping[str, Any]:
    return await the_row(
        database, Collection.BEWERBUNGEN, {"_id": bewerbung_id}, "the seeded application is gone, which no triage endpoint may do"
    )


async def junction_rows(database: AsyncDatabase, **narrow: Any) -> list[Mapping[str, Any]]:
    return await database[Collection.SAISON_TEAMS].find(narrow).to_list(length=None)


# The clubs `on_a_league` seeds. Named, because "no club was created" is asserted as this number.
SEEDED_TEAMS = 2


async def through_the_app(
    url: str, bewerbung_id: ObjectId, endpoint: str, payload: Mapping[str, Any], *, actor: str | None = ADMIN_EMAIL
) -> Any:
    """One triage decision driven as a REAL request, exception handlers included.

    `endpoint` is positional and required: the two decisions write different blocks, so a default
    here would let a test claim to serve one while serving the other.
    """

    headers = {**ADMIN_AUTH} if actor is None else StampedHeaders(actor, ADMIN_KEY)
    path = f"/api/bewerbungen/{bewerbung_id}/{endpoint}"

    # A client of its own rather than the seeding one: the seeding client has to outlive the
    # request, every caller reading `database` afterwards to assert what the request wrote.
    async with app_client(url, app=app_under_test(DATABASE_NAME), now=NOW) as http:
        return await http.post(path, json=dict(payload), headers=headers)


@pytest.mark.db
class TestAnAcceptanceEntersTheSchool:
    """The three writes, against a real mongod: a club where the school is new, the junction row, and the application."""

    async def test_a_new_school_gets_a_team_that_the_application_then_names(self, mongo_replica_set_url: str):
        """Catches an acceptance that enters the school without writing the created id back: nothing would join the two."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await accept(database, client, NEW_SCHOOL_BEWERBUNG, shorthand=NEW_SCHOOL_SHORTHAND)
            created = await database[Collection.TEAMS].find_one({"shorthand": NEW_SCHOOL_SHORTHAND})

            return created, await junction_rows(database), await stored_bewerbung(database, NEW_SCHOOL_BEWERBUNG)

        created, rows, stored = await on_a_league(mongo_replica_set_url, body)

        assert created is not None, "no club was created for a school that named none"
        assert (created["name"], created["full_name"]) == (NEW_SCHOOL_NAME, f"{NEW_SCHOOL_NAME}-Gesamtschule")
        # Empty rather than composed: a sentence the league wrote would stand on the team page as the school's own.
        assert (created["description"], created["inactive_since"]) == ("", None)

        assert len(rows) == 1
        assert (rows[0]["team_id"], rows[0]["gruppe"], rows[0]["austritt"]) == (created["_id"], "A", None)
        assert (rows[0]["name"], rows[0]["shorthand"]) == (NEW_SCHOOL_NAME, NEW_SCHOOL_SHORTHAND)

        # The write the acceptance owes the application: without it a new school's row names no club.
        assert (stored["status"], stored["team_id"]) == ("accepted", created["_id"])
        assert stored["decision"] == {"made_at": TODAY, "reason": None}

    async def test_an_application_naming_an_existing_team_enters_it_with_its_people_and_the_given_colour(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await database[Collection.TEAMS].count_documents({})
            await accept(database, client, PICKED_BEWERBUNG, trikot_farbe="gruen")

            return (
                before,
                await database[Collection.TEAMS].count_documents({}),
                await junction_rows(database),
                await stored_bewerbung(database, PICKED_BEWERBUNG),
                await viewed(database, f"{PICKED_BEWERBUNG}-trainer", today=TODAY),
            )

        before, after, rows, stored, view = await on_a_league(mongo_replica_set_url, body)

        # A branch creating a club whatever the application said would duplicate every returning school.
        assert (before, after) == (SEEDED_TEAMS, SEEDED_TEAMS), "an application naming an existing club created one"
        [row] = rows
        # The club's name as it stands TODAY, copied at entry rather than joined on read.
        assert (row["team_id"], row["name"], row["shorthand"]) == (EXISTING_OID, EXISTING_NAME, EXISTING_SHORTHAND)

        # The people arrive WITH the season's row, as they confirmed, against the seed so a copy of an emptied block fails.
        assert row["kontakte"] == KONTAKTE, "the three people did not reach the season row as they confirmed"
        # The bookkeeping block stays on the application: a hash copied into the junction would live there for a season.
        assert "confirmations" not in row

        # One copy of each person stands, the season row's; the application keeps each seat's day, which its link shows.
        assert stored["kontakte"] == {"trainer": None, "ansprechperson": None, "stellvertretung": None, "trainer_is_also": None}
        assert [name for name in ("Wraxlington", "Quillhilde", "Bramblewick") if name in str(stored)] == [], "the application kept a copy"
        assert {seat: entry["confirmed_on"] for seat, entry in stored["confirmations"].items()} == {
            "trainer": "2126-01-16",
            "ansprechperson": "2126-01-16",
            "stellvertretung": "2126-01-16",
        }
        assert (view.state, view.answered_at) == ("confirmed", "2126-01-16"), "a reopened link no longer shows the confirmation"

        # A wish is not an assignment: two schools may wish for one colour, and the row records what was given.
        assert (row["trikot_farbe"], stored["trikot"]["wunschfarbe"]) == ("gruen", "rot"), "the wish stood in for the assigned colour"


@pytest.mark.db
class TestTheSeasonsOwnEntryRulesReachTheAcceptance:
    """`find_entry_refusal` is REUSED rather than restated, so these prove the reuse arrives.

    Each asserts on the write as well as the code: a rule that refuses without stopping the writes
    would leave a club created for a school that never entered.
    """

    async def test_a_full_group_is_refused_and_no_team_is_created_for_the_new_school(self, mongo_replica_set_url: str):
        """`entry_gruppe_full` on the NEW-school application, and the ROLLBACK behind it.

        Not the ordering: an insert moved ahead of the count passes this too, being rolled back.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return (
                await refused_code(accept(database, client, NEW_SCHOOL_BEWERBUNG, shorthand=NEW_SCHOOL_SHORTHAND)),
                await database[Collection.TEAMS].count_documents({}),
                len(await junction_rows(database)),
                (await stored_bewerbung(database, NEW_SCHOOL_BEWERBUNG))["status"],
            )

        code, teams, rows, status = await on_a_league(mongo_replica_set_url, body, occupied=RULES["teams_per_gruppe"])

        assert code == Code.ENTRY_GRUPPE_FULL
        assert (teams, rows, status) == (SEEDED_TEAMS, RULES["teams_per_gruppe"], "submitted")

    async def test_a_retired_team_is_refused_and_nothing_is_entered(self, mongo_replica_set_url: str):
        """`team_retired`: a club that left the league is reactivated first, and the season's row is not the route to it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return (
                await refused_code(accept(database, client, RETIRED_BEWERBUNG)),
                await junction_rows(database),
                (await stored_bewerbung(database, RETIRED_BEWERBUNG))["status"],
            )

        code, rows, status = await on_a_league(mongo_replica_set_url, body)

        assert code == Code.TEAM_RETIRED
        assert (rows, status) == ([], "submitted")

    async def test_an_active_season_is_refused(self, mongo_replica_set_url: str):
        """`entry_saison_not_future`, read in-session: `activate_saison` moves `status` in a transaction of its own."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return (
                await refused_code(accept(database, client, NEW_SCHOOL_BEWERBUNG, shorthand=NEW_SCHOOL_SHORTHAND)),
                await database[Collection.TEAMS].count_documents({}),
                await junction_rows(database),
                (await stored_bewerbung(database, NEW_SCHOOL_BEWERBUNG))["status"],
            )

        code, teams, rows, status = await on_a_league(mongo_replica_set_url, body, saison_status="active")

        assert code == Code.ENTRY_SAISON_NOT_FUTURE
        assert (teams, rows, status) == (SEEDED_TEAMS, [], "submitted")

    async def test_a_team_the_season_already_holds_is_refused_by_its_own_code(self, mongo_replica_set_url: str):
        """Two open applications may name one club, and the index alone would answer the second a bare `duplicate_key`."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISON_TEAMS].insert_one(junction_document(EXISTING_OID, EXISTING_NAME, EXISTING_SHORTHAND, "B"))
            return (
                await refused_code(accept(database, client, PICKED_BEWERBUNG)),
                (await stored_bewerbung(database, PICKED_BEWERBUNG))["status"],
            )

        assert await on_a_league(mongo_replica_set_url, body) == (Code.BEWERBUNG_PICKED_TEAM_ALREADY_ENTERED, "submitted")


UNCONFIRMED_BEWERBUNG = ObjectId("6890a1b2c3d4e5f607920008")
CONFIRMED_BEWERBUNG = ObjectId("6890a1b2c3d4e5f607920009")

CONFIRMATIONS = minted_confirmations(
    hashes={name: hash_token(name) for name in ("trainer", "ansprechperson", "stellvertretung")}, today="2126-02-01"
)


def confirmed_kontakte(*, open_seat: str | None) -> dict[str, Any]:
    """The seeded people with every seat confirmed by its own person, or one of them left open."""

    block = dict(KONTAKTE)
    for seat in ("trainer", "ansprechperson", "stellvertretung"):
        stamped = seat != open_seat
        block[seat] = kontaktperson_document(
            KONTAKTE[seat]["first_name"],
            confirmed_at="2126-02-10" if stamped else None,
            einwilligung=SEATED,
            phone=KONTAKTE[seat]["phone"],
            birth_date="2080-05-04" if stamped else None,
        )

    return block


@pytest.mark.db
class TestASeasonsColourIsOneTeams:
    """Two teams in one kit colour is a fixture nobody can tell apart, and the row's write is what would store it."""

    async def test_a_colour_another_row_holds_is_refused_on_its_box_and_no_colour_stays_free(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISON_TEAMS].insert_one(
                saison_team_document(SAISON_ID, ObjectId(), "Fremd", "FRX", gruppe="B", trikot_farbe="blau")
            )
            with pytest.raises(APIError) as refused:
                await accept(database, client, NEW_SCHOOL_BEWERBUNG, shorthand=NEW_SCHOOL_SHORTHAND, trikot_farbe="blau")
            entered = await database[Collection.SAISON_TEAMS].count_documents({})
            await accept(database, client, NEW_SCHOOL_BEWERBUNG, shorthand=NEW_SCHOOL_SHORTHAND, trikot_farbe=None)

            return refused.value.error_code, refused.value.fields, entered, await database[Collection.SAISON_TEAMS].count_documents({})

        assert await on_a_league(mongo_replica_set_url, body) == (Code.TRIKOT_FARBE_TAKEN, (("trikot_farbe",),), 1, 2)


@pytest.mark.db
class TestAcceptanceWaitsForEverySeat:
    """`bewerbung_kontakte_unconfirmed` reaching the acceptance, inside its transaction."""

    async def test_an_open_seat_refuses_before_anything_is_written(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].insert_one(
                bewerbung_document(
                    UNCONFIRMED_BEWERBUNG,
                    team_id=EXISTING_OID,
                    kontakte=confirmed_kontakte(open_seat="ansprechperson"),
                    confirmations=CONFIRMATIONS,
                    confirmation_deadline="2126-02-15",
                )
            )

            return (
                await refused_code(accept(database, client, UNCONFIRMED_BEWERBUNG)),
                await junction_rows(database),
                (await stored_bewerbung(database, UNCONFIRMED_BEWERBUNG))["status"],
            )

        code, rows, status = await on_a_league(mongo_replica_set_url, body)

        assert code == Code.BEWERBUNG_KONTAKTE_UNCONFIRMED
        assert (rows, status) == ([], "submitted")

    async def test_its_mail_goes_only_to_a_seat_still_holding_its_person_at_the_hand_out(self, mongo_replica_set_url: str):
        """A holder who left the new season row's seat before the drain is told nothing of the club, as every club mail."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].insert_one(
                bewerbung_document(
                    CONFIRMED_BEWERBUNG,
                    team_id=EXISTING_OID,
                    kontakte=confirmed_kontakte(open_seat=None),
                    confirmations=CONFIRMATIONS,
                    confirmation_deadline="2126-02-15",
                )
            )
            await accept(database, client, CONFIRMED_BEWERBUNG)
            [row] = await junction_rows(database, team_id=EXISTING_OID)
            await database[Collection.SAISON_TEAMS].update_one({"_id": row["_id"]}, {"$set": {"kontakte.trainer": None}})
            mails = await drained(database, client)

            return row["kontakte"], sorted(mail.to for mail in mails if mail.data.kind == "bewerbung_zusage")

        seated, told = await on_a_league(mongo_replica_set_url, body)

        assert seated["trainer"]["email"] not in told
        assert told == sorted({seated[seat]["email"] for seat in ("ansprechperson", "stellvertretung")})


async def seed_the_unusable_school(database: AsyncDatabase) -> Mapping[str, Any]:
    """One application whose school makes no club, stored as it is.

    Read back, because nothing in the database judges the format: the value really does reach `teams` unless
    acceptance refuses it.
    """

    await database[Collection.BEWERBUNGEN].insert_one(
        bewerbung_document(UNUSABLE_BEWERBUNG, schule={**schule_block("Skriptsam"), "website_url": UNUSABLE_URL})
    )

    return await stored_bewerbung(database, UNUSABLE_BEWERBUNG)


@pytest.mark.db
class TestASchoolNoTeamCanBeCreatedFrom:
    """`bewerbung_schule_unusable` reaching the acceptance, which is the last point that can still answer 409.

    Past it the club is written, `FLTeamListAdapter` refuses it, and the clubs page an administrator
    would repair it from is the page that 500s.
    """

    async def test_an_unusable_url_is_refused_before_anything_is_written(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            seeded = await seed_the_unusable_school(database)

            return (
                await refused_code(accept(database, client, UNUSABLE_BEWERBUNG, shorthand="SKX")),
                seeded["schule"]["website_url"],
                await database[Collection.TEAMS].count_documents({}),
                await junction_rows(database),
                (await stored_bewerbung(database, UNUSABLE_BEWERBUNG))["status"],
            )

        code, stored_url, teams, rows, status = await on_a_league(mongo_replica_set_url, body)

        assert stored_url == UNUSABLE_URL, "the validator refused the value, so the refusal below proves nothing"
        assert code == Code.BEWERBUNG_SCHULE_UNUSABLE
        assert (teams, rows, status) == (SEEDED_TEAMS, [], "submitted")


@pytest.mark.db
class TestAPartialAcceptanceCommitsNothing:
    """One transaction over three writes: a club created without its junction row is a school in no season that nothing reports."""

    async def test_a_refused_final_patch_takes_the_team_and_the_junction_row_back(self, mongo_replica_set_url: str):
        """A `$jsonSchema` refusing the moved `status` fails the LAST of the three, after the other two have landed.

        Catches running the three outside one transaction, and dropping the session from either write.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            # Narrow enough to refuse the patch's `$set`, wide enough to admit the seeded application
            # this same body reads back afterwards.
            await database.command(
                "collMod",
                Collection.BEWERBUNGEN.value,
                validator={"$jsonSchema": {"bsonType": "object", "properties": {"status": {"enum": ["submitted"]}}}},
                validationLevel="strict",
            )

            with pytest.raises(OperationFailure) as failure:
                await accept(database, client, NEW_SCHOOL_BEWERBUNG, shorthand=NEW_SCHOOL_SHORTHAND)

            return (
                failure.value.code,
                await database[Collection.TEAMS].count_documents({}),
                await junction_rows(database),
                await stored_bewerbung(database, NEW_SCHOOL_BEWERBUNG),
            )

        code, teams, rows, stored = await on_a_league(mongo_replica_set_url, body, mutates_schema=True)

        # On the code, so this cannot pass because something else failed before any write.
        assert code == DOCUMENT_VALIDATION_FAILED, f"expected the validator to refuse the patch, got code {code}"
        assert teams == SEEDED_TEAMS, "the club survived a transaction that never committed"
        assert rows == [], "the junction row survived a transaction that never committed"
        assert (stored["status"], stored["team_id"], stored["decision"]) == ("submitted", None, None)


@pytest.mark.db
class TestADuplicateShorthandIsAConflictAndNotHalfATeam:
    """A code another club holds is refused on its box before the club is written: a 409, and no half-written season.

    The refusal is the acceptance's own look-up; `uniq_shorthand` answers only a race between two writes.
    """

    async def test_the_second_team_to_claim_the_two_letters_is_refused_whole(self, mongo_replica_set_url: str):
        """Through a served request, so the refusal is read as the wire carries it, its box named."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await through_the_app(
                mongo_replica_set_url,
                CLASHING_BEWERBUNG,
                "accept",
                {"gruppe": "A", "trikot_farbe": "rot", "shorthand": EXISTING_SHORTHAND, "version": 0},
            )

            return (
                response.status_code,
                response.json(),
                await database[Collection.TEAMS].count_documents({}),
                await junction_rows(database),
                (await stored_bewerbung(database, CLASHING_BEWERBUNG))["status"],
            )

        status_code, payload, teams, rows, status = await on_a_league(mongo_replica_set_url, body)

        assert (status_code, payload["error_code"], payload["fields"][0]["path"]) == (409, Code.DUPLICATE_KEY, ["shorthand"])
        assert (teams, rows, status) == (SEEDED_TEAMS, [], "submitted")


@pytest.mark.db
class TestTheCodeAnAcceptanceIsSent:
    """Refused on the box before anything is written: the wrong side of the rule creates no club under a code nobody chose."""

    @pytest.mark.parametrize(
        ("bewerbung_id", "shorthand"),
        [
            pytest.param(NEW_SCHOOL_BEWERBUNG, None, id="a new school with none"),
            pytest.param(PICKED_BEWERBUNG, "ABX", id="a picked club with one"),
        ],
    )
    async def test_the_wrong_side_of_the_rule_writes_nothing(self, mongo_replica_set_url: str, bewerbung_id: ObjectId, shorthand: str | None):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(APIError) as refused:
                await accept(database, client, bewerbung_id, shorthand=shorthand)

            return (
                refused.value.error_code,
                refused.value.fields,
                await junction_rows(database),
                (await stored_bewerbung(database, bewerbung_id))["status"],
            )

        assert await on_a_league(mongo_replica_set_url, body) == (Code.PAYLOAD_REFUSED, (("shorthand",),), [], "submitted")


@pytest.mark.db
class TestWhatTheDecisionRecords:
    """A decision stores its day, and the `action_log` row's `by` is the request's bound actor.

    Served rather than called: calling the endpoint directly would not resolve `bind_actor`.
    """

    async def test_a_served_acceptance_stores_the_request_s_day_and_its_log_row_names_the_administrator(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await through_the_app(
                mongo_replica_set_url, PICKED_BEWERBUNG, "accept", {"gruppe": "A", "trikot_farbe": "rot", "shorthand": None, "version": 0}
            )
            stored = await stored_bewerbung(database, PICKED_BEWERBUNG)
            rows = await database[Collection.ACTION_LOG].find({"action": "bewerbung.accepted"}).to_list(length=None)

            return response.status_code, stored["decision"], rows

        status_code, decision, rows = await on_a_league(mongo_replica_set_url, body)

        assert status_code == 204, "the served acceptance did not succeed, so what it stored proves nothing"
        # The injected clock reached it too, so the date is the request's rather than the wall's.
        assert (decision["made_at"], decision["reason"]) == (TODAY, None)
        # An actor resolved before the router-level binder would file every decision under SYSTEM.
        assert [(row["by"], row["record_id"]) for row in rows] == [(ADMIN_EMAIL, PICKED_BEWERBUNG)], "the log row names no administrator"

    async def test_a_served_decline_stores_the_day_as_well(self, mongo_replica_set_url: str):
        """The decline is a second endpoint writing a block of its own, so the acceptance's proof says nothing about it.

        Its block also carries a `reason` the acceptance's does not, which is what makes the two
        different objects rather than one shape.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await through_the_app(mongo_replica_set_url, PICKED_BEWERBUNG, "decline", {"reason": DECISION_REASON, "version": 0})

            return response.status_code, (await stored_bewerbung(database, PICKED_BEWERBUNG))["decision"]

        status_code, decision = await on_a_league(mongo_replica_set_url, body)

        assert status_code == 204, "the served decline did not succeed, so what it stored proves nothing"
        assert decision["made_at"] == TODAY


# The two fields a decline is allowed to move. Everything else on the document is the submission.
DECIDED_FIELDS = ("version", "status", "decision")


def submission_bytes(stored: Mapping[str, Any]) -> bytes:
    """The document minus what a decision writes, encoded as BSON.

    Bytes rather than a dict comparison: it holds the field ORDER and the stored types, so a value
    rewritten as an equal one of another type -- an int as a double -- fails here.
    """

    return encode({key: value for key, value in stored.items() if key not in DECIDED_FIELDS})


@pytest.mark.db
class TestADeclineTouchesNothingElse:
    """What the school wrote stays the record the decision was taken against."""

    async def test_it_moves_the_status_and_the_decision_alone_and_writes_no_season_row(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await stored_bewerbung(database, PICKED_BEWERBUNG)
            await decline(database, PICKED_BEWERBUNG)

            return before, await stored_bewerbung(database, PICKED_BEWERBUNG), await junction_rows(database)

        before, after, rows = await on_a_league(mongo_replica_set_url, body)

        # The floor under the comparison below: a decline that did nothing at all would pass it.
        assert (after["status"], after["decision"]) == ("declined", {"made_at": TODAY, "reason": DECISION_REASON})
        assert submission_bytes(after) == submission_bytes(before), "the decline rewrote the document beyond the fields it owns"
        # Left as the applicant picked it: a decline creates no reference and clears none.
        assert (after["team_id"], rows) == (EXISTING_OID, []), "the decline wrote a season row or moved the club"


@pytest.mark.db
class TestWhoADeclineMails:
    async def test_a_seat_never_mailed_hears_nothing(self, mongo_replica_set_url: str):
        """That person has heard of no application, and an administrator declining down a flood would mail them once a row."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].update_one(
                {"_id": PICKED_BEWERBUNG}, {"$set": {"confirmations.stellvertretung.sent_at": None}}
            )
            await decline(database, PICKED_BEWERBUNG)

            return await drained(database, client)

        mails = await on_a_league(mongo_replica_set_url, body)

        assert sorted(mail.to for mail in mails) == sorted([KONTAKTE["trainer"]["email"], KONTAKTE["ansprechperson"]["email"]])

    async def test_the_mail_names_a_picked_team_as_the_league_holds_it(self, mongo_replica_set_url: str):
        """The application holds the club's id alone, so a read that skipped the club would mail every person an empty name."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await decline(database, PICKED_BEWERBUNG)

            return await drained(database, client)

        mails = await on_a_league(mongo_replica_set_url, body)

        assert {mail.data.team if isinstance(mail.data, FLBewerbungAbsageData) else None for mail in mails} == {EXISTING_NAME}


async def take_decision(kind: str, database: AsyncDatabase, client: AsyncMongoClient, bewerbung_id: ObjectId) -> Any:
    """Either endpoint by name, so the pairs below read as the sequence an administrator would press."""

    if kind == "accept":
        return await accept(database, client, bewerbung_id)

    return await decline(database, bewerbung_id)


# The two pairs an acceptance opens, which are why the guard exists -- a second acceptance would enter
# the club again and fail on `uniq_saison_id_team_id`, which reads as unrelated. The pairs a decline
# opens are `TestADeclineLandingInsideAnAcceptance`'s and `TestTwoDeclinesAtOnce`'s.
DECISION_PAIRS = [
    pytest.param("accept", "accept", "accepted", 1, id="accept then accept"),
    pytest.param("accept", "decline", "accepted", 1, id="accept then decline"),
]


@pytest.mark.db
class TestADecisionIsNotTakenTwice:
    """`bewerbung_already_decided` against a real mongod: a refusal that exists is not a refusal that is reached."""

    @pytest.mark.parametrize(("first", "second", "expected_status", "expected_rows"), DECISION_PAIRS)
    async def test_the_second_decision_is_refused_and_the_first_still_stands(
        self, mongo_replica_set_url: str, first: str, second: str, expected_status: str, expected_rows: int
    ):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await take_decision(first, database, client, PICKED_BEWERBUNG)
            after_first = await stored_bewerbung(database, PICKED_BEWERBUNG)

            return (
                await refused_code(take_decision(second, database, client, PICKED_BEWERBUNG)),
                after_first,
                await stored_bewerbung(database, PICKED_BEWERBUNG),
                await junction_rows(database),
            )

        code, after_first, after_second, rows = await on_a_league(mongo_replica_set_url, body)

        assert code == Code.BEWERBUNG_ALREADY_DECIDED
        assert after_second == after_first, "the refused second decision still changed the application"
        assert (after_second["status"], len(rows)) == (expected_status, expected_rows)


# A second reason, so a decline that overwrote the first one's is visible in the stored block rather than only in a
# timestamp.
OTHER_DECISION_REASON = "Die Anmeldefrist für diese Saison ist verstrichen."


@pytest.mark.db
class TestTwoDeclinesAtOnce:
    """The loser of the race mails the applicants nothing, and the winner's `reason` and name stand.

    Both administrators otherwise send the three people a rejection letter, and one `reason` and one
    name survive.
    """

    async def test_a_decline_landing_inside_the_second_refuses_it_and_leaves_the_first_standing(self, mongo_replica_set_url: str):
        """The first decline commits between the second's read and its write, so the second's write conflicts and its retry reads the decision.

        Taken out of the transaction, the second's write meets the first's status and answers 404 instead.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first: list[Any] = []

            async def the_first_decline() -> None:
                await decline(database, PICKED_BEWERBUNG)
                first.append(await stored_bewerbung(database, PICKED_BEWERBUNG))

            racing = InterleavedCollection(database[Collection.BEWERBUNGEN], the_first_decline, before="find_one_and_update")
            code = await refused_code(
                decline_bewerbung(
                    bewerbung_id=PICKED_BEWERBUNG,
                    decline_data=FLDeclineBewerbungPayload(reason=OTHER_DECISION_REASON, version=0),
                    bewerbungen_collection=cast(AsyncCollection, racing),
                    teams_collection=database[Collection.TEAMS],
                    outbox_collection=database[Collection.OUTBOX],
                    germany_now=MAIL_NOW,
                    today=TODAY,
                    db=database.client,
                )
            )
            # With the first committed before it, the second is refused at its read and never reaches the write.
            racing.assert_landed_inside(serially=0)

            return code, first[0], await stored_bewerbung(database, PICKED_BEWERBUNG)

        code, after_first, after_second = await on_a_league(mongo_replica_set_url, body)

        assert code == Code.BEWERBUNG_ALREADY_DECIDED
        assert after_second == after_first, "the losing decline overwrote the reason and the name the first one stored"
        assert after_first["decision"]["reason"] == DECISION_REASON


# The four collections the acceptance JUDGES, which are the reads that have to sit in the
# transaction. `action_log` is written rather than judged, so a read of it would not belong here.
JUDGED_COLLECTIONS = frozenset({Collection.BEWERBUNGEN, Collection.SAISONS, Collection.TEAMS, Collection.SAISON_TEAMS})


class _ReadSpy(monitoring.CommandListener):
    """Every read this client sends, and whether the server was told it belongs to a transaction.

    `autocommit` and not `txnNumber`: that flag IS the instruction, so a read carries it exactly
    when the claim holds; a number only stands in for it.
    """

    def __init__(self) -> None:
        self.reads: list[tuple[str, bool]] = []

    def started(self, event: monitoring.CommandStartedEvent) -> None:
        if event.command_name in ("find", "aggregate"):
            self.reads.append((str(event.command.get(event.command_name)), event.command.get("autocommit") is False))

    def succeeded(self, event: monitoring.CommandSucceededEvent) -> None:
        """Required by the listener interface; this spy judges the command as it is sent."""

    def failed(self, event: monitoring.CommandFailedEvent) -> None:
        """Required by the listener interface; a failed read is still one this spy has seen started."""


@pytest.mark.db
class TestTheAcceptanceJudgesWhatItReadsInsideTheTransaction:
    """That the session reaches the SERVER, which is what the callback's docstring claims.

    On the wire, not in the source: a sweep proves the keyword is spelled, and this proves the
    transaction it names is the one the read ran in.
    """

    async def test_every_read_the_acceptance_judges_is_sent_inside_the_transaction(self, mongo_replica_set_url: str):
        """Strip `session=session` from any of the four judged reads and this fails.

        `PICKED_BEWERBUNG` rather than the new school's: the picked branch is the one that reads all
        four collections, a new school's reaching `teams` only to write it.
        """

        spy = _ReadSpy()

        async def body(database: AsyncDatabase, _client: AsyncMongoClient) -> Any:
            # A client of this test's own, so the spy sees the endpoint's commands rather than the
            # seeding `on_a_league` did through the fixture's.
            watched = new_client(mongo_replica_set_url, event_listeners=[spy])
            try:
                await accept(watched[DATABASE_NAME], watched, PICKED_BEWERBUNG, version=0)
            finally:
                await watched.close()

            return spy.reads

        reads = await on_a_league(mongo_replica_set_url, body)
        judged = [(collection, in_transaction) for collection, in_transaction in reads if collection in JUDGED_COLLECTIONS]

        # The floor: a spy that saw nothing, or a branch that stopped reading one of the four, would
        # pass the clause below while proving nothing about it.
        assert {collection for collection, _ in judged} == JUDGED_COLLECTIONS

        assert [collection for collection, in_transaction in judged if not in_transaction] == []


# A school whose own URL carries the three characters `validate_external_url` strips. Storable as
# submitted: `bewerbungen` types `website_url` as a bare string.
DIRTY_URL_BEWERBUNG = ObjectId("6890a1b2c3d4e5f60792000d")
DIRTY_URL = "https://wirbelknoten\t.example.net/\rpath"
DIRTY_URL_NAME, DIRTY_URL_SHORTHAND = "Wirbelknoten", "WKX"


def without_the_id(document: Mapping[str, Any]) -> dict[str, Any]:
    """One stored club minus the key the driver assigns, which is all two inserts of one school may differ by."""

    return {field: value for field, value in document.items() if field != "_id"}


@pytest.mark.db
class TestOneSchoolMakesOneTeamWhicheverPathCreatesIt:
    """The entry's `found_a_team` and an acceptance are two ways to the same collection, so they store one document for one school."""

    async def test_the_created_team_holds_what_the_guard_parsed_rather_than_the_block_as_submitted(self, mongo_replica_set_url: str):
        """Store the COMPOSED block instead and this fails: its `website_url` keeps the tab and the carriage return.

        Against what `found_a_team` itself stored for this school, so the claim rests on that path
        rather than on a copy of its expression.
        """

        schule = {**schule_block(DIRTY_URL_NAME), "website_url": DIRTY_URL}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            team = FLPostTeamPayload.model_validate(compose_new_team(schule=schule, shorthand=DIRTY_URL_SHORTHAND))

            async def found_it(session: AsyncClientSession) -> Any:
                return await found_a_team(teams_collection=database[Collection.TEAMS], team=team.model_dump(mode="json"), session=session)

            async with transaction_session(client) as session:
                created_id = await session.with_transaction(found_it)
            through_the_entry = await database[Collection.TEAMS].find_one({"_id": created_id})
            # Taken back out before the acceptance runs: `uniq_shorthand` spans every club, so one
            # school cannot hold two of them at once.
            await database[Collection.TEAMS].delete_one({"_id": created_id})

            await database[Collection.BEWERBUNGEN].insert_one(bewerbung_document(DIRTY_URL_BEWERBUNG, schule=schule))
            await accept(database, client, DIRTY_URL_BEWERBUNG, shorthand=DIRTY_URL_SHORTHAND)

            return through_the_entry, await database[Collection.TEAMS].find_one({"shorthand": DIRTY_URL_SHORTHAND})

        through_the_entry, created = await on_a_league(mongo_replica_set_url, body)

        assert through_the_entry is not None, "`found_a_team` stored nothing, so the comparison below stands on one document"
        assert created is not None, "no club was created for a school that named none"

        # Every key either insert wrote, `inactive_since` included: both paths owe it.
        assert without_the_id(created) == without_the_id(through_the_entry)
        # The floor: two paths that both stored the block as submitted would compare equal above.
        assert created["website_url"] == "https://wirbelknoten.example.net/path"


@pytest.mark.db
class TestADeclineLandingInsideAnAcceptance:
    """One snapshot serves the acceptance's judged reads and its last write, so a decline between them costs a write conflict."""

    async def test_it_enters_no_school_and_leaves_the_decline_standing(self, mongo_replica_set_url: str):
        """The decline commits after the acceptance has judged and written the club, before the application's patch.

        The retry reads the decision and refuses, so the junction row and club the first attempt wrote abort with it.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            declined: list[Any] = []

            async def the_decline() -> None:
                await decline(database, PICKED_BEWERBUNG)
                declined.append(await stored_bewerbung(database, PICKED_BEWERBUNG))

            racing = InterleavedCollection(database[Collection.BEWERBUNGEN], the_decline, before="find_one_and_update")
            code = await refused_code(
                accept_bewerbung(
                    bewerbung_id=PICKED_BEWERBUNG,
                    acceptance_data=FLAcceptBewerbungPayload.model_validate(
                        {"gruppe": "A", "trikot_farbe": "blau", "shorthand": None, "version": 0}
                    ),
                    bewerbungen_collection=cast(AsyncCollection, racing),
                    teams_collection=database[Collection.TEAMS],
                    saison_teams_collection=database[Collection.SAISON_TEAMS],
                    saisons_collection=database[Collection.SAISONS],
                    outbox_collection=database[Collection.OUTBOX],
                    germany_now=MAIL_NOW,
                    db=client,
                    today=TODAY,
                )
            )
            # With the decline committed before it, the acceptance is refused at its read and never reaches the patch.
            racing.assert_landed_inside(serially=0)

            return code, declined[0], await stored_bewerbung(database, PICKED_BEWERBUNG), await junction_rows(database)

        code, after_decline, after_acceptance, rows = await on_a_league(mongo_replica_set_url, body)

        assert code == Code.BEWERBUNG_ALREADY_DECIDED
        assert after_acceptance == after_decline, "the acceptance overwrote the decision the applicants were sent"
        assert rows == [], "the school was entered into the season its own application was declined for"


CORRECTION_BEWERBUNG = ObjectId("6890a1b2c3d4e5f60792000a")

CORRECTED_EMAIL = "sekretariat@zorbanax.example.net"


async def write_seat(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    seat: str,
    person: Mapping[str, Any],
    *,
    bewerbung_id: ObjectId,
    version: int | None = None,
) -> Any:
    """`post_kontakt_seat` as a page reading the application now would send it, unless `version` names an older read."""

    read = (await stored_bewerbung(database, bewerbung_id))["version"] if version is None else version

    async with client.start_session(snapshot=True) as session:
        return await post_kontakt_seat(
            bewerbung_id=bewerbung_id,
            seat=seat,
            seat_data=FLBewerbungKontaktSeatPayload.model_validate({**person, "version": read}),
            bewerbungen_collection=database[Collection.BEWERBUNGEN],
            teams_collection=database[Collection.TEAMS],
            saisons_collection=database[Collection.SAISONS],
            outbox_collection=database[Collection.OUTBOX],
            germany_now=MAIL_NOW,
            db=client,
            today=TODAY,
            session=session,
        )


async def correct(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    seat: str,
    *,
    email: str = CORRECTED_EMAIL,
    bewerbung_id: ObjectId = CORRECTION_BEWERBUNG,
) -> Any:
    """The seat's own person at another address, as the dialog filled from the page sends them."""

    person = (await stored_bewerbung(database, bewerbung_id))["kontakte"].get(seat) or RESEAT_PERSON

    return await write_seat(database, client, seat, {**{key: person[key] for key in RESEAT_PERSON}, "email": email}, bewerbung_id=bewerbung_id)


async def seed_a_pair_whose_seats_diverge(database: AsyncDatabase, bewerbung_id: ObjectId, *, open_seat: str) -> None:
    """Seeded because no write path makes one: a claimed pair whose Trainer seat is CONFIRMED while its mirror is not.

    The mirror joins both endpoints' write off `kontakte.trainer_is_also` rather than off its own state.
    """

    kontakte = confirmed_kontakte(open_seat=open_seat)
    kontakte["trainer_is_also"] = open_seat

    await database[Collection.BEWERBUNGEN].insert_one(
        bewerbung_document(
            bewerbung_id, team_id=EXISTING_OID, kontakte=kontakte, confirmations=dict(CONFIRMATIONS), confirmation_deadline="2126-04-20"
        )
    )


async def seed_a_bounced_application(database: AsyncDatabase, client: AsyncMongoClient, *, mirrored: bool = False) -> None:
    """One open application whose Ansprechperson the mail provider has refused, which is the case the correction exists for."""

    kontakte = confirmed_kontakte(open_seat="ansprechperson")
    if mirrored:
        # The Trainer IS the Ansprechperson, so the correction must move both blocks and both links.
        kontakte["trainer"] = {**kontakte["ansprechperson"]}
        kontakte["trainer_is_also"] = "ansprechperson"

    await database[Collection.BEWERBUNGEN].insert_one(
        bewerbung_document(
            CORRECTION_BEWERBUNG,
            team_id=EXISTING_OID,
            kontakte=kontakte,
            confirmations=CONFIRMATIONS,
            confirmation_deadline="2126-02-15",
        )
    )
    # One mail for the person, read by the seat the Trainer mirrors where they hold two.
    await a_mail_that_bounced(
        database, client, bewerbung_id=CORRECTION_BEWERBUNG, seat="ansprechperson", to=str(kontakte["ansprechperson"]["email"])
    )


@pytest.mark.db
class TestCorrectingOneContactAddress:
    """The one repair there is for a link the provider will not carry, and the one field of a submitted application it rewrites."""

    async def test_it_writes_the_address_alone_mints_a_link_restarts_the_deadline_and_is_recorded(self, mongo_replica_set_url: str):
        """The one repair there is, and the one field of a submitted application it rewrites, traced to the administrator."""

        async def last_mail(database: AsyncDatabase) -> Any:
            states = await states_of(
                outbox_collection=database[Collection.OUTBOX], collection=Collection.BEWERBUNGEN, ids=[CORRECTION_BEWERBUNG]
            )
            return states.get((CORRECTION_BEWERBUNG, "ansprechperson"))

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seed_a_bounced_application(database, client)
            before = await stored_bewerbung(database, CORRECTION_BEWERBUNG)
            bounced = await last_mail(database)
            response = await correct(database, client, "ansprechperson")
            corrected = await last_mail(database)
            [mail] = await drained(database, client)
            rows = await database[Collection.ACTION_LOG].find({"action": "bewerbung.seat_changed"}).to_list(length=None)

            return before, bounced, response, corrected, mail, rows, await stored_bewerbung(database, CORRECTION_BEWERBUNG)

        before, bounced, response, corrected, mail, rows, stored = await on_a_league(mongo_replica_set_url, body)

        assert response.email == CORRECTED_EMAIL
        assert stored["kontakte"]["ansprechperson"]["email"] == CORRECTED_EMAIL
        assert stored["confirmations"]["ansprechperson"]["deadline"] == confirmation_deadline_from(today=TODAY)
        # The raw token exists in the mail alone; the document keeps its hash, minted by the hand-out.
        assert mail.to == CORRECTED_EMAIL
        assert stored["confirmations"]["ansprechperson"]["token_hashes"] == [hash_token(mail.token or "")]

        # Left the seat's last word, the bounce would hold the application back from the deadline on a mailbox it stopped naming.
        assert bounced is not None and bounced.delivery is not None and bounced.delivery.state == "undeliverable"
        assert corrected is not None and (corrected.state, corrected.delivery) == ("open", None), "the bounce stayed the seat's last mail"

        # The submission is the record the decision is taken against, and this endpoint is its one exception.
        assert {key for key in before if before[key] != stored[key]} == {"kontakte", "confirmations", "version"}
        assert {seat: person for seat, person in stored["kontakte"].items() if seat != "ansprechperson"} == {
            seat: person for seat, person in before["kontakte"].items() if seat != "ansprechperson"
        }, "another seat the school wrote moved"
        assert all(
            stored["kontakte"]["ansprechperson"][key] == before["kontakte"]["ansprechperson"][key]
            for key in ("first_name", "last_name", "phone")
        ), "the corrected seat's other details moved"

        # A contact detail moving with nobody named is a change nothing can be traced back through.
        assert [(row["by"], row["record_id"]) for row in rows] == [(BOUND_ADMINISTRATOR, CORRECTION_BEWERBUNG)]
        # The new address is nobody's to find in the log.
        assert CORRECTED_EMAIL not in str(rows)

    async def test_one_person_holding_two_seats_is_corrected_on_both_from_the_trainer_seat(self, mongo_replica_set_url: str):
        """A seat left on the old address keeps a live link to a mailbox the league has stopped using."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seed_a_bounced_application(database, client, mirrored=True)
            await correct(database, client, "trainer")

            return await stored_bewerbung(database, CORRECTION_BEWERBUNG)

        stored = await on_a_league(mongo_replica_set_url, body)

        assert stored["kontakte"]["trainer"]["email"] == CORRECTED_EMAIL
        # One link for the person, voided on both seats until its hand-out mints it into both.
        assert stored["confirmations"]["trainer"]["token_hashes"] == stored["confirmations"]["ansprechperson"]["token_hashes"] == []

    @pytest.mark.parametrize(("field", "taken"), [("email", Code.KONTAKT_EMAIL_TAKEN), ("phone", Code.KONTAKT_PHONE_TAKEN)])
    async def test_a_detail_another_contact_person_holds_is_refused_and_nothing_is_written(
        self, mongo_replica_set_url: str, field: str, taken: Code
    ):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seed_a_bounced_application(database, client)
            before = await stored_bewerbung(database, CORRECTION_BEWERBUNG)
            kept = {key: before["kontakte"]["ansprechperson"][key] for key in RESEAT_PERSON}

            return (
                await refused_code(
                    write_seat(
                        database,
                        client,
                        "ansprechperson",
                        {**kept, field: before["kontakte"]["stellvertretung"][field]},
                        bewerbung_id=CORRECTION_BEWERBUNG,
                    )
                ),
                before,
                await stored_bewerbung(database, CORRECTION_BEWERBUNG),
            )

        code, before, after = await on_a_league(mongo_replica_set_url, body)

        assert code == taken
        assert after == before

    async def test_a_confirmed_seat_gives_way_and_asks_its_new_person_afresh(self, mongo_replica_set_url: str):
        """The stamp must not travel: a person nobody asked would stand confirmed, and the acceptance reads that stamp."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seed_a_bounced_application(database, client)
            await write_seat(database, client, "trainer", {**RESEAT_PERSON}, bewerbung_id=CORRECTION_BEWERBUNG)

            return await stored_bewerbung(database, CORRECTION_BEWERBUNG)

        stored = await on_a_league(mongo_replica_set_url, body)

        assert stored["kontakte"]["trainer"]["email"] == RESEAT_PERSON["email"]
        assert (stored["kontakte"]["trainer"]["birth_date"], stored["kontakte"]["trainer"]["einwilligung"]["confirmed_at"]) == (None, None)

    async def test_a_claimed_mirror_an_erasure_took_refuses_the_write(self, mongo_replica_set_url: str):
        """The mirror joins the write off the claim alone, so an unjudged one reopens a seat the league cannot reopen."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seed_a_pair_whose_seats_diverge(database, CORRECTION_BEWERBUNG, open_seat="ansprechperson")
            await database[Collection.BEWERBUNGEN].update_one(
                {"_id": CORRECTION_BEWERBUNG}, {"$set": {"kontakte.trainer": None, "confirmations.trainer": None}}
            )
            before = await stored_bewerbung(database, CORRECTION_BEWERBUNG)

            return (
                await refused_code(correct(database, client, "ansprechperson")),
                before,
                await stored_bewerbung(database, CORRECTION_BEWERBUNG),
            )

        code, before, after = await on_a_league(mongo_replica_set_url, body)

        assert code == Code.BEWERBUNG_SEAT_ERASED
        assert after == before


RESEND_BEWERBUNG = ObjectId("6890a1b2c3d4e5f60792000c")


async def seed_an_open_ansprechperson_seat(database: AsyncDatabase, *, mirrored: bool = False) -> Mapping[str, Any]:
    """One open application whose Ansprechperson has not answered, inside its deadline, as the re-send's read finds it."""

    kontakte = confirmed_kontakte(open_seat="ansprechperson")
    if mirrored:
        # The Trainer IS the Ansprechperson, open too, so one fresh link answers both seats.
        kontakte["trainer"] = {**kontakte["ansprechperson"]}
        kontakte["trainer_is_also"] = "ansprechperson"

    await database[Collection.BEWERBUNGEN].insert_one(
        bewerbung_document(
            RESEND_BEWERBUNG,
            team_id=EXISTING_OID,
            kontakte=kontakte,
            confirmations=CONFIRMATIONS,
            confirmation_deadline="2126-04-20",
        )
    )

    return await stored_bewerbung(database, RESEND_BEWERBUNG)


async def resend(database: AsyncDatabase, seat: str, *, bewerbungen: Any = None) -> Any:
    collection = database[Collection.BEWERBUNGEN] if bewerbungen is None else bewerbungen

    return await resent(database, RESEND_BEWERBUNG, seat, today=TODAY, germany_now=MAIL_NOW, bewerbungen_collection=collection)


@pytest.mark.db
class TestAResend:
    async def test_an_objection_landing_inside_it_stands_and_the_resend_is_refused(self, mongo_replica_set_url: str):
        """The objection commits between the re-send's read and its write, so the write conflicts and its retry reads the objection.

        Judged outside the transaction, the write would overwrite the objection with a live link mailed to the objector.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seed_an_open_ansprechperson_seat(database)
            landed: list[Any] = []

            async def the_objection() -> None:
                await answer_for(database, client, "ansprechperson")
                landed.append(await stored_bewerbung(database, RESEND_BEWERBUNG))

            racing = InterleavedCollection(database[Collection.BEWERBUNGEN], the_objection, before="find_one_and_update")
            code = await refused_code(resend(database, "ansprechperson", bewerbungen=cast(AsyncCollection, racing)))

            return code, landed[0], await stored_bewerbung(database, RESEND_BEWERBUNG)

        code, landed, after = await on_a_league(mongo_replica_set_url, body)

        assert code == Code.BEWERBUNG_SEAT_ALREADY_ANSWERED
        assert after == landed, "the re-send overwrote the objection that landed inside it"

    async def test_a_resend_moving_the_day_a_notice_named_owes_the_deletion_its_notice_again(self, mongo_replica_set_url: str):
        """The read the re-send judged reaches its update: a stamp left on a moved day leaves the Ansprechperson told of a day that went."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seed_an_open_ansprechperson_seat(database)
            await database[Collection.BEWERBUNGEN].update_one(
                {"_id": RESEND_BEWERBUNG},
                {"$set": {"erasure_announced_at": "2126-03-30", "confirmations.ansprechperson.deadline": "2126-04-05"}},
            )
            await resend(database, "ansprechperson")

            return await stored_bewerbung(database, RESEND_BEWERBUNG)

        assert (await on_a_league(mongo_replica_set_url, body))["erasure_announced_at"] is None

    @pytest.mark.parametrize("pressed", ["ansprechperson", "trainer"])
    async def test_a_person_holding_two_seats_is_answered_for_both(self, mongo_replica_set_url: str, pressed: str):
        """The mail words its role text from `seats`, so one seat named would cover half the link."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seed_an_open_ansprechperson_seat(database, mirrored=True)
            await resend(database, pressed)

            return await drained(database, client), await stored_bewerbung(database, RESEND_BEWERBUNG)

        [mail], stored = await on_a_league(mongo_replica_set_url, body)

        assert isinstance(mail.data, FLBewerbungLinkData) and sorted(mail.data.seats) == ["ansprechperson", "trainer"]
        assert {seat: stored["confirmations"][seat]["token_hashes"] for seat in ("ansprechperson", "trainer")} == dict.fromkeys(
            ("ansprechperson", "trainer"), [hash_token(mail.token or "")]
        )

    async def test_a_claimed_mirror_that_has_confirmed_refuses_the_resend(self, mongo_replica_set_url: str):
        """The fresh entry is written for the mirror too, so its own answer would be spent on a link nobody asked it for."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seed_a_pair_whose_seats_diverge(database, RESEND_BEWERBUNG, open_seat="ansprechperson")
            before = await stored_bewerbung(database, RESEND_BEWERBUNG)

            return await refused_code(resend(database, "ansprechperson")), before, await stored_bewerbung(database, RESEND_BEWERBUNG)

        code, before, after = await on_a_league(mongo_replica_set_url, body)

        assert code == Code.BEWERBUNG_SEAT_ALREADY_ANSWERED
        assert after == before


@pytest.mark.db
class TestAFinishedSeasonTakesNoFreshLink:
    """Its undecided applications go at the season's end, so a link mailed then would ask a person to answer for nothing."""

    async def test_a_resend_on_a_finished_season_writes_and_mails_nobody(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await seed_an_open_ansprechperson_seat(database)
            code = await refused_code(resend(database, "ansprechperson"))

            return code, before, await stored_bewerbung(database, RESEND_BEWERBUNG), await drained(database, client)

        code, before, after, mails = await on_a_league(mongo_replica_set_url, body, saison_status="past")

        assert code == Code.SAISON_PAST
        assert (after, mails) == (before, [])

    async def test_a_seat_write_on_a_finished_season_writes_and_mails_nobody(self, mongo_replica_set_url: str):
        """The seat write mails its person a fresh link too, so it is refused as the re-send is, its person left unwritten."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await seed_an_open_ansprechperson_seat(database)
            code = await refused_code(write_seat(database, client, "ansprechperson", RESEAT_PERSON, bewerbung_id=RESEND_BEWERBUNG))

            return code, before, await stored_bewerbung(database, RESEND_BEWERBUNG), await drained(database, client)

        code, before, after, mails = await on_a_league(mongo_replica_set_url, body, saison_status="past")

        assert code == Code.SAISON_PAST
        assert (after, mails) == (before, [])


RESEAT_BEWERBUNG = ObjectId("6890a1b2c3d4e5f60792000b")

# Distinct from every seeded person, so a seat this write never reached cannot compare equal to one it did.
RESEAT_PERSON: Mapping[str, Any] = {
    "first_name": "Wilburga",
    "last_name": "Dringenhoff",
    "email": "wilburga.dringenhoff@example.net",
    "phone": "+49 69 90009765",
}


async def reseat(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    seat: str,
    *,
    email: str = RESEAT_PERSON["email"],
    version: int | None = None,
) -> Any:
    return await write_seat(database, client, seat, {**RESEAT_PERSON, "email": email}, bewerbung_id=RESEAT_BEWERBUNG, version=version)


async def answer_for(database: AsyncDatabase, client: AsyncMongoClient, token: str, **answer: Any) -> Any:
    """A hand-built block would let this suite agree with itself while disagreeing with the endpoint.

    The state a reseat runs on is whatever the Widerspruch actually leaves
    (`fl_backend/app/api/bewerbungen/public_router.py :: post_confirmation`).
    """

    return await answered(
        database,
        client,
        {"token": token, **({"whatsapp": False, "media": False, **answer} if answer else {"answer": "declined"})},
        today=TODAY,
        germany_now=NOW,
    )


async def seed_an_application_a_seat_was_declined_on(database: AsyncDatabase, client: AsyncMongoClient, *, mirrored: bool = False) -> None:
    """One open application whose Ansprechperson exercised their Widerspruch, which is the case the reseat exists for."""

    kontakte = confirmed_kontakte(open_seat="ansprechperson")
    if mirrored:
        # The Trainer IS the Ansprechperson, so one answer emptied both seats and one reseat fills both.
        kontakte["trainer"] = {**kontakte["ansprechperson"]}
        kontakte["trainer_is_also"] = "ansprechperson"

    await database[Collection.BEWERBUNGEN].insert_one(
        bewerbung_document(
            RESEAT_BEWERBUNG,
            team_id=EXISTING_OID,
            kontakte=kontakte,
            confirmations=CONFIRMATIONS,
            # After `TODAY`, so the seat's own link still opens and the Widerspruch below is taken,
            # and off `confirmation_deadline_from`'s answer, which a kept deadline would compare equal to.
            confirmation_deadline="2126-04-20",
        )
    )
    await answer_for(database, client, "ansprechperson")


@pytest.mark.db
class TestSeatingAnotherPersonInAnEmptiedSeat:
    """The seat a Widerspruch emptied is the one an administrator may put somebody else in, against a real document."""

    async def test_it_writes_the_person_a_fresh_record_and_a_fresh_link_in_one_update(self, mongo_replica_set_url: str):
        """The seeded seat is null, which is the only state this endpoint runs on and the one a dotted `$set` aborts against."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seed_an_application_a_seat_was_declined_on(database, client)
            emptied = await stored_bewerbung(database, RESEAT_BEWERBUNG)
            await reseat(database, client, "ansprechperson")

            return (
                emptied,
                await stored_bewerbung(database, RESEAT_BEWERBUNG),
                await drained(database, client),
                await stored_bewerbung(database, RESEAT_BEWERBUNG),
            )

        emptied, stored, mails, linked = await on_a_league(mongo_replica_set_url, body)

        assert emptied["kontakte"]["ansprechperson"] is None, "the Widerspruch left a seat this endpoint was never exercised against"
        assert stored["kontakte"]["ansprechperson"] == {
            **RESEAT_PERSON,
            "birth_date": None,
            # Born afresh: nothing of the person who stepped out of the seat travels to the one seated,
            # their evidence included.
            "einwilligung": {
                "scope": "kontakt_data",
                "date": TODAY,
                "confirmed_at": None,
                "media": False,
            },
        }
        # The link is the mail's alone, minted at its hand-out to the person now seated.
        assert [mail.to for mail in mails] == [RESEAT_PERSON["email"]]
        assert linked["confirmations"]["ansprechperson"]["token_hashes"] == [hash_token(mails[0].token or "")]
        assert stored["confirmations"]["ansprechperson"]["declined_at"] is None
        assert stored["confirmations"]["ansprechperson"]["deadline"] == confirmation_deadline_from(today=TODAY)

    async def test_a_write_composed_before_the_seat_moved_leaves_the_person_seated_since(self, mongo_replica_set_url: str):
        """A page read before a Widerspruch and a reseat would hand the new holder the address typed for the one who left."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seed_an_application_a_seat_was_declined_on(database, client)
            page = (await stored_bewerbung(database, RESEAT_BEWERBUNG))["version"]
            await reseat(database, client, "ansprechperson")
            reseated = await stored_bewerbung(database, RESEAT_BEWERBUNG)

            return (
                await refused_code(reseat(database, client, "ansprechperson", email=CORRECTED_EMAIL, version=page)),
                reseated,
                await stored_bewerbung(database, RESEAT_BEWERBUNG),
            )

        code, reseated, after = await on_a_league(mongo_replica_set_url, body)

        assert code == Code.VERSION_STALE
        assert after == reseated

    async def test_one_person_holding_two_seats_is_seated_in_both_from_one_press(self, mongo_replica_set_url: str):
        """The pair comes off `trainer_is_also`, surviving the emptying that hides it from `paired_seat`.

        `app/api/bewerbungen/services.py :: paired_seat` answers `None` on these two seats, leaving one seat holding the other's link.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seed_an_application_a_seat_was_declined_on(database, client, mirrored=True)
            await reseat(database, client, "ansprechperson")

            return await stored_bewerbung(database, RESEAT_BEWERBUNG)

        stored = await on_a_league(mongo_replica_set_url, body)

        assert stored["kontakte"]["trainer"] == stored["kontakte"]["ansprechperson"]
        # One link for the person, voided on both seats until its hand-out mints it into both.
        assert stored["confirmations"]["trainer"]["token_hashes"] == stored["confirmations"]["ansprechperson"]["token_hashes"] == []

    async def test_a_seat_erased_at_its_persons_request_takes_nobody_else(self, mongo_replica_set_url: str):
        """An erasure is a door the league cannot reopen, and the only thing parting it from a Widerspruch is the entry it took with it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seed_an_application_a_seat_was_declined_on(database, client)
            await erased(database, client, KONTAKTE["stellvertretung"]["email"], germany_now=NOW)
            emptied = await stored_bewerbung(database, RESEAT_BEWERBUNG)

            return await refused_code(reseat(database, client, "stellvertretung")), emptied, await stored_bewerbung(database, RESEAT_BEWERBUNG)

        code, emptied, after = await on_a_league(mongo_replica_set_url, body)

        assert emptied["confirmations"]["stellvertretung"] is None, "the erasure left bookkeeping the refusal would read as a Widerspruch"
        assert code == Code.BEWERBUNG_SEAT_ERASED
        assert after == emptied

    async def test_a_seat_erased_at_its_persons_request_takes_no_resend(self, mongo_replica_set_url: str):
        """A page read before the erasure still offers the re-send, which then names the erasure rather than an answer."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seed_an_application_a_seat_was_declined_on(database, client)
            await erased(database, client, KONTAKTE["stellvertretung"]["email"], germany_now=NOW)
            emptied = await stored_bewerbung(database, RESEAT_BEWERBUNG)
            code = await refused_code(resent(database, RESEAT_BEWERBUNG, "stellvertretung", today=TODAY, germany_now=MAIL_NOW))

            return code, emptied, await stored_bewerbung(database, RESEAT_BEWERBUNG)

        code, emptied, after = await on_a_league(mongo_replica_set_url, body)

        assert code == Code.BEWERBUNG_SEAT_ERASED
        assert after == emptied

    async def test_a_decided_application_takes_no_reseat(self, mongo_replica_set_url: str):
        """The submission is what the decision was taken against, and a decided one is not repaired into a different application."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seed_an_application_a_seat_was_declined_on(database, client)
            await decline(database, RESEAT_BEWERBUNG)
            before = await stored_bewerbung(database, RESEAT_BEWERBUNG)

            return await refused_code(reseat(database, client, "ansprechperson")), before, await stored_bewerbung(database, RESEAT_BEWERBUNG)

        code, before, after = await on_a_league(mongo_replica_set_url, body)

        assert code == Code.BEWERBUNG_ALREADY_DECIDED
        assert after == before

    async def test_a_path_naming_no_seat_is_a_404(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seed_an_application_a_seat_was_declined_on(database, client)

            with pytest.raises(DocumentNotFoundError) as missing:
                await reseat(database, client, "hausmeister")

            return missing.value.status_code

        assert await on_a_league(mongo_replica_set_url, body) == 404
