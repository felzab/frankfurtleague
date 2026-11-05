from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.registrierungen.public_router import get_confirmation_view, post_confirmation
from app.api.registrierungen.schemas import FLRegistrierungConfirmationPayload
from app.api.registrierungen.services import (
    SEITE_NEU,
    SEITE_WIEDERKEHREND,
    compose_bestaetigung,
)
from app.api.sperrliste.services import compose_gesperrt_bis_saison_id
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError
from app.shared.schemas.confirmation import FLTokenPayload
from app.shared.tokens import hash_token
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
AT = "2026-04-01T10:30:00+00:00"
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

# Folded, as every address payload stores it, the registration's and the person's alike.
FOLDED_EMAIL = "quillhilde@example.com"

# Against `TODAY`, `2010-04-01` is 16 to the day and `2010-04-02` is 15 years and 364 days.
AT_THE_FLOOR = "2010-04-01"
A_DAY_SHORT = "2010-04-02"
# Eighteen by the held consent's `date`, as its media yes requires
# (`app/api/registrierungen/services.py :: find_medien_refusal`): a record no write could store proves nothing.
A_RETURNING_PUPILS_BIRTHDATE = "2007-07-14"

# The labels the new pupil's page names; the returning pupil's asks no choice and names none.
THIS_SEASONS_LABELS = dict(documents.SPIELER_TEXT_VERSIONS)


def team_document(team_id: ObjectId, name: str, full_name: str) -> dict[str, Any]:
    return documents.team_document(team_id, name, name[:3].upper(), full_name=full_name, website_url=None, schulform="gymnasium_g9")


def einwilligung(**overrides: Any) -> dict[str, Any]:
    """The returning pupil's record as their own confirmation of an earlier season left it."""

    stored = documents.own_einwilligung_document(
        text_versions=documents.SPIELER_TEXT_VERSIONS, confirmed_at="2025-09-02", scope="intern", media=True
    )

    return {**stored, **overrides}


def spieler_document(spieler_id: ObjectId, **overrides: Any) -> dict[str, Any]:
    """One person the league already holds, whose link opens the returning pupil's page."""

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
        "invitation_id": EINLADUNG_OID,
        "submitted_at": "2026-03-26",
        "status": "submitted",
        "vorname": "Quillhilde",
        "nachname": "Brackenmoor",
        "email": FOLDED_EMAIL,
        "position": "Abwehr",
        "nummer": "7",
        "stufe": "Q1",
        "geburtsdatum": None,
        "einwilligung": None,
        "confirmation": {**compose_bestaetigung(today="2026-03-26", frist=TOMORROW), "token_hashes": [TOKEN_HASH]},
        "decision": None,
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
    """A clean database carrying the shipped indexes."""

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


async def read_view(database: AsyncDatabase, token: str, *, spieler_collection: Any = None, registrierungen_collection: Any = None) -> Any:
    return await get_confirmation_view(
        view_data=FLTokenPayload(token=token),
        registrierungen_collection=database[Collection.REGISTRIERUNGEN] if registrierungen_collection is None else registrierungen_collection,
        teams_collection=database[Collection.TEAMS],
        spieler_collection=database[Collection.SPIELER] if spieler_collection is None else spieler_collection,
        sperrliste=ban_list(database),
        today=TODAY,
    )


