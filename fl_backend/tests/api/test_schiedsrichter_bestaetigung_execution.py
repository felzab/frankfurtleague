from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.services import hash_token
from app.api.saisons.cache import invalidate_saison_cache
from app.api.schiedsrichter.admin_router import (
    anonymise_schiedsrichter,
    delete_schiedsrichter,
    einladen_schiedsrichter,
    patch_schiedsrichter,
    post_schiedsrichter,
    reactivate_schiedsrichter,
)
from app.api.schiedsrichter.bestaetigung_router import get_bestaetigung_ansicht, post_bestaetigung
from app.api.schiedsrichter.router import get_schiedsrichter
from app.api.schiedsrichter.schemas import (
    FLPatchSchiedsrichterPayload,
    FLPostSchiedsrichterPayload,
    FLSchiedsrichterBestaetigungAnsichtPayload,
    FLSchiedsrichterBestaetigungPayload,
    FLSchiedsrichterFilterParams,
)
from app.api.schiedsrichter.services import (
    BESTAETIGUNG_FELD,
    EINWILLIGUNG_FELD,
    SCHIEDSRICHTER_ADRESSE_GESPERRT,
    SCHIEDSRICHTER_ALREADY_CONFIRMED,
    SCHIEDSRICHTER_ALTER,
    SCHIEDSRICHTER_ERTEILT_VON,
    SCHIEDSRICHTER_KEINE_ADRESSE,
    SCHIEDSRICHTER_MEDIEN_ALTER,
    SCHIEDSRICHTER_RETIRED,
    SCHIEDSRICHTER_TOKEN_EXPIRED,
    SCHIEDSRICHTER_TOKEN_UNKNOWN,
    bestaetigung_frist_from,
    compose_bestaetigung,
)
from app.api.sperrliste.admin_router import post_sperrliste_eintrag
from app.api.sperrliste.schemas import FLPostSperrlistePayload
from app.api.zustellung.router import angenommen_zustellung
from app.api.zustellung.schemas import FLZustellungAngenommenPayload
from app.core.collections import Collection
from app.core.exceptions import DocumentConflictException, DocumentNotFoundException
from app.core.sentinels import GHOST_INACTIVE_SINCE, GHOST_SCHIEDSRICHTER_ID
from app.shared.schemas.bounds import MEDIEN_MIN_AGE_YEARS
from tests.config import build_test_config
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

# Module level: every case below reaches a real mongod, the whole slice being one transaction each.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_schiedsrichter_bestaetigung_test")

CONFIG = build_test_config()

SAISON_ID = "2026"
TODAY = "2026-04-01"
# One day past the deadline a link minted on `TODAY` carries, so the expiry case needs no second mint.
AFTER_THE_DEADLINE = "2026-04-16"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607810001")
SPIEL_OID = ObjectId("6890a1b2c3d4e5f607810011")
SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f6078100a1")

NAME = "Pierluigi Collina"
SCHULE = "Carl-Schurz-Schule"
DEFAULT_PAYMENT = 20

EMAIL = "collina@example.com"
CORRECTED_EMAIL = "collina.pierluigi@example.com"
BANNED_EMAIL = "gesperrt@example.com"
# Under RFC 6761's reserved `.invalid`, which no mail system delivers to.
PLACEHOLDER_EMAIL = "adresse-fehlt@frankfurtleague.invalid"
TELEFON = "+49 69 1234567"

AN_ADULTS_BIRTHDATE = "1984-05-09"
A_CHILDS_BIRTHDATE = "2018-01-01"

MESSAGE_ID = "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"
ACCEPTED_AT = "2026-04-01T10:00:00.000000+00:00"

TEXT_VERSION = "2026-04-schiedsrichterseite"

# Seeded before every confirmation that asserts on it, so "the write reaches one collection" is a
# comparison against a document that exists rather than against an empty collection.
BOOKING: Mapping[str, Any] = {"schiedsrichter_id": SCHIEDSRICHTER_OID, "name": NAME, "payment": DEFAULT_PAYMENT}

# Written onto the block by hand rather than through `POST /zustellung`, which is the delivery
# slice's own suite: what is driven here is that the next mint takes it away.
A_BOUNCE: Mapping[str, Any] = {"nachricht_id": "m-1", "stand": "unzustellbar", "grund": "NoEmail", "am": TODAY}

