from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.services import hash_token
from app.api.einwilligung.services import FASSUNG_UNZULAESSIG
from app.api.registrierungen.einwilligung_router import get_bestaetigung_ansicht, post_bestaetigung
from app.api.registrierungen.schemas import FLRegistrierungBestaetigungAnsichtPayload, FLRegistrierungBestaetigungPayload
from app.api.registrierungen.services import (
    REGISTRIERUNG_ALREADY_CONFIRMED,
    REGISTRIERUNG_ALTER,
    REGISTRIERUNG_BESTAETIGUNG_GESPERRT,
    REGISTRIERUNG_MEDIEN_ALTER,
    REGISTRIERUNG_TOKEN_EXPIRED,
    REGISTRIERUNG_TOKEN_UNKNOWN,
    REGISTRIERUNG_WAHLEN_UNPASSEND,
    SEITE_NEU,
    SEITE_WIEDERKEHREND,
    compose_bestaetigung,
)
from app.api.saisons.cache import invalidate_saison_cache
from app.api.sperrliste.services import compose_gesperrt_bis_saison_id
from app.core.collections import Collection
from app.core.exceptions import WriteRefusalException
from app.shared.einwilligung import LAUFENDE_FASSUNGEN
from app.shared.schemas.bounds import MEDIEN_MIN_AGE_YEARS, REGISTRIERUNG_MIN_ALTER_JAHRE
from tests import documents
from tests.bans import ban_list
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

# Module level, as the application's confirmation suite marks its own: every test below reaches a
# real mongod.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_registrierung_einwilligung_test")

SAISON_ID = "2026"
TODAY = "2026-04-01"
# The press's instant, and the UTC spelling its entry records it under.
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
AM = "2026-04-01T10:30:00+00:00"
YESTERDAY = "2026-03-31"
TOMORROW = "2026-04-02"

# Fixed rather than generated, so a failure names the same row every run.
REGISTRIERUNG_OID = ObjectId("6890a1b2c3d4e5f607960001")
EINLADUNG_OID = ObjectId("6890a1b2c3d4e5f607960002")
TEAM_OID = ObjectId("6890a1b2c3d4e5f607960011")
OTHER_TEAM_OID = ObjectId("6890a1b2c3d4e5f607960012")
SPIELER_OID = ObjectId("6890a1b2c3d4e5f607960021")

TEAM_NAME = "Adler"
TEAM_FULL_NAME = "Zorbanax-Gesamtschule"

# The other team in the league, whose name no link to this team may carry.
OTHER_TEAM_NAME = "Falken"
OTHER_SCHOOL = "Wraxlington"

RAW = "raw-token-for-this-pupil"
TOKEN_HASH = hash_token(RAW)
RAW_ERINNERT = "the-first-link-this-pupil-was-mailed"

# Unfolded, as the payload stores it. `spieler.email` holds the fold of it, which is what the person join asks on.
TYPED_EMAIL = "Quillhilde@Example.com"
FOLDED_EMAIL = "quillhilde@example.com"

# Against `TODAY`, `2010-04-01` is 16 to the day and `2010-04-02` is 15 years and 364 days.
AT_THE_FLOOR = "2010-04-01"
A_DAY_SHORT = "2010-04-02"
# Eighteen by the held consent's `datum`, as its media yes requires
# (`app/api/registrierungen/services.py :: find_medien_refusal`): a record no write could store proves nothing.
A_RETURNING_PUPILS_BIRTHDATE = "2007-07-14"

# The label the pupil page runs, the one a new acceptance must name.
THIS_SEASONS_LABEL = LAUFENDE_FASSUNGEN["bestaetigung_spieler"]
# The returning pupil's page's, which asks no choice.
RETURNING_LABEL = LAUFENDE_FASSUNGEN["bestaetigung_spieler_wiederkehrend"]
AN_OLDER_LABEL = "2025-09-spielerseite"


