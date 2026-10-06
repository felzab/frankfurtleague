import asyncio
import functools
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import pytest
from bson import ObjectId
from fastapi import FastAPI
from fastapi.testclient import TestClient
from httpx2 import Response
from pymongo.asynchronous.database import AsyncDatabase

from app.api.identitaet.router import get_subjekt
from app.api.identitaet.schemas import FLSubjektPayload, FLSubjektResponse
from app.api.identitaet.services import build_referee_pipeline, build_seat_pipeline
from app.api.teams.schemas import KONTAKT_ROLLEN
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.security import MISSING_TOKEN, WRONG_SYSTEM_KEY
from app.main import create_app
from app.shared.folding import league_address, sign_in_identifier
from tests.app_client import app_client
from tests.bans import ban_list
from tests.config import BASE_AUTH, SYSTEM_AUTH
from tests.core.app_source import application
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import EINWILLIGUNG, ban_document, rules_document, saison_document, saison_team_document, spieler_document, team_document
from tests.records import record_collections
from tests.worker import worker_database

from .conftest import config_for

DATABASE_NAME = worker_database("fl_identitaet_subjekt_test")

PATH = f"/api/v{API_VERSION}/identitaet/subjekt"

# The folded form a caller sends, and the spellings the league stores it under. Deliberately
# unusual, so a hit in a seeded corpus cannot be a coincidence.
IDENTIFIER = "ortrud.zwiebelmayer@schule.de"
SEAT_STORED = "Ortrud.Zwiebelmayer@Schule.de"
SEAT_STORED_UPPER = "ORTRUD.ZWIEBELMAYER@schule.de"
SEAT_STORED_DOMAIN = "ortrud.zwiebelmayer@SCHULE.de"
PUPIL_STORED = "ortrud.zwiebelmayer@schule.de"
REFEREE_STORED = "ORTRUD.ZWIEBELMAYER@schule.de"
REFEREE_STORED_MIXED = "Ortrud.Zwiebelmayer@schule.de"

# A spelling the database's case-blind match takes and the fold parts from the asker: a row edited by
# hand past the address rule, its local part holding a long s the match reads as „s“.
PARTED_ASKED = "ortrud.schmidt@schule.de"
HAND_EDITED_STORED = f"ortrud.{chr(0x17F)}chmidt@schule.de"

# The „ß“ decision, never a `casefold`: IDNA 2008 keeps „ß“ in a domain, so these are two mailboxes,
# each holding a seat. The sharp-s one is stored in punycode, as a payload stores it.
SHARP_S_ASKED = "Post@straße.de"
SHARP_S_STORED = "Post@xn--strae-oqa.de"
DOUBLE_S_ASKED = "post@strasse.de"
DOUBLE_S_STORED = "Post@strasse.de"

# Nobody this identifier may reach, in each of the three collections.
BYSTANDER = "baldur.krautzberger@example.com"

# A mailbox whose every record awaits its own person's confirmation, and one whose every record is
# confirmed on a row that has since been retired.
UNCONFIRMED = "ottilie.wartezeit@schule.de"
RETIRED = "rudolf.ruhestand@schule.de"

# A banned address holding a confirmed seat, stored and banned in one spelling and asked in another,
# and an address whose ban ended with the season before the running one.
GESPERRT_STORED = "Gerda.Gesperrt@Schule.de"
GESPERRT_ASKED = "GERDA.GESPERRT@schule.de"
ABGELAUFEN = "arno.abgelaufen@schule.de"
BAN_ACTIVE_OID = ObjectId("6890a1b2c3d4e5f607820041")
BAN_LAPSED_OID = ObjectId("6890a1b2c3d4e5f607820042")

# The grants, stored folded as every grant is, and one asked in capitals.
VERWALTUNG_INHABER = "inhaberin@frankfurtleague.de"
VERWALTUNG_STORED = "verena.verwaltung@schule.de"
VERWALTUNG_ASKED = "Verena.Verwaltung@SCHULE.de"
GRANT_INHABER_OID = ObjectId("6890a1b2c3d4e5f607820051")
GRANT_STORED_OID = ObjectId("6890a1b2c3d4e5f607820052")

