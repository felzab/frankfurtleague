from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
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
    BEWERBUNG_EINWILLIGUNG_GESPERRT,
    BEWERBUNG_KONTAKT_ALTER,
    BEWERBUNG_SEAT_ALREADY_ANSWERED,
    BEWERBUNG_TOKEN_DECIDED,
    BEWERBUNG_TOKEN_PAST_DEADLINE,
    BEWERBUNG_TOKEN_UNKNOWN,
    SEAT_MIN_AGE_YEARS,
    TOKEN_HASH_FIELDS,
    compose_bestaetigungen,
    hash_token,
)
from app.api.einwilligung.services import FASSUNG_UNZULAESSIG, SELBST_MEDIEN_ALTER
from app.api.saisons.cache import invalidate_saison_cache
from app.api.sperrliste.services import compose_gesperrt_bis_saison_id
from app.api.teams.schemas import KONTAKT_ROLLEN
from app.core.collections import Collection
from app.core.exceptions import DocumentNotFoundException, WriteRefusalException
from app.shared.einwilligung import LAUFENDE_FASSUNGEN
from app.shared.schemas.bounds import MEDIEN_MIN_AGE_YEARS
from tests.bans import ban_list
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import ADDRESS, ban_document, kontaktperson_document, saison_document, team_document
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
RAW: Mapping[str, str] = {seat: f"raw-token-for-{seat}" for seat in KONTAKT_ROLLEN}
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
    _seat_paths("bestaetigungen", *TOKEN_HASH_FIELDS, "abgelehnt_am")
    | _seat_paths("kontakte", "vorname", "email", "einwilligung.bestaetigt_am", "einwilligung.text_version")
    | _seat_paths("kontakte", "einwilligung.eingetragen_von", "einwilligung.datum")
    | {"kontakte.trainer_ist_zugleich", "saison_id", "status", "bestaetigungsfrist", "schule.team_name", "team_id", "eingereicht_am"}
)

# `_id` is here and not in the view's, whose own line says why
# (`app/api/bewerbungen/services.py :: EINWILLIGUNG_ANSICHT_FIELDS`).
ANTWORT_RESOLVES = frozenset(
    _seat_paths("bestaetigungen", *TOKEN_HASH_FIELDS, "abgelehnt_am")
    | _seat_paths("kontakte", "vorname", "email", "einwilligung.bestaetigt_am", "einwilligung.umfang", "einwilligung.medien")
    | _seat_paths("kontakte", "einwilligung.nachweis", "einwilligung.eingetragen_von", "einwilligung.datum")
    | {"_id", "kontakte.trainer_ist_zugleich", "saison_id", "status", "bestaetigungsfrist", "eingereicht_am"}
)


# Sought as fragments by the leak searches, so a response carrying any part of a seat's record is caught.
NACHNAME = "Mustermann"
MAIL_DOMAIN = "example.com"
TELEFON = "1234567"


def person(vorname: str) -> dict[str, Any]:
    return kontaktperson_document(
        vorname, nachname=f"{vorname}-{NACHNAME}", email=f"{vorname.lower()}@{MAIL_DOMAIN}", telefon=f"+49 170 {TELEFON}"
    )


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
            await database[Collection.TEAMS].insert_one(team_document(CLUB_OID, CLUB_NAME, "AD", website_url=None, schulform="gymnasium_g9"))
            await database[Collection.BEWERBUNGEN].insert_many(documents if documents is not None else [bewerbung_document()])

            return await body(database, client)

    return on_the_seed_loop(_run())


async def ansicht(database: AsyncDatabase, token: str, *, bewerbungen: Any = None) -> Any:
    return await get_einwilligung_ansicht(
        ansicht_data=FLBewerbungEinwilligungAnsichtPayload(token=token),
        bewerbungen_collection=database[Collection.BEWERBUNGEN] if bewerbungen is None else bewerbungen,
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        teams_collection=database[Collection.TEAMS],
        sperrliste=ban_list(database),
        today=TODAY,
    )


async def answer(database: AsyncDatabase, client: AsyncMongoClient, token: str, *, bewerbungen: Any = None, **overrides: Any) -> Any:
    body = {
        "token": token,
        "antwort": "erteilt",
        "geburtsdatum": AN_ADULTS_BIRTHDATE,
        "whatsapp": True,
        "medien": False,
        "text_version": BEWERBER_SEITE,
        **overrides,
    }

    return await post_einwilligung(
        antwort_data=FLBewerbungEinwilligungAntwortPayload.model_validate(body),
        bewerbungen_collection=database[Collection.BEWERBUNGEN] if bewerbungen is None else bewerbungen,
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        aktionen_collection=database[Collection.AKTIONEN],
        sperrliste=ban_list(database),
        db=client,
        today=TODAY,
        germany_now=NOW,
    )


