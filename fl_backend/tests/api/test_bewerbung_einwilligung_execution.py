from datetime import datetime
from typing import Any, Awaitable, Callable, Mapping
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.admin_router import erneut_einwilligung
from app.api.bewerbungen.einwilligung_router import get_einwilligung_ansicht, post_einwilligung
from app.api.bewerbungen.router import get_bewerbung_by_id, get_bewerbungen
from app.api.bewerbungen.schemas import FLBewerbungEinwilligungAnsichtPayload, FLBewerbungEinwilligungAntwortPayload, FLBewerbungenFilterParams
from app.api.bewerbungen.services import (
    BEWERBUNG_ALREADY_DECIDED,
    BEWERBUNG_KONTAKT_ALTER,
    BEWERBUNG_SEAT_ALREADY_ANSWERED,
    BEWERBUNG_TOKEN_EXPIRED,
    BEWERBUNG_TOKEN_UNKNOWN,
    KONTAKT_SEATS,
    compose_bestaetigungen,
    hash_token,
)
from app.core.collections import Collection
from app.core.exceptions import DocumentConflictException, DocumentNotFoundException
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

# Module level, as the submission suite marks its own: every test below reaches a real mongod.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_bewerbung_einwilligung_test")

SAISON_ID = "2026"
TODAY = "2026-04-01"
YESTERDAY = "2026-03-31"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
REDACTED_AT = "2026-04-01T10:30:00+00:00"

# Fixed rather than generated, so a failure names the same row every run.
BEWERBUNG_OID = ObjectId("6890a1b2c3d4e5f607950001")
PICKED_BEWERBUNG_OID = ObjectId("6890a1b2c3d4e5f607950002")
CLUB_OID = ObjectId("6890a1b2c3d4e5f607950011")

CLUB_NAME = "Adler"
SCHOOL_NAME = "Zorbanax"

# The raw tokens the seeded links carry, and what the database holds for each.
RAW: Mapping[str, str] = {seat: f"raw-token-for-{seat}" for seat in KONTAKT_SEATS}
HASHES: Mapping[str, str] = {seat: hash_token(raw) for seat, raw in RAW.items()}

A_CHILDS_BIRTHDATE = "2018-01-01"
AN_ADULTS_BIRTHDATE = "1984-05-09"

ADDRESS: Mapping[str, Any] = {
    "strasse": "Hanauer Landstraße",
    "hausnummer": "12a",
    "plz": "60314",
    "stadtteil": "Ostend",
    "stadt": "Frankfurt am Main",
}


def person(vorname: str) -> dict[str, Any]:
    """One seat as the submission stores it: no date, no stamp, entered on the person's behalf."""

    return {
        "vorname": vorname,
        "nachname": f"{vorname}-Mustermann",
        "email": f"{vorname.lower()}@example.com",
        "telefon": "+49 170 1234567",
        "geburtsdatum": None,
        "einwilligung": {
            "umfang": "kontaktdaten",
            "erteilt_von": "administrativ",
            "text_version": "v3",
            "datum": "2026-03-20",
            "bestaetigt_am": None,
        },
    }


def kontakte(*, trainer_ist_zugleich: str | None = None) -> dict[str, Any]:
    return {
        "trainer": person("Wraxlington"),
        "ansprechperson": person("Wraxlington") if trainer_ist_zugleich == "ansprechperson" else person("Quillhilde"),
        "stellvertretung": person("Bramblewick"),
        "trainer_ist_zugleich": trainer_ist_zugleich,
    }