SAISON_RULES: dict[str, Any] = {
    "win_points": 3,
    "draw_points": 1,
    "qualifiers_per_group": 2,
    "number_of_groups": 4,
    "teams_per_group": 4,
    "tiebreak_order": "tordifferenz",
    "max_kadergroesse": 18,
    "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
    "erlaubte_stufen": ["E1", "Q1", "Q2", "Q3", "Q4"],
}


def saison_document() -> dict[str, Any]:
    """The RUNNING season. Every mint reads it, the ban list being judged against the season in progress."""

    return {
        "_id": SAISON_ID,
        "start_date": "2026-01-01",
        "end_date": "2026-06-30",
        "status": "active",
        "rules": dict(SAISON_RULES),
    }


def referee_document(*, email: str | None = EMAIL, **overrides: Any) -> dict[str, Any]:
    """A referee entered before this flow: no link, no record, no birthdate."""

    return {
        "_id": SCHIEDSRICHTER_OID,
        "name": NAME,
        "schule": SCHULE,
        "default_payment": DEFAULT_PAYMENT,
        "kontakt": {"telefon": TELEFON, "email": email},
        "inactive_since": None,
        **overrides,
    }


def fixture_document() -> dict[str, Any]:
    """One played fixture this referee officiated, seeded so a fan-out onto `spiele` has somewhere to land."""

    return {
        "_id": SPIEL_OID,
        "spiel_nr": 1,
        "saison_id": SAISON_ID,
        "saison_phase": "gruppenphase",
        "spieltag_id": SPIELTAG_OID,
        "team1": None,
        "team2": None,
        "team1_quelle": None,
        "team2_quelle": None,
        "datum": "2026-03-15",
        "uhrzeit": "14:00:00",
        "ort": None,
        "schiedsrichter": dict(BOOKING),
        "ergebnis": "2:1",
        "elfmeterschiessen": None,
        "sonderereignis": None,
    }


