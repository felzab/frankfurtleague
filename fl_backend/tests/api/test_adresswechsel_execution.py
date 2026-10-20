"""
API · one address's change of the address it signs in on, driven end to end against the shipped validators

The person starts it on their own account page, an administrator through the address tool for a person who cannot sign
in, and the new mailbox's confirmation, an administrator's approval of a grant's move, or the hourly pass at the end of a
waiting time moves everything the replaced address holds in one write. The pass's share and failures are
`tests/api/test_adresswechsel_sweep_execution.py`'s.
"""

import asyncio
import logging
from collections.abc import Awaitable, Mapping
from datetime import UTC, timedelta
from typing import Any, cast

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from app.api.adresswechsel.services import (
    ADRESSWECHSEL_ABGELAUFEN,
    ADRESSWECHSEL_BEENDET,
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
)
from app.api.berechtigungen.admin_router import get_berechtigungen
from app.api.berechtigungen.crud import live_unbarred_grant_since
from app.api.berechtigungen.services import signed_in_since
from app.api.bewerbungen.services import hash_token
from app.api.identitaet.admin_router import erase_auf_anfrage
from app.api.identitaet.crud import find_anmeldung, find_subjekt
from app.api.identitaet.schemas import FLErasurePayload
from app.api.identitaet.services import EIGENE_ADRESSE, VERWALTUNG_ADRESSE
from app.api.registrierungen.einwilligung_router import get_bestaetigung_ansicht
from app.api.registrierungen.schemas import FLRegistrierungBestaetigungAnsichtPayload
from app.api.registrierungen.services import REGISTRIERUNG_TOKEN_UNKNOWN, compose_ablehnung_update, erinnerung_is_due
from app.api.spielbestaetigungen.services import halter_of
from app.api.spieler.services import build_spieler_memberships_pipeline
from app.api.teams.admin_router import get_team_memberships
from app.core.adressanker import adressanker_id
from app.core.collections import Collection
from app.core.crud import ANCHOR_FIELD, patch_one_in_db
from app.core.exceptions import DocumentNotFoundException, WriteRefusalException
from app.core.journal import JOURNAL_TOKEN, parse_line
from app.core.recording import Actor, PersonActor, actor_var
from app.core.security import akteur_pseudonym, loeschung_journal_hash
from app.shared.schemas.bounds import ADRESSWECHSEL_NACHLAUF_TAGE
from tests import documents
from tests.bans import ban_list, ban_through_the_route
from tests.config import build_test_config, grants_for_the_suite
from tests.documents import spieler_document
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
    ROW_OID,
    SAISON_ID,
    SECOND_ADMIN,
    SECOND_TEAM_OID,
    SPIELER_OID,
    TEAM_OID,
    TODAY,
    TYPED,
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
ADDRESSLESS_OID = ObjectId("6890a1b2c3d4e5f607850099")


def on_a_person(url: str, body: Any, **seeded: Any) -> Any:
    return _on_a_person(url, DATABASE_NAME, body, **seeded)


def journal_lines(caplog: pytest.LogCaptureFixture) -> list[Any]:
    return [parse_line(record.getMessage()) for record in caplog.records if record.getMessage().startswith(JOURNAL_TOKEN)]


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


