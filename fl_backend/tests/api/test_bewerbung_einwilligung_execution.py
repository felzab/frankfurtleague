from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pydantic import TypeAdapter
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.admin_router import get_bewerbung, get_bewerbungen, resend_einwilligung
from app.api.bewerbungen.public_router import get_einwilligung_view, post_einwilligung
from app.api.bewerbungen.schemas import FLBewerbungEinwilligungAntwortPayload, FLBewerbungenFilterParams
from app.api.sperrliste.services import compose_gesperrt_bis_saison_id
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError, DocumentNotFoundError
from app.shared.einwilligung import LAUFENDE_FASSUNGEN
from app.shared.schemas.bounds import MEDIEN_MIN_AGE_YEARS
from app.shared.schemas.confirmation import FLTokenPayload
from app.shared.schemas.literals import KONTAKT_ROLLEN
from app.shared.tokens import hash_token
from tests import documents
from tests.bans import ban_list
from tests.config import build_test_config
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import ban_document, kontaktperson_document, saison_document, team_document
from tests.outbox import MAIL_NOW, drained
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
RAW_PREFIX = "raw-token-for"
RAW: Mapping[str, str] = {seat: f"{RAW_PREFIX}-{seat}" for seat in KONTAKT_ROLLEN}
HASHES: Mapping[str, str] = {seat: hash_token(raw) for seat, raw in RAW.items()}

# What each of the two contact pages stamps today; an answer names the one its view answered.
BEWERBER_SEITE = LAUFENDE_FASSUNGEN["bestaetigung_kontakt"]
VERWALTUNG_SEITE = LAUFENDE_FASSUNGEN["bestaetigung_kontakt_verwaltung"]

A_CHILDS_BIRTHDATE = "2018-01-01"
AN_ADULTS_BIRTHDATE = "1984-05-09"
# 17 years and 364 days against `TODAY`: the one age the two floors answer differently.
A_SEVENTEEN_YEAR_OLDS_BIRTHDATE = "2008-04-02"


def _seat_paths(block: str, *leaves: str) -> set[str]:
    return {f"{block}.{seat}.{leaf}" for seat in KONTAKT_ROLLEN for leaf in leaves}


# What each handler resolves off the document its token filter found. Reached from the HANDLERS
# rather than from `app/api/bewerbungen/services.py :: _per_seat`, so a projection widened by a field
# no handler reads fails here.
ANSICHT_RESOLVES = frozenset(
    _seat_paths("confirmations", "token_hashes", "declined_at")
    | _seat_paths("kontakte", "email", "einwilligung.confirmed_at")
    | _seat_paths("kontakte", "einwilligung.entered_by")
    | {"kontakte.trainer_is_also", "saison_id", "status", "confirmation_deadline", "schule.team_name", "team_id"}
)

# `_id` is here and not in the view's, whose own line says why
# (`app/api/bewerbungen/services.py :: EINWILLIGUNG_ANSICHT_FIELDS`).
ANTWORT_RESOLVES = frozenset(
    _seat_paths("confirmations", "token_hashes", "declined_at")
    | _seat_paths("kontakte", "vorname", "email", "einwilligung.confirmed_at", "einwilligung.umfang", "einwilligung.medien")
    | _seat_paths("kontakte", "einwilligung.nachweis", "einwilligung.entered_by")
    | {"_id", "kontakte.trainer_is_also", "saison_id", "status", "confirmation_deadline"}
)


# Sought as fragments by the leak searches, so a response carrying any part of a seat's record is caught.
NACHNAME = "Mustermann"
MAIL_DOMAIN = "example.com"
TELEFON = "1234567"


def person(vorname: str) -> dict[str, Any]:
    return kontaktperson_document(
        vorname, nachname=f"{vorname}-{NACHNAME}", email=f"{vorname.lower()}@{MAIL_DOMAIN}", telefon=f"+49 170 {TELEFON}"
    )


def kontakte(*, trainer_is_also: str | None = None) -> dict[str, Any]:
    return {
        "trainer": person("Wraxlington"),
        "ansprechperson": person("Wraxlington") if trainer_is_also == "ansprechperson" else person("Quillhilde"),
        "stellvertretung": person("Bramblewick"),
        "trainer_is_also": trainer_is_also,
    }


def bewerbung_document(bewerbung_id: ObjectId = BEWERBUNG_OID, **overrides: Any) -> dict[str, Any]:
    """One submitted application with its three live links, inside its deadline, that each case moves one thing of."""

    stored = documents.bewerbung_document(
        bewerbung_id,
        SAISON_ID,
        "submitted",
        kontakte=kontakte(),
        submitted_at="2026-03-20",
        confirmation_deadline="2026-04-03",
        schule=documents.new_schule_document(SCHOOL_NAME, "ZXX", full_name=f"{SCHOOL_NAME}-Gesamtschule", schulform="gesamtschule"),
        link_prefix=RAW_PREFIX,
    )

    return {**stored, **overrides}


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, documents: list[dict[str, Any]] | None = None) -> Any:
    """A clean database carrying the shipped indexes."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.TEAMS].insert_one(team_document(CLUB_OID, CLUB_NAME, "ADX", website_url=None, schulform="gymnasium_g9"))
            await database[Collection.BEWERBUNGEN].insert_many(documents if documents is not None else [bewerbung_document()])

            return await body(database, client)

    return on_the_seed_loop(_run())


async def ansicht(database: AsyncDatabase, token: str, *, bewerbungen: Any = None) -> Any:
    return await get_einwilligung_view(
        ansicht_data=FLTokenPayload(token=token),
        bewerbungen_collection=database[Collection.BEWERBUNGEN] if bewerbungen is None else bewerbungen,
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        teams_collection=database[Collection.TEAMS],
        sperrliste=ban_list(database),
        today=TODAY,
    )


async def answer(
    database: AsyncDatabase, client: AsyncMongoClient, token: str, *, bewerbungen: Any = None, now: datetime = NOW, **overrides: Any
) -> Any:
    """One answer through the seat's link; a case reading the mail it owes passes `MAIL_NOW`, which the stamps then carry."""

    # A Widerspruch carries the token alone: every default below is the consent's.
    erteilt = {"antwort": "given", "geburtsdatum": AN_ADULTS_BIRTHDATE, "whatsapp": True, "medien": False, "text_version": BEWERBER_SEITE}
    body = {"token": token, **(overrides if overrides.get("antwort") == "declined" else {**erteilt, **overrides})}

    return await post_einwilligung(
        antwort_data=TypeAdapter(FLBewerbungEinwilligungAntwortPayload).validate_python(body),
        bewerbungen_collection=database[Collection.BEWERBUNGEN] if bewerbungen is None else bewerbungen,
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        aktionen_collection=database[Collection.ACTION_LOG],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        postausgang_collection=database[Collection.OUTBOX],
        sperrliste=ban_list(database),
        db=client,
        config=build_test_config(),
        today=TODAY,
        germany_now=now,
    )