def payload_body(*, email: str | None = EMAIL) -> dict[str, Any]:
    return {"name": NAME, "schule": SCHULE, "default_payment": DEFAULT_PAYMENT, "kontakt": {"telefon": TELEFON, "email": email}}


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, referees: list[dict[str, Any]] | None = None) -> Any:
    """The SHIPPED validators, so a block or a record production would refuse fails here too."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.SAISONS].insert_one(saison_document())
            seeded = [referee_document()] if referees is None else referees
            if seeded:
                await database[Collection.SCHIEDSRICHTER].insert_many(seeded)
                await database[Collection.SPIELE].insert_one(fixture_document())

            return await body(database, client)

    return on_the_seed_loop(_run())


async def create(database: AsyncDatabase, client: AsyncMongoClient, *, email: str | None = EMAIL, today: str = TODAY) -> Any:
    return await post_schiedsrichter(
        schiedsrichter_data=FLPostSchiedsrichterPayload.model_validate(payload_body(email=email)),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        sperrliste_collection=database[Collection.SPERRLISTE],
        saisons_collection=database[Collection.SAISONS],
        db=client,
        config=CONFIG,
        today=today,
    )


async def correct(database: AsyncDatabase, client: AsyncMongoClient, *, email: str | None, today: str = TODAY) -> Any:
    return await patch_schiedsrichter(
        schiedsrichter_id=SCHIEDSRICHTER_OID,
        schiedsrichter_data=FLPatchSchiedsrichterPayload.model_validate(payload_body(email=email)),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        spiele_collection=database[Collection.SPIELE],
        sperrliste_collection=database[Collection.SPERRLISTE],
        saisons_collection=database[Collection.SAISONS],
        db=client,
        config=CONFIG,
        today=today,
    )


async def resend(
    database: AsyncDatabase, client: AsyncMongoClient, *, schiedsrichter_id: ObjectId = SCHIEDSRICHTER_OID, today: str = TODAY
) -> Any:
    return await einladen_schiedsrichter(
        schiedsrichter_id=schiedsrichter_id,
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        sperrliste_collection=database[Collection.SPERRLISTE],
        saisons_collection=database[Collection.SAISONS],
        db=client,
        config=CONFIG,
        today=today,
    )


async def ban(database: AsyncDatabase, client: AsyncMongoClient, *, email: str) -> Any:
    return await post_sperrliste_eintrag(
        sperrliste_data=FLPostSperrlistePayload(email=email, grund="Wiederholte Falschangaben"),
        sperrliste_collection=database[Collection.SPERRLISTE],
        saisons_collection=database[Collection.SAISONS],
        db=client,
        config=CONFIG,
        erstellt_von="admin@frankfurtleague.de",
        today=TODAY,
    )


async def ansicht(database: AsyncDatabase, token: str, *, today: str = TODAY) -> Any:
    return await get_bestaetigung_ansicht(
        ansicht_data=FLSchiedsrichterBestaetigungAnsichtPayload(token=token),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        today=today,
    )


async def confirm(database: AsyncDatabase, client: AsyncMongoClient, token: str, *, today: str = TODAY, **overrides: Any) -> Any:
    body = {
        "token": token,
        "geburtsdatum": AN_ADULTS_BIRTHDATE,
        "umfang": "kader_oeffentlich",
        "medien": True,
        "text_version": TEXT_VERSION,
        **overrides,
    }

    return await post_bestaetigung(
        antwort_data=FLSchiedsrichterBestaetigungPayload.model_validate(body),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        db=client,
        today=today,
    )


async def stored(database: AsyncDatabase, schiedsrichter_id: ObjectId = SCHIEDSRICHTER_OID) -> Mapping[str, Any]:
    found = await database[Collection.SCHIEDSRICHTER].find_one({"_id": schiedsrichter_id})
    assert found is not None, "the referee this case seeded is gone"

    return found


async def stored_fixture(database: AsyncDatabase) -> Mapping[str, Any]:
    found = await database[Collection.SPIELE].find_one({"_id": SPIEL_OID})
    assert found is not None, "the fixture this case seeded is gone"

    return found


class TestTheCreateIsTheInvitation:
    """Entering an address IS the invitation, so no second press decides whether this person is asked."""

    def test_a_create_with_an_address_answers_a_token_the_stored_hash_matches(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await create(database, client)
            row = await stored(database, response.created_id)

            return response, row

        response, row = on_a_league(mongo_replica_set_url, body, referees=[])

        assert response.bestaetigung is not None
        assert row[BESTAETIGUNG_FELD]["token_hash"] == hash_token(response.bestaetigung.token)
        assert row[BESTAETIGUNG_FELD]["frist"] == response.bestaetigung.frist == bestaetigung_frist_from(today=TODAY)

    def test_the_link_the_create_answered_opens_that_referees_entry(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await create(database, client)
            assert response.bestaetigung is not None

            return await ansicht(database, response.bestaetigung.token)

        view = on_a_league(mongo_replica_set_url, body, referees=[])

        assert (view.zustand, view.vorname, view.text_version) == ("gueltig", "Pierluigi", None)

    def test_a_banned_address_leaves_no_referee_behind(self, mongo_replica_set_url: str):
        """What the create's transaction is for: judged outside one, the row stands with a live link the caller was told had been refused."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, client, email=BANNED_EMAIL)

            with pytest.raises(DocumentConflictException) as refused:
                await create(database, client, email=BANNED_EMAIL)

            return refused.value, await database[Collection.SCHIEDSRICHTER].count_documents({})

        refused, rows = on_a_league(mongo_replica_set_url, body, referees=[])

        assert refused.error_code == SCHIEDSRICHTER_ADRESSE_GESPERRT
        assert rows == 0

    def test_a_league_that_has_run_no_season_still_invites(self, mongo_replica_set_url: str):
        """A league before its first season counts no ban's seasons, so the create asks the hash alone rather than failing on the season."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISONS].delete_many({})

            return await create(database, client)

        assert on_a_league(mongo_replica_set_url, body, referees=[]).bestaetigung is not None

    def test_a_league_that_has_run_no_season_still_refuses_a_banned_address(self, mongo_replica_set_url: str):
        """The control: a create skipping the ban list whenever there is no season would pass the case above."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, client, email=BANNED_EMAIL)
            await database[Collection.SAISONS].delete_many({})
            # The ban's own write cached the season it counted from, which would answer the create.
            invalidate_saison_cache()

            with pytest.raises(DocumentConflictException) as refused:
                await create(database, client, email=BANNED_EMAIL)

            return refused.value

        assert on_a_league(mongo_replica_set_url, body, referees=[]).error_code == SCHIEDSRICHTER_ADRESSE_GESPERRT

    def test_the_link_it_answered_is_the_one_a_delivery_report_applies_to(self, mongo_replica_set_url: str):
        """The carrier this create composes is what `POST /zustellung/angenommen` files a send against.

        Before it, no production write composed the key at all and that endpoint answered
        `angewendet: false` for every real referee.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            created = await create(database, client)
            accepted = await angenommen_zustellung(
                angenommen_data=FLZustellungAngenommenPayload.model_validate(
                    {"ziel": "schiedsrichter", "ziel_id": str(created.created_id), "nachricht_id": MESSAGE_ID, "am": ACCEPTED_AT}
                ),
                db=database,
                db_client=client,
            )

            return accepted, await stored(database, created.created_id)

        accepted, row = on_a_league(mongo_replica_set_url, body, referees=[])

        assert accepted.angewendet is True
        assert row[BESTAETIGUNG_FELD]["zustellung"] == {"nachricht_id": MESSAGE_ID, "stand": "angenommen", "grund": None, "am": ACCEPTED_AT}


class TestACorrectedAddressReMintsAndRetiresTheOldLink:
    """The ruled behaviour: the old link was posted to a mailbox nobody reads, and leaving it live is a credential in the wrong inbox."""

    def test_the_old_token_dies_and_the_new_one_opens_the_entry(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await resend(database, client)
            corrected = await correct(database, client, email=CORRECTED_EMAIL)

            return first, corrected, await stored(database)

        first, corrected, row = on_a_league(mongo_replica_set_url, body)

        assert corrected.bestaetigung is not None
        assert corrected.bestaetigung.token != first.bestaetigung.token
        assert row[BESTAETIGUNG_FELD]["token_hash"] == hash_token(corrected.bestaetigung.token)
        assert row["kontakt"]["email"] == CORRECTED_EMAIL

    def test_the_old_token_then_opens_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await resend(database, client)
            await correct(database, client, email=CORRECTED_EMAIL)

            with pytest.raises(DocumentConflictException) as refused:
                await ansicht(database, first.bestaetigung.token)

            return refused.value

        assert on_a_league(mongo_replica_set_url, body).error_code == SCHIEDSRICHTER_TOKEN_UNKNOWN

    def test_a_confirmed_referees_address_change_mints_nothing(self, mongo_replica_set_url: str):
        """Their link keeps working: the address change is a procedure rather than a fresh collection."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await resend(database, client)
            await confirm(database, client, first.bestaetigung.token)
            corrected = await correct(database, client, email=CORRECTED_EMAIL)

            return first, corrected, await stored(database)

        first, corrected, row = on_a_league(mongo_replica_set_url, body)

        assert corrected.bestaetigung is None
        assert row[BESTAETIGUNG_FELD]["token_hash"] == hash_token(first.bestaetigung.token)
        assert row["kontakt"]["email"] == CORRECTED_EMAIL

    def test_a_save_leaving_the_address_alone_mints_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await resend(database, client)
            unchanged = await correct(database, client, email=EMAIL)

            return before, unchanged, await stored(database)

        before, unchanged, row = on_a_league(mongo_replica_set_url, body)

        assert unchanged.bestaetigung is None
        assert row[BESTAETIGUNG_FELD]["token_hash"] == hash_token(before.bestaetigung.token)

    def test_a_retired_referees_new_address_is_stored_and_mints_nothing(self, mongo_replica_set_url: str):
        """A retired person is asked nothing, and the save is not refused for it: every save carries an address, so a refusal locks the row."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await resend(database, client)
            await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER_OID}, {"$set": {"inactive_since": "2026-01-01"}})
            saved = await correct(database, client, email=CORRECTED_EMAIL)

            with pytest.raises(DocumentConflictException) as old_link:
                await ansicht(database, first.bestaetigung.token)

            return saved, await stored(database), old_link.value

        saved, row, old_link = on_a_league(mongo_replica_set_url, body)

        assert saved.bestaetigung is None
        assert row["kontakt"]["email"] == CORRECTED_EMAIL
        # The old link went to the mailbox the save moved away from, so it dies with no successor.
        assert BESTAETIGUNG_FELD not in row
        assert old_link.error_code == SCHIEDSRICHTER_TOKEN_UNKNOWN

    def test_a_retired_referee_whose_address_does_not_move_is_saved(self, mongo_replica_set_url: str):
        """The control under the case above: nothing there refuses a retired row outright, the rename being still owed to it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER_OID}, {"$set": {"inactive_since": "2026-01-01"}})
            saved = await correct(database, client, email=EMAIL)

            return saved, await stored(database)

        saved, row = on_a_league(mongo_replica_set_url, body)

        assert saved.bestaetigung is None
        assert row["inactive_since"] == "2026-01-01"

    def test_a_banned_new_address_is_refused_and_the_rename_is_rolled_back(self, mongo_replica_set_url: str):
        """The rename and the mint are one transaction, so a refused link leaves no moved address behind for the dead one to sit on."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, client, email=BANNED_EMAIL)

            with pytest.raises(DocumentConflictException) as refused:
                await correct(database, client, email=BANNED_EMAIL)

            return refused.value, await stored(database), await stored_fixture(database)

        refused, row, fixture = on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == SCHIEDSRICHTER_ADRESSE_GESPERRT
        assert row["kontakt"]["email"] == EMAIL
        assert fixture["schiedsrichter"] == BOOKING


class TestTheReSend:
    def test_it_writes_a_block_whose_hash_matches_the_token_it_answered(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await resend(database, client)

            return response, await stored(database)

        response, row = on_a_league(mongo_replica_set_url, body)

        assert row[BESTAETIGUNG_FELD]["token_hash"] == hash_token(response.bestaetigung.token)
        assert row[BESTAETIGUNG_FELD]["verschickt_am"] == TODAY

    def test_a_second_re_send_replaces_the_block_whole(self, mongo_replica_set_url: str):
        """A bounce recorded against the replaced address would otherwise hold the fresh link's referee unreachable for ever."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await resend(database, client)
            await database[Collection.SCHIEDSRICHTER].update_one(
                {"_id": SCHIEDSRICHTER_OID}, {"$set": {f"{BESTAETIGUNG_FELD}.zustellung": A_BOUNCE}}
            )
            second = await resend(database, client)

            return first, second, await stored(database)

        first, second, row = on_a_league(mongo_replica_set_url, body)

        assert second.bestaetigung.token != first.bestaetigung.token
        assert row[BESTAETIGUNG_FELD] == compose_bestaetigung(token_hash=hash_token(second.bestaetigung.token), today=TODAY)

    def test_the_first_token_then_opens_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await resend(database, client)
            await resend(database, client)

            with pytest.raises(DocumentConflictException) as refused:
                await ansicht(database, first.bestaetigung.token)

            return refused.value

        assert on_a_league(mongo_replica_set_url, body).error_code == SCHIEDSRICHTER_TOKEN_UNKNOWN

    def test_the_admin_list_serves_no_hash_for_a_referee_who_holds_one(self, mongo_replica_set_url: str):
        """Over a row that HOLDS a hash: on a row with no block the same assertion passes over an empty carrier."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await resend(database, client)
            assert "token_hash" in (await stored(database))[BESTAETIGUNG_FELD]

            return await get_schiedsrichter(
                schiedsrichter_collection=database[Collection.SCHIEDSRICHTER], filters=FLSchiedsrichterFilterParams()
            )

        listed = on_a_league(mongo_replica_set_url, body)

        assert "token_hash" not in listed.model_dump_json()

    def test_it_answers_the_address_the_link_was_minted_for(self, mongo_replica_set_url: str):
        """The caller mails what the mint answered, so the answer carries it rather than leaving the caller its own earlier read."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await resend(database, client)

        response = on_a_league(mongo_replica_set_url, body)

        assert response.bestaetigung.email == EMAIL

    def test_an_address_moved_since_the_caller_read_it_is_the_one_answered(self, mongo_replica_set_url: str):
        """The row moves between the caller's read and this mint, which is the whole case.

        Answered from the caller's own earlier read instead, the credential goes to the mailbox the
        save took the referee away from.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            # What the caller read before pressing, and what it would have mailed to.
            before = (await stored(database))["kontakt"]["email"]
            await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER_OID}, {"$set": {"kontakt.email": CORRECTED_EMAIL}})

            return before, await resend(database, client), await stored(database)

        before, response, row = on_a_league(mongo_replica_set_url, body)

        assert before == EMAIL
        assert response.bestaetigung.email == CORRECTED_EMAIL
        assert row[BESTAETIGUNG_FELD]["token_hash"] == hash_token(response.bestaetigung.token)

    def test_a_retired_referee_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await delete_schiedsrichter(
                schiedsrichter_id=SCHIEDSRICHTER_OID,
                schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                spiele_collection=database[Collection.SPIELE],
                db=client,
                today=TODAY,
            )

            with pytest.raises(DocumentConflictException) as refused:
                await resend(database, client)

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == SCHIEDSRICHTER_RETIRED
        assert BESTAETIGUNG_FELD not in row

    def test_a_referee_who_has_already_answered_is_refused_and_keeps_their_block(self, mongo_replica_set_url: str):
        """A fresh link for them can never be spent — the confirmation refuses every press of one — and minting it replaces a live block."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await resend(database, client)
            await confirm(database, client, first.bestaetigung.token)

            with pytest.raises(DocumentConflictException) as refused:
                await resend(database, client)

            return first, refused.value, await stored(database)

        first, refused, row = on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == SCHIEDSRICHTER_ALREADY_CONFIRMED
        assert row[BESTAETIGUNG_FELD]["token_hash"] == hash_token(first.bestaetigung.token)

    def test_a_referee_with_no_address_is_refused_and_no_send_is_stamped(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentConflictException) as refused:
                await resend(database, client)

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body, referees=[referee_document(email=None)])

        assert refused.error_code == SCHIEDSRICHTER_KEINE_ADRESSE
        assert BESTAETIGUNG_FELD not in row

    def test_a_stored_address_no_payload_would_take_is_refused_as_none(self, mongo_replica_set_url: str):
        """The placeholder a row without an address is given.

        The ban-list hash cannot key it, so unjudged it answers 500 rather than a refusal the panel words.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentConflictException) as refused:
                await resend(database, client)

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body, referees=[referee_document(email=PLACEHOLDER_EMAIL)])

        assert refused.error_code == SCHIEDSRICHTER_KEINE_ADRESSE
        assert BESTAETIGUNG_FELD not in row

    def test_an_address_on_the_ban_list_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, client, email=BANNED_EMAIL)

            with pytest.raises(DocumentConflictException) as refused:
                await resend(database, client)

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body, referees=[referee_document(email=BANNED_EMAIL)])

        assert refused.error_code == SCHIEDSRICHTER_ADRESSE_GESPERRT
        assert BESTAETIGUNG_FELD not in row

    def test_the_ghost_answers_not_found_rather_than_a_refusal(self, mongo_replica_set_url: str):
        """`build_referee_filter` decides it before any refusal this slice writes is reached."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SCHIEDSRICHTER].insert_one(
                {
                    "_id": GHOST_SCHIEDSRICHTER_ID,
                    "name": None,
                    "schule": None,
                    "default_payment": 0,
                    "kontakt": {"telefon": None, "email": None},
                    "inactive_since": GHOST_INACTIVE_SINCE,
                }
            )

            with pytest.raises(DocumentNotFoundException):
                await resend(database, client, schiedsrichter_id=GHOST_SCHIEDSRICHTER_ID)

            return None

        on_a_league(mongo_replica_set_url, body)