class TestThePersonsStart:
    def test_it_writes_one_record_keyed_by_the_address_with_both_links(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, identifier=EMAIL)
            return minted, await change(database, minted.id), await everything(database)

        minted, record, rows = on_a_person(mongo_replica_set_url, body)

        assert (minted.email, minted.bisherige_email, minted.vorname, minted.genehmiger) == (NEW_EMAIL, EMAIL, "Lenore", [])
        assert (record["adresse"], record["email"], record["weg"], record["beendet"], record["genehmigung"]) == (
            EMAIL,
            NEW_EMAIL,
            "konto",
            None,
            None,
        )
        assert (record["token_hash"], record["stopp_hash"]) == (hash_token(minted.token), hash_token(minted.stopp_token))
        # Nothing of the person moves at the start.
        assert (rows["pupil"]["email"], rows["referee"]["kontakt"]["email"]) == (EMAIL, TYPED)

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
            ["acknowledged", "bisherige_email", "email", "genehmiger", "gueltig_bis", "id", "stopp_token", "token", "vorname"],
            NEW_EMAIL,
        )

    def test_the_address_signed_in_on_is_refused_in_any_spelling(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await refused_code(start(database, client, email=TYPED.upper()))

        assert on_a_person(mongo_replica_set_url, body) == ADRESSWECHSEL_UNVERAENDERT

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
            return minted, await change(database, minted.id)

        minted, record = on_a_person(mongo_replica_set_url, body)

        assert sorted(minted.genehmiger) == sorted(
            ["admin@example.com", "admin@frankfurtleague.de", "spielorte.admin@example.com", "triage.quillhilde@example.com"]
        )
        genehmigung = record["genehmigung"]
        assert (genehmigung["verwaltung"], genehmigung["gestartet_von"], genehmigung["genehmigt_am"]) == ("administration", EMAIL, None)

    def test_the_last_owner_makes_another_before_changing_their_address(self, mongo_replica_set_url: str):
        """Nobody but another owner approves an owner's change, so a change nobody could approve would only lapse."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            refused = await refused_code(start(database, client, identifier=OWNER))
            await database[Collection.BERECHTIGUNGEN].update_one({"adresse": SECOND_ADMIN}, {"$set": {"verwaltung": "owner"}})
            minted = await start(database, client, identifier=OWNER)
            return refused, minted.genehmiger

        refused, genehmiger = on_a_person(mongo_replica_set_url, body)

        assert refused == ADRESSWECHSEL_KEIN_GENEHMIGER
        assert genehmiger == [SECOND_ADMIN]

    def test_it_replaces_the_live_change_whose_links_then_answer_how_it_ended(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture
    ):
        """A sign-in at the address on file proves the mailbox is not lost, so its own start replaces a change asked without it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await administrator_starts(database, client, grund=GRUND, email=FOREIGN_EMAIL)
            with caplog.at_level(logging.INFO):
                second = await start(database, client)

            return (
                first,
                second,
                await change(database, first.id),
                await view(database, client, first.token),
                await where_held(database, FOREIGN_EMAIL, folded=True),
            )

        first, second, replaced, seen, held = on_a_person(mongo_replica_set_url, body)

        assert (replaced["beendet"]["art"], replaced["adresse"], replaced["email"], replaced["grund"]) == ("ersetzt", None, None, None)
        assert (seen.ansicht.zustand, seen.ansicht.art) == ("beendet", "ersetzt")
        assert held == {FOREIGN_EMAIL: []}
        assert [(line.art, line.record_id) for line in journal_lines(caplog)] == [("adresswechsel_verworfen", first.id)]
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
            "genehmigung_offen": False,
        }
        assert (bisherig.ansicht.seite, bisherig.ansicht.zustand, bisherig.ansicht.weg) == ("bisherig", "offen", "konto")

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
            with caplog.at_level(logging.INFO):
                answered = await answer(database, client, minted.token)

            return before, minted, answered, await everything(database), await change(database, minted.id)

        before, minted, answered, after, record = on_a_person(mongo_replica_set_url, body)

        assert answered.mitteilung is not None
        assert answered.mitteilung.model_dump() == {"bisherige_email": EMAIL, "email": NEW_EMAIL, "vorname": "Lenore", "weg": "konto"}
        assert after["pupil"] == {**before["pupil"], "email": NEW_EMAIL}
        # The confirmed referee row moves, its consent link's delivery state with the address it described.
        referee = {**before["referee"], "kontakt": {**before["referee"]["kontakt"], "email": NEW_EMAIL}}
        referee["bestaetigung"] = {key: value for key, value in before["referee"]["bestaetigung"].items() if key != "zustellung"}
        assert after["referee"] == referee
        assert after["unconfirmed referee"] == before["unconfirmed referee"]
        seats = after["season row"]
        assert (seats["kontakte"]["ansprechperson"]["email"], seats["kontakte"]["stellvertretung"]["email"]) == (NEW_EMAIL, EMAIL)
        assert after["confirmation"]["kontakte"]["ansprechperson"] is None
        assert after["pending application"]["kontakte"]["trainer"]["email"] == NEW_EMAIL
        assert after["accepted application"]["kontakte"]["ansprechperson"]["email"] == NEW_EMAIL
        assert (after["confirmed registration"]["email"], after["unconfirmed registration"]["email"]) == (NEW_EMAIL, NEW_EMAIL)
        # The tombstone holds no address and answers how the change ended.
        assert (record["adresse"], record["email"], record["beendet"]["art"]) == (None, None, "wirksam")
        assert record["token_hash"] == hash_token(minted.token)
        [line] = [line for line in journal_lines(caplog) if line.art == "adresswechsel_wirksam"]
        assert (line.record_id, line.zuvor) == (minted.id, loeschung_journal_hash(EMAIL, schluessel=KEY))

    def test_a_change_started_with_a_reason_is_confirmed_and_waits_for_the_pass(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=GRUND)
            confirmed = await answer(database, client, started.token)
            waiting = await everything(database)
            early = await sweep(database, client, germany_now=NOW + timedelta(days=1))
            late = await sweep(database, client, germany_now=AFTER_THE_WAIT)

            return started, confirmed, waiting, early, late, await everything(database)

        started, confirmed, waiting, early, late, after = on_a_person(mongo_replica_set_url, body)

        assert started.weg == "wartezeit"
        assert (confirmed.mitteilung, confirmed.wirksam_ab is not None, confirmed.genehmigung_offen) == (None, True, False)
        assert (waiting["pupil"]["email"], waiting["referee"]["kontakt"]["email"]) == (EMAIL, TYPED)
        assert (early.entfernt, early.verworfen, early.wirksam) == (0, [], [])
        assert [(entry.bisherige_email, entry.email, entry.weg) for entry in late.wirksam] == [(EMAIL, NEW_EMAIL, "wartezeit")]
        assert (after["pupil"]["email"], after["referee"]["kontakt"]["email"]) == (NEW_EMAIL, NEW_EMAIL)

    def test_a_change_finding_nothing_left_to_move_ends_discarded(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            await database[Collection.SPIELER].delete_one({"_id": SPIELER_OID})
            for collection in (Collection.SCHIEDSRICHTER, Collection.SAISON_TEAMS, Collection.BEWERBUNGEN, Collection.REGISTRIERUNGEN):
                await database[collection].delete_many({})
            with caplog.at_level(logging.INFO):
                code = await refused_code(answer(database, client, minted.token))

            return code, await change(database, minted.id)

        code, record = on_a_person(mongo_replica_set_url, body)

        assert (code, record["beendet"]["art"], record["email"]) == (ADRESSWECHSEL_BEENDET, "verworfen", None)
        assert [line.art for line in journal_lines(caplog)] == ["adresswechsel_verworfen"]

    def test_the_decline_ends_it_and_leaves_its_address_nowhere(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            await stop_here(database, client)
            minted = await start(database, client)
            with caplog.at_level(logging.INFO):
                answered = await answer(database, client, minted.token, "abgelehnt", germany_now=AFTER_THE_DEADLINE)

            return answered, await change(database, minted.id), await where_held(database, NEW_EMAIL, folded=True)

        answered, record, held = on_a_person(mongo_replica_set_url, body)

        assert (answered.antwort, answered.mitteilung) == ("abgelehnt", None)
        assert record["beendet"]["art"] == "abgelehnt"
        assert held == {NEW_EMAIL: []}
        assert [line.art for line in journal_lines(caplog)] == ["adresswechsel_abgelehnt"]


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
            with caplog.at_level(logging.INFO):
                if by == "link":
                    await stop_by_link(database, client, minted.stopp_token)
                else:
                    await stop_here(database, client)

            return await change(database, minted.id), await where_held(database, NEW_EMAIL, folded=True), await read(database, client)

        record, held, seen = on_a_person(mongo_replica_set_url, body)

        assert record["beendet"]["art"] == "gestoppt"
        assert held == {NEW_EMAIL: []}
        assert seen.offen is None
        assert [line.art for line in journal_lines(caplog)] == ["adresswechsel_gestoppt"]

    def test_with_nothing_pending_the_account_page_answers_not_found(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentNotFoundException) as missed:
                await stop_here(database, client)
            return str(missed.value.filter)

        # The judgement names no address: the exception's filter reaches the log line.
        assert EMAIL not in on_a_person(mongo_replica_set_url, body)


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
    def test_with_a_reason_it_mints_the_new_mailbox_its_link_and_warns_where_the_new_address_holds_records(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            plain = await administrator_starts(database, client, grund=GRUND)
            await granted(database, FOREIGN_EMAIL)
            joined = await administrator_starts(database, client, grund=GRUND, email=FOREIGN_EMAIL)
            return plain, joined, await change(database, plain.id)

        plain, joined, record = on_a_person(mongo_replica_set_url, body)

        assert (plain.weg, plain.token is not None, plain.adresse_belegt, plain.genehmiger) == ("wartezeit", True, False, [])
        assert joined.adresse_belegt is True
        assert record["grund"] is None  # ended by the second start, its reason out of the record

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
            return started, refused, await change(database, started.id)

        started, refused, record = on_a_person(mongo_replica_set_url, body)

        assert OWNER not in started.genehmiger and EMAIL not in started.genehmiger
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

    def test_the_discard_acts_on_the_change_its_id_names_alone(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """A page showing a change since replaced discards nothing: key the discard on the address and the later change goes."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await administrator_starts(database, client, grund=GRUND)
            later = await start(database, client)
            stale = await refused_code(discard(database, client, first.id))
            with caplog.at_level(logging.INFO):
                await discard(database, client, later.id)
            return stale, await change(database, later.id), await where_held(database, NEW_EMAIL, folded=True)

        stale, record, held = on_a_person(mongo_replica_set_url, body)

        assert (stale, record["beendet"]["art"]) == (ADRESSWECHSEL_BEENDET, "verworfen")
        assert held == {NEW_EMAIL: []}
        assert [line.art for line in journal_lines(caplog)] == ["adresswechsel_verworfen"]


class TestTheApproval:
    def test_an_approval_before_the_confirmation_lets_the_confirmation_take_effect(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            approved = await approve(database, client, minted.id)
            answered = await answer(database, client, minted.token)
            return approved, answered

        approved, answered = on_a_person(mongo_replica_set_url, body)

        assert (approved.wirksam, approved.mitteilung) == (False, None)
        assert answered.mitteilung is not None and answered.mitteilung.email == NEW_EMAIL

    def test_a_confirmation_before_the_approval_waits_and_the_approval_takes_effect(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            minted = await start(database, client)
            answered = await answer(database, client, minted.token)
            seen, waiting = await read(database, client), await everything(database)
            approved = await approve(database, client, minted.id)
            return answered, seen, waiting, approved, await everything(database)

        answered, seen, waiting, approved, after = on_a_person(mongo_replica_set_url, body)

        assert (answered.mitteilung, answered.genehmigung_offen) == (None, True)
        assert seen.offen is not None and (seen.offen.wartet_auf, seen.offen.genehmigung.genehmigt) == ("genehmigung", False)
        assert waiting["pupil"]["email"] == EMAIL
        assert approved.wirksam and approved.mitteilung is not None and approved.mitteilung.weg == "konto"
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
        assert confirmed[EMAIL] is not None and confirmed[EMAIL].bestaetigt
        # Every other row names no change, its grant's address having none waiting.
        assert {adresse: change for adresse, change in others.items() if adresse != EMAIL} == dict.fromkeys(set(others) - {EMAIL})

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
            return refused, swept.entfernt, await change(database, minted.id)

        refused, entfernt, record = on_a_person(mongo_replica_set_url, body)

        assert (refused, entfernt, record["beendet"]["art"]) == (ADRESSWECHSEL_ABGELAUFEN, 1, "abgelaufen")

    def test_a_confirmed_change_with_a_waiting_time_unapproved_a_week_after_its_start_lapses_at_the_pass(self, mongo_replica_set_url: str):
        """Its waiting time ends after its approval's week, so the pass meets it lapsed, never due."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await granted(database)
            started = await administrator_starts(database, client, grund=GRUND, operator=OWNER)
            await answer(database, client, started.token)
            swept = await sweep(database, client, germany_now=AFTER_THE_WEEK)
            return swept, await change(database, started.id)

        swept, record = on_a_person(mongo_replica_set_url, body)

        assert (swept.entfernt, swept.verworfen, swept.wirksam, swept.verbleibend) == (1, [], [], 0)
        assert (record["beendet"]["art"], record["email"], record["grund"]) == ("abgelaufen", None, None)


class TestTheContactsEditorsRead:
    def test_each_seat_names_its_address_s_live_change_and_none_once_it_ended(self, mongo_replica_set_url: str):
        """The Ansprechperson typed otherwise and the Stellvertretung both fold to the changed address; the trainer's seat is empty."""

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

        assert live is not None and (live.trainer, live.ansprechperson, live.stellvertretung) == (None, minted, minted)
        assert ended is not None and (ended.trainer, ended.ansprechperson, ended.stellvertretung) == (None, None, None)


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
        assert [(row["art"], (row["jetzt"] or row["vorher"])["adresse"], row["geaendert_von"]) for row in outbox] == [
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

        assert answered.mitteilung is not None and answered.mitteilung.bisherige_email == SECOND_ADMIN
        assert NEW_EMAIL in addresses and SECOND_ADMIN not in addresses


# Where the suite's owner moves to, and an administrator granted after a change was asked.
OWNER_NEW_EMAIL = "inhaberin.neu@anderswo.example.org"
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
    """A grant taking effect at `at`, after the requests a case started before it."""

    await database[Collection.BERECHTIGUNGEN].insert_one(
        {**grants_for_the_suite()[1], "_id": ObjectId.from_datetime(at), "adresse": adresse, "erteilt_am": at}
    )


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
            approved = await approve(database, client, minted.id, operator=SECOND_ADMIN)
            return answered, waiting, listed, approved

        answered, (record, rows), listed, approved = on_a_person(mongo_replica_set_url, body)

        assert (answered.mitteilung, answered.genehmigung_offen) == (None, True)
        assert (record["genehmigung"]["genehmigt_am"], record["genehmigung"]["genehmigt_von"], rows["pupil"]["email"]) == (None, None, EMAIL)
        assert {row.adresse: row.adresswechsel for row in listed.berechtigungen}[EMAIL] is not None
        assert approved.wirksam

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
        assert swept.wirksam == []
        assert after["pupil"]["email"] == EMAIL

    def test_a_change_refused_at_its_due_time_is_journalled_as_discarded(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """A restore bringing it back would leave a confirmed change in its waiting time to take effect with nobody pressing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=GRUND)
            await answer(database, client, started.token)
            await ban_through_the_route(database, client, email=EMAIL, grund="Falschangaben", von="admin@frankfurtleague.de", today=TODAY)
            with caplog.at_level(logging.INFO):
                swept = await sweep(database, client, germany_now=AFTER_THE_WAIT)
            return started.id, swept

        started, swept = on_a_person(mongo_replica_set_url, body)

        assert [entry.email for entry in swept.verworfen] == [NEW_EMAIL]
        assert [(line.art, line.record_id, line.person_hash) for line in journal_lines(caplog)] == [
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
        assert erinnerung_is_due(registrierung_raw=moved, today="2026-04-02")

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
            datum="2026-04-25",
            uhrzeit="14:00:00",
            team1={"team_id": TEAM_OID},
            team2={"team_id": SECOND_TEAM_OID},
        )
        answered = documents.spielbestaetigung_document(
            spiel,
            partei={"art": "team", "team_id": TEAM_OID},
            _id=ANSWERED_OID,
            angefragt_am="2026-03-30",
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
                    update={"$set": {"angefragt_am": "2026-03-31"}},
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
        """A pupil holding no address beside it: an ended change's null address must not meet them."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_one(spieler_document(ADDRESSLESS_OID, "Ohne", "Adresse"))

            async def listed() -> dict[Any, Any]:
                rows = await (await database[Collection.SPIELER].aggregate(build_spieler_memberships_pipeline())).to_list()
                return {row["_id"]: row["adresswechsel_id"] for row in rows}

            minted = await start(database, client)
            live = await listed()
            await stop_here(database, client)
            return minted.id, live, await listed()

        minted, live, ended = on_a_person(mongo_replica_set_url, body)

        assert (live[SPIELER_OID], live[ADDRESSLESS_OID]) == (minted, None)
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