# One mailbox at an internationalised domain, stored as every payload stores it
# (`docs/backend/spec.md :: I332`): the domain in punycode, and folded too on a pupil's row.
# Asked in punycode, the only form the sign-in library hands over.
IDN_ASKED = "anna@xn--mller-kva.de"
IDN_SEAT_STORED = "Anna@xn--mller-kva.de"
IDN_PUPIL_STORED = "anna@xn--mller-kva.de"

PAST_SAISON = "2425"
ACTIVE_SAISON = "2526"
FUTURE_SAISON = "2627"

# Fixed rather than generated, so a failure names the same row every run. Ordered so the answer's
# own sort is asserted rather than reproduced: A before B before C.
TEAM_A_OID = ObjectId("6890a1b2c3d4e5f607820001")
TEAM_B_OID = ObjectId("6890a1b2c3d4e5f607820002")
TEAM_C_OID = ObjectId("6890a1b2c3d4e5f607820003")
SEAT_ROW_A_OID = ObjectId("6890a1b2c3d4e5f607820011")
SEAT_ROW_B_OID = ObjectId("6890a1b2c3d4e5f607820012")
BYSTANDER_ROW_OID = ObjectId("6890a1b2c3d4e5f607820013")
SHARP_S_ROW_OID = ObjectId("6890a1b2c3d4e5f607820014")
DOUBLE_S_ROW_OID = ObjectId("6890a1b2c3d4e5f607820015")
HAND_EDITED_ROW_OID = ObjectId("6890a1b2c3d4e5f607820016")
IDN_ROW_OID = ObjectId("6890a1b2c3d4e5f607820017")
PUPIL_ONE_OID = ObjectId("6890a1b2c3d4e5f607820021")
IDN_PUPIL_OID = ObjectId("6890a1b2c3d4e5f607820023")
RETIRED_PUPIL_OID = ObjectId("6890a1b2c3d4e5f607820024")
BYSTANDER_PUPIL_OID = ObjectId("6890a1b2c3d4e5f607820029")
REFEREE_ONE_OID = ObjectId("6890a1b2c3d4e5f607820031")
REFEREE_TWO_OID = ObjectId("6890a1b2c3d4e5f607820032")
HAND_EDITED_REFEREE_OID = ObjectId("6890a1b2c3d4e5f607820033")
IDN_REFEREE_OID = ObjectId("6890a1b2c3d4e5f607820034")
UNCONFIRMED_REFEREE_OID = ObjectId("6890a1b2c3d4e5f607820035")
RETIRED_REFEREE_OID = ObjectId("6890a1b2c3d4e5f607820036")
BYSTANDER_REFEREE_OID = ObjectId("6890a1b2c3d4e5f607820039")

# The name the junction row was entered under, and the one the club has taken since. They differ so
# that serving the club's own would be observable (`docs/backend/spec.md :: I13`).
ROW_NAME_A = "Helmholtz"
CLUB_NAME_A_NOW = "Helmholtz-Gymnasium"
ROW_NAME_B = "Lessing"

STAMP = "2026-01-20"

KENNTNISNAHME: dict[str, Any] = {"umfang": "kontaktdaten", "erfasst_von": "person", "text_version": "v1", "datum": "2026-01-05"}


def _person(email: str, *, bestaetigt_am: str | None = STAMP) -> dict[str, Any]:
    """Every field `app/core/constraints.py :: _KONTAKTPERSON` requires, the address and the stamp the only ones a case reads.

    Stamped by default: the lookup answers a seat only once its own person has confirmed it.
    """

    return {
        "vorname": "Anna",
        "nachname": "Müller",
        "email": email,
        "telefon": "+49 69 5550101",
        "einwilligung": {**KENNTNISNAHME, "bestaetigt_am": bestaetigt_am},
    }


def _junction(row_id: ObjectId, saison_id: str, team_id: ObjectId, *, name: str, **slots: str | dict[str, Any]) -> dict[str, Any]:
    """A `saison_teams` row seating whoever the caller names, an address as a confirmed seat, the slots it does not name left empty."""

    return saison_team_document(
        saison_id,
        team_id,
        name,
        name[:2].upper(),
        _id=row_id,
        kontakte={
            **{slot: None for slot in KONTAKT_ROLLEN},
            **{slot: _person(seat) if isinstance(seat, str) else seat for slot, seat in slots.items()},
            # A declaration about two slots rather than a slot of its own, so it names nobody and
            # no case here turns on it (`app/api/teams/schemas.py :: KONTAKT_ROLLEN`).
            "trainer_ist_zugleich": None,
        },
    )