async def answer(database: AsyncDatabase, client: AsyncMongoClient, token: str, **overrides: Any) -> Any:
    body = {
        "token": token,
        "geburtsdatum": AT_THE_FLOOR,
        "scope": "kader_oeffentlich",
        # Off, because the default date is sixteen: a media consent is refused below eighteen.
        "media": False,
        "text_versions": THIS_SEASONS_LABELS,
        **overrides,
    }

    return await post_confirmation(
        antwort_data=FLRegistrierungConfirmationPayload.model_validate(body),
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
    return await database[Collection.ACTION_LOG].find({"collection": str(Collection.REGISTRIERUNGEN)}).sort("_id", 1).to_list(length=None)


class TestWhatALinkOpens:
    def test_the_link_carries_no_other_teams_name_and_nothing_else_of_the_registration(self, mongo_replica_set_url: str):
        """A leaked link learns what the mail it arrived in already said, and never a name, the address, the number or the Stufe."""

        rendered = on_a_league(mongo_replica_set_url, lambda database, _: read_view(database, RAW)).model_dump_json()

        registration = registrierung_document()
        assert OTHER_TEAM_NAME not in rendered and OTHER_SCHOOL not in rendered
        assert registration["vorname"] not in rendered and registration["nachname"] not in rendered
        assert FOLDED_EMAIL not in rendered
        assert registration["position"] not in rendered and registration["stufe"] not in rendered

    def test_a_first_timer_is_asked_for_a_date(self, mongo_replica_set_url: str):
        response = on_a_league(mongo_replica_set_url, lambda database, _: read_view(database, RAW))

        assert response.seite == SEITE_NEU

    @pytest.mark.parametrize(
        "person",
        [spieler_document(SPIELER_OID), spieler_document(SPIELER_OID, inactive_since="2025-07-01")],
        ids=("a person in the league", "a person who left it"),
    )
    def test_a_returning_pupil_is_told_a_date_is_stored_and_shown_none_of_it(self, mongo_replica_set_url: str, person: dict[str, Any]):
        """A returning pupil's page asks neither a choice nor the stored birthdate, and the link serves none of the three."""

        response = on_a_league(mongo_replica_set_url, lambda database, _: read_view(database, RAW), spieler=[person])

        assert response.seite == SEITE_WIEDERKEHREND
        assert A_RETURNING_PUPILS_BIRTHDATE not in response.model_dump_json()

    def test_a_record_nobody_confirmed_makes_no_returning_pupil(self, mongo_replica_set_url: str):
        """The returning page says the choices stand as the pupil gave them, and a person who never confirmed gave none."""

        unconfirmed = spieler_document(SPIELER_OID, einwilligung=None)

        response = on_a_league(mongo_replica_set_url, lambda database, _: read_view(database, RAW), spieler=[unconfirmed])

        assert response.seite == SEITE_NEU

    def test_a_differently_named_pupil_at_the_same_mailbox_is_asked_for_their_own_date(self, mongo_replica_set_url: str):
        """The defect the name narrowing exists for.

        On the address alone this pupil's page takes the stored person's birthdate as given, and the
        press then stores it onto their own registration.
        """

        sibling = registrierung_document(vorname="Bramblewick")
        held = [spieler_document(SPIELER_OID)]

        response = on_a_league(mongo_replica_set_url, lambda database, _: read_view(database, RAW), registrierungen=[sibling], spieler=held)

        assert response.seite == SEITE_NEU

    def test_a_token_no_registration_holds_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> str:
            with pytest.raises(APIError) as conflict:
                await read_view(database, "a-stranger's-guess")

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body) == Code.LINK_INVALID