async def resend(database: AsyncDatabase, seat: str, bewerbung_id: ObjectId = BEWERBUNG_OID) -> Any:
    return await resend_einwilligung(
        bewerbung_id=bewerbung_id,
        seat=seat,
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        teams_collection=database[Collection.TEAMS],
        postausgang_collection=database[Collection.OUTBOX],
        sperrliste=ban_list(database),
        db=database.client,
        today=TODAY,
        germany_now=MAIL_NOW,
    )


async def stored(database: AsyncDatabase, bewerbung_id: ObjectId = BEWERBUNG_OID) -> Mapping[str, Any]:
    found = await database[Collection.BEWERBUNGEN].find_one({"_id": bewerbung_id})
    assert found is not None, "the seeded application is gone"

    return found


async def log_rows(database: AsyncDatabase) -> list[Mapping[str, Any]]:
    return await database[Collection.ACTION_LOG].find({"collection": str(Collection.BEWERBUNGEN)}).sort("_id", 1).to_list(length=None)


class ReadsRecorded:
    """A collection, keeping what each `find_one` answered: the season rows' and the registrations' link tests read it too.

    A delegating wrapper rather than a stub: mongod applies the projection, and a stub would hand
    back whatever the handler asked for.
    """

    def __init__(self, collection: Any) -> None:
        self._collection = collection
        self.answered: list[tuple[Any, Any]] = []

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    # Spelled `filter` because `fl_backend/app/core/crud.py` passes it by that keyword; a rename here
    # is a TypeError at the first helper this collection is handed to.
    async def find_one(self, filter: Any = None, *args: Any, **kwargs: Any) -> Any:
        document = await self._collection.find_one(filter, *args, **kwargs)
        self.answered.append((filter, document))

        return document


def loaded_by_the_link(recorder: ReadsRecorded) -> list[Any]:
    """Every document the TOKEN filter found.

    `fl_backend/app/core/crud.py :: patch_one_in_db` reads the same application twice more, on `_id`
    and unprojected, its pre-image being the log's.
    """

    return [document for db_filter, document in recorder.answered if "$or" in db_filter]


def leaf_paths(document: Any, prefix: str = "") -> set[str]:
    """Every dotted path this document holds a value at.

    An empty block counts as one: it would otherwise vanish from the comparison, and a projection
    widened onto a block this seed leaves empty would pass.
    """

    if not isinstance(document, Mapping) or not document:
        return {prefix} if prefix else set()

    return {path for key, value in document.items() for path in leaf_paths(value, f"{prefix}.{key}" if prefix else key)}


class TestWhatALinkOpens:
    def test_a_live_link_shows_the_seat_and_no_contact_record(self, mongo_replica_set_url: str):
        """`READ-BEWERBUNG-002`: a school, a season and a role, and no name, no stored record or anything a leaked link could act on."""

        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW["ansprechperson"]))

        assert (response.state, response.saison_id, response.schule, response.rolle) == ("valid", SAISON_ID, SCHOOL_NAME, "ansprechperson")
        assert response.also_rolle is None
        rendered = response.model_dump_json()
        assert "Quillhilde" not in rendered and NACHNAME not in rendered and MAIL_DOMAIN not in rendered and TELEFON not in rendered

    def test_an_open_link_whose_seat_holds_nobody_reads_as_a_token_no_seat_holds(self, mongo_replica_set_url: str):
        """A seat emptied with its link still live and no Widerspruch beside it is answered as a guess is.

        Never as a page: it would offer a press `bewerbung_seat_already_answered` refuses.
        """

        stored = bewerbung_document()
        emptied = {**stored, "kontakte": {**stored["kontakte"], "stellvertretung": None}}

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            with pytest.raises(APIError) as refused:
                await ansicht(database, RAW["stellvertretung"])

            return refused.value.error_code

        assert on_a_league(mongo_replica_set_url, body, documents=[emptied]) == Code.LINK_INVALID

    @pytest.mark.parametrize(
        ("seat", "also_rolle"),
        [("ansprechperson", "trainer"), ("trainer", "ansprechperson"), ("stellvertretung", None)],
    )
    def test_a_double_seated_persons_link_names_their_second_seat_and_no_other_link_does(
        self, mongo_replica_set_url: str, seat: str, also_rolle: str | None
    ):
        """The third seat is load-bearing: serving the declaration itself would tell the Stellvertretung that two OTHER seats are one person."""

        paired = bewerbung_document(kontakte=kontakte(trainer_is_also="ansprechperson"))

        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW[seat]), documents=[paired])

        assert (response.rolle, response.also_rolle) == (seat, also_rolle)

    @pytest.mark.parametrize(
        ("seat", "trainer_is_also", "minimum_age"),
        [
            pytest.param("trainer", None, 16, id="the Trainer, who takes the league's own floor"),
            pytest.param("ansprechperson", None, 18, id="the Ansprechperson, who signs for the school"),
            pytest.param("stellvertretung", None, 18, id="the Stellvertretung, who stands in for them"),
            pytest.param("trainer", "ansprechperson", 18, id="a Trainer who is also the Ansprechperson, on the Trainer's own link"),
        ],
    )
    def test_the_link_answers_the_floor_the_person_holding_it_has_to_clear(
        self, mongo_replica_set_url: str, seat: str, trainer_is_also: str | None, minimum_age: int
    ):
        """The page fills its `{minAlter}` slots and bounds its date control from this, so a wrong number offers a date the answer refuses."""

        seeded = bewerbung_document(kontakte=kontakte(trainer_is_also=trainer_is_also))

        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW[seat]), documents=[seeded])

        assert response.minimum_age == minimum_age

    def test_the_seats_the_view_names_are_the_seats_the_answer_writes(self, mongo_replica_set_url: str):
        paired = bewerbung_document(kontakte=kontakte(trainer_is_also="ansprechperson"))

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            view = await ansicht(database, RAW["trainer"])
            await answer(database, client, RAW["trainer"])

            return view, await stored(database)

        view, document = on_a_league(mongo_replica_set_url, body, documents=[paired])

        stamped = {seat for seat in KONTAKT_ROLLEN if document["kontakte"][seat]["einwilligung"]["confirmed_at"] == TODAY}
        assert stamped == {view.rolle, view.also_rolle}

    def test_a_picked_clubs_application_names_the_club(self, mongo_replica_set_url: str):
        picked = bewerbung_document(PICKED_BEWERBUNG_OID, team_id=CLUB_OID, schule=None)

        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW["trainer"]), documents=[picked])

        assert response.schule == CLUB_NAME

    def test_a_token_no_seat_holds_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> str:
            with pytest.raises(APIError) as conflict:
                await ansicht(database, "a-stranger's-guess")

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body) == Code.LINK_INVALID

    def test_a_link_past_its_deadline_is_shown_as_expired_rather_than_refused(self, mongo_replica_set_url: str):
        expired = bewerbung_document(confirmation_deadline=YESTERDAY)

        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW["trainer"]), documents=[expired])

        assert response.state == "expired"


