from collections.abc import Awaitable, Callable, Mapping
from typing import Any

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.services import hash_token
from app.api.registrierungen.einwilligung_router import get_bestaetigung_ansicht, post_bestaetigung
from app.api.registrierungen.schemas import FLRegistrierungBestaetigungAnsichtPayload, FLRegistrierungBestaetigungPayload
from app.api.registrierungen.services import (
    REGISTRIERUNG_ALREADY_CONFIRMED,
    REGISTRIERUNG_ALTER,
    REGISTRIERUNG_TOKEN_EXPIRED,
    REGISTRIERUNG_TOKEN_UNKNOWN,
    compose_bestaetigung,
)
from app.core.collections import Collection
from app.core.exceptions import DocumentConflictException, DocumentNotFoundException
from app.shared.schemas.bounds import REGISTRIERUNG_MIN_ALTER_JAHRE
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

# Module level, as the application's confirmation suite marks its own: every test below reaches a
# real mongod.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_registrierung_einwilligung_test")

SAISON_ID = "2026"
TODAY = "2026-04-01"
YESTERDAY = "2026-03-31"
TOMORROW = "2026-04-02"

# Fixed rather than generated, so a failure names the same row every run.
REGISTRIERUNG_OID = ObjectId("6890a1b2c3d4e5f607960001")
EINLADUNG_OID = ObjectId("6890a1b2c3d4e5f607960002")
TEAM_OID = ObjectId("6890a1b2c3d4e5f607960011")
OTHER_TEAM_OID = ObjectId("6890a1b2c3d4e5f607960012")
SPIELER_OID = ObjectId("6890a1b2c3d4e5f607960021")
TWIN_OID = ObjectId("6890a1b2c3d4e5f607960022")

TEAM_NAME = "Adler"
TEAM_FULL_NAME = "Zorbanax-Gesamtschule"

RAW = "raw-token-for-this-pupil"
TOKEN_HASH = hash_token(RAW)
RAW_ERINNERT = "the-first-link-this-pupil-was-mailed"

# Unfolded, as the payload stores it. `spieler.email` holds the fold of it, which is what the person join asks on.
TYPED_EMAIL = "Quillhilde@Example.com"
FOLDED_EMAIL = "quillhilde@example.com"

# Against `TODAY`, `2010-04-01` is 16 to the day and `2010-04-02` is 15 years and 364 days.
AT_THE_FLOOR = "2010-04-01"
A_DAY_SHORT = "2010-04-02"
A_RETURNING_PUPILS_BIRTHDATE = "2008-07-14"
A_TWINS_BIRTHDATE = "2007-02-02"

THIS_SEASONS_LABEL = "2026-09-spielerseite"
AN_OLDER_LABEL = "2025-09-spielerseite"

ADDRESS: Mapping[str, Any] = {
    "strasse": "Hanauer Landstraße",
    "hausnummer": "12a",
    "plz": "60314",
    "stadtteil": "Ostend",
    "stadt": "Frankfurt am Main",
}


def team_document(team_id: ObjectId, name: str, full_name: str) -> dict[str, Any]:
    return {
        "_id": team_id,
        "name": name,
        "shorthand": name[:2].upper(),
        "description": "",
        "full_name": full_name,
        "website_url": None,
        "schulform": "gymnasium_g9",
        "address": dict(ADDRESS),
        "inactive_since": None,
    }


def einwilligung(**overrides: Any) -> dict[str, Any]:
    return {
        "umfang": "intern",
        "erteilt_von": "volljaehrig",
        "datum": "2025-09-02",
        "bestaetigt_am": "2025-09-02",
        "text_version": AN_OLDER_LABEL,
        "medien": True,
        **overrides,
    }