def _saison(saison_id: str, status: str) -> dict[str, Any]:
    return saison_document(
        saison_id,
        status,
        start_date=f"20{saison_id[:2]}-08-01",
        end_date=f"20{saison_id[2:]}-06-30",
        rules=rules_document(erlaubte_stufen=["Q1", "Q2"]),
    )


def _club(team_id: ObjectId, name: str, shorthand: str) -> dict[str, Any]:
    # `shorthand` per club rather than one for all: `app/core/constraints.py :: uniq_shorthand`
    # indexes it, so a seed sharing one refuses its second club and fails every case here.
    return team_document(team_id, name, shorthand, website_url=None)


def _pupil(pupil_id: ObjectId, email: str) -> dict[str, Any]:
    """`email` stored in the folded form, which is what S6's admission writes and what the join compares."""

    return spieler_document(pupil_id, "Anna", "Müller", email=email)


def _referee(referee_id: ObjectId, email: str, name: str, **fields: Any) -> dict[str, Any]:
    # A name per referee for `_club`'s reason: `app/core/constraints.py :: uniq_schiedsrichter_name`
    # indexes it. Confirmed unless the caller says otherwise, as `_person` is.
    return {
        "_id": referee_id,
        "name": name,
        "schule": None,
        "default_payment": 20,
        "kontakt": {"telefon": "+49 69 5550202", "email": email},
        "inactive_since": None,
        "einwilligung": {**EINWILLIGUNG, "bestaetigt_am": STAMP},
        **fields,
    }


Body = Callable[[AsyncDatabase], Awaitable[Any]]


async def _seed(database: AsyncDatabase) -> None:
    """One corpus for every case: the mailbox in all three collections twice over, a bystander beside each, and the refused spellings.

    Beside them, one mailbox whose records are all unconfirmed and one whose rows are all retired.
    """

    await database[Collection.SAISONS].insert_many(
        [_saison(PAST_SAISON, "past"), _saison(ACTIVE_SAISON, "active"), _saison(FUTURE_SAISON, "future")]
    )
    await database[Collection.TEAMS].insert_many(
        [_club(TEAM_A_OID, CLUB_NAME_A_NOW, "HE"), _club(TEAM_B_OID, ROW_NAME_B, "LE"), _club(TEAM_C_OID, "Krautzberg", "KR")]
    )
    await database[Collection.SAISON_TEAMS].insert_many(
        [
            _junction(SEAT_ROW_A_OID, PAST_SAISON, TEAM_A_OID, name=ROW_NAME_A, trainer=SEAT_STORED),
            # One address in TWO person slots of one row, which is what a person entered twice is.
            _junction(
                SEAT_ROW_B_OID,
                ACTIVE_SAISON,
                TEAM_B_OID,
                name=ROW_NAME_B,
                trainer=SEAT_STORED_UPPER,
                ansprechperson=SEAT_STORED_DOMAIN,
            ),
            _junction(
                BYSTANDER_ROW_OID,
                ACTIVE_SAISON,
                TEAM_C_OID,
                name="Krautzberg",
                trainer=BYSTANDER,
                ansprechperson=_person(UNCONFIRMED, bestaetigt_am=None),
                stellvertretung=GESPERRT_STORED,
            ),
            _junction(SHARP_S_ROW_OID, FUTURE_SAISON, TEAM_A_OID, name=ROW_NAME_A, trainer=SHARP_S_STORED),
            _junction(DOUBLE_S_ROW_OID, FUTURE_SAISON, TEAM_B_OID, name=ROW_NAME_B, trainer=DOUBLE_S_STORED),
            _junction(HAND_EDITED_ROW_OID, FUTURE_SAISON, TEAM_C_OID, name="Krautzberg", trainer=HAND_EDITED_STORED),
            _junction(IDN_ROW_OID, PAST_SAISON, TEAM_C_OID, name="Krautzberg", trainer=IDN_SEAT_STORED),
        ]
    )
    await database[Collection.SPIELER].insert_many(
        [
            _pupil(PUPIL_ONE_OID, PUPIL_STORED),
            _pupil(IDN_PUPIL_OID, IDN_PUPIL_STORED),
            _pupil(BYSTANDER_PUPIL_OID, BYSTANDER),
            {**_pupil(RETIRED_PUPIL_OID, RETIRED), "inactive_since": "2026-03-01"},
        ]
    )
    await database[Collection.SCHIEDSRICHTER].insert_many(
        [
            _referee(REFEREE_ONE_OID, REFEREE_STORED, "A. Referee"),
            _referee(REFEREE_TWO_OID, REFEREE_STORED_MIXED, "C. Zweitpfeife"),
            _referee(HAND_EDITED_REFEREE_OID, HAND_EDITED_STORED, "D. Umlaut"),
            _referee(IDN_REFEREE_OID, IDN_SEAT_STORED, "E. Umlaut"),
            _referee(BYSTANDER_REFEREE_OID, BYSTANDER, "B. Krautzberger"),
            _referee(UNCONFIRMED_REFEREE_OID, UNCONFIRMED, "F. Wartezeit", einwilligung=None),
            _referee(RETIRED_REFEREE_OID, RETIRED, "G. Ruhestand", inactive_since="2026-03-01"),
        ]
    )
    await database[Collection.SPERRLISTE].insert_many(
        [
            ban_document(GESPERRT_STORED, bis=FUTURE_SAISON, _id=BAN_ACTIVE_OID),
            ban_document(ABGELAUFEN, bis=PAST_SAISON, _id=BAN_LAPSED_OID),
        ]
    )
    grants = [
        _grant(GRANT_INHABER_OID, VERWALTUNG_INHABER, "owner") | {"gefunden_am": GRANT_FOUND},
        _grant(GRANT_STORED_OID, VERWALTUNG_STORED, "administration"),
    ]
    await database[Collection.BERECHTIGUNGEN].insert_many(grants)
    # Both announced: the `owner` grant found by the reconciliation, the other made by the grant route.
    await database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT].insert_many(
        [
            {"_id": grant["_id"], "adresse": grant["adresse"], "verwaltung": grant["verwaltung"], "angekuendigt_am": GRANT_FOUND}
            for grant in grants
        ]
    )