class TestWhatAnAnonymousReadLoads:
    """These two cases hold the narrowing alone.

    A projection too SHORT is answered by the rest of this module, which drives every field either read resolves.
    """

    def test_the_view_never_holds_the_application_beyond_the_fields_its_answer_is_built_from(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> list[Any]:
            recorder = ReadsRecorded(database[Collection.BEWERBUNGEN])
            await ansicht(database, RAW["ansprechperson"], bewerbungen=recorder)

            return loaded_by_the_link(recorder)

        loaded = on_a_league(mongo_replica_set_url, body)

        assert loaded, "the link's own read did not run"
        assert set().union(*(leaf_paths(document) for document in loaded)) <= ANSICHT_RESOLVES

    def test_the_answer_never_holds_the_application_beyond_the_fields_it_judges_and_writes_on(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[Any]:
            recorder = ReadsRecorded(database[Collection.BEWERBUNGEN])
            await answer(database, client, RAW["ansprechperson"], bewerbungen=recorder)

            return loaded_by_the_link(recorder)

        loaded = on_a_league(mongo_replica_set_url, body)

        assert loaded, "the link's own read did not run"
        assert set().union(*(leaf_paths(document) for document in loaded)) <= ANTWORT_RESOLVES


class TestWhatAConfirmationWrites:
    """The one `$set`: the pairing lands whole, and the hash stays where it is."""

    def test_the_date_the_stamp_the_source_the_wording_and_the_scope_land_together(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await answer(database, client, RAW["trainer"])

            return response, await stored(database), await log_rows(database)

        response, document, rows = on_a_league(mongo_replica_set_url, body)

        trainer = document["kontakte"]["trainer"]
        assert trainer["geburtsdatum"] == AN_ADULTS_BIRTHDATE
        # The wording the CONFIRMING person saw, not the one the applicant ticked for them, and the
        # stored speaker gone: whether the person answered is the stamp's to say.
        assert trainer["einwilligung"] == {
            "umfang": "kontaktdaten_whatsapp",
            "text_version": BEWERBER_SEITE,
            "datum": "2026-03-20",
            "confirmed_at": TODAY,
            "medien": False,
            # The seating's, which the answer leaves standing.
            "entered_by": "bewerbung",
            # Each choice's evidence under the page the person answered: the WhatsApp grant, and the
            # media answer withholding.
            "nachweis": {
                "umfang": {"am": "2026-04-01T10:30:00+00:00", "text_version": BEWERBER_SEITE},
                "medien": {"am": "2026-04-01T10:30:00+00:00", "text_version": BEWERBER_SEITE},
            },
        }
        # NOT nulled on use: single use is the stamp's doing, so the reopened link can show its state.
        assert document["confirmations"]["trainer"]["token_hashes"] == [HASHES["trainer"]]
        assert (response.ergebnis, response.geburtsdatum, response.whatsapp) == ("confirmed", AN_ADULTS_BIRTHDATE, True)
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

        paired = bewerbung_document(kontakte=kontakte(trainer_is_also="ansprechperson"))

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await answer(database, client, RAW["ansprechperson"])

            return response, await stored(database)

        response, document = on_a_league(mongo_replica_set_url, body, documents=[paired])

        assert response.ergebnis == "confirmed"
        for seat in ("trainer", "ansprechperson"):
            assert document["kontakte"][seat]["geburtsdatum"] == AN_ADULTS_BIRTHDATE
            assert document["kontakte"][seat]["einwilligung"]["confirmed_at"] == TODAY
        assert document["kontakte"]["trainer"] == document["kontakte"]["ansprechperson"]


def eingetragen(von: str, *, datum: str = "2026-03-20") -> dict[str, Any]:
    """An application whose Trainer seat names who seated its person, its record dated `datum`."""

    seeded = bewerbung_document()
    einwilligung = seeded["kontakte"]["trainer"]["einwilligung"]
    seeded["kontakte"]["trainer"]["einwilligung"] = {**einwilligung, "datum": datum, "entered_by": von}

    return seeded


class TestThePageALinkOpens:
    """The view answers the label of the page true for the person, and the answer is judged against that page."""

    @pytest.mark.parametrize(
        ("seeded", "wording"),
        [
            pytest.param(eingetragen("bewerbung"), BEWERBER_SEITE, id="named by the applicant"),
            pytest.param(eingetragen("liga", datum="2026-03-27"), VERWALTUNG_SEITE, id="reseated by an administrator"),
        ],
    )
    def test_the_view_answers_the_label_of_the_page_the_seat_opens(self, mongo_replica_set_url: str, seeded: dict[str, Any], wording: str):
        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW["trainer"]), documents=[seeded])

        assert response.running_wording == wording

    @pytest.mark.parametrize(
        ("seeded", "named"),
        [
            pytest.param(eingetragen("bewerbung"), VERWALTUNG_SEITE, id="the administration's page on an applicant-named seat"),
            pytest.param(eingetragen("liga", datum="2026-03-27"), BEWERBER_SEITE, id="the applicant's page on a reseated seat"),
            pytest.param(eingetragen("bewerbung"), "2026-09-bestaetigungsseite-5", id="a superseded label of the right page"),
            pytest.param(eingetragen("bewerbung"), LAUFENDE_FASSUNGEN["bestaetigung_spieler"], id="another page's running label"),
        ],
    )
    def test_an_answer_naming_any_other_label_is_refused_and_spends_nothing(
        self, mongo_replica_set_url: str, seeded: dict[str, Any], named: str
    ):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(APIError) as conflict:
                await answer(database, client, RAW["trainer"], text_version=named)

            return conflict.value, await stored(database), await log_rows(database)

        refusal, document, rows = on_a_league(mongo_replica_set_url, body, documents=[seeded])

        assert (refusal.error_code, refusal.status_code) == (Code.WORDING_NOT_ALLOWED, 409)
        assert document == seeded
        assert rows == []

    def test_a_reseated_seat_is_confirmed_under_the_administrations_page_and_keeps_who_seated_them(self, mongo_replica_set_url: str):
        """`entered_by` is what decides the page, so a confirmation rewriting it would move the page under the person."""

        seeded = eingetragen("liga", datum="2026-03-27")

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW["trainer"], text_version=VERWALTUNG_SEITE)

            return await stored(database), await ansicht(database, RAW["trainer"])

        document, view = on_a_league(mongo_replica_set_url, body, documents=[seeded])

        einwilligung = document["kontakte"]["trainer"]["einwilligung"]
        assert (einwilligung["text_version"], einwilligung["entered_by"], einwilligung["datum"]) == (
            VERWALTUNG_SEITE,
            "liga",
            "2026-03-27",
        )
        assert einwilligung["nachweis"]["umfang"]["text_version"] == VERWALTUNG_SEITE
        assert (view.state, view.running_wording) == ("confirmed", VERWALTUNG_SEITE)

    def test_a_link_answering_a_mixed_pair_shows_and_takes_one_page(self, mongo_replica_set_url: str):
        """A Trainer the applicant named, holding a seat the league filled: one page for both.

        Stored directly: no route makes this pair on an application today, and the judge must not rely on that.
        """

        seeded = bewerbung_document(kontakte=kontakte(trainer_is_also="ansprechperson"))
        for slot, von in (("trainer", "bewerbung"), ("ansprechperson", "liga")):
            seeded["kontakte"][slot]["einwilligung"] = {**seeded["kontakte"][slot]["einwilligung"], "entered_by": von}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            view = await ansicht(database, RAW["trainer"])
            with pytest.raises(APIError) as conflict:
                await answer(database, client, RAW["trainer"], text_version=BEWERBER_SEITE)
            await answer(database, client, RAW["trainer"], text_version=view.running_wording)

            return view, conflict.value, await stored(database)

        view, refusal, document = on_a_league(mongo_replica_set_url, body, documents=[seeded])

        assert view.running_wording == VERWALTUNG_SEITE
        assert (refusal.error_code, refusal.status_code) == (Code.WORDING_NOT_ALLOWED, 409)
        for slot in ("trainer", "ansprechperson"):
            einwilligung = document["kontakte"][slot]["einwilligung"]
            assert (einwilligung["confirmed_at"], einwilligung["text_version"]) == (TODAY, VERWALTUNG_SEITE)

    def test_a_decline_names_no_label_and_is_judged_against_none(self, mongo_replica_set_url: str):
        """A Widerspruch stores no record, so it carries no label to store or refuse."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW["trainer"], antwort="declined")

            return await stored(database)

        assert on_a_league(mongo_replica_set_url, body)["kontakte"]["trainer"] is None


class TestTheMediaConsent:
    """A seat's own media consent, asked on its confirmation page as on a pupil's and a referee's (`medien_age`)."""

    def test_the_view_answers_the_age_the_switch_is_offered_from(self, mongo_replica_set_url: str):
        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW["trainer"]))

        assert response.medien_minimum_age == MEDIEN_MIN_AGE_YEARS

    def test_the_view_of_a_season_rows_link_answers_the_same_age(self, mongo_replica_set_url: str):
        """A link no application holds is answered off the season row, by a response of its own."""

        raw = "raw-token-for-the-season-row"

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, "active"))
            await database[Collection.SAISON_TEAMS].insert_one(
                documents.saison_team_document(
                    SAISON_ID,
                    CLUB_OID,
                    CLUB_NAME,
                    "ADX",
                    kontakte=kontakte(),
                    # The Trainer's seat as a hand-out of its mail leaves it, the other two never mailed.
                    confirmations={
                        "trainer": {"token_hashes": [hash_token(raw)], "sent_at": TODAY, "frist": "2026-04-15", "declined_at": None},
                        "ansprechperson": None,
                        "stellvertretung": None,
                    },
                )
            )

            return await ansicht(database, raw)

        response = on_a_league(mongo_replica_set_url, body)

        assert (response.quelle, response.medien_minimum_age) == ("saison", MEDIEN_MIN_AGE_YEARS)

    def test_a_confirmation_giving_medien_from_a_person_of_age_stores_it_on_the_seat_with_its_evidence(self, mongo_replica_set_url: str):

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await answer(database, client, RAW["trainer"], medien=True)

            return response, await stored(database)

        response, document = on_a_league(mongo_replica_set_url, body)
        einwilligung = document["kontakte"]["trainer"]["einwilligung"]

        # The answer carries what it stored, as the referee's answer does.
        assert response.medien is einwilligung["medien"] is True
        assert einwilligung["nachweis"]["medien"] == {"am": "2026-04-01T10:30:00+00:00", "text_version": BEWERBER_SEITE}

    def test_a_trainer_below_the_media_age_giving_medien_is_refused_and_spends_nothing(self, mongo_replica_set_url: str):
        """Seventeen clears the Trainer's own floor and not the media one, so the age refusal stays silent and this one speaks."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(APIError) as refused:
                await answer(database, client, RAW["trainer"], geburtsdatum=A_SEVENTEEN_YEAR_OLDS_BIRTHDATE, medien=True)

            return refused.value, await stored(database), await log_rows(database)

        refusal, document, rows = on_a_league(mongo_replica_set_url, body)

        assert (refusal.error_code, refusal.status_code) == (Code.MEDIEN_AGE, 422)
        assert document == bewerbung_document()
        assert rows == []

    def test_the_same_trainer_confirming_without_it_is_taken(self, mongo_replica_set_url: str):
        """The control: the refusal above is the media switch's alone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW["trainer"], geburtsdatum=A_SEVENTEEN_YEAR_OLDS_BIRTHDATE, medien=False)

            return await stored(database)

        einwilligung = on_a_league(mongo_replica_set_url, body)["kontakte"]["trainer"]["einwilligung"]

        assert (einwilligung["confirmed_at"], einwilligung["medien"]) == (TODAY, False)