def spieler_document(spieler_id: ObjectId, **overrides: Any) -> dict[str, Any]:
    """One person the league already holds, whose record a returning pupil's page shows back."""

    return {
        "_id": spieler_id,
        "vorname": "Quillhilde",
        "nachname": "Brackenmoor",
        "geburtsdatum": A_RETURNING_PUPILS_BIRTHDATE,
        "einwilligung": einwilligung(),
        "email": FOLDED_EMAIL,
        "inactive_since": None,
        **overrides,
    }


def registrierung_document(**overrides: Any) -> dict[str, Any]:
    """One submitted registration with its live link, inside its deadline, that each case moves one thing of."""

    return {
        "_id": REGISTRIERUNG_OID,
        "saison_id": SAISON_ID,
        "team_id": TEAM_OID,
        "einladung_id": EINLADUNG_OID,
        "eingereicht_am": "2026-03-26",
        "status": "eingereicht",
        "vorname": "Quillhilde",
        "nachname": "Brackenmoor",
        "email": TYPED_EMAIL,
        "position": "Abwehr",
        "nummer": "7",
        "stufe": "Q1",
        "geburtsdatum": None,
        "einwilligung": None,
        "bestaetigung": compose_bestaetigung(token_hash=TOKEN_HASH, today="2026-03-26", frist=TOMORROW),
        "entscheidung": None,
        **overrides,
    }


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(
    url: str,
    body: Body,
    *,
    registrierungen: list[dict[str, Any]] | None = None,
    spieler: list[dict[str, Any]] | None = None,
) -> Any:
    """The SHIPPED validators, so a document production would refuse fails here too."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.TEAMS].insert_many(
                [
                    team_document(TEAM_OID, TEAM_NAME, TEAM_FULL_NAME),
                    team_document(OTHER_TEAM_OID, "Falken", "Wraxlington-Gymnasium"),
                ]
            )
            await database[Collection.REGISTRIERUNGEN].insert_many(
                registrierungen if registrierungen is not None else [registrierung_document()]
            )
            if spieler:
                await database[Collection.SPIELER].insert_many(spieler)

            return await body(database, client)

    return on_the_seed_loop(_run())


async def ansicht(database: AsyncDatabase, token: str) -> Any:
    return await get_bestaetigung_ansicht(
        ansicht_data=FLRegistrierungBestaetigungAnsichtPayload(token=token),
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
        teams_collection=database[Collection.TEAMS],
        spieler_collection=database[Collection.SPIELER],
        today=TODAY,
    )


async def answer(database: AsyncDatabase, client: AsyncMongoClient, token: str, **overrides: Any) -> Any:
    body = {
        "token": token,
        "geburtsdatum": AT_THE_FLOOR,
        "umfang": "kader_oeffentlich",
        "medien": True,
        "text_version": THIS_SEASONS_LABEL,
        **overrides,
    }

    return await post_bestaetigung(
        antwort_data=FLRegistrierungBestaetigungPayload.model_validate(body),
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
        db=client,
        today=TODAY,
    )


async def stored(database: AsyncDatabase) -> Mapping[str, Any]:
    found = await database[Collection.REGISTRIERUNGEN].find_one({"_id": REGISTRIERUNG_OID})
    assert found is not None, "the seeded registration is gone"

    return found


async def log_rows(database: AsyncDatabase) -> list[Mapping[str, Any]]:
    return await database[Collection.AKTIONEN].find({"collection": str(Collection.REGISTRIERUNGEN)}).sort("_id", 1).to_list(length=None)


class TestWhatALinkOpens:
    def test_a_live_link_names_the_team_its_school_the_season_and_the_pupil(self, mongo_replica_set_url: str):
        """The four slots the ruled consent text renders; a slot with no value renders as a hole in it."""

        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW))

        assert (response.zustand, response.team, response.schule) == ("gueltig", TEAM_NAME, TEAM_FULL_NAME)
        assert (response.saison_id, response.vorname) == (SAISON_ID, "Quillhilde")
        assert response.mindestalter == REGISTRIERUNG_MIN_ALTER_JAHRE

    def test_the_link_carries_no_other_teams_name_and_nothing_else_of_the_registration(self, mongo_replica_set_url: str):
        """A leaked link learns what the mail it arrived in already said, and never the surname, the address, the number or the Stufe."""

        rendered = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW)).model_dump_json()

        assert "Falken" not in rendered and "Wraxlington" not in rendered
        assert "Brackenmoor" not in rendered
        assert TYPED_EMAIL not in rendered and FOLDED_EMAIL not in rendered
        assert "Abwehr" not in rendered and "Q1" not in rendered

    def test_a_first_timer_is_asked_rather_than_shown(self, mongo_replica_set_url: str):
        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW))

        assert (response.geburtsdatum, response.umfang, response.medien, response.text_version) == (None, None, None, None)

    def test_a_returning_pupil_is_shown_what_the_league_already_holds(self, mongo_replica_set_url: str):
        """A returning pupil gets one short page: the two choices re-presented at what stands, and the birthdate shown rather than asked for."""

        held = [spieler_document(SPIELER_OID)]

        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW), spieler=held)

        assert response.geburtsdatum == A_RETURNING_PUPILS_BIRTHDATE
        assert (response.umfang, response.medien) == ("intern", True)
        # The label answered under, so a reopened link names the words consented to rather than
        # the ones this page would stamp today.
        assert response.text_version == AN_OLDER_LABEL

    def test_the_join_asks_on_the_folded_address(self, mongo_replica_set_url: str):
        """The registration stores the address unfolded; `spieler.email` stores the fold, so an unfolded compare finds nobody."""

        capitalised = spieler_document(SPIELER_OID, email="QUILLHILDE@EXAMPLE.COM")

        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW), spieler=[capitalised])

        assert response.geburtsdatum is None

    def test_the_join_reaches_a_pupil_whose_domain_was_stored_in_unicode(self, mongo_replica_set_url: str):
        """A registration stores the punycode, and a pupil stored before the address rule the decoded domain.

        An equality on one spelling shows this pupil nothing.
        """

        typed = registrierung_document(email="quillhilde@xn--exmple-cua.com")
        stored_before = spieler_document(SPIELER_OID, email="quillhilde@exämple.com")

        response = on_a_league(
            mongo_replica_set_url, lambda database, _: ansicht(database, RAW), registrierungen=[typed], spieler=[stored_before]
        )

        assert response.geburtsdatum == A_RETURNING_PUPILS_BIRTHDATE

    def test_a_differently_named_pupil_at_the_same_mailbox_is_shown_nothing(self, mongo_replica_set_url: str):
        """The defect the name narrowing exists for.

        On the address alone this pupil is shown the stored person's birthdate, and the form then
        stores it onto their own registration, the date being rendered read-only.
        """

        sibling = registrierung_document(vorname="Bramblewick")
        held = [spieler_document(SPIELER_OID)]

        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW), registrierungen=[sibling], spieler=held)

        assert (response.geburtsdatum, response.umfang, response.medien, response.text_version) == (None, None, None, None)

    def test_each_of_two_pupils_at_one_mailbox_is_shown_their_own_record(self, mongo_replica_set_url: str):
        """The other half: the narrowing must not cost a returning sibling the answers they themselves gave."""

        twin = spieler_document(TWIN_OID, vorname="Bramblewick", geburtsdatum=A_TWINS_BIRTHDATE)
        household = [spieler_document(SPIELER_OID), twin]

        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW), spieler=household)

        assert response.geburtsdatum == A_RETURNING_PUPILS_BIRTHDATE

    def test_the_later_seeded_pupil_of_a_household_is_shown_their_own_record(self, mongo_replica_set_url: str):
        """The case above names the pupil seeded FIRST, so a read carrying one row would still find them.

        What this one drives is `app/api/registrierungen/einwilligung_router.py :: _PERSONS_READ`
        bounding the household the narrowing can reach.
        """

        twin = spieler_document(TWIN_OID, vorname="Bramblewick", geburtsdatum=A_TWINS_BIRTHDATE)
        household = [spieler_document(SPIELER_OID), twin]
        theirs = registrierung_document(vorname="Bramblewick")

        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW), registrierungen=[theirs], spieler=household)

        assert response.geburtsdatum == A_TWINS_BIRTHDATE

    def test_a_household_past_the_bound_shows_nobody_even_where_one_namesake_is_inside_it(self, mongo_replica_set_url: str):
        """Nine rows at one mailbox, the pupil's two namesakes seeded last: a read capped at eight reaches one of them and shows it as sole."""

        others = [spieler_document(ObjectId(f"6890a1b2c3d4e5f60796003{n}"), vorname=f"Geschwister{n}") for n in range(7)]
        namesakes = [spieler_document(ObjectId("6890a1b2c3d4e5f607960038")), spieler_document(ObjectId("6890a1b2c3d4e5f607960039"))]

        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW), spieler=[*others, *namesakes])

        assert (response.geburtsdatum, response.umfang, response.medien) == (None, None, None)

    def test_a_household_past_the_bound_shows_nobody_even_where_the_pupil_is_sole_inside_it(self, mongo_replica_set_url: str):
        """The bound's own rule: nine rows holding ONE namesake, whom the narrowing alone would show as sole."""

        others = [spieler_document(ObjectId(f"6890a1b2c3d4e5f60796004{n}"), vorname=f"Geschwister{n}") for n in range(8)]

        response = on_a_league(
            mongo_replica_set_url, lambda database, _: ansicht(database, RAW), spieler=[*others, spieler_document(SPIELER_OID)]
        )

        assert (response.geburtsdatum, response.umfang, response.medien) == (None, None, None)

    def test_a_token_no_registration_holds_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> str:
            with pytest.raises(DocumentConflictException) as conflict:
                await ansicht(database, "a-stranger's-guess")

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body) == REGISTRIERUNG_TOKEN_UNKNOWN

    def test_a_link_past_its_deadline_is_shown_as_expired_rather_than_refused(self, mongo_replica_set_url: str):
        expired = registrierung_document(bestaetigung=compose_bestaetigung(token_hash=TOKEN_HASH, today="2026-03-20", frist=YESTERDAY))

        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW), registrierungen=[expired])

        assert response.zustand == "abgelaufen"

    def test_a_reminders_second_link_opens_the_same_row(self, mongo_replica_set_url: str):
        """Both links live at once, so a pupil still looking at the first mail is not punished by the chase."""

        reminded = registrierung_document()
        reminded["bestaetigung"] |= {"token_hash": hash_token(RAW_ERINNERT), "token_hash_zuvor": TOKEN_HASH, "erinnert_am": "2026-03-29"}

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[Any, Any]:
            return await ansicht(database, RAW), await ansicht(database, RAW_ERINNERT)

        first, fresh = on_a_league(mongo_replica_set_url, body, registrierungen=[reminded])

        assert (first.zustand, fresh.zustand) == ("gueltig", "gueltig")

    def test_a_registration_whose_team_is_gone_is_a_miss_rather_than_a_consent_text_with_a_hole(self, mongo_replica_set_url: str):
        orphan = registrierung_document(team_id=ObjectId("6890a1b2c3d4e5f607960099"))

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> None:
            with pytest.raises(DocumentNotFoundException):
                await ansicht(database, RAW)

        on_a_league(mongo_replica_set_url, body, registrierungen=[orphan])