async def resend(database: AsyncDatabase, seat: str, bewerbung_id: ObjectId = BEWERBUNG_OID) -> Any:
    return await erneut_einwilligung(
        bewerbung_id=bewerbung_id,
        seat=seat,
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        sperrliste=ban_list(database),
        db=database.client,
        today=TODAY,
    )


async def stored(database: AsyncDatabase, bewerbung_id: ObjectId = BEWERBUNG_OID) -> Mapping[str, Any]:
    found = await database[Collection.BEWERBUNGEN].find_one({"_id": bewerbung_id})
    assert found is not None, "the seeded application is gone"

    return found


async def log_rows(database: AsyncDatabase) -> list[Mapping[str, Any]]:
    return await database[Collection.AKTIONEN].find({"collection": str(Collection.BEWERBUNGEN)}).sort("_id", 1).to_list(length=None)


class _ReadsRecorded:
    """The applications collection, keeping what each `find_one` answered.

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


def loaded_by_the_link(recorder: _ReadsRecorded) -> list[Any]:
    """Every document the TOKEN filter found.

    `fl_backend/app/core/crud.py :: patch_one_in_db` reads the same application twice more, on `_id`
    and unprojected, its pre-image being the log's (`docs/backend/spec.md :: I39`).
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
        """`READ-BEWERBUNG-002`: a first name, a school, a season, a role and a wording, and nothing a leaked link could act on."""

        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW["ansprechperson"]))

        assert (response.zustand, response.saison_id, response.schule, response.rolle) == ("gueltig", SAISON_ID, SCHOOL_NAME, "ansprechperson")
        assert (response.vorname, response.text_version, response.zugleich_rolle) == ("Quillhilde", "v3", None)
        rendered = response.model_dump_json()
        assert NACHNAME not in rendered and MAIL_DOMAIN not in rendered and TELEFON not in rendered

    @pytest.mark.parametrize(
        ("seat", "zugleich_rolle"),
        [("ansprechperson", "trainer"), ("trainer", "ansprechperson"), ("stellvertretung", None)],
    )
    def test_a_double_seated_persons_link_names_their_second_seat_and_no_other_link_does(
        self, mongo_replica_set_url: str, seat: str, zugleich_rolle: str | None
    ):
        """The third seat is load-bearing: serving the declaration itself would tell the Stellvertretung that two OTHER seats are one person."""

        paired = bewerbung_document(kontakte=kontakte(trainer_ist_zugleich="ansprechperson"))

        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW[seat]), documents=[paired])

        assert (response.rolle, response.zugleich_rolle) == (seat, zugleich_rolle)

    @pytest.mark.parametrize(
        ("seat", "trainer_ist_zugleich", "mindestalter"),
        [
            pytest.param("trainer", None, 16, id="the Trainer, who takes the league's own floor"),
            pytest.param("ansprechperson", None, 18, id="the Ansprechperson, who signs for the school"),
            pytest.param("stellvertretung", None, 18, id="the Stellvertretung, who stands in for them"),
            pytest.param("trainer", "ansprechperson", 18, id="a Trainer who is also the Ansprechperson, on the Trainer's own link"),
        ],
    )
    def test_the_link_answers_the_floor_the_person_holding_it_has_to_clear(
        self, mongo_replica_set_url: str, seat: str, trainer_ist_zugleich: str | None, mindestalter: int
    ):
        """The page fills its `{minAlter}` slots and bounds its date control from this, so a wrong number offers a date the answer refuses."""

        seeded = bewerbung_document(kontakte=kontakte(trainer_ist_zugleich=trainer_ist_zugleich))

        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW[seat]), documents=[seeded])

        assert response.mindestalter == mindestalter

    def test_the_seats_the_view_names_are_the_seats_the_answer_writes(self, mongo_replica_set_url: str):
        paired = bewerbung_document(kontakte=kontakte(trainer_ist_zugleich="ansprechperson"))

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            view = await ansicht(database, RAW["trainer"])
            await answer(database, client, RAW["trainer"])

            return view, await stored(database)

        view, document = on_a_league(mongo_replica_set_url, body, documents=[paired])

        stamped = {seat for seat in KONTAKT_ROLLEN if document["kontakte"][seat]["einwilligung"]["bestaetigt_am"] == TODAY}
        assert stamped == {view.rolle, view.zugleich_rolle}

    def test_a_picked_clubs_application_names_the_club(self, mongo_replica_set_url: str):
        picked = bewerbung_document(PICKED_BEWERBUNG_OID, team_id=CLUB_OID, schule=None)

        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW["trainer"]), documents=[picked])

        assert response.schule == CLUB_NAME

    def test_a_token_no_seat_holds_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> str:
            with pytest.raises(WriteRefusalException) as conflict:
                await ansicht(database, "a-stranger's-guess")

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body) == BEWERBUNG_TOKEN_UNKNOWN

    def test_a_link_past_its_deadline_is_shown_as_expired_rather_than_refused(self, mongo_replica_set_url: str):
        expired = bewerbung_document(bestaetigungsfrist=YESTERDAY)

        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW["trainer"]), documents=[expired])

        assert response.zustand == "abgelaufen"


