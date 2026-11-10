"""
API · one address's change of the address it signs in on, driven end to end against the shipped indexes

The person starts it on their own account page, an administrator through the address tool for a person who cannot sign
in, and the new mailbox's confirmation, or the hourly pass at the end of a waiting time, moves everything the replaced
address holds in one write. The pass's share and failures are
`tests/api/test_address_change_sweep_execution.py`'s.
"""

import asyncio
import json
from collections.abc import Awaitable, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient, monitoring
from pymongo.asynchronous.database import AsyncDatabase

from app.api.account.person_router import post_address_change
from app.api.account.schemas import FLAccountAddressChangePayload
from app.api.address_change.admin_router import post_address_change_admin
from app.api.address_change.schemas import FLAddressChangeAddressPayload, FLAddressChangeAdminPayload
from app.api.address_change.services import (
    ADDRESS_CHANGE_RESTART_SECONDS,
    build_address_filter,
)
from app.api.address_change.system_router import get_address_change_address
from app.api.grants.admin_router import post_grant
from app.api.grants.schemas import FLPostGrantPayload
from app.api.identity.admin_router import post_erasure
from app.api.identity.crud import find_sign_in, find_subject, unreferenced_of
from app.api.identity.schemas import FLErasurePayload
from app.api.outbox.system_router import post_handout
from app.api.registrierungen.public_router import get_confirmation_view
from app.api.registrierungen.services import compose_decline_update
from app.core.codes import Code
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.exceptions import APIError, DocumentNotFoundError
from app.core.recording import actor_var
from app.main import create_app
from app.shared.schemas.bounds import ADDRESS_CHANGE_VALID_HOURS, ADDRESS_CHANGE_WAITING_PERIOD_DAYS, GRANT_WAIT_HOURS, OWNER_WAIT_DAYS
from app.shared.schemas.confirmation import FLTokenPayload
from app.shared.tokens import hash_token
from tests import documents
from tests.app_client import app_client
from tests.config import ADMINISTRATORS, SYSTEM_AUTH
from tests.holds import HeldCollection
from tests.isolation import COMMITTED, outcome_of
from tests.records import record_collections
from tests.whole_database import where_held
from tests.worker import worker_database

from .address_change_harness import (
    ADMIN,
    AFTER_THE_DEADLINE,
    AFTER_THE_WAIT,
    EMAIL,
    FOREIGN_EMAIL,
    NEW_EMAIL,
    NOW,
    OTHER_EMAIL,
    OTHER_OID,
    OWNER,
    PENDING_OID,
    REFEREE_OID,
    ROW_OID,
    SAISON_ID,
    SECOND_ADMIN,
    SECOND_TEAM_OID,
    SPIELER_OID,
    TODAY,
    TYPED,
    UNCONFIRMED_REG_LINK,
    administrator_starts,
    answer,
    call,
    carries,
    change,
    discard,
    everything,
    granted,
    handed_out,
    owed,
    read,
    refused_code,
    registration,
    resend,
    row,
    running,
    start,
    stop_by_link,
    stop_here,
    sweep,
    view,
)
from .address_change_harness import on_a_person as _on_a_person
from .conftest import config_for
from .test_grants_execution import GrantsRunningARivalAfterTheFirstRead

# Module level: every case below reaches a real mongod, each write being one transaction.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_address_change_test")


def on_a_person(url: str, body: Any, **seeded: Any) -> Any:
    return _on_a_person(url, DATABASE_NAME, body, **seeded)