class TestTheLinkIsSpentByTheStamp:
    def test_a_second_answer_on_the_same_link_is_refused_and_the_reopened_link_shows_confirmed(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW["trainer"])

            with pytest.raises(APIError) as conflict:
                await answer(database, client, RAW["trainer"], geburtsdatum="1990-01-01")

            return (
                conflict.value.error_code,
                (await stored(database))["kontakte"]["trainer"]["geburtsdatum"],
                await ansicht(database, RAW["trainer"]),
            )

        code, geburtsdatum, view = on_a_league(mongo_replica_set_url, body)

        assert code == Code.BEWERBUNG_SEAT_ALREADY_ANSWERED
        assert geburtsdatum == AN_ADULTS_BIRTHDATE
        assert view.state == "confirmed"

    def test_an_age_refusal_spends_nothing(self, mongo_replica_set_url: str):
        """A mistyped year is the commonest error on a date field; a link voided by one has no remedy but a re-send."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(APIError) as conflict:
                await answer(database, client, RAW["trainer"], geburtsdatum=A_CHILDS_BIRTHDATE)

            return conflict.value.error_code, await ansicht(database, RAW["trainer"]), await stored(database), await log_rows(database)

        code, view, document, rows = on_a_league(mongo_replica_set_url, body)

        assert code == Code.CONFIRMATION_AGE
        assert view.state == "valid"
        assert document == bewerbung_document()
        assert rows == []

    def test_the_seat_that_signs_for_the_school_is_refused_a_day_short_of_eighteen_and_nothing_is_written(self, mongo_replica_set_url: str):
        """The same date the Trainer's link takes: a floor judged for the application rather than the seat admits this person."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(APIError) as conflict:
                await answer(database, client, RAW["ansprechperson"], geburtsdatum=A_SEVENTEEN_YEAR_OLDS_BIRTHDATE)

            return conflict.value.error_code, await stored(database), await log_rows(database)

        code, document, rows = on_a_league(mongo_replica_set_url, body)

        assert code == Code.CONFIRMATION_AGE
        assert document == bewerbung_document()
        assert rows == []

    def test_the_trainer_seat_takes_that_same_date(self, mongo_replica_set_url: str):
        """The other half of the pair: without it the case above passes for a floor raised on all three seats."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await answer(database, client, RAW["trainer"], geburtsdatum=A_SEVENTEEN_YEAR_OLDS_BIRTHDATE)

            return response, await stored(database)

        response, document = on_a_league(mongo_replica_set_url, body)

        assert response.ergebnis == "confirmed"
        assert document["kontakte"]["trainer"]["geburtsdatum"] == A_SEVENTEEN_YEAR_OLDS_BIRTHDATE

    def test_a_link_past_its_deadline_is_refused_before_the_seat_is_judged(self, mongo_replica_set_url: str):
        expired = bewerbung_document(confirmation_deadline=YESTERDAY)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            with pytest.raises(APIError) as conflict:
                await answer(database, client, RAW["trainer"])

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body, documents=[expired]) == Code.BEWERBUNG_TOKEN_PAST_DEADLINE

    def test_a_resend_of_one_seat_reopens_every_other_seats_link_past_the_deadline(self, mongo_replica_set_url: str):
        """`bewerbung_token_past_deadline` is a 409, no spent link: the deadline is the application's one field, and a re-send restarts it."""

        expired = bewerbung_document(confirmation_deadline=YESTERDAY)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(APIError) as refused:
                await answer(database, client, RAW["stellvertretung"])
            await resend(database, "ansprechperson")
            answered = await answer(database, client, RAW["stellvertretung"])

            return refused.value.error_code, answered.ergebnis

        assert on_a_league(mongo_replica_set_url, body, documents=[expired]) == (Code.BEWERBUNG_TOKEN_PAST_DEADLINE, "confirmed")

    def test_a_decided_application_refuses_every_link_as_spent(self, mongo_replica_set_url: str):
        """`link_expired`: nothing sets `status` back to `submitted`, and a decided application takes no re-send."""

        decided = bewerbung_document(status="declined")

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            with pytest.raises(APIError) as refused:
                await answer(database, client, RAW["trainer"])

            return refused.value.error_code

        assert on_a_league(mongo_replica_set_url, body, documents=[decided]) == Code.LINK_EXPIRED