class TestWhatAnAnonymousReadLoads:
    """These two cases hold the narrowing alone.

    A projection too SHORT is answered by the rest of this module, which drives every field either read resolves.
    """

    def test_the_view_never_holds_the_application_beyond_the_fields_its_answer_is_built_from(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> list[Any]:
            recorder = _ReadsRecorded(database[Collection.BEWERBUNGEN])
            await ansicht(database, RAW["ansprechperson"], bewerbungen=recorder)

            return loaded_by_the_link(recorder)

        loaded = on_a_league(mongo_replica_set_url, body)

        assert loaded, "the link's own read did not run"
        assert set().union(*(leaf_paths(document) for document in loaded)) <= ANSICHT_RESOLVES

    def test_the_answer_never_holds_the_application_beyond_the_fields_it_judges_and_writes_on(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[Any]:
            recorder = _ReadsRecorded(database[Collection.BEWERBUNGEN])
            await answer(database, client, RAW["ansprechperson"], bewerbungen=recorder)

            return loaded_by_the_link(recorder)

        loaded = on_a_league(mongo_replica_set_url, body)

        assert loaded, "the link's own read did not run"
        assert set().union(*(leaf_paths(document) for document in loaded)) <= ANTWORT_RESOLVES


class TestWhatAConfirmationWrites:
    """The one `$set`: `docs/backend/spec.md :: I141`'s pairing lands whole, and the hash stays where it is."""

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
            "bestaetigt_am": TODAY,
            "medien": False,
            # Each choice's evidence under the page the person answered: the WhatsApp grant, and the
            # media answer withholding.
            "nachweis": {
                "umfang": {"am": "2026-04-01T10:30:00+00:00", "text_version": BEWERBER_SEITE},
                "medien": {"am": "2026-04-01T10:30:00+00:00", "text_version": BEWERBER_SEITE},
            },
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


def eingetragen(von: str, *, datum: str = "2026-03-20") -> dict[str, Any]:
    """An application whose Trainer seat names who seated its person, its record dated `datum`."""

    seeded = bewerbung_document()
    einwilligung = seeded["kontakte"]["trainer"]["einwilligung"]
    seeded["kontakte"]["trainer"]["einwilligung"] = {**einwilligung, "datum": datum, "eingetragen_von": von}

    return seeded


class TestThePageALinkOpens:
    """The view answers the label of the page true for the person, and the answer is judged against that page."""

    @pytest.mark.parametrize(
        ("seeded", "fassung"),
        [
            pytest.param(eingetragen("bewerbung"), BEWERBER_SEITE, id="named by the applicant"),
            pytest.param(eingetragen("liga", datum="2026-03-27"), VERWALTUNG_SEITE, id="reseated by an administrator"),
            pytest.param(bewerbung_document(), BEWERBER_SEITE, id="stored before the field, dated the submission's day"),
        ],
    )
    def test_the_view_answers_the_label_of_the_page_the_seat_opens(self, mongo_replica_set_url: str, seeded: dict[str, Any], fassung: str):
        """The wiring alone, by the field and by the day; which outranks which is the unit table's.

        That table is `tests/api/test_bewerbung_einwilligung_refusal.py :: TestWhichPageASeatOpens`.
        """

        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW["trainer"]), documents=[seeded])

        assert response.laufende_fassung == fassung

    @pytest.mark.parametrize(
        ("seeded", "genannt"),
        [
            pytest.param(eingetragen("bewerbung"), VERWALTUNG_SEITE, id="the administration's page on an applicant-named seat"),
            pytest.param(eingetragen("liga", datum="2026-03-27"), BEWERBER_SEITE, id="the applicant's page on a reseated seat"),
            pytest.param(eingetragen("bewerbung"), "2026-09-bestaetigungsseite-5", id="a superseded label of the right page"),
            pytest.param(eingetragen("bewerbung"), LAUFENDE_FASSUNGEN["bestaetigung_spieler"], id="another page's running label"),
        ],
    )
    def test_an_answer_naming_any_other_label_is_refused_and_spends_nothing(
        self, mongo_replica_set_url: str, seeded: dict[str, Any], genannt: str
    ):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(WriteRefusalException) as conflict:
                await answer(database, client, RAW["trainer"], text_version=genannt)

            return conflict.value, await stored(database), await log_rows(database)

        refusal, document, rows = on_a_league(mongo_replica_set_url, body, documents=[seeded])

        assert (refusal.error_code, refusal.status_code) == (FASSUNG_UNZULAESSIG, 409)
        assert document == seeded
        assert rows == []

    def test_a_reseated_seat_is_confirmed_under_the_administrations_page_and_keeps_who_seated_them(self, mongo_replica_set_url: str):
        """`eingetragen_von` is what decides the page, so a confirmation rewriting it would move the page under the person."""

        seeded = eingetragen("liga", datum="2026-03-27")

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW["trainer"], text_version=VERWALTUNG_SEITE)

            return await stored(database), await ansicht(database, RAW["trainer"])

        document, view = on_a_league(mongo_replica_set_url, body, documents=[seeded])

        einwilligung = document["kontakte"]["trainer"]["einwilligung"]
        assert (einwilligung["text_version"], einwilligung["eingetragen_von"], einwilligung["datum"]) == (
            VERWALTUNG_SEITE,
            "liga",
            "2026-03-27",
        )
        assert einwilligung["nachweis"]["umfang"]["text_version"] == VERWALTUNG_SEITE
        assert (view.zustand, view.laufende_fassung) == ("bestaetigt", VERWALTUNG_SEITE)

    def test_a_link_answering_a_mixed_pair_shows_and_takes_one_page(self, mongo_replica_set_url: str):
        """A Trainer the applicant named, holding a seat the league filled: one page for both.

        Stored directly: no route makes this pair on an application today, and the judge must not rely on that.
        """

        seeded = bewerbung_document(kontakte=kontakte(trainer_ist_zugleich="ansprechperson"))
        for slot, von in (("trainer", "bewerbung"), ("ansprechperson", "liga")):
            seeded["kontakte"][slot]["einwilligung"] = {**seeded["kontakte"][slot]["einwilligung"], "eingetragen_von": von}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            view = await ansicht(database, RAW["trainer"])
            with pytest.raises(WriteRefusalException) as conflict:
                await answer(database, client, RAW["trainer"], text_version=BEWERBER_SEITE)
            await answer(database, client, RAW["trainer"], text_version=view.laufende_fassung)

            return view, conflict.value, await stored(database)

        view, refusal, document = on_a_league(mongo_replica_set_url, body, documents=[seeded])

        assert view.laufende_fassung == VERWALTUNG_SEITE
        assert (refusal.error_code, refusal.status_code) == (FASSUNG_UNZULAESSIG, 409)
        for slot in ("trainer", "ansprechperson"):
            einwilligung = document["kontakte"][slot]["einwilligung"]
            assert (einwilligung["bestaetigt_am"], einwilligung["text_version"]) == (TODAY, VERWALTUNG_SEITE)

    def test_a_decline_names_no_label_and_is_judged_against_none(self, mongo_replica_set_url: str):
        """A Widerspruch stores no record, so the label it carries is never stored and never refused."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(
                database, client, RAW["trainer"], antwort="abgelehnt", geburtsdatum=None, whatsapp=False, text_version="nicht-registriert"
            )

            return await stored(database)

        assert on_a_league(mongo_replica_set_url, body)["kontakte"]["trainer"] is None


class TestTheMediaConsent:
    """A seat's own media consent, asked on its confirmation page as on a pupil's and a referee's (`REQ-EINWILLIGUNG-002`)."""

    def test_the_view_answers_the_age_the_switch_is_offered_from(self, mongo_replica_set_url: str):
        response = on_a_league(mongo_replica_set_url, lambda database, _: ansicht(database, RAW["trainer"]))

        assert response.medien_mindestalter == MEDIEN_MIN_AGE_YEARS

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
            with pytest.raises(WriteRefusalException) as refused:
                await answer(database, client, RAW["trainer"], geburtsdatum=A_SEVENTEEN_YEAR_OLDS_BIRTHDATE, medien=True)

            return refused.value, await stored(database), await log_rows(database)

        refusal, document, rows = on_a_league(mongo_replica_set_url, body)

        assert (refusal.error_code, refusal.status_code) == (SELBST_MEDIEN_ALTER, 422)
        assert document == bewerbung_document()
        assert rows == []

    def test_the_same_trainer_confirming_without_it_is_taken(self, mongo_replica_set_url: str):
        """The control: the refusal above is the media switch's alone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW["trainer"], geburtsdatum=A_SEVENTEEN_YEAR_OLDS_BIRTHDATE, medien=False)

            return await stored(database)

        einwilligung = on_a_league(mongo_replica_set_url, body)["kontakte"]["trainer"]["einwilligung"]

        assert (einwilligung["bestaetigt_am"], einwilligung["medien"]) == (TODAY, False)


class TestTheLinkIsSpentByTheStamp:
    def test_a_second_answer_on_the_same_link_is_refused_and_the_reopened_link_shows_confirmed(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW["trainer"])

            with pytest.raises(WriteRefusalException) as conflict:
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
            with pytest.raises(WriteRefusalException) as conflict:
                await answer(database, client, RAW["trainer"], geburtsdatum=A_CHILDS_BIRTHDATE)

            return conflict.value.error_code, await ansicht(database, RAW["trainer"]), await stored(database), await log_rows(database)

        code, view, document, rows = on_a_league(mongo_replica_set_url, body)

        assert code == BEWERBUNG_KONTAKT_ALTER
        assert view.zustand == "gueltig"
        assert document == bewerbung_document()
        assert rows == []

    def test_the_seat_that_signs_for_the_school_is_refused_a_day_short_of_eighteen_and_nothing_is_written(self, mongo_replica_set_url: str):
        """The same date the Trainer's link takes: a floor judged for the application rather than the seat admits this person."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(WriteRefusalException) as conflict:
                await answer(database, client, RAW["ansprechperson"], geburtsdatum=A_SEVENTEEN_YEAR_OLDS_BIRTHDATE)

            return conflict.value.error_code, conflict.value.error_detail["message"], await stored(database), await log_rows(database)

        code, message, document, rows = on_a_league(mongo_replica_set_url, body)

        assert code == BEWERBUNG_KONTAKT_ALTER
        # The person reads this sentence, so the Trainer's lower floor here would tell them the date they typed was fine.
        assert str(SEAT_MIN_AGE_YEARS["ansprechperson"]) in message and str(SEAT_MIN_AGE_YEARS["trainer"]) not in message
        assert document == bewerbung_document()
        assert rows == []

    def test_the_trainer_seat_takes_that_same_date(self, mongo_replica_set_url: str):
        """The other half of the pair: without it the case above passes for a floor raised on all three seats."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await answer(database, client, RAW["trainer"], geburtsdatum=A_SEVENTEEN_YEAR_OLDS_BIRTHDATE)

            return response, await stored(database)

        response, document = on_a_league(mongo_replica_set_url, body)

        assert response.ergebnis == "bestaetigt"
        assert document["kontakte"]["trainer"]["geburtsdatum"] == A_SEVENTEEN_YEAR_OLDS_BIRTHDATE

    def test_a_link_past_its_deadline_is_refused_before_the_seat_is_judged(self, mongo_replica_set_url: str):
        expired = bewerbung_document(bestaetigungsfrist=YESTERDAY)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            with pytest.raises(WriteRefusalException) as conflict:
                await answer(database, client, RAW["trainer"])

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body, documents=[expired]) == BEWERBUNG_TOKEN_PAST_DEADLINE

    def test_a_resend_of_one_seat_reopens_every_other_seats_link_past_the_deadline(self, mongo_replica_set_url: str):
        """Why `REQ-BEWERBUNG-017` is a 409 and not a spent link: the deadline is the application's one field, and a re-send restarts it."""

        expired = bewerbung_document(bestaetigungsfrist=YESTERDAY)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(WriteRefusalException) as refused:
                await answer(database, client, RAW["stellvertretung"])
            await resend(database, "ansprechperson")
            answered = await answer(database, client, RAW["stellvertretung"])

            return refused.value.error_code, answered.ergebnis

        assert on_a_league(mongo_replica_set_url, body, documents=[expired]) == (BEWERBUNG_TOKEN_PAST_DEADLINE, "bestaetigt")

    def test_a_decided_application_refuses_every_link_as_spent(self, mongo_replica_set_url: str):
        """`REQ-BEWERBUNG-010`: nothing sets `status` back to `eingereicht`, and a decided application takes no re-send."""

        decided = bewerbung_document(status="abgelehnt")

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            with pytest.raises(WriteRefusalException) as refused:
                await answer(database, client, RAW["trainer"])

            return refused.value.error_code

        assert on_a_league(mongo_replica_set_url, body, documents=[decided]) == BEWERBUNG_TOKEN_DECIDED