def bewerbung_document(bewerbung_id: ObjectId = BEWERBUNG_OID, **overrides: Any) -> dict[str, Any]:
    """One submitted application with its three live links, inside its deadline, that each case moves one thing of."""

    return {
        "_id": bewerbung_id,
        "saison_id": SAISON_ID,
        "eingereicht_am": "2026-03-20",
        "status": "eingereicht",
        "team_id": None,
        "schule": {
            "team_name": SCHOOL_NAME,
            "full_name": f"{SCHOOL_NAME}-Gesamtschule",
            "shorthand": "ZX",
            "schulform": "gesamtschule",
            "address": dict(ADDRESS),
            "website_url": None,
        },
        "kontakte": kontakte(),
        "trikot": {"vorhandener_satz": "keiner", "wunschfarbe": "rot"},
        "kader": {"voraussichtliche_groesse": 14, "gute_spieler": 3},
        "wunschgegner": None,
        "entscheidung": None,
        "bestaetigungsfrist": "2026-04-03",
        "bestaetigungen": compose_bestaetigungen(hashes=HASHES, today="2026-03-20"),
        **overrides,
    }


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, documents: list[dict[str, Any]] | None = None) -> Any:
    """The SHIPPED validators, so a document production would refuse fails here too."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.TEAMS].insert_one(
                {
                    "_id": CLUB_OID,
                    "name": CLUB_NAME,
                    "shorthand": "AD",
                    "description": "",
                    "full_name": f"{CLUB_NAME}-Schule",
                    "website_url": None,
                    "schulform": "gymnasium_g9",
                    "address": dict(ADDRESS),
                    "inactive_since": None,
                }
            )
            await database[Collection.BEWERBUNGEN].insert_many(documents if documents is not None else [bewerbung_document()])

            return await body(database, client)

    return on_the_seed_loop(_run())


async def ansicht(database: AsyncDatabase, token: str) -> Any:
    return await get_einwilligung_ansicht(
        ansicht_data=FLBewerbungEinwilligungAnsichtPayload(token=token),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        teams_collection=database[Collection.TEAMS],
        today=TODAY,
    )


async def answer(database: AsyncDatabase, client: AsyncMongoClient, token: str, **overrides: Any) -> Any:
    body = {"token": token, "antwort": "erteilt", "geburtsdatum": AN_ADULTS_BIRTHDATE, "whatsapp": True, "text_version": "v4", **overrides}

    return await post_einwilligung(
        antwort_data=FLBewerbungEinwilligungAntwortPayload.model_validate(body),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        today=TODAY,
        germany_now=NOW,
    )


async def resend(database: AsyncDatabase, seat: str, bewerbung_id: ObjectId = BEWERBUNG_OID) -> Any:
    return await erneut_einwilligung(bewerbung_id=bewerbung_id, seat=seat, bewerbungen_collection=database[Collection.BEWERBUNGEN], today=TODAY)


async def stored(database: AsyncDatabase, bewerbung_id: ObjectId = BEWERBUNG_OID) -> Mapping[str, Any]:
    found = await database[Collection.BEWERBUNGEN].find_one({"_id": bewerbung_id})
    assert found is not None, "the seeded application is gone"

    return found


async def log_rows(database: AsyncDatabase) -> list[Mapping[str, Any]]:
    return await database[Collection.AKTIONEN].find({"collection": str(Collection.BEWERBUNGEN)}).sort("_id", 1).to_list(length=None)


class TestWhatALinkOpens:
    def test_a_live_link_shows_the_seat_and_no_contact_record(self, mongo_replica_set_url: str):
        """`READ-BEWERBUNG-002`: a first name, a school, a season, a role and a wording, and nothing a leaked link could act on."""

        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW["ansprechperson"]))

        assert (response.zustand, response.saison_id, response.schule, response.rolle) == ("gueltig", SAISON_ID, SCHOOL_NAME, "ansprechperson")
        assert (response.vorname, response.text_version) == ("Quillhilde", "v3")
        rendered = response.model_dump_json()
        assert "Mustermann" not in rendered and "example.com" not in rendered and "1234567" not in rendered

    def test_a_picked_clubs_application_names_the_club(self, mongo_replica_set_url: str):
        picked = bewerbung_document(PICKED_BEWERBUNG_OID, team_id=CLUB_OID, schule=None)

        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW["trainer"]), documents=[picked])

        assert response.schule == CLUB_NAME

    def test_a_token_no_seat_holds_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> str:
            with pytest.raises(DocumentConflictException) as conflict:
                await ansicht(database, "a-stranger's-guess")

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body) == BEWERBUNG_TOKEN_UNKNOWN

    def test_a_link_past_its_deadline_is_shown_as_expired_rather_than_refused(self, mongo_replica_set_url: str):
        expired = bewerbung_document(bestaetigungsfrist=YESTERDAY)

        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW["trainer"]), documents=[expired])

        assert response.zustand == "abgelaufen"


class TestWhatAConfirmationWrites:
    """The one `$set`: `docs/backend/spec.md :: I141`'s pairing lands whole, and the hash stays where it is."""

    def test_the_date_the_stamp_the_source_the_wording_and_the_scope_land_together(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await answer(database, client, RAW["trainer"])

            return response, await stored(database), await log_rows(database)

        response, document, rows = on_a_league(mongo_replica_set_url, body)

        trainer = document["kontakte"]["trainer"]
        assert trainer["geburtsdatum"] == AN_ADULTS_BIRTHDATE
        # The wording the CONFIRMING person saw, not the one the applicant ticked for them.
        assert trainer["einwilligung"] == {
            "umfang": "kontaktdaten_whatsapp",
            "erteilt_von": "person",
            "text_version": "v4",
            "datum": "2026-03-20",
            "bestaetigt_am": TODAY,
        }
        # NOT nulled on use: single use is the stamp's doing, so the reopened link can show its state.
        assert document["bestaetigungen"]["trainer"]["token_hash"] == HASHES["trainer"]
        assert (response.ergebnis, response.ausstehend, response.geburtsdatum, response.whatsapp) == (
            "bestaetigt",
            ["ansprechperson", "stellvertretung"],
            AN_ADULTS_BIRTHDATE,
            True,
        )
        # One write, one row, one image: the confirmation is a patch and files the pre-image like any other.
        assert [row["operation"] for row in rows] == ["patch_one"]
        assert rows[0]["before"]["kontakte"]["trainer"]["geburtsdatum"] is None

    def test_a_declined_whatsapp_tick_keeps_the_narrow_scope(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW["trainer"], whatsapp=False)

            return await stored(database)

        assert on_a_league(mongo_replica_set_url, body)["kontakte"]["trainer"]["einwilligung"]["umfang"] == "kontaktdaten"

    def test_the_other_seats_are_untouched(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW["trainer"])

            return await stored(database)

        document = on_a_league(mongo_replica_set_url, body)

        for seat in ("ansprechperson", "stellvertretung"):
            assert document["kontakte"][seat] == bewerbung_document()["kontakte"][seat]

    def test_the_double_seated_trainer_is_answered_on_both_seats_by_one_click(self, mongo_replica_set_url: str):
        """Without the mirror the two blocks can hold two dates, and the equality the submission asserted becomes a claim about the form."""

        paired = bewerbung_document(kontakte=kontakte(trainer_ist_zugleich="ansprechperson"))

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await answer(database, client, RAW["ansprechperson"])

            return response, await stored(database)

        response, document = on_a_league(mongo_replica_set_url, body, documents=[paired])

        assert response.ausstehend == ["stellvertretung"]
        for seat in ("trainer", "ansprechperson"):
            assert document["kontakte"][seat]["geburtsdatum"] == AN_ADULTS_BIRTHDATE
            assert document["kontakte"][seat]["einwilligung"]["bestaetigt_am"] == TODAY
        assert document["kontakte"]["trainer"] == document["kontakte"]["ansprechperson"]


class TestTheLinkIsSpentByTheStamp:
    def test_a_second_answer_on_the_same_link_is_refused_and_the_reopened_link_shows_confirmed(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW["trainer"])

            with pytest.raises(DocumentConflictException) as conflict:
                await answer(database, client, RAW["trainer"], geburtsdatum="1990-01-01")

            return (
                conflict.value.error_code,
                (await stored(database))["kontakte"]["trainer"]["geburtsdatum"],
                await ansicht(database, RAW["trainer"]),
            )

        code, geburtsdatum, view = on_a_league(mongo_replica_set_url, body)

        assert code == BEWERBUNG_SEAT_ALREADY_ANSWERED
        assert geburtsdatum == AN_ADULTS_BIRTHDATE
        assert view.zustand == "bestaetigt"

    def test_an_age_refusal_spends_nothing(self, mongo_replica_set_url: str):
        """A mistyped year is the commonest error on a date field; a link voided by one has no remedy but a re-send."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentConflictException) as conflict:
                await answer(database, client, RAW["trainer"], geburtsdatum=A_CHILDS_BIRTHDATE)

            return conflict.value.error_code, await ansicht(database, RAW["trainer"]), await stored(database), await log_rows(database)

        code, view, document, rows = on_a_league(mongo_replica_set_url, body)

        assert code == BEWERBUNG_KONTAKT_ALTER
        assert view.zustand == "gueltig"
        assert document == bewerbung_document()
        assert rows == []

    def test_a_link_past_its_deadline_is_refused_before_the_seat_is_judged(self, mongo_replica_set_url: str):
        expired = bewerbung_document(bestaetigungsfrist=YESTERDAY)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            with pytest.raises(DocumentConflictException) as conflict:
                await answer(database, client, RAW["trainer"])

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body, documents=[expired]) == BEWERBUNG_TOKEN_EXPIRED


class TestADecline:
    """The person's slot is emptied and the log redacted in ONE transaction, as an erasure does: a person who refuses is not held."""

    def test_the_slot_is_emptied_the_day_recorded_beside_it_and_the_seat_still_outstanding(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await answer(database, client, RAW["stellvertretung"], antwort="abgelehnt", geburtsdatum=None)

            return response, await stored(database), await ansicht(database, RAW["stellvertretung"])

        response, document, view = on_a_league(mongo_replica_set_url, body)

        assert document["kontakte"]["stellvertretung"] is None
        assert document["bestaetigungen"]["stellvertretung"]["abgelehnt_am"] == TODAY
        assert (response.ergebnis, response.geburtsdatum) == ("abgelehnt", None)
        assert response.ausstehend == list(KONTAKT_SEATS)
        assert (view.zustand, view.vorname, view.text_version) == ("abgelehnt", None, None)

    def test_every_log_image_holding_the_person_is_emptied_and_stamped(self, mongo_replica_set_url: str):
        """The clearing patch files the pre-image, so the redaction has to reach the row it just wrote."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW["stellvertretung"], antwort="abgelehnt", geburtsdatum=None)

            return await log_rows(database)

        rows = on_a_league(mongo_replica_set_url, body)

        assert len(rows) == 1
        assert (rows[0]["before"], rows[0]["redacted_at"]) == (None, REDACTED_AT)

    def test_a_declined_seat_takes_no_second_answer(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            await answer(database, client, RAW["stellvertretung"], antwort="abgelehnt", geburtsdatum=None)

            with pytest.raises(DocumentConflictException) as conflict:
                await answer(database, client, RAW["stellvertretung"])

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body) == BEWERBUNG_SEAT_ALREADY_ANSWERED


class TestNoHashReachesAnAdminRead:
    """The plan's evidence line: the projection keeps the hash off the wire where the model alone would drop it after."""

    def test_neither_admin_read_serves_a_hash_while_the_document_holds_three(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            one = await get_bewerbung_by_id(bewerbung_id=BEWERBUNG_OID, bewerbungen_collection=database[Collection.BEWERBUNGEN])
            many = await get_bewerbungen(bewerbungen_collection=database[Collection.BEWERBUNGEN], filters=FLBewerbungenFilterParams())

            return one.model_dump_json(), many.model_dump_json(), await stored(database)

        one, many, document = on_a_league(mongo_replica_set_url, body)

        assert all(document["bestaetigungen"][seat]["token_hash"] == HASHES[seat] for seat in KONTAKT_SEATS)
        for rendered in (one, many):
            assert "token_hash" not in rendered
            assert not any(token_hash in rendered for token_hash in HASHES.values())
            # The rest of the block still reaches the triage, which renders the per-seat facts off it.
            assert "verschickt_am" in rendered


class TestAResend:
    def test_a_fresh_link_voids_the_old_and_restarts_the_deadline(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await resend(database, "trainer")

            with pytest.raises(DocumentConflictException) as conflict:
                await ansicht(database, RAW["trainer"])

            return response, conflict.value.error_code, await ansicht(database, response.token), await stored(database)

        response, old_code, view, document = on_a_league(mongo_replica_set_url, body)

        assert old_code == BEWERBUNG_TOKEN_UNKNOWN
        assert (view.zustand, view.rolle) == ("gueltig", "trainer")
        assert (response.rolle, response.bestaetigungsfrist) == ("trainer", "2026-04-15")
        assert document["bestaetigungsfrist"] == "2026-04-15"
        assert document["bestaetigungen"]["trainer"] == {
            "token_hash": hash_token(response.token),
            "verschickt_am": TODAY,
            "erinnert_am": None,
            "abgelehnt_am": None,
        }
        # The other seats' links still open.
        assert document["bestaetigungen"]["ansprechperson"]["token_hash"] == HASHES["ansprechperson"]

    def test_a_confirmed_seat_gets_no_new_link(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            await answer(database, client, RAW["trainer"])

            with pytest.raises(DocumentConflictException) as conflict:
                await resend(database, "trainer")

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body) == BEWERBUNG_SEAT_ALREADY_ANSWERED

    def test_a_decided_application_gets_no_new_link(self, mongo_replica_set_url: str):
        decided = bewerbung_document(status="abgelehnt", entscheidung={"getroffen_am": YESTERDAY, "von": "admin", "grund": "kein Platz"})

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> str:
            with pytest.raises(DocumentConflictException) as conflict:
                await resend(database, "trainer")

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body, documents=[decided]) == BEWERBUNG_ALREADY_DECIDED

    def test_an_application_stored_before_the_flow_has_no_seat_to_resend(self, mongo_replica_set_url: str):
        before_the_flow = bewerbung_document()
        del before_the_flow["bestaetigungen"]
        del before_the_flow["bestaetigungsfrist"]

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> str:
            with pytest.raises(DocumentConflictException) as conflict:
                await resend(database, "trainer")

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body, documents=[before_the_flow]) == BEWERBUNG_SEAT_ALREADY_ANSWERED

    def test_a_path_naming_no_seat_is_a_miss(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentNotFoundException):
                await resend(database, "trainer_ist_zugleich")

            return await stored(database)

        assert on_a_league(mongo_replica_set_url, body) == bewerbung_document()