# A paste's typed date, and the later moment the reconciliation found it: the `owner` grant's row carries both.
GRANT_TYPED = datetime(2026, 1, 1, tzinfo=UTC)
GRANT_FOUND = datetime(2026, 1, 2, 8, 30, tzinfo=UTC)
GRANT_PROMOTED = datetime(2026, 2, 1, 9, 0, tzinfo=UTC)


def _grant(grant_id: ObjectId, adresse: str, verwaltung: str) -> dict[str, Any]:
    """A grant as the Playground or the grant route stores one: the folded identifier and its tier."""

    return {"_id": grant_id, "adresse": adresse, "verwaltung": verwaltung, "erteilt_von": "PLAYGROUND", "erteilt_am": GRANT_TYPED}


def on_a_league(url: str, body: Body) -> Any:
    """The REAL validators, so a seeded row this read has to answer is one the shipped schema admits."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
            await _seed(database)

            return await body(database)

    return on_the_seed_loop(_run())


async def _no_body(_: AsyncDatabase) -> None:
    """For a caller that wants the corpus and nothing else: the request below runs on a loop of its own."""

    return None


async def call_subjekt(database: AsyncDatabase, email: str) -> FLSubjektResponse:
    return await get_subjekt(
        subjekt_data=FLSubjektPayload(email=email),
        records=record_collections(database),
        sperrliste=ban_list(database),
        berechtigungen_collection=database[Collection.BERECHTIGUNGEN],
    )


def answered(url: str, email: str = IDENTIFIER) -> FLSubjektResponse:
    return on_a_league(url, lambda database: call_subjekt(database, email))


@pytest.mark.db
def test_one_mailbox_answers_all_three_kinds_at_once(mongo_replica_set_url: str):
    """The seat and the referee are stored in spellings other than the identifier's, the pupil in the folded form `spieler.email` holds.

    Split in three, a lookup answering only the collection a case names would pass all three.
    """

    answer = answered(mongo_replica_set_url)

    assert (bool(answer.sitze), bool(answer.spieler), bool(answer.schiedsrichter)) == (True, True, True)


@pytest.mark.db
def test_every_seat_the_mailbox_holds_is_answered_once_each(mongo_replica_set_url: str):
    """Two clubs and two slots of one row, in the read's own order.

    Kills a first-match lookup, a de-duplication that folds one person's two seats into one, and a
    slot loop that stops at the Trainer.
    """

    seats = [(seat.saison_id, seat.team_id, seat.rolle) for seat in answered(mongo_replica_set_url).sitze]

    assert seats == [
        (PAST_SAISON, TEAM_A_OID, "trainer"),
        (ACTIVE_SAISON, TEAM_B_OID, "trainer"),
        (ACTIVE_SAISON, TEAM_B_OID, "ansprechperson"),
    ]


@pytest.mark.db
def test_the_pupil_the_address_names_is_answered(mongo_replica_set_url: str):
    """One person per address among pupils (`uniq_spieler_email`), so a mailbox shared by siblings names one pupil."""

    assert [row.spieler_id for row in answered(mongo_replica_set_url).spieler] == [PUPIL_ONE_OID]


@pytest.mark.db
def test_two_referees_sharing_an_address_are_both_answered(mongo_replica_set_url: str):
    """The same for referees, whose two rows are stored in two spellings so neither is reached by equality."""

    assert [row.schiedsrichter_id for row in answered(mongo_replica_set_url).schiedsrichter] == [REFEREE_ONE_OID, REFEREE_TWO_OID]


@pytest.mark.db
def test_a_spelling_the_database_match_accepts_and_the_fold_refuses_is_no_seat(mongo_replica_set_url: str):
    """A case where the post-read fold is a judgement: the pre-filter reaches the row, and the fold keeps the long s apart from „s“.

    One of the cases killing a presence test in its place.
    """

    assert answered(mongo_replica_set_url, PARTED_ASKED).sitze == []


@pytest.mark.db
def test_a_spelling_the_database_match_accepts_and_the_fold_refuses_is_no_referee(mongo_replica_set_url: str):
    """The referee half of the same judgement, whose comprehension carries its own fold clause."""

    assert answered(mongo_replica_set_url, PARTED_ASKED).schiedsrichter == []


@pytest.mark.db
def test_the_parted_spelling_is_one_the_database_match_reaches(mongo_replica_set_url: str):
    """The control under the two cases above: without it both would pass on a lookup that reaches those rows never.

    Read through the pipelines rather than asked for: the payload refuses the stored spelling, its local part being above ASCII.
    """

    identifier = sign_in_identifier(PARTED_ASKED)

    async def candidates(database: AsyncDatabase) -> tuple[list[Any], list[Any]]:
        seats = await (await database[Collection.SAISON_TEAMS].aggregate(build_seat_pipeline(identifier))).to_list()
        referees = await (await database[Collection.SCHIEDSRICHTER].aggregate(build_referee_pipeline(identifier))).to_list()

        return [row["_id"] for row in seats], [row["_id"] for row in referees]

    seat_ids, referee_ids = on_a_league(mongo_replica_set_url, candidates)

    assert (HAND_EDITED_ROW_OID in seat_ids, HAND_EDITED_REFEREE_OID in referee_ids) == (True, True)


def test_the_parted_spelling_is_one_no_payload_stores_and_the_fold_parts():
    """The premise of the three cases above: the row is a hand edit the fold still keeps from the asker, no write storing it."""

    with pytest.raises(ValueError):
        league_address(HAND_EDITED_STORED)
    assert sign_in_identifier(HAND_EDITED_STORED) != sign_in_identifier(PARTED_ASKED)


@pytest.mark.db
def test_an_internationalised_domain_answers_all_three_kinds(mongo_replica_set_url: str):
    """Kills a fold that decodes the punycode it is handed, which no stored row then equals."""

    answer = answered(mongo_replica_set_url, IDN_ASKED)

    assert [seat.team_id for seat in answer.sitze] == [TEAM_C_OID]
    assert [row.spieler_id for row in answer.spieler] == [IDN_PUPIL_OID]
    assert [row.schiedsrichter_id for row in answer.schiedsrichter] == [IDN_REFEREE_OID]


@pytest.mark.db
def test_the_sharp_s_address_and_the_double_s_one_are_two_mailboxes(mongo_replica_set_url: str):
    """Kills `casefold` in the fold, which maps „ß“ to „ss“ and would hand one person the other's seat.

    Each address holds a seat at a club of its own, so collapsing the two answers the wrong club
    rather than nothing.
    """

    assert [seat.team_id for seat in answered(mongo_replica_set_url, SHARP_S_ASKED).sitze] == [TEAM_A_OID]
    assert [seat.team_id for seat in answered(mongo_replica_set_url, DOUBLE_S_ASKED).sitze] == [TEAM_B_OID]


@pytest.mark.db
def test_an_address_arriving_unfolded_answers_the_same_seats(mongo_replica_set_url: str):
    """Kills trusting the caller to have folded: the payload lower-cases the domain alone, so a half-folded value would miss every seat."""

    assert [seat.team_id for seat in answered(mongo_replica_set_url, SEAT_STORED).sitze] == [TEAM_A_OID, TEAM_B_OID, TEAM_B_OID]


@pytest.mark.db
def test_an_address_the_league_holds_nothing_for_answers_three_empty_lists(mongo_replica_set_url: str):
    """The control: without it every case above would pass on a lookup that answers everything it is asked."""

    answer = answered(mongo_replica_set_url, "niemand.hierverzeichnet@example.com")

    assert (answer.sitze, answer.spieler, answer.schiedsrichter) == ([], [], [])


@pytest.mark.db
def test_a_seat_carries_the_name_the_club_was_played_under(mongo_replica_set_url: str):
    """Kills a join onto `teams`: the first club has been renamed since, so its own document holds the other name."""

    assert [seat.team_name for seat in answered(mongo_replica_set_url).sitze] == [ROW_NAME_A, ROW_NAME_B, ROW_NAME_B]


@pytest.mark.db
def test_a_seat_carries_its_own_season_s_status(mongo_replica_set_url: str):
    """The one read of `saisons` a seat costs. Two seasons of differing status, so a status taken from whichever sorted first is wrong here."""

    assert [seat.saison_status for seat in answered(mongo_replica_set_url).sitze] == ["past", "active", "active"]


def test_the_operation_is_unreachable_without_a_bearer_token():
    """The guard runs ahead of the payload's own validation, so a malformed body still answers the guard's code rather than a 422."""

    response = TestClient(application(), raise_server_exceptions=False).post(PATH, json={"erfundenes_feld": 1})

    assert response.status_code == 401
    assert response.json()["error_code"] == MISSING_TOKEN


def test_the_base_key_draws_the_system_guard_s_own_code():
    """`WRONG_BASE_KEY` here would mean `verify_access_base` is on this route; each guard answers its own code, whatever key arrives."""

    response = TestClient(application(), raise_server_exceptions=False).post(PATH, headers=BASE_AUTH, json={"email": IDENTIFIER})

    assert response.status_code == 401
    assert response.json()["error_code"] == WRONG_SYSTEM_KEY


@functools.cache
def _served() -> FastAPI:
    """One app for every case serving through it: building one costs more than the request a case sends through it.

    Built on first use rather than at import, which every xdist worker pays at collection.
    """

    return create_app(config_for(DATABASE_NAME))


def served_over_http(url: str, email: str = IDENTIFIER) -> Response:
    """The corpus seeded, then one request through the MOUNTED route."""

    on_a_league(url, _no_body)

    async def _answered() -> Response:
        async with app_client(url, app=_served()) as http:
            return await http.post(PATH, headers=SYSTEM_AUTH, json={"email": email})

    return asyncio.run(_answered())


@pytest.mark.db
def test_the_mounted_route_serves_the_three_kinds_the_corpus_holds(mongo_replica_set_url: str):
    """The whole body, so `response_model`'s own serialisation is compared rather than the objects behind it.

    A collection bound to the wrong parameter answers an empty list, and no case calling the
    function by keyword can tell.
    """

    response = served_over_http(mongo_replica_set_url)

    assert response.status_code == 200
    assert response.json() == {
        "acknowledged": 1,
        "sitze": [
            {
                "saison_id": PAST_SAISON,
                "team_id": str(TEAM_A_OID),
                "rolle": "trainer",
                "team_name": ROW_NAME_A,
                "saison_status": "past",
            },
            {
                "saison_id": ACTIVE_SAISON,
                "team_id": str(TEAM_B_OID),
                "rolle": "trainer",
                "team_name": ROW_NAME_B,
                "saison_status": "active",
            },
            {
                "saison_id": ACTIVE_SAISON,
                "team_id": str(TEAM_B_OID),
                "rolle": "ansprechperson",
                "team_name": ROW_NAME_B,
                "saison_status": "active",
            },
        ],
        "spieler": [{"spieler_id": str(PUPIL_ONE_OID)}],
        "schiedsrichter": [{"schiedsrichter_id": str(REFEREE_ONE_OID)}, {"schiedsrichter_id": str(REFEREE_TWO_OID)}],
        "unbestaetigt": False,
        "gesperrt": False,
        "verwaltung": None,
        "berechtigt_seit": None,
        "inhaber_seit": None,
    }


@pytest.mark.db
def test_the_mounted_route_flags_a_mailbox_whose_every_record_awaits_its_confirmation(mongo_replica_set_url: str):
    """An unconfirmed seat and a referee row whose record is null: the lists empty and the flag set, which empty lists alone cannot say."""

    response = served_over_http(mongo_replica_set_url, UNCONFIRMED)

    assert response.status_code == 200
    assert response.json() == {
        "acknowledged": 1,
        "sitze": [],
        "spieler": [],
        "schiedsrichter": [],
        "unbestaetigt": True,
        "gesperrt": False,
        "verwaltung": None,
        "berechtigt_seit": None,
        "inhaber_seit": None,
    }


@pytest.mark.db
def test_the_mounted_route_answers_a_retired_person_as_it_answers_nobody(mongo_replica_set_url: str):
    """A confirmed pupil row and a confirmed referee row, both retired: empty lists and the flag down, as for a mailbox holding nothing."""

    response = served_over_http(mongo_replica_set_url, RETIRED)

    assert response.status_code == 200
    assert response.json() == {
        "acknowledged": 1,
        "sitze": [],
        "spieler": [],
        "schiedsrichter": [],
        "unbestaetigt": False,
        "gesperrt": False,
        "verwaltung": None,
        "berechtigt_seit": None,
        "inhaber_seit": None,
    }


@pytest.mark.db
class TestTheBanFlag:
    def test_a_banned_address_asked_in_another_spelling_is_flagged_and_keeps_its_seat(self, mongo_replica_set_url: str):
        """Asked in a spelling other than the one the ban was keyed under; the seat beside it kills a ban that narrows the records."""

        answer = answered(mongo_replica_set_url, GESPERRT_ASKED)

        assert answer.gesperrt is True
        assert [(seat.team_id, seat.rolle) for seat in answer.sitze] == [(TEAM_C_OID, "stellvertretung")]

    def test_an_address_the_list_does_not_hold_is_not_flagged(self, mongo_replica_set_url: str):
        assert answered(mongo_replica_set_url).gesperrt is False

    def test_a_ban_whose_last_season_has_passed_no_longer_flags(self, mongo_replica_set_url: str):
        """The row still stands, as it does between the season's end and the rollover that deletes it; its bound is what lapses it."""

        assert answered(mongo_replica_set_url, ABGELAUFEN).gesperrt is False