class TestADecline:
    """The person's slot is emptied and the log redacted in ONE transaction, as an erasure does: a person who refuses is not held."""

    def test_the_slot_is_emptied_the_day_recorded_beside_it_and_the_seat_still_outstanding(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await answer(database, client, RAW["stellvertretung"], antwort="abgelehnt", geburtsdatum=None, whatsapp=False)

            return response, await stored(database), await ansicht(database, RAW["stellvertretung"])

        response, document, view = on_a_league(mongo_replica_set_url, body)

        assert document["kontakte"]["stellvertretung"] is None
        assert document["bestaetigungen"]["stellvertretung"]["abgelehnt_am"] == TODAY
        assert (response.ergebnis, response.geburtsdatum, response.medien) == ("abgelehnt", None, False)
        assert response.ausstehend == list(KONTAKT_ROLLEN)
        assert (view.zustand, view.vorname, view.text_version) == ("abgelehnt", None, None)

    def test_every_log_image_holding_the_person_is_emptied_and_stamped(self, mongo_replica_set_url: str):
        """The clearing patch files the pre-image, so the redaction has to reach the row it just wrote."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await answer(database, client, RAW["stellvertretung"], antwort="abgelehnt", geburtsdatum=None, whatsapp=False)

            return await log_rows(database)

        rows = on_a_league(mongo_replica_set_url, body)

        assert len(rows) == 1
        assert (rows[0]["before"], rows[0]["redacted_at"]) == (None, REDACTED_AT)

    def test_a_declined_seat_takes_no_second_answer(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            await answer(database, client, RAW["stellvertretung"], antwort="abgelehnt", geburtsdatum=None, whatsapp=False)

            with pytest.raises(WriteRefusalException) as conflict:
                await answer(database, client, RAW["stellvertretung"])

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body) == BEWERBUNG_SEAT_ALREADY_ANSWERED


class TestWhatTheAnswerHandsTheMailer:
    """The five fields the frontend server composes its two messages from, none of which reaches a browser."""

    def test_a_confirmation_names_the_season_the_seat_the_person_the_deadline_and_the_mailbox(self, mongo_replica_set_url: str):
        response = on_a_league(mongo_replica_set_url, lambda database, client: answer(database, client, RAW["stellvertretung"]))

        assert (response.saison_id, response.rolle, response.vorname) == (SAISON_ID, "stellvertretung", "Bramblewick")
        assert response.bestaetigungsfrist == "2026-04-03"
        assert (response.ansprechperson_email, response.ansprechperson_rollen) == ("quillhilde@example.com", ["ansprechperson"])

    def test_one_mailbox_holding_two_seats_is_answered_with_both(self, mongo_replica_set_url: str):
        """`rollenText` is the mailbox's, not the seat's: told one seat, a person holding two reads a message about somebody else."""

        double = bewerbung_document(kontakte=kontakte(trainer_ist_zugleich="ansprechperson"))

        response = on_a_league(
            mongo_replica_set_url, lambda database, client: answer(database, client, RAW["stellvertretung"]), documents=[double]
        )

        assert response.ansprechperson_rollen == ["trainer", "ansprechperson"]

    def test_the_ansprechpersons_own_decline_leaves_no_mailbox_and_still_names_who_declined(self, mongo_replica_set_url: str):
        """The two halves this response exists for: the seat it would address is the seat that just emptied itself."""

        response = on_a_league(
            mongo_replica_set_url,
            lambda database, client: answer(database, client, RAW["ansprechperson"], antwort="abgelehnt", geburtsdatum=None, whatsapp=False),
        )

        assert (response.ansprechperson_email, response.ansprechperson_rollen) == (None, [])
        # Off the pre-image: the clearing update ran before this was read, so a re-read would answer nobody.
        assert (response.rolle, response.vorname) == ("ansprechperson", "Quillhilde")

    def test_another_seats_decline_still_reaches_the_ansprechperson(self, mongo_replica_set_url: str):
        response = on_a_league(
            mongo_replica_set_url,
            lambda database, client: answer(database, client, RAW["stellvertretung"], antwort="abgelehnt", geburtsdatum=None, whatsapp=False),
        )

        assert (response.ansprechperson_email, response.vorname) == ("quillhilde@example.com", "Bramblewick")

    def test_no_other_seats_address_travels(self, mongo_replica_set_url: str):
        """One mailbox and no more: this response is the mailer's, and a second address is one nothing here would send to."""

        rendered = on_a_league(mongo_replica_set_url, lambda database, client: answer(database, client, RAW["trainer"])).model_dump_json()

        assert kontakte()["stellvertretung"]["email"] not in rendered and kontakte()["trainer"]["email"] not in rendered
        assert NACHNAME not in rendered and TELEFON not in rendered


class TestNoHashReachesAnAdminRead:
    """The plan's evidence line: the projection keeps the hash off the wire where the model alone would drop it after."""

    def test_neither_admin_read_serves_a_hash_while_the_document_holds_four(self, mongo_replica_set_url: str):
        # A reminded seat holds the first mail's hash beside the fresh one, and both open the link:
        # a fixture without one leaves the second field untested on both reads.
        erinnert_hash = hash_token("the-first-link-this-seat-was-mailed")
        reminded = bewerbung_document()
        reminded["bestaetigungen"]["trainer"] |= {"token_hash_zuvor": erinnert_hash, "erinnert_am": TODAY}

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            one = await get_bewerbung_by_id(
                bewerbung_id=BEWERBUNG_OID,
                bewerbungen_collection=database[Collection.BEWERBUNGEN],
                sperrliste=ban_list(database),
            )
            many = await get_bewerbungen(
                bewerbungen_collection=database[Collection.BEWERBUNGEN],
                sperrliste=ban_list(database),
                filters=FLBewerbungenFilterParams(),
            )

            return one.model_dump_json(), many.model_dump_json(), await stored(database)

        one, many, document = on_a_league(mongo_replica_set_url, body, documents=[reminded])

        assert all(document["bestaetigungen"][seat]["token_hash"] == HASHES[seat] for seat in KONTAKT_ROLLEN)
        assert document["bestaetigungen"]["trainer"]["token_hash_zuvor"] == erinnert_hash
        for rendered in (one, many):
            assert "token_hash" not in rendered
            assert not any(token_hash in rendered for token_hash in (*HASHES.values(), erinnert_hash))
            # The rest of the block still reaches the triage, which renders the per-seat facts off it.
            assert "verschickt_am" in rendered


class TestAResend:
    def test_a_fresh_link_voids_the_old_and_restarts_the_deadline(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await resend(database, "trainer")

            with pytest.raises(WriteRefusalException) as conflict:
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

            with pytest.raises(WriteRefusalException) as conflict:
                await resend(database, "trainer")

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body) == BEWERBUNG_SEAT_ALREADY_ANSWERED

    def test_a_decided_application_gets_no_new_link(self, mongo_replica_set_url: str):
        decided = bewerbung_document(status="abgelehnt", entscheidung={"getroffen_am": YESTERDAY, "von": "admin", "grund": "kein Platz"})

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> str:
            with pytest.raises(WriteRefusalException) as conflict:
                await resend(database, "trainer")

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body, documents=[decided]) == BEWERBUNG_ALREADY_DECIDED

    def test_an_application_stored_before_the_flow_has_no_seat_to_resend(self, mongo_replica_set_url: str):
        before_the_flow = bewerbung_document()
        del before_the_flow["bestaetigungen"]
        del before_the_flow["bestaetigungsfrist"]

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> str:
            with pytest.raises(WriteRefusalException) as conflict:
                await resend(database, "trainer")

            return conflict.value.error_code

        assert on_a_league(mongo_replica_set_url, body, documents=[before_the_flow]) == BEWERBUNG_SEAT_ALREADY_ANSWERED

    def test_a_path_naming_no_seat_is_a_miss(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentNotFoundException):
                await resend(database, "trainer_ist_zugleich")

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
    invalidate_saison_cache()
    await database[Collection.SPERRLISTE].insert_one(ban_document(address, bis=bis))