class TestADecline:
    """The person's slot is emptied and the log redacted in ONE transaction, as an erasure does: a person who refuses is not held."""

    def test_the_slot_is_emptied_the_day_recorded_beside_it_and_the_seat_still_outstanding(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await answer(database, client, RAW["stellvertretung"], antwort="declined")

            return response, await stored(database), await ansicht(database, RAW["stellvertretung"])

        response, document, view = on_a_league(mongo_replica_set_url, body)

        assert document["kontakte"]["stellvertretung"] is None
        assert document["confirmations"]["stellvertretung"]["declined_at"] == TODAY
        # The Ansprechperson's objection notice names the deletion day, so no second notice follows it.
        assert document["erasure_announced_at"] == TODAY
        assert (response.ergebnis, response.geburtsdatum, response.medien) == ("declined", None, False)
        assert view.state == "declined"

    def test_the_seat_leaves_every_log_image_and_an_earlier_answer_beside_it_stays(self, mongo_replica_set_url: str):
        """Restore the redaction by document and this fails: the Trainer's state before their own consent is in the log alone.

        The clearing patch files a pre-image too, so the redaction has to reach the row it just wrote.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW["trainer"])
            await answer(database, client, RAW["stellvertretung"], antwort="declined")

            return await log_rows(database)

        # A submission's digest, taken over the declining person's details too.
        consent, decline = on_a_league(mongo_replica_set_url, body, documents=[bewerbung_document(idempotency_fingerprint="a" * 64)])

        for row in (consent, decline):
            assert (row["before"]["kontakte"]["stellvertretung"], row["redacted_at"]) == (None, REDACTED_AT)
            # Present, so the null is the redaction's rather than a digest never stored.
            assert ("idempotency_fingerprint" in row["before"], row["before"]["idempotency_fingerprint"]) == (True, None)
            # The link stays with the seat in the image, as it does on the application.
            assert row["before"]["confirmations"]["stellvertretung"] is not None
        assert consent["before"]["kontakte"]["trainer"]["geburtsdatum"] is None
        assert decline["before"]["kontakte"]["trainer"]["geburtsdatum"] == AN_ADULTS_BIRTHDATE

    def test_a_declined_seat_takes_no_second_answer(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            await answer(database, client, RAW["stellvertretung"], antwort="declined")

            with pytest.raises(APIError) as conflict:
                await answer(database, client, RAW["stellvertretung"])

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body) == Code.BEWERBUNG_SEAT_ALREADY_ANSWERED


async def owed(database: AsyncDatabase) -> list[Mapping[str, Any]]:
    """Every mail the Postausgang holds, as owed: its key, its recipient and its facts."""

    return await database[Collection.OUTBOX].find({}, {"_id": 0, "key": 1, "an": 1, "data": 1}).to_list(length=None)


class TestWhatAWiderspruchOwesTheSubmitter:
    """The notice naming who refused, owed in the decline's own transaction; a confirmation owes nobody anything."""

    def test_a_confirmation_owes_no_mail(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW["stellvertretung"], now=MAIL_NOW)

            return await owed(database)

        assert on_a_league(mongo_replica_set_url, body) == []

    def test_another_seats_decline_owes_the_ansprechperson_the_notice_naming_who_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW["stellvertretung"], antwort="declined", now=MAIL_NOW)

            return await owed(database)

        assert on_a_league(mongo_replica_set_url, body) == [
            {
                "key": f"{Collection.BEWERBUNGEN}/{BEWERBUNG_OID}/widerspruch/stellvertretung",
                "an": "quillhilde@example.com",
                "data": {
                    "art": "bewerbung_widerspruch",
                    "saison_id": SAISON_ID,
                    "rollen": ["ansprechperson"],
                    # Off the read before the decline: nothing left in the record names whose entry was refused.
                    "declined": {"vorname": "Bramblewick", "rollen": ["stellvertretung"]},
                    "frist": "2026-04-03",
                },
            }
        ]

    def test_one_person_holding_two_seats_is_owed_one_notice_naming_both(self, mongo_replica_set_url: str):
        """The seats are the person's, not the seat's: told one, a person holding two reads a mail about somebody else."""

        double = bewerbung_document(kontakte=kontakte(trainer_is_also="ansprechperson"))

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW["stellvertretung"], antwort="declined", now=MAIL_NOW)

            return await owed(database)

        [notice] = on_a_league(mongo_replica_set_url, body, documents=[double])

        assert (notice["an"], notice["data"]["rollen"]) == ("wraxlington@example.com", ["trainer", "ansprechperson"])

    def test_the_ansprechpersons_own_decline_owes_nobody(self, mongo_replica_set_url: str):
        """The seat the notice would address is the seat that just emptied itself."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW["ansprechperson"], antwort="declined", now=MAIL_NOW)

            return await owed(database)

        assert on_a_league(mongo_replica_set_url, body) == []

    def test_the_ansprechpersons_own_decline_announces_no_deletion(self, mongo_replica_set_url: str):
        """Nobody is told of it, so the deletion notice still goes to whoever holds that seat at the deadline."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW["ansprechperson"], antwort="declined")

            return await stored(database)

        assert on_a_league(mongo_replica_set_url, body).get("erasure_announced_at") is None

    def test_no_other_seats_address_reaches_the_answer(self, mongo_replica_set_url: str):
        """The answer is the browser's: an address or a name in it is one nothing here would send to."""

        rendered = on_a_league(mongo_replica_set_url, lambda database, client: answer(database, client, RAW["trainer"])).model_dump_json()

        assert MAIL_DOMAIN not in rendered
        assert NACHNAME not in rendered and TELEFON not in rendered