class TestWhatAConfirmationWrites:
    """One `$set`: the pairing lands whole, and the hash stays where it is."""

    def test_the_date_and_the_whole_record_land_together(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await answer(database, client, RAW)

            return response, await stored(database), await log_rows(database)

        response, document, rows = on_a_league(mongo_replica_set_url, body)

        assert document["geburtsdatum"] == AT_THE_FLOOR
        assert document["einwilligung"] == {
            "scope": "kader_oeffentlich",
            "date": TODAY,
            "confirmed_at": TODAY,
            "media": False,
            "evidence": {
                "scope": {"at": AT, "text_version": THIS_SEASONS_LABELS["scope"]},
                "media": {"at": AT, "text_version": THIS_SEASONS_LABELS["media"]},
            },
        }
        # NOT nulled on use: single use is the stamp's doing, so the reopened link can show its state.
        assert document["confirmation"]["token_hashes"] == [TOKEN_HASH]
        assert (response.ergebnis, response.geburtsdatum, response.scope, response.media) == (
            "confirmed",
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

        assert document["status"] == "submitted"
        assert (people, squad_rows) == (0, 0)

    def test_the_media_switch_left_off_is_stored_as_the_answer_it_is(self, mongo_replica_set_url: str):
        """Publication and media are two consents under one record, so an off switch is stored rather than derived from the scope."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW, scope="intern", media=False)

            return await stored(database)

        record = on_a_league(mongo_replica_set_url, body)["einwilligung"]

        assert (record["scope"], record["media"]) == ("intern", False)

    def test_a_returning_pupils_press_stores_the_stamp_alone(self, mongo_replica_set_url: str):
        """The page asked no choice and no date, so the stored date is written and echoed nowhere.

        The person's record is untouched.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            held = await database[Collection.SPIELER].find_one({"_id": SPIELER_OID})
            response = await answer(database, client, RAW, geburtsdatum=None, scope=None, media=None, text_versions=None)

            return response, await stored(database), held, await database[Collection.SPIELER].find_one({"_id": SPIELER_OID})

        response, document, held, person = on_a_league(mongo_replica_set_url, body, spieler=[spieler_document(SPIELER_OID)])

        assert document["einwilligung"] == {"confirmed_at": TODAY}
        assert document["geburtsdatum"] == A_RETURNING_PUPILS_BIRTHDATE
        assert (response.ergebnis, response.geburtsdatum, response.scope, response.media) == ("confirmed", None, None, None)
        assert person == held

    def test_a_stored_date_below_the_floor_is_refused_and_spends_nothing(self, mongo_replica_set_url: str):
        """The stored date is judged as a typed one is: taken as given, it is never taken unchecked."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(APIError) as refused:
                await answer(database, client, RAW, geburtsdatum=None, scope=None, media=None, text_versions=None)

            return refused.value.error_code, await stored(database)

        too_young = spieler_document(SPIELER_OID, geburtsdatum=A_DAY_SHORT, einwilligung=einwilligung(media=False))
        code, document = on_a_league(mongo_replica_set_url, body, spieler=[too_young])

        assert code == Code.CONFIRMATION_AGE
        assert document == registrierung_document()

    def test_the_answer_carries_nothing_of_the_registration_beyond_what_was_posted(self, mongo_replica_set_url: str):
        """A response re-read off the updated document would widen this page's answer to everything a registration holds."""

        rendered = on_a_league(mongo_replica_set_url, lambda database, client: answer(database, client, RAW)).model_dump_json()

        assert registrierung_document()["nachname"] not in rendered and FOLDED_EMAIL not in rendered
        assert TOKEN_HASH not in rendered and RAW not in rendered


class TestTheChoicesThePageAsks:
    """`registrierung_choices_unsuitable` at the endpoint, judged against the page the press resolves and before anything is written."""

    @pytest.mark.parametrize(
        ("held", "label", "wahlen"),
        [
            pytest.param([], THIS_SEASONS_LABELS, {"scope": None, "media": None}, id="the new pupil's page, sent no choice"),
            pytest.param([], THIS_SEASONS_LABELS, {"media": None}, id="the new pupil's page, sent no media answer"),
            pytest.param([], None, {}, id="the new pupil's page, sent no labels"),
            pytest.param([spieler_document(SPIELER_OID)], None, {"scope": "intern", "media": False}, id="the returning page, sent both"),
            pytest.param([spieler_document(SPIELER_OID)], None, {"scope": None, "media": True}, id="the returning page, sent a media grant"),
            pytest.param(
                [spieler_document(SPIELER_OID)], THIS_SEASONS_LABELS, {"scope": None, "media": None}, id="the returning page, sent labels"
            ),
            pytest.param(
                [spieler_document(SPIELER_OID)],
                None,
                {"scope": None, "media": None},
                id="the returning page, sent a date",
            ),
            pytest.param([], THIS_SEASONS_LABELS, {"geburtsdatum": None}, id="the new pupil's page, sent no date"),
        ],
    )
    def test_a_body_not_matching_its_page_is_refused_and_writes_nothing(
        self, mongo_replica_set_url: str, held: list[dict[str, Any]], label: dict[str, str] | None, wahlen: dict[str, Any]
    ):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(APIError) as refused:
                await answer(database, client, RAW, text_versions=label, **wahlen)

            return refused.value.error_code, refused.value.status_code, await stored(database), await log_rows(database)

        code, status, document, rows = on_a_league(mongo_replica_set_url, body, spieler=held)

        assert (code, status) == (Code.REGISTRIERUNG_CHOICES_UNSUITABLE, 422)
        assert document == registrierung_document()
        assert rows == []


class TestTheLinkIsSpentByTheStamp:
    def test_a_second_press_is_refused_and_the_first_answer_stands(self, mongo_replica_set_url: str):
        """The first answer carries `media`, so a refused press that overwrote either half of the pair turns this red."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW, geburtsdatum=AT_THE_MEDIA_AGE, media=True)

            with pytest.raises(APIError) as conflict:
                await answer(database, client, RAW, scope="intern", media=False)

            return conflict.value.error_code, await stored(database), await read_view(database, RAW)

        code, document, view = on_a_league(mongo_replica_set_url, body)

        assert code == Code.CONFIRMATION_EXISTS
        assert (document["einwilligung"]["scope"], document["einwilligung"]["media"]) == ("kader_oeffentlich", True)
        assert view.state == "confirmed"

    def test_an_age_refusal_spends_nothing(self, mongo_replica_set_url: str):
        """A mistyped year is the commonest error on a date field, and a link voided by one has no remedy but registering again."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(APIError) as conflict:
                await answer(database, client, RAW, geburtsdatum=A_DAY_SHORT)

            return conflict.value.error_code, await read_view(database, RAW), await stored(database), await log_rows(database)

        code, view, document, rows = on_a_league(mongo_replica_set_url, body)

        assert code == Code.CONFIRMATION_AGE
        assert view.state == "valid"
        assert document == registrierung_document()
        assert rows == []

    def test_a_link_past_its_deadline_is_refused_before_the_stamp_is_judged(self, mongo_replica_set_url: str):
        expired = registrierung_document(
            confirmation={**compose_bestaetigung(today="2026-03-20", frist=YESTERDAY), "token_hashes": [TOKEN_HASH]}
        )

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(APIError) as conflict:
                await answer(database, client, RAW)

            return conflict.value.error_code, await stored(database)

        code, document = on_a_league(mongo_replica_set_url, body, registrierungen=[expired])

        assert code == Code.LINK_EXPIRED
        assert document["einwilligung"] is None

    def test_a_decided_registration_takes_no_answer_either(self, mongo_replica_set_url: str):
        """One code for both: a pupil whose registration was declined while their link stood open is told the link is over, not why."""

        entscheidung = {"made_at": YESTERDAY, "by": "admin", "grund": "kein Platz"}
        declined = registrierung_document(status="declined", decision=entscheidung)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            with pytest.raises(APIError) as conflict:
                await answer(database, client, RAW)

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body, registrierungen=[declined]) == Code.LINK_EXPIRED

    def test_a_token_no_registration_holds_is_refused_before_anything_is_read_of_a_row(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(APIError) as conflict:
                await answer(database, client, "a-stranger's-guess")

            return conflict.value.error_code, await stored(database)

        code, document = on_a_league(mongo_replica_set_url, body)

        assert code == Code.LINK_INVALID
        assert document == registrierung_document()


# Against `TODAY`, 18 to the day and 17 years and 364 days.
AT_THE_MEDIA_AGE = "2008-04-01"
A_DAY_SHORT_OF_THE_MEDIA_AGE = "2008-04-02"


class TestTheMediaAge:
    """`media_age` at the endpoint: the refusal is wired in, and judged before the write."""

    def test_a_yes_a_day_short_of_the_media_age_is_refused_and_spends_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(APIError) as conflict:
                await answer(database, client, RAW, geburtsdatum=A_DAY_SHORT_OF_THE_MEDIA_AGE, media=True)

            return conflict.value.error_code, await stored(database), await log_rows(database)

        code, document, rows = on_a_league(mongo_replica_set_url, body)

        assert code == Code.MEDIA_AGE
        assert document == registrierung_document()
        assert rows == []


# Composed by the production helper rather than spelled: a hand-written bound that drifted from it
# would leave these cases passing over a lapsed row.
STANDING = compose_gesperrt_bis_saison_id(governing_saison_id=SAISON_ID)


async def ban(database: AsyncDatabase, address: str, *, until: str = STANDING) -> None:
    await database[Collection.BAN_LIST].insert_one(documents.ban_document(address, until=until))


class TestALinkToABarredAddress:
    """`link_barred`: a ban reaches a link already in somebody's inbox, the seeded one minted before it."""

    def test_the_press_is_refused_and_writes_nothing(self, mongo_replica_set_url: str):
        """Barred in the folded spelling while the row stores the typed one, so the check keys the stored address as a ban does."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, FOLDED_EMAIL)

            with pytest.raises(APIError) as refused:
                await answer(database, client, RAW)

            return refused.value.error_code, refused.value.status_code, await stored(database), await log_rows(database)

        code, status, document, rows = on_a_league(mongo_replica_set_url, body)

        assert (code, status) == (Code.LINK_BARRED, 403)
        assert document == registrierung_document()
        assert rows == []