def decline(database: AsyncDatabase, client: AsyncMongoClient, seat: str) -> Any:
    return answer(database, client, RAW[seat], antwort="abgelehnt", geburtsdatum=None, whatsapp=False)


class TestALinkToABarredAddress:
    """`REQ-BEWERBUNG-020`: a ban reaches a link already in somebody's inbox, the seeded ones all minted before it."""

    def test_a_consent_is_refused_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, address_of("stellvertretung"))

            with pytest.raises(WriteRefusalException) as refused:
                await answer(database, client, RAW["stellvertretung"])

            return refused.value, await stored(database), await log_rows(database)

        refused, document, rows = on_a_league(mongo_replica_set_url, body)

        assert (refused.error_code, refused.status_code) == (BEWERBUNG_EINWILLIGUNG_GESPERRT, 403)
        assert document == bewerbung_document()
        assert rows == []

    def test_a_decline_is_still_taken(self, mongo_replica_set_url: str):
        """A barred person asking to be removed is never refused: the decline empties the seat and redacts the log as an erasure does."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, address_of("stellvertretung"))

            return await decline(database, client, "stellvertretung"), await stored(database)

        response, document = on_a_league(mongo_replica_set_url, body)

        assert response.ergebnis == "abgelehnt"
        assert document["kontakte"]["stellvertretung"] is None

    def test_a_ban_on_another_seats_address_leaves_this_link_answering(self, mongo_replica_set_url: str):
        """The other half of the pair: without it the first case passes for a check refusing every consent."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, address_of("trainer"))

            return await answer(database, client, RAW["stellvertretung"])

        assert on_a_league(mongo_replica_set_url, body).ergebnis == "bestaetigt"

    def test_the_link_answers_again_once_the_ban_is_lifted(self, mongo_replica_set_url: str):
        """Nothing of the ban is written on the seat, so lifting it is all a mistaken ban needs undone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, address_of("stellvertretung"))
            with pytest.raises(WriteRefusalException):
                await answer(database, client, RAW["stellvertretung"])
            await database[Collection.SPERRLISTE].delete_many({})

            return await answer(database, client, RAW["stellvertretung"])

        assert on_a_league(mongo_replica_set_url, body).ergebnis == "bestaetigt"

    def test_a_ban_past_its_last_season_bars_nothing(self, mongo_replica_set_url: str):
        """The running season is what the bound is read against: asked without it, the lapsed row would still bar."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban_under_a_running_season(database, address_of("stellvertretung"), bis=LAPSED)

            return await answer(database, client, RAW["stellvertretung"])

        assert on_a_league(mongo_replica_set_url, body).ergebnis == "bestaetigt"

    def test_a_standing_ban_still_bars_while_a_season_runs(self, mongo_replica_set_url: str):
        """The other half of the case above: without it, that case passes for a check asking nothing once a season runs."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            await ban_under_a_running_season(database, address_of("stellvertretung"), bis=STANDING)

            with pytest.raises(WriteRefusalException) as refused:
                await answer(database, client, RAW["stellvertretung"])

            return refused.value.error_code

        assert on_a_league(mongo_replica_set_url, body) == BEWERBUNG_EINWILLIGUNG_GESPERRT

    def test_a_pair_is_refused_on_either_seats_address(self, mongo_replica_set_url: str):
        """One press writes both seats, so each address it would confirm is asked: only a hand edit parts a pair's two."""

        paired = bewerbung_document(kontakte=kontakte(trainer_ist_zugleich="ansprechperson"))
        paired["kontakte"]["trainer"]["email"] = "wraxlington.trainer@example.com"

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, address_of("trainer", paired))

            with pytest.raises(WriteRefusalException) as refused:
                await answer(database, client, RAW["ansprechperson"])

            return refused.value.error_code

        assert on_a_league(mongo_replica_set_url, body, documents=[paired]) == BEWERBUNG_EINWILLIGUNG_GESPERRT

    def test_an_answered_seat_answers_the_stamp_rather_than_the_ban(self, mongo_replica_set_url: str):
        """The order: the answer given before the ban stands until an administrator acts, so a second press is refused as answered."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            await answer(database, client, RAW["stellvertretung"])
            await ban(database, address_of("stellvertretung"))

            with pytest.raises(WriteRefusalException) as refused:
                await answer(database, client, RAW["stellvertretung"])

            return refused.value.error_code

        assert on_a_league(mongo_replica_set_url, body) == BEWERBUNG_SEAT_ALREADY_ANSWERED

    def test_a_barred_consent_carrying_a_refused_date_answers_the_ban_rather_than_the_age(self, mongo_replica_set_url: str):
        """The other half of the order: a corrected date buys a barred address nothing, so it is not what the person is asked for."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            await ban(database, address_of("stellvertretung"))

            with pytest.raises(WriteRefusalException) as refused:
                await answer(database, client, RAW["stellvertretung"], geburtsdatum=A_CHILDS_BIRTHDATE)

            return refused.value.error_code

        assert on_a_league(mongo_replica_set_url, body) == BEWERBUNG_EINWILLIGUNG_GESPERRT