class TestTheAccountPagesRead:
    def test_a_change_starts_wherever_the_address_holds_anything_a_change_moves(self, mongo_replica_set_url: str):
        """A grant alone is enough: an administrator's address is theirs to change like anyone's."""

        async def refusal(database: AsyncDatabase, client: AsyncMongoClient, address: str) -> str | None:
            try:
                await start(database, client, identifier=address, released=False)
            except APIError as refused:
                return refused.error_code
            return None

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return [await refusal(database, client, address) for address in (EMAIL, OTHER_EMAIL, ADMIN, "nobody@schule.example")]

        assert on_a_person(mongo_replica_set_url, body) == [None, None, None, Code.ADDRESS_CHANGE_NOTHING]

    def test_an_administrator_s_change_shows_its_address_masked_and_never_whole(self, mongo_replica_set_url: str):
        """It may be a pretext whose target the holder of the address on file must not learn: unmask it and this fails."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await administrator_starts(database, client)
            return await read(database, client)

        seen = on_a_person(mongo_replica_set_url, body)
        served = seen.model_dump_json()

        assert seen.open is not None and seen.open.email == "l•••@n•••.org"
        assert (NEW_EMAIL in served, "lenore.q" in served, "neupost" in served) == (False, False, False)


# Past the interval a person's start waits after the mail its address's live change last owed.
RESTART = timedelta(seconds=ADDRESS_CHANGE_RESTART_SECONDS)

# `NEW_EMAIL` as a holder's mail and an administrator's change show it.
MASKED_NEW_EMAIL = "l•••@n•••.org"


class TestThePersonsStart:
    def test_the_new_mailbox_signs_in_to_nothing_and_is_served_no_record_until_the_effect(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            meanwhile = (
                await find_sign_in(NEW_EMAIL, record_collections(database)),
                await find_subject(NEW_EMAIL, record_collections(database)),
            )
            await answer(database, client, minted.token)
            return meanwhile, [(await find_sign_in(email, record_collections(database))).account for email in (EMAIL, NEW_EMAIL)]

        (gate, subject), after = on_a_person(mongo_replica_set_url, body)

        assert (gate.account, subject.spieler, subject.schiedsrichter, subject.seats) == (False, [], [], [])
        # Afterwards one sign-in holds the person, and the replaced address none.
        assert after == [False, True]

    @pytest.mark.parametrize("held_by", ["another-pupil", "a-grant"])
    def test_it_answers_alike_whatever_the_new_address_holds(self, mongo_replica_set_url: str, held_by: str):
        """The effect judges the new address; a start judging it would tell the signed-in person what a stranger's holds."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if held_by == "another-pupil":
                await database[Collection.SPIELER].update_one({"_id": OTHER_OID}, {"$set": {"email": NEW_EMAIL}})
            elif held_by == "a-grant":
                await granted(database, NEW_EMAIL)
            minted = await start(database, client)

            return sorted(minted.answer.model_dump()), (await change(database, minted.id))["email"]

        assert on_a_person(mongo_replica_set_url, body) == (
            ["email", "id", "valid_until"],
            NEW_EMAIL,
        )

    def test_the_address_signed_in_on_is_refused_in_any_spelling(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(APIError) as refused:
                await start(database, client, email=TYPED.upper())
            return refused.value.error_code

        assert on_a_person(mongo_replica_set_url, body) == Code.ADDRESS_CHANGE_UNCHANGED

    def test_a_person_holding_contact_seats_alone_may_start(self, mongo_replica_set_url: str):
        """Their confirmed seats on a season row and on applications are theirs to move, as every account's are."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SCHIEDSRICHTER].delete_many({})
            await database[Collection.REGISTRIERUNGEN].delete_many({})
            minted = await start(database, client)
            await answer(database, client, minted.token)
            return await everything_but_the_pupil(database)

        rows = on_a_person(mongo_replica_set_url, body, pupil=False)

        assert rows["season row"]["kontakte"]["ansprechperson"]["email"] == NEW_EMAIL
        # The unconfirmed seat is not the person's yet, and stays where it is.
        assert rows["season row"]["kontakte"]["stellvertretung"]["email"] == EMAIL
        assert rows["pending application"]["kontakte"]["trainer"]["email"] == NEW_EMAIL

    def test_a_start_pressed_again_inside_the_interval_is_refused_with_the_seconds_left(self, mongo_replica_set_url: str):
        """Unrefused, a script repeating the start mails the address on file at every press and spends the league's quota.

        A server action posts the start from any page, so no edge location bounds it.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await start(database, client)
            mails = len(await owed(database))
            with pytest.raises(APIError) as refused:
                await start(database, client, email=FOREIGN_EMAIL, germany_now=NOW + RESTART - timedelta(seconds=10))
            live = await database[Collection.ADDRESS_CHANGES].find({"ended": None}, {"_id": 1}).to_list(None)

            return refused.value, [row["_id"] for row in live], first.id, len(await owed(database)) - mails

        refusal, live, first, mailed = on_a_person(mongo_replica_set_url, body)

        assert (refusal.status_code, refusal.error_code, refusal.headers) == (
            429,
            Code.ADDRESS_CHANGE_STARTED_RECENTLY,
            {"Retry-After": "10"},
        )
        assert (live, mailed) == ([first], 0)

    def test_it_replaces_the_live_change_whose_links_then_answer_how_it_ended(self, mongo_replica_set_url: str):
        """A sign-in at the address on file proves the mailbox is not lost, so its own start replaces a change asked without it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await administrator_starts(database, client, email=FOREIGN_EMAIL)
            second = await start(database, client, germany_now=NOW + RESTART)

            return (
                first,
                second,
                await change(database, first.id),
                await view(database, client, first.token),
                await where_held(database, FOREIGN_EMAIL, folded=True),
            )

        first, second, replaced, seen, held = on_a_person(mongo_replica_set_url, body)

        assert (replaced["ended"]["kind"], replaced["address"], replaced["email"]) == ("replaced", None, None)
        assert (seen.view.state, seen.view.kind) == ("ended", "replaced")
        # Only the row of the link mail the league sent, which keeps its recipient until its retention ends.
        assert held == {FOREIGN_EMAIL: ["outbox"]}
        assert second.id != first.id


async def everything_but_the_pupil(database: AsyncDatabase) -> dict[str, Mapping[str, Any]]:
    return {
        "season row": await row(database, Collection.SAISON_TEAMS, ROW_OID),
        "pending application": await row(database, Collection.BEWERBUNGEN, PENDING_OID),
    }


# The deadline a link reads at the harness's instant, and when a confirmation at that instant ends an administrator's wait.
A_LINK_S_DEADLINE = (NOW + timedelta(hours=ADDRESS_CHANGE_VALID_HOURS)).astimezone(UTC)
A_HOLDER_S_WAIT_ENDS = (NOW + timedelta(hours=GRANT_WAIT_HOURS)).astimezone(UTC)


class TestTheLinks:
    @pytest.mark.parametrize(
        ("cause", "refused"),
        [
            ("taken", Code.ADDRESS_CHANGE_TAKEN),
            ("empty", Code.ADDRESS_CHANGE_NOTHING),
        ],
    )
    def test_a_link_its_press_would_refuse_for_the_address_on_file_s_sake_offers_no_confirmation(
        self, mongo_replica_set_url: str, cause: str, refused: str
    ):
        """The page reads its view before offering the press: a view reading `valid` here offers what the press refuses."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, identifier=OTHER_EMAIL) if cause == "empty" else await start(database, client)
            if cause == "empty":
                # Its one pupil row erased by a database edit, which ends no change as the erasure route would.
                await database[Collection.SPIELER].delete_one({"_id": OTHER_OID})
            else:
                await database[Collection.SPIELER].update_one({"_id": OTHER_OID}, {"$set": {"email": NEW_EMAIL}})
            seen = (await view(database, client, minted.token)).view
            return seen.state, seen.email, await refused_code(answer(database, client, minted.token))

        # Its question unaskable, the link names no address.
        assert on_a_person(mongo_replica_set_url, body) == ("not_confirmable", None, refused)

    @pytest.mark.parametrize(
        ("step", "waits_on", "previous", "email", "deadline", "wait_ends"),
        [
            ("an administrator's start", "new_address", "open", MASKED_NEW_EMAIL, A_LINK_S_DEADLINE, None),
            ("previous_address", "previous_address", "release_open", NEW_EMAIL, A_LINK_S_DEADLINE, None),
            ("a holder's wait", "waiting_period", "waiting_period", NEW_EMAIL, None, A_HOLDER_S_WAIT_ENDS),
        ],
    )
    def test_the_step_a_change_waits_on_reads_on_the_account_page_and_the_stop_link(
        self,
        mongo_replica_set_url: str,
        step: str,
        waits_on: str,
        previous: str,
        email: str | None,
        deadline: datetime | None,
        wait_ends: datetime | None,
    ):
        """The account page and the address on file's link name each step alike, the page beside it the day that step ends.

        The new address whole on the person's own change, which that address confirmed: an administrator's start may be a
        pretext whose target that address's holder must not learn.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if step == "an administrator's start":
                minted = await administrator_starts(database, client)
            elif step == "previous_address":
                minted = await start(database, client, released=False)
            else:
                await granted(database)
                minted = await start(database, client)
                await answer(database, client, minted.token)
            open = (await read(database, client)).open
            assert open is not None
            seen = (await view(database, client, minted.stop_token)).view
            return open.waits_on, seen.state, seen.email, open.valid_until, open.effective_from

        assert on_a_person(mongo_replica_set_url, body) == (waits_on, previous, email, deadline, wait_ends)

    def test_the_address_on_file_s_lapsed_question_names_no_address(self, mongo_replica_set_url: str):
        """Past its deadline the page offers no confirmation the press refuses `link_expired`, as the new mailbox's link does."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, released=False)
            seen = (await view(database, client, minted.stop_token, germany_now=AFTER_THE_DEADLINE)).view
            pressed = await refused_code(answer(database, client, minted.stop_token, germany_now=AFTER_THE_DEADLINE))
            return seen.state, seen.email, pressed

        assert on_a_person(mongo_replica_set_url, body) == ("release_expired", None, Code.LINK_EXPIRED)

    def test_the_new_link_names_the_day_it_was_confirmed_in_the_wait_and_once_ended(self, mongo_replica_set_url: str):
        """The effect's day is the wait's end, so a page naming it as the confirmation's would be a day or a week out."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            before = (await view(database, client, minted.token)).view
            await answer(database, client, minted.token)
            waiting = (await view(database, client, minted.token)).view
            stopped = (await view(database, client, minted.stop_token)).view
            await sweep(database, client, germany_now=AFTER_THE_DEADLINE)
            ended = (await view(database, client, minted.token)).view
            ended_stop = (await view(database, client, minted.stop_token)).view
            return (
                before.confirmed_on,
                waiting.confirmed_on,
                getattr(stopped, "confirmed_on", "absent"),
                ended.confirmed_on,
                ended_stop.confirmed_on,
            )

        assert on_a_person(mongo_replica_set_url, body) == (None, TODAY, "absent", TODAY, None)

    def test_an_ended_change_s_links_answer_how_it_ended_and_take_nothing_more(self, mongo_replica_set_url: str):
        """Each link answers truthfully after the end, for as long as the record is kept."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            await stop_by_link(database, client, minted.stop_token)

            return (
                await view(database, client, minted.token),
                await view(database, client, minted.stop_token),
                await refused_code(answer(database, client, minted.token)),
                await refused_code(stop_by_link(database, client, minted.stop_token)),
            )

        new, previous, pressed, stopped = on_a_person(mongo_replica_set_url, body)

        # The day it ended on, which the page names beside what became of it.
        assert (new.view.side, new.view.state, new.view.kind, new.view.ended_on) == ("new", "ended", "stopped", TODAY)
        assert (previous.view.side, previous.view.state, previous.view.kind, previous.view.ended_on) == ("previous", "ended", "stopped", TODAY)
        assert (pressed, stopped) == (Code.ADDRESS_CHANGE_ENDED, Code.ADDRESS_CHANGE_ENDED)

    def test_a_confirmed_link_answers_its_state_and_takes_no_second_press(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client)
            await answer(database, client, started.token)
            return await view(database, client, started.token), await refused_code(answer(database, client, started.token, "declined"))

        seen, pressed = on_a_person(mongo_replica_set_url, body)

        assert (seen.view.state, seen.view.effective_from is not None) == ("confirmed", True)
        # Answered, the new mailbox's link names its address no more.
        assert seen.view.email is None
        assert pressed == Code.ADDRESS_CHANGE_ENDED


def the_new_address(database: AsyncDatabase, client: AsyncMongoClient, **key: Any) -> Awaitable[Any]:
    """What the frontend's server asks before a press, a link's view or a re-send reads its sign-in store."""

    return call(get_address_change_address, database, client, address_data=FLAddressChangeAddressPayload.model_validate(key))


class TestTheAddressOnFileConfirmsFirst:
    """The person's own change asks the address on file by its own link, and only its confirmation asks the new mailbox."""

    def test_the_start_owes_the_address_on_file_its_link_and_the_new_mailbox_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, released=False)
            return minted, await change(database, minted.id), await view(database, client, minted.stop_token)

        minted, record, previous = on_a_person(mongo_replica_set_url, body)

        assert (minted.token, minted.stop_token is not None) == (None, True)
        assert (record["token_hashes"], record["stop"]["token_hashes"], record["released_at"]) == ([], [hash_token(minted.stop_token)], None)
        assert (previous.view.side, previous.view.state, previous.view.way) == ("previous", "release_open", "account")
        # Its question names the address the change goes to, and no day it was answered on.
        assert (previous.view.email, previous.view.released_on) == (NEW_EMAIL, None)

    def test_its_confirmation_answers_that_nothing_moved(self, mongo_replica_set_url: str):
        """The new mailbox is yet to confirm: `effective` true here has the frontend carry the sign-in account while every record stays."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, released=False)
            return await answer(database, client, minted.stop_token), (await everything(database))["pupil"]["email"]

        confirmed, address = on_a_person(mongo_replica_set_url, body)

        assert (confirmed.answer, confirmed.effective, confirmed.effective_from, address) == ("confirmed", False, None, EMAIL)

    def test_its_decline_ends_the_change_and_leaves_its_address_nowhere(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, released=False)
            declined = await answer(database, client, minted.stop_token, "declined")
            return declined, await change(database, minted.id), await view(database, client, minted.stop_token)

        declined, record, previous = on_a_person(mongo_replica_set_url, body)

        assert (declined.answer, record["email"], record["ended"]["kind"], record["token_hashes"]) == ("declined", None, "declined", [])
        # `effective` true has the frontend carry the sign-in account to a mailbox nothing moved to.
        assert declined.effective is False
        assert (previous.view.state, previous.view.kind, previous.view.ended_on) == ("ended", "declined", TODAY)
        # Declined before it confirmed anything: the link names no day of a confirmation.
        assert (previous.view.way, previous.view.released_on) == ("account", None)

    def test_past_its_deadline_it_confirms_nothing_and_still_declines(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, released=False)
            late = await refused_code(answer(database, client, minted.stop_token, germany_now=AFTER_THE_DEADLINE))
            declined = await answer(database, client, minted.stop_token, "declined", germany_now=AFTER_THE_DEADLINE)
            return late, declined.answer, (await change(database, minted.id))["token_hashes"]

        assert on_a_person(mongo_replica_set_url, body) == (Code.LINK_EXPIRED, "declined", [])

    def test_answered_once_it_takes_no_second_answer(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            return [
                await refused_code(answer(database, client, minted.stop_token)),
                await refused_code(answer(database, client, minted.stop_token, "declined")),
            ]

        assert on_a_person(mongo_replica_set_url, body) == [Code.ADDRESS_CHANGE_ENDED] * 2

    def test_an_administrator_s_notice_link_answers_no_confirmation(self, mongo_replica_set_url: str):
        """Every other way's link to the address on file offers its stop alone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client)
            return await refused_code(answer(database, client, started.stop_token)), (await change(database, started.id))["ended"]

        assert on_a_person(mongo_replica_set_url, body) == (Code.LINK_INVALID, None)

    def test_the_tool_re_sends_no_link_before_the_address_on_file_confirmed(self, mongo_replica_set_url: str):
        """A re-send would ask the new mailbox past the confirmation the person's own change waits on."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, released=False)
            refused = await refused_code(resend(database, client, minted.id))
            return refused, (await change(database, minted.id))["token_hashes"]

        # The resendable filter's miss, and no other refusal standing in for it.
        assert on_a_person(mongo_replica_set_url, body) == (Code.DOCUMENT_NOT_FOUND, [])


class TestTheSystemsReadOfTheNewAddress:
    def test_a_live_change_answers_its_new_address_folded_by_its_link_and_by_its_id(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, email="Lenore.Q@NeuPost.example.org")
            before = [
                await the_new_address(database, client, token=started.token),
                await the_new_address(database, client, address_change_id=started.id),
            ]
            await answer(database, client, started.token)
            after = [
                await the_new_address(database, client, token=started.token),
                await the_new_address(database, client, address_change_id=started.id),
            ]
            return [answered.email for answered in (*before, *after)]

        assert on_a_person(mongo_replica_set_url, body) == [NEW_EMAIL] * 4

    def test_a_row_holding_another_spelling_is_answered_folded(self, mongo_replica_set_url: str):
        """Every start stores the fold and the database refuses no spelling: a row written by hand still names the account's key."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            await database[Collection.ADDRESS_CHANGES].update_one({"_id": minted.id}, {"$set": {"email": "Lenore.Q@NeuPost.example.org"}})
            return (await the_new_address(database, client, address_change_id=minted.id)).email

        assert on_a_person(mongo_replica_set_url, body) == NEW_EMAIL

    def test_a_key_naming_no_live_change_answers_null(self, mongo_replica_set_url: str):
        """Never a 404: a lapsed or answered link costs the page no error, and the stop link never names the new mailbox."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            stopped = await start(database, client)
            await stop_by_link(database, client, stopped.stop_token)
            live = await start(database, client, identifier=OTHER_EMAIL, email="jonte.neu@anderswo.example")
            asked = [
                {"token": live.stop_token},
                {"token": "nobody-minted-this"},
                {"address_change_id": ObjectId()},
                {"token": stopped.token},
                {"address_change_id": stopped.id},
            ]
            return [(await the_new_address(database, client, **key)).email for key in asked]

        assert on_a_person(mongo_replica_set_url, body) == [None] * 5

    def test_through_the_mounted_route_no_log_line_names_the_address(self, mongo_replica_set_url: str, capfd: pytest.CaptureFixture[str]):
        """Read off the process's own output, which the app's build points its handlers at, so the request's line itself is held."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            async with app_client(mongo_replica_set_url, app=create_app(config_for(DATABASE_NAME))) as http:
                capfd.readouterr()
                response = await http.post(f"/api/v{API_VERSION}/address_change/address", headers=SYSTEM_AUTH, json={"token": minted.token})
                written = capfd.readouterr()
            return response.status_code, response.json(), written.out + written.err

        status, answered, written = on_a_person(mongo_replica_set_url, body)

        assert (status, answered["email"]) == (200, NEW_EMAIL)
        # Each line the formatter wrote, parsed: a line no JSON reader reads would hide what it holds.
        documents = [json.loads(line) for line in written.splitlines() if line.startswith("{")]
        assert [(document["path"], document["status"]) for document in documents if "path" in document] == [
            (f"/api/v{API_VERSION}/address_change/address", 200)
        ], "the request's own line was not captured, so the absence below holds of nothing"
        assert NEW_EMAIL not in written.lower()