class TestNoHashReachesAnAdminRead:
    """No hash reaches either admin answer: the case holds the answer alone.

    The response model drops every hash field itself, so a projection loading one into the process still passes here.
    """

    def test_neither_admin_read_serves_a_hash_while_a_seat_holds_two(self, mongo_replica_set_url: str):
        # A reminded seat holds the first mail's hash beside the reminder's, and both open the link: a fixture without
        # one leaves the array's second entry untested on both reads.
        erinnert_hash = hash_token("the-reminders-link-this-seat-was-mailed")
        reminded = bewerbung_document()
        reminded["confirmations"]["trainer"] |= {"token_hashes": [HASHES["trainer"], erinnert_hash], "reminded_at": TODAY}

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            one = await get_bewerbung(
                bewerbung_id=BEWERBUNG_OID,
                bewerbungen_collection=database[Collection.BEWERBUNGEN],
                postausgang_collection=database[Collection.OUTBOX],
                sperrliste=ban_list(database),
                today=TODAY,
            )
            many = await get_bewerbungen(
                bewerbungen_collection=database[Collection.BEWERBUNGEN],
                postausgang_collection=database[Collection.OUTBOX],
                sperrliste=ban_list(database),
                filters=FLBewerbungenFilterParams(),
            )

            return one.model_dump_json(), many.model_dump_json(), await stored(database)

        one, many, document = on_a_league(mongo_replica_set_url, body, documents=[reminded])

        assert document["confirmations"]["trainer"]["token_hashes"] == [HASHES["trainer"], erinnert_hash]
        for rendered in (one, many):
            assert "token_hash" not in rendered
            assert not any(token_hash in rendered for token_hash in (*HASHES.values(), erinnert_hash))
            # The rest of the block still reaches the triage, which renders the per-seat facts off it.
            assert "sent_at" in rendered