async def reactivate(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    return await reactivate_schiedsrichter(
        schiedsrichter_id=SCHIEDSRICHTER_OID,
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        sperrliste_collection=database[Collection.SPERRLISTE],
        saisons_collection=database[Collection.SAISONS],
        db=client,
        config=CONFIG,
        today=TODAY,
    )


RETIRED: Mapping[str, Any] = {"inactive_since": "2026-01-01"}


class TestTheReactivation:
    """The mint a retired referee's save withholds: bringing an unanswered referee back is what asks them."""

    def test_an_unanswered_referee_is_minted_a_link_the_stored_hash_matches(self, mongo_replica_set_url: str):
        """In ONE write: the revival and the mint are one press, so the log holds one row for it."""

        naming = {"collection": str(Collection.SCHIEDSRICHTER), "document_id": SCHIEDSRICHTER_OID}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await database[Collection.AKTIONEN].count_documents(naming)
            response = await reactivate(database, client)
            filed = await database[Collection.AKTIONEN].count_documents(naming) - before

            return response, await stored(database), filed

        response, row, filed = on_a_league(mongo_replica_set_url, body, referees=[referee_document(**RETIRED)])

        assert row["inactive_since"] is None
        assert response.bestaetigung.email == EMAIL
        assert row[BESTAETIGUNG_FELD]["token_hash"] == hash_token(response.bestaetigung.token)
        assert filed == 1

    def test_a_row_holding_the_placeholder_comes_back_unasked(self, mongo_replica_set_url: str):
        """Entering the real address is the save that mints; a link minted here would go to nobody."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await reactivate(database, client), await stored(database)

        response, row = on_a_league(mongo_replica_set_url, body, referees=[referee_document(email=PLACEHOLDER_EMAIL, **RETIRED)])

        assert row["inactive_since"] is None
        assert response.bestaetigung is None
        assert BESTAETIGUNG_FELD not in row

    def test_a_referee_who_has_answered_comes_back_unasked(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await resend(database, client)
            await confirm(database, client, first.bestaetigung.token)
            await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER_OID}, {"$set": dict(RETIRED)})

            return first, await reactivate(database, client), await stored(database)

        first, response, row = on_a_league(mongo_replica_set_url, body)

        assert response.bestaetigung is None
        assert row[BESTAETIGUNG_FELD]["token_hash"] == hash_token(first.bestaetigung.token)

    def test_a_banned_address_is_refused_and_the_row_stays_retired(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, client, email=BANNED_EMAIL)

            with pytest.raises(DocumentConflictException) as refused:
                await reactivate(database, client)

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body, referees=[referee_document(email=BANNED_EMAIL, **RETIRED)])

        assert refused.error_code == SCHIEDSRICHTER_ADRESSE_GESPERRT
        assert row["inactive_since"] == RETIRED["inactive_since"]
        assert BESTAETIGUNG_FELD not in row


class TestTheConfirmation:
    def test_it_writes_the_birthdate_and_the_record_in_one_update(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            response = await confirm(database, client, minted.bestaetigung.token)

            return response, await stored(database)

        response, row = on_a_league(mongo_replica_set_url, body)

        assert row["geburtsdatum"] == AN_ADULTS_BIRTHDATE
        assert row[EINWILLIGUNG_FELD] == {
            "umfang": "kader_oeffentlich",
            "erteilt_von": SCHIEDSRICHTER_ERTEILT_VON,
            "datum": TODAY,
            "bestaetigt_am": TODAY,
            "text_version": TEXT_VERSION,
            "medien": True,
        }
        assert (response.umfang, response.medien, response.bestaetigt_am) == ("kader_oeffentlich", True, TODAY)

    def test_a_second_press_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            await confirm(database, client, minted.bestaetigung.token)

            with pytest.raises(DocumentConflictException) as refused:
                await confirm(database, client, minted.bestaetigung.token, umfang="intern")

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == SCHIEDSRICHTER_ALREADY_CONFIRMED
        # The first answer stands: a refusal that wrote would have replaced the scope this person chose.
        assert row[EINWILLIGUNG_FELD]["umfang"] == "kader_oeffentlich"

    def test_a_press_after_the_deadline_is_refused_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)

            with pytest.raises(DocumentConflictException) as refused:
                await confirm(database, client, minted.bestaetigung.token, today=AFTER_THE_DEADLINE)

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == SCHIEDSRICHTER_TOKEN_EXPIRED
        assert row.get(EINWILLIGUNG_FELD) is None
        assert row.get("geburtsdatum") is None

    def test_someone_who_answered_and_presses_again_after_the_deadline_is_told_their_answer_stands(self, mongo_replica_set_url: str):
        """Both refusals apply, and the stamp is asked first.

        The other order sends a person who already consented off to ask the administration for a
        fresh link, which is a repair for a state they are not in.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            await confirm(database, client, minted.bestaetigung.token)

            with pytest.raises(DocumentConflictException) as refused:
                await confirm(database, client, minted.bestaetigung.token, today=AFTER_THE_DEADLINE)

            return refused.value

        assert on_a_league(mongo_replica_set_url, body).error_code == SCHIEDSRICHTER_ALREADY_CONFIRMED

    def test_a_birthdate_under_the_floor_is_refused_before_anything_is_written(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)

            with pytest.raises(DocumentConflictException) as refused:
                await confirm(database, client, minted.bestaetigung.token, geburtsdatum=A_CHILDS_BIRTHDATE)

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == SCHIEDSRICHTER_ALTER
        assert row.get("geburtsdatum") is None

    def test_a_token_no_referee_holds_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentConflictException) as refused:
                await confirm(database, client, "a-token-nobody-minted")

            return refused.value

        assert on_a_league(mongo_replica_set_url, body).error_code == SCHIEDSRICHTER_TOKEN_UNKNOWN

    def test_the_link_of_an_erased_referee_opens_nothing(self, mongo_replica_set_url: str):
        """The lookup finds no row rather than a nulled one: the erasure deletes the document and the block goes with it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            await anonymise_schiedsrichter(
                schiedsrichter_id=SCHIEDSRICHTER_OID,
                schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                spiele_collection=database[Collection.SPIELE],
                aktionen_collection=database[Collection.AKTIONEN],
                db=client,
                germany_now=NOW,
            )

            with pytest.raises(DocumentConflictException) as refused:
                await ansicht(database, minted.bestaetigung.token)

            return refused.value, await database[Collection.SCHIEDSRICHTER].count_documents({"_id": SCHIEDSRICHTER_OID})

        refused, surviving = on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == SCHIEDSRICHTER_TOKEN_UNKNOWN
        # Read back rather than inferred from the refusal: a row nulled in place would refuse the
        # same way while still holding the birthdate and the record.
        assert surviving == 0


class TestAWithheldNameReachesOneCollection:
    """The scope has one home, so there is nothing to fan out and nothing on a fixture to fall out of step."""

    def test_the_scope_is_written_on_the_referees_own_row(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            await confirm(database, client, minted.bestaetigung.token, umfang="intern", medien=False)

            return await stored(database)

        row = on_a_league(mongo_replica_set_url, body)

        assert row[EINWILLIGUNG_FELD]["umfang"] == "intern"
        assert row[EINWILLIGUNG_FELD]["medien"] is False

    def test_the_fixture_they_officiated_is_byte_identical_afterwards(self, mongo_replica_set_url: str):
        """Seeded BEFORE the confirmation, or the comparison would be over a fixture the case created after it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await stored_fixture(database)
            minted = await resend(database, client)
            await confirm(database, client, minted.bestaetigung.token, umfang="intern", medien=False)

            return before, await stored_fixture(database)

        before, after = on_a_league(mongo_replica_set_url, body)

        assert after == before
        assert after["schiedsrichter"] == BOOKING


