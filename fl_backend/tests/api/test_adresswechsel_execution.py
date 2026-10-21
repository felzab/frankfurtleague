"""
API · one address's change of the address it signs in on, driven end to end against the shipped validators

The person starts it on their own account page, an administrator through the address tool for a person who cannot sign
in, and the new mailbox's confirmation, an administrator's approval of a grant's move, or the hourly pass at the end of a
waiting time moves everything the replaced address holds in one write. The pass's share and failures are
`tests/api/test_adresswechsel_sweep_execution.py`'s.
"""

import asyncio
import logging
from collections.abc import Awaitable, Iterator, Mapping
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from app.api.adresswechsel.services import (
    ADRESSWECHSEL_ABGELAUFEN,
    ADRESSWECHSEL_BEENDET,
    ADRESSWECHSEL_BELEGT,
    ADRESSWECHSEL_BESTAETIGUNG_GESPERRT,
    ADRESSWECHSEL_ERSETZTE_GESPERRT,
    ADRESSWECHSEL_GENEHMIGUNG_INHABER,
    ADRESSWECHSEL_GENEHMIGUNG_JUENGER,
    ADRESSWECHSEL_GENEHMIGUNG_VERWEHRT,
    ADRESSWECHSEL_GESPERRT,
    ADRESSWECHSEL_KEIN_GENEHMIGER,
    ADRESSWECHSEL_KEINE_GENEHMIGUNG_OFFEN,
    ADRESSWECHSEL_NAME_IM_GRUND,
    ADRESSWECHSEL_NEUE_BERECHTIGT,
    ADRESSWECHSEL_NICHT_GEDECKT,
    ADRESSWECHSEL_NICHTS,
    ADRESSWECHSEL_UNBEKANNT,
    ADRESSWECHSEL_UNVERAENDERT,
    ADRESSWECHSEL_VERGEBEN,
    build_address_filter,
    build_addresses_filter,
    compose_postausgang,
)
from app.api.berechtigungen.admin_router import delete_antrag, get_berechtigungen
from app.api.berechtigungen.antraege import compose_antrag
from app.api.berechtigungen.crud import live_unbarred_grant_since
from app.api.berechtigungen.services import signed_in_since
from app.api.berechtigungen.sweep_router import post_berechtigungen_abgleich
from app.api.bewerbungen.services import hash_token
from app.api.einladungen.services import compose_einladung
from app.api.identitaet.admin_router import erase_auf_anfrage, get_erasure_ansicht_auf_anfrage
from app.api.identitaet.crud import find_anmeldung, find_subjekt, unreferenced_of
from app.api.identitaet.schemas import FLErasureAnsichtPayload, FLErasurePayload
from app.api.identitaet.services import EIGENE_ADRESSE, VERWALTUNG_ADRESSE
from app.api.registrierungen.einwilligung_router import get_bestaetigung_ansicht
from app.api.registrierungen.schemas import FLRegistrierungBestaetigungAnsichtPayload
from app.api.registrierungen.services import REGISTRIERUNG_TOKEN_UNKNOWN, compose_ablehnung_update, erinnerung_is_due
from app.api.schiedsrichter.router import get_schiedsrichter_by_id
from app.api.spielbestaetigungen.services import halter_of
from app.api.spieler.admin_router import get_spieler_memberships
from app.api.spieler.services import build_spieler_memberships_pipeline
from app.api.teams.admin_router import get_team_memberships
from app.core.adressanker import adressanker_id
from app.core.collections import Collection
from app.core.crud import ANCHOR_FIELD, patch_one_in_db
from app.core.drosselung import build_counts_filter
from app.core.exceptions import ActorConfirmationRequiredException, DocumentNotFoundException, WriteRefusalException
from app.core.journal import JOURNAL_TOKEN, parse_line
from app.core.recording import SYSTEM_ACTOR, Actor, PersonActor, actor_var
from app.core.security import akteur_pseudonym, loeschung_journal_hash
from app.shared.schemas.bounds import ADRESSWECHSEL_NACHLAUF_TAGE
from tests import documents
from tests.bans import ban_list, ban_through_the_route
from tests.config import build_test_config, grants_for_the_suite
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
    THIRD_ADMIN,
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
    change,
    discard,
    everything,
    granted,
    owed,
    person_check,
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
            return [(await read(database, client, address)).moeglich for address in (EMAIL, OTHER_EMAIL, ADMIN, "nobody@schule.example")]

        assert on_a_person(mongo_replica_set_url, body) == [True, True, True, False]

    def test_the_person_s_own_change_shows_its_address_whole(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await start(database, client)
            return await read(database, client)

        seen = on_a_person(mongo_replica_set_url, body)

        assert seen.offen is not None
        assert (seen.offen.email, seen.offen.weg, seen.offen.wartet_auf, seen.offen.genehmigung) == (NEW_EMAIL, "konto", "neue_adresse", None)

    def test_an_administrator_s_change_shows_its_address_masked_and_never_whole(self, mongo_replica_set_url: str):
        """It may be a pretext whose target the holder of the address on file must not learn: unmask it and this fails."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await administrator_starts(database, client, grund=None)
            return await read(database, client)

        seen = on_a_person(mongo_replica_set_url, body)
        served = seen.model_dump_json()

        assert seen.offen is not None and seen.offen.email == "l•••@n•••.org"
        assert (NEW_EMAIL in served, "lenore.q" in served, "neupost" in served) == (False, False, False)

    @pytest.mark.parametrize("step", ["link", "genehmigung"])
    def test_a_lapsed_step_reads_lapsed_until_the_pass_ends_the_change(self, mongo_replica_set_url: str, step: str):
        """Its press is refused `-003`, so a page reading it unmarked offers that press until the pass."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if step == "genehmigung":
                await granted(database)
            minted = await start(database, client)
            if step == "genehmigung":
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

        assert (minted.email, minted.bisherige_email, minted.vorname, minted.genehmiger_anzahl) == (NEW_EMAIL, EMAIL, "Lenore", 0)
        assert (record["adresse"], record["email"], record["weg"], record["beendet"], record["genehmigung"]) == (
            EMAIL,
            NEW_EMAIL,
            "konto",
            None,
            None,
        )
        assert (record["token_hash"], record["stopp_hash"]) == (hash_token(minted.token), hash_token(minted.stopp_token))
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
            return meanwhile, [(await find_anmeldung(email, record_collections(database))).konto for email in (EMAIL, NEW_EMAIL)]

        (gate, subjekt), after = on_a_person(mongo_replica_set_url, body)

        assert (gate.konto, subjekt.spieler, subjekt.schiedsrichter, subjekt.sitze) == (False, [], [], [])
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

            return sorted(minted.model_dump()), (await change(database, minted.id))["email"]

        assert on_a_person(mongo_replica_set_url, body) == (
            ["acknowledged", "bisherige_email", "email", "genehmiger_anzahl", "gueltig_bis", "id", "stopp_token", "token", "vorname"],
            NEW_EMAIL,
        )

    def test_the_address_signed_in_on_is_refused_in_any_spelling_and_named_nowhere(self, mongo_replica_set_url: str):
        """Its message reaches the refusal's log line, which names no submitted value."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(WriteRefusalException) as refused:
                await start(database, client, email=TYPED.upper())
            return refused.value.error_code, refused.value.error_detail["message"]

        code, message = on_a_person(mongo_replica_set_url, body)

        assert code == ADRESSWECHSEL_UNVERAENDERT
        assert "@" not in message

    def test_an_address_holding_nothing_a_change_moves_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await refused_code(start(database, client, identifier="nobody@schule.example"))

        assert on_a_person(mongo_replica_set_url, body) == ADRESSWECHSEL_NICHTS

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

    def test_a_grant_holder_s_change_asks_another_administrator_s_approval_and_names_who_may_give_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            return minted, await change(database, minted.id), await approvers_told(database, client)

        minted, record, told = on_a_person(mongo_replica_set_url, body)

        approvers = sorted(["admin@example.com", "admin@frankfurtleague.de", "spielorte.admin@example.com", "triage.quillhilde@example.com"])
        # Named where they are mailed, the grants' outbox claim; the start's answer counts them and names nobody.
        assert (told, minted.genehmiger_anzahl) == ([approvers], len(approvers))
        genehmigung = record["genehmigung"]
        assert (genehmigung["verwaltung"], genehmigung["gestartet_von"], genehmigung["genehmigt_am"]) == ("administration", EMAIL, None)

    def test_the_last_owner_makes_another_before_changing_their_address(self, mongo_replica_set_url: str):
        """Nobody but another owner approves an owner's change, so a change nobody could approve would only lapse."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            refused = await refused_code(start(database, client, identifier=OWNER))
            await database[Collection.BERECHTIGUNGEN].update_one({"adresse": SECOND_ADMIN}, {"$set": {"verwaltung": "owner"}})
            minted = await start(database, client, identifier=OWNER)
            return refused, minted.genehmiger_anzahl, await approvers_told(database, client)

        refused, anzahl, told = on_a_person(mongo_replica_set_url, body)

        assert refused == ADRESSWECHSEL_KEIN_GENEHMIGER
        assert (anzahl, told) == (1, [[SECOND_ADMIN]])

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

        assert (replaced["beendet"]["art"], replaced["adresse"], replaced["email"], replaced["grund"]) == ("ersetzt", None, None, None)
        assert (seen.ansicht.zustand, seen.ansicht.art) == ("beendet", "ersetzt")
        assert held == {FOREIGN_EMAIL: []}
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

        assert neu.ansicht.model_dump(exclude={"gueltig_bis"}) == {
            "seite": "neu",
            "zustand": "gueltig",
            "wirksam_ab": None,
            "weg": "konto",
            "genehmigung_offen": None,
        }
        assert (bisherig.ansicht.seite, bisherig.ansicht.zustand, bisherig.ansicht.weg) == ("bisherig", "offen", "konto")

    def test_a_grant_holder_s_link_tells_of_the_approval_only_once_pressed(self, mongo_replica_set_url: str):
        """Before the press it would tell whoever holds a mistyped link that the account holds access to the administration."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            before = await view(database, client, minted.token)
            await answer(database, client, minted.token)
            return before.ansicht, (await view(database, client, minted.token)).ansicht

        before, after = on_a_person(mongo_replica_set_url, body)

        assert (before.zustand, before.genehmigung_offen) == ("gueltig", None)
        assert (after.zustand, after.genehmigung_offen) == ("bestaetigt", True)

    def test_a_confirmed_link_whose_approval_week_lapsed_reads_lapsed(self, mongo_replica_set_url: str):
        """The pass ends it unapproved, so the page must not still promise it takes effect once approved."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            await answer(database, client, minted.token)
            return (await view(database, client, minted.token, germany_now=AFTER_THE_WEEK)).ansicht

        seen = on_a_person(mongo_replica_set_url, body)

        # Never `abgelaufen`, the link's own lapse: the page would offer a decline the confirmed link refuses.
        assert (seen.zustand, seen.genehmigung_offen) == ("genehmigung_abgelaufen", None)

    @pytest.mark.parametrize(
        ("cause", "refused"),
        [
            ("vergeben", ADRESSWECHSEL_VERGEBEN),
            ("nicht_gedeckt", ADRESSWECHSEL_NICHT_GEDECKT),
            ("neue_berechtigt", ADRESSWECHSEL_NEUE_BERECHTIGT),
            # Nothing left to move: the press ends the change discarded and answers `-002`.
            ("leer", ADRESSWECHSEL_BEENDET),
        ],
    )
    def test_a_link_its_press_would_refuse_for_the_address_on_file_s_sake_offers_no_confirmation(
        self, mongo_replica_set_url: str, cause: str, refused: str
    ):
        """The page reads its view before offering the press: a view reading `gueltig` here offers what the press refuses."""

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
            return (await view(database, client, minted.token)).ansicht.zustand, await refused_code(answer(database, client, minted.token))

        assert on_a_person(mongo_replica_set_url, body) == ("nicht_bestaetigbar", refused)

    @pytest.mark.parametrize(
        ("step", "wartet_auf", "bisherig"), [("freigabe", "freigabe", "freigabe_offen"), ("genehmigung", "genehmigung", "genehmigung")]
    )
    def test_the_step_a_change_waits_on_reads_on_the_account_page_and_the_stop_link(
        self, mongo_replica_set_url: str, step: str, wartet_auf: str, bisherig: str
    ):
        """The account page offers the address on file's approval on `freigabe` alone, and the stop link names each step."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if step == "freigabe":
                minted = await administrator_starts(database, client, grund=None)
            else:
                await granted(database)
                minted = await start(database, client)
                await answer(database, client, minted.token)
            offen = (await read(database, client)).offen
            assert offen is not None
            return offen.wartet_auf, (await view(database, client, minted.stopp_token)).ansicht.zustand

        assert on_a_person(mongo_replica_set_url, body) == (wartet_auf, bisherig)

    def test_a_token_no_change_holds_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return [
                await refused_code(view(database, client, "nobody-minted-this")),
                await refused_code(answer(database, client, "nobody-minted-this")),
                await refused_code(stop_by_link(database, client, "nobody-minted-this")),
            ]

        assert on_a_person(mongo_replica_set_url, body) == [ADRESSWECHSEL_UNBEKANNT] * 3

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

        assert (neu.ansicht.seite, neu.ansicht.zustand, neu.ansicht.art) == ("neu", "beendet", "gestoppt")
        assert (bisherig.ansicht.seite, bisherig.ansicht.zustand, bisherig.ansicht.art) == ("bisherig", "beendet", "gestoppt")
        assert (pressed, stopped) == (ADRESSWECHSEL_BEENDET, ADRESSWECHSEL_BEENDET)

    def test_a_confirmed_link_answers_its_state_and_takes_no_second_press(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=GRUND)
            await answer(database, client, started.token)
            return await view(database, client, started.token), await refused_code(answer(database, client, started.token, "abgelehnt"))

        seen, pressed = on_a_person(mongo_replica_set_url, body)

        assert (seen.ansicht.zustand, seen.ansicht.gueltig_bis, seen.ansicht.wirksam_ab is not None) == ("bestaetigt", None, True)
        assert pressed == ADRESSWECHSEL_BEENDET


class TestTheConfirmation:
    def test_every_own_record_moves_and_every_other_stays(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await everything(database)
            minted = await start(database, client)
            with journal_of(caplog) as journal:
                answered = await answer(database, client, minted.token)

            return before, minted, answered, await everything(database), await change(database, minted.id), journal, await owed(database)

        before, minted, answered, after, record, journal, notices = on_a_person(mongo_replica_set_url, body)

        assert answered.wirksam
        assert notices == [{"art": "wirksam", "bisherige_email": EMAIL, "email": NEW_EMAIL, "vorname": "Lenore", "weg": "konto"}]
        assert after["pupil"] == {**before["pupil"], "email": NEW_EMAIL}
        # The confirmed referee row moves, its consent link's delivery state with the address it described.
        referee = {**before["referee"], "kontakt": {**before["referee"]["kontakt"], "email": NEW_EMAIL}}
        referee["bestaetigung"] = {key: value for key, value in before["referee"]["bestaetigung"].items() if key != "zustellung"}
        assert after["referee"] == referee
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
        assert (record["adresse"], record["email"], record["beendet"]["art"]) == (None, None, "wirksam")
        assert record["token_hash"] == hash_token(minted.token)
        [line] = [line for line in journal if line.art == "adresswechsel_wirksam"]
        assert (line.record_id, line.zuvor) == (minted.id, loeschung_journal_hash(EMAIL, schluessel=KEY))

    def test_a_change_started_with_a_reason_is_confirmed_and_waits_for_the_pass(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=GRUND)
            confirmed = await answer(database, client, started.token)
            waiting = await everything(database)
            early = await sweep(database, client, germany_now=NOW + timedelta(days=1))
            late = await sweep(database, client, germany_now=AFTER_THE_WAIT)

            return started, confirmed, waiting, early, late, await everything(database), await owed(database)

        started, confirmed, waiting, early, late, after, notices = on_a_person(mongo_replica_set_url, body)

        assert started.weg == "wartezeit"
        assert (confirmed.wirksam, confirmed.wirksam_ab is not None, confirmed.genehmigung_offen) == (False, True, False)
        assert (waiting["pupil"]["email"], waiting["referee"]["kontakt"]["email"]) == (EMAIL, EMAIL)
        assert (early.entfernt, early.verworfen, early.wirksam) == (0, 0, 0)
        assert late.wirksam == 1
        # The lost-mailbox way greets nobody: that mailbox may have passed to a stranger.
        assert notices == [{"art": "wirksam", "bisherige_email": EMAIL, "email": NEW_EMAIL, "vorname": None, "weg": "wartezeit"}]
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

        assert (code, record["beendet"]["art"], record["email"]) == (ADRESSWECHSEL_BEENDET, "verworfen", None)
        assert [line.art for line in journal] == ["adresswechsel_verworfen"]

    def test_the_decline_ends_it_and_leaves_its_address_nowhere(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            await stop_here(database, client)
            minted = await start(database, client)
            with journal_of(caplog) as journal:
                answered = await answer(database, client, minted.token, "abgelehnt", germany_now=AFTER_THE_DEADLINE)

            return answered, await change(database, minted.id), await where_held(database, NEW_EMAIL, folded=True), journal

        answered, record, held, journal = on_a_person(mongo_replica_set_url, body)

        assert (answered.antwort, answered.wirksam) == ("abgelehnt", False)
        assert record["beendet"]["art"] == "abgelehnt"
        assert held == {NEW_EMAIL: []}
        assert [line.art for line in journal] == ["adresswechsel_abgelehnt"]


VERA_ROW_OID = ObjectId("6890a1b2c3d4e5f607850032")


async def held_by_another(database: AsyncDatabase, what: str) -> None:
    """The new address holding another person's record, its holder never signed in there."""

    if what == "a-grant":
        await granted(database, NEW_EMAIL)
        return

    seat = {**documents.kontaktperson_document("Vera", bestaetigt_am="2126-03-21"), "nachname": "Zwirnbach", "email": NEW_EMAIL}
    await database[Collection.SAISON_TEAMS].insert_one(
        {
            **documents.saison_team_document(
                SAISON_ID, SECOND_TEAM_OID, "Quellbrunn", "QB", kontakte=documents.kontakte_document(trainer=seat)
            ),
            "_id": VERA_ROW_OID,
        }
    )


class TestTheNewAddressesOwnRecords:
    @pytest.mark.parametrize("what", ["a-seat", "a-grant"])
    def test_the_press_onto_them_is_refused_and_moves_nothing(self, mongo_replica_set_url: str, what: str):
        """The takeover it closes: joined to the starter's, their holder's records would sign in with the starter's passkey.

        The start judged nothing of the new address; its link's page offers no confirmation, and nothing is owed a mailbox.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await held_by_another(database, what)
            minted = await start(database, client)
            seen = (await view(database, client, minted.token)).ansicht.zustand
            refused = await refused_code(answer(database, client, minted.token))
            return seen, refused, await everything(database), await owed(database)

        seen, refused, rows, notices = on_a_person(mongo_replica_set_url, body)

        assert (seen, refused) == ("nicht_bestaetigbar", ADRESSWECHSEL_BELEGT)
        assert (rows["pupil"]["email"], rows["referee"]["kontakt"]["email"], notices) == (EMAIL, EMAIL, [])

    def test_entries_arriving_after_the_confirmation_end_the_change_not_in_effect(self, mongo_replica_set_url: str):
        """A waiting time lets them arrive after the press judged none, so the pass judges again and tells the new mailbox."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=GRUND)
            await answer(database, client, started.token)
            await held_by_another(database, "a-seat")
            swept = await sweep(database, client, germany_now=AFTER_THE_WAIT)
            return swept, await change(database, started.id), await everything(database), await owed(database)

        swept, record, rows, notices = on_a_person(mongo_replica_set_url, body)

        assert (swept.verworfen, swept.wirksam, record["beendet"]["art"], rows["pupil"]["email"]) == (1, 0, "verworfen", EMAIL)
        assert [(notice["art"], notice["email"]) for notice in notices] == [("verworfen", NEW_EMAIL)]

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

        assert (refused, record["beendet"], record["genehmigung"]["genehmigt_am"], rows["pupil"]["email"]) == (
            ADRESSWECHSEL_BELEGT,
            None,
            None,
            EMAIL,
        )


async def unreferenced(database: AsyncDatabase, *addresses: str) -> list[str]:
    return await unreferenced_of(
        list(addresses),
        record_collections(database),
        berechtigungen_collection=database[Collection.BERECHTIGUNGEN],
        adresswechsel_postausgang_collection=database[Collection.ADRESSWECHSEL_POSTAUSGANG],
    )


class TestTheAccountSweepWaitsForTheCarry:
    @pytest.mark.parametrize(("weg", "held"), [("konto", True), ("wartezeit", False)])
    def test_the_replaced_address_stays_referenced_while_its_account_s_carry_is_owed(self, mongo_replica_set_url: str, weg: str, held: bool):
        """Swept before the drain, the account and its passkeys would be gone when the carry runs; a notice carrying none holds nothing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await (administrator_starts(database, client, grund=GRUND) if weg == "wartezeit" else start(database, client))
            await answer(database, client, minted.token)
            if weg == "wartezeit":
                await sweep(database, client, germany_now=AFTER_THE_WAIT)
            owed_now = await unreferenced(database, EMAIL)
            await database[Collection.ADRESSWECHSEL_POSTAUSGANG].delete_many({})
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

        assert (code, rows["pupil"]["email"]) == (ADRESSWECHSEL_ABGELAUFEN, EMAIL)

    @staticmethod
    def refused_after_a_ban_on(url: str, *barred: str) -> tuple[str, str]:
        """The press's code and the view's state, the two ranked alike."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            for address in barred:
                await ban_through_the_route(database, client, email=address, grund="Falschangaben", von=ADMIN, today=TODAY)
            return await refused_code(answer(database, client, minted.token)), (await view(database, client, minted.token)).ansicht.zustand

        return on_a_person(url, body)

    def test_to_an_address_barred_since_the_start(self, mongo_replica_set_url: str):
        assert self.refused_after_a_ban_on(mongo_replica_set_url, NEW_EMAIL) == (ADRESSWECHSEL_BESTAETIGUNG_GESPERRT, "gesperrt")

    def test_from_an_address_on_file_barred_since_the_start(self, mongo_replica_set_url: str):
        """A barred person moves nothing off the address the ban keys on; the new mailbox learns nothing of the ban."""

        assert self.refused_after_a_ban_on(mongo_replica_set_url, EMAIL) == (ADRESSWECHSEL_ERSETZTE_GESPERRT, "nicht_bestaetigbar")

    def test_a_ban_on_both_names_the_link_s_own(self, mongo_replica_set_url: str):
        assert self.refused_after_a_ban_on(mongo_replica_set_url, EMAIL, NEW_EMAIL) == (ADRESSWECHSEL_BESTAETIGUNG_GESPERRT, "gesperrt")

    def test_a_lapsed_link_to_a_barred_address_names_the_ban(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            await ban_through_the_route(database, client, email=NEW_EMAIL, grund="Falschangaben", von=ADMIN, today=TODAY)
            return await refused_code(answer(database, client, minted.token, germany_now=AFTER_THE_DEADLINE))

        assert on_a_person(mongo_replica_set_url, body) == ADRESSWECHSEL_BESTAETIGUNG_GESPERRT

    def test_to_an_address_another_pupil_has_come_to_sign_in_on(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            await database[Collection.SPIELER].update_one({"_id": OTHER_OID}, {"$set": {"email": NEW_EMAIL}})
            return await refused_code(answer(database, client, minted.token)), await everything(database)

        code, rows = on_a_person(mongo_replica_set_url, body)

        assert (code, rows["pupil"]["email"]) == (ADRESSWECHSEL_VERGEBEN, EMAIL)


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

        assert record["beendet"]["art"] == "gestoppt"
        assert held == {NEW_EMAIL: []}
        assert seen.offen is None
        assert [line.art for line in journal] == ["adresswechsel_gestoppt"]

    def test_with_nothing_pending_the_account_page_answers_not_found(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentNotFoundException) as missed:
                await stop_here(database, client)
            return missed.value.status_code

        assert on_a_person(mongo_replica_set_url, body) == 404


class TestAGrantHoldersOwnPressAsksAPasskey:
    """The person's lane admits a sign-in by code, which a change handing a grant over must not be enough for (I790)."""

    def test_a_start_by_code_is_refused_where_the_address_holds_a_grant_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            with pytest.raises(ActorConfirmationRequiredException):
                await start(database, client, refuse_unconfirmed=person_check(factor=None))
            return await database[Collection.ADRESSWECHSEL].count_documents({})

        assert on_a_person(mongo_replica_set_url, body) == 0

    def test_a_start_by_code_goes_where_the_address_holds_no_grant(self, mongo_replica_set_url: str):
        """The control: the code reached the address on file, the confirmation OWASP's process asks of it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await start(database, client, refuse_unconfirmed=person_check(factor=None))

        assert on_a_person(mongo_replica_set_url, body).token is not None

    def test_the_address_on_files_approval_by_code_is_refused_where_it_holds_a_grant(self, mongo_replica_set_url: str):
        """Its press lets the link go that hands the grant over at the effect."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            started = await administrator_starts(database, client, grund=None, operator=OWNER)
            with pytest.raises(ActorConfirmationRequiredException):
                await approve_as_the_address(database, client, started.id, refuse_unconfirmed=person_check(factor=None))
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

        assert (started.weg, started.token, before["token_hash"], before["versand"]) == ("freigabe", None, None, None)
        assert (approved.id, approved.email) == (started.id, NEW_EMAIL)
        assert (after["token_hash"], after["versand"], after["freigegeben_am"] is not None) == (hash_token(approved.token), {}, True)
        assert after["stopp_hash"] == before["stopp_hash"]

    def test_past_its_deadline_it_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=None)
            return await refused_code(approve_as_the_address(database, client, started.id, germany_now=AFTER_THE_DEADLINE))

        assert on_a_person(mongo_replica_set_url, body) == ADRESSWECHSEL_ABGELAUFEN

    def test_a_tab_showing_a_change_since_replaced_approves_nothing(self, mongo_replica_set_url: str):
        """The page read one request; a second start replaced it before the press, whose new address the page never showed."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            shown = await administrator_starts(database, client, grund=None)
            later = await administrator_starts(database, client, grund=None, email=FOREIGN_EMAIL)
            stale = await refused_code(approve_as_the_address(database, client, shown.id))
            return stale, await change(database, later.id)

        stale, later = on_a_person(mongo_replica_set_url, body)

        assert stale == ADRESSWECHSEL_BEENDET
        assert (later["token_hash"], later["freigegeben_am"]) == (None, None)

    def test_another_address_s_change_is_not_found(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            theirs = await administrator_starts(database, client, grund=None, adresse=OTHER_EMAIL)
            with pytest.raises(DocumentNotFoundException):
                await approve_as_the_address(database, client, theirs.id)
            return await change(database, theirs.id)

        assert on_a_person(mongo_replica_set_url, body)["token_hash"] is None


class TestTheToolsStart:
    def test_with_a_reason_it_mints_the_new_mailbox_its_link_and_refuses_a_new_address_holding_entries(self, mongo_replica_set_url: str):
        """Its reader trusted, the tool refuses at its start what the confirmation would, and the change it would replace stands."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            plain = await administrator_starts(database, client, grund=GRUND)
            await granted(database, FOREIGN_EMAIL)
            refused = await refused_code(administrator_starts(database, client, grund=GRUND, email=FOREIGN_EMAIL))
            return plain, refused, await change(database, plain.id)

        plain, refused, record = on_a_person(mongo_replica_set_url, body)

        assert (plain.weg, plain.token is not None, plain.genehmiger_anzahl) == ("wartezeit", True, 0)
        assert (refused, record["beendet"], record["grund"]) == (ADRESSWECHSEL_BELEGT, None, GRUND)

    def test_the_mint_names_the_person_only_where_the_address_on_file_is_asked_first(self, mongo_replica_set_url: str):
        """On the lost-mailbox way the address on file may be a stranger's by now, so its notice is handed no name to greet."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            asked = await administrator_starts(database, client, grund=None)
            lost = await administrator_starts(database, client, grund=GRUND)
            return asked, lost, await resend(database, client, lost.id)

        asked, lost, resent = on_a_person(mongo_replica_set_url, body)

        assert [(mint.weg, mint.vorname) for mint in (asked, lost, resent)] == [
            ("freigabe", "Lenore"),
            ("wartezeit", None),
            ("wartezeit", None),
        ]

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
        assert self.refused_start(mongo_replica_set_url, "ban") == (ADRESSWECHSEL_GESPERRT, 0)

    def test_another_pupil_s_address_is_refused(self, mongo_replica_set_url: str):
        assert self.refused_start(mongo_replica_set_url, email=OTHER_EMAIL) == (ADRESSWECHSEL_VERGEBEN, 0)

    def test_the_address_on_file_respelled_is_refused(self, mongo_replica_set_url: str):
        assert self.refused_start(mongo_replica_set_url, email=TYPED) == (ADRESSWECHSEL_UNVERAENDERT, 0)

    def test_an_address_holding_nothing_is_refused(self, mongo_replica_set_url: str):
        assert self.refused_start(mongo_replica_set_url, adresse="nobody@schule.example") == (ADRESSWECHSEL_NICHTS, 0)

    def test_a_reason_naming_the_person_is_refused(self, mongo_replica_set_url: str):
        """The log keeps the reason a year beside the start."""

        assert self.refused_start(mongo_replica_set_url, grund="Lenore rief an") == (ADRESSWECHSEL_NAME_IM_GRUND, 0)

    def test_the_administrator_s_own_address_is_refused(self, mongo_replica_set_url: str):
        assert self.refused_start(mongo_replica_set_url, adresse=ADMIN) == (EIGENE_ADRESSE, 0)

    def test_a_grant_holder_s_address_is_refused_without_an_owner_s_power(self, mongo_replica_set_url: str):
        assert self.refused_start(mongo_replica_set_url, "grant") == (VERWALTUNG_ADRESSE, 0)

    def test_an_owner_starts_a_grant_holder_s_change_which_another_administrator_approves(self, mongo_replica_set_url: str):
        """Four eyes on the tool: the owner who started it is no approver, so the change names the others alone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            started = await administrator_starts(database, client, grund=GRUND, operator=OWNER)
            refused = await refused_code(approve(database, client, started.id, operator=OWNER))
            return refused, await change(database, started.id), await approvers_told(database, client)

        refused, record, [told] = on_a_person(mongo_replica_set_url, body)

        assert told and OWNER not in told and EMAIL not in told
        assert record["genehmigung"]["gestartet_von"] == OWNER
        assert refused == ADRESSWECHSEL_GENEHMIGUNG_VERWEHRT


class TestTheTool:
    def test_it_reads_the_address_by_kind_and_its_change_whole(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=GRUND)
            return started, await tool_read(database, client, adresse=TYPED), await tool_read(database, client, adresswechsel_id=started.id)

        started, by_address, by_id = on_a_person(mongo_replica_set_url, body)

        assert by_address.model_dump() == by_id.model_dump()
        assert by_address.bestand.model_dump() == {
            "spieler": 1,
            "schiedsrichter": 1,
            "sitze": 1,
            "bewerbungssitze": 2,
            "registrierungen": 2,
            "berechtigung": None,
        }
        assert by_address.offen is not None
        assert (by_address.offen.id, by_address.offen.email, by_address.offen.grund) == (started.id, NEW_EMAIL, GRUND)

    def test_an_ended_change_s_id_is_refused_and_an_unknown_one_not_found(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=GRUND)
            await discard(database, client, started.id)
            ended = await refused_code(tool_read(database, client, adresswechsel_id=started.id))
            with pytest.raises(DocumentNotFoundException):
                await tool_read(database, client, adresswechsel_id=ObjectId())
            return ended, await refused_code(discard(database, client, started.id)), await refused_code(resend(database, client, started.id))

        assert on_a_person(mongo_replica_set_url, body) == (ADRESSWECHSEL_BEENDET,) * 3

    def test_the_re_send_replaces_the_link_and_keeps_the_stop_link(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=GRUND)
            before = await change(database, started.id)
            sent = await resend(database, client, started.id, germany_now=NOW + timedelta(hours=2))
            return started, before, sent, await change(database, started.id), await refused_code(view(database, client, started.token))

        started, before, sent, after, old = on_a_person(mongo_replica_set_url, body)

        assert (sent.stopp_token, after["token_hash"], after["stopp_hash"]) == (None, hash_token(sent.token), before["stopp_hash"])
        assert after["gueltig_bis"] > before["gueltig_bis"]
        # The replaced link opens nothing: its hash is gone from the record.
        assert old == ADRESSWECHSEL_UNBEKANNT

    def test_a_change_not_waiting_on_the_new_mailbox_is_sent_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=None)
            with pytest.raises(DocumentNotFoundException):
                await resend(database, client, started.id)
            return "not found"

        assert on_a_person(mongo_replica_set_url, body) == "not found"

    def test_a_confirmed_change_is_sent_no_fresh_link(self, mongo_replica_set_url: str):
        """A deadline set again on a change waiting out its time would make the pass end it lapsed rather than let it take effect."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=GRUND)
            await answer(database, client, started.token)
            with pytest.raises(DocumentNotFoundException):
                await resend(database, client, started.id)
            return (await change(database, started.id))["gueltig_bis"]

        assert on_a_person(mongo_replica_set_url, body) is None

    @pytest.mark.parametrize("route", ["read-by-address", "read-by-id", "re-send", "discard"])
    @pytest.mark.parametrize(("whose", "refused"), [("own", EIGENE_ADRESSE), ("grant-holder", VERWALTUNG_ADRESSE)])
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
                "read-by-id": lambda: tool_read(database, client, adresswechsel_id=started.id),
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

        assert (stale, record["beendet"]["art"]) == (ADRESSWECHSEL_BEENDET, "verworfen")
        assert held == {NEW_EMAIL: []}
        assert [(line.art, line.record_id) for line in journal] == [("adresswechsel_verworfen", later)]


async def approvers_told(database: AsyncDatabase, client: AsyncMongoClient, *, now: datetime = NOW) -> list[list[str] | None]:
    """Whom the grants' pass mails each address change's approval notice it claims, as the system actor claims."""

    token = actor_var.set(SYSTEM_ACTOR)
    try:
        answer = await call(post_berechtigungen_abgleich, database, client, now=now)
    finally:
        actor_var.reset(token)

    return [None if row.an is None else sorted(row.an) for row in answer.aenderungen if row.art == "adresswechsel"]


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
            return code, (await change(database, minted.id))["beendet"]["art"], await owed(database)

        code, art, notices = on_a_person(mongo_replica_set_url, body)

        assert (code, art) == (ADRESSWECHSEL_NICHTS, "verworfen")
        assert [(notice["art"], notice["email"]) for notice in notices] == [("verworfen", NEW_EMAIL)]

    def test_its_approvers_are_told_once_through_the_grants_outbox_and_nobody_once_it_is_given(self, mongo_replica_set_url: str):
        """Read at the claim, so a retry after the approval mails nobody; queued in the start's transaction, its answer carrying none."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            first = await approvers_told(database, client)
            await approve(database, client, minted.id, operator=ADMIN)
            # The lease lapsed, the row unstamped, as a failed delivery leaves it.
            return minted.genehmiger_anzahl, first, await approvers_told(database, client, now=NOW + timedelta(minutes=11))

        anzahl, [first], after = on_a_person(mongo_replica_set_url, body)

        assert len(first) == anzahl > 0
        assert after == [[]]

    def test_an_approval_before_the_confirmation_lets_the_confirmation_take_effect(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            approved = await approve(database, client, minted.id)
            answered = await answer(database, client, minted.token)
            return approved, answered

        approved, answered = on_a_person(mongo_replica_set_url, body)

        assert approved.wirksam is False
        assert answered.wirksam

    def test_a_confirmation_before_the_approval_waits_and_the_approval_takes_effect(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            answered = await answer(database, client, minted.token)
            seen, waiting = await read(database, client), await everything(database)
            approved = await approve(database, client, minted.id)
            return answered, seen, waiting, approved, await everything(database)

        answered, seen, waiting, approved, after = on_a_person(mongo_replica_set_url, body)

        assert (answered.wirksam, answered.genehmigung_offen) == (False, True)
        assert seen.offen is not None and (seen.offen.wartet_auf, seen.offen.genehmigung.genehmigt) == ("genehmigung", False)
        assert waiting["pupil"]["email"] == EMAIL
        assert approved.wirksam
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
            return refused, (await change(database, minted.id))["genehmigung"]["genehmigt_am"]

        return on_a_person(url, body)

    def test_the_changed_address_approves_nothing_of_its_own(self, mongo_replica_set_url: str):
        assert self.refused_approval(mongo_replica_set_url, approver=EMAIL, verwaltung="administration") == (
            ADRESSWECHSEL_GENEHMIGUNG_VERWEHRT,
            None,
        )

    def test_the_administrator_who_started_it_approves_nothing_of_their_own(self, mongo_replica_set_url: str):
        """A grant holder's address is the tool's to change for an owner alone, so the starter here is one."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            started = await administrator_starts(database, client, grund=GRUND, operator=OWNER)
            refused = await refused_code(approve(database, client, started.id, operator=OWNER))
            return refused, (await change(database, started.id))["genehmigung"]["genehmigt_am"]

        assert on_a_person(mongo_replica_set_url, body) == (ADRESSWECHSEL_GENEHMIGUNG_VERWEHRT, None)

    def test_the_grants_list_names_the_waiting_change_on_its_row_with_why_its_reader_may_not_approve_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            lists = [await call(get_berechtigungen, database, client, operator=EMAIL), await call(get_berechtigungen, database, client)]
            await answer(database, client, minted.token)
            lists.append(await call(get_berechtigungen, database, client))
            return minted.id, [{row.adresse: row.adresswechsel for row in listed.berechtigungen} for listed in lists]

        minted, (own, others, confirmed) = on_a_person(mongo_replica_set_url, body)

        assert own[EMAIL] is not None and own[EMAIL].verwehrt == "eigene"
        assert others[EMAIL] is not None
        assert (others[EMAIL].id, others[EMAIL].email, others[EMAIL].bestaetigt, others[EMAIL].verwehrt) == (minted, NEW_EMAIL, False, None)
        # The person's own start: its starter is the row's own address, and no reason is asked of it.
        assert (others[EMAIL].weg, others[EMAIL].gestartet_von, others[EMAIL].grund) == ("konto", None, None)
        assert confirmed[EMAIL] is not None and confirmed[EMAIL].bestaetigt
        # Every other row names no change, its grant's address having none waiting.
        assert {adresse: change for adresse, change in others.items() if adresse != EMAIL} == dict.fromkeys(set(others) - {EMAIL})

    def test_the_grants_list_names_who_started_a_change_how_and_why(self, mongo_replica_set_url: str):
        """What a pretext hides: an administrator's start for a lost mailbox, beside the reason they recorded."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            await administrator_starts(database, client, grund=GRUND, operator=OWNER)
            listed = await call(get_berechtigungen, database, client, operator=SECOND_ADMIN)
            return {row.adresse: row.adresswechsel for row in listed.berechtigungen}[EMAIL]

        row = on_a_person(mongo_replica_set_url, body)

        assert row is not None
        assert (row.email, row.weg, row.gestartet_von, row.gestartet_von_gesperrt, row.grund) == (NEW_EMAIL, "wartezeit", OWNER, False, GRUND)

    def test_an_owner_s_change_tells_a_non_owner_none_of_its_address_starter_or_reason(self, mongo_replica_set_url: str):
        """The address tool refuses them an owner's address (`REQ-PURGE-005`), so the approval row may not serve it either."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database, verwaltung="owner")
            # A second owner beside the starter, so an owner's change has an approver.
            await database[Collection.BERECHTIGUNGEN].update_one({"adresse": SECOND_ADMIN}, {"$set": {"verwaltung": "owner"}})
            await administrator_starts(database, client, grund=GRUND, operator=OWNER)
            rows = []
            for reader in (ADMIN, SECOND_ADMIN):
                listed = await call(get_berechtigungen, database, client, operator=reader)
                rows.append({row.adresse: row.adresswechsel for row in listed.berechtigungen}[EMAIL])
            return rows

        non_owner, owner = on_a_person(mongo_replica_set_url, body)

        assert non_owner is not None and owner is not None
        assert (non_owner.verwehrt, non_owner.email, non_owner.gestartet_von, non_owner.grund) == ("inhaber", None, None, None)
        assert (owner.email, owner.gestartet_von, owner.grund) == (NEW_EMAIL, OWNER, GRUND)

    def test_a_barred_new_address_and_a_barred_starter_are_withheld(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            await administrator_starts(database, client, grund=GRUND, operator=OWNER)
            await database[Collection.SPERRLISTE].insert_many(
                [documents.ban_document(address, bis=SAISON_ID) for address in (NEW_EMAIL, OWNER)]
            )
            listed = await call(get_berechtigungen, database, client, operator=SECOND_ADMIN)
            return {row.id: row.adresswechsel for row in listed.berechtigungen if row.gesperrt is False and row.adresse == EMAIL}

        (row,) = on_a_person(mongo_replica_set_url, body).values()

        assert row is not None
        assert (row.email, row.email_gesperrt, row.gestartet_von, row.gestartet_von_gesperrt) == (None, True, None, True)

    def test_a_barred_grant_s_row_carries_no_waiting_change(self, mongo_replica_set_url: str):
        """Its own address is withheld, so its change, which names the new one and offers the approval, is too."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            await start(database, client)
            await database[Collection.SPERRLISTE].insert_one(documents.ban_document(EMAIL, bis=SAISON_ID))
            listed = await call(get_berechtigungen, database, client, operator=SECOND_ADMIN)
            return [(row.adresse, row.adresswechsel) for row in listed.berechtigungen if row.gesperrt]

        assert on_a_person(mongo_replica_set_url, body) == [(None, None)]

    def test_a_change_past_its_approval_week_is_offered_to_nobody(self, mongo_replica_set_url: str):
        """Its approval is refused then (`REQ-ADRESSWECHSEL-003`), and a reload the refusal asks for must not offer it again."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            await answer(database, client, minted.token)
            listed = await call(get_berechtigungen, database, client, operator=SECOND_ADMIN, now=AFTER_THE_WEEK)
            return {row.adresse: row.adresswechsel for row in listed.berechtigungen}[EMAIL]

        assert on_a_person(mongo_replica_set_url, body) is None

    def test_a_change_whose_link_lapsed_unconfirmed_is_offered_to_nobody(self, mongo_replica_set_url: str):
        """Refused `-003` as a lapsed week is, so the reload that refusal asks for must not offer it again."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            refused = await refused_code(approve(database, client, minted.id, operator=SECOND_ADMIN, germany_now=AFTER_THE_DEADLINE))
            listed = await call(get_berechtigungen, database, client, operator=SECOND_ADMIN, now=AFTER_THE_DEADLINE)
            return refused, {row.adresse: row.adresswechsel for row in listed.berechtigungen}[EMAIL]

        assert on_a_person(mongo_replica_set_url, body) == (ADRESSWECHSEL_ABGELAUFEN, None)

    def test_an_owner_s_grant_is_approved_by_no_administrator(self, mongo_replica_set_url: str):
        assert self.refused_approval(mongo_replica_set_url, approver=ADMIN, verwaltung="owner") == (ADRESSWECHSEL_GENEHMIGUNG_INHABER, None)

    def test_a_change_asking_no_approval_or_given_one_takes_none(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            plain = await start(database, client, identifier=OTHER_EMAIL)
            await granted(database)
            asked = await start(database, client)
            await approve(database, client, asked.id)
            return await refused_code(approve(database, client, plain.id)), await refused_code(
                approve(database, client, asked.id, operator=SECOND_ADMIN)
            )

        assert on_a_person(mongo_replica_set_url, body) == (ADRESSWECHSEL_KEINE_GENEHMIGUNG_OFFEN,) * 2

    def test_unapproved_a_week_after_its_start_it_is_refused_and_the_pass_ends_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            await answer(database, client, minted.token)
            refused = await refused_code(approve(database, client, minted.id, germany_now=AFTER_THE_WEEK))
            swept = await sweep(database, client, germany_now=AFTER_THE_WEEK)
            return refused, swept.entfernt, await change(database, minted.id), await owed(database)

        refused, entfernt, record, notices = on_a_person(mongo_replica_set_url, body)

        assert (refused, entfernt, record["beendet"]["art"]) == (ADRESSWECHSEL_ABGELAUFEN, 1, "abgelaufen")
        # The new mailbox was told the change waits on the administration, so it is told it did not take effect.
        assert [(notice["art"], notice["email"], notice["vorname"]) for notice in notices] == [("verworfen", NEW_EMAIL, None)]

    def test_a_link_lapsing_unconfirmed_queues_nothing(self, mongo_replica_set_url: str):
        """Nobody confirmed it, so nobody waits to hear of it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await start(database, client)
            swept = await sweep(database, client, germany_now=AFTER_THE_DEADLINE)
            return swept.entfernt, await owed(database)

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

        assert (swept.entfernt, swept.verworfen, swept.wirksam, swept.verbleibend) == (1, 0, 0, 0)
        assert (record["beendet"]["art"], record["email"], record["grund"]) == ("abgelaufen", None, None)


class TestTheContactsEditorsRead:
    def test_each_confirmed_seat_names_its_address_s_live_change_and_none_once_it_ended(self, mongo_replica_set_url: str):
        """The confirmed Ansprechperson, typed otherwise, folds to the changed address and names its change.

        The Stellvertretung folds to it too but never confirmed, so the change moves nothing of it and names it nothing.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def seats() -> Any:
                read = await call(get_team_memberships, database, client, today=TODAY)
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
                await tool_read(database, client, adresswechsel_id=minted.id, operator=reader)
                verwehrt = None
            except WriteRefusalException as refused:
                verwehrt = {EIGENE_ADRESSE: "eigene", VERWALTUNG_ADRESSE: "verwaltung"}[refused.error_code]

            pupils = await call(get_spieler_memberships, database, client, operator=reader)
            referee = await call(get_schiedsrichter_by_id, database, client, schiedsrichter_id=REFEREE_OID, today=TODAY, operator=reader)
            teams = await call(get_team_memberships, database, client, today=TODAY, operator=reader)
            [seats] = [
                row.adresswechsel for team in teams.teams for row in team.memberships if row.saison_id == SAISON_ID and team.id == TEAM_OID
            ]
            reveal = await call(
                get_erasure_ansicht_auf_anfrage, database, client, ansicht_data=FLErasureAnsichtPayload(email=NEW_EMAIL), operator=reader
            )
            served = {
                "pupils": [
                    (player.adresswechsel_id, player.adresswechsel_einsehbar_verwehrt) for player in pupils.spieler if player.id == SPIELER_OID
                ],
                "referee": (referee.adresswechsel_id, referee.adresswechsel_einsehbar_verwehrt),
                "seats": (seats.ansprechperson, seats.einsehbar_verwehrt.model_dump()),
                "reveal": [(row.adresswechsel_id, row.einsehbar_verwehrt) for row in reveal.adresswechsel],
            }
            if grant:
                listed = await call(get_berechtigungen, database, client, operator=reader)
                waiting = {row.adresse: row.adresswechsel for row in listed.berechtigungen}[EMAIL]
                served["approval"] = None if waiting is None else (waiting.id, waiting.einsehbar_verwehrt)
            return minted.id, verwehrt, served

        minted, verwehrt, served = on_a_person(mongo_replica_set_url, body)

        assert verwehrt == {EMAIL: "eigene", ADMIN: "verwaltung" if grant else None, OWNER: None}[reader]
        expected = {
            "pupils": [(minted, verwehrt)],
            "referee": (minted, verwehrt),
            # The Trainer and the Stellvertretung wait on no change of the person's; the Stellvertretung is unconfirmed.
            "seats": (minted, {"trainer": None, "ansprechperson": verwehrt, "stellvertretung": None}),
            "reveal": [(minted, verwehrt)],
        }
        if grant:
            expected["approval"] = (minted, verwehrt)
        assert served == expected


class TestAGrantEndedBeforeTheApproval:
    """The approval a confirmation left owed is owed only while the address holds the grant it would move (I847)."""

    def test_the_pass_makes_the_change_take_effect_once_the_grant_is_gone(self, mongo_replica_set_url: str):
        """Revoked after the confirmation: nobody is offered the approval, and the change took effect regardless."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            grant = await granted(database)
            minted = await start(database, client)
            confirmed = await answer(database, client, minted.token)
            # Any route ending the grant, a revoke's, a tier change's or an erasure's, leaves no row at the address.
            await database[Collection.BERECHTIGUNGEN].delete_one({"_id": grant})
            listed = await call(get_berechtigungen, database, client, operator=SECOND_ADMIN)
            swept = await sweep(database, client, germany_now=NOW + timedelta(hours=1))
            offered = [row.adresswechsel for row in listed.berechtigungen if row.adresswechsel is not None]
            return (
                confirmed.genehmigung_offen,
                offered,
                swept,
                await change(database, minted.id),
                await owed(database),
                await everything(database),
            )

        offen, offered, swept, record, notices, after = on_a_person(mongo_replica_set_url, body)

        assert (offen, offered) == (True, [])
        assert (swept.wirksam, swept.verbleibend) == (1, 0)
        assert record["beendet"]["art"] == "wirksam"
        assert [(notice["art"], notice["bisherige_email"], notice["email"]) for notice in notices] == [("wirksam", EMAIL, NEW_EMAIL)]
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

        assert (swept.wirksam, swept.verworfen, swept.entfernt, swept.verbleibend) == (0, 0, 0, 0)
        assert (record["beendet"], notices) == (None, [])


class TestTheMovedGrant:
    def test_the_effect_revokes_the_grant_at_the_old_address_and_grants_it_at_the_new_under_the_approver(self, mongo_replica_set_url: str):
        """Announced as a revoke and a grant are, and dating from the move: no session older than it administers."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            old_grant = await granted(database)
            minted = await start(database, client)
            await approve(database, client, minted.id, operator=SECOND_ADMIN)
            await answer(database, client, minted.token)
            grants = {row["adresse"]: row async for row in database[Collection.BERECHTIGUNGEN].find({"adresse": {"$in": [EMAIL, NEW_EMAIL]}})}
            outbox = [row async for row in database[Collection.BERECHTIGUNGEN_POSTAUSGANG].find({}, sort=[("_id", 1)])]
            since = await live_unbarred_grant_since(
                NEW_EMAIL, berechtigungen_collection=database[Collection.BERECHTIGUNGEN], sperrliste=ban_list(database)
            )
            return old_grant, grants, outbox, since

        old_grant, grants, outbox, since = on_a_person(mongo_replica_set_url, body)

        assert list(grants) == [NEW_EMAIL]
        moved = grants[NEW_EMAIL]
        assert (moved["verwaltung"], moved["erteilt_von"], moved["_id"] != old_grant) == ("administration", SECOND_ADMIN, True)
        assert [(row["art"], (row["jetzt"] or row["vorher"] or {}).get("adresse"), row["geaendert_von"]) for row in outbox] == [
            # The start's word to its approvers, naming no grant, its starter carried to their new address.
            ("adresswechsel", None, NEW_EMAIL),
            # The paste no comparison has seen yet is announced first, as a revoke announces one.
            ("erteilt", EMAIL, None),
            ("entzogen", EMAIL, SECOND_ADMIN),
            ("erteilt", NEW_EMAIL, SECOND_ADMIN),
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

        assert (refused, rows["pupil"]["email"], grants) == (ADRESSWECHSEL_NICHT_GEDECKT, EMAIL, 1)

    def test_a_promotion_since_the_approval_is_not_covered(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            await approve(database, client, minted.id)
            await database[Collection.BERECHTIGUNGEN].update_one({"adresse": EMAIL}, {"$set": {"verwaltung": "owner"}})
            return await refused_code(answer(database, client, minted.token))

        assert on_a_person(mongo_replica_set_url, body) == ADRESSWECHSEL_NICHT_GEDECKT

    def test_a_grant_at_the_new_address_refuses_the_move(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            await approve(database, client, minted.id)
            await granted(database, NEW_EMAIL)
            return await refused_code(answer(database, client, minted.token))

        assert on_a_person(mongo_replica_set_url, body) == ADRESSWECHSEL_NEUE_BERECHTIGT

    def test_a_grant_only_account_moves_its_grant(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, identifier=SECOND_ADMIN)
            await approve(database, client, minted.id)
            answered = await answer(database, client, minted.token)
            return answered, sorted(await database[Collection.BERECHTIGUNGEN].distinct("adresse"))

        answered, addresses = on_a_person(mongo_replica_set_url, body, records=False)

        assert answered.wirksam
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

    await database[Collection.BERECHTIGUNGEN].insert_one({**grants_for_the_suite()[1], "_id": ObjectId(), "adresse": adresse, "erteilt_am": at})


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

        assert (refused, record["genehmigung"]["gestartet_von"], record["genehmigung"]["genehmigt_am"]) == (
            ADRESSWECHSEL_GENEHMIGUNG_VERWEHRT,
            OWNER_NEW_EMAIL,
            None,
        )

    def test_no_record_or_image_keeps_a_moved_administrator_s_replaced_address_past_their_erasure(self, mongo_replica_set_url: str):
        """A grant they made, its image and log row, their own change's starter and their revoked grant's image named it.

        The queued notice of the old grant's end keeps it until the reconciliation, unrun here, has told the administrators.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            await database[Collection.BERECHTIGUNGEN].insert_one(
                {**grants_for_the_suite()[1], "_id": ObjectId(), "adresse": FOREIGN_EMAIL, "erteilt_von": EMAIL}
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
            await erased(database, client, NEW_EMAIL)
            return await where_held(database, EMAIL, folded=True)

        assert on_a_person(mongo_replica_set_url, body, pupil=False, records=False) == {EMAIL: [Collection.BERECHTIGUNGEN_POSTAUSGANG]}

    def test_a_ban_an_invitation_and_a_decided_application_of_theirs_follow_them_past_their_erasure(self, mongo_replica_set_url: str):
        """Each record names its author by address alone, so one left at the replaced address outlives the erasure at the new."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            await database[Collection.SPERRLISTE].insert_one(documents.ban_document(FOREIGN_EMAIL, bis="2030", erstellt_von=EMAIL))
            await database[Collection.EINLADUNGEN].insert_one(
                compose_einladung(saison_id=SAISON_ID, team_id=TEAM_OID, token_hash="h" * 64, erstellt_von=EMAIL, today=TODAY)
            )
            await database[Collection.BEWERBUNGEN].insert_one(
                documents.bewerbung_document(
                    ObjectId(),
                    SAISON_ID,
                    "abgelehnt",
                    kontakte=documents.kontakte_document(),
                    eingereicht_am="2126-02-01",
                    entscheidung={"getroffen_am": "2126-02-15", "von": EMAIL, "grund": "kein Platz"},
                )
            )
            minted = await start(database, client)
            await approve(database, client, minted.id)
            await answer(database, client, minted.token)
            await erased(database, client, NEW_EMAIL)
            return await where_held(database, EMAIL, folded=True)

        # The queued notice of the old grant's end keeps it until the reconciliation, unrun here, has told the administrators.
        assert on_a_person(mongo_replica_set_url, body, pupil=False, records=False) == {EMAIL: [Collection.BERECHTIGUNGEN_POSTAUSGANG]}

    def test_a_former_administrator_s_records_and_images_name_them_nowhere_past_their_erasure(self, mongo_replica_set_url: str):
        """Their grant ended before the change: what they made while holding it names them still.

        A grant they made, its image and log row, and their own grant's image; a database revoke queues nothing.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            own = await granted(database)
            await database[Collection.BERECHTIGUNGEN].insert_one(
                {**grants_for_the_suite()[1], "_id": ObjectId(), "adresse": FOREIGN_EMAIL, "erteilt_von": EMAIL}
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
            await erased(database, client, NEW_EMAIL)
            return await where_held(database, EMAIL, folded=True)

        # The pupil alone: the seed's other records keep the replaced address on rows no change moves, an unconfirmed seat's.
        assert on_a_person(mongo_replica_set_url, body, records=False) == {EMAIL: []}

    def test_an_approval_whose_approver_lost_their_grant_since_is_taken_off_and_asked_again(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            await approve(database, client, minted.id, operator=ADMIN)
            # Revoked in the database, as no route's refusal can reach: the effect judges it again.
            await database[Collection.BERECHTIGUNGEN].delete_one({"adresse": ADMIN})
            answered = await answer(database, client, minted.token)
            waiting = await change(database, minted.id), await everything(database)
            listed = await call(get_berechtigungen, database, client, operator=SECOND_ADMIN)
            told = await approvers_told(database, client)
            approved = await approve(database, client, minted.id, operator=SECOND_ADMIN)
            return answered, waiting, listed, told, approved

        answered, (record, rows), listed, told, approved = on_a_person(mongo_replica_set_url, body)

        assert (answered.wirksam, answered.genehmigung_offen) == (False, True)
        assert (record["genehmigung"]["genehmigt_am"], record["genehmigung"]["genehmigt_von"], rows["pupil"]["email"]) == (None, None, EMAIL)
        assert {row.adresse: row.adresswechsel for row in listed.berechtigungen}[EMAIL] is not None
        # Asked again: the start's notice and the one the withdrawal queued, each read for whoever could approve it now.
        assert told == [sorted([OWNER, SECOND_ADMIN, THIRD_ADMIN])] * 2
        assert approved.wirksam

    def test_an_approval_whose_approver_changed_their_own_address_since_stands_and_asks_nobody_again(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            await approve(database, client, minted.id, operator=ADMIN)
            await moved_on(database, client, ADMIN, ADMIN_NEW_EMAIL)
            answered = await answer(database, client, minted.token, germany_now=AN_HOUR_ON)
            return answered, await change(database, minted.id), await approvers_told(database, client, now=AN_HOUR_ON)

        answered, record, told = on_a_person(mongo_replica_set_url, body)

        assert (answered.wirksam, record["beendet"]["art"]) == (True, "wirksam")
        # The two starts' notices alone, each claimed for nobody once both changes ended: no withdrawal queued a third.
        assert told == [[], []]

    def test_an_administrator_who_changed_their_own_address_since_is_asked_and_approves(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            await moved_on(database, client, ADMIN, ADMIN_NEW_EMAIL)
            told = await approvers_told(database, client, now=AN_HOUR_ON)
            await approve(database, client, minted.id, operator=ADMIN_NEW_EMAIL, germany_now=AN_HOUR_ON)
            return told, await answer(database, client, minted.token, germany_now=AN_HOUR_ON)

        told, answered = on_a_person(mongo_replica_set_url, body)

        # The person's change, then the administrator's own, ended as the claim reads it.
        assert told == [sorted([ADMIN_NEW_EMAIL, OWNER, SECOND_ADMIN, THIRD_ADMIN]), []]
        assert answered.wirksam

    def test_an_administrator_granted_after_the_request_approves_nothing_of_it(self, mongo_replica_set_url: str):
        """Else one person grants a second mailbox they hold and approves with it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            later = NOW + timedelta(hours=1)
            await granted_later(database, LATE_ADMIN, at=later)
            refused = await refused_code(approve(database, client, minted.id, operator=LATE_ADMIN, germany_now=later))
            listed = await call(get_berechtigungen, database, client, operator=LATE_ADMIN)
            return refused, {row.adresse: row.adresswechsel for row in listed.berechtigungen}[EMAIL]

        refused, row = on_a_person(mongo_replica_set_url, body)

        assert (refused, row is not None and row.verwehrt) == (ADRESSWECHSEL_GENEHMIGUNG_JUENGER, "juenger")

    def test_a_second_change_leaves_the_first_one_s_address_in_no_image_past_the_erasure(self, mongo_replica_set_url: str):
        """The first change kept its new address in its images, which the second makes the replaced one."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await start(database, client)
            await answer(database, client, first.token)
            second = await start(database, client, identifier=NEW_EMAIL, email=THIRD_EMAIL)
            await answer(database, client, second.token)
            await erased(database, client, THIRD_EMAIL)
            return await where_held(database, NEW_EMAIL, folded=True)

        assert on_a_person(mongo_replica_set_url, body) == {NEW_EMAIL: []}


ANTRAG_OID = ObjectId("6890a1b2c3d4e5f6078500a1")
# The day before the suite's clock, inside the request's week.
ANTRAG_GESTELLT = NOW - timedelta(days=1)


async def requested(database: AsyncDatabase, *, adresse: str, gestartet_von: str) -> None:
    """A grant asked for `adresse`, undecided."""

    await database[Collection.BERECHTIGUNGEN_ANTRAEGE].insert_one(
        {
            "_id": ANTRAG_OID,
            **compose_antrag(
                adresse=adresse, verwaltung="administration", berechtigung_id=None, gestartet_von=gestartet_von, now=ANTRAG_GESTELLT
            ),
        }
    )


class TestTheRequestsForAGrantAnEffectMeets:
    """A request holds addresses, no identifier surviving a move: the effect carries its requester and ends one about the person."""

    def test_a_request_the_person_made_follows_them_past_their_erasure(self, mongo_replica_set_url: str):
        """Left on the replaced address, the request outlives the erasure at the new one, which finds who asked by equality."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            await requested(database, adresse=FOREIGN_EMAIL, gestartet_von=EMAIL)
            minted = await start(database, client)
            await approve(database, client, minted.id)
            await answer(database, client, minted.token)
            carried = await row(database, Collection.BERECHTIGUNGEN_ANTRAEGE, ANTRAG_OID)
            await erased(database, client, NEW_EMAIL)
            left = await database[Collection.BERECHTIGUNGEN_ANTRAEGE].count_documents({})
            return carried["genehmigung"]["gestartet_von"], left, await where_held(database, EMAIL, folded=True)

        # The queued notice of the old grant's end keeps the address until the reconciliation, unrun here, has told the administrators.
        assert on_a_person(mongo_replica_set_url, body, pupil=False, records=False) == (
            NEW_EMAIL,
            0,
            {EMAIL: [Collection.BERECHTIGUNGEN_POSTAUSGANG]},
        )

    def test_a_request_about_the_replaced_address_ends_as_a_refusal_ends_it(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """Approved, it would grant an address nobody holds; its refusal's own journal line keeps a restore from bringing it back."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await requested(database, adresse=EMAIL, gestartet_von=ADMIN)
            minted = await start(database, client)
            with journal_of(caplog) as journal:
                await answer(database, client, minted.token)
            return minted.id, await database[Collection.BERECHTIGUNGEN_ANTRAEGE].find_one({"_id": ANTRAG_OID}), journal

        change_id, antrag, journal = on_a_person(mongo_replica_set_url, body)

        assert antrag is None
        assert [(line.art, line.record_id) for line in journal] == [("antrag_abgelehnt", ANTRAG_OID), ("adresswechsel_wirksam", change_id)]
        # The refusal's own line, keyed as a refusal keys it, by the address the request was about.
        assert journal[0].person_hash == loeschung_journal_hash(EMAIL, schluessel=KEY)

    def test_a_decided_request_about_the_person_keeps_no_replaced_address_past_their_erasure(self, mongo_replica_set_url: str):
        """Its row is gone, so only its kept image names them, which the erasure at the new address reaches by address alone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await requested(database, adresse=EMAIL, gestartet_von=ADMIN)
            # Refused before the change, through its route, which keeps its image.
            await call(delete_antrag, database, client, antrag_id=ANTRAG_OID, operator=SECOND_ADMIN)
            await confirmed_and_moved(database, client)
            await erased(database, client, NEW_EMAIL)
            return await where_held(database, EMAIL, folded=True)

        # The pupil alone: the seed's other records keep the replaced address on rows no change moves, an unconfirmed seat's.
        assert on_a_person(mongo_replica_set_url, body, records=False) == {EMAIL: []}


async def outcome_code(call: Awaitable[Any]) -> str | None:
    """`None` for a press that landed, its refusal's code otherwise."""

    try:
        await call
    except WriteRefusalException as refused:
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

        assert sorted(codes, key=str) == [None, ADRESSWECHSEL_VERGEBEN]
        assert len(holders) == 1
        # The loser moved nothing, and its change stands for its person to see.
        assert sorted(record["beendet"] is None for record in changes.values()) == [False, True]

    def test_a_confirmation_and_a_discard_of_one_change_leave_one_of_them(self, mongo_replica_set_url: str):
        """Both end the one record, so whichever commits second meets the first and finds the change ended."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            confirmed, discarded = await asyncio.gather(
                outcome_code(answer(database, client, minted.token)), outcome_code(discard(database, client, minted.id))
            )
            return confirmed, discarded, (await change(database, minted.id))["beendet"]["art"], (await everything(database))["pupil"]["email"]

        confirmed, discarded, art, address = on_a_person(mongo_replica_set_url, body)

        if confirmed is None:
            assert (discarded, art, address) == (ADRESSWECHSEL_BEENDET, "wirksam", NEW_EMAIL)
        else:
            assert (confirmed, discarded, art, address) == (ADRESSWECHSEL_BEENDET, None, "verworfen", EMAIL)


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
            await answer(database, client, minted.token, "abgelehnt", **given)
            return (await change(database, minted.id))["beendet"]["art"], await where_held(database, NEW_EMAIL, folded=True)

        art, held = on_a_person(mongo_replica_set_url, body)

        assert (art, held) == ("abgelehnt", {NEW_EMAIL: []})


class TestTheReSendsRefusals:
    def test_a_new_address_barred_since_the_start_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=GRUND)
            await ban_through_the_route(database, client, email=NEW_EMAIL, grund="Falschangaben", von="admin@frankfurtleague.de", today=TODAY)
            return await refused_code(resend(database, client, started.id))

        assert on_a_person(mongo_replica_set_url, body) == ADRESSWECHSEL_GESPERRT

    def test_a_new_address_another_pupil_has_come_to_sign_in_on_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=GRUND)
            await database[Collection.SPIELER].update_one({"_id": OTHER_OID}, {"$set": {"email": NEW_EMAIL}})
            return await refused_code(resend(database, client, started.id))

        assert on_a_person(mongo_replica_set_url, body) == ADRESSWECHSEL_VERGEBEN

    def test_a_grant_s_change_past_its_approval_week_mints_no_dead_link(self, mongo_replica_set_url: str):
        """Its link would be refused on its press; a lapsed link alone is still re-sent, the week standing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            started = await administrator_starts(database, client, grund=GRUND, operator=OWNER)
            within = await resend(database, client, started.id, operator=OWNER, germany_now=AFTER_THE_DEADLINE)
            past = await refused_code(resend(database, client, started.id, operator=OWNER, germany_now=AFTER_THE_WEEK))
            return within.token is not None, past

        assert on_a_person(mongo_replica_set_url, body) == (True, ADRESSWECHSEL_ABGELAUFEN)


class TestTheWaitingTime:
    def test_the_stop_link_ends_it_during_the_wait(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=GRUND)
            await answer(database, client, started.token)
            seen = await view(database, client, started.stopp_token, germany_now=NOW + timedelta(days=3))
            await stop_by_link(database, client, started.stopp_token)
            return seen, await sweep(database, client, germany_now=AFTER_THE_WAIT), await everything(database)

        seen, swept, after = on_a_person(mongo_replica_set_url, body)

        assert (seen.ansicht.seite, seen.ansicht.zustand) == ("bisherig", "wartezeit")
        assert swept.wirksam == 0
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

        assert swept.verworfen == 1
        assert notices == [{"art": "verworfen", "bisherige_email": None, "email": NEW_EMAIL, "vorname": None, "weg": None}]
        assert [(line.art, line.record_id, line.person_hash) for line in journal] == [
            ("adresswechsel_verworfen", started, loeschung_journal_hash(NEW_EMAIL, schluessel=KEY))
        ]


DECLINED_REG_OID = ObjectId("6890a1b2c3d4e5f607850053")
ANSWERED_OID = ObjectId("6890a1b2c3d4e5f607850063")


async def confirmed_and_moved(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    minted = await start(database, client)
    await answer(database, client, minted.token)


class TestWhatTheEffectLeavesTheErasure:
    """Everything of the person the replaced address keyed, within reach of an erasure of the new one."""

    def test_the_old_mailbox_s_registration_link_confirms_nothing_afterwards(self, mongo_replica_set_url: str):
        """An unanswered registration moves too, or its admission makes a second person; its link stayed in the replaced mailbox."""

        def ansicht(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            payload = FLRegistrierungBestaetigungAnsichtPayload(token=UNCONFIRMED_REG_LINK)
            return call(get_bestaetigung_ansicht, database, client, ansicht_data=payload, today=TODAY)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await ansicht(database, client)
            await confirmed_and_moved(database, client)
            return before, await refused_code(ansicht(database, client))

        before, after = on_a_person(mongo_replica_set_url, body)

        assert (before.zustand, after) == ("gueltig", REGISTRIERUNG_TOKEN_UNKNOWN)

    def test_a_registration_whose_reminder_went_out_is_owed_one_at_the_new_address(self, mongo_replica_set_url: str):
        """The reminder alone mints a moved registration a link, and it is owed once: spent, the row waits for its sweep."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.REGISTRIERUNGEN].update_one({"_id": UNCONFIRMED_REG_OID}, {"$set": {"bestaetigung.erinnert_am": TODAY}})
            await confirmed_and_moved(database, client)
            return await row(database, Collection.REGISTRIERUNGEN, UNCONFIRMED_REG_OID)

        moved = on_a_person(mongo_replica_set_url, body)

        assert (moved["email"], moved["bestaetigung"]["erinnert_am"]) == (NEW_EMAIL, None)
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
            partei={"art": "team", "team_id": TEAM_OID},
            _id=ANSWERED_OID,
            angefragt_am="2126-03-30",
            antwort=documents.kontakt_antwort_document("ansprechperson", TYPED, begruendung="Wir sind auf Klassenfahrt"),
        )

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELBESTAETIGUNGEN].insert_one(answered)
            # A write of theirs while signed in, which files a log row under their pseudonym holding the answer's image.
            token = actor_var.set(PersonActor(pseudonym=akteur_pseudonym(EMAIL, schluessel=KEY), funktion="kontakt"))
            try:
                await patch_one_in_db(
                    collection=database[Collection.SPIELBESTAETIGUNGEN],
                    db_filter={"_id": ANSWERED_OID},
                    update={"$set": {"angefragt_am": "2126-03-31"}},
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
                        await log.count_documents({"actor.pseudonym": akteur_pseudonym(address, schluessel=KEY)}),
                        await log.count_documents({"before.antwort.von.halter": halter_of(address, schluessel=KEY)}),
                    )
                    for address in (EMAIL, NEW_EMAIL)
                },
            )

        antwort, log = on_a_person(mongo_replica_set_url, body)

        assert (antwort["von"]["halter"], antwort["begruendung"]) == (halter_of(NEW_EMAIL, schluessel=KEY), "Wir sind auf Klassenfahrt")
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
            eingereicht_am="2126-03-30",
            frist="2126-04-06",
            bestaetigt=None,
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
                (await row(database, Collection.REGISTRIERUNGEN, DECLINED_REG_OID))["entscheidung"]["von"],
                {address: await log.count_documents({"before.entscheidung.von": address}) for address in (EMAIL, NEW_EMAIL)},
            )

        von, images = on_a_person(mongo_replica_set_url, body)

        assert von == NEW_EMAIL
        assert images[EMAIL] == 0 and images[NEW_EMAIL] >= 1

    def test_the_day_s_counts_follow_the_pseudonym(self, mongo_replica_set_url: str):
        """Keyed by the address's pseudonym; left behind, every effect would hand the person a fresh day of starts."""

        alt, neu = akteur_pseudonym(EMAIL, schluessel=KEY), akteur_pseudonym(NEW_EMAIL, schluessel=KEY)
        far_off = NOW + timedelta(days=2)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            counts = database[Collection.DROSSELUNG]
            # Two kinds under the replaced address, and one the new address already holds, which the carry adds to.
            await counts.insert_many(
                [
                    {"_id": f"adresswechsel:{alt}:{TODAY}", "n": 3, "ablauf": far_off},
                    {"_id": f"kontakt:{alt}:{TODAY}", "n": 2, "ablauf": far_off},
                    {"_id": f"adresswechsel:{neu}:{TODAY}", "n": 1, "ablauf": far_off},
                ]
            )
            await confirmed_and_moved(database, client)
            return {
                address: sorted([(row["_id"].split(":")[0], row["n"]) async for row in counts.find(build_counts_filter(pseudonym))])
                for address, pseudonym in ((EMAIL, alt), (NEW_EMAIL, neu))
            }

        counts = on_a_person(mongo_replica_set_url, body)

        assert counts == {EMAIL: [], NEW_EMAIL: [("adresswechsel", 4), ("kontakt", 2)]}

    def test_an_earlier_effect_s_queued_notice_follows_the_person(self, mongo_replica_set_url: str):
        """Its account goes where the person is now, and an erasure of the new address finds the row."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            earlier = compose_postausgang(art="wirksam", email=EMAIL, now=NOW, bisherige_email=FOREIGN_EMAIL, vorname="Lenore", weg="konto")
            await database[Collection.ADRESSWECHSEL_POSTAUSGANG].insert_one(earlier)
            await confirmed_and_moved(database, client)
            return [(notice["bisherige_email"], notice["email"]) for notice in await owed(database)]

        assert on_a_person(mongo_replica_set_url, body) == [(FOREIGN_EMAIL, NEW_EMAIL), (EMAIL, NEW_EMAIL)]

    def test_it_anchors_the_address_it_replaces(self, mongo_replica_set_url: str):
        """A registration submitted there while the effect runs meets it on the anchor, so the retry moves it rather than leaving it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            anchor = {"_id": adressanker_id(EMAIL, schluessel=KEY)}
            before = await database[Collection.ADRESSANKER].find_one(anchor)
            await answer(database, client, minted.token)
            after = await database[Collection.ADRESSANKER].find_one(anchor)
            return (before or {}).get(ANCHOR_FIELD, 0), (after or {}).get(ANCHOR_FIELD, 0)

        before, after = on_a_person(mongo_replica_set_url, body)

        assert after == before + 1


class TestTheErasure:
    def test_a_seat_left_before_the_change_goes_with_the_erasure_at_the_new_address(self, mongo_replica_set_url: str):
        """The editor's image of the seat the person left names them by the replaced address, which no document holds.

        The unconfirmed seat still standing at that address keeps it: an erasure there reaches it.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            replacement = {**documents.kontaktperson_document("Vera", bestaetigt_am="2126-03-21"), "nachname": "Zwirnbach"}
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
            await erased(database, client, NEW_EMAIL)
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
    def test_a_referee_row_left_before_the_change_goes_with_the_erasure_at_the_new_address(
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
            await erased(database, client, NEW_EMAIL)
            logged = await database[Collection.AKTIONEN].find_one(
                {"collection": Collection.SCHIEDSRICHTER, "document_id": UNCONFIRMED_REFEREE_OID}
            )
            assert logged is not None, "the editor's write filed no log row"
            return logged["before"]["kontakt"]["email"]

        assert on_a_person(mongo_replica_set_url, body) == kept

    def test_an_erased_new_address_ends_another_address_s_change_and_holds_it_nowhere(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            await erased(database, client, NEW_EMAIL)
            return await change(database, minted.id), await where_held(database, NEW_EMAIL, folded=True)

        record, held = on_a_person(mongo_replica_set_url, body)

        assert (record["beendet"]["art"], record["email"]) == ("verworfen", None)
        assert held == {NEW_EMAIL: []}

    def test_an_erased_address_on_file_ends_its_own_change_and_neither_address_is_held(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            await erased(database, client, EMAIL)
            return await change(database, minted.id), await where_held(database, EMAIL, NEW_EMAIL, folded=True)

        record, held = on_a_person(mongo_replica_set_url, body)

        assert (record["beendet"]["art"], record["adresse"], record["email"]) == ("verworfen", None, None)
        assert held == {EMAIL: [], NEW_EMAIL: []}


def erased(database: AsyncDatabase, client: AsyncMongoClient, email: str) -> Any:
    """The erasure on request, as an owner whose step-up window the HTTP suites hold."""

    return call(
        erase_auf_anfrage,
        database,
        client,
        erasure_data=FLErasurePayload(email=email, anlass="Auf Anfrage per Brief"),
        operator=OWNER,
        refuse_unconfirmed=lambda: None,
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

            live = await database[Collection.ADRESSWECHSEL].find({"beendet": None}).to_list(None)
            return held.reads, held.insert_failures, [row["_id"] for row in live], minted.id, (await change(database, rival.id))["beendet"]

        reads, failures, live, minted, rival_end = on_a_person(mongo_replica_set_url, body)

        assert reads == 2
        assert failures == ["OperationFailure:112"]
        assert live == [minted]
        assert rival_end["art"] == "ersetzt"


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

    def test_the_pupils_list_joins_their_changes_through_the_unique_index(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await start(database, client)
            return await database.command(
                {
                    "explain": {"aggregate": Collection.SPIELER, "pipeline": build_spieler_memberships_pipeline(), "cursor": {}},
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
                rows = await (await database[Collection.SPIELER].aggregate(build_spieler_memberships_pipeline())).to_list()
                return {row["_id"]: row["adresswechsel_id"] for row in rows}

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
        """Pinned to `beendet.am`, a date an ended change holds and a live one never: keyed on another, the index expires live changes."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            ended = await start(database, client)
            await stop_here(database, client)
            # Standing beside the ended one, so the date read below is shown absent from a live change.
            await start(database, client, identifier=OTHER_EMAIL)
            built = {index["name"]: index async for index in await database[Collection.ADRESSWECHSEL].list_indexes()}
            ttl = built["adresswechsel_beendet_am"]
            dated = await database[Collection.ADRESSWECHSEL].distinct("_id", {"beendet.am": {"$type": "date"}})
            return (
                (dict(ttl["key"]), ttl.get("expireAfterSeconds")),
                dated,
                ended.id,
                await database[Collection.ADRESSWECHSEL].count_documents({}),
            )

        index, dated, ended, stored = on_a_person(mongo_replica_set_url, body)

        assert index == ({"beendet.am": 1}, ADRESSWECHSEL_NACHLAUF_TAGE * 86400)
        assert (dated, stored) == ([ended], 2)