class TestTheEditorsRead:
    """The application editor words the deletion by the server's judgement of the deadline, never by a day the browser reads."""

    @pytest.mark.parametrize(("frist", "abgelaufen"), [(TODAY, False), (YESTERDAY, True)], ids=["due-today", "due-yesterday"])
    def test_it_answers_whether_the_confirmation_deadline_has_passed(self, mongo_replica_set_url: str, frist: str, abgelaufen: bool):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            return await get_bewerbung(
                bewerbung_id=BEWERBUNG_OID,
                bewerbungen_collection=database[Collection.BEWERBUNGEN],
                postausgang_collection=database[Collection.OUTBOX],
                sperrliste=ban_list(database),
                today=TODAY,
            )

        read = on_a_league(mongo_replica_set_url, body, documents=[bewerbung_document(confirmation_deadline=frist)])

        assert read.confirmation_deadline_expired is abgelaufen


class TestAResend:
    def test_a_fresh_link_voids_the_old_and_restarts_the_deadline(self, mongo_replica_set_url: str):
        """The link reaches the seat through the hand-out of the mail the re-send owes, which mints it into `token_hashes`."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await resend(database, "trainer")
            [mail] = await drained(database, client)

            with pytest.raises(APIError) as conflict:
                await ansicht(database, RAW["trainer"])

            assert mail.token is not None
            return response, mail, conflict.value.error_code, await ansicht(database, mail.token), await stored(database)

        response, mail, old_code, view, document = on_a_league(mongo_replica_set_url, body)

        assert old_code == Code.LINK_INVALID
        assert (view.state, view.rolle) == ("valid", "trainer")
        assert (response.rolle, response.confirmation_deadline) == ("trainer", "2026-04-15")
        assert (mail.an, mail.data.art) == ("wraxlington@example.com", "bewerbung_confirmation")
        assert document["confirmation_deadline"] == "2026-04-15"
        assert document["confirmations"]["trainer"] == {
            "token_hashes": [hash_token(mail.token or "")],
            "sent_at": TODAY,
            "reminded_at": None,
            "declined_at": None,
        }
        # The other seats' links still open.
        assert document["confirmations"]["ansprechperson"]["token_hashes"] == [HASHES["ansprechperson"]]

    def test_a_restarted_deadline_takes_back_the_announcement(self, mongo_replica_set_url: str):
        """The notice named the old deadline, so the new one is announced again before the application is deleted."""

        announced = bewerbung_document(erasure_announced_at="2026-03-30")

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            await resend(database, "trainer")

            return await stored(database)

        assert on_a_league(mongo_replica_set_url, body, documents=[announced])["erasure_announced_at"] is None

    def test_a_confirmed_seat_gets_no_new_link(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            await answer(database, client, RAW["trainer"])

            with pytest.raises(APIError) as conflict:
                await resend(database, "trainer")

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body) == Code.BEWERBUNG_SEAT_ALREADY_ANSWERED

    def test_a_decided_application_gets_no_new_link(self, mongo_replica_set_url: str):
        decided = bewerbung_document(status="declined", decision={"made_at": YESTERDAY, "von": "admin", "grund": "kein Platz"})

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> str:
            with pytest.raises(APIError) as conflict:
                await resend(database, "trainer")

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body, documents=[decided]) == Code.BEWERBUNG_ALREADY_DECIDED

    def test_a_path_naming_no_seat_is_a_miss(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentNotFoundError):
                await resend(database, "trainer_is_also")

            return await stored(database)

        assert on_a_league(mongo_replica_set_url, body) == bewerbung_document()


# Composed by the production helper rather than spelled, so a drifted bound cannot leave these cases passing over a lapsed row.
STANDING = compose_gesperrt_bis_saison_id(massgebliche_saison_id=SAISON_ID)


def address_of(seat: str, document: Mapping[str, Any] | None = None) -> str:
    return str((document or bewerbung_document())["kontakte"][seat]["email"])


async def ban(database: AsyncDatabase, address: str) -> None:
    await database[Collection.SPERRLISTE].insert_one(ban_document(address, bis=STANDING))


# The season before the running one, so a ban naming it as its last has lapsed.
LAPSED = f"{int(SAISON_ID) - 1}"


async def ban_under_a_running_season(database: AsyncDatabase, address: str, *, bis: str) -> None:
    """A ban's bound is read against the running season only where one runs; with none, every row bars."""
    await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, "active"))
    await database[Collection.SPERRLISTE].insert_one(ban_document(address, bis=bis))


def decline(database: AsyncDatabase, client: AsyncMongoClient, seat: str) -> Any:
    return answer(database, client, RAW[seat], antwort="declined")