class TestWhatAConfirmationWrites:
    """One `$set`: `docs/backend/spec.md :: I141`'s pairing lands whole, and the hash stays where it is."""

    def test_the_date_and_the_whole_record_land_together(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await answer(database, client, RAW)

            return response, await stored(database), await log_rows(database)

        response, document, rows = on_a_league(mongo_replica_set_url, body)

        assert document["geburtsdatum"] == AT_THE_FLOOR
        assert document["einwilligung"] == {
            "umfang": "kader_oeffentlich",
            "erteilt_von": "volljaehrig",
            "datum": TODAY,
            "bestaetigt_am": TODAY,
            "text_version": THIS_SEASONS_LABEL,
            "medien": True,
        }
        # NOT nulled on use: single use is the stamp's doing, so the reopened link can show its state.
        assert document["bestaetigung"]["token_hash"] == TOKEN_HASH
        assert (response.ergebnis, response.geburtsdatum, response.umfang, response.medien) == (
            "bestaetigt",
            AT_THE_FLOOR,
            "kader_oeffentlich",
            True,
        )
        # One write, one row, one image: the confirmation is a patch and files its pre-image like any other.
        assert [row["operation"] for row in rows] == ["patch_one"]
        assert rows[0]["before"]["einwilligung"] is None

    def test_the_registration_stays_pending_and_writes_no_person_and_no_squad_row(self, mongo_replica_set_url: str):
        """A confirmed registration is admissible and not admitted; the person and the junction row are a later decision's."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW)

            return (
                await stored(database),
                await database[Collection.SPIELER].count_documents({}),
                await database[Collection.SAISON_SPIELER].count_documents({}),
            )

        document, people, squad_rows = on_a_league(mongo_replica_set_url, body)

        assert document["status"] == "eingereicht"
        assert (people, squad_rows) == (0, 0)

    def test_the_media_switch_left_off_is_stored_as_the_answer_it_is(self, mongo_replica_set_url: str):
        """Publication and media are two consents under one record, so an off switch is stored rather than derived from the scope."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW, umfang="intern", medien=False)

            return await stored(database)

        record = on_a_league(mongo_replica_set_url, body)["einwilligung"]

        assert (record["umfang"], record["medien"]) == ("intern", False)

    def test_a_returning_pupils_press_restamps_under_the_label_they_just_read(self, mongo_replica_set_url: str):
        """The view shows the record given under the older words, and the press renews it under the ones this person just read."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            view = await ansicht(database, RAW)
            await answer(database, client, RAW, geburtsdatum=A_RETURNING_PUPILS_BIRTHDATE)

            return view, await stored(database), await database[Collection.SPIELER].find_one({"_id": SPIELER_OID})

        view, document, person = on_a_league(mongo_replica_set_url, body, spieler=[spieler_document(SPIELER_OID)])

        assert view.text_version == AN_OLDER_LABEL
        assert document["einwilligung"]["text_version"] == THIS_SEASONS_LABEL
        assert document["geburtsdatum"] == A_RETURNING_PUPILS_BIRTHDATE
        # The person's own record is the admission's to update, so nothing here rewrites it.
        assert person is not None and person["einwilligung"]["text_version"] == AN_OLDER_LABEL

    def test_the_answer_carries_nothing_of_the_registration_beyond_what_was_posted(self, mongo_replica_set_url: str):
        """A response re-read off the updated document would widen this page's answer to everything a registration holds."""

        rendered = on_a_league(mongo_replica_set_url, lambda database, client: answer(database, client, RAW)).model_dump_json()

        assert "Brackenmoor" not in rendered and TYPED_EMAIL not in rendered
        assert TOKEN_HASH not in rendered and RAW not in rendered


class TestTheLinkIsSpentByTheStamp:
    def test_a_second_press_is_refused_and_the_first_answer_stands(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW)

            with pytest.raises(DocumentConflictException) as conflict:
                await answer(database, client, RAW, umfang="intern", medien=False)

            return conflict.value.error_code, await stored(database), await ansicht(database, RAW)

        code, document, view = on_a_league(mongo_replica_set_url, body)

        assert code == REGISTRIERUNG_ALREADY_CONFIRMED
        assert (document["einwilligung"]["umfang"], document["einwilligung"]["medien"]) == ("kader_oeffentlich", True)
        assert view.zustand == "bestaetigt"

    def test_an_age_refusal_spends_nothing(self, mongo_replica_set_url: str):
        """A mistyped year is the commonest error on a date field, and a link voided by one has no remedy but registering again."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentConflictException) as conflict:
                await answer(database, client, RAW, geburtsdatum=A_DAY_SHORT)

            return conflict.value.error_code, await ansicht(database, RAW), await stored(database), await log_rows(database)

        code, view, document, rows = on_a_league(mongo_replica_set_url, body)

        assert code == REGISTRIERUNG_ALTER
        assert view.zustand == "gueltig"
        assert document == registrierung_document()
        assert rows == []

    def test_the_floor_to_the_day_is_taken(self, mongo_replica_set_url: str):
        """The other half of the pair: without it the case above passes for a floor set anywhere at all."""

        response = on_a_league(mongo_replica_set_url, lambda database, client: answer(database, client, RAW, geburtsdatum=AT_THE_FLOOR))

        assert response.ergebnis == "bestaetigt"

    def test_a_link_past_its_deadline_is_refused_before_the_stamp_is_judged(self, mongo_replica_set_url: str):
        expired = registrierung_document(bestaetigung=compose_bestaetigung(token_hash=TOKEN_HASH, today="2026-03-20", frist=YESTERDAY))

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentConflictException) as conflict:
                await answer(database, client, RAW)

            return conflict.value.error_code, await stored(database)

        code, document = on_a_league(mongo_replica_set_url, body, registrierungen=[expired])

        assert code == REGISTRIERUNG_TOKEN_EXPIRED
        assert document["einwilligung"] is None

    def test_a_decided_registration_takes_no_answer_either(self, mongo_replica_set_url: str):
        """One code for both: a pupil whose registration was declined while their link stood open is told the link is over, not why."""

        entscheidung = {"getroffen_am": YESTERDAY, "von": "admin", "grund": "kein Platz"}
        declined = registrierung_document(status="abgelehnt", entscheidung=entscheidung)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            with pytest.raises(DocumentConflictException) as conflict:
                await answer(database, client, RAW)

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body, registrierungen=[declined]) == REGISTRIERUNG_TOKEN_EXPIRED

    def test_an_expired_link_carrying_a_refused_date_answers_the_link_rather_than_the_age(self, mongo_replica_set_url: str):
        """The order, which no other case pins: judged age-first, a dead link would tell a pupil to correct a date that buys them nothing."""

        expired = registrierung_document(bestaetigung=compose_bestaetigung(token_hash=TOKEN_HASH, today="2026-03-20", frist=YESTERDAY))

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            with pytest.raises(DocumentConflictException) as conflict:
                await answer(database, client, RAW, geburtsdatum=A_DAY_SHORT)

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body, registrierungen=[expired]) == REGISTRIERUNG_TOKEN_EXPIRED

    def test_a_confirmed_registration_carrying_a_refused_date_answers_the_stamp_rather_than_the_age(self, mongo_replica_set_url: str):
        """The other half of the order: a pupil who has already answered is told so rather than asked to retype a date nothing will store."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            await answer(database, client, RAW)

            with pytest.raises(DocumentConflictException) as conflict:
                await answer(database, client, RAW, geburtsdatum=A_DAY_SHORT)

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body) == REGISTRIERUNG_ALREADY_CONFIRMED

    def test_a_token_no_registration_holds_is_refused_before_anything_is_read_of_a_row(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentConflictException) as conflict:
                await answer(database, client, "a-stranger's-guess")

            return conflict.value.error_code, await stored(database)

        code, document = on_a_league(mongo_replica_set_url, body)

        assert code == REGISTRIERUNG_TOKEN_UNKNOWN
        assert document == registrierung_document()
