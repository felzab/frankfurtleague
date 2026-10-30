"""
API · one address's change of the address it signs in on, driven end to end against the shipped indexes

The person starts it on their own account page, an administrator through the address tool for a person who cannot sign
in, and the new mailbox's confirmation, an administrator's approval of a grant's move, or the hourly pass at the end of a
waiting time moves everything the replaced address holds in one write. The pass's share and failures are
`tests/api/test_adresswechsel_sweep_execution.py`'s.
"""

import asyncio
import json
import logging
from collections.abc import Awaitable, Iterator, Mapping
from contextlib import contextmanager
from datetime import UTC, timedelta
from typing import Any, cast

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from app.api.adresswechsel.crud import build_loeschung_adresswechsel_pipeline
from app.api.adresswechsel.schemas import FLAddressChangeAdressePayload
from app.api.adresswechsel.services import (
    build_address_filter,
    build_addresses_filter,
)
from app.api.adresswechsel.system_router import get_address_change_adresse
from app.api.berechtigungen.admin_router import delete_approval_request, get_grants
from app.api.berechtigungen.antraege import compose_antrag
from app.api.berechtigungen.crud import live_unbarred_grant_since
from app.api.einladungen.services import compose_einladung
from app.api.identitaet.admin_router import get_erasure_view, post_erasure
from app.api.identitaet.crud import find_anmeldung, find_subjekt, unreferenced_of
from app.api.identitaet.schemas import FLErasureAdressePayload, FLErasurePayload
from app.api.identitaet.wiederherstellung import Read, Window, plan_replay, replay_line
from app.api.registrierungen.public_router import get_confirmation_view
from app.api.registrierungen.services import compose_ablehnung_update, erinnerung_is_due
from app.api.schiedsrichter.admin_router import get_schiedsrichter_by_id
from app.api.spielbestaetigungen.services import halter_of
from app.api.spieler.admin_router import get_spieler_saisons
from app.api.spieler.services import build_spieler_saisons_pipeline
from app.api.teams.admin_router import get_team_saisons
from app.core.codes import Code
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db
from app.core.exceptions import APIError, DocumentNotFoundError
from app.core.journal import JOURNAL_TOKEN, JournalLine, parse_line
from app.core.recording import Actor, PersonActor, actor_var, log_stamp
from app.core.security import akteur_pseudonym, loeschung_journal_hash, signed_in_since
from app.core.transactions import transaction_session
from app.main import create_app
from app.shared.schemas.bestaetigung import FLTokenPayload
from app.shared.schemas.bounds import ADRESSWECHSEL_NACHLAUF_TAGE
from app.shared.tokens import hash_token
from tests import documents
from tests.app_client import app_client
from tests.bans import ban_list, ban_through_the_route
from tests.config import SYSTEM_AUTH, build_test_config, grants_for_the_suite
from tests.holds import HeldCollection
from tests.records import record_collections
from tests.whole_database import where_held
from tests.worker import worker_database

from .adresswechsel_harness import (
    ADMIN,
    AFTER_THE_DEADLINE,
    AFTER_THE_WAIT,
    AFTER_THE_WEEK,
    EMAIL,
    FOREIGN_EMAIL,
    GRUND,
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
    TEAM_OID,
    TODAY,
    TYPED,
    UNCONFIRMED_REFEREE_OID,
    UNCONFIRMED_REG_LINK,
    UNCONFIRMED_REG_OID,
    administrator_starts,
    answer,
    approve,
    approve_as_the_address,
    call,
    carries,
    change,
    discard,
    everything,
    granted,
    owed,
    person_actor,
    read,
    refused_code,
    registration,
    resend,
    row,
    start,
    stop_by_link,
    stop_here,
    sweep,
    tool_read,
    view,
)
from .adresswechsel_harness import on_a_person as _on_a_person
from .conftest import config_for

# Module level: every case below reaches a real mongod, each write being one transaction.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_adresswechsel_test")
KEY = build_test_config().sperrliste_schluessel
# A pupil whose record holds no address.


def on_a_person(url: str, body: Any, **seeded: Any) -> Any:
    return _on_a_person(url, DATABASE_NAME, body, **seeded)


@contextmanager
def journal_of(caplog: pytest.LogCaptureFixture) -> Iterator[list[Any]]:
    """The journal lines its block alone writes, filled as it closes.

    `caplog` keeps the whole case's records, and once an earlier module's app build set the journal logger to INFO, the
    lines written before the block are among them.
    """
    lines: list[Any] = []
    with caplog.at_level(logging.INFO):
        first = len(caplog.records)
        yield lines
        written = caplog.records[first:]
    lines.extend(parse_line(record.getMessage()) for record in written if record.getMessage().startswith(JOURNAL_TOKEN))