class TestALinkToABarredAddress:
    """`link_barred`: a ban reaches a link already in somebody's inbox, the seeded ones all minted before it."""

    def test_a_consent_is_refused_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, address_of("stellvertretung"))

            with pytest.raises(APIError) as refused:
                await answer(database, client, RAW["stellvertretung"])

            return refused.value, await stored(database), await log_rows(database)

        refused, document, rows = on_a_league(mongo_replica_set_url, body)

        assert (refused.error_code, refused.status_code) == (Code.LINK_BARRED, 403)
        assert document == bewerbung_document()
        assert rows == []

    def test_a_decline_is_still_taken(self, mongo_replica_set_url: str):
        """A barred person asking to be removed is never refused: the decline empties the seat and redacts the log as an erasure does."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, address_of("stellvertretung"))

            return await decline(database, client, "stellvertretung"), await stored(database)

        response, document = on_a_league(mongo_replica_set_url, body)

        assert response.ergebnis == "declined"
        assert document["kontakte"]["stellvertretung"] is None

    def test_a_ban_on_another_seats_address_leaves_this_link_answering(self, mongo_replica_set_url: str):
        """The other half of the pair: without it the first case passes for a check refusing every consent."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, address_of("trainer"))

            return await answer(database, client, RAW["stellvertretung"])

        assert on_a_league(mongo_replica_set_url, body).ergebnis == "confirmed"

    def test_the_link_answers_again_once_the_ban_is_lifted(self, mongo_replica_set_url: str):
        """Nothing of the ban is written on the seat, so lifting it is all a mistaken ban needs undone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, address_of("stellvertretung"))
            with pytest.raises(APIError):
                await answer(database, client, RAW["stellvertretung"])
            await database[Collection.SPERRLISTE].delete_many({})

            return await answer(database, client, RAW["stellvertretung"])

        assert on_a_league(mongo_replica_set_url, body).ergebnis == "confirmed"

    def test_a_ban_past_its_last_season_bars_nothing(self, mongo_replica_set_url: str):
        """The running season is what the bound is read against: asked without it, the lapsed row would still bar."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban_under_a_running_season(database, address_of("stellvertretung"), bis=LAPSED)

            return await answer(database, client, RAW["stellvertretung"])

        assert on_a_league(mongo_replica_set_url, body).ergebnis == "confirmed"

    def test_a_standing_ban_still_bars_while_a_season_runs(self, mongo_replica_set_url: str):
        """The other half of the case above: without it, that case passes for a check asking nothing once a season runs."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            await ban_under_a_running_season(database, address_of("stellvertretung"), bis=STANDING)

            with pytest.raises(APIError) as refused:
                await answer(database, client, RAW["stellvertretung"])

            return refused.value.error_code

        assert on_a_league(mongo_replica_set_url, body) == Code.LINK_BARRED

    def test_a_pair_is_refused_on_either_seats_address(self, mongo_replica_set_url: str):
        """One press writes both seats, so each address it would confirm is asked: only a hand edit parts a pair's two."""

        paired = bewerbung_document(kontakte=kontakte(trainer_is_also="ansprechperson"))
        paired["kontakte"]["trainer"]["email"] = "wraxlington.trainer@example.com"

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, address_of("trainer", paired))

            with pytest.raises(APIError) as refused:
                await answer(database, client, RAW["ansprechperson"])

            return refused.value.error_code

        assert on_a_league(mongo_replica_set_url, body, documents=[paired]) == Code.LINK_BARRED

    def test_an_answered_seat_answers_the_stamp_rather_than_the_ban(self, mongo_replica_set_url: str):
        """The order: the answer given before the ban stands until an administrator acts, so a second press is refused as answered."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            await answer(database, client, RAW["stellvertretung"])
            await ban(database, address_of("stellvertretung"))

            with pytest.raises(APIError) as refused:
                await answer(database, client, RAW["stellvertretung"])

            return refused.value.error_code

        assert on_a_league(mongo_replica_set_url, body) == Code.BEWERBUNG_SEAT_ALREADY_ANSWERED

    def test_a_barred_consent_carrying_a_refused_date_answers_the_ban_rather_than_the_age(self, mongo_replica_set_url: str):
        """The other half of the order: a corrected date buys a barred address nothing, so it is not what the person is asked for."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            await ban(database, address_of("stellvertretung"))

            with pytest.raises(APIError) as refused:
                await answer(database, client, RAW["stellvertretung"], geburtsdatum=A_CHILDS_BIRTHDATE)

            return refused.value.error_code

        assert on_a_league(mongo_replica_set_url, body) == Code.LINK_BARRED


class TestTheViewOfALinkToABarredAddress:
    """The page reads the ban off the view, so it never offers a barred person the form."""

    def test_the_view_answers_gesperrt(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> str:
            await ban(database, address_of("stellvertretung"))

            return (await ansicht(database, RAW["stellvertretung"])).state

        assert on_a_league(mongo_replica_set_url, body) == "barred"

    def test_a_ban_on_another_seats_address_leaves_this_view_open(self, mongo_replica_set_url: str):
        """The other half of the pair: without it the case above passes for a view answering `barred` to everyone."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> str:
            await ban(database, address_of("trainer"))

            return (await ansicht(database, RAW["stellvertretung"])).state

        assert on_a_league(mongo_replica_set_url, body) == "valid"

    def test_the_view_opens_again_once_the_ban_is_lifted(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[str, str]:
            await ban(database, address_of("stellvertretung"))
            barred = (await ansicht(database, RAW["stellvertretung"])).state
            await database[Collection.SPERRLISTE].delete_many({})

            return barred, (await ansicht(database, RAW["stellvertretung"])).state

        assert on_a_league(mongo_replica_set_url, body) == ("barred", "valid")

    @pytest.mark.parametrize(
        ("bis", "state"), [pytest.param(STANDING, "barred", id="standing, the control"), pytest.param(LAPSED, "valid", id="lapsed")]
    )
    def test_a_ban_is_read_against_the_running_season(self, mongo_replica_set_url: str, bis: str, state: str):
        """Read as the press reads it: asked without the season, the lapsed row would bar the view alone."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> str:
            await ban_under_a_running_season(database, address_of("stellvertretung"), bis=bis)

            return (await ansicht(database, RAW["stellvertretung"])).state

        assert on_a_league(mongo_replica_set_url, body) == state

    def test_a_pairs_view_is_barred_on_either_seats_address(self, mongo_replica_set_url: str):
        """The addresses the press asks, and no fewer: a view asking its own seat alone would offer a form the press refuses."""

        paired = bewerbung_document(kontakte=kontakte(trainer_is_also="ansprechperson"))
        paired["kontakte"]["trainer"]["email"] = "wraxlington.trainer@example.com"

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> str:
            await ban(database, address_of("trainer", paired))

            return (await ansicht(database, RAW["ansprechperson"])).state

        assert on_a_league(mongo_replica_set_url, body, documents=[paired]) == "barred"

    def test_an_answered_seat_reopened_after_the_ban_shows_the_ban(self, mongo_replica_set_url: str):
        """The ban outranks the stamp here, where the press ranks it below: the page shows a barred person nothing else."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            await answer(database, client, RAW["stellvertretung"])
            await ban(database, address_of("stellvertretung"))

            return (await ansicht(database, RAW["stellvertretung"])).state

        assert on_a_league(mongo_replica_set_url, body) == "barred"