class _Sent(monitoring.CommandListener):
    """Every command this client sends, by its name and collection, and whether the server was told it belongs to a transaction.

    `autocommit` and not `txnNumber`: that flag IS the instruction, so a command carries it exactly when it runs in the
    transaction; a number only stands in for it.
    """

    def __init__(self) -> None:
        self.sent: list[tuple[str, str, bool]] = []

    def started(self, event: monitoring.CommandStartedEvent) -> None:
        self.sent.append((event.command_name, str(event.command.get(event.command_name)), event.command.get("autocommit") is False))

    def succeeded(self, event: monitoring.CommandSucceededEvent) -> None:
        """Required by the listener interface; this spy judges the command as it is sent."""

    def failed(self, event: monitoring.CommandFailedEvent) -> None:
        """Required by the listener interface; a failed command is still one this spy has seen started."""


class TestTheConfirmation:
    def test_the_effect_sends_every_command_inside_its_transaction(self, mongo_replica_set_url: str):
        """On the wire, not in the source: a helper of the effect dropping its optional session still type-checks.

        Its write would then land even where the transaction rolls back. An earlier effect's carry is owed to the
        address, so the read and the write passing it on run too.
        """

        spy = _Sent()

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.ADDRESS_CHANGES].insert_one(
                {
                    **documents.address_change_document(address=FOREIGN_EMAIL, email=EMAIL, token_hash=None, day="2126-03-01"),
                    "address": None,
                    "email": None,
                    "ended": {"kind": "effective", "at": NOW},
                    "move": {"old": FOREIGN_EMAIL, "new": EMAIL},
                }
            )
            minted = await start(database, client)
            # A client of this case's own, so the spy sees the effect's commands rather than the seeding's.
            watched = AsyncMongoClient(mongo_replica_set_url, event_listeners=[spy])
            try:
                answered = await answer(watched[DATABASE_NAME], watched, minted.token)
                # Read before the close sends `endSessions`, which is no command of the effect's.
                sent = list(spy.sent)
            finally:
                await watched.close()
            return answered, sent, await carries(database)

        answered, sent, owed_carries = on_a_person(mongo_replica_set_url, body)

        # The floor: an effect that moved nothing, or a spy that saw nothing, would pass the clause below.
        assert answered.effective
        assert owed_carries == [(FOREIGN_EMAIL, NEW_EMAIL), (EMAIL, NEW_EMAIL)]
        written = {collection for name, collection, _ in sent if name in ("findAndModify", "update", "insert", "delete")}
        assert {Collection.SPIELER, Collection.SAISON_TEAMS, Collection.BEWERBUNGEN, Collection.ADDRESS_CHANGES} <= written

        assert [(name, collection) for name, collection, in_transaction in sent if not in_transaction] == []

    def test_every_own_record_moves_and_every_other_stays(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await everything(database)
            minted = await start(database, client)
            answered = await answer(database, client, minted.token)

            return (
                before,
                minted,
                answered,
                await everything(database),
                await change(database, minted.id),
                (await owed(database), await carries(database)),
            )

        before, minted, answered, after, record, (notices, owed_carries) = on_a_person(mongo_replica_set_url, body)

        assert answered.effective
        # Both mailboxes confirmed the change through their own links, so the effect owes neither a mail.
        assert notices == []
        assert owed_carries == [(EMAIL, NEW_EMAIL)]
        # Each moved record is written once, and the seed carries no version, so the one write leaves it at 1.
        assert after["pupil"] == {**before["pupil"], "email": NEW_EMAIL, "version": 1}
        # The confirmed referee row moves.
        assert after["referee"] == {**before["referee"], "kontakt": {**before["referee"]["kontakt"], "email": NEW_EMAIL}, "version": 1}
        assert after["unconfirmed referee"] == before["unconfirmed referee"]
        seats = after["season row"]
        assert (seats["kontakte"]["ansprechperson"]["email"], seats["kontakte"]["stellvertretung"]["email"]) == (NEW_EMAIL, EMAIL)
        # A team's match confirmation names its seats by role and never by address, so the move leaves it whole.
        assert after["confirmation"] == before["confirmation"]
        assert after["pending application"]["kontakte"]["trainer"]["email"] == NEW_EMAIL
        assert after["accepted application"]["kontakte"]["ansprechperson"]["email"] == NEW_EMAIL
        assert (after["confirmed registration"]["email"], after["unconfirmed registration"]["email"]) == (NEW_EMAIL, NEW_EMAIL)
        # The tombstone holds no address and answers how the change ended.
        assert (record["address"], record["email"], record["ended"]["kind"]) == (None, None, "effective")
        assert record["token_hashes"] == [hash_token(minted.token)]

    def test_a_lost_mailbox_change_is_confirmed_and_waits_for_the_pass(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client)
            confirmed = await answer(database, client, started.token)
            waiting = await everything(database)
            early = await sweep(database, client, germany_now=NOW + timedelta(days=1))
            late = await sweep(database, client, germany_now=AFTER_THE_WAIT)

            return started, confirmed, waiting, early, late, await everything(database), (await owed(database), await carries(database))

        started, confirmed, waiting, early, late, after, (notices, owed_carries) = on_a_person(mongo_replica_set_url, body)

        assert (confirmed.effective, confirmed.effective_from) == (
            False,
            (NOW + timedelta(days=ADDRESS_CHANGE_WAITING_PERIOD_DAYS)).astimezone(UTC),
        )
        assert (waiting["pupil"]["email"], waiting["referee"]["kontakt"]["email"]) == (EMAIL, EMAIL)
        assert (early.removed, early.discarded, early.effective) == (0, 0, 0)
        assert late.effective == 1
        # The lost-mailbox way carries no account: that mailbox may have passed to a stranger.
        assert (notices, owed_carries) == ([{"kind": "effective", "to": EMAIL}], [])
        assert (after["pupil"]["email"], after["referee"]["kontakt"]["email"]) == (NEW_EMAIL, NEW_EMAIL)

    def test_a_press_finding_nothing_left_to_move_writes_nothing_and_the_link_lapses(self, mongo_replica_set_url: str):
        """A 409 promises the frontend no write (`app/core/codes.py`): a change ended here would leave the site's cache stale."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            await database[Collection.SPIELER].delete_one({"_id": SPIELER_OID})
            for collection in (Collection.SCHIEDSRICHTER, Collection.SAISON_TEAMS, Collection.BEWERBUNGEN, Collection.REGISTRIERUNGEN):
                await database[collection].delete_many({})
            code = await refused_code(answer(database, client, minted.token))
            standing = await change(database, minted.id)
            await sweep(database, client, germany_now=AFTER_THE_DEADLINE)

            return code, standing, await change(database, minted.id)

        code, standing, lapsed = on_a_person(mongo_replica_set_url, body)

        assert (code, standing["ended"], standing["email"]) == (Code.ADDRESS_CHANGE_NOTHING, None, NEW_EMAIL)
        assert (lapsed["ended"]["kind"], lapsed["email"]) == ("expired", None)

    def test_a_pupil_moves_to_the_fold_whatever_the_record_spells(self, mongo_replica_set_url: str):
        """The sign-in joins `spieler.email` by equality, so a spelling left unfolded signs the pupil in to nothing, with nothing failing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            await database[Collection.ADDRESS_CHANGES].update_one({"_id": minted.id}, {"$set": {"email": "Lenore.Q@NeuPost.example.org"}})
            await answer(database, client, minted.token)
            return (await row(database, Collection.SPIELER, SPIELER_OID))["email"]

        assert on_a_person(mongo_replica_set_url, body) == NEW_EMAIL

    def test_the_decline_ends_it_and_leaves_its_address_nowhere(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            await stop_here(database, client)
            minted = await start(database, client)
            answered = await answer(database, client, minted.token, "declined", germany_now=AFTER_THE_DEADLINE)

            return answered, await change(database, minted.id), await where_held(database, NEW_EMAIL, folded=True)

        answered, record, held = on_a_person(mongo_replica_set_url, body)

        assert (answered.answer, answered.effective) == ("declined", False)
        assert record["ended"]["kind"] == "declined"
        # Only the row of the link mail the league sent, which keeps its recipient until its retention ends.
        assert held == {NEW_EMAIL: ["outbox"]}


VERA_ROW_OID = ObjectId("6890a1b2c3d4e5f607850032")


async def held_by_another(database: AsyncDatabase, what: str) -> None:
    """The new address named by another person's entry, its holder never signed in there."""

    vera = {**documents.kontaktperson_document("Vera", confirmed_at=None), "last_name": "Zwirnbach", "email": NEW_EMAIL}
    confirmed = {**documents.kontaktperson_document("Vera", confirmed_at="2126-03-21"), "last_name": "Zwirnbach", "email": NEW_EMAIL}
    match what:
        case "a-grant":
            await granted(database, NEW_EMAIL)
        case "a-seat" | "an-unconfirmed-seat":
            seat = confirmed if what == "a-seat" else vera
            await database[Collection.SAISON_TEAMS].insert_one(
                {
                    **documents.saison_team_document(
                        SAISON_ID, SECOND_TEAM_OID, "Quellbrunn", "QBX", kontakte=documents.kontakte_document(trainer=seat)
                    ),
                    "_id": VERA_ROW_OID,
                }
            )
        case "a-confirmed-application-seat" | "an-application-seat":
            seat = confirmed if what == "a-confirmed-application-seat" else vera
            await database[Collection.BEWERBUNGEN].insert_one(
                documents.bewerbung_document(
                    ObjectId(), SAISON_ID, "submitted", kontakte=documents.kontakte_document(trainer=seat), submitted_at="2126-03-10"
                )
            )
        case "a-referee" | "an-unconfirmed-referee":
            einwilligung = (
                documents.own_einwilligung_document(text_versions=documents.SCHIEDSRICHTER_TEXT_VERSIONS, confirmed_at="2126-03-02")
                if what == "a-referee"
                else None
            )
            await database[Collection.SCHIEDSRICHTER].insert_one(
                documents.schiedsrichter_document(
                    ObjectId(), email=NEW_EMAIL, name="Vera Zwirnbach", default_payment=20, einwilligung=einwilligung
                )
            )
        case "a-registration" | "an-unconfirmed-registration":
            await database[Collection.REGISTRIERUNGEN].insert_one(
                documents.registrierung_document(
                    ObjectId(),
                    NEW_EMAIL,
                    saison_id=SAISON_ID,
                    team_id=SECOND_TEAM_OID,
                    first_name="Vera",
                    last_name="Zwirnbach",
                    token="veras-registration-link",
                    submitted_at="2126-03-30",
                    deadline="2126-04-06",
                    confirmed=documents.registrierung_confirmed(
                        birth_date="2010-01-01", today="2126-03-31", at="2126-03-31T08:00:00+00:00", scope="internal", media=False
                    )
                    if what == "a-registration"
                    else None,
                )
            )
        case "a-pupil":
            await database[Collection.SPIELER].insert_one(
                documents.spieler_document(ObjectId(), "Vera", "Zwirnbach", email=NEW_EMAIL, birth_date="2010-01-01")
            )
        case "an-unconfirmed-pupil":
            await database[Collection.SPIELER].insert_one(
                documents.spieler_document(ObjectId(), "Vera", "Zwirnbach", email=NEW_EMAIL, birth_date="2010-01-01", einwilligung=None)
            )
        case "an-owed-carry":
            # Another person's change off it, ended, whose account still stands there until the frontend carries it.
            await database[Collection.ADDRESS_CHANGES].insert_one(
                {
                    **documents.address_change_document(address=NEW_EMAIL, email=FOREIGN_EMAIL, token_hash=None, day="2126-03-01"),
                    "address": None,
                    "email": None,
                    "ended": {"kind": "effective", "at": NOW},
                    "move": {"old": NEW_EMAIL, "new": FOREIGN_EMAIL},
                }
            )


# Each kind of entry naming the new address, confirmed or not: each admits a sign-in there, or will once confirmed or granted.
HELD_BY_ANOTHER = [
    "a-seat",
    "an-unconfirmed-seat",
    "an-application-seat",
    "an-unconfirmed-referee",
    "an-unconfirmed-registration",
    "a-grant",
    "an-owed-carry",
]


class TestTheNewAddressesOwnRecords:
    @pytest.mark.parametrize(("what", "holder"), [*((what, False) for what in HELD_BY_ANOTHER), ("an-unconfirmed-seat", True)])
    def test_the_press_onto_them_is_refused_and_moves_nothing(self, mongo_replica_set_url: str, what: str, holder: bool):
        """The takeover it closes: joined to the starter's, their holder's records would sign in with the starter's passkey.

        The start judged nothing of the new address; its link's page offers no confirmation, and nothing is owed a mailbox. A
        holder's press meets this rule too: only the pass weighs a holder's change by what a person confirmed.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if holder:
                await granted(database)
            await held_by_another(database, what)
            minted = await start(database, client)
            seen = (await view(database, client, minted.token)).view.state
            refused = await refused_code(answer(database, client, minted.token))
            return seen, refused, await everything(database), await owed(database)

        seen, refused, rows, notices = on_a_person(mongo_replica_set_url, body)

        assert (seen, refused) == ("not_confirmable", Code.ADDRESS_CHANGE_OCCUPIED)
        # No notice of this change's own.
        assert (rows["pupil"]["email"], rows["referee"]["kontakt"]["email"]) == (EMAIL, EMAIL)
        assert notices == []

    def test_the_tool_s_refusal_names_its_box_and_the_press_s_names_none(self, mongo_replica_set_url: str):
        """Unnamed, the tool's refusal reaches a shared failure line; on the press, it would name a field its body has not got."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            await held_by_another(database, "a-seat")
            with pytest.raises(APIError) as pressed:
                await answer(database, client, minted.token)
            await stop_here(database, client)
            with pytest.raises(APIError) as started:
                await administrator_starts(database, client)

            return started.value.fields, pressed.value.fields

        assert on_a_person(mongo_replica_set_url, body) == ((("email",),), ())

    def test_a_link_mail_the_drain_reaches_past_its_link_is_given_up_and_the_lost_mailbox_notice_goes(self, mongo_replica_set_url: str):
        """The mail promises the link's hours: sent late it carries a dead link, and the stop link beside it answers past every deadline."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            payload = FLAddressChangeAdminPayload.model_validate({"address": EMAIL, "email": NEW_EMAIL})
            await call(post_address_change_admin, database, client, address_change_data=payload)
            late = await post_handout(
                outbox_collection=database[Collection.OUTBOX],
                ban_list_collection=database[Collection.BAN_LIST],
                db=database,
                db_client=client,
                now=AFTER_THE_DEADLINE,
            )
            return [mail.data.kind for mail in late.mails], late.abandoned

        assert on_a_person(mongo_replica_set_url, body) == (["address_change_notice"], 1)

    def test_a_question_the_drain_reaches_past_its_link_is_given_up(self, mongo_replica_set_url: str):
        """The person's own notice asks what its link answers, so sent late it asks a question nobody can answer any more."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call(post_address_change, database, client, address_change_data=FLAccountAddressChangePayload(email=NEW_EMAIL))
            late = await post_handout(
                outbox_collection=database[Collection.OUTBOX],
                ban_list_collection=database[Collection.BAN_LIST],
                db=database,
                db_client=client,
                now=AFTER_THE_DEADLINE,
            )
            return late.mails, late.abandoned

        assert on_a_person(mongo_replica_set_url, body) == ([], 1)

    def test_a_pupil_there_refuses_a_starter_holding_no_pupil_of_their_own(self, mongo_replica_set_url: str):
        """A starter holding a pupil is refused `address_change_taken` first, so a seat-only starter is the one this kind reaches."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await held_by_another(database, "a-pupil")
            minted = await start(database, client)
            seen = (await view(database, client, minted.token)).view.state
            refused = await refused_code(answer(database, client, minted.token))
            return seen, refused, (await row(database, Collection.SCHIEDSRICHTER, REFEREE_OID))["kontakt"]["email"]

        assert on_a_person(mongo_replica_set_url, body, pupil=False) == ("not_confirmable", Code.ADDRESS_CHANGE_OCCUPIED, EMAIL)

    def test_entries_arriving_after_the_confirmation_end_the_change_not_in_effect(self, mongo_replica_set_url: str):
        """A waiting time lets them arrive after the press judged none, so the pass judges again and tells the new mailbox."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client)
            await answer(database, client, started.token)
            await held_by_another(database, "a-seat")
            swept = await sweep(database, client, germany_now=AFTER_THE_WAIT)
            return swept, await change(database, started.id), await everything(database), await owed(database)

        swept, record, rows, notices = on_a_person(mongo_replica_set_url, body)

        assert (swept.discarded, swept.effective, record["ended"]["kind"], rows["pupil"]["email"]) == (1, 0, "discarded", EMAIL)
        assert [(notice["kind"], notice["to"]) for notice in notices] == [("discarded", NEW_EMAIL)]


async def unreferenced(database: AsyncDatabase, *addresses: str) -> list[str]:
    return await unreferenced_of(
        list(addresses),
        record_collections(database),
        grants_collection=database[Collection.GRANTS],
        address_changes_collection=database[Collection.ADDRESS_CHANGES],
    )


async def told(database: AsyncDatabase) -> list[tuple[str, str, str | None, str | None, Any]]:
    """The holders' notices owed, in order: their stage, recipient, named old address, masked new one and the wait's end."""

    rows = database[Collection.OUTBOX].find({"kind": "grant"}, sort=[("recorded_at", 1), ("to", 1)])

    return [
        (
            row["data"]["stage"],
            row["to"],
            row["data"]["address"],
            row["data"]["new_address"],
            row["data"]["effective_from"],
        )
        async for row in rows
    ]


class TestAHoldersOwnChange:
    @pytest.mark.parametrize(
        ("holder", "wait"),
        [
            pytest.param(EMAIL, timedelta(hours=GRANT_WAIT_HOURS), id="an administrator's waits a day"),
            pytest.param(OWNER, timedelta(days=OWNER_WAIT_DAYS), id="the owner's waits a week"),
        ],
    )
    def test_it_waits_whole_while_the_old_address_holds_the_grant_and_switches_at_its_date(
        self, mongo_replica_set_url: str, holder: str, wait: timedelta
    ):
        """Switched at the press, a stolen mailbox carries the grant before any holder could read of it; early, the owner's week is gone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if holder == EMAIL:
                await granted(database)
            before = await database[Collection.GRANTS].find_one({"address": holder})
            assert before is not None
            minted = await start(database, client, identifier=holder)
            answered = await answer(database, client, minted.token)
            early = await sweep(database, client, germany_now=NOW + wait - timedelta(minutes=1))
            waiting = await row(database, Collection.GRANTS, before["_id"])
            due = NOW + wait + timedelta(minutes=1)
            late = await sweep(database, client, germany_now=due)
            moved = await row(database, Collection.GRANTS, before["_id"])
            return answered, early, waiting, late, moved, due, await carries(database), await owed(database)

        answered, early, waiting, late, moved, due, owed_carries, notices = on_a_person(mongo_replica_set_url, body)

        assert (answered.effective, answered.effective_from) == (False, (NOW + wait).astimezone(UTC))
        assert (early.effective, waiting["address"]) == (0, holder)
        assert late.effective == 1
        # One row, kept by its id, and dated by the switch, so no session older than the switch holds it.
        assert (moved["address"], moved["effective_from"].replace(tzinfo=UTC)) == (NEW_EMAIL, due.astimezone(UTC))
        # A person's own change carries its account, the wait being no lost mailbox, and tells the replaced mailbox.
        assert owed_carries == [(holder, NEW_EMAIL)]
        assert [(notice["kind"], notice["to"]) for notice in notices] == [("effective", holder)]

    def test_a_grant_still_waiting_counts_as_held(self, mongo_replica_set_url: str):
        """A person named on an addition moves it by waiting too: at the press, it would reach a new mailbox nobody was told of."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            grant = await granted(database)
            await database[Collection.GRANTS].update_one({"_id": grant}, {"$set": {"effective_from": NOW + timedelta(hours=20)}})
            minted = await start(database, client)
            return await answer(database, client, minted.token), await database[Collection.GRANTS].distinct("address", {"_id": grant})

        answered, addresses = on_a_person(mongo_replica_set_url, body)

        assert (answered.effective, addresses) == (False, [EMAIL])

    def test_the_press_onto_another_holder_s_address_is_refused_and_confirms_nothing(self, mongo_replica_set_url: str):
        """Unrefused, the wait runs to a pass that must end it, and the holders are told of a move no grant can make."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            await granted(database, NEW_EMAIL)
            minted = await start(database, client)
            seen = (await view(database, client, minted.token)).view.state
            refused = await refused_code(answer(database, client, minted.token))
            return seen, refused, (await change(database, minted.id))["confirmed_at"], await told(database)

        assert on_a_person(mongo_replica_set_url, body) == ("not_confirmable", Code.ADDRESS_CHANGE_NEW_GRANTED, None, [])

    def test_every_holder_is_told_at_the_second_confirmation_and_when_it_completes_the_new_address_masked(self, mongo_replica_set_url: str):
        """The first mail's reader may be the one person who can reach the owner in time; whole, it hands the league a private mailbox."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client, released=False)
            unconfirmed = await told(database)
            await answer(database, client, minted.stop_token)
            first = await told(database)
            confirmed = await handed_out(database, client, None)
            await answer(database, client, confirmed.token)
            started = await told(database)
            await database[Collection.OUTBOX].delete_many({"kind": "grant"})
            await sweep(database, client, germany_now=AFTER_THE_DEADLINE)
            return unconfirmed, first, started, await told(database)

        unconfirmed, first, started, completed = on_a_person(mongo_replica_set_url, body)

        assert (unconfirmed, first) == ([], [])
        masked = "l•••@n•••.org"
        # The date is the mail's one sentence on when it lands.
        ends = "2126-04-02T10:30:00Z"
        assert started == [("started", address, EMAIL, masked, ends) for address in sorted((*ADMINISTRATORS, EMAIL))]
        # The moved row is a holder at its new address. The old address has its short-lived effective mail alone: this row
        # would keep it 30 days past an erasure.
        assert completed == [("completed", address, EMAIL, masked, None) for address in sorted((*ADMINISTRATORS, NEW_EMAIL))]

    @pytest.mark.parametrize("ended_by", ["the stop link", "the account page", "the owner's discard", "a new start", "the pass refusing it"])
    def test_every_ending_of_its_wait_tells_every_holder(self, mongo_replica_set_url: str, ended_by: str):
        """Told it would happen and not told it stopped, a holder reports a threat that passed, or trusts one that came back."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            await answer(database, client, minted.token)
            await database[Collection.OUTBOX].delete_many({"kind": "grant"})
            match ended_by:
                case "the stop link":
                    await stop_by_link(database, client, minted.stop_token)
                case "the account page":
                    await stop_here(database, client)
                case "the owner's discard":
                    await discard(database, client, minted.id, operator=OWNER)
                case "a new start":
                    await start(database, client, email=FOREIGN_EMAIL, germany_now=NOW + RESTART, released=False)
                case "the pass refusing it":
                    await held_by_another(database, "a-seat")
                    await sweep(database, client, germany_now=AFTER_THE_DEADLINE)
            return await told(database)

        assert on_a_person(mongo_replica_set_url, body) == [
            ("withdrawn", address, EMAIL, "l•••@n•••.org", None) for address in sorted((*ADMINISTRATORS, EMAIL))
        ]

    @pytest.mark.parametrize("way", ["account", "waiting_period"])
    def test_a_non_holder_s_change_tells_the_holders_nothing(self, mongo_replica_set_url: str, way: str):
        """Holders hear of access alone: a parent's new mailbox is no business of theirs."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await (start(database, client) if way == "account" else administrator_starts(database, client))
            await answer(database, client, minted.token)
            await sweep(database, client, germany_now=AFTER_THE_WAIT)
            return await told(database)

        assert on_a_person(mongo_replica_set_url, body) == []

    @pytest.mark.parametrize(
        ("erased", "named", "recipients"),
        [
            pytest.param(NEW_EMAIL, EMAIL, (*ADMINISTRATORS, EMAIL), id="the new address's owner"),
            pytest.param(EMAIL, None, (), id="the holder, whose grant's end tells them"),
        ],
    )
    def test_an_erasure_ending_another_holder_s_wait_tells_every_holder_and_masks_nothing_of_the_erased(
        self, mongo_replica_set_url: str, erased: str, named: str | None, recipients: tuple[str, ...]
    ):
        """The holders hold a date the erasure took away, and a mask of the new address would be all that is left of the person."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            await answer(database, client, minted.token)
            await database[Collection.OUTBOX].delete_many({"kind": "grant"})
            await erase(database, client, erased)
            return [notice for notice in await told(database) if notice[0] == "withdrawn"]

        assert on_a_person(mongo_replica_set_url, body) == [("withdrawn", address, named, None, None) for address in sorted(recipients)]

    def test_a_row_a_handover_names_waits_the_owner_s_week_and_its_mails_say_so(self, mongo_replica_set_url: str):
        """A day's wait would land after the role did, and the mailbox holding the owner's role would have moved in a day."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            grant = await granted(database)
            await database[Collection.GRANTS].update_one({"_id": grant}, {"$set": {"owner_from": NOW + timedelta(days=1)}})
            minted = await start(database, client)
            answered = await answer(database, client, minted.token)
            mails = database[Collection.OUTBOX].find({"kind": {"$in": ["address_change_notice", "address_change_link"]}})
            return answered.effective_from, sorted([row["data"]["holder"] async for row in mails])

        effective_from, holders = on_a_person(mongo_replica_set_url, body)

        assert effective_from == (NOW + timedelta(days=OWNER_WAIT_DAYS)).astimezone(UTC)
        assert holders == ["owner", "owner"]

    def test_the_account_page_is_told_the_wait_a_handover_s_row_serves(self, mongo_replica_set_url: str):
        """The page words the wait from this read: the stored tier would promise a day where the row waits a week."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            grant = await granted(database)
            before = await read(database, client)
            await database[Collection.GRANTS].update_one({"_id": grant}, {"$set": {"owner_from": NOW + timedelta(days=1)}})
            return before.wait_tier, (await read(database, client)).wait_tier

        assert on_a_person(mongo_replica_set_url, body) == ("administration", "owner")

    def test_a_lost_mailbox_start_landing_beside_an_addition_of_its_address_meets_the_grant(self, mongo_replica_set_url: str):
        """Unanchored, the two share no row and both commit: a change an administrator may not start stands at a grant."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def addition() -> Any:
                token = actor_var.set(OWNER)
                try:
                    return await call(post_grant, database, client, payload=FLPostGrantPayload(email=EMAIL), operator=OWNER)
                finally:
                    actor_var.reset(token)

            racing = GrantsRunningARivalAfterTheFirstRead(database[Collection.GRANTS], addition)
            outcome = await outcome_of(administrator_starts(database, client, grants_collection=cast(Any, racing)))
            racing.assert_landed_inside(serially=1)

            return racing.rival_outcome, outcome, await database[Collection.ADDRESS_CHANGES].count_documents(build_address_filter(EMAIL))

        assert on_a_person(mongo_replica_set_url, body) == (COMMITTED, Code.ADMIN_ADDRESS, 0)

    @pytest.mark.parametrize(
        ("what", "moves"),
        [
            *(
                (what, True)
                for what in (
                    "an-unconfirmed-seat",
                    "an-application-seat",
                    "an-unconfirmed-referee",
                    "an-unconfirmed-registration",
                    "an-unconfirmed-pupil",
                )
            ),
            *((what, False) for what in ("a-seat", "a-confirmed-application-seat", "a-referee", "a-registration", "a-pupil", "an-owed-carry")),
        ],
    )
    def test_only_what_a_person_confirmed_ends_a_holder_s_change_at_the_pass(self, mongo_replica_set_url: str, what: str, moves: bool):
        """Anyone can name an address in a form, and only the owner stops a holder's change: one colleague could stop it every time.

        A confirmed entry does stop it, or the grant joins a stranger's records. The starter holds no pupil of their own, whose
        `taken` is judged ahead of this rule and would answer for the pupil arms.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            grant = await granted(database)
            minted = await start(database, client)
            await answer(database, client, minted.token)
            await held_by_another(database, what)
            passed = await sweep(database, client, germany_now=AFTER_THE_DEADLINE)
            return passed.effective, passed.discarded, (await row(database, Collection.GRANTS, grant))["address"]

        assert on_a_person(mongo_replica_set_url, body, pupil=False) == ((1, 0, NEW_EMAIL) if moves else (0, 1, EMAIL))

    def test_an_entry_nobody_confirmed_still_ends_a_non_holder_s_change_at_the_pass(self, mongo_replica_set_url: str):
        """Only a holder's change has the owner as its one stop: a pupil's moved onto a stranger's seat would join two people."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await administrator_starts(database, client)
            await answer(database, client, minted.token)
            await held_by_another(database, "an-unconfirmed-seat")
            return (await sweep(database, client, germany_now=AFTER_THE_WAIT)).discarded

        assert on_a_person(mongo_replica_set_url, body) == 1

    def test_the_log_holds_its_start_under_the_holder_and_its_switch_under_the_pass(self, mongo_replica_set_url: str):
        """Two rows no page reads but the Protokoll: gone, nothing says when power moved, and nothing fails."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            await answer(database, client, minted.token)
            await sweep(database, client, germany_now=AFTER_THE_DEADLINE)
            rows = database[Collection.ACTION_LOG].find({"record_id": minted.id}, sort=[("_id", 1)])
            return [(row["action"], row["by"], row["label"]) async for row in rows]

        assert on_a_person(mongo_replica_set_url, body) == [
            # The switch carries the holder's address through the log, so an erasure at the new one reaches this row.
            ("grant.address_change_started", NEW_EMAIL, NEW_EMAIL),
            ("grant.address_switched", "system", NEW_EMAIL),
        ]

    def test_a_lost_mailbox_start_names_the_league_and_never_the_person_it_moves(self, mongo_replica_set_url: str):
        """That person may be the change's victim, and the row would name them as having asked for it for a year."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await administrator_starts(database, client, operator=OWNER)
            await answer(database, client, minted.token)
            rows = database[Collection.ACTION_LOG].find({"record_id": minted.id, "action": "grant.address_change_started"})
            return [row["by"] async for row in rows]

        assert on_a_person(mongo_replica_set_url, body) == ["system"]


class TestTheRunningChanges:
    def test_the_list_leaves_out_the_actor_s_own_row_and_a_holder_s_unless_the_owner_asks(self, mongo_replica_set_url: str):
        """A holder's row carries their private new address and its stop, which are the owner's alone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            person = await start(database, client)
            admin = await start(database, client, identifier=ADMIN, email="verwaltung.neu@anderswo.example")
            second = await start(database, client, identifier=SECOND_ADMIN, email=FOREIGN_EMAIL)
            await answer(database, client, second.token)
            ended = await start(database, client, identifier=OTHER_EMAIL, email="jonte.neu@anderswo.example")
            await stop_by_link(database, client, ended.stop_token)
            own = await start(database, client, identifier=OWNER, email="inhaber.neu@anderswo.example")
            seen = {reader: (await running(database, client, operator=reader)).changes for reader in (ADMIN, OWNER)}
            return (person.id, admin.id, second.id, own.id), seen

        (person, admin, second, own), seen = on_a_person(mongo_replica_set_url, body)

        assert [row.id for row in seen[ADMIN]] == [person]
        # The owner reads every holder's row but their own, whose acts the server refuses.
        assert own not in [row.id for row in seen[OWNER]]
        assert [row.holder for row in seen[OWNER]] == ["administration", "administration", None]
        # Newest first, each row its two addresses and the step it waits on.
        assert [row.id for row in seen[OWNER]] == [second, admin, person]
        assert (seen[OWNER][2].address, seen[OWNER][2].email, seen[OWNER][2].waits_on) == (
            EMAIL,
            NEW_EMAIL,
            "new_address",
        )
        # Each row the end of the step it waits on: the page dates a link by the one and a wait by the other.
        assert (seen[OWNER][2].valid_until, seen[OWNER][2].effective_from) == (A_LINK_S_DEADLINE, None)
        assert (seen[OWNER][0].valid_until, seen[OWNER][0].effective_from) == (None, A_HOLDER_S_WAIT_ENDS)

    def test_an_administrator_s_start_and_discard_each_write_their_row(self, mongo_replica_set_url: str):
        """The two acts the page records, neither with a label: a typed reason would outlive the record's own clearing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client)
            await discard(database, client, started.id)
            rows = database[Collection.ACTION_LOG].find({"record_id": started.id}, sort=[("_id", 1)])
            return [(row["action"], row["by"], row["label"]) async for row in rows]

        assert on_a_person(mongo_replica_set_url, body) == [
            ("address_change.started", ADMIN, None),
            ("address_change.discarded", ADMIN, None),
        ]


class TestTheAccountSweepWaitsForTheCarry:
    @pytest.mark.parametrize(("way", "held"), [("account", True), ("waiting_period", False)])
    def test_the_replaced_address_stays_referenced_while_its_account_s_carry_is_owed(self, mongo_replica_set_url: str, way: str, held: bool):
        """Swept before it is carried, the account and its passkeys would be gone when the carry runs; a change carrying none holds nothing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await (administrator_starts(database, client) if way == "waiting_period" else start(database, client))
            await answer(database, client, minted.token)
            if way == "waiting_period":
                await sweep(database, client, germany_now=AFTER_THE_WAIT)
            owed_now = await unreferenced(database, EMAIL)
            await database[Collection.ADDRESS_CHANGES].update_many({}, {"$unset": {"move": ""}})
            return owed_now, await unreferenced(database, EMAIL)

        owed_now, delivered = on_a_person(mongo_replica_set_url, body, records=False)

        assert owed_now == ([] if held else [EMAIL])
        assert delivered == [EMAIL]


class TestTheConfirmationsRefusals:
    def test_past_the_deadline(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            return await refused_code(answer(database, client, minted.token, germany_now=AFTER_THE_DEADLINE)), await everything(database)

        code, rows = on_a_person(mongo_replica_set_url, body)

        assert (code, rows["pupil"]["email"]) == (Code.LINK_EXPIRED, EMAIL)


class TestTheStop:
    @pytest.mark.parametrize("by", ["link", "account page"])
    def test_it_ends_the_change_and_leaves_its_address_nowhere(self, mongo_replica_set_url: str, by: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            if by == "link":
                await stop_by_link(database, client, minted.stop_token)
            else:
                await stop_here(database, client)

            return (
                await change(database, minted.id),
                await where_held(database, NEW_EMAIL, folded=True),
                await read(database, client),
            )

        record, held, seen = on_a_person(mongo_replica_set_url, body)

        assert record["ended"]["kind"] == "stopped"
        # Only the row of the link mail the league sent, which keeps its recipient until its retention ends.
        assert held == {NEW_EMAIL: ["outbox"]}
        assert seen.open is None


class TestTheToolsStart:
    def test_it_mints_the_new_mailbox_its_link_and_refuses_a_new_address_holding_entries(self, mongo_replica_set_url: str):
        """Its reader trusted, the tool refuses at its start what the confirmation would, and the change it would replace stands."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            plain = await administrator_starts(database, client)
            await granted(database, FOREIGN_EMAIL)
            refused = await refused_code(administrator_starts(database, client, email=FOREIGN_EMAIL))
            return plain, refused, await change(database, plain.id)

        plain, refused, record = on_a_person(mongo_replica_set_url, body)

        assert plain.token is not None
        assert (refused, record["ended"]) == (Code.ADDRESS_CHANGE_OCCUPIED, None)

    @staticmethod
    def refused_start(url: str, setup: str = "", **payload: Any) -> tuple[str, int]:
        """The tool's refusal, and that it wrote no change."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if setup == "grant":
                await granted(database)
            refused = await refused_code(administrator_starts(database, client, **payload))
            return refused, await database[Collection.ADDRESS_CHANGES].count_documents({})

        return on_a_person(url, body)

    def test_the_administrator_s_own_address_is_refused(self, mongo_replica_set_url: str):
        assert self.refused_start(mongo_replica_set_url, address=ADMIN) == (Code.OWN_ADDRESS, 0)

    def test_a_grant_holder_s_address_is_refused_without_an_owner_s_power(self, mongo_replica_set_url: str):
        assert self.refused_start(mongo_replica_set_url, "grant") == (Code.ADMIN_ADDRESS, 0)


class TestTheTool:
    def test_an_ended_change_s_id_is_refused_and_an_unknown_one_not_found(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client)
            await discard(database, client, started.id)
            with pytest.raises(DocumentNotFoundError):
                await discard(database, client, ObjectId())
            return await refused_code(discard(database, client, started.id)), await refused_code(resend(database, client, started.id))

        assert on_a_person(mongo_replica_set_url, body) == (Code.ADDRESS_CHANGE_ENDED,) * 2

    def test_the_re_send_replaces_the_link_and_keeps_the_stop_link(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client)
            before = await change(database, started.id)
            sent = await resend(database, client, started.id, germany_now=NOW + timedelta(hours=2))
            return started, before, sent, await change(database, started.id), await refused_code(view(database, client, started.token))

        started, before, sent, after, old = on_a_person(mongo_replica_set_url, body)

        assert (sent.stop_token, after["token_hashes"], after["stop"]) == (None, [hash_token(sent.token)], before["stop"])
        assert after["valid_until"] > before["valid_until"]
        # The replaced link opens nothing: its hash is gone from the record.
        assert old == Code.LINK_INVALID

    @pytest.mark.parametrize("press", ["a re-send", "the address on file's confirmation"])
    def test_a_fresh_link_s_mail_ends_with_that_link(self, mongo_replica_set_url: str, press: str):
        """Ending at the old deadline, the row is abandoned at the next claim, a lapsed link's re-send included, and no mail goes."""

        later = NOW + timedelta(hours=2)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, released=press == "a re-send")
            if press == "a re-send":
                await resend(database, client, minted.id, germany_now=later)
            else:
                await answer(database, client, minted.stop_token, germany_now=later)
            mail = await database[Collection.OUTBOX].find_one({"kind": "address_change_link"}, sort=[("recorded_at", -1)])
            assert mail is not None
            return mail["deadline"], (await change(database, minted.id))["valid_until"]

        fresh = (later + timedelta(hours=ADDRESS_CHANGE_VALID_HOURS)).astimezone(UTC).replace(tzinfo=None)

        assert on_a_person(mongo_replica_set_url, body) == (fresh, fresh)

    def test_a_confirmed_change_is_sent_no_fresh_link(self, mongo_replica_set_url: str):
        """A deadline set again on a change waiting out its time would make the pass end it lapsed rather than let it take effect."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client)
            await answer(database, client, started.token)
            with pytest.raises(DocumentNotFoundError):
                await resend(database, client, started.id)
            return (await change(database, started.id))["valid_until"]

        assert on_a_person(mongo_replica_set_url, body) is None

    @pytest.mark.parametrize(("way", "holders"), [("account", ["owner", "owner"]), ("waiting_period", [None, None])])
    def test_a_re_send_words_the_wait_the_first_link_worded(self, mongo_replica_set_url: str, way: str, holders: list[str | None]):
        """The link's mail words the wait: a holder's own change serves their tier's, and a lost-mailbox change the league's."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            grant = await granted(database)
            await database[Collection.GRANTS].update_one({"_id": grant}, {"$set": {"owner_from": NOW + timedelta(days=1)}})
            minted = await (start(database, client) if way == "account" else administrator_starts(database, client, operator=OWNER))
            await resend(database, client, minted.id, operator=OWNER, germany_now=NOW + timedelta(hours=2))
            return [row["data"]["holder"] async for row in database[Collection.OUTBOX].find({"kind": "address_change_link"})]

        assert on_a_person(mongo_replica_set_url, body) == holders

    @pytest.mark.parametrize("what", ["a-pupil", "a-seat"])
    def test_a_re_send_to_an_address_taken_since_answers_the_one_code_its_page_words(self, mongo_replica_set_url: str, what: str):
        """Another code falls through to the shared failure line, which sends the administrator to a retry refused alike."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client)
            await held_by_another(database, what)
            return await refused_code(resend(database, client, started.id))

        assert on_a_person(mongo_replica_set_url, body) == Code.ADDRESS_CHANGE_NEW_TAKEN

    @pytest.mark.parametrize("route", ["re-send", "discard"])
    @pytest.mark.parametrize(("whose", "refused"), [("own", Code.OWN_ADDRESS), ("grant-holder", Code.ADMIN_ADDRESS)])
    def test_who_asks_is_refused_on_every_route_the_start_refuses_it(self, mongo_replica_set_url: str, route: str, whose: str, refused: str):
        """An administrator's own address, and a grant holder's for anyone without an owner's power: each route its own read."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            address = ADMIN if whose == "own" else EMAIL
            if whose == "grant-holder":
                await granted(database)
            # An owner may start either; the suite's first administrator then asks.
            started = await administrator_starts(database, client, address=address, operator=OWNER)
            before = await change(database, started.id)
            asked = {
                "re-send": lambda: resend(database, client, started.id),
                "discard": lambda: discard(database, client, started.id),
            }[route]
            return await refused_code(asked()), before == await change(database, started.id)

        assert on_a_person(mongo_replica_set_url, body) == (refused, True)

    def test_the_discard_acts_on_the_change_its_id_names_alone(self, mongo_replica_set_url: str):
        """A page showing a change since replaced discards nothing: key the discard on the address and the later change goes."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await administrator_starts(database, client)
            later = await start(database, client, germany_now=NOW + RESTART)
            stale = await refused_code(discard(database, client, first.id))
            await discard(database, client, later.id)
            return stale, await change(database, later.id), await where_held(database, NEW_EMAIL, folded=True)

        stale, record, held = on_a_person(mongo_replica_set_url, body)

        assert (stale, record["ended"]["kind"]) == (Code.ADDRESS_CHANGE_ENDED, "discarded")
        # Only the row of the link mail the league sent, which keeps its recipient until its retention ends.
        assert held == {NEW_EMAIL: ["outbox"]}


class TestALapse:
    def test_a_link_lapsing_unconfirmed_queues_nothing(self, mongo_replica_set_url: str):
        """Nobody confirmed it, so nobody waits to hear of it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await start(database, client)
            swept = await sweep(database, client, germany_now=AFTER_THE_DEADLINE)
            return swept.removed, await owed(database)

        assert on_a_person(mongo_replica_set_url, body) == (1, [])


# Where a person moves on to after a first change.
THIRD_EMAIL = "lenore.dritte@nochwoanders.example.org"


class TestTheMovedAddressLeavesNothingBehind:
    def test_a_second_change_leaves_the_first_one_s_address_nowhere_past_the_erasure(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await start(database, client)
            await answer(database, client, first.token)
            second = await start(database, client, identifier=NEW_EMAIL, email=THIRD_EMAIL)
            await answer(database, client, second.token)
            await erase(database, client, THIRD_EMAIL)
            return await where_held(database, NEW_EMAIL, folded=True)

        assert on_a_person(mongo_replica_set_url, body) == {NEW_EMAIL: []}


async def outcome_code(call: Awaitable[Any]) -> str | None:
    """`None` for a press that landed, its refusal's code otherwise."""

    try:
        await call
    except APIError as refused:
        return refused.error_code
    return None


class TestTwoPressesAtOnce:
    """Each press judges inside its own transaction, so two running at once settle to one outcome, whichever commits first."""

    def test_two_pupils_confirming_one_address_leave_it_one_holder(self, mongo_replica_set_url: str):
        """The loser meets the winner's key in `uniq_spieler_email` as a write conflict, whose retry the in-session read refuses."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            ours = await start(database, client)
            theirs = await start(database, client, identifier=OTHER_EMAIL)
            codes = await asyncio.gather(
                outcome_code(answer(database, client, ours.token)), outcome_code(answer(database, client, theirs.token))
            )
            holders = [found["_id"] async for found in database[Collection.SPIELER].find({"email": NEW_EMAIL}, {"_id": 1})]
            return codes, holders, {minted.id: await change(database, minted.id) for minted in (ours, theirs)}

        codes, holders, changes = on_a_person(mongo_replica_set_url, body)

        assert sorted(codes, key=str) == [None, Code.ADDRESS_CHANGE_TAKEN]
        assert len(holders) == 1
        # The loser moved nothing, and its change stands for its person to see.
        assert sorted(record["ended"] is None for record in changes.values()) == [False, True]

    def test_a_confirmation_and_a_discard_of_one_change_leave_one_of_them(self, mongo_replica_set_url: str):
        """Both end the one record, so whichever commits second meets the first and finds the change ended."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            confirmed, discarded = await asyncio.gather(
                outcome_code(answer(database, client, minted.token)), outcome_code(discard(database, client, minted.id))
            )
            return confirmed, discarded, (await change(database, minted.id))["ended"]["kind"], (await everything(database))["pupil"]["email"]

        confirmed, discarded, kind, address = on_a_person(mongo_replica_set_url, body)

        if confirmed is None:
            assert (discarded, kind, address) == (Code.ADDRESS_CHANGE_ENDED, "effective", NEW_EMAIL)
        else:
            assert (confirmed, discarded, kind, address) == (Code.ADDRESS_CHANGE_ENDED, None, "discarded", EMAIL)


class TestTheDecline:
    def test_a_lapsed_link_still_declines_and_leaves_its_address_nowhere(self, mongo_replica_set_url: str):
        """Its holder says the change is not theirs; a link refusing that would keep a stranger's address stored."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            await answer(database, client, minted.token, "declined", germany_now=AFTER_THE_DEADLINE)
            return (await change(database, minted.id))["ended"]["kind"], await where_held(database, NEW_EMAIL, folded=True)

        kind, held = on_a_person(mongo_replica_set_url, body)

        # Only the row of the link mail the league sent, which keeps its recipient until its retention ends.
        assert (kind, held) == ("declined", {NEW_EMAIL: ["outbox"]})


class TestTheWaitingTime:
    def test_the_stop_link_ends_it_during_the_wait(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client)
            await answer(database, client, started.token)
            seen = await view(database, client, started.stop_token, germany_now=NOW + timedelta(days=3))
            await stop_by_link(database, client, started.stop_token)
            return seen, await sweep(database, client, germany_now=AFTER_THE_WAIT), await everything(database)

        seen, swept, after = on_a_person(mongo_replica_set_url, body)

        assert (seen.view.side, seen.view.state) == ("previous", "waiting_period")
        assert swept.effective == 0
        assert after["pupil"]["email"] == EMAIL


DECLINED_REG_OID = ObjectId("6890a1b2c3d4e5f607850053")
ANSWERED_OID = ObjectId("6890a1b2c3d4e5f607850063")


async def confirmed_and_moved(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    minted = await start(database, client)
    await answer(database, client, minted.token)


class TestWhatTheEffectLeavesTheErasure:
    """Everything of the person the replaced address keyed, within reach of an erasure of the new one."""

    def test_the_old_mailbox_s_registration_link_confirms_nothing_afterwards(self, mongo_replica_set_url: str):
        """An unanswered registration moves too, or its admission makes a second person; its link stayed in the replaced mailbox."""

        def view(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            payload = FLTokenPayload(token=UNCONFIRMED_REG_LINK)
            return call(get_confirmation_view, database, client, view_data=payload, today=TODAY)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            # The registration's club stands in the season: a club holding no row takes no answer from any link.
            await database[Collection.SAISON_TEAMS].insert_one(documents.saison_team_document(SAISON_ID, SECOND_TEAM_OID, "Quellbrunn", "QBX"))
            before = await view(database, client)
            await confirmed_and_moved(database, client)
            return before, await refused_code(view(database, client))

        before, after = on_a_person(mongo_replica_set_url, body)

        assert (before.state, after) == ("valid", Code.LINK_INVALID)

    def test_a_declined_registration_moves_too(self, mongo_replica_set_url: str):
        """Left behind, it holds the pupil's name and data where an erasure of the new address never looks, until its month is out."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            declined = registration(DECLINED_REG_OID, SECOND_TEAM_OID, confirmed=False, token="the-declined-registrations-link")
            declined.update(compose_decline_update(reason=None, today=TODAY)["$set"])
            await database[Collection.REGISTRIERUNGEN].insert_one(declined)
            await confirmed_and_moved(database, client)
            return await row(database, Collection.REGISTRIERUNGEN, DECLINED_REG_OID)

        assert on_a_person(mongo_replica_set_url, body)["email"] == NEW_EMAIL

    def test_an_earlier_effect_s_owed_carry_follows_the_person(self, mongo_replica_set_url: str):
        """Its account goes where the person is now, and an erasure of the new address finds the record."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.ADDRESS_CHANGES].insert_one(
                {
                    **documents.address_change_document(address=FOREIGN_EMAIL, email=EMAIL, token_hash=None, day="2126-03-01"),
                    "address": None,
                    "email": None,
                    "ended": {"kind": "effective", "at": NOW},
                    "move": {"old": FOREIGN_EMAIL, "new": EMAIL},
                }
            )
            await confirmed_and_moved(database, client)
            return await carries(database)

        assert on_a_person(mongo_replica_set_url, body) == [(FOREIGN_EMAIL, NEW_EMAIL), (EMAIL, NEW_EMAIL)]


class TestTheErasure:
    def test_an_erased_new_address_ends_another_address_s_change_and_holds_it_nowhere(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            await erase(database, client, NEW_EMAIL)
            return await change(database, minted.id), await where_held(database, NEW_EMAIL, folded=True)

        record, held = on_a_person(mongo_replica_set_url, body)

        assert (record["ended"]["kind"], record["email"]) == ("discarded", None)
        assert held == {NEW_EMAIL: []}

    def test_an_erased_address_on_file_ends_its_own_change_and_neither_address_is_held(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            await erase(database, client, EMAIL)
            return await change(database, minted.id), await where_held(database, EMAIL, NEW_EMAIL, folded=True)

        record, held = on_a_person(mongo_replica_set_url, body)

        assert (record["ended"]["kind"], record["address"], record["email"]) == ("discarded", None, None)
        assert held == {EMAIL: [], NEW_EMAIL: []}


def erase(database: AsyncDatabase, client: AsyncMongoClient, email: str) -> Any:
    """The erasure on request, as the owner."""

    return call(
        post_erasure,
        database,
        client,
        erasure_data=FLErasurePayload(email=email, reason="Auf Anfrage per Brief"),
        operator=OWNER,
    )


class _HeldAfterItsRead(HeldCollection):
    """A start held after its read of the address's live change until a rival start has committed, counting its reads."""

    MISSED = "the start answered without reading the address's live change, so nothing held it across the rival's commit"

    def __init__(self, collection: Any, committed: asyncio.Event) -> None:
        super().__init__(collection, committed)
        self.reads = 0

    async def find_one(self, *args: Any, **kwargs: Any) -> Any:
        found = await self._collection.find_one(*args, **kwargs)
        if kwargs.get("filter", args[0] if args else {}) == build_address_filter(EMAIL):
            self.reads += 1
            await self.hold()

        return found


class TestTwoStartsAtOnce:
    def test_two_starts_on_one_address_meet_at_its_unique_index_and_leave_it_one_live_change(self, mongo_replica_set_url: str):
        """The start committing second meets `uniq_address_change_address` as a write conflict, and its retry replaces the first's."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            # No grant to anchor, whose conflict would part the two ahead of the index this case is about.
            await database[Collection.GRANTS].delete_many({})
            committed = asyncio.Event()
            held = _HeldAfterItsRead(database[Collection.ADDRESS_CHANGES], committed)
            # Past the restart interval, so the retry meeting the rival's change replaces it rather than waiting.
            task = asyncio.ensure_future(start(database, client, address_changes_collection=cast(Any, held), germany_now=NOW + RESTART))
            await held.until_held(task)
            try:
                rival = await administrator_starts(database, client, email=FOREIGN_EMAIL)
            except BaseException:
                await held.abandon(task)
                raise
            committed.set()
            minted = await task

            live = await database[Collection.ADDRESS_CHANGES].find({"ended": None}).to_list(None)
            return held.reads, held.insert_failures, [row["_id"] for row in live], minted.id, (await change(database, rival.id))["ended"]

        reads, failures, live, minted, rival_end = on_a_person(mongo_replica_set_url, body)

        # Two attempts, each reading the live change twice: for the restart refusal, then for the change it replaces.
        assert reads == 4
        assert failures == ["OperationFailure:112"]
        assert live == [minted]
        assert rival_end["kind"] == "replaced"