@pytest.mark.db
class TestTheGrant:
    """`verwaltung`: the one stored answer, read off `berechtigungen` on the folded identifier."""

    def test_an_administrators_grant_is_answered_whatever_case_it_is_asked_in(self, mongo_replica_set_url: str):
        """Asked in capitals; the grant stores the folded spelling, so an equality on the raw address would answer null."""

        assert answered(mongo_replica_set_url, VERWALTUNG_ASKED).verwaltung == "administration"

    def test_the_owners_grant_is_answered_as_the_owner(self, mongo_replica_set_url: str):
        assert answered(mongo_replica_set_url, VERWALTUNG_INHABER).verwaltung == "owner"

    def test_a_mailbox_holding_records_and_no_grant_is_answered_null(self, mongo_replica_set_url: str):
        """The control: a lookup answering a tier for every address passes both cases above."""

        answer = answered(mongo_replica_set_url)

        assert (answer.verwaltung, answer.berechtigt_seit) == (None, None)
        assert answer.sitze

    def test_each_grant_is_dated_by_the_reconciliation_s_find_where_it_made_one_and_by_its_own_date_otherwise(self, mongo_replica_set_url: str):
        """The `owner` grant's row carries both, the later the find.

        A lookup reading `erteilt_am` alone would date a paste by whatever was typed.
        """

        assert [answered(mongo_replica_set_url, email).berechtigt_seit for email in (VERWALTUNG_INHABER, VERWALTUNG_ASKED)] == [
            GRANT_FOUND,
            GRANT_TYPED,
        ]

    def test_an_address_changed_in_place_before_the_reconciliation_found_it_is_answered_no_grant(self, mongo_replica_set_url: str):
        """Its row still carries the address before's dates, so a tier dated by them would admit the new holder's older sessions."""

        async def repointed(database: AsyncDatabase) -> FLSubjektResponse:
            await database[Collection.BERECHTIGUNGEN].update_one({"_id": GRANT_STORED_OID}, {"$set": {"adresse": BYSTANDER}})

            return await call_subjekt(database, BYSTANDER)

        answer = on_a_league(mongo_replica_set_url, repointed)

        assert (answer.verwaltung, answer.berechtigt_seit) == (None, None)

    def test_only_the_owners_grant_is_answered_with_when_its_tier_took_effect(self, mongo_replica_set_url: str):
        assert [answered(mongo_replica_set_url, email).inhaber_seit for email in (VERWALTUNG_INHABER, VERWALTUNG_ASKED)] == [
            GRANT_FOUND,
            None,
        ]

    def test_a_promotion_after_the_grant_dates_the_owners_tier_and_leaves_the_grant_dated(self, mongo_replica_set_url: str):
        """An administrator signed in between the two administers and holds no owner's power (`docs/backend/spec.md :: I534`)."""

        async def promoted(database: AsyncDatabase) -> FLSubjektResponse:
            await database[Collection.BERECHTIGUNGEN].update_one({"_id": GRANT_INHABER_OID}, {"$set": {"ernannt_am": GRANT_PROMOTED}})

            return await call_subjekt(database, VERWALTUNG_INHABER)

        answer = on_a_league(mongo_replica_set_url, promoted)

        assert (answer.verwaltung, answer.berechtigt_seit, answer.inhaber_seit) == ("owner", GRANT_FOUND, GRANT_PROMOTED)

    def test_a_promotion_made_in_the_database_is_answered_as_the_administrator_until_the_reconciliation_finds_it(
        self, mongo_replica_set_url: str
    ):
        """Nothing dates the edit, so the row's tier would date an owner's power by the administrator's grant."""

        async def raised(database: AsyncDatabase) -> FLSubjektResponse:
            await database[Collection.BERECHTIGUNGEN].update_one({"_id": GRANT_STORED_OID}, {"$set": {"verwaltung": "owner"}})

            return await call_subjekt(database, VERWALTUNG_STORED)

        answer = on_a_league(mongo_replica_set_url, raised)

        assert (answer.verwaltung, answer.berechtigt_seit, answer.inhaber_seit) == ("administration", GRANT_TYPED, None)

    def test_a_row_the_reconciliation_saw_that_stands_without_its_record_is_answered_no_grant(self, mongo_replica_set_url: str):
        """As a row put back after the reconciliation erased its record stands: every date it carries predates its return."""

        async def put_back(database: AsyncDatabase) -> FLSubjektResponse:
            await database[Collection.BERECHTIGUNGEN].update_one({"_id": GRANT_STORED_OID}, {"$set": {"gesehen_am": GRANT_FOUND}})
            await database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT].delete_one({"_id": GRANT_STORED_OID})

            return await call_subjekt(database, VERWALTUNG_STORED)

        answer = on_a_league(mongo_replica_set_url, put_back)

        assert (answer.verwaltung, answer.berechtigt_seit) == (None, None)

    def test_a_paste_no_reconciliation_has_found_is_dated_no_earlier_than_its_id(self, mongo_replica_set_url: str):
        """Typed long before it was pasted, so the frontend's guard would admit sessions older than the paste."""

        pasted = datetime(2026, 3, 1, 9, 0, tzinfo=UTC)

        async def pasted_late(database: AsyncDatabase) -> FLSubjektResponse:
            await database[Collection.BERECHTIGUNGEN].insert_one(_grant(ObjectId.from_datetime(pasted), BYSTANDER, "administration"))

            return await call_subjekt(database, BYSTANDER)

        answer = on_a_league(mongo_replica_set_url, pasted_late)

        assert (answer.verwaltung, answer.berechtigt_seit) == ("administration", pasted)

    def test_the_instant_is_served_with_its_offset(self, mongo_replica_set_url: str):
        """The driver reads a stored instant back with no offset, which the frontend would compare as its own local time."""

        response = served_over_http(mongo_replica_set_url, VERWALTUNG_STORED)

        assert response.json()["berechtigt_seit"] == "2026-01-01T00:00:00Z"