class TestTheViewOfALinkToABarredAddress:
    """`docs/backend/spec.md :: I515`: the page reads the ban off the view, so it never offers a barred person the form."""

    def test_the_view_answers_gesperrt(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> str:
            await ban(database, address_of("stellvertretung"))

            return (await ansicht(database, RAW["stellvertretung"])).zustand

        assert on_a_league(mongo_replica_set_url, body) == "gesperrt"

    def test_a_ban_on_another_seats_address_leaves_this_view_open(self, mongo_replica_set_url: str):
        """The other half of the pair: without it the case above passes for a view answering `gesperrt` to everyone."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> str:
            await ban(database, address_of("trainer"))

            return (await ansicht(database, RAW["stellvertretung"])).zustand

        assert on_a_league(mongo_replica_set_url, body) == "gueltig"

    def test_the_view_opens_again_once_the_ban_is_lifted(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[str, str]:
            await ban(database, address_of("stellvertretung"))
            barred = (await ansicht(database, RAW["stellvertretung"])).zustand
            await database[Collection.SPERRLISTE].delete_many({})

            return barred, (await ansicht(database, RAW["stellvertretung"])).zustand

        assert on_a_league(mongo_replica_set_url, body) == ("gesperrt", "gueltig")

    @pytest.mark.parametrize(
        ("bis", "zustand"), [pytest.param(STANDING, "gesperrt", id="standing, the control"), pytest.param(LAPSED, "gueltig", id="lapsed")]
    )
    def test_a_ban_is_read_against_the_running_season(self, mongo_replica_set_url: str, bis: str, zustand: str):
        """Read as the press reads it: asked without the season, the lapsed row would bar the view alone."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> str:
            await ban_under_a_running_season(database, address_of("stellvertretung"), bis=bis)

            return (await ansicht(database, RAW["stellvertretung"])).zustand

        assert on_a_league(mongo_replica_set_url, body) == zustand

    def test_a_pairs_view_is_barred_on_either_seats_address(self, mongo_replica_set_url: str):
        """The addresses the press asks, and no fewer: a view asking its own seat alone would offer a form the press refuses."""

        paired = bewerbung_document(kontakte=kontakte(trainer_ist_zugleich="ansprechperson"))
        paired["kontakte"]["trainer"]["email"] = "wraxlington.trainer@example.com"

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> str:
            await ban(database, address_of("trainer", paired))

            return (await ansicht(database, RAW["ansprechperson"])).zustand

        assert on_a_league(mongo_replica_set_url, body, documents=[paired]) == "gesperrt"

    def test_an_answered_seat_reopened_after_the_ban_shows_the_ban(self, mongo_replica_set_url: str):
        """The ban outranks the stamp here, where the press ranks it below: the page shows a barred person nothing else."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            await answer(database, client, RAW["stellvertretung"])
            await ban(database, address_of("stellvertretung"))

            return (await ansicht(database, RAW["stellvertretung"])).zustand

        assert on_a_league(mongo_replica_set_url, body) == "gesperrt"