class TestTheAccountPagesRead:
    def test_it_offers_a_change_wherever_the_address_holds_anything_a_change_moves(self, mongo_replica_set_url: str):
        """A grant alone is enough: an administrator's address is theirs to change like anyone's."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return [(await read(database, client, address)).possible for address in (EMAIL, OTHER_EMAIL, ADMIN, "nobody@schule.example")]

        assert on_a_person(mongo_replica_set_url, body) == [True, True, True, False]

    def test_the_person_s_own_change_shows_its_address_whole(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await start(database, client)
            return await read(database, client)

        seen = on_a_person(mongo_replica_set_url, body)

        assert seen.offen is not None
        assert (seen.offen.email, seen.offen.way, seen.offen.waits_on, seen.offen.approval) == (NEW_EMAIL, "account", "new_adresse", None)

    def test_an_administrator_s_change_shows_its_address_masked_and_never_whole(self, mongo_replica_set_url: str):
        """It may be a pretext whose target the holder of the address on file must not learn: unmask it and this fails."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await administrator_starts(database, client, grund=None)
            return await read(database, client)

        seen = on_a_person(mongo_replica_set_url, body)
        served = seen.model_dump_json()

        assert seen.offen is not None and seen.offen.email == "l•••@n•••.org"
        assert (NEW_EMAIL in served, "lenore.q" in served, "neupost" in served) == (False, False, False)

    @pytest.mark.parametrize("step", ["link", "approval"])
    def test_a_lapsed_step_reads_lapsed_until_the_pass_ends_the_change(self, mongo_replica_set_url: str, step: str):
        """Its press is refused `link_expired`, so a page reading it unmarked offers that press until the pass."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if step == "approval":
                await granted(database)
            minted = await start(database, client)
            if step == "approval":
                await answer(database, client, minted.token)
            later = AFTER_THE_DEADLINE if step == "link" else AFTER_THE_WEEK
            seen = [(await read(database, client, germany_now=at)).offen for at in (NOW, later)]
            return [offen is not None and offen.abgelaufen for offen in seen]

        assert on_a_person(mongo_replica_set_url, body) == [False, True]


class TestThePersonsStart:
    def test_it_writes_one_record_keyed_by_the_address_with_both_links(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, identifier=EMAIL)
            return minted, await change(database, minted.id), await everything(database)

        minted, record, rows = on_a_person(mongo_replica_set_url, body)

        assert minted.email == NEW_EMAIL
        assert (record["adresse"], record["email"], record["way"], record["ended"], record["approval"]) == (
            EMAIL,
            NEW_EMAIL,
            "account",
            None,
            None,
        )
        assert (record["token_hashes"], record["stop"]["token_hashes"]) == ([hash_token(minted.token)], [hash_token(minted.stopp_token)])
        # Nothing of the person moves at the start.
        assert (rows["pupil"]["email"], rows["referee"]["kontakt"]["email"]) == (EMAIL, EMAIL)

    def test_the_new_mailbox_signs_in_to_nothing_and_is_served_no_record_until_the_effect(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            meanwhile = (
                await find_anmeldung(NEW_EMAIL, record_collections(database)),
                await find_subjekt(NEW_EMAIL, record_collections(database)),
            )
            await answer(database, client, minted.token)
            return meanwhile, [(await find_anmeldung(email, record_collections(database))).account for email in (EMAIL, NEW_EMAIL)]

        (gate, subjekt), after = on_a_person(mongo_replica_set_url, body)

        assert (gate.account, subjekt.spieler, subjekt.schiedsrichter, subjekt.sitze) == (False, [], [], [])
        # Afterwards one sign-in holds the person, and the replaced address none.
        assert after == [False, True]

    @pytest.mark.parametrize("held_by", ["nobody", "the-ban-list", "another-pupil", "a-grant"])
    def test_it_answers_alike_whatever_the_new_address_holds(self, mongo_replica_set_url: str, held_by: str):
        """The effect judges the new address; a start judging it would tell the signed-in person what a stranger's holds."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if held_by == "the-ban-list":
                await ban_through_the_route(database, client, email=NEW_EMAIL, grund="Falschangaben", von=ADMIN, today=TODAY)
            elif held_by == "another-pupil":
                await database[Collection.SPIELER].update_one({"_id": OTHER_OID}, {"$set": {"email": NEW_EMAIL}})
            elif held_by == "a-grant":
                await granted(database, NEW_EMAIL)
            minted = await start(database, client)

            return sorted(minted.answer.model_dump()), (await change(database, minted.id))["email"]

        assert on_a_person(mongo_replica_set_url, body) == (
            ["email", "valid_until", "id"],
            NEW_EMAIL,
        )

    def test_the_address_signed_in_on_is_refused_in_any_spelling(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(APIError) as refused:
                await start(database, client, email=TYPED.upper())
            return refused.value.error_code

        assert on_a_person(mongo_replica_set_url, body) == Code.ADDRESS_CHANGE_UNCHANGED

    def test_an_address_holding_nothing_a_change_moves_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await refused_code(start(database, client, identifier="nobody@schule.example"))

        assert on_a_person(mongo_replica_set_url, body) == Code.ADDRESS_CHANGE_NOTHING

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

    def test_a_grant_holder_s_change_asks_another_administrator_s_approval(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            return await change(database, minted.id)

        record = on_a_person(mongo_replica_set_url, body)

        genehmigung = record["approval"]
        assert (genehmigung["verwaltung"], genehmigung["started_by"], genehmigung["approved_at"]) == ("administration", EMAIL, None)

    def test_the_last_owner_makes_another_before_changing_their_address(self, mongo_replica_set_url: str):
        """Nobody but another owner approves an owner's change, so a change nobody could approve would only lapse."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            refused = await refused_code(start(database, client, identifier=OWNER))
            await database[Collection.BERECHTIGUNGEN].update_one({"adresse": SECOND_ADMIN}, {"$set": {"verwaltung": "owner"}})
            minted = await start(database, client, identifier=OWNER)
            return refused, (await change(database, minted.id))["approval"]["verwaltung"]

        assert on_a_person(mongo_replica_set_url, body) == (Code.ADDRESS_CHANGE_NO_APPROVER, "owner")

    def test_it_replaces_the_live_change_whose_links_then_answer_how_it_ended(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture
    ):
        """A sign-in at the address on file proves the mailbox is not lost, so its own start replaces a change asked without it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await administrator_starts(database, client, grund=GRUND, email=FOREIGN_EMAIL)
            with journal_of(caplog) as journal:
                second = await start(database, client)

            return (
                first,
                second,
                await change(database, first.id),
                await view(database, client, first.token),
                await where_held(database, FOREIGN_EMAIL, folded=True),
                journal,
            )

        first, second, replaced, seen, held, journal = on_a_person(mongo_replica_set_url, body)

        assert (replaced["ended"]["art"], replaced["adresse"], replaced["email"], replaced["grund"]) == ("replaced", None, None, None)
        assert (seen.view.state, seen.view.art) == ("ended", "replaced")
        # Only the row of the link mail the league sent, which keeps its recipient until its retention ends.
        assert held == {FOREIGN_EMAIL: ["outbox"]}
        assert [(line.art, line.record_id) for line in journal] == [("adresswechsel_verworfen", first.id)]
        assert second.id != first.id


async def everything_but_the_pupil(database: AsyncDatabase) -> dict[str, Mapping[str, Any]]:
    return {
        "season row": await row(database, Collection.SAISON_TEAMS, ROW_OID),
        "pending application": await row(database, Collection.BEWERBUNGEN, PENDING_OID),
    }


class TestTheLinks:
    def test_the_new_mailbox_s_link_answers_exactly_its_side_its_state_and_its_deadline(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            return await view(database, client, minted.token), await view(database, client, minted.stopp_token)

        neu, bisherig = on_a_person(mongo_replica_set_url, body)

        assert neu.view.model_dump(exclude={"valid_until"}) == {
            "seite": "new",
            "state": "valid",
            "effective_from": None,
            "way": "account",
            "approval_open": None,
        }
        assert (bisherig.view.seite, bisherig.view.state, bisherig.view.way) == ("previous", "open", "account")

    def test_a_grant_holder_s_link_tells_of_the_approval_only_once_pressed(self, mongo_replica_set_url: str):
        """Before the press it would tell whoever holds a mistyped link that the account holds access to the administration."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            before = await view(database, client, minted.token)
            await answer(database, client, minted.token)
            return before.view, (await view(database, client, minted.token)).view

        before, after = on_a_person(mongo_replica_set_url, body)

        assert (before.state, before.approval_open) == ("valid", None)
        assert (after.state, after.approval_open) == ("confirmed", True)

    def test_a_confirmed_link_whose_approval_week_lapsed_reads_lapsed(self, mongo_replica_set_url: str):
        """The pass ends it unapproved, so the page must not still promise it takes effect once approved."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            await answer(database, client, minted.token)
            return (await view(database, client, minted.token, germany_now=AFTER_THE_WEEK)).view

        seen = on_a_person(mongo_replica_set_url, body)

        # Never `abgelaufen`, the link's own lapse: the page would offer a decline the confirmed link refuses.
        assert (seen.state, seen.approval_open) == ("approval_expired", None)

    @pytest.mark.parametrize(
        ("cause", "refused"),
        [
            ("vergeben", Code.ADDRESS_CHANGE_TAKEN),
            ("nicht_gedeckt", Code.ADDRESS_CHANGE_NOT_COVERED),
            ("neue_berechtigt", Code.ADDRESS_CHANGE_NEW_GRANTED),
            # Nothing left to move: the press ends the change discarded and answers `address_change_ended`.
            ("leer", Code.ADDRESS_CHANGE_ENDED),
        ],
    )
    def test_a_link_its_press_would_refuse_for_the_address_on_file_s_sake_offers_no_confirmation(
        self, mongo_replica_set_url: str, cause: str, refused: str
    ):
        """The page reads its view before offering the press: a view reading `valid` here offers what the press refuses."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if cause == "neue_berechtigt":
                await granted(database)
            minted = await start(database, client, identifier=OTHER_EMAIL) if cause == "leer" else await start(database, client)
            if cause == "leer":
                # Its one pupil row erased by a database edit, which ends no change as the erasure route would.
                await database[Collection.SPIELER].delete_one({"_id": OTHER_OID})
            elif cause == "vergeben":
                await database[Collection.SPIELER].update_one({"_id": OTHER_OID}, {"$set": {"email": NEW_EMAIL}})
            elif cause == "nicht_gedeckt":
                await granted(database)
            else:
                await granted(database, NEW_EMAIL)
            return (await view(database, client, minted.token)).view.state, await refused_code(answer(database, client, minted.token))

        assert on_a_person(mongo_replica_set_url, body) == ("not_confirmable", refused)

    @pytest.mark.parametrize(("step", "waits_on", "bisherig"), [("release", "release", "release_open"), ("approval", "approval", "approval")])
    def test_the_step_a_change_waits_on_reads_on_the_account_page_and_the_stop_link(
        self, mongo_replica_set_url: str, step: str, waits_on: str, bisherig: str
    ):
        """The account page offers the address on file's approval on `release` alone, and the stop link names each step."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if step == "release":
                minted = await administrator_starts(database, client, grund=None)
            else:
                await granted(database)
                minted = await start(database, client)
                await answer(database, client, minted.token)
            offen = (await read(database, client)).offen
            assert offen is not None
            return offen.waits_on, (await view(database, client, minted.stopp_token)).view.state

        assert on_a_person(mongo_replica_set_url, body) == (waits_on, bisherig)

    def test_a_token_no_change_holds_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return [
                await refused_code(view(database, client, "nobody-minted-this")),
                await refused_code(answer(database, client, "nobody-minted-this")),
                await refused_code(stop_by_link(database, client, "nobody-minted-this")),
            ]

        assert on_a_person(mongo_replica_set_url, body) == [Code.LINK_INVALID] * 3

    def test_an_ended_change_s_links_answer_how_it_ended_and_take_nothing_more(self, mongo_replica_set_url: str):
        """Each link answers truthfully after the end, for as long as the record is kept."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            await stop_by_link(database, client, minted.stopp_token)

            return (
                await view(database, client, minted.token),
                await view(database, client, minted.stopp_token),
                await refused_code(answer(database, client, minted.token)),
                await refused_code(stop_by_link(database, client, minted.stopp_token)),
            )

        neu, bisherig, pressed, stopped = on_a_person(mongo_replica_set_url, body)

        assert (neu.view.seite, neu.view.state, neu.view.art) == ("new", "ended", "stopped")
        assert (bisherig.view.seite, bisherig.view.state, bisherig.view.art) == ("previous", "ended", "stopped")
        assert (pressed, stopped) == (Code.ADDRESS_CHANGE_ENDED, Code.ADDRESS_CHANGE_ENDED)

    def test_a_confirmed_link_answers_its_state_and_takes_no_second_press(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=GRUND)
            await answer(database, client, started.token)
            return await view(database, client, started.token), await refused_code(answer(database, client, started.token, "declined"))

        seen, pressed = on_a_person(mongo_replica_set_url, body)

        assert (seen.view.state, seen.view.valid_until, seen.view.effective_from is not None) == ("confirmed", None, True)
        assert pressed == Code.ADDRESS_CHANGE_ENDED


def the_new_address(database: AsyncDatabase, client: AsyncMongoClient, **key: Any) -> Awaitable[Any]:
    """What the frontend's server asks before a press, a link's view or an approval reads its sign-in store."""

    return call(get_address_change_adresse, database, client, adresse_data=FLAddressChangeAdressePayload.model_validate(key))


class TestTheSystemsReadOfTheNewAddress:
    def test_a_live_change_answers_its_new_address_folded_by_its_link_and_by_its_id(self, mongo_replica_set_url: str):
        """Confirmed and waiting too: its approval still reads the sign-in store at the address it would move to."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=GRUND, email="Lenore.Q@NeuPost.example.org")
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
            await database[Collection.ADRESSWECHSEL].update_one({"_id": minted.id}, {"$set": {"email": "Lenore.Q@NeuPost.example.org"}})
            return (await the_new_address(database, client, address_change_id=minted.id)).email

        assert on_a_person(mongo_replica_set_url, body) == NEW_EMAIL

    def test_a_key_naming_no_live_change_answers_null(self, mongo_replica_set_url: str):
        """Never a 404: a lapsed or answered link costs the page no error, and the stop link never names the new mailbox."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            stopped = await start(database, client)
            await stop_by_link(database, client, stopped.stopp_token)
            live = await start(database, client, identifier=OTHER_EMAIL, email="jonte.neu@anderswo.example")
            asked = [
                {"token": live.stopp_token},
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
                response = await http.post(f"/api/v{API_VERSION}/address_change/adresse", headers=SYSTEM_AUTH, json={"token": minted.token})
                written = capfd.readouterr()
            return response.status_code, response.json(), written.out + written.err

        status, answered, written = on_a_person(mongo_replica_set_url, body)

        assert (status, answered["email"]) == (200, NEW_EMAIL)
        # Each line the formatter wrote, parsed: a line no JSON reader reads would hide what it holds.
        documents = [json.loads(line) for line in written.splitlines() if line.startswith("{")]
        assert [(document["path"], document["status"]) for document in documents if "path" in document] == [
            (f"/api/v{API_VERSION}/address_change/adresse", 200)
        ], "the request's own line was not captured, so the absence below holds of nothing"
        assert NEW_EMAIL not in written.lower()


class TestTheConfirmation:
    def test_every_own_record_moves_and_every_other_stays(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await everything(database)
            minted = await start(database, client)
            with journal_of(caplog) as journal:
                answered = await answer(database, client, minted.token)

            return (
                before,
                minted,
                answered,
                await everything(database),
                await change(database, minted.id),
                journal,
                (await owed(database), await carries(database)),
            )

        before, minted, answered, after, record, journal, (notices, owed_carries) = on_a_person(mongo_replica_set_url, body)

        assert answered.effective
        assert notices == [{"art": "effective", "an": EMAIL, "vorname": "Lenore"}]
        assert owed_carries == [(EMAIL, NEW_EMAIL)]
        # Each moved record is written once, and the seed carries no version, so the one write leaves it at 1.
        assert after["pupil"] == {**before["pupil"], "email": NEW_EMAIL, "version": 1}
        # The confirmed referee row moves.
        assert after["referee"] == {**before["referee"], "kontakt": {**before["referee"]["kontakt"], "email": NEW_EMAIL}, "version": 1}
        assert after["unconfirmed referee"] == before["unconfirmed referee"]
        seats = after["season row"]
        assert (seats["kontakte"]["ansprechperson"]["email"], seats["kontakte"]["stellvertretung"]["email"]) == (NEW_EMAIL, EMAIL)
        assert after["confirmation"]["kontakte"]["ansprechperson"] is None
        # The unconfirmed seat at the same address stays, and so does the link its match confirmation sent it.
        assert after["confirmation"]["kontakte"]["stellvertretung"] == before["confirmation"]["kontakte"]["stellvertretung"]
        assert after["pending application"]["kontakte"]["trainer"]["email"] == NEW_EMAIL
        assert after["accepted application"]["kontakte"]["ansprechperson"]["email"] == NEW_EMAIL
        assert (after["confirmed registration"]["email"], after["unconfirmed registration"]["email"]) == (NEW_EMAIL, NEW_EMAIL)
        # The tombstone holds no address and answers how the change ended.
        assert (record["adresse"], record["email"], record["ended"]["art"]) == (None, None, "effective")
        assert record["token_hashes"] == [hash_token(minted.token)]
        [line] = [line for line in journal if line.art == "adresswechsel_wirksam"]
        assert (line.record_id, line.before) == (minted.id, loeschung_journal_hash(EMAIL, key=KEY))

    def test_a_change_started_with_a_reason_is_confirmed_and_waits_for_the_pass(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=GRUND)
            confirmed = await answer(database, client, started.token)
            waiting = await everything(database)
            early = await sweep(database, client, germany_now=NOW + timedelta(days=1))
            late = await sweep(database, client, germany_now=AFTER_THE_WAIT)

            return started, confirmed, waiting, early, late, await everything(database), (await owed(database), await carries(database))

        started, confirmed, waiting, early, late, after, (notices, owed_carries) = on_a_person(mongo_replica_set_url, body)

        assert started.way == "waiting_period"
        assert (confirmed.effective, confirmed.effective_from is not None, confirmed.approval_open) == (False, True, False)
        assert (waiting["pupil"]["email"], waiting["referee"]["kontakt"]["email"]) == (EMAIL, EMAIL)
        assert (early.removed, early.discarded, early.effective) == (0, 0, 0)
        assert late.effective == 1
        # The lost-mailbox way greets nobody, and carries no account: that mailbox may have passed to a stranger.
        assert (notices, owed_carries) == ([{"art": "effective", "an": EMAIL, "vorname": None}], [])
        assert (after["pupil"]["email"], after["referee"]["kontakt"]["email"]) == (NEW_EMAIL, NEW_EMAIL)

    def test_a_change_finding_nothing_left_to_move_ends_discarded(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            await database[Collection.SPIELER].delete_one({"_id": SPIELER_OID})
            for collection in (Collection.SCHIEDSRICHTER, Collection.SAISON_TEAMS, Collection.BEWERBUNGEN, Collection.REGISTRIERUNGEN):
                await database[collection].delete_many({})
            with journal_of(caplog) as journal:
                code = await refused_code(answer(database, client, minted.token))

            return code, await change(database, minted.id), journal

        code, record, journal = on_a_person(mongo_replica_set_url, body)

        assert (code, record["ended"]["art"], record["email"]) == (Code.ADDRESS_CHANGE_ENDED, "discarded", None)
        assert [line.art for line in journal] == ["adresswechsel_verworfen"]

    def test_the_decline_ends_it_and_leaves_its_address_nowhere(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            await stop_here(database, client)
            minted = await start(database, client)
            with journal_of(caplog) as journal:
                answered = await answer(database, client, minted.token, "declined", germany_now=AFTER_THE_DEADLINE)

            return answered, await change(database, minted.id), await where_held(database, NEW_EMAIL, folded=True), journal

        answered, record, held, journal = on_a_person(mongo_replica_set_url, body)

        assert (answered.antwort, answered.effective) == ("declined", False)
        assert record["ended"]["art"] == "declined"
        # Only the row of the link mail the league sent, which keeps its recipient until its retention ends.
        assert held == {NEW_EMAIL: ["outbox"]}
        assert [line.art for line in journal] == ["adresswechsel_abgelehnt"]


VERA_ROW_OID = ObjectId("6890a1b2c3d4e5f607850032")


async def held_by_another(database: AsyncDatabase, what: str) -> None:
    """The new address named by another person's entry, its holder never signed in there."""

    vera = {**documents.kontaktperson_document("Vera", confirmed_at=None), "nachname": "Zwirnbach", "email": NEW_EMAIL}
    bestaetigt = {**documents.kontaktperson_document("Vera", confirmed_at="2126-03-21"), "nachname": "Zwirnbach", "email": NEW_EMAIL}
    match what:
        case "a-grant":
            await granted(database, NEW_EMAIL)
        case "a-seat" | "an-unconfirmed-seat":
            seat = bestaetigt if what == "a-seat" else vera
            await database[Collection.SAISON_TEAMS].insert_one(
                {
                    **documents.saison_team_document(
                        SAISON_ID, SECOND_TEAM_OID, "Quellbrunn", "QBX", kontakte=documents.kontakte_document(trainer=seat)
                    ),
                    "_id": VERA_ROW_OID,
                }
            )
        case "an-application-seat":
            await database[Collection.BEWERBUNGEN].insert_one(
                documents.bewerbung_document(
                    ObjectId(), SAISON_ID, "submitted", kontakte=documents.kontakte_document(trainer=vera), submitted_at="2126-03-10"
                )
            )
        case "an-unconfirmed-referee":
            await database[Collection.SCHIEDSRICHTER].insert_one(
                documents.schiedsrichter_document(ObjectId(), email=NEW_EMAIL, name="Vera Zwirnbach", default_payment=20, einwilligung=None)
            )
        case "an-unconfirmed-registration":
            await database[Collection.REGISTRIERUNGEN].insert_one(
                documents.registrierung_document(
                    ObjectId(),
                    NEW_EMAIL,
                    saison_id=SAISON_ID,
                    team_id=SECOND_TEAM_OID,
                    vorname="Vera",
                    nachname="Zwirnbach",
                    token="veras-registration-link",
                    submitted_at="2126-03-30",
                    frist="2126-04-06",
                    confirmed=None,
                )
            )
        case "a-grant-request":
            await database[Collection.BERECHTIGUNGEN_ANTRAEGE].insert_one(
                compose_antrag(adresse=NEW_EMAIL, verwaltung="administration", grant_id=None, started_by=ADMIN, now=NOW)
            )
        case "a-pupil":
            await database[Collection.SPIELER].insert_one(
                documents.spieler_document(ObjectId(), "Vera", "Zwirnbach", email=NEW_EMAIL, geburtsdatum="2010-01-01")
            )
        case "an-owed-carry":
            # Another person's change off it, ended, whose account still stands there until the frontend carries it.
            await database[Collection.ADRESSWECHSEL].insert_one(
                {
                    **documents.adresswechsel_document(adresse=NEW_EMAIL, email=FOREIGN_EMAIL, token_hash=None, day="2126-03-01"),
                    "adresse": None,
                    "email": None,
                    "ended": {"art": "effective", "am": NOW},
                    "move": {"von": NEW_EMAIL, "nach": FOREIGN_EMAIL},
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
    "a-grant-request",
    "an-owed-carry",
]


class TestTheNewAddressesOwnRecords:
    @pytest.mark.parametrize("what", HELD_BY_ANOTHER)
    def test_the_press_onto_them_is_refused_and_moves_nothing(self, mongo_replica_set_url: str, what: str):
        """The takeover it closes: joined to the starter's, their holder's records would sign in with the starter's passkey.

        The start judged nothing of the new address; its link's page offers no confirmation, and nothing is owed a mailbox.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
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
            started = await administrator_starts(database, client, grund=GRUND)
            await answer(database, client, started.token)
            await held_by_another(database, "a-seat")
            swept = await sweep(database, client, germany_now=AFTER_THE_WAIT)
            return swept, await change(database, started.id), await everything(database), await owed(database)

        swept, record, rows, notices = on_a_person(mongo_replica_set_url, body)

        assert (swept.discarded, swept.effective, record["ended"]["art"], rows["pupil"]["email"]) == (1, 0, "discarded", EMAIL)
        assert [(notice["art"], notice["an"]) for notice in notices] == [("discarded", NEW_EMAIL)]

    def test_entries_arriving_before_the_approval_refuse_it_and_write_nothing(self, mongo_replica_set_url: str):
        """The approval is the press that takes effect here, judged as the confirmation is."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            await answer(database, client, minted.token)
            await held_by_another(database, "a-seat")
            refused = await refused_code(approve(database, client, minted.id, operator=ADMIN))
            return refused, await change(database, minted.id), await everything(database)

        refused, record, rows = on_a_person(mongo_replica_set_url, body)

        assert (refused, record["ended"], record["approval"]["approved_at"], rows["pupil"]["email"]) == (
            Code.ADDRESS_CHANGE_OCCUPIED,
            None,
            None,
            EMAIL,
        )


async def unreferenced(database: AsyncDatabase, *addresses: str) -> list[str]:
    return await unreferenced_of(
        list(addresses),
        record_collections(database),
        berechtigungen_collection=database[Collection.BERECHTIGUNGEN],
        adresswechsel_collection=database[Collection.ADRESSWECHSEL],
    )


class TestTheAccountSweepWaitsForTheCarry:
    @pytest.mark.parametrize(("way", "held"), [("account", True), ("waiting_period", False)])
    def test_the_replaced_address_stays_referenced_while_its_account_s_carry_is_owed(self, mongo_replica_set_url: str, way: str, held: bool):
        """Swept before it is carried, the account and its passkeys would be gone when the carry runs; a change carrying none holds nothing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await (administrator_starts(database, client, grund=GRUND) if way == "waiting_period" else start(database, client))
            await answer(database, client, minted.token)
            if way == "waiting_period":
                await sweep(database, client, germany_now=AFTER_THE_WAIT)
            owed_now = await unreferenced(database, EMAIL)
            await database[Collection.ADRESSWECHSEL].update_many({}, {"$unset": {"move": ""}})
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

    @staticmethod
    def refused_after_a_ban_on(url: str, *barred: str) -> tuple[str, str]:
        """The press's code and the view's state, the two ranked alike."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            for address in barred:
                await ban_through_the_route(database, client, email=address, grund="Falschangaben", von=ADMIN, today=TODAY)
            return await refused_code(answer(database, client, minted.token)), (await view(database, client, minted.token)).view.state

        return on_a_person(url, body)

    def test_to_an_address_barred_since_the_start(self, mongo_replica_set_url: str):
        assert self.refused_after_a_ban_on(mongo_replica_set_url, NEW_EMAIL) == (Code.LINK_BARRED, "barred")

    def test_from_an_address_on_file_barred_since_the_start(self, mongo_replica_set_url: str):
        """A barred person moves nothing off the address the ban keys on; the new mailbox learns nothing of the ban."""

        assert self.refused_after_a_ban_on(mongo_replica_set_url, EMAIL) == (Code.ADDRESS_CHANGE_REPLACED_BARRED, "not_confirmable")

    def test_a_ban_on_both_names_the_link_s_own(self, mongo_replica_set_url: str):
        assert self.refused_after_a_ban_on(mongo_replica_set_url, EMAIL, NEW_EMAIL) == (Code.LINK_BARRED, "barred")

    def test_a_lapsed_link_to_a_barred_address_names_the_ban(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            await ban_through_the_route(database, client, email=NEW_EMAIL, grund="Falschangaben", von=ADMIN, today=TODAY)
            return await refused_code(answer(database, client, minted.token, germany_now=AFTER_THE_DEADLINE))

        assert on_a_person(mongo_replica_set_url, body) == Code.LINK_BARRED

    def test_to_an_address_another_pupil_has_come_to_sign_in_on(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            await database[Collection.SPIELER].update_one({"_id": OTHER_OID}, {"$set": {"email": NEW_EMAIL}})
            return await refused_code(answer(database, client, minted.token)), await everything(database)

        code, rows = on_a_person(mongo_replica_set_url, body)

        assert (code, rows["pupil"]["email"]) == (Code.ADDRESS_CHANGE_TAKEN, EMAIL)


class TestTheStop:
    @pytest.mark.parametrize("by", ["link", "account page"])
    def test_it_ends_the_change_and_leaves_its_address_nowhere(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture, by: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            with journal_of(caplog) as journal:
                if by == "link":
                    await stop_by_link(database, client, minted.stopp_token)
                else:
                    await stop_here(database, client)

            return (
                await change(database, minted.id),
                await where_held(database, NEW_EMAIL, folded=True),
                await read(database, client),
                journal,
            )

        record, held, seen, journal = on_a_person(mongo_replica_set_url, body)

        assert record["ended"]["art"] == "stopped"
        # Only the row of the link mail the league sent, which keeps its recipient until its retention ends.
        assert held == {NEW_EMAIL: ["outbox"]}
        assert seen.offen is None
        assert [line.art for line in journal] == ["adresswechsel_gestoppt"]

    def test_with_nothing_pending_the_account_page_answers_not_found(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentNotFoundError) as missed:
                await stop_here(database, client)
            return missed.value.status_code

        assert on_a_person(mongo_replica_set_url, body) == 404


class TestAGrantHoldersOwnPressAsksAPasskey:
    """The person's lane admits a sign-in by code, which a change handing a grant over must not be enough for."""

    def test_a_start_by_code_is_refused_where_the_address_holds_a_grant_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            with pytest.raises(APIError):
                await start(database, client, actor=person_actor(factor=None))
            return await database[Collection.ADRESSWECHSEL].count_documents({})

        assert on_a_person(mongo_replica_set_url, body) == 0

    def test_a_start_by_code_goes_where_the_address_holds_no_grant(self, mongo_replica_set_url: str):
        """The control: the code reached the address on file, the confirmation OWASP's process asks of it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await start(database, client, actor=person_actor(factor=None))

        assert on_a_person(mongo_replica_set_url, body).token is not None

    def test_the_address_on_files_approval_by_code_is_refused_where_it_holds_a_grant(self, mongo_replica_set_url: str):
        """Its press lets the link go that hands the grant over at the effect."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            started = await administrator_starts(database, client, grund=None, operator=OWNER)
            with pytest.raises(APIError):
                await approve_as_the_address(database, client, started.id, actor=person_actor(factor=None))
            approved = await approve_as_the_address(database, client, started.id)
            return approved.token is not None

        assert on_a_person(mongo_replica_set_url, body) is True


class TestTheAddressOnFilesApproval:
    def test_without_a_reason_nothing_reaches_the_new_mailbox_before_the_address_on_file_approves(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=None)
            before = await change(database, started.id)
            approved = await approve_as_the_address(database, client, started.id)
            return started, before, approved, await change(database, started.id)

        started, before, approved, after = on_a_person(mongo_replica_set_url, body)

        assert (started.way, started.token, before["token_hashes"]) == ("release", None, [])
        assert (approved.id, approved.email) == (started.id, NEW_EMAIL)
        assert (after["token_hashes"], after["released_at"] is not None) == ([hash_token(approved.token)], True)
        assert after["stop"] == before["stop"]

    def test_past_its_deadline_it_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=None)
            return await refused_code(approve_as_the_address(database, client, started.id, germany_now=AFTER_THE_DEADLINE))

        assert on_a_person(mongo_replica_set_url, body) == Code.LINK_EXPIRED

    def test_a_tab_showing_a_change_since_replaced_approves_nothing(self, mongo_replica_set_url: str):
        """The page read one request; a second start replaced it before the press, whose new address the page never showed."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            shown = await administrator_starts(database, client, grund=None)
            later = await administrator_starts(database, client, grund=None, email=FOREIGN_EMAIL)
            stale = await refused_code(approve_as_the_address(database, client, shown.id))
            return stale, await change(database, later.id)

        stale, later = on_a_person(mongo_replica_set_url, body)

        assert stale == Code.ADDRESS_CHANGE_ENDED
        assert (later["token_hashes"], later["released_at"]) == ([], None)

    def test_another_address_s_change_is_not_found(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            theirs = await administrator_starts(database, client, grund=None, adresse=OTHER_EMAIL)
            with pytest.raises(DocumentNotFoundError):
                await approve_as_the_address(database, client, theirs.id)
            return await change(database, theirs.id)

        assert on_a_person(mongo_replica_set_url, body)["token_hashes"] == []


class TestTheToolsStart:
    def test_with_a_reason_it_mints_the_new_mailbox_its_link_and_refuses_a_new_address_holding_entries(self, mongo_replica_set_url: str):
        """Its reader trusted, the tool refuses at its start what the confirmation would, and the change it would replace stands."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            plain = await administrator_starts(database, client, grund=GRUND)
            await granted(database, FOREIGN_EMAIL)
            refused = await refused_code(administrator_starts(database, client, grund=GRUND, email=FOREIGN_EMAIL))
            return plain, refused, await change(database, plain.id)

        plain, refused, record = on_a_person(mongo_replica_set_url, body)

        assert (plain.way, plain.token is not None) == ("waiting_period", True)
        assert (refused, record["ended"], record["grund"]) == (Code.ADDRESS_CHANGE_OCCUPIED, None, GRUND)

    def test_the_notice_names_the_person_only_where_the_address_on_file_is_asked_first(self, mongo_replica_set_url: str):
        """On the lost-mailbox way the address on file may be a stranger's by now, so its notice is given no name to greet."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await administrator_starts(database, client, grund=None)
            await administrator_starts(database, client, grund=GRUND)
            rows = database[Collection.POSTAUSGANG].find({"art": "address_change_hinweis"}, sort=[("recorded_at", 1), ("_id", 1)])
            return [(row["data"]["way"], row["data"]["vorname"]) async for row in rows]

        assert on_a_person(mongo_replica_set_url, body) == [("release", "Lenore"), ("waiting_period", None)]

    @staticmethod
    def refused_start(url: str, setup: str = "", **payload: Any) -> tuple[str, int]:
        """The tool's refusal, and that it wrote no change."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if setup == "ban":
                await ban_through_the_route(database, client, email=NEW_EMAIL, grund="Falschangaben", von=ADMIN, today=TODAY)
            if setup == "grant":
                await granted(database)
            refused = await refused_code(administrator_starts(database, client, **{"grund": GRUND, **payload}))
            return refused, await database[Collection.ADRESSWECHSEL].count_documents({})

        return on_a_person(url, body)

    def test_a_barred_new_address_is_refused(self, mongo_replica_set_url: str):
        assert self.refused_start(mongo_replica_set_url, "ban") == (Code.ADDRESS_CHANGE_BARRED, 0)

    def test_another_pupil_s_address_is_refused(self, mongo_replica_set_url: str):
        assert self.refused_start(mongo_replica_set_url, email=OTHER_EMAIL) == (Code.ADDRESS_CHANGE_TAKEN, 0)

    def test_the_address_on_file_respelled_is_refused(self, mongo_replica_set_url: str):
        assert self.refused_start(mongo_replica_set_url, email=TYPED) == (Code.ADDRESS_CHANGE_UNCHANGED, 0)

    def test_an_address_holding_nothing_is_refused(self, mongo_replica_set_url: str):
        assert self.refused_start(mongo_replica_set_url, adresse="nobody@schule.example") == (Code.ADDRESS_CHANGE_NOTHING, 0)

    def test_the_administrator_s_own_address_is_refused(self, mongo_replica_set_url: str):
        assert self.refused_start(mongo_replica_set_url, adresse=ADMIN) == (Code.OWN_ADRESSE, 0)

    def test_a_grant_holder_s_address_is_refused_without_an_owner_s_power(self, mongo_replica_set_url: str):
        assert self.refused_start(mongo_replica_set_url, "grant") == (Code.VERWALTUNG_ADRESSE, 0)

    def test_an_owner_starts_a_grant_holder_s_change_which_another_administrator_approves(self, mongo_replica_set_url: str):
        """Four eyes on the tool: the owner who started it is no approver, so the change names the others alone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            started = await administrator_starts(database, client, grund=GRUND, operator=OWNER)
            refused = await refused_code(approve(database, client, started.id, operator=OWNER))
            return refused, await change(database, started.id)

        refused, record = on_a_person(mongo_replica_set_url, body)

        assert record["approval"]["started_by"] == OWNER
        assert refused == Code.ADDRESS_CHANGE_APPROVAL_DENIED


class TestTheTool:
    def test_it_reads_the_address_by_kind_and_its_change_whole(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=GRUND)
            return started, await tool_read(database, client, adresse=TYPED), await tool_read(database, client, address_change_id=started.id)

        started, by_address, by_id = on_a_person(mongo_replica_set_url, body)

        assert by_address.model_dump() == by_id.model_dump()
        assert by_address.holdings.model_dump() == {
            "spieler": 1,
            "schiedsrichter": 1,
            "seats": 1,
            "bewerbung_seats": 2,
            "registrierungen": 2,
            "grant": None,
        }
        assert by_address.offen is not None
        assert (by_address.offen.id, by_address.offen.email, by_address.offen.grund) == (started.id, NEW_EMAIL, GRUND)

    def test_an_ended_change_s_id_is_refused_and_an_unknown_one_not_found(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=GRUND)
            await discard(database, client, started.id)
            ended = await refused_code(tool_read(database, client, address_change_id=started.id))
            with pytest.raises(DocumentNotFoundError):
                await tool_read(database, client, address_change_id=ObjectId())
            return ended, await refused_code(discard(database, client, started.id)), await refused_code(resend(database, client, started.id))

        assert on_a_person(mongo_replica_set_url, body) == (Code.ADDRESS_CHANGE_ENDED,) * 3

    def test_the_re_send_replaces_the_link_and_keeps_the_stop_link(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=GRUND)
            before = await change(database, started.id)
            sent = await resend(database, client, started.id, germany_now=NOW + timedelta(hours=2))
            return started, before, sent, await change(database, started.id), await refused_code(view(database, client, started.token))

        started, before, sent, after, old = on_a_person(mongo_replica_set_url, body)

        assert (sent.stopp_token, after["token_hashes"], after["stop"]) == (None, [hash_token(sent.token)], before["stop"])
        assert after["valid_until"] > before["valid_until"]
        # The replaced link opens nothing: its hash is gone from the record.
        assert old == Code.LINK_INVALID

    def test_a_change_not_waiting_on_the_new_mailbox_is_sent_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=None)
            with pytest.raises(DocumentNotFoundError):
                await resend(database, client, started.id)
            return "not found"

        assert on_a_person(mongo_replica_set_url, body) == "not found"

    def test_a_confirmed_change_is_sent_no_fresh_link(self, mongo_replica_set_url: str):
        """A deadline set again on a change waiting out its time would make the pass end it lapsed rather than let it take effect."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=GRUND)
            await answer(database, client, started.token)
            with pytest.raises(DocumentNotFoundError):
                await resend(database, client, started.id)
            return (await change(database, started.id))["valid_until"]

        assert on_a_person(mongo_replica_set_url, body) is None

    @pytest.mark.parametrize("route", ["read-by-address", "read-by-id", "re-send", "discard"])
    @pytest.mark.parametrize(("whose", "refused"), [("own", Code.OWN_ADRESSE), ("grant-holder", Code.VERWALTUNG_ADRESSE)])
    def test_who_asks_is_refused_on_every_route_the_start_refuses_it(self, mongo_replica_set_url: str, route: str, whose: str, refused: str):
        """An administrator's own address, and a grant holder's for anyone without an owner's power: each route its own read."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            adresse = ADMIN if whose == "own" else EMAIL
            if whose == "grant-holder":
                await granted(database)
            # An owner may start either; the suite's first administrator then asks.
            started = await administrator_starts(database, client, grund=GRUND, adresse=adresse, operator=OWNER)
            before = await change(database, started.id)
            asked = {
                "read-by-address": lambda: tool_read(database, client, adresse=adresse),
                "read-by-id": lambda: tool_read(database, client, address_change_id=started.id),
                "re-send": lambda: resend(database, client, started.id),
                "discard": lambda: discard(database, client, started.id),
            }[route]
            return await refused_code(asked()), before == await change(database, started.id)

        assert on_a_person(mongo_replica_set_url, body) == (refused, True)

    def test_the_discard_acts_on_the_change_its_id_names_alone(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """A page showing a change since replaced discards nothing: key the discard on the address and the later change goes."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await administrator_starts(database, client, grund=GRUND)
            later = await start(database, client)
            stale = await refused_code(discard(database, client, first.id))
            with journal_of(caplog) as journal:
                await discard(database, client, later.id)
            return stale, later.id, await change(database, later.id), await where_held(database, NEW_EMAIL, folded=True), journal

        stale, later, record, held, journal = on_a_person(mongo_replica_set_url, body)

        assert (stale, record["ended"]["art"]) == (Code.ADDRESS_CHANGE_ENDED, "discarded")
        # Only the row of the link mail the league sent, which keeps its recipient until its retention ends.
        assert held == {NEW_EMAIL: ["outbox"]}
        assert [(line.art, line.record_id) for line in journal] == [("adresswechsel_verworfen", later)]


class TestTheApproval:
    def test_an_approval_finding_nothing_left_to_move_ends_it_tells_its_new_mailbox_and_says_so(self, mongo_replica_set_url: str):
        """The new mailbox confirmed and was told the change waits on this approval; the approver is told it ended for want of records."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            await answer(database, client, minted.token)
            # The address's last records and its grant gone since, by routes no change hears of.
            for collection in (Collection.SPIELER, Collection.SCHIEDSRICHTER, Collection.SAISON_TEAMS, Collection.BEWERBUNGEN):
                await database[collection].delete_many({})
            await database[Collection.REGISTRIERUNGEN].delete_many({})
            await database[Collection.BERECHTIGUNGEN].delete_one({"adresse": EMAIL})
            code = await refused_code(approve(database, client, minted.id, operator=ADMIN))
            return code, (await change(database, minted.id))["ended"]["art"], await owed(database)

        code, art, notices = on_a_person(mongo_replica_set_url, body)

        assert (code, art) == (Code.ADDRESS_CHANGE_NOTHING, "discarded")
        assert [(notice["art"], notice["an"]) for notice in notices] == [("discarded", NEW_EMAIL)]

    def test_an_approval_before_the_confirmation_lets_the_confirmation_take_effect(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            approved = await approve(database, client, minted.id)
            answered = await answer(database, client, minted.token)
            return approved, answered

        approved, answered = on_a_person(mongo_replica_set_url, body)

        assert approved.effective is False
        assert answered.effective

    def test_a_confirmation_before_the_approval_waits_and_the_approval_takes_effect(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            answered = await answer(database, client, minted.token)
            seen, waiting = await read(database, client), await everything(database)
            approved = await approve(database, client, minted.id)
            return answered, seen, waiting, approved, await everything(database)

        answered, seen, waiting, approved, after = on_a_person(mongo_replica_set_url, body)

        assert (answered.effective, answered.approval_open) == (False, True)
        assert seen.offen is not None and (seen.offen.waits_on, seen.offen.approval.approved) == ("approval", False)
        assert waiting["pupil"]["email"] == EMAIL
        assert approved.effective
        assert after["pupil"]["email"] == NEW_EMAIL

    @staticmethod
    def refused_approval(url: str, *, approver: str, verwaltung: str) -> tuple[str, Any]:
        """The approval's refusal, and the approval the change still waits on."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database, verwaltung=verwaltung)
            if verwaltung == "owner":
                await database[Collection.BERECHTIGUNGEN].update_one({"adresse": SECOND_ADMIN}, {"$set": {"verwaltung": "owner"}})
            minted = await start(database, client)
            refused = await refused_code(approve(database, client, minted.id, operator=approver))
            return refused, (await change(database, minted.id))["approval"]["approved_at"]

        return on_a_person(url, body)

    def test_the_changed_address_approves_nothing_of_its_own(self, mongo_replica_set_url: str):
        assert self.refused_approval(mongo_replica_set_url, approver=EMAIL, verwaltung="administration") == (
            Code.ADDRESS_CHANGE_APPROVAL_DENIED,
            None,
        )

    def test_the_administrator_who_started_it_approves_nothing_of_their_own(self, mongo_replica_set_url: str):
        """A grant holder's address is the tool's to change for an owner alone, so the starter here is one."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            started = await administrator_starts(database, client, grund=GRUND, operator=OWNER)
            refused = await refused_code(approve(database, client, started.id, operator=OWNER))
            return refused, (await change(database, started.id))["approval"]["approved_at"]

        assert on_a_person(mongo_replica_set_url, body) == (Code.ADDRESS_CHANGE_APPROVAL_DENIED, None)

    def test_the_grants_list_names_the_waiting_change_on_its_row_with_why_its_reader_may_not_approve_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            lists = [await call(get_grants, database, client, operator=EMAIL), await call(get_grants, database, client)]
            await answer(database, client, minted.token)
            lists.append(await call(get_grants, database, client))
            return minted.id, [{row.adresse: row.adresswechsel for row in listed.berechtigungen} for listed in lists]

        minted, (own, others, confirmed) = on_a_person(mongo_replica_set_url, body)

        assert own[EMAIL] is not None and own[EMAIL].denied == "own"
        assert others[EMAIL] is not None
        assert (others[EMAIL].id, others[EMAIL].email, others[EMAIL].confirmed, others[EMAIL].denied) == (minted, NEW_EMAIL, False, None)
        # The person's own start: its starter is the row's own address, and no reason is asked of it.
        assert (others[EMAIL].way, others[EMAIL].started_by, others[EMAIL].grund) == ("account", None, None)
        assert confirmed[EMAIL] is not None and confirmed[EMAIL].confirmed
        # Every other row names no change, its grant's address having none waiting.
        assert {adresse: change for adresse, change in others.items() if adresse != EMAIL} == dict.fromkeys(set(others) - {EMAIL})

    def test_the_grants_list_names_who_started_a_change_how_and_why(self, mongo_replica_set_url: str):
        """What a pretext hides: an administrator's start for a lost mailbox, beside the reason they recorded."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            await administrator_starts(database, client, grund=GRUND, operator=OWNER)
            listed = await call(get_grants, database, client, operator=SECOND_ADMIN)
            return {row.adresse: row.adresswechsel for row in listed.berechtigungen}[EMAIL]

        row = on_a_person(mongo_replica_set_url, body)

        assert row is not None
        assert (row.email, row.way, row.started_by, row.started_by_barred, row.grund) == (NEW_EMAIL, "waiting_period", OWNER, False, GRUND)

    def test_an_owner_s_change_tells_a_non_owner_none_of_its_address_starter_or_reason(self, mongo_replica_set_url: str):
        """The address tool refuses them an owner's address (`verwaltung_adresse`), so the approval row may not serve it either."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database, verwaltung="owner")
            # A second owner beside the starter, so an owner's change has an approver.
            await database[Collection.BERECHTIGUNGEN].update_one({"adresse": SECOND_ADMIN}, {"$set": {"verwaltung": "owner"}})
            await administrator_starts(database, client, grund=GRUND, operator=OWNER)
            rows = []
            for reader in (ADMIN, SECOND_ADMIN):
                listed = await call(get_grants, database, client, operator=reader)
                rows.append({row.adresse: row.adresswechsel for row in listed.berechtigungen}[EMAIL])
            return rows

        non_owner, owner = on_a_person(mongo_replica_set_url, body)

        assert non_owner is not None and owner is not None
        assert (non_owner.denied, non_owner.email, non_owner.started_by, non_owner.grund) == ("owner", None, None, None)
        assert (owner.email, owner.started_by, owner.grund) == (NEW_EMAIL, OWNER, GRUND)

    def test_a_barred_new_address_and_a_barred_starter_are_withheld(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            await administrator_starts(database, client, grund=GRUND, operator=OWNER)
            await database[Collection.SPERRLISTE].insert_many(
                [documents.ban_document(address, bis=SAISON_ID) for address in (NEW_EMAIL, OWNER)]
            )
            listed = await call(get_grants, database, client, operator=SECOND_ADMIN)
            return {row.id: row.adresswechsel for row in listed.berechtigungen if row.barred is False and row.adresse == EMAIL}

        (row,) = on_a_person(mongo_replica_set_url, body).values()

        assert row is not None
        assert (row.email, row.email_barred, row.started_by, row.started_by_barred) == (None, True, None, True)

    def test_a_barred_grant_s_row_carries_no_waiting_change(self, mongo_replica_set_url: str):
        """Its own address is withheld, so its change, which names the new one and offers the approval, is too."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            await start(database, client)
            await database[Collection.SPERRLISTE].insert_one(documents.ban_document(EMAIL, bis=SAISON_ID))
            listed = await call(get_grants, database, client, operator=SECOND_ADMIN)
            return [(row.adresse, row.adresswechsel) for row in listed.berechtigungen if row.barred]

        assert on_a_person(mongo_replica_set_url, body) == [(None, None)]

    def test_a_change_past_its_approval_week_is_offered_to_nobody(self, mongo_replica_set_url: str):
        """Its approval is refused then (`link_expired`), and a reload the refusal asks for must not offer it again."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            await answer(database, client, minted.token)
            listed = await call(get_grants, database, client, operator=SECOND_ADMIN, now=AFTER_THE_WEEK)
            return {row.adresse: row.adresswechsel for row in listed.berechtigungen}[EMAIL]

        assert on_a_person(mongo_replica_set_url, body) is None

    def test_a_change_whose_link_lapsed_unconfirmed_is_offered_to_nobody(self, mongo_replica_set_url: str):
        """Refused `link_expired` as a lapsed week is, so the reload that refusal asks for must not offer it again."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            refused = await refused_code(approve(database, client, minted.id, operator=SECOND_ADMIN, germany_now=AFTER_THE_DEADLINE))
            listed = await call(get_grants, database, client, operator=SECOND_ADMIN, now=AFTER_THE_DEADLINE)
            return refused, {row.adresse: row.adresswechsel for row in listed.berechtigungen}[EMAIL]

        assert on_a_person(mongo_replica_set_url, body) == (Code.LINK_EXPIRED, None)

    def test_an_owner_s_grant_is_approved_by_no_administrator(self, mongo_replica_set_url: str):
        assert self.refused_approval(mongo_replica_set_url, approver=ADMIN, verwaltung="owner") == (
            Code.ADDRESS_CHANGE_APPROVAL_OWNER,
            None,
        )

    def test_a_change_asking_no_approval_or_given_one_takes_none(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            plain = await start(database, client, identifier=OTHER_EMAIL)
            await granted(database)
            asked = await start(database, client)
            await approve(database, client, asked.id)
            return await refused_code(approve(database, client, plain.id)), await refused_code(
                approve(database, client, asked.id, operator=SECOND_ADMIN)
            )

        assert on_a_person(mongo_replica_set_url, body) == (Code.ADDRESS_CHANGE_NO_APPROVAL_OPEN,) * 2

    def test_unapproved_a_week_after_its_start_it_is_refused_and_the_pass_ends_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            await answer(database, client, minted.token)
            refused = await refused_code(approve(database, client, minted.id, germany_now=AFTER_THE_WEEK))
            swept = await sweep(database, client, germany_now=AFTER_THE_WEEK)
            return refused, swept.removed, await change(database, minted.id), await owed(database)

        refused, entfernt, record, notices = on_a_person(mongo_replica_set_url, body)

        assert (refused, entfernt, record["ended"]["art"]) == (Code.LINK_EXPIRED, 1, "expired")
        # The new mailbox was told the change waits on the administration, so it is told it did not take effect.
        assert notices == [{"art": "discarded", "an": NEW_EMAIL}]

    def test_a_link_lapsing_unconfirmed_queues_nothing(self, mongo_replica_set_url: str):
        """Nobody confirmed it, so nobody waits to hear of it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await start(database, client)
            swept = await sweep(database, client, germany_now=AFTER_THE_DEADLINE)
            return swept.removed, await owed(database)

        assert on_a_person(mongo_replica_set_url, body) == (1, [])

    def test_a_confirmed_change_with_a_waiting_time_unapproved_a_week_after_its_start_lapses_at_the_pass(self, mongo_replica_set_url: str):
        """Its waiting time ends after its approval's week, so the pass meets it lapsed, never due."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            started = await administrator_starts(database, client, grund=GRUND, operator=OWNER)
            await answer(database, client, started.token)
            swept = await sweep(database, client, germany_now=AFTER_THE_WEEK)
            return swept, await change(database, started.id)

        swept, record = on_a_person(mongo_replica_set_url, body)

        assert (swept.removed, swept.discarded, swept.effective, swept.remaining) == (1, 0, 0, 0)
        assert (record["ended"]["art"], record["email"], record["grund"]) == ("expired", None, None)


class TestTheContactsEditorsRead:
    def test_each_confirmed_seat_names_its_address_s_live_change_and_none_once_it_ended(self, mongo_replica_set_url: str):
        """The confirmed Ansprechperson holds the changed address and names its change.

        The Stellvertretung holds it too but never confirmed, so the change moves nothing of it and names it nothing.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def seats() -> Any:
                read = await call(get_team_saisons, database, client, today=TODAY)
                [row] = [row for team in read.teams for row in team.memberships if row.saison_id == SAISON_ID and team.id == TEAM_OID]
                return row.adresswechsel

            minted = await start(database, client)
            live = await seats()
            await stop_here(database, client)
            return minted.id, live, await seats()

        minted, live, ended = on_a_person(mongo_replica_set_url, body)

        assert live is not None and (live.trainer, live.ansprechperson, live.stellvertretung) == (None, minted, None)
        assert ended is not None and (ended.trainer, ended.ansprechperson, ended.stellvertretung) == (None, None, None)


class TestEveryLinkIntoTheToolSaysWhetherItOpens:
    """A page links a change's id into the address tool; a link the tool refuses its reader is a dead end, worded by why."""

    @pytest.mark.parametrize(
        ("reader", "grant"),
        [
            pytest.param(EMAIL, True, id="a grant holder's own change, read by them: the tool refuses -003"),
            pytest.param(ADMIN, True, id="a grant holder's change, read by an administrator: the tool refuses -005"),
            pytest.param(OWNER, True, id="a grant holder's change, read by an owner: the tool opens it"),
            pytest.param(ADMIN, False, id="a change holding no grant, read by an administrator: the tool opens it"),
        ],
    )
    def test_each_read_serving_a_change_s_id_serves_the_tool_s_own_verdict(self, mongo_replica_set_url: str, reader: str, grant: bool):
        """The pupils list, the referee editor, the contacts editor, the erasure's reveal and, for a grant, the approval row."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if grant:
                await granted(database)
            minted = await start(database, client)
            try:
                await tool_read(database, client, address_change_id=minted.id, operator=reader)
                verwehrt = None
            except APIError as refused:
                verwehrt = {Code.OWN_ADRESSE: "own", Code.VERWALTUNG_ADRESSE: "verwaltung"}[refused.error_code]

            pupils = await call(get_spieler_saisons, database, client, operator=reader)
            referee = await call(get_schiedsrichter_by_id, database, client, schiedsrichter_id=REFEREE_OID, today=TODAY, operator=reader)
            teams = await call(get_team_saisons, database, client, today=TODAY, operator=reader)
            [seats] = [
                row.adresswechsel for team in teams.teams for row in team.memberships if row.saison_id == SAISON_ID and team.id == TEAM_OID
            ]
            reveal = await call(get_erasure_view, database, client, ansicht_data=FLErasureAdressePayload(email=NEW_EMAIL), operator=reader)
            served = {
                "pupils": [
                    (player.address_change_id, player.address_change_viewable_denied) for player in pupils.spieler if player.id == SPIELER_OID
                ],
                "referee": (referee.address_change_id, referee.address_change_viewable_denied),
                "seats": (seats.ansprechperson, seats.viewable_denied.model_dump()),
                "reveal": [(row.address_change_id, row.viewable_denied) for row in reveal.adresswechsel],
            }
            if grant:
                listed = await call(get_grants, database, client, operator=reader)
                waiting = {row.adresse: row.adresswechsel for row in listed.berechtigungen}[EMAIL]
                served["approval"] = None if waiting is None else (waiting.id, waiting.viewable_denied)
            return minted.id, verwehrt, served

        minted, verwehrt, served = on_a_person(mongo_replica_set_url, body)

        assert verwehrt == {EMAIL: "own", ADMIN: "verwaltung" if grant else None, OWNER: None}[reader]
        expected = {
            "pupils": [(minted, verwehrt)],
            "referee": (minted, verwehrt),
            # The Trainer and the Stellvertretung wait on no change of the person's; the Stellvertretung is unconfirmed.
            "seats": (minted, {"trainer": None, "ansprechperson": verwehrt, "stellvertretung": None}),
            # Withheld where the tool refuses it as a grant holder's: a typed address would learn it is that change's new one.
            "reveal": [] if verwehrt == "verwaltung" else [(minted, verwehrt)],
        }
        if grant:
            expected["approval"] = (minted, verwehrt)
        assert served == expected


class TestAGrantEndedBeforeTheApproval:
    """The approval a confirmation left owed is owed only while the address holds the grant it would move."""

    def test_the_pass_makes_the_change_take_effect_once_the_grant_is_gone(self, mongo_replica_set_url: str):
        """Revoked after the confirmation: nobody is offered the approval, and the change took effect regardless."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            grant = await granted(database)
            minted = await start(database, client)
            confirmed = await answer(database, client, minted.token)
            # Any route ending the grant, a revoke's, a tier change's or an erasure's, leaves no row at the address.
            await database[Collection.BERECHTIGUNGEN].delete_one({"_id": grant})
            listed = await call(get_grants, database, client, operator=SECOND_ADMIN)
            swept = await sweep(database, client, germany_now=NOW + timedelta(hours=1))
            offered = [row.adresswechsel for row in listed.berechtigungen if row.adresswechsel is not None]
            return (
                confirmed.approval_open,
                offered,
                swept,
                await change(database, minted.id),
                await owed(database),
                await everything(database),
            )

        offen, offered, swept, record, notices, after = on_a_person(mongo_replica_set_url, body)

        assert (offen, offered) == (True, [])
        assert (swept.effective, swept.remaining) == (1, 0)
        assert record["ended"]["art"] == "effective"
        assert [(notice["art"], notice["an"]) for notice in notices] == [("effective", EMAIL)]
        assert after["pupil"]["email"] == NEW_EMAIL

    def test_a_change_whose_grant_stands_waits_and_is_no_remainder(self, mongo_replica_set_url: str):
        """Parked on the approval: the pass leaves it standing and counts it neither as an effect nor as left behind."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            await answer(database, client, minted.token)
            swept = await sweep(database, client, germany_now=NOW + timedelta(hours=1))
            return swept, await change(database, minted.id), await owed(database)

        swept, record, notices = on_a_person(mongo_replica_set_url, body)

        assert (swept.effective, swept.discarded, swept.removed, swept.remaining) == (0, 0, 0, 0)
        assert (record["ended"], notices) == (None, [])


class TestTheMovedGrant:
    def test_the_effect_revokes_the_grant_at_the_old_address_and_grants_it_at_the_new_under_the_approver(self, mongo_replica_set_url: str):
        """Announced as a revoke and a grant are, and dating from the move: no session older than it administers."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            old_grant = await granted(database)
            minted = await start(database, client)
            await approve(database, client, minted.id, operator=SECOND_ADMIN)
            await answer(database, client, minted.token)
            grants = {row["adresse"]: row async for row in database[Collection.BERECHTIGUNGEN].find({"adresse": {"$in": [EMAIL, NEW_EMAIL]}})}
            outbox = [
                row["data"] async for row in database[Collection.POSTAUSGANG].find({"art": "grant", "an": SECOND_ADMIN}, sort=[("_id", 1)])
            ]
            since = await live_unbarred_grant_since(
                NEW_EMAIL, berechtigungen_collection=database[Collection.BERECHTIGUNGEN], sperrliste=ban_list(database)
            )
            return old_grant, grants, outbox, since

        old_grant, grants, outbox, since = on_a_person(mongo_replica_set_url, body)

        assert list(grants) == [NEW_EMAIL]
        moved = grants[NEW_EMAIL]
        assert (moved["verwaltung"], moved["granted_by"], moved["_id"] != old_grant) == ("administration", SECOND_ADMIN, True)
        # Each notice as the approver is owed it: the paste no comparison has seen yet first, as a revoke announces one.
        assert [(row["change"], (row["now"] or row["before"] or {}).get("adresse"), row["changed_by"]) for row in outbox] == [
            ("granted", EMAIL, None),
            ("revoked", EMAIL, SECOND_ADMIN),
            ("granted", NEW_EMAIL, SECOND_ADMIN),
        ]
        assert since == NOW.astimezone(UTC)
        assert not signed_in_since(int(NOW.timestamp()) - 1, since)

    def test_no_effect_leaves_a_grant_at_the_replaced_address(self, mongo_replica_set_url: str):
        """A grant made after the start was never approved to move: the effect is refused rather than leaving it behind."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            await granted(database)
            refused = await refused_code(answer(database, client, minted.token))
            return refused, await everything(database), await database[Collection.BERECHTIGUNGEN].count_documents({"adresse": EMAIL})

        refused, rows, grants = on_a_person(mongo_replica_set_url, body)

        assert (refused, rows["pupil"]["email"], grants) == (Code.ADDRESS_CHANGE_NOT_COVERED, EMAIL, 1)

    def test_a_promotion_since_the_approval_is_not_covered(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            await approve(database, client, minted.id)
            await database[Collection.BERECHTIGUNGEN].update_one({"adresse": EMAIL}, {"$set": {"verwaltung": "owner"}})
            return await refused_code(answer(database, client, minted.token))

        assert on_a_person(mongo_replica_set_url, body) == Code.ADDRESS_CHANGE_NOT_COVERED

    def test_a_grant_at_the_new_address_refuses_the_move(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            await approve(database, client, minted.id)
            await granted(database, NEW_EMAIL)
            return await refused_code(answer(database, client, minted.token))

        assert on_a_person(mongo_replica_set_url, body) == Code.ADDRESS_CHANGE_NEW_GRANTED

    def test_a_grant_only_account_moves_its_grant(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, identifier=SECOND_ADMIN)
            await approve(database, client, minted.id)
            answered = await answer(database, client, minted.token)
            return answered, sorted(await database[Collection.BERECHTIGUNGEN].distinct("adresse"))

        answered, addresses = on_a_person(mongo_replica_set_url, body, records=False)

        assert answered.effective
        assert NEW_EMAIL in addresses and SECOND_ADMIN not in addresses


# Where the suite's owner and its first administrator move to, and an administrator granted after a change was asked.
OWNER_NEW_EMAIL = "inhaberin.neu@anderswo.example.org"
ADMIN_NEW_EMAIL = "verwaltung.neu@anderswo.example.org"
LATE_ADMIN = "spaet.gekommen@anderswo.example.org"
# Where a person moves on to after a first change.
THIRD_EMAIL = "lenore.dritte@nochwoanders.example.org"


async def as_administrator(adresse: str, write: Awaitable[Any]) -> Any:
    """`write` recorded under this administrator, as their request's binder records it."""

    token = actor_var.set(Actor(kind="admin_session", email=adresse))
    try:
        return await write
    finally:
        actor_var.reset(token)


async def granted_later(database: AsyncDatabase, adresse: str, *, at: Any) -> None:
    """A grant taking effect at `at`, after the requests a case started before it.

    Its id minted on the real clock, a century before `at`, which an id cannot spell: a grant dates from the later of the two.
    """

    await database[Collection.BERECHTIGUNGEN].insert_one({**grants_for_the_suite()[1], "_id": ObjectId(), "adresse": adresse, "granted_at": at})


# An hour past the suite's clock: a grant an address change makes then is younger than every request the case started.
AN_HOUR_ON = NOW + timedelta(hours=1)


async def moved_on(database: AsyncDatabase, client: AsyncMongoClient, adresse: str, neue: str) -> None:
    """The administrator at `adresse` changes their own address to `neue` an hour on, approved by another and confirmed."""

    own = await start(database, client, identifier=adresse, email=neue, germany_now=AN_HOUR_ON)
    await approve(database, client, own.id, operator=SECOND_ADMIN, germany_now=AN_HOUR_ON)
    await answer(database, client, own.token, germany_now=AN_HOUR_ON)


class TestTheAdministratorFollowsTheirMove:
    """An administrator's identity is their address: an effect carries every record they made, or the rules keyed on it lapse."""

    def test_the_starter_of_a_change_approves_nothing_of_it_after_moving_their_own_address(self, mongo_replica_set_url: str):
        """Each step at one instant, so the approver's grant is no younger than the request and the carried starter alone refuses."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            # A second owner, so the starter's own change has an approver.
            await database[Collection.BERECHTIGUNGEN].update_one({"adresse": SECOND_ADMIN}, {"$set": {"verwaltung": "owner"}})
            theirs = await administrator_starts(database, client, grund=GRUND, operator=OWNER)
            own = await start(database, client, identifier=OWNER, email=OWNER_NEW_EMAIL)
            await approve(database, client, own.id, operator=SECOND_ADMIN)
            await answer(database, client, own.token)
            refused = await refused_code(approve(database, client, theirs.id, operator=OWNER_NEW_EMAIL))
            return refused, await change(database, theirs.id)

        refused, record = on_a_person(mongo_replica_set_url, body, pupil=False, records=False)

        assert (refused, record["approval"]["started_by"], record["approval"]["approved_at"]) == (
            Code.ADDRESS_CHANGE_APPROVAL_DENIED,
            OWNER_NEW_EMAIL,
            None,
        )

    def test_no_record_or_image_keeps_a_moved_administrator_s_replaced_address_past_their_loeschung(self, mongo_replica_set_url: str):
        """A grant they made, its image and log row, their own change's starter and their revoked grant's image named it.

        The queued notice of the old grant's end withholds it too, its stamp naming the new address.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            await database[Collection.BERECHTIGUNGEN].insert_one(
                {**grants_for_the_suite()[1], "_id": ObjectId(), "adresse": FOREIGN_EMAIL, "granted_by": EMAIL}
            )
            await as_administrator(
                EMAIL,
                patch_one_in_db(
                    collection=database[Collection.BERECHTIGUNGEN],
                    db_filter={"adresse": FOREIGN_EMAIL},
                    update={"$set": {"gesehen_am": NOW}},
                    return_document=ReturnDocument.BEFORE,
                ),
            )
            minted = await start(database, client)
            await approve(database, client, minted.id)
            await answer(database, client, minted.token)
            await geloescht(database, client, NEW_EMAIL)
            return await where_held(database, EMAIL, folded=True)

        assert on_a_person(mongo_replica_set_url, body, pupil=False, records=False) == {EMAIL: []}

    def test_a_ban_an_invitation_and_a_decided_application_of_theirs_follow_them_past_their_loeschung(self, mongo_replica_set_url: str):
        """Each record names its author by address alone, so one left at the replaced address outlives the erasure at the new."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            await database[Collection.SPERRLISTE].insert_one(documents.ban_document(FOREIGN_EMAIL, bis="2030", created_by=EMAIL))
            await database[Collection.EINLADUNGEN].insert_one(
                compose_einladung(saison_id=SAISON_ID, team_id=TEAM_OID, token_hashes=["h" * 64], created_by=EMAIL, today=TODAY)
            )
            await database[Collection.BEWERBUNGEN].insert_one(
                documents.bewerbung_document(
                    ObjectId(),
                    SAISON_ID,
                    "declined",
                    kontakte=documents.kontakte_document(),
                    submitted_at="2126-02-01",
                    decision={"made_at": "2126-02-15", "von": EMAIL, "grund": "kein Platz"},
                )
            )
            minted = await start(database, client)
            await approve(database, client, minted.id)
            await answer(database, client, minted.token)
            await geloescht(database, client, NEW_EMAIL)
            return await where_held(database, EMAIL, folded=True)

        # The queued notice of the old grant's end withholds it too, its stamp naming the new address.
        assert on_a_person(mongo_replica_set_url, body, pupil=False, records=False) == {EMAIL: []}

    def test_a_former_administrator_s_records_and_images_name_them_nowhere_past_their_loeschung(self, mongo_replica_set_url: str):
        """Their grant ended before the change: what they made while holding it names them still.

        A grant they made, its image and log row, and their own grant's image; a database revoke queues nothing.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            own = await granted(database)
            await database[Collection.BERECHTIGUNGEN].insert_one(
                {**grants_for_the_suite()[1], "_id": ObjectId(), "adresse": FOREIGN_EMAIL, "granted_by": EMAIL}
            )
            for operator, grant in ((EMAIL, {"adresse": FOREIGN_EMAIL}), (ADMIN, {"_id": own})):
                await as_administrator(
                    operator,
                    patch_one_in_db(
                        collection=database[Collection.BERECHTIGUNGEN],
                        db_filter=grant,
                        update={"$set": {"gesehen_am": NOW}},
                        return_document=ReturnDocument.BEFORE,
                    ),
                )
            await database[Collection.BERECHTIGUNGEN].delete_one({"_id": own})
            await confirmed_and_moved(database, client)
            await geloescht(database, client, NEW_EMAIL)
            return await where_held(database, EMAIL, folded=True)

        # The pupil alone: the seed's other records keep the replaced address on rows no change moves, an unconfirmed seat's.
        assert on_a_person(mongo_replica_set_url, body, records=False) == {EMAIL: []}

    def test_an_approval_whose_approver_lost_their_grant_since_is_taken_off_and_given_again(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            await approve(database, client, minted.id, operator=ADMIN)
            # Revoked in the database, as no route's refusal can reach: the effect judges it again.
            await database[Collection.BERECHTIGUNGEN].delete_one({"adresse": ADMIN})
            answered = await answer(database, client, minted.token)
            waiting = await change(database, minted.id), await everything(database)
            listed = await call(get_grants, database, client, operator=SECOND_ADMIN)
            approved = await approve(database, client, minted.id, operator=SECOND_ADMIN)
            return answered, waiting, listed, approved

        answered, (record, rows), listed, approved = on_a_person(mongo_replica_set_url, body)

        assert (answered.effective, answered.approval_open) == (False, True)
        assert (record["approval"]["approved_at"], record["approval"]["approved_by"], rows["pupil"]["email"]) == (None, None, EMAIL)
        assert {row.adresse: row.adresswechsel for row in listed.berechtigungen}[EMAIL] is not None
        assert approved.effective

    def test_an_approval_whose_approver_changed_their_own_address_since_stands(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            await approve(database, client, minted.id, operator=ADMIN)
            await moved_on(database, client, ADMIN, ADMIN_NEW_EMAIL)
            answered = await answer(database, client, minted.token, germany_now=AN_HOUR_ON)
            return answered, await change(database, minted.id)

        answered, record = on_a_person(mongo_replica_set_url, body)

        assert (answered.effective, record["ended"]["art"]) == (True, "effective")

    def test_an_administrator_who_changed_their_own_address_since_approves(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            await moved_on(database, client, ADMIN, ADMIN_NEW_EMAIL)
            await approve(database, client, minted.id, operator=ADMIN_NEW_EMAIL, germany_now=AN_HOUR_ON)
            return await answer(database, client, minted.token, germany_now=AN_HOUR_ON)

        assert on_a_person(mongo_replica_set_url, body).effective

    def test_an_administrator_granted_after_the_request_approves_nothing_of_it(self, mongo_replica_set_url: str):
        """Else one person grants a second mailbox they hold and approves with it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            later = NOW + timedelta(hours=1)
            await granted_later(database, LATE_ADMIN, at=later)
            refused = await refused_code(approve(database, client, minted.id, operator=LATE_ADMIN, germany_now=later))
            listed = await call(get_grants, database, client, operator=LATE_ADMIN)
            return refused, {row.adresse: row.adresswechsel for row in listed.berechtigungen}[EMAIL]

        refused, row = on_a_person(mongo_replica_set_url, body)

        assert (refused, row is not None and row.denied) == (Code.ADDRESS_CHANGE_APPROVAL_YOUNGER, "younger")

    def test_a_second_change_leaves_the_first_one_s_address_in_no_image_past_the_loeschung(self, mongo_replica_set_url: str):
        """The first change kept its new address in its images, which the second makes the replaced one."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await start(database, client)
            await answer(database, client, first.token)
            second = await start(database, client, identifier=NEW_EMAIL, email=THIRD_EMAIL)
            await answer(database, client, second.token)
            await geloescht(database, client, THIRD_EMAIL)
            return await where_held(database, NEW_EMAIL, folded=True)

        assert on_a_person(mongo_replica_set_url, body) == {NEW_EMAIL: []}


ANTRAG_OID = ObjectId("6890a1b2c3d4e5f6078500a1")
# The day before the suite's clock, inside the request's week.
ANTRAG_GESTELLT = NOW - timedelta(days=1)


async def requested(database: AsyncDatabase, *, adresse: str, started_by: str) -> None:
    """A grant asked for `adresse`, undecided."""

    await database[Collection.BERECHTIGUNGEN_ANTRAEGE].insert_one(
        {
            "_id": ANTRAG_OID,
            **compose_antrag(adresse=adresse, verwaltung="administration", grant_id=None, started_by=started_by, now=ANTRAG_GESTELLT),
        }
    )


class TestTheRequestsForAGrantAnEffectMeets:
    """A request holds addresses, no identifier surviving a move: the effect carries its requester and ends one about the person."""

    def test_a_request_the_person_made_follows_them_past_their_loeschung(self, mongo_replica_set_url: str):
        """Left on the replaced address, the request outlives the erasure at the new one, which finds who asked by equality."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            await requested(database, adresse=FOREIGN_EMAIL, started_by=EMAIL)
            minted = await start(database, client)
            await approve(database, client, minted.id)
            await answer(database, client, minted.token)
            carried = await row(database, Collection.BERECHTIGUNGEN_ANTRAEGE, ANTRAG_OID)
            await geloescht(database, client, NEW_EMAIL)
            left = await database[Collection.BERECHTIGUNGEN_ANTRAEGE].count_documents({})
            return carried["approval"]["started_by"], left, await where_held(database, EMAIL, folded=True)

        # The queued notice of the old grant's end withholds it too, its stamp naming the new address.
        assert on_a_person(mongo_replica_set_url, body, pupil=False, records=False) == (NEW_EMAIL, 0, {EMAIL: []})

    def test_a_request_about_the_replaced_address_ends_as_a_refusal_ends_it(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """Approved, it would grant an address nobody holds; its end's own journal line keeps a restore from bringing it back."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await requested(database, adresse=EMAIL, started_by=ADMIN)
            minted = await start(database, client)
            with journal_of(caplog) as journal:
                await answer(database, client, minted.token)
            return minted.id, await database[Collection.BERECHTIGUNGEN_ANTRAEGE].find_one({"_id": ANTRAG_OID}), journal

        change_id, antrag, journal = on_a_person(mongo_replica_set_url, body)

        assert antrag is None
        assert [(line.art, line.record_id) for line in journal] == [("antrag_beendet", ANTRAG_OID), ("adresswechsel_wirksam", change_id)]
        # Keyed as a refusal's line is, by the address the request was about.
        assert journal[0].person_hash == loeschung_journal_hash(EMAIL, key=KEY)

    def test_a_decided_request_about_the_person_keeps_no_replaced_address_past_their_loeschung(self, mongo_replica_set_url: str):
        """Its row is gone, so only its kept image names them, which the erasure at the new address reaches by address alone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await requested(database, adresse=EMAIL, started_by=ADMIN)
            # Refused before the change, through its route, which keeps its image.
            await call(delete_approval_request, database, client, approval_request_id=ANTRAG_OID, operator=SECOND_ADMIN)
            await confirmed_and_moved(database, client)
            await geloescht(database, client, NEW_EMAIL)
            return await where_held(database, EMAIL, folded=True)

        # The pupil alone: the seed's other records keep the replaced address on rows no change moves, an unconfirmed seat's.
        # The refusal's notice to its requester withholds it too, its stamp naming the new address.
        assert on_a_person(mongo_replica_set_url, body, records=False) == {EMAIL: []}

    @pytest.mark.parametrize("request_", ["none", "refused before the change", "ended by the change", "moved on again"])
    def test_an_loeschung_at_the_new_address_withholds_the_replaced_one_in_every_queued_notice(self, mongo_replica_set_url: str, request_: str):
        """The grant's announcement, the move's revoke and a request's end name the old address.

        A second move carries their stamp on to the address erased.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            if request_ != "none":
                await requested(database, adresse=EMAIL, started_by=ADMIN)
            if request_ == "refused before the change":
                await call(delete_approval_request, database, client, approval_request_id=ANTRAG_OID, operator=SECOND_ADMIN)
            minted = await start(database, client)
            await approve(database, client, minted.id, operator=SECOND_ADMIN)
            await answer(database, client, minted.token)
            geloescht_at = NEW_EMAIL
            if request_ == "moved on again":
                onward = await start(database, client, identifier=NEW_EMAIL, email=THIRD_EMAIL)
                await approve(database, client, onward.id, operator=SECOND_ADMIN)
                await answer(database, client, onward.token)
                geloescht_at = THIRD_EMAIL
            naming = [row["art"] async for row in database[Collection.POSTAUSGANG].find({}) if EMAIL in str(row)]
            await geloescht(database, client, geloescht_at)
            return naming, await where_held(database, EMAIL, folded=True)

        naming, held = on_a_person(mongo_replica_set_url, body, records=False)

        assert naming, "no queued notice named the replaced address, so the withholding below holds of nothing"
        assert held == {EMAIL: []}


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
            return confirmed, discarded, (await change(database, minted.id))["ended"]["art"], (await everything(database))["pupil"]["email"]

        confirmed, discarded, art, address = on_a_person(mongo_replica_set_url, body)

        if confirmed is None:
            assert (discarded, art, address) == (Code.ADDRESS_CHANGE_ENDED, "effective", NEW_EMAIL)
        else:
            assert (confirmed, discarded, art, address) == (Code.ADDRESS_CHANGE_ENDED, None, "discarded", EMAIL)


class TestTheDecline:
    @pytest.mark.parametrize("why", ["lapsed", "barred"])
    def test_a_link_its_press_would_refuse_still_declines_and_leaves_its_address_nowhere(self, mongo_replica_set_url: str, why: str):
        """Its holder says the change is not theirs; a link refusing that would keep a stranger's address stored."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            given: dict[str, Any] = {}
            if why == "lapsed":
                given["germany_now"] = AFTER_THE_DEADLINE
            else:
                await ban_through_the_route(
                    database, client, email=NEW_EMAIL, grund="Falschangaben", von="admin@frankfurtleague.de", today=TODAY
                )
            await answer(database, client, minted.token, "declined", **given)
            return (await change(database, minted.id))["ended"]["art"], await where_held(database, NEW_EMAIL, folded=True)

        art, held = on_a_person(mongo_replica_set_url, body)

        # Only the row of the link mail the league sent, which keeps its recipient until its retention ends.
        assert (art, held) == ("declined", {NEW_EMAIL: ["outbox"]})


class TestTheReplayTellsTheNewMailboxAgain:
    """A restore takes back the notice an end queued, and the replay of its line queues it again."""

    @pytest.mark.parametrize(
        ("end", "expected"),
        [
            pytest.param("the pass", [("discarded", NEW_EMAIL)], id="the pass refusing a due change tells it again"),
            pytest.param("an approval", [("discarded", NEW_EMAIL)], id="an approval finding nothing to move tells it again"),
            pytest.param("a discard", [], id="an administrator's discard tells nobody"),
        ],
    )
    def test_from_a_snapshot_before_the_end(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture, end: str, expected: Any):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if end == "a discard":
                minted = await start(database, client)
            elif end == "the pass":
                minted = await administrator_starts(database, client, grund=GRUND)
                await answer(database, client, minted.token)
                await held_by_another(database, "a-seat")
            else:
                await granted(database)
                minted = await start(database, client)
                await answer(database, client, minted.token)
                for collection in (Collection.SPIELER, Collection.SCHIEDSRICHTER, Collection.SAISON_TEAMS, Collection.BEWERBUNGEN):
                    await database[collection].delete_many({})
                await database[Collection.REGISTRIERUNGEN].delete_many({})
                await database[Collection.BERECHTIGUNGEN].delete_one({"adresse": EMAIL})
            snapshot = {
                collection: await database[collection].find({}).to_list() for collection in (Collection.ADRESSWECHSEL, Collection.POSTAUSGANG)
            }
            with journal_of(caplog) as lines:
                if end == "a discard":
                    await discard(database, client, minted.id)
                elif end == "the pass":
                    await sweep(database, client, germany_now=AFTER_THE_WAIT)
                else:
                    await refused_code(approve(database, client, minted.id, operator=ADMIN))
            for collection, rows in snapshot.items():
                await database[collection].delete_many({})
                if rows:
                    await database[collection].insert_many(rows)
            window = Window(since=NOW - timedelta(hours=1), until=AFTER_THE_WAIT + timedelta(hours=1))
            stands = []
            for line in lines:
                plan = await plan_replay(line, database, key=KEY, session=None, now=AFTER_THE_WAIT, window=window)
                stands.append(plan.stand)
                if plan.rewrite is not None:
                    async with transaction_session(client) as session:
                        await session.with_transaction(plan.rewrite)
            return stands, [(notice["art"], notice["an"]) for notice in await owed(database)]

        stands, notices = on_a_person(mongo_replica_set_url, body)

        assert (stands, notices) == (["to replay"], expected)


# A restore's window, the snapshot before the start, its end the next morning; the replay runs after it.
REPLAY_WINDOW = Window(since=NOW - timedelta(hours=3), until=NOW + timedelta(hours=20))
REPLAY_NOW = NOW + timedelta(hours=21)


class TestTheReplayOntoEntries:
    """Replayed onto an address an entry names since, an effect would join two people's records."""

    @pytest.mark.parametrize("what", ["an-unconfirmed-seat", "a-grant-request", "nothing"])
    def test_a_restored_live_change_whose_new_address_holds_an_entry_is_left_for_review(self, mongo_replica_set_url: str, what: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            if what != "nothing":
                await held_by_another(database, what)
            line = JournalLine(
                person_hash=loeschung_journal_hash(NEW_EMAIL, key=KEY),
                art="adresswechsel_wirksam",
                collection=Collection.ADRESSWECHSEL,
                record_id=minted.id,
                am=log_stamp(NOW),
                zuvor=loeschung_journal_hash(EMAIL, key=KEY),
            )
            planned = await replay_line(
                Read(timestamp=NOW + timedelta(minutes=1), line=line), client, database, key=KEY, now=REPLAY_NOW, window=REPLAY_WINDOW
            )
            return planned.stand, (await row(database, Collection.SPIELER, SPIELER_OID))["email"]

        assert on_a_person(mongo_replica_set_url, body) == (("replayed", NEW_EMAIL) if what == "nothing" else ("left for review", EMAIL))


class TestTheReSendsRefusals:
    def test_a_new_address_an_entry_has_come_to_name_is_refused(self, mongo_replica_set_url: str):
        """A link re-sent onto it would only be refused on its press."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=GRUND)
            await held_by_another(database, "a-seat")
            return await refused_code(resend(database, client, started.id))

        assert on_a_person(mongo_replica_set_url, body) == Code.ADDRESS_CHANGE_OCCUPIED

    def test_a_new_address_barred_since_the_start_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=GRUND)
            await ban_through_the_route(database, client, email=NEW_EMAIL, grund="Falschangaben", von="admin@frankfurtleague.de", today=TODAY)
            return await refused_code(resend(database, client, started.id))

        assert on_a_person(mongo_replica_set_url, body) == Code.ADDRESS_CHANGE_BARRED

    def test_a_new_address_another_pupil_has_come_to_sign_in_on_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=GRUND)
            await database[Collection.SPIELER].update_one({"_id": OTHER_OID}, {"$set": {"email": NEW_EMAIL}})
            return await refused_code(resend(database, client, started.id))

        assert on_a_person(mongo_replica_set_url, body) == Code.ADDRESS_CHANGE_TAKEN

    def test_a_grant_s_change_past_its_approval_week_mints_no_dead_link(self, mongo_replica_set_url: str):
        """Its link would be refused on its press; a lapsed link alone is still re-sent, the week standing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            started = await administrator_starts(database, client, grund=GRUND, operator=OWNER)
            within = await resend(database, client, started.id, operator=OWNER, germany_now=AFTER_THE_DEADLINE)
            past = await refused_code(resend(database, client, started.id, operator=OWNER, germany_now=AFTER_THE_WEEK))
            return within.token is not None, past

        assert on_a_person(mongo_replica_set_url, body) == (True, Code.LINK_EXPIRED)


class TestTheWaitingTime:
    def test_the_stop_link_ends_it_during_the_wait(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=GRUND)
            await answer(database, client, started.token)
            seen = await view(database, client, started.stopp_token, germany_now=NOW + timedelta(days=3))
            await stop_by_link(database, client, started.stopp_token)
            return seen, await sweep(database, client, germany_now=AFTER_THE_WAIT), await everything(database)

        seen, swept, after = on_a_person(mongo_replica_set_url, body)

        assert (seen.view.seite, seen.view.state) == ("previous", "waiting_period")
        assert swept.effective == 0
        assert after["pupil"]["email"] == EMAIL

    def test_a_change_refused_at_its_due_time_is_journalled_as_discarded(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """A restore bringing it back would leave a confirmed change in its waiting time to take effect with nobody pressing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=GRUND)
            await answer(database, client, started.token)
            await ban_through_the_route(database, client, email=EMAIL, grund="Falschangaben", von="admin@frankfurtleague.de", today=TODAY)
            with journal_of(caplog) as journal:
                swept = await sweep(database, client, germany_now=AFTER_THE_WAIT)
            return started.id, swept, journal, await owed(database)

        started, swept, journal, notices = on_a_person(mongo_replica_set_url, body)

        assert swept.discarded == 1
        assert notices == [{"art": "discarded", "an": NEW_EMAIL}]
        assert [(line.art, line.record_id, line.person_hash) for line in journal] == [
            ("adresswechsel_verworfen_mitgeteilt", started, loeschung_journal_hash(NEW_EMAIL, key=KEY))
        ]


DECLINED_REG_OID = ObjectId("6890a1b2c3d4e5f607850053")
ANSWERED_OID = ObjectId("6890a1b2c3d4e5f607850063")


async def confirmed_and_moved(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    minted = await start(database, client)
    await answer(database, client, minted.token)


class TestWhatTheEffectLeavesTheLoeschung:
    """Everything of the person the replaced address keyed, within reach of an erasure of the new one."""

    def test_the_old_mailbox_s_registration_link_confirms_nothing_afterwards(self, mongo_replica_set_url: str):
        """An unanswered registration moves too, or its admission makes a second person; its link stayed in the replaced mailbox."""

        def ansicht(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            payload = FLTokenPayload(token=UNCONFIRMED_REG_LINK)
            return call(get_confirmation_view, database, client, ansicht_data=payload, today=TODAY)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await ansicht(database, client)
            await confirmed_and_moved(database, client)
            return before, await refused_code(ansicht(database, client))

        before, after = on_a_person(mongo_replica_set_url, body)

        assert (before.state, after) == ("valid", Code.LINK_INVALID)

    def test_a_registration_whose_reminder_went_out_is_owed_one_at_the_new_address(self, mongo_replica_set_url: str):
        """The reminder alone mints a moved registration a link, and it is owed once: spent, the row waits for its sweep."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.REGISTRIERUNGEN].update_one({"_id": UNCONFIRMED_REG_OID}, {"$set": {"confirmation.reminded_at": TODAY}})
            await confirmed_and_moved(database, client)
            return await row(database, Collection.REGISTRIERUNGEN, UNCONFIRMED_REG_OID)

        moved = on_a_person(mongo_replica_set_url, body)

        assert (moved["email"], moved["confirmation"]["reminded_at"]) == (NEW_EMAIL, None)
        assert erinnerung_is_due(registrierung_raw=moved, today="2126-04-02")

    def test_a_declined_registration_moves_too(self, mongo_replica_set_url: str):
        """Left behind, it holds the pupil's name and data where an erasure of the new address never looks, until its month is out."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            declined = registration(DECLINED_REG_OID, SECOND_TEAM_OID, confirmed=False, token="the-declined-registrations-link")
            declined.update(compose_ablehnung_update(von="admin@frankfurtleague.de", grund=None, today=TODAY)["$set"])
            await database[Collection.REGISTRIERUNGEN].insert_one(declined)
            await confirmed_and_moved(database, client)
            return await row(database, Collection.REGISTRIERUNGEN, DECLINED_REG_OID)

        assert on_a_person(mongo_replica_set_url, body)["email"] == NEW_EMAIL

    def test_the_log_s_pseudonym_and_an_answer_s_holder_digest_follow_the_person(self, mongo_replica_set_url: str):
        """Both are keyed on the address; left on the replaced one, an erasure of the new one never finds them."""

        spiel = documents.spiel_document(
            spiel_id=ObjectId(),
            saison_id=SAISON_ID,
            spiel_nr=2,
            spieltag_id=None,
            datum="2126-04-25",
            uhrzeit="14:00:00",
            team1={"team_id": TEAM_OID},
            team2={"team_id": SECOND_TEAM_OID},
        )
        answered = documents.spielbestaetigung_document(
            spiel,
            party={"art": "team", "team_id": TEAM_OID},
            _id=ANSWERED_OID,
            asked_at="2126-03-30",
            antwort=documents.kontakt_antwort_document("ansprechperson", TYPED, begruendung="Wir sind auf Klassenfahrt"),
        )

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELBESTAETIGUNGEN].insert_one(answered)
            # A write of theirs while signed in, which files a log row under their pseudonym holding the answer's image.
            token = actor_var.set(PersonActor(pseudonym=akteur_pseudonym(EMAIL, key=KEY), funktion="kontakt"))
            try:
                await patch_one_in_db(
                    collection=database[Collection.SPIELBESTAETIGUNGEN],
                    db_filter={"_id": ANSWERED_OID},
                    update={"$set": {"asked_at": "2126-03-31"}},
                    return_document=ReturnDocument.BEFORE,
                )
            finally:
                actor_var.reset(token)
            await confirmed_and_moved(database, client)

            log = database[Collection.AKTIONEN]
            return (
                (await row(database, Collection.SPIELBESTAETIGUNGEN, ANSWERED_OID))["antwort"],
                {
                    address: (
                        await log.count_documents({"actor.pseudonym": akteur_pseudonym(address, key=KEY)}),
                        await log.count_documents({"before.antwort.von.halter": halter_of(address, key=KEY)}),
                    )
                    for address in (EMAIL, NEW_EMAIL)
                },
            )

        antwort, log = on_a_person(mongo_replica_set_url, body)

        assert (antwort["von"]["halter"], antwort["begruendung"]) == (halter_of(NEW_EMAIL, key=KEY), "Wir sind auf Klassenfahrt")
        assert log == {EMAIL: (0, 0), NEW_EMAIL: (1, 1)}

    def test_a_seat_holder_s_decision_on_another_s_registration_follows_them_with_its_image(self, mongo_replica_set_url: str):
        """A seat holder holding no grant declines under their own address; left behind, it is an address nobody's erasure finds."""

        decided = documents.registrierung_document(
            DECLINED_REG_OID,
            OTHER_EMAIL,
            saison_id=SAISON_ID,
            team_id=SECOND_TEAM_OID,
            vorname="Jonte",
            nachname="Wirbelauer",
            token="another-pupil-s-registration-link",
            submitted_at="2126-03-30",
            frist="2126-04-06",
            confirmed=None,
        )

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.REGISTRIERUNGEN].insert_one(decided)
            # Declined through the shared write, so the log keeps an image naming the decider.
            await patch_one_in_db(
                collection=database[Collection.REGISTRIERUNGEN],
                db_filter={"_id": DECLINED_REG_OID},
                update=compose_ablehnung_update(von=EMAIL, grund=None, today=TODAY),
                return_document=ReturnDocument.BEFORE,
            )
            await patch_one_in_db(
                collection=database[Collection.REGISTRIERUNGEN],
                db_filter={"_id": DECLINED_REG_OID},
                update={"$set": {"frist": "2126-04-07"}},
                return_document=ReturnDocument.BEFORE,
            )
            await confirmed_and_moved(database, client)

            log = database[Collection.AKTIONEN]
            return (
                (await row(database, Collection.REGISTRIERUNGEN, DECLINED_REG_OID))["decision"]["von"],
                {address: await log.count_documents({"before.decision.von": address}) for address in (EMAIL, NEW_EMAIL)},
            )

        von, images = on_a_person(mongo_replica_set_url, body)

        assert von == NEW_EMAIL
        assert images[EMAIL] == 0 and images[NEW_EMAIL] >= 1

    def test_an_earlier_effect_s_owed_carry_follows_the_person(self, mongo_replica_set_url: str):
        """Its account goes where the person is now, and an erasure of the new address finds the record."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.ADRESSWECHSEL].insert_one(
                {
                    **documents.adresswechsel_document(adresse=FOREIGN_EMAIL, email=EMAIL, token_hash=None, day="2126-03-01"),
                    "adresse": None,
                    "email": None,
                    "ended": {"art": "effective", "am": NOW},
                    "move": {"von": FOREIGN_EMAIL, "nach": EMAIL},
                }
            )
            await confirmed_and_moved(database, client)
            return await carries(database)

        assert on_a_person(mongo_replica_set_url, body) == [(FOREIGN_EMAIL, NEW_EMAIL), (EMAIL, NEW_EMAIL)]


class TestTheLoeschung:
    def test_a_seat_left_before_the_change_goes_with_the_loeschung_at_the_new_address(self, mongo_replica_set_url: str):
        """The editor's image of the seat the person left names them by the replaced address, which no document holds.

        The unconfirmed seat still standing at that address keeps it: an erasure there reaches it.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            replacement = {**documents.kontaktperson_document("Vera", confirmed_at="2126-03-21"), "nachname": "Zwirnbach"}
            await as_administrator(
                ADMIN,
                patch_one_in_db(
                    collection=database[Collection.SAISON_TEAMS],
                    db_filter={"_id": ROW_OID},
                    update={"$set": {"kontakte.ansprechperson": {**replacement, "email": FOREIGN_EMAIL}}},
                    return_document=ReturnDocument.BEFORE,
                ),
            )
            minted = await start(database, client)
            await answer(database, client, minted.token)
            await geloescht(database, client, NEW_EMAIL)
            logged = await database[Collection.AKTIONEN].find_one({"collection": Collection.SAISON_TEAMS, "document_id": ROW_OID})
            assert logged is not None, "the editor's write filed no log row"
            return logged["before"]["kontakte"]["ansprechperson"], logged["before"]["kontakte"]["stellvertretung"]["email"]

        assert on_a_person(mongo_replica_set_url, body) == (None, EMAIL)

    @pytest.mark.parametrize(
        ("edit", "kept"),
        [
            pytest.param({"kontakt.email": FOREIGN_EMAIL}, None, id="re-addressed before the change: its image follows the person"),
            pytest.param({"name": "Vera Zwirnbach"}, EMAIL, id="still standing at the replaced address: its image keeps it"),
        ],
    )
    def test_a_referee_row_left_before_the_change_goes_with_the_loeschung_at_the_new_address(
        self, mongo_replica_set_url: str, edit: dict[str, Any], kept: str | None
    ):
        """The editor's image of the unconfirmed referee row names the replaced address, which, re-addressed, no row holds."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await as_administrator(
                ADMIN,
                patch_one_in_db(
                    collection=database[Collection.SCHIEDSRICHTER],
                    db_filter={"_id": UNCONFIRMED_REFEREE_OID},
                    update={"$set": edit},
                    return_document=ReturnDocument.BEFORE,
                ),
            )
            minted = await start(database, client)
            await answer(database, client, minted.token)
            await geloescht(database, client, NEW_EMAIL)
            logged = await database[Collection.AKTIONEN].find_one(
                {"collection": Collection.SCHIEDSRICHTER, "document_id": UNCONFIRMED_REFEREE_OID}
            )
            assert logged is not None, "the editor's write filed no log row"
            return logged["before"]["kontakt"]["email"]

        assert on_a_person(mongo_replica_set_url, body) == kept

    def test_an_geloescht_new_address_ends_another_address_s_change_and_holds_it_nowhere(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            await geloescht(database, client, NEW_EMAIL)
            return await change(database, minted.id), await where_held(database, NEW_EMAIL, folded=True)

        record, held = on_a_person(mongo_replica_set_url, body)

        assert (record["ended"]["art"], record["email"]) == ("discarded", None)
        assert held == {NEW_EMAIL: []}

    def test_an_geloescht_address_on_file_ends_its_own_change_and_neither_address_is_held(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            await geloescht(database, client, EMAIL)
            return await change(database, minted.id), await where_held(database, EMAIL, NEW_EMAIL, folded=True)

        record, held = on_a_person(mongo_replica_set_url, body)

        assert (record["ended"]["art"], record["adresse"], record["email"]) == ("discarded", None, None)
        assert held == {EMAIL: [], NEW_EMAIL: []}


def geloescht(database: AsyncDatabase, client: AsyncMongoClient, email: str) -> Any:
    """The erasure on request, as an owner whose step-up window the HTTP suites hold."""

    return call(
        post_erasure,
        database,
        client,
        loeschung_data=FLErasurePayload(email=email, anlass="Auf Anfrage per Brief"),
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
        """The start committing second meets `uniq_adresswechsel_adresse` as a write conflict, and its retry replaces the first's."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            committed = asyncio.Event()
            held = _HeldAfterItsRead(database[Collection.ADRESSWECHSEL], committed)
            task = asyncio.ensure_future(start(database, client, adresswechsel_collection=cast(Any, held)))
            await held.until_held(task)
            try:
                rival = await administrator_starts(database, client, grund=GRUND, email=FOREIGN_EMAIL)
            except BaseException:
                await held.abandon(task)
                raise
            committed.set()
            minted = await task

            live = await database[Collection.ADRESSWECHSEL].find({"ended": None}).to_list(None)
            return held.reads, held.insert_failures, [row["_id"] for row in live], minted.id, (await change(database, rival.id))["ended"]

        reads, failures, live, minted, rival_end = on_a_person(mongo_replica_set_url, body)

        assert reads == 2
        assert failures == ["OperationFailure:112"]
        assert live == [minted]
        assert rival_end["art"] == "replaced"


def _indexes_named(explained: Any) -> set[str]:
    """Every index an explain's plans name, at any depth: a `$lookup`'s inner plan sits under its own stage."""

    if isinstance(explained, Mapping):
        named = {explained["indexName"]} if isinstance(explained.get("indexName"), str) else set()
        # A `$lookup`'s inner reads, which its stage lists by name.
        named |= set(explained.get("indexesUsed") or ())
        return named.union(*(_indexes_named(value) for value in explained.values()))
    if isinstance(explained, list):
        return set().union(*(_indexes_named(value) for value in explained))
    return set()


class TestTheLiveReadsTheIndexServes:
    """`uniq_adresswechsel_adresse` is partial, so the planner uses it only for a read whose filter implies its own."""

    def test_a_read_keyed_on_one_address_or_several_is_answered_by_the_unique_index(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await start(database, client)
            plans = []
            for db_filter in (build_address_filter(EMAIL), build_addresses_filter([EMAIL, OTHER_EMAIL])):
                plans.append(
                    await database.command({"explain": {"find": Collection.ADRESSWECHSEL, "filter": db_filter}, "verbosity": "queryPlanner"})
                )
            return [_indexes_named(plan["queryPlanner"]["winningPlan"]) for plan in plans]

        assert on_a_person(mongo_replica_set_url, body) == [{"uniq_adresswechsel_adresse"}] * 2

    def test_the_loeschungen_read_of_either_address_is_answered_by_their_two_indexes(self, mongo_replica_set_url: str):
        """Two hundred tombstones beside the live change, so a scan cannot pass for one document's plan."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await start(database, client)
            await database[Collection.ADRESSWECHSEL].insert_many(
                [{"adresse": None, "email": None, "ended": {"art": "discarded", "am": NOW}, "token_hashes": [f"{i:064x}"]} for i in range(200)],
                bypass_document_validation=True,
            )
            return await database.command(
                {
                    "explain": {"aggregate": Collection.ADRESSWECHSEL, "pipeline": build_loeschung_adresswechsel_pipeline(EMAIL), "cursor": {}},
                    "verbosity": "executionStats",
                }
            )

        explained = on_a_person(mongo_replica_set_url, body)
        cursor = explained.get("stages", [{}])[0].get("$cursor", explained)
        stats = cursor["executionStats"]

        assert _indexes_named(cursor["queryPlanner"]["winningPlan"]) == {"uniq_adresswechsel_adresse", "adresswechsel_email"}
        assert (stats["nReturned"], stats["totalDocsExamined"]) == (1, 1)

    def test_the_pupils_list_joins_their_changes_through_the_unique_index(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await start(database, client)
            return await database.command(
                {
                    "explain": {"aggregate": Collection.SPIELER, "pipeline": build_spieler_saisons_pipeline(), "cursor": {}},
                    "verbosity": "executionStats",
                }
            )

        explained = on_a_person(mongo_replica_set_url, body)
        [joined] = [stage for stage in explained["stages"] if stage.get("$lookup", {}).get("from") == Collection.ADRESSWECHSEL]

        assert (joined["indexesUsed"], joined["collectionScans"]) == (["uniq_adresswechsel_adresse"], 0)

    def test_the_pupils_list_names_a_live_change_and_never_an_ended_one(self, mongo_replica_set_url: str):
        """Every pupil holds an address, so the bystander beside it names none: an ended change's null address meets nobody."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def listed() -> dict[Any, Any]:
                rows = await (await database[Collection.SPIELER].aggregate(build_spieler_saisons_pipeline())).to_list()
                return {row["_id"]: row["address_change_id"] for row in rows}

            minted = await start(database, client)
            live = await listed()
            await stop_here(database, client)
            return minted.id, live, await listed()

        minted, live, ended = on_a_person(mongo_replica_set_url, body)

        assert (live[SPIELER_OID], live[OTHER_OID]) == (minted, None)
        assert set(ended.values()) == {None}


# The deletion itself is MongoDB's and is not driven here: shortening the server's TTL monitor period
# would expire every other worker's TTL-indexed rows early too.
class TestTheTombstoneExpires:
    def test_the_index_expires_an_ended_change_by_its_end_and_never_a_live_one(self, mongo_replica_set_url: str):
        """Pinned to `ended.am`, a date an ended change holds and a live one never: keyed on another, the index expires live changes."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            ended = await start(database, client)
            await stop_here(database, client)
            # Standing beside the ended one, so the date read below is shown absent from a live change.
            await start(database, client, identifier=OTHER_EMAIL)
            built = {index["name"]: index async for index in await database[Collection.ADRESSWECHSEL].list_indexes()}
            ttl = built["adresswechsel_beendet_am"]
            dated = await database[Collection.ADRESSWECHSEL].distinct("_id", {"ended.am": {"$type": "date"}})
            return (
                (dict(ttl["key"]), ttl.get("expireAfterSeconds")),
                dated,
                ended.id,
                await database[Collection.ADRESSWECHSEL].count_documents({}),
            )

        index, dated, ended, stored = on_a_person(mongo_replica_set_url, body)

        assert index == ({"ended.am": 1}, ADRESSWECHSEL_NACHLAUF_TAGE * 86400)
        assert (dated, stored) == ([ended], 2)