# Against `TODAY`, 18 to the day and 17 years and 364 days.
AT_THE_MEDIA_AGE = "2008-04-01"
A_DAY_SHORT_OF_THE_MEDIA_AGE = "2008-04-02"


class TestTheMediaAge:
    """`REQ-SCHIEDSRICHTER-008` at the endpoint: the refusal is wired in, and judged before the write."""

    def test_the_view_serves_the_age_the_page_offers_the_switch_from(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)

            return await ansicht(database, minted.bestaetigung.token)

        assert on_a_league(mongo_replica_set_url, body).medien_mindestalter == MEDIEN_MIN_AGE_YEARS

    def test_a_yes_a_day_short_of_the_media_age_is_refused_before_anything_is_written(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)

            with pytest.raises(DocumentConflictException) as refused:
                await confirm(database, client, minted.bestaetigung.token, geburtsdatum=A_DAY_SHORT_OF_THE_MEDIA_AGE, medien=True)

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == SCHIEDSRICHTER_MEDIEN_ALTER
        assert row.get("geburtsdatum") is None
        assert row.get(EINWILLIGUNG_FELD) is None

    def test_a_yes_at_the_media_age_to_the_day_is_stored(self, mongo_replica_set_url: str):
        """The other half of the pair: without it the case above passes for a refusal of every yes."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            await confirm(database, client, minted.bestaetigung.token, geburtsdatum=AT_THE_MEDIA_AGE, medien=True)

            return await stored(database)

        assert on_a_league(mongo_replica_set_url, body)[EINWILLIGUNG_FELD]["medien"] is True

    def test_a_no_a_day_short_of_the_media_age_is_stored(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            await confirm(database, client, minted.bestaetigung.token, geburtsdatum=A_DAY_SHORT_OF_THE_MEDIA_AGE, medien=False)

            return await stored(database)

        assert on_a_league(mongo_replica_set_url, body)[EINWILLIGUNG_FELD]["medien"] is False