def team_document(team_id: ObjectId, name: str, full_name: str) -> dict[str, Any]:
    return documents.team_document(team_id, name, name[:2].upper(), full_name=full_name, website_url=None, schulform="gymnasium_g9")


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

    person = documents.spieler_document(
        spieler_id, "Quillhilde", "Brackenmoor", geburtsdatum=A_RETURNING_PUPILS_BIRTHDATE, einwilligung=einwilligung(), email=FOLDED_EMAIL
    )

    return {**person, **overrides}


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
                    team_document(OTHER_TEAM_OID, OTHER_TEAM_NAME, f"{OTHER_SCHOOL}-Gymnasium"),
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
        sperrliste=ban_list(database),
        today=TODAY,
    )


async def answer(database: AsyncDatabase, client: AsyncMongoClient, token: str, **overrides: Any) -> Any:
    body = {
        "token": token,
        "geburtsdatum": AT_THE_FLOOR,
        "umfang": "kader_oeffentlich",
        # Off, because the default date is sixteen: a media consent is refused below eighteen.
        "medien": False,
        "text_version": THIS_SEASONS_LABEL,
        **overrides,
    }

    return await post_bestaetigung(
        antwort_data=FLRegistrierungBestaetigungPayload.model_validate(body),
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
        spieler_collection=database[Collection.SPIELER],
        sperrliste=ban_list(database),
        db=client,
        today=TODAY,
        germany_now=NOW,
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

        registration = registrierung_document()
        assert OTHER_TEAM_NAME not in rendered and OTHER_SCHOOL not in rendered
        assert registration["nachname"] not in rendered
        assert TYPED_EMAIL not in rendered and FOLDED_EMAIL not in rendered
        assert registration["position"] not in rendered and registration["stufe"] not in rendered

    def test_a_first_timer_is_asked_rather_than_shown(self, mongo_replica_set_url: str):
        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW))

        assert (response.seite, response.geburtsdatum, response.umfang, response.medien) == (SEITE_NEU, None, None, None)

    @pytest.mark.parametrize(
        "person",
        [spieler_document(SPIELER_OID), spieler_document(SPIELER_OID, inactive_since="2025-07-01")],
        ids=("a person in the league", "a person who left it"),
    )
    def test_a_returning_pupil_is_shown_what_the_league_already_holds(self, mongo_replica_set_url: str, person: dict[str, Any]):
        """A returning pupil gets one short page: the two choices shown as they stand, and the birthdate shown rather than asked for."""

        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW), spieler=[person])

        assert (response.seite, response.geburtsdatum) == (SEITE_WIEDERKEHREND, A_RETURNING_PUPILS_BIRTHDATE)
        assert (response.umfang, response.medien) == ("intern", True)

    def test_a_returning_pupil_with_no_stored_birthdate_is_asked_for_one(self, mongo_replica_set_url: str):
        """The page is still the returning one: what makes a pupil returning is a confirmed record, never a stored date."""

        undated = spieler_document(SPIELER_OID, geburtsdatum=None)

        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW), spieler=[undated])

        assert (response.seite, response.geburtsdatum, response.umfang) == (SEITE_WIEDERKEHREND, None, "intern")

    def test_a_record_nobody_confirmed_makes_no_returning_pupil(self, mongo_replica_set_url: str):
        """The returning page says the choices stand as the pupil gave them; an unconfirmed record holds choices nobody gave."""

        unconfirmed = spieler_document(SPIELER_OID, einwilligung=einwilligung(bestaetigt_am=None))

        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW), spieler=[unconfirmed])

        assert (response.seite, response.geburtsdatum, response.umfang, response.medien) == (SEITE_NEU, None, None, None)

    def test_the_join_asks_on_the_folded_address(self, mongo_replica_set_url: str):
        """The registration stores the address unfolded; `spieler.email` stores the fold, so an unfolded compare finds nobody."""

        capitalised = spieler_document(SPIELER_OID, email="QUILLHILDE@EXAMPLE.COM")

        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW), spieler=[capitalised])

        assert (response.seite, response.geburtsdatum) == (SEITE_NEU, None)

    def test_a_differently_named_pupil_at_the_same_mailbox_is_shown_nothing(self, mongo_replica_set_url: str):
        """The defect the name narrowing exists for.

        On the address alone this pupil is shown the stored person's birthdate, and the form then
        stores it onto their own registration, the date being rendered read-only.
        """

        sibling = registrierung_document(vorname="Bramblewick")
        held = [spieler_document(SPIELER_OID)]

        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW), registrierungen=[sibling], spieler=held)

        assert (response.seite, response.geburtsdatum, response.umfang, response.medien) == (SEITE_NEU, None, None, None)

    def test_a_token_no_registration_holds_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> str:
            with pytest.raises(WriteRefusalException) as conflict:
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

    def test_a_registration_whose_team_is_gone_fails_rather_than_rendering_a_consent_text_with_a_hole(self, mongo_replica_set_url: str):
        """No code deletes a team, so this is a broken database: a server fault, never a 404 the page could answer, and never a gap."""

        orphan = registrierung_document(team_id=ObjectId("6890a1b2c3d4e5f607960099"))

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> None:
            with pytest.raises(AssertionError):
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
            "datum": TODAY,
            "bestaetigt_am": TODAY,
            "text_version": THIS_SEASONS_LABEL,
            "medien": False,
            "nachweis": {
                "umfang": {"am": AM, "text_version": THIS_SEASONS_LABEL},
                "medien": {"am": AM, "text_version": THIS_SEASONS_LABEL},
            },
        }
        # NOT nulled on use: single use is the stamp's doing, so the reopened link can show its state.
        assert document["bestaetigung"]["token_hash"] == TOKEN_HASH
        assert (response.ergebnis, response.geburtsdatum, response.umfang, response.medien) == (
            "bestaetigt",
            AT_THE_FLOOR,
            "kader_oeffentlich",
            False,
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

    def test_a_returning_pupils_press_stores_the_stamp_and_the_label_alone(self, mongo_replica_set_url: str):
        """`docs/backend/spec.md :: I557`: the page asked no choice, so none is stored, and the person's record is untouched."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            held = await database[Collection.SPIELER].find_one({"_id": SPIELER_OID})
            response = await answer(
                database, client, RAW, geburtsdatum=A_RETURNING_PUPILS_BIRTHDATE, umfang=None, medien=None, text_version=RETURNING_LABEL
            )

            return response, await stored(database), held, await database[Collection.SPIELER].find_one({"_id": SPIELER_OID})

        response, document, held, person = on_a_league(mongo_replica_set_url, body, spieler=[spieler_document(SPIELER_OID)])

        assert document["einwilligung"] == {"bestaetigt_am": TODAY, "text_version": RETURNING_LABEL}
        assert document["geburtsdatum"] == A_RETURNING_PUPILS_BIRTHDATE
        assert (response.ergebnis, response.umfang, response.medien) == ("bestaetigt", None, None)
        assert person == held

    def test_the_answer_carries_nothing_of_the_registration_beyond_what_was_posted(self, mongo_replica_set_url: str):
        """A response re-read off the updated document would widen this page's answer to everything a registration holds."""

        rendered = on_a_league(mongo_replica_set_url, lambda database, client: answer(database, client, RAW)).model_dump_json()

        assert registrierung_document()["nachname"] not in rendered and TYPED_EMAIL not in rendered
        assert TOKEN_HASH not in rendered and RAW not in rendered


class TestTheLabelAPressNames:
    """`REQ-EINWILLIGUNG-001`: a new acceptance names the running label of the page the link opens and nothing else."""

    @pytest.mark.parametrize(
        "genannt",
        [
            pytest.param("2026-09-spielerseite-2", id="a superseded label of the pupil page"),
            pytest.param(LAUFENDE_FASSUNGEN["bestaetigung_schiedsrichter"], id="the referee page's running label"),
            pytest.param(AN_OLDER_LABEL, id="the label the returning pupil's stored record names"),
            pytest.param(THIS_SEASONS_LABEL, id="the new pupil page's running label, on the returning pupil's link"),
        ],
    )
    def test_any_other_label_is_refused_and_spends_nothing(self, mongo_replica_set_url: str, genannt: str):
        """The stored record's own label among them: the press is a new acceptance, never one the person already holds."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(WriteRefusalException) as conflict:
                await answer(database, client, RAW, umfang=None, medien=None, text_version=genannt)

            return conflict.value, await ansicht(database, RAW), await stored(database), await log_rows(database)

        refusal, view, document, rows = on_a_league(mongo_replica_set_url, body, spieler=[spieler_document(SPIELER_OID)])

        assert (refusal.error_code, refusal.status_code) == (FASSUNG_UNZULAESSIG, 409)
        assert view.zustand == "gueltig"
        assert document == registrierung_document()
        assert rows == []

    @pytest.mark.parametrize(
        ("held", "gezeigt", "wahlen"),
        [
            pytest.param([spieler_document(SPIELER_OID)], THIS_SEASONS_LABEL, {}, id="new page shown, the person confirmed since"),
            pytest.param(
                [spieler_document(SPIELER_OID, einwilligung=einwilligung(bestaetigt_am=None))],
                RETURNING_LABEL,
                {"umfang": None, "medien": None},
                id="returning page shown, the record unconfirmed since",
            ),
            pytest.param([], RETURNING_LABEL, {"umfang": None, "medien": None}, id="returning page shown, the person erased since"),
        ],
    )
    def test_a_page_the_person_changed_under_is_told_to_reload(
        self, mongo_replica_set_url: str, held: list[dict[str, Any]], gezeigt: str, wahlen: dict[str, Any]
    ):
        """The press resolves the page in its own transaction, so a body for the other page is refused rather than stored under it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(WriteRefusalException) as conflict:
                await answer(database, client, RAW, text_version=gezeigt, **wahlen)

            return conflict.value.error_code, await stored(database)

        code, document = on_a_league(mongo_replica_set_url, body, spieler=held)

        assert code == FASSUNG_UNZULAESSIG
        assert document == registrierung_document()


class TestTheChoicesThePageAsks:
    """`REQ-REGISTRIERUNG-017` at the endpoint, judged against the page the press resolves and before anything is written."""

    @pytest.mark.parametrize(
        ("held", "label", "wahlen"),
        [
            pytest.param([], THIS_SEASONS_LABEL, {"umfang": None, "medien": None}, id="the new pupil's page, sent no choice"),
            pytest.param([], THIS_SEASONS_LABEL, {"medien": None}, id="the new pupil's page, sent no media answer"),
            pytest.param(
                [spieler_document(SPIELER_OID)], RETURNING_LABEL, {"umfang": "intern", "medien": False}, id="the returning page, sent both"
            ),
            pytest.param(
                [spieler_document(SPIELER_OID)], RETURNING_LABEL, {"umfang": None, "medien": True}, id="the returning page, sent a media grant"
            ),
        ],
    )
    def test_a_body_not_matching_its_page_is_refused_and_writes_nothing(
        self, mongo_replica_set_url: str, held: list[dict[str, Any]], label: str, wahlen: dict[str, Any]
    ):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(WriteRefusalException) as refused:
                await answer(database, client, RAW, text_version=label, **wahlen)

            return refused.value.error_code, refused.value.status_code, await stored(database), await log_rows(database)

        code, status, document, rows = on_a_league(mongo_replica_set_url, body, spieler=held)

        assert (code, status) == (REGISTRIERUNG_WAHLEN_UNPASSEND, 422)
        assert document == registrierung_document()
        assert rows == []


class TestTheLinkIsSpentByTheStamp:
    def test_a_second_press_is_refused_and_the_first_answer_stands(self, mongo_replica_set_url: str):
        """The first answer carries `medien`, so a refused press that overwrote either half of the pair turns this red."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW, geburtsdatum=AT_THE_MEDIA_AGE, medien=True)

            with pytest.raises(WriteRefusalException) as conflict:
                await answer(database, client, RAW, umfang="intern", medien=False)

            return conflict.value.error_code, await stored(database), await ansicht(database, RAW)

        code, document, view = on_a_league(mongo_replica_set_url, body)

        assert code == REGISTRIERUNG_ALREADY_CONFIRMED
        assert (document["einwilligung"]["umfang"], document["einwilligung"]["medien"]) == ("kader_oeffentlich", True)
        assert view.zustand == "bestaetigt"

    def test_an_age_refusal_spends_nothing(self, mongo_replica_set_url: str):
        """A mistyped year is the commonest error on a date field, and a link voided by one has no remedy but registering again."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(WriteRefusalException) as conflict:
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
            with pytest.raises(WriteRefusalException) as conflict:
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
            with pytest.raises(WriteRefusalException) as conflict:
                await answer(database, client, RAW)

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body, registrierungen=[declined]) == REGISTRIERUNG_TOKEN_EXPIRED

    def test_an_expired_link_carrying_a_refused_date_answers_the_link_rather_than_the_age(self, mongo_replica_set_url: str):
        """The order, which no other case pins: judged age-first, a dead link would tell a pupil to correct a date that buys them nothing."""

        expired = registrierung_document(bestaetigung=compose_bestaetigung(token_hash=TOKEN_HASH, today="2026-03-20", frist=YESTERDAY))

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            with pytest.raises(WriteRefusalException) as conflict:
                await answer(database, client, RAW, geburtsdatum=A_DAY_SHORT)

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body, registrierungen=[expired]) == REGISTRIERUNG_TOKEN_EXPIRED

    def test_a_confirmed_registration_carrying_a_refused_date_answers_the_stamp_rather_than_the_age(self, mongo_replica_set_url: str):
        """The other half of the order: a pupil who has already answered is told so rather than asked to retype a date nothing will store."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            await answer(database, client, RAW)

            with pytest.raises(WriteRefusalException) as conflict:
                await answer(database, client, RAW, geburtsdatum=A_DAY_SHORT)

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body) == REGISTRIERUNG_ALREADY_CONFIRMED

    def test_a_token_no_registration_holds_is_refused_before_anything_is_read_of_a_row(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(WriteRefusalException) as conflict:
                await answer(database, client, "a-stranger's-guess")

            return conflict.value.error_code, await stored(database)

        code, document = on_a_league(mongo_replica_set_url, body)

        assert code == REGISTRIERUNG_TOKEN_UNKNOWN
        assert document == registrierung_document()


# Against `TODAY`, 18 to the day and 17 years and 364 days.
AT_THE_MEDIA_AGE = "2008-04-01"
A_DAY_SHORT_OF_THE_MEDIA_AGE = "2008-04-02"


class TestTheMediaAge:
    """`REQ-REGISTRIERUNG-010` at the endpoint: the refusal is wired in, and judged before the write."""

    def test_the_view_serves_the_age_the_page_offers_the_switch_from(self, mongo_replica_set_url: str):
        assert on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW)).medien_mindestalter == MEDIEN_MIN_AGE_YEARS

    def test_a_yes_a_day_short_of_the_media_age_is_refused_and_spends_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(WriteRefusalException) as conflict:
                await answer(database, client, RAW, geburtsdatum=A_DAY_SHORT_OF_THE_MEDIA_AGE, medien=True)

            return conflict.value.error_code, await stored(database), await log_rows(database)

        code, document, rows = on_a_league(mongo_replica_set_url, body)

        assert code == REGISTRIERUNG_MEDIEN_ALTER
        assert document == registrierung_document()
        assert rows == []


# Composed by the production helper rather than spelled: a hand-written bound that drifted from it
# would leave these cases passing over a lapsed row.
STANDING = compose_gesperrt_bis_saison_id(massgebliche_saison_id=SAISON_ID)


async def ban(database: AsyncDatabase, address: str, *, bis: str = STANDING) -> None:
    await database[Collection.SPERRLISTE].insert_one(documents.ban_document(address, bis=bis))


class TestALinkToABarredAddress:
    """`REQ-REGISTRIERUNG-012`: a ban reaches a link already in somebody's inbox, the seeded one minted before it."""

    def test_the_press_is_refused_and_writes_nothing(self, mongo_replica_set_url: str):
        """Barred in the folded spelling while the row stores the typed one, so the check keys the stored address as a ban does."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, FOLDED_EMAIL)

            with pytest.raises(WriteRefusalException) as refused:
                await answer(database, client, RAW)

            return refused.value.error_code, refused.value.status_code, await stored(database), await log_rows(database)

        code, status, document, rows = on_a_league(mongo_replica_set_url, body)

        assert (code, status) == (REGISTRIERUNG_BESTAETIGUNG_GESPERRT, 403)
        assert document == registrierung_document()
        assert rows == []

    def test_a_ban_on_another_address_leaves_the_link_answering(self, mongo_replica_set_url: str):
        """The other half of the pair: without it the case above passes for a check refusing every press."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, "somebody-else@example.com")

            return await answer(database, client, RAW)

        assert on_a_league(mongo_replica_set_url, body).ergebnis == "bestaetigt"

    def test_the_link_answers_again_once_the_ban_is_lifted(self, mongo_replica_set_url: str):
        """Nothing of the ban is written on the registration, so lifting it is all a mistaken ban needs undone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, FOLDED_EMAIL)
            with pytest.raises(WriteRefusalException):
                await answer(database, client, RAW)
            await database[Collection.SPERRLISTE].delete_many({})

            return await answer(database, client, RAW)

        assert on_a_league(mongo_replica_set_url, body).ergebnis == "bestaetigt"

    def test_a_ban_past_its_last_season_bars_nothing(self, mongo_replica_set_url: str):
        """The running season is what the bound is read against: asked without it, the lapsed row would still bar."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
            invalidate_saison_cache()
            await ban(database, FOLDED_EMAIL, bis=f"{int(SAISON_ID) - 1}")

            return await answer(database, client, RAW)

        assert on_a_league(mongo_replica_set_url, body).ergebnis == "bestaetigt"

    def test_a_confirmed_registration_answers_the_stamp_rather_than_the_ban(self, mongo_replica_set_url: str):
        """The order: a pupil's answer given before the ban stands until an administrator acts, so a second press is refused as confirmed."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            await answer(database, client, RAW)
            await ban(database, FOLDED_EMAIL)

            with pytest.raises(WriteRefusalException) as refused:
                await answer(database, client, RAW)

            return refused.value.error_code

        assert on_a_league(mongo_replica_set_url, body) == REGISTRIERUNG_ALREADY_CONFIRMED

    def test_a_barred_press_carrying_a_refused_date_answers_the_ban_rather_than_the_age(self, mongo_replica_set_url: str):
        """The other half of the order: a corrected date buys a barred address nothing, so it is not what the pupil is asked for."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            await ban(database, FOLDED_EMAIL)

            with pytest.raises(WriteRefusalException) as refused:
                await answer(database, client, RAW, geburtsdatum=A_DAY_SHORT)

            return refused.value.error_code

        assert on_a_league(mongo_replica_set_url, body) == REGISTRIERUNG_BESTAETIGUNG_GESPERRT


class TestTheViewOfALinkToABarredAddress:
    """`docs/backend/spec.md :: I515`: the page reads the ban off the view, so it never offers a barred pupil the form."""

    def test_the_view_answers_gesperrt(self, mongo_replica_set_url: str):
        """Barred in the folded spelling while the row stores the typed one, as the press's own case bars it."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> str:
            await ban(database, FOLDED_EMAIL)

            return (await ansicht(database, RAW)).zustand

        assert on_a_league(mongo_replica_set_url, body) == "gesperrt"

    def test_a_ban_on_another_address_leaves_the_view_open(self, mongo_replica_set_url: str):
        """The other half of the pair: without it the case above passes for a view answering `gesperrt` to everyone."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> str:
            await ban(database, "somebody-else@example.com")

            return (await ansicht(database, RAW)).zustand

        assert on_a_league(mongo_replica_set_url, body) == "gueltig"

    def test_the_view_opens_again_once_the_ban_is_lifted(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[str, str]:
            await ban(database, FOLDED_EMAIL)
            barred = (await ansicht(database, RAW)).zustand
            await database[Collection.SPERRLISTE].delete_many({})

            return barred, (await ansicht(database, RAW)).zustand

        assert on_a_league(mongo_replica_set_url, body) == ("gesperrt", "gueltig")

    def test_a_ban_past_its_last_season_leaves_the_view_open(self, mongo_replica_set_url: str):
        """Read against the running season as the press reads it: asked without it, the lapsed row would bar the view alone."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> str:
            await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
            invalidate_saison_cache()
            await ban(database, FOLDED_EMAIL, bis=f"{int(SAISON_ID) - 1}")

            return (await ansicht(database, RAW)).zustand

        assert on_a_league(mongo_replica_set_url, body) == "gueltig"

    def test_a_confirmed_registration_reopened_after_the_ban_shows_the_ban(self, mongo_replica_set_url: str):
        """The ban outranks the stamp here, where the press ranks it below: the page shows a barred pupil nothing else."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            await answer(database, client, RAW)
            await ban(database, FOLDED_EMAIL)

            return (await ansicht(database, RAW)).zustand

        assert on_a_league(mongo_replica_set_url, body) == "gesperrt"
