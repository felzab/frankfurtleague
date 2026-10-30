from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pydantic import BaseModel, ValidationError
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.api.spiele.admin_router import get_spiele_action_required, patch_spiel_data
from app.api.spiele.crud import apply_release_to_spiel
from app.api.spiele.schemas import (
    SONDEREREIGNIS_NO_SHOW,
    FLBracketFault,
    FLBracketFaultBooking,
    FLBracketFaultClash,
    FLPatchSpielDataPayload,
    FLPatchSpielDataResponse,
    FLSpiel,
    FLSpielElfmeterschiessen,
    FLSpielListAdapter,
)
from app.api.spiele.services import (
    judge_spieltag_occupancy,
)
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError
from app.core.sentinels import GHOST_INACTIVE_SINCE, GHOST_SCHIEDSRICHTER_ID
from tests import documents
from tests.database import DOCUMENT_VALIDATION_FAILED, a_clean_database, on_the_seed_loop
from tests.payloads import spiel_patch_body
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spiele_write_test")


SAISON_ID = "2026"

# The reference's OWN figure, which no fixture here agrees: a booking carries the rent it was made
# at, so a leak of either default would show up as this number on a fixture.
DEFAULT_MIETPREIS = 65
DEFAULT_PAYMENT = 15

# Fixed rather than generated, so a failure names the same club every run.
ALPHA = ObjectId("6890a1b2c3d4e5f607220001")
BETA = ObjectId("6890a1b2c3d4e5f607220002")
GAMMA = ObjectId("6890a1b2c3d4e5f607220003")
DELTA = ObjectId("6890a1b2c3d4e5f607220004")

NAMES = {ALPHA: ("Alpha", "ALX"), BETA: ("Beta", "BEX"), GAMMA: ("Gamma", "GAX"), DELTA: ("Delta", "DEX")}

SPIELTAG_GRUPPE = ObjectId("6890a1b2c3d4e5f6072200a1")
SPIELTAG_VIERTELFINALE = ObjectId("6890a1b2c3d4e5f6072200a2")
SPIELTAG_HALBFINALE = ObjectId("6890a1b2c3d4e5f6072200a3")

# Each matchday's phase and span. The span is real seed data: the handler reads it back to judge the
# saved fixture's date, and a fixture takes its phase and its date from the matchday it sits on.
SPIELTAGE = {
    SPIELTAG_GRUPPE: ("gruppenphase", "2026-03-15", "2026-03-15"),
    SPIELTAG_VIERTELFINALE: ("viertelfinale", "2026-05-01", "2026-05-01"),
    SPIELTAG_HALBFINALE: ("halbfinale", "2026-05-08", "2026-05-08"),
}

VIERTELFINALE = ObjectId("6890a1b2c3d4e5f607220011")
HALBFINALE = ObjectId("6890a1b2c3d4e5f607220012")
GRUPPE_HELD = ObjectId("6890a1b2c3d4e5f607220013")
GRUPPE_FILLING = ObjectId("6890a1b2c3d4e5f607220014")
GRUPPE_DECIDER = ObjectId("6890a1b2c3d4e5f607220015")
GRUPPE_BESIDE = ObjectId("6890a1b2c3d4e5f607220016")
HALBFINALE_FROM_GRUPPE = ObjectId("6890a1b2c3d4e5f607220017")
GRUPPE_HELD_OTHER = ObjectId("6890a1b2c3d4e5f607220018")

# Read back off the stored documents, which key by `spiel_nr` rather than by id.
VIERTELFINALE_NR = 1
HALBFINALE_NR = 5
GRUPPE_HELD_NR = 11
GRUPPE_FILLING_NR = 12
GRUPPE_DECIDER_NR = 21
GRUPPE_BESIDE_NR = 22
HALBFINALE_FROM_GRUPPE_NR = 25
GRUPPE_HELD_OTHER_NR = 13


def side(team_id: ObjectId, tore: int | None = None) -> dict[str, Any]:
    return {"team_id": team_id, "name": NAMES[team_id][0], "shorthand": NAMES[team_id][1], "tore": tore}


def team_document(team_id: ObjectId) -> dict[str, Any]:
    """The club row the group table is built over. Its `name` is never read: a standing takes the season's, off the junction."""

    name, shorthand = NAMES[team_id]

    return documents.team_document(team_id, name, shorthand)


def junction(team_id: ObjectId) -> dict[str, Any]:
    """The name and the shorthand are the season's own: a saved side is composed from them, never from the payload."""

    name, shorthand = NAMES[team_id]

    return documents.saison_team_document(SAISON_ID, team_id, name, shorthand, gruppe="A")


def saison_document() -> dict[str, Any]:
    """`rules` is all this path reads a season for: the points and the tiebreak decide the placings `bracket_season` resolves."""

    rules = documents.rules_document(win_points=3, draw_points=1, qualifiers_per_group=2, tiebreak_order="tordifferenz")

    return documents.saison_document(SAISON_ID, "active", rules=rules)


def spieltag_documents() -> list[dict[str, Any]]:
    # Position 1 in each: the three sit in three different phases, where the positions restart, so
    # one number for all of them still satisfies `uniq_saison_id_saison_phase_position`.
    return [
        {
            "_id": spieltag_id,
            "beginn": beginn,
            "ende": ende,
            "position": 1,
            "saison_id": SAISON_ID,
            "saison_phase": saison_phase,
        }
        for spieltag_id, (saison_phase, beginn, ende) in SPIELTAGE.items()
    ]


def spiel_document(
    *,
    spiel_id: ObjectId,
    spiel_nr: int,
    spieltag_id: ObjectId,
    team1: dict[str, Any] | None,
    team2: dict[str, Any] | None,
    ergebnis: str | None = None,
    elfmeterschiessen: dict[str, int] | None = None,
    team1_quelle: dict[str, Any] | None = None,
) -> dict[str, Any]:
    saison_phase, datum, _ = SPIELTAGE[spieltag_id]

    # `ort` and `schiedsrichter` stay null, so a payload built from this document claims neither, and
    # the double-booking read is never the thing a failure here is about.
    return documents.spiel_document(
        spiel_id=spiel_id,
        saison_id=SAISON_ID,
        spiel_nr=spiel_nr,
        spieltag_id=spieltag_id,
        saison_phase=saison_phase,
        team1=team1,
        team2=team2,
        team1_quelle=team1_quelle,
        datum=datum,
        uhrzeit="18:00:00",
        ergebnis=ergebnis,
        elfmeterschiessen=elfmeterschiessen,
    )


def bracket_season() -> list[dict[str, Any]]:
    """A quarter-final Beta won, and the semi-final its winner feeds -- played out, shoot-out and all.

    Consistent as seeded, so the only advancement a test here sees is the one its own save causes.
    """

    return [
        spiel_document(
            spiel_id=VIERTELFINALE,
            spiel_nr=VIERTELFINALE_NR,
            spieltag_id=SPIELTAG_VIERTELFINALE,
            team1=side(ALPHA, 1),
            team2=side(BETA, 3),
            ergebnis="1:3",
        ),
        spiel_document(
            spiel_id=HALBFINALE,
            spiel_nr=HALBFINALE_NR,
            spieltag_id=SPIELTAG_HALBFINALE,
            team1=side(BETA, 2),
            team2=side(GAMMA, 2),
            ergebnis="2:2",
            elfmeterschiessen={"team1": 4, "team2": 3},
            team1_quelle={"type": "spiel", "spiel_nr": VIERTELFINALE_NR, "ausgang": "sieger"},
        ),
    ]


def a_semi_final_recorded_as(sonderereignis: str) -> list[dict[str, Any]]:
    """The same bracket, with the semi-final settled by `sonderereignis` rather than by play — Gamma awarded 0:3 over Beta."""

    quarter, semi = bracket_season()
    settled = {"team1": side(BETA, 0), "team2": side(GAMMA, 3), "ergebnis": "0:3", "elfmeterschiessen": None}

    return [quarter, {**semi, **settled, "sonderereignis": sonderereignis}]


def a_gruppe_fed_semi_final() -> list[dict[str, Any]]:
    """Group A played out, and a semi-final wired to whoever finished first in it.

    Beta leads on goal difference and stands in the semi, so the season is consistent as seeded and
    the only advancement a test sees is the one its own save causes.
    """

    return [
        spiel_document(
            spiel_id=GRUPPE_DECIDER,
            spiel_nr=GRUPPE_DECIDER_NR,
            spieltag_id=SPIELTAG_GRUPPE,
            team1=side(ALPHA, 0),
            team2=side(BETA, 3),
            ergebnis="0:3",
        ),
        # Beside it rather than on a second matchday: Gamma level on points with Beta is what leaves
        # the goal difference deciding first place, which the edit under test overturns.
        spiel_document(
            spiel_id=GRUPPE_BESIDE,
            spiel_nr=GRUPPE_BESIDE_NR,
            spieltag_id=SPIELTAG_GRUPPE,
            team1=side(GAMMA, 1),
            team2=side(DELTA, 0),
            ergebnis="1:0",
        ),
        spiel_document(
            spiel_id=HALBFINALE_FROM_GRUPPE,
            spiel_nr=HALBFINALE_FROM_GRUPPE_NR,
            spieltag_id=SPIELTAG_HALBFINALE,
            team1=side(BETA, 2),
            team2=side(GAMMA, 1),
            ergebnis="2:1",
            team1_quelle={"type": "gruppe", "gruppe": "A", "platz": 1},
        ),
    ]


def one_spieltag(
    *,
    opponent: ObjectId | None,
    ergebnis: str | None,
    tore: tuple[int | None, int | None],
    sonderereignis: str | None = None,
) -> list[dict[str, Any]]:
    """Two group fixtures on ONE matchday: Alpha stands in the first, and the second is about to field it."""

    held = spiel_document(
        spiel_id=GRUPPE_HELD,
        spiel_nr=GRUPPE_HELD_NR,
        spieltag_id=SPIELTAG_GRUPPE,
        team1=side(ALPHA, tore[0]),
        team2=None if opponent is None else side(opponent, tore[1]),
        ergebnis=ergebnis,
    )

    return [
        {**held, "sonderereignis": sonderereignis},
        spiel_document(
            spiel_id=GRUPPE_FILLING,
            spiel_nr=GRUPPE_FILLING_NR,
            spieltag_id=SPIELTAG_GRUPPE,
            team1=side(GAMMA),
            team2=side(DELTA),
        ),
    ]


def two_held_fixtures() -> list[dict[str, Any]]:
    """Three group fixtures on ONE matchday: Alpha stands in the first, Beta in the second, and the third is about to field both.

    Distinct scorelines, so a `$set` landing on the wrong fixture shows rather than matching what
    belonged there.
    """

    return [
        spiel_document(
            spiel_id=GRUPPE_HELD,
            spiel_nr=GRUPPE_HELD_NR,
            spieltag_id=SPIELTAG_GRUPPE,
            team1=side(ALPHA, 2),
            team2=side(GAMMA, 1),
            ergebnis="2:1",
        ),
        spiel_document(
            spiel_id=GRUPPE_HELD_OTHER,
            spiel_nr=GRUPPE_HELD_OTHER_NR,
            spieltag_id=SPIELTAG_GRUPPE,
            team1=side(BETA, 4),
            team2=side(DELTA, 0),
            ergebnis="4:0",
        ),
        # Both slots unresolved: every club already stands on a fixture above, so a side seeded here
        # would be a double entry before the test made one.
        spiel_document(
            spiel_id=GRUPPE_FILLING,
            spiel_nr=GRUPPE_FILLING_NR,
            spieltag_id=SPIELTAG_GRUPPE,
            team1=None,
            team2=None,
        ),
    ]


SPIELORT = ObjectId("6890a1b2c3d4e5f6072200b1")
SPIELORT_RETIRED = ObjectId("6890a1b2c3d4e5f6072200b2")
# Deliberately in no collection, so "the id names nothing" is a case no seeded row can mask.
SPIELORT_UNKNOWN = ObjectId("6890a1b2c3d4e5f6072200b9")

SCHIEDSRICHTER = ObjectId("6890a1b2c3d4e5f6072200c1")
SCHIEDSRICHTER_RETIRED = ObjectId("6890a1b2c3d4e5f6072200c2")
# Entered by an administrator, its person's confirmation not yet in.
SCHIEDSRICHTER_UNBESTAETIGT = ObjectId("6890a1b2c3d4e5f6072200c3")

RETIRED_ON = "2026-02-01"

VENUES = {SPIELORT: ("Sportplatz Ost", None), SPIELORT_RETIRED: ("Bezirkssportanlage West", RETIRED_ON)}
REFEREES = {
    SCHIEDSRICHTER: ("A. Referee", None),
    SCHIEDSRICHTER_RETIRED: ("B. Whistle", RETIRED_ON),
    SCHIEDSRICHTER_UNBESTAETIGT: ("C. Pfiff", None),
    # Every erasure's fixtures end here, and it is the one referee row with no name
    # (`app/core/sentinels.py :: GHOST_SCHIEDSRICHTER_ID`).
    GHOST_SCHIEDSRICHTER_ID: (None, GHOST_INACTIVE_SINCE),
}


def venue_documents() -> list[dict[str, Any]]:
    """One live ground and one retired, so a refusal about RETIREMENT cannot pass because the id resolved to nothing.

    The default rent is the ground's own and never the rent a fixture agreed, which `booking` sets.
    """

    return [
        {
            "_id": spielort_id,
            "name": name,
            "address": dict(documents.ADDRESS),
            "maps_link": f"{name}, Frankfurt",
            "default_mietpreis": DEFAULT_MIETPREIS,
            "inactive_since": inactive_since,
        }
        for spielort_id, (name, inactive_since) in VENUES.items()
    ]


def referee_documents() -> list[dict[str, Any]]:
    return [
        {
            "_id": schiedsrichter_id,
            "name": name,
            "schule": None,
            "default_payment": DEFAULT_PAYMENT,
            "kontakt": {"telefon": None, "email": None},
            "inactive_since": inactive_since,
            # Every named row confirmed by its person but the one a case books unconfirmed; the ghost holds no record.
            "einwilligung": (
                None
                if schiedsrichter_id in (SCHIEDSRICHTER_UNBESTAETIGT, GHOST_SCHIEDSRICHTER_ID)
                else documents.eigene_einwilligung_document(text_version="v1", bestaetigt_am="2026-01-20")
            ),
        }
        for schiedsrichter_id, (name, inactive_since) in REFEREES.items()
    ]


def booking(spielort_id: ObjectId, mietpreis: int = 80) -> dict[str, Any]:
    """A venue as a fixture STORES it, under the name the venue itself carries -- which is what a save composes back."""

    name, _ = VENUES[spielort_id]

    return {"spielort_id": spielort_id, "name": name, "maps_link": f"{name}, Frankfurt", "mietpreis": mietpreis}


def assignment(schiedsrichter_id: ObjectId, payment: int = 20) -> dict[str, Any]:
    """A referee as a fixture STORES them, the venue's `booking` counterpart -- and the fee is the money half of the same asymmetry."""

    name, _ = REFEREES[schiedsrichter_id]

    return {"schiedsrichter_id": schiedsrichter_id, "name": name, "payment": payment}


def one_venue_twice(*, sonderereignis: str | None) -> list[dict[str, Any]]:
    """Two group fixtures at one ground on one matchday, the first carrying `sonderereignis`."""

    ort = booking(SPIELORT)

    held = spiel_document(spiel_id=GRUPPE_HELD, spiel_nr=GRUPPE_HELD_NR, spieltag_id=SPIELTAG_GRUPPE, team1=side(ALPHA), team2=side(BETA))
    filling = spiel_document(
        spiel_id=GRUPPE_FILLING, spiel_nr=GRUPPE_FILLING_NR, spieltag_id=SPIELTAG_GRUPPE, team1=side(GAMMA), team2=side(DELTA)
    )

    return [{**held, "ort": ort, "sonderereignis": sonderereignis}, {**filling, "ort": ort}]


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


# The save's own bookkeeping, which neither a pure model nor a preview carries: the count of writes it raises, and
# whether it stamped an adoption.
SAVE_ONLY = frozenset({"version", "bericht_uebernommen"})


def but_its_bookkeeping(stored: Any) -> Any:
    """A model or a raw document without `SAVE_ONLY`, so it compares with what the pure model or the preview predicts."""

    raw = stored.model_dump() if isinstance(stored, BaseModel) else stored

    return {key: value for key, value in raw.items() if key not in SAVE_ONLY}


def on_a_seeded_season(url: str, body: Body, *, spiele: list[dict[str, Any]], mutates_schema: bool = False) -> Any:
    """`mutates_schema=True` where the body attaches a validator (`tests/database.py :: a_clean_database`)."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, mutates_schema=mutates_schema) as (client, database):
            await database[Collection.SAISONS].insert_one(saison_document())
            # Always, not per scenario: a `gruppe` slot seeds from the table these rows are ranked in.
            await database[Collection.TEAMS].insert_many([team_document(team_id) for team_id in NAMES])
            await database[Collection.SAISON_TEAMS].insert_many([junction(team_id) for team_id in NAMES])
            await database[Collection.SPIELTAGE].insert_many(spieltag_documents())
            # Always, not per scenario: every save composes its stored names from these rows.
            await database[Collection.SPIELORTE].insert_many(venue_documents())
            await database[Collection.SCHIEDSRICHTER].insert_many(referee_documents())
            await database[Collection.SPIELE].insert_many(spiele)

            return await body(database, client)

    return on_the_seed_loop(_run())


async def call_patch(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    spiel_id: ObjectId,
    spiel_data: FLPatchSpielDataPayload,
    *,
    dry_run: bool = False,
    uebernimmt_bericht: int | None = None,
) -> FLPatchSpielDataResponse:
    return await patch_spiel_data(
        spiel_id=spiel_id,
        spiel_data=spiel_data,
        db=client,
        spiele_collection=database[Collection.SPIELE],
        teams_collection=database[Collection.TEAMS],
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spieltage_collection=database[Collection.SPIELTAGE],
        spielorte_collection=database[Collection.SPIELORTE],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        spielberichte_collection=database[Collection.SPIELBERICHTE],
        uebernimmt_bericht=uebernimmt_bericht,
        now=ADOPTED_AT,
        dry_run=dry_run,
    )


async def payload_for(database: AsyncDatabase, spiel_id: ObjectId, **overrides: Any) -> FLPatchSpielDataPayload:
    """The stored fixture as a payload changing nothing but `overrides`.

    Read off the document because this endpoint writes wholesale: a field a test left out would be
    erased rather than kept, and the test would be about that instead.
    """

    stored = await database[Collection.SPIELE].find_one({"_id": spiel_id})
    assert stored is not None, f"the seed holds no fixture {spiel_id}"

    return FLPatchSpielDataPayload.model_validate(spiel_patch_body(stored, **overrides))


async def read_spiel(database: AsyncDatabase, spiel_id: ObjectId) -> FLSpiel:
    """Read outside any transaction -- what a later request would see."""

    return FLSpiel.model_validate(await database[Collection.SPIELE].find_one({"_id": spiel_id}))


async def spiele_now(database: AsyncDatabase) -> dict[int, dict[str, Any]]:
    """The RAW documents, keyed by `spiel_nr`: a model would answer with its own defaults for a key the write dropped."""

    rows = await database[Collection.SPIELE].find({"saison_id": SAISON_ID}).to_list(length=None)

    return {row["spiel_nr"]: row for row in rows}


class TestTheBookingReadAsksWhoUsedTheGround:
    """The booking query's mapping, against a real read: set membership elsewhere cannot show which half a member falls in."""

    @pytest.mark.parametrize(
        ("sonderereignis", "refused"),
        [("abgebrochen", True), ("ausgefallen", False), ("annulliert", False), ("nichtantreten_team1", False)],
        ids=["abandoned-occupies", "called-off-frees", "annulled-frees", "no-show-frees"],
    )
    def test_only_a_fixture_that_took_place_still_holds_its_slot(self, mongo_replica_set_url: str, sonderereignis: str, refused: bool):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            # At 18:30, off the hour both are seeded at: a claim the fixture already made is judged by nobody.
            spiel_data = await payload_for(database, GRUPPE_FILLING, uhrzeit="18:30:00")

            try:
                await call_patch(database, client, GRUPPE_FILLING, spiel_data)
            except APIError as conflict:
                return conflict.error_code

            return None

        answered = on_a_seeded_season(mongo_replica_set_url, body, spiele=one_venue_twice(sonderereignis=sonderereignis))

        assert (answered == Code.SPIEL_DOUBLE_BOOKED) is refused


def an_unbooked_spieltag() -> list[dict[str, Any]]:
    """`one_spieltag`'s two group fixtures with nothing booked, so a booking a test makes is the only one in the season."""

    return one_spieltag(opponent=BETA, ergebnis=None, tore=(None, None))


class TestTheBookingRefusalIsReachedThroughTheRoute:
    """That `find_booking_refusal` is WIRED, not merely written: an unwired refusal is a green suite and a dead rule."""

    @pytest.mark.parametrize(
        "chosen",
        [pytest.param(SPIELORT_UNKNOWN, id="a ground no row answers to"), pytest.param(SPIELORT_RETIRED, id="a retired ground")],
    )
    def test_booking_a_venue_the_league_cannot_offer_is_refused(self, mongo_replica_set_url: str, chosen: ObjectId):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spiel_data = await payload_for(database, GRUPPE_FILLING, ort={"spielort_id": chosen, "mietpreis": 80})

            with pytest.raises(APIError) as refused:
                await call_patch(database, client, GRUPPE_FILLING, spiel_data)

            return refused.value.error_code, await spiele_now(database)

        code, spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=an_unbooked_spieltag())

        assert code == Code.BOOKING_UNKNOWN_RESOURCE
        # The whole save is taken back, so the booking does not land without the rule that judges it.
        assert spiele[GRUPPE_FILLING_NR]["ort"] is None

    def test_booking_a_referee_the_league_cannot_offer_is_refused(self, mongo_replica_set_url: str):
        """The other reference, because a rule reading one only would pass that one and miss this."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            assigned = {"schiedsrichter_id": SCHIEDSRICHTER_RETIRED, "payment": 20}
            spiel_data = await payload_for(database, GRUPPE_FILLING, schiedsrichter=assigned)

            with pytest.raises(APIError) as refused:
                await call_patch(database, client, GRUPPE_FILLING, spiel_data)

            return refused.value.error_code

        assert on_a_seeded_season(mongo_replica_set_url, body, spiele=an_unbooked_spieltag()) == Code.BOOKING_UNKNOWN_RESOURCE

    def test_booking_a_referee_whose_person_has_not_confirmed_is_refused(self, mongo_replica_set_url: str):
        """The confirmation is read off the referee's own record in the save's transaction, never off the payload."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            assigned = {"schiedsrichter_id": SCHIEDSRICHTER_UNBESTAETIGT, "payment": 20}
            spiel_data = await payload_for(database, GRUPPE_FILLING, schiedsrichter=assigned)

            with pytest.raises(APIError) as refused:
                await call_patch(database, client, GRUPPE_FILLING, spiel_data)

            return refused.value.error_code, (await spiele_now(database))[GRUPPE_FILLING_NR]["schiedsrichter"]

        assert on_a_seeded_season(mongo_replica_set_url, body, spiele=an_unbooked_spieltag()) == (Code.BOOKING_UNCONFIRMED_SCHIEDSRICHTER, None)

    @pytest.mark.parametrize("dry_run", [pytest.param(True, id="preview"), pytest.param(False, id="save")])
    @pytest.mark.parametrize(
        "kept",
        [
            pytest.param({"ort": booking(SPIELORT_RETIRED)}, id="retired-venue"),
            pytest.param({"schiedsrichter": assignment(GHOST_SCHIEDSRICHTER_ID)}, id="the-ghost"),
        ],
    )
    def test_lifting_a_call_off_books_the_row_it_kept_again(self, mongo_replica_set_url: str, kept: dict[str, Any], dry_run: bool):
        """The dry run judges as the save does, so the editor names the refusal while the call-off is being lifted rather than at the press."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spiel_data = await payload_for(database, GRUPPE_FILLING, sonderereignis=None)

            with pytest.raises(APIError) as refused:
                await call_patch(database, client, GRUPPE_FILLING, spiel_data, dry_run=dry_run)

            return refused.value.error_code, await spiele_now(database)

        held, filling = an_unbooked_spieltag()
        code, spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=[held, {**filling, **kept, "sonderereignis": "ausgefallen"}])

        assert (code, spiele[GRUPPE_FILLING_NR]["sonderereignis"]) == (Code.BOOKING_UNKNOWN_RESOURCE, "ausgefallen")

    def test_a_live_venue_is_stored_under_the_name_the_venue_carries(self, mongo_replica_set_url: str):
        """The composition end to end: the ground and the rent are the payload's, the name and the link the venue's."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spiel_data = await payload_for(database, GRUPPE_FILLING, ort={"spielort_id": SPIELORT, "mietpreis": 95})
            await call_patch(database, client, GRUPPE_FILLING, spiel_data)

            return await spiele_now(database)

        spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=an_unbooked_spieltag())

        assert spiele[GRUPPE_FILLING_NR]["ort"] == booking(SPIELORT, mietpreis=95)

    def test_a_live_referee_is_stored_under_the_name_the_referee_carries(self, mongo_replica_set_url: str):
        """The same composition on the other reference, whose fee is what the league pays out -- and the venue's case cannot speak for it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            assigned = {"schiedsrichter_id": SCHIEDSRICHTER, "payment": 35}
            spiel_data = await payload_for(database, GRUPPE_FILLING, schiedsrichter=assigned)
            await call_patch(database, client, GRUPPE_FILLING, spiel_data)

            return await spiele_now(database)

        spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=an_unbooked_spieltag())

        assert spiele[GRUPPE_FILLING_NR]["schiedsrichter"] == assignment(SCHIEDSRICHTER, payment=35)

    def test_a_retired_venue_an_old_fixture_already_holds_blocks_no_edit(self, mongo_replica_set_url: str):
        """`spielort_still_booked` lets a venue retire while only played fixtures name it; refusing their edits would be a false refusal."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spiel_data = await payload_for(database, GRUPPE_FILLING, uhrzeit="19:00:00")
            await call_patch(database, client, GRUPPE_FILLING, spiel_data)

            return await spiele_now(database)

        held, filling = an_unbooked_spieltag()
        spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=[held, {**filling, "ort": booking(SPIELORT_RETIRED)}])

        assert spiele[GRUPPE_FILLING_NR]["uhrzeit"] == "19:00:00"
        assert spiele[GRUPPE_FILLING_NR]["ort"] == booking(SPIELORT_RETIRED)


def hand_edited_at(spielort_id: ObjectId) -> dict[str, Any]:
    """Another season's fixture at `spielort_id` on the matchday's day, its hour stored as no read model admits."""

    return documents.spiel_document(
        spiel_id=ObjectId("6890a1b2c3d4e5f6072200e1"),
        saison_id="2025",
        spiel_nr=99,
        spieltag_id=SPIELTAG_GRUPPE,
        datum=SPIELTAGE[SPIELTAG_GRUPPE][1],
        uhrzeit="18:00",
        ort=booking(spielort_id),
    )


class TestAHandEditedFixtureOfAnotherSeasonAnswersTheRefusal:
    """The booking read validates every season's fixtures, so it sits below every refusal it does not feed.

    Read earlier, a hand-stored hour answers 500 where the booking rule refuses.
    """

    @pytest.mark.parametrize(
        ("chosen", "raises"),
        [
            pytest.param(SPIELORT_RETIRED, False, id="refused-at-the-booking-rule"),
            # The premise: a save the booking rule lets through reaches the read, which raises.
            pytest.param(SPIELORT, True, id="reaching-the-read"),
        ],
    )
    def test_a_save_refused_ahead_of_the_booking_read_answers_its_refusal(self, mongo_replica_set_url: str, chosen: ObjectId, raises: bool):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELE].insert_one(hand_edited_at(chosen))
            spiel_data = await payload_for(database, GRUPPE_FILLING, ort={"spielort_id": chosen, "mietpreis": 80})

            try:
                await call_patch(database, client, GRUPPE_FILLING, spiel_data)
            except APIError as refused:
                return refused.error_code
            except ValidationError:
                return ValidationError

            return None

        answered = on_a_seeded_season(mongo_replica_set_url, body, spiele=an_unbooked_spieltag())

        assert answered == (ValidationError if raises else Code.BOOKING_UNKNOWN_RESOURCE)


class TestASavedSideIsNamedByTheSeason:
    def test_the_stored_name_comes_from_the_junction_rather_than_the_payload(self, mongo_replica_set_url: str):
        """A club renamed while the season runs: the fixture's copy is rewritten from the junction on the next save of it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISON_TEAMS].update_one({"team_id": GAMMA}, {"$set": {"name": "Gamma-Schule", "shorthand": "GSX"}})
            spiel_data = await payload_for(database, GRUPPE_FILLING)
            await call_patch(database, client, GRUPPE_FILLING, spiel_data)

            return await spiele_now(database)

        spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=an_unbooked_spieltag())

        assert spiele[GRUPPE_FILLING_NR]["team1"] == {"team_id": GAMMA, "name": "Gamma-Schule", "shorthand": "GSX", "tore": None}
        # Composed from its OWN row, which the rename above did not touch: the change followed the
        # junction rather than one name reaching every side.
        assert spiele[GRUPPE_FILLING_NR]["team2"] == side(DELTA)


class TestTheStateRefusalIsReachedThroughTheRoute:
    """That `find_state_refusal` is WIRED, not merely written: an unwired refusal is a green suite and a dead rule."""

    def test_goals_on_a_fixture_that_awards_nothing_are_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spiel_data = await payload_for(database, VIERTELFINALE, sonderereignis="ausgefallen", team1=side(ALPHA, 3), team2=side(BETA, 1))

            with pytest.raises(APIError) as refused:
                await call_patch(database, client, VIERTELFINALE, spiel_data)

            return refused.value, await spiele_now(database)

        refused, spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=bracket_season())

        assert refused.error_code == Code.STATE_ERGEBNIS_ON_A_NON_EVENT
        # The whole save is taken back, so the event does not land without the refusal that judges it.
        assert spiele[VIERTELFINALE_NR]["sonderereignis"] is None


# The day Gamma is out of the season, which is also the day a fixture is moved onto below: the rule
# reads `datum < departed_from`, so the boundary is the value an off-by-one comparison gets wrong.
GAMMA_DEPARTED_FROM = "2026-03-20"
A_DAY_SHORT_OF_THE_EXIT = "2026-03-19"

GAMMA_AUSTRITT = {"type": "disqualifikation", "grund": "Nicht angetreten zum Spieltag", "datum": GAMMA_DEPARTED_FROM}


class TestTheEligibilityRefusalIsReachedThroughTheRoute:
    """That `find_eligibility_refusal` is WIRED, and judges the membership `pull_saison_membership` really returns.

    Every other test builds that map by hand. The date trigger alone reaches it: the projection does
    not vary with the input that moved.
    """

    @pytest.mark.parametrize(
        ("datum", "error_code"),
        [
            pytest.param(GAMMA_DEPARTED_FROM, Code.ELIGIBILITY_DISQUALIFIED, id="moved onto the exit"),
            # The control: one day earlier the same save clears this rule and is refused by the NEXT
            # one, so the refusal above is about the exit rather than about any date at all.
            pytest.param(A_DAY_SHORT_OF_THE_EXIT, Code.SPIEL_OUTSIDE_SPIELTAG, id="moved a day short of it"),
        ],
    )
    def test_a_fixture_re_dated_past_its_own_occupants_exit_is_judged_as_a_newly_fielded_club_is(
        self, mongo_replica_set_url: str, datum: str, error_code: str
    ):
        """The WIDENED case: both sides stay exactly as stored and only `datum` moves, which is the save `stays` would otherwise skip."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISON_TEAMS].update_one({"team_id": GAMMA}, {"$set": {"austritt": GAMMA_AUSTRITT}})
            spiel_data = await payload_for(database, GRUPPE_FILLING, datum=datum)

            with pytest.raises(APIError) as refused:
                await call_patch(database, client, GRUPPE_FILLING, spiel_data)

            return refused.value, await spiele_now(database)

        refused, spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=an_unbooked_spieltag())

        assert refused.error_code == error_code
        # Nothing written under either refusal: the judgement runs inside the transaction's callback.
        assert spiele[GRUPPE_FILLING_NR]["datum"] == SPIELTAGE[SPIELTAG_GRUPPE][1]

    def test_the_refusal_names_the_club_under_the_name_the_season_carries(self, mongo_replica_set_url: str):
        """The season's name reaches the message only through the junction projection, so a key dropped from it fails here."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISON_TEAMS].update_one(
                {"team_id": GAMMA}, {"$set": {"austritt": GAMMA_AUSTRITT, "name": "Gamma-Schule"}}
            )
            spiel_data = await payload_for(database, GRUPPE_FILLING, datum=GAMMA_DEPARTED_FROM)

            with pytest.raises(APIError) as refused:
                await call_patch(database, client, GRUPPE_FILLING, spiel_data)

            return refused.value

        refused = on_a_seeded_season(mongo_replica_set_url, body, spiele=an_unbooked_spieltag())

        assert refused.error_code == Code.ELIGIBILITY_DISQUALIFIED


class TestASavedResultCarriesThroughTheBracket:
    def test_the_refilled_slot_loses_its_result_and_its_shoot_out(self, mongo_replica_set_url: str):
        """Alpha replaces Beta in the semi-final, and the rule says both halves of the old result go."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spiel_data = await payload_for(database, VIERTELFINALE, team1=side(ALPHA, 3), team2=side(BETA, 1))
            response = await call_patch(database, client, VIERTELFINALE, spiel_data)

            return response, await spiele_now(database)

        response, spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=bracket_season())

        assert spiele[VIERTELFINALE_NR]["ergebnis"] == "3:1"

        assert spiele[HALBFINALE_NR]["team1"] == {"team_id": ALPHA, "name": "Alpha", "shorthand": "ALX", "tore": None}
        assert spiele[HALBFINALE_NR]["ergebnis"] is None
        # The stale shoot-out is the damage: the bracket would name a winner the goals no longer support.
        assert spiele[HALBFINALE_NR]["elfmeterschiessen"] is None, "the shoot-out outlived the side that won it"
        assert spiele[HALBFINALE_NR]["team2"]["tore"] is None, "the side that stayed kept goals scored against a team that left"

        (advancement,) = response.advanced_to
        assert advancement.spiel_nr == HALBFINALE_NR
        assert (advancement.voided_ergebnis, advancement.voided_elfmeterschiessen) == ("2:2", FLSpielElfmeterschiessen(team1=4, team2=3))

    @pytest.mark.parametrize(
        ("stored_event", "after_the_advancement"),
        [
            pytest.param("nichtantreten_team1", None, id="the no-show names the slot that was refilled"),
            pytest.param("nichtantreten_team2", None, id="the no-show names the slot that stayed"),
            pytest.param("abgebrochen", "abgebrochen", id="an abandonment names no side and survives"),
        ],
    )
    def test_a_refilled_slot_takes_the_no_show_it_was_holding_with_it(
        self, mongo_replica_set_url: str, stored_event: str, after_the_advancement: str | None
    ):
        """A no-show naming a club the bracket replaced names nobody, and `state_nichtantreten_without_two_sides` refuses every later save."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spiel_data = await payload_for(database, VIERTELFINALE, team1=side(ALPHA, 3), team2=side(BETA, 1))
            response = await call_patch(database, client, VIERTELFINALE, spiel_data)

            return response, await spiele_now(database)

        response, spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=a_semi_final_recorded_as(stored_event))

        # The advancement itself, so the event assertion below cannot pass on a fixture nothing moved.
        assert spiele[HALBFINALE_NR]["team1"]["team_id"] == ALPHA
        assert spiele[HALBFINALE_NR]["ergebnis"] is None
        assert spiele[HALBFINALE_NR]["sonderereignis"] == after_the_advancement

        # Reported, not only performed: an event this save destroyed is something the admin has to
        # see, which is the reason the two fields beside it exist.
        (advancement,) = response.advanced_to
        assert advancement.voided_sonderereignis == (None if after_the_advancement else stored_event)

    def test_a_save_changing_nothing_advances_nobody(self, mongo_replica_set_url: str):
        """The control for the test above: the seeded season already agrees with its wiring, so that advancement is the save's doing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spiel_data = await payload_for(database, VIERTELFINALE)
            response = await call_patch(database, client, VIERTELFINALE, spiel_data)

            return response, await spiele_now(database)

        response, spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=bracket_season())

        assert response.advanced_to == []
        assert spiele[HALBFINALE_NR]["team1"]["team_id"] == BETA
        assert spiele[HALBFINALE_NR]["elfmeterschiessen"] == {"team1": 4, "team2": 3}


class TestASaveOpenedOnAnOlderVersionIsRefused:
    """The editor's save carries the `version` it was served, and the save answers the one its next save sends."""

    def test_a_save_on_the_version_the_first_save_raised_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            opened = await payload_for(database, VIERTELFINALE, version=0)
            first = await call_patch(database, client, VIERTELFINALE, opened)
            with pytest.raises(APIError) as refused:
                await call_patch(database, client, VIERTELFINALE, opened.model_copy(update={"notiz": "veraltet"}))

            return first, refused.value, await spiele_now(database)

        first, refusal, spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=bracket_season())

        assert first.version == 1
        assert (refusal.status_code, refusal.error_code) == (409, Code.VERSION_STALE)
        assert (spiele[VIERTELFINALE_NR]["notiz"], spiele[VIERTELFINALE_NR]["version"]) == (None, 1)


class TestAMidFlightFailureTakesTheWholeSaveBack:
    def test_neither_the_edit_nor_the_advancement_survives(self, mongo_replica_set_url: str):
        """A validator admitting only a string `ergebnis` refuses the advancement's null, after the admin's own edit has landed."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database.command(
                "collMod",
                Collection.SPIELE.value,
                validator={"$jsonSchema": {"bsonType": "object", "properties": {"ergebnis": {"bsonType": "string"}}}},
                validationLevel="strict",
            )

            spiel_data = await payload_for(database, VIERTELFINALE, team1=side(ALPHA, 3), team2=side(BETA, 1))
            with pytest.raises(OperationFailure) as failure:
                await call_patch(database, client, VIERTELFINALE, spiel_data)

            return failure.value.code, await spiele_now(database)

        code, spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=bracket_season(), mutates_schema=True)

        # Asserted on the code, so this cannot pass because something failed before the first write.
        assert code == DOCUMENT_VALIDATION_FAILED, f"expected the validator to refuse the advancement, got code {code}"
        # "3:1" is a string the validator admits, so a quarter-final still reading "1:3" can only mean the edit was taken back.
        assert spiele[VIERTELFINALE_NR]["ergebnis"] == "1:3", "the admin's own edit outlived a rolled-back save"
        assert (spiele[VIERTELFINALE_NR]["team1"]["tore"], spiele[VIERTELFINALE_NR]["team2"]["tore"]) == (1, 3)
        assert spiele[HALBFINALE_NR]["team1"]["team_id"] == BETA
        assert spiele[HALBFINALE_NR]["elfmeterschiessen"] == {"team1": 4, "team2": 3}


@dataclass(frozen=True)
class ReleaseRun:
    """One release, seen five ways, so the assertions read outside the event loop."""

    before: FLSpiel
    predicted: FLSpiel
    after_preview: FLSpiel
    after_save: FLSpiel
    preview: FLPatchSpielDataResponse
    saved: FLPatchSpielDataResponse


@dataclass(frozen=True)
class SplitReleaseRun:
    """Releases against DIFFERENT held fixtures, each fixture keyed by its `spiel_nr`."""

    predicted: dict[int, FLSpiel]
    after_save: dict[int, FLSpiel]
    saved: FLPatchSpielDataResponse


@dataclass(frozen=True)
class DoubleReleaseRun:
    """`ReleaseRun` plus the count of log rows the emptied fixture drew, which is how many writes reached it."""

    before: FLSpiel
    predicted: FLSpiel
    after_preview: FLSpiel
    after_save: FLSpiel
    preview: FLPatchSpielDataResponse
    saved: FLPatchSpielDataResponse
    writes_against_the_held_fixture: int


class TestAReleaseWritesWhatThePureModelPredicts:
    @pytest.mark.parametrize(
        ("opponent", "ergebnis", "tore", "sonderereignis"),
        [
            pytest.param(BETA, "2:1", (2, 1), None, id="a played fixture whose other side must lose its goals"),
            pytest.param(None, None, (None, None), None, id="a fixture with no other side to strip"),
            pytest.param(BETA, "0:3", (0, 3), "nichtantreten_team1", id="a no-show naming the side being emptied"),
            pytest.param(BETA, "3:0", (3, 0), "nichtantreten_team2", id="a no-show naming the side that stays"),
            pytest.param(BETA, "2:1", (2, 1), "abgebrochen", id="an abandonment, which names no side"),
        ],
    )
    def test_the_stored_fixture_is_what_apply_release_to_spiel_predicts(
        self,
        mongo_replica_set_url: str,
        opponent: ObjectId | None,
        ergebnis: str | None,
        tore: tuple[int | None, int | None],
        sonderereignis: str | None,
    ):
        """`release_spieltag_sides` writes a hand-built `$set` where the preview applies the model; nothing else holds the two to one answer."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            rows = await database[Collection.SPIELE].find({"saison_id": SAISON_ID}).to_list(length=None)
            season = FLSpielListAdapter.validate_python(rows)
            before = next(spiel for spiel in season if spiel.id == GRUPPE_HELD)

            spiel_data = await payload_for(database, GRUPPE_FILLING, team1=side(ALPHA))
            # The handler's own judgement, over the season it is about to read: what the model is then handed.
            (release,) = judge_spieltag_occupancy(GRUPPE_FILLING, spiel_data, season).releases

            preview = await call_patch(database, client, GRUPPE_FILLING, spiel_data, dry_run=True)
            after_preview = await read_spiel(database, GRUPPE_HELD)

            saved = await call_patch(database, client, GRUPPE_FILLING, spiel_data)

            return ReleaseRun(
                before=before,
                predicted=apply_release_to_spiel(before, release),
                after_preview=after_preview,
                after_save=await read_spiel(database, GRUPPE_HELD),
                preview=preview,
                saved=saved,
            )

        run = on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=one_spieltag(opponent=opponent, ergebnis=ergebnis, tore=tore, sonderereignis=sonderereignis),
        )

        assert but_its_bookkeeping(run.after_save) == but_its_bookkeeping(run.predicted)
        assert run.after_preview == run.before, "the dry run wrote something"
        assert but_its_bookkeeping(run.saved) == but_its_bookkeeping(run.preview), "the preview answered differently from the save it previews"

        (released,) = run.saved.released_sides
        assert (released.spiel_nr, released.side, released.team_name) == (GRUPPE_HELD_NR, "team1", "Alpha")
        assert released.voided_ergebnis == ergebnis
        # Reported for the reason the scoreline is: a no-show cleared silently is a record the admin
        # never learns this save cost them.
        assert released.voided_sonderereignis == (sonderereignis if sonderereignis in SONDEREREIGNIS_NO_SHOW else None)

        # Asserted on both, so a seed that never landed cannot pass as an event correctly cleared.
        assert run.before.sonderereignis == sonderereignis
        # `state_nichtantreten_without_two_sides` refuses a no-show beside an unresolved slot, so one outliving this release
        # would leave a fixture the admin's next save is refused over.
        assert run.after_save.sonderereignis == (None if sonderereignis in ("nichtantreten_team1", "nichtantreten_team2") else sonderereignis)

    def test_a_fixture_giving_up_both_its_sides_is_emptied_by_one_write(self, mongo_replica_set_url: str):
        """Both clubs of one held fixture, released in a single write.

        Side by side the two `$set`s would null `team1` and then set `team1.tore` beneath it --
        `PathNotViable`, and the save falls. The report stays per side, so the preview names both.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            rows = await database[Collection.SPIELE].find({"saison_id": SAISON_ID}).to_list(length=None)
            season = FLSpielListAdapter.validate_python(rows)
            before = next(spiel for spiel in season if spiel.id == GRUPPE_HELD)

            spiel_data = await payload_for(database, GRUPPE_FILLING, team1=side(ALPHA), team2=side(BETA))
            releases = judge_spieltag_occupancy(GRUPPE_FILLING, spiel_data, season).releases

            # Folded rather than applied once, which is what the preview does with a repeated
            # `spiel_id`: the second release is modelled against the first one's result.
            predicted = before
            for release in releases:
                predicted = apply_release_to_spiel(predicted, release)

            preview = await call_patch(database, client, GRUPPE_FILLING, spiel_data, dry_run=True)
            after_preview = await read_spiel(database, GRUPPE_HELD)

            saved = await call_patch(database, client, GRUPPE_FILLING, spiel_data)

            return DoubleReleaseRun(
                before=before,
                predicted=predicted,
                after_preview=after_preview,
                after_save=await read_spiel(database, GRUPPE_HELD),
                preview=preview,
                saved=saved,
                # The action log is where a second `$set` would still show, once merging stopped it
                # from failing: one released fixture is one row.
                writes_against_the_held_fixture=await database[Collection.AKTIONEN].count_documents({"document_id": GRUPPE_HELD}),
            )

        run = on_a_seeded_season(
            mongo_replica_set_url,
            body,
            spiele=one_spieltag(opponent=BETA, ergebnis="2:1", tore=(2, 1)),
        )

        assert but_its_bookkeeping(run.after_save) == but_its_bookkeeping(run.predicted)
        assert (run.after_save.team1, run.after_save.team2, run.after_save.ergebnis) == (None, None, None)
        assert run.after_preview == run.before, "the dry run wrote something"
        assert but_its_bookkeeping(run.saved) == but_its_bookkeeping(run.preview), "the preview answered differently from the save it previews"

        # Two rows, because both clubs left this fixture and the admin is told about each.
        assert [(entry.spiel_nr, entry.side, entry.team_name) for entry in run.saved.released_sides] == [
            (GRUPPE_HELD_NR, "team1", "Alpha"),
            (GRUPPE_HELD_NR, "team2", "Beta"),
        ]
        assert [entry.voided_ergebnis for entry in run.saved.released_sides] == ["2:1", "2:1"]
        assert run.writes_against_the_held_fixture == 1

    def test_two_held_fixtures_each_give_up_the_side_its_own_release_names(self, mongo_replica_set_url: str):
        """Releases spanning two fixtures reach the fixture each one names.

        Written under one id they would all land on the first, leaving the second holding a club the
        payload also fields -- the double entry the rule bars.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            rows = await database[Collection.SPIELE].find({"saison_id": SAISON_ID}).to_list(length=None)
            season = FLSpielListAdapter.validate_python(rows)
            by_id = {spiel.id: spiel for spiel in season}

            spiel_data = await payload_for(database, GRUPPE_FILLING, team1=side(ALPHA), team2=side(BETA))
            releases = judge_spieltag_occupancy(GRUPPE_FILLING, spiel_data, season).releases

            saved = await call_patch(database, client, GRUPPE_FILLING, spiel_data)

            return SplitReleaseRun(
                predicted={release.spiel_nr: apply_release_to_spiel(by_id[release.spiel_id], release) for release in releases},
                after_save={
                    GRUPPE_HELD_NR: await read_spiel(database, GRUPPE_HELD),
                    GRUPPE_HELD_OTHER_NR: await read_spiel(database, GRUPPE_HELD_OTHER),
                },
                saved=saved,
            )

        run = on_a_seeded_season(mongo_replica_set_url, body, spiele=two_held_fixtures())

        assert {nr: but_its_bookkeeping(spiel) for nr, spiel in run.after_save.items()} == {
            nr: but_its_bookkeeping(spiel) for nr, spiel in run.predicted.items()
        }

        for spiel_nr in (GRUPPE_HELD_NR, GRUPPE_HELD_OTHER_NR):
            after = run.after_save[spiel_nr]
            assert after.team1 is None, f"spiel {spiel_nr} kept the club the payload fields elsewhere"
            # The side that stayed loses the goals it scored against the club removed, and with them
            # the scoreline -- so a fixture no write reached shows here as well as above.
            assert after.team2 is not None and after.team2.tore is None
            assert after.ergebnis is None

        # The scorelines are the two fixtures' own, so a report assembled from one of them is visible.
        assert [(entry.spiel_nr, entry.team_name, entry.voided_ergebnis) for entry in run.saved.released_sides] == [
            (GRUPPE_HELD_NR, "Alpha", "2:1"),
            (GRUPPE_HELD_OTHER_NR, "Beta", "4:0"),
        ]


@dataclass(frozen=True)
class SeedingRun:
    """One edit of a group fixture, previewed and then saved, so the assertions read outside the event loop."""

    preview: FLPatchSpielDataResponse
    saved: FLPatchSpielDataResponse
    after_preview: dict[int, dict[str, Any]]
    after_save: dict[int, dict[str, Any]]


class TestAResultThatReordersItsGroupIsPreviewedAsItIsSaved:
    def test_the_preview_names_the_advancement_the_save_makes(self, mongo_replica_set_url: str):
        """A `gruppe` slot resolves against a table derived from the season's fixtures, and the fixture under edit is one of them."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            # Alpha 5:0 turns a 0:3 defeat into the group's best goal difference, so first place -- and
            # with it the semi-final's slot -- changes hands.
            spiel_data = await payload_for(database, GRUPPE_DECIDER, team1=side(ALPHA, 5), team2=side(BETA, 0))

            preview = await call_patch(database, client, GRUPPE_DECIDER, spiel_data, dry_run=True)
            after_preview = await spiele_now(database)
            saved = await call_patch(database, client, GRUPPE_DECIDER, spiel_data)

            return SeedingRun(preview=preview, saved=saved, after_preview=after_preview, after_save=await spiele_now(database))

        run = on_a_seeded_season(mongo_replica_set_url, body, spiele=a_gruppe_fed_semi_final())

        # The save first, so the case cannot pass because the seeding never moved at all.
        moved = run.after_save[HALBFINALE_FROM_GRUPPE_NR]
        assert (moved["team1"]["team_id"], moved["ergebnis"]) == (ALPHA, None)
        assert run.after_preview[HALBFINALE_FROM_GRUPPE_NR]["team1"]["team_id"] == BETA, "the dry run wrote something"

        advanced = [(entry.spiel_nr, entry.voided_ergebnis) for entry in run.saved.advanced_to]
        assert advanced == [(HALBFINALE_FROM_GRUPPE_NR, "2:1")]
        assert but_its_bookkeeping(run.preview) == but_its_bookkeeping(run.saved), "the preview answered differently from the save it previews"


# The quarter-final corrected so Alpha won it, which hands Alpha the semi-final's first slot and voids
# the result the semi-final was played to.
OVERTURNED = {"team1": side(ALPHA, 3), "team2": side(BETA, 1)}

# Any day: the queue's date arm is not what these cases read.
TODAY = "2026-09-14"


def a_played_semi_final_booked(**booked: Any) -> list[dict[str, Any]]:
    """`bracket_season`, its semi-final played under the booking `booked` names -- which no retirement and no erasure is refused over."""

    quarter, semi = bracket_season()

    return [quarter, {**semi, **booked}]


async def faults_now(database: AsyncDatabase) -> list[FLBracketFault]:
    """`GET /spiele/action_required`'s faults for the seeded season, read as the page reads them."""

    response = await get_spiele_action_required(
        spiele_collection=database[Collection.SPIELE],
        teams_collection=database[Collection.TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spielorte_collection=database[Collection.SPIELORTE],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        spielberichte_collection=database[Collection.SPIELBERICHTE],
        saison_id=SAISON_ID,
        today=TODAY,
    )

    return response.bracket_faults


def booking_faults(faults: list[FLBracketFault]) -> list[tuple[int, str, str]]:
    """The two booking faults alone, as (fixture, reason, field): the walk's own faults are not what these cases are about."""

    return [(fault.spiel_nr, fault.reason, fault.booking) for fault in faults if isinstance(fault, FLBracketFaultBooking | FLBracketFaultClash)]


@dataclass(frozen=True)
class ReopeningRun:
    preview: FLPatchSpielDataResponse
    saved: FLPatchSpielDataResponse
    after_save: dict[int, dict[str, Any]]
    faults: list[FLBracketFault]


async def reopened_by_the_overturn(database: AsyncDatabase, client: AsyncMongoClient) -> ReopeningRun:
    spiel_data = await payload_for(database, VIERTELFINALE, **OVERTURNED)
    preview = await call_patch(database, client, VIERTELFINALE, spiel_data, dry_run=True)
    saved = await call_patch(database, client, VIERTELFINALE, spiel_data)

    return ReopeningRun(preview=preview, saved=saved, after_save=await spiele_now(database), faults=await faults_now(database))


class TestAFixtureTheResolutionReopensKeepsARetiredBooking:
    """The resolution voids a result no request named and refuses nothing: the retired row stays booked, and the queue names it."""

    @pytest.mark.parametrize(
        ("booked", "reported"),
        [
            pytest.param({"ort": booking(SPIELORT_RETIRED)}, [(HALBFINALE_NR, "retired_booking", "ort")], id="venue"),
            pytest.param(
                {"schiedsrichter": assignment(SCHIEDSRICHTER_RETIRED)}, [(HALBFINALE_NR, "retired_booking", "schiedsrichter")], id="referee"
            ),
            # The erasure's own case: the fixture keeps the ghost and the queue reports it as any
            # retired booking, where the arm this replaces stripped the booking instead.
            pytest.param(
                {"schiedsrichter": assignment(GHOST_SCHIEDSRICHTER_ID)}, [(HALBFINALE_NR, "retired_booking", "schiedsrichter")], id="the-ghost"
            ),
            # The control: the fault is the row's retirement, never the reopening.
            pytest.param({"ort": booking(SPIELORT), "schiedsrichter": assignment(SCHIEDSRICHTER)}, [], id="both-live"),
        ],
    )
    def test_the_booking_stays_and_the_queue_alone_names_it(self, mongo_replica_set_url: str, booked: dict[str, Any], reported: list[Any]):
        run = on_a_seeded_season(mongo_replica_set_url, reopened_by_the_overturn, spiele=a_played_semi_final_booked(**booked))

        reopened = run.after_save[HALBFINALE_NR]
        assert (reopened["team1"]["team_id"], reopened["ergebnis"]) == (ALPHA, None)
        assert {field: reopened[field] for field in booked} == booked, (
            "a booking only the league can choose to reactivate or replace was taken off"
        )

        assert len(run.saved.advanced_to) == 1
        assert but_its_bookkeeping(run.preview) == but_its_bookkeeping(run.saved), "the preview answered differently from the save it previews"

        assert (booking_faults(run.faults), booking_faults(run.saved.bracket_faults)) == (reported, [])

    def test_the_replays_result_is_entered_at_the_retired_ground(self, mongo_replica_set_url: str):
        """The way out needing no reactivation: keeping the booking on a fixture already unplayed books nothing new.

        `booking_unknown_resource` judges what a save books, and this one books nothing.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await reopened_by_the_overturn(database, client)
            replayed = await payload_for(database, HALBFINALE, team1=side(ALPHA, 2), team2=side(GAMMA, 0))
            await call_patch(database, client, HALBFINALE, replayed)

            return await spiele_now(database), await faults_now(database)

        spiele, faults = on_a_seeded_season(mongo_replica_set_url, body, spiele=a_played_semi_final_booked(ort=booking(SPIELORT_RETIRED)))

        assert (spiele[HALBFINALE_NR]["ergebnis"], spiele[HALBFINALE_NR]["ort"]) == ("2:0", booking(SPIELORT_RETIRED))
        assert booking_faults(faults) == []


def a_lifted_no_show_beside_a_later_booking() -> list[dict[str, Any]]:
    """The semi-final recorded as a no-show at the ground, freeing its slot, and a fixture booked there an hour later because it was free."""

    quarter, semi = a_semi_final_recorded_as("nichtantreten_team2")
    later = spiel_document(spiel_id=GRUPPE_BESIDE, spiel_nr=GRUPPE_BESIDE_NR, spieltag_id=SPIELTAG_HALBFINALE, team1=None, team2=None)

    return [quarter, {**semi, "ort": booking(SPIELORT)}, {**later, "uhrzeit": "19:00:00", "ort": booking(SPIELORT)}]


class TestALiftedNoShowDoubleBooksAndTheQueueNamesBoth:
    """The resolution clears the no-show with the result, so the fixture claims its slot again: nothing refuses, and the report names both."""

    def test_both_fixtures_are_reported_and_moving_one_clears_them(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            run = await reopened_by_the_overturn(database, client)

            # The repair the fault points at: five hours earlier is past the buffer.
            moved = await payload_for(database, HALBFINALE, uhrzeit="13:00:00")
            await call_patch(database, client, HALBFINALE, moved)

            return run, await faults_now(database)

        run, after_the_move = on_a_seeded_season(mongo_replica_set_url, body, spiele=a_lifted_no_show_beside_a_later_booking())

        assert run.after_save[HALBFINALE_NR]["sonderereignis"] is None
        assert booking_faults(run.faults) == [(HALBFINALE_NR, "double_booked", "ort"), (GRUPPE_BESIDE_NR, "double_booked", "ort")]
        # The queue's alone: the save's own report comes from the walk, which reads no booking.
        assert booking_faults(run.saved.bracket_faults) == []
        assert booking_faults(after_the_move) == []

    def test_a_result_and_a_note_on_either_fixture_still_save(self, mongo_replica_set_url: str):
        """Neither makes a claim its fixture had not made, so neither is refused, and the queue goes on naming both until one moves."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await reopened_by_the_overturn(database, client)

            await call_patch(database, client, HALBFINALE, await payload_for(database, HALBFINALE, team1=side(ALPHA, 2), team2=side(GAMMA, 0)))
            await call_patch(database, client, GRUPPE_BESIDE, await payload_for(database, GRUPPE_BESIDE, notiz="Platz bleibt"))

            return await spiele_now(database), await faults_now(database)

        spiele, faults = on_a_seeded_season(mongo_replica_set_url, body, spiele=a_lifted_no_show_beside_a_later_booking())

        assert (spiele[HALBFINALE_NR]["ergebnis"], spiele[GRUPPE_BESIDE_NR]["notiz"]) == ("2:0", "Platz bleibt")
        assert booking_faults(faults) == [(HALBFINALE_NR, "double_booked", "ort"), (GRUPPE_BESIDE_NR, "double_booked", "ort")]


# The queue's holder read, one fixture of this season per arm of its filter, each on its own day so no two clash.
CLAIMED_ACROSS_SEASONS = ObjectId("6890a1b2c3d4e5f607220041")
CLAIMED_AFTER_MIDNIGHT = ObjectId("6890a1b2c3d4e5f607220042")
CLAIMED_BESIDE_A_NO_SHOW = ObjectId("6890a1b2c3d4e5f607220043")
HOLDER_IN_ANOTHER_SEASON = ObjectId("6890a1b2c3d4e5f607220051")
HOLDER_THE_EVENING_BEFORE = ObjectId("6890a1b2c3d4e5f607220052")
HOLDER_THAT_NEVER_TURNED_UP = ObjectId("6890a1b2c3d4e5f607220053")
ANOTHER_SAISON_ID = "2025"


def claimed(spiel_id: ObjectId, spiel_nr: int, datum: str, uhrzeit: str, *, saison_id: str = SAISON_ID, **overrides: Any) -> dict[str, Any]:
    fixture = spiel_document(spiel_id=spiel_id, spiel_nr=spiel_nr, spieltag_id=SPIELTAG_GRUPPE, team1=None, team2=None)

    return {**fixture, "saison_id": saison_id, "datum": datum, "uhrzeit": uhrzeit, "ort": booking(SPIELORT), **overrides}


def holders_at_every_arm() -> list[dict[str, Any]]:
    return [
        claimed(CLAIMED_ACROSS_SEASONS, 41, "2026-03-15", "18:00:00"),
        claimed(HOLDER_IN_ANOTHER_SEASON, 41, "2026-03-15", "19:00:00", saison_id=ANOTHER_SAISON_ID),
        claimed(CLAIMED_AFTER_MIDNIGHT, 42, "2026-04-10", "00:30:00"),
        # Another season's too, so its own claim is not among the queue's and cannot hand the read its day.
        claimed(HOLDER_THE_EVENING_BEFORE, 52, "2026-04-09", "23:30:00", saison_id=ANOTHER_SAISON_ID),
        claimed(CLAIMED_BESIDE_A_NO_SHOW, 43, "2026-05-20", "18:00:00"),
        claimed(
            HOLDER_THAT_NEVER_TURNED_UP,
            53,
            "2026-05-20",
            "19:00:00",
            team1=side(ALPHA, 0),
            team2=side(BETA, 3),
            ergebnis="0:3",
            sonderereignis="nichtantreten_team1",
        ),
    ]


class TestTheQueueReadsTheHoldersTheRefusalReads:
    """`GET /spiele/action_required` reads the other fixtures through `spiel_double_booked`'s own filter, so each arm of it is driven here."""

    def test_every_season_and_the_neighbouring_day_are_read_and_a_freed_slot_is_not(self, mongo_replica_set_url: str):
        faults = on_a_seeded_season(mongo_replica_set_url, lambda database, _: faults_now(database), spiele=holders_at_every_arm())

        clashes = [fault for fault in faults if isinstance(fault, FLBracketFaultClash)]

        assert [(fault.spiel_id, fault.saison_id, fault.other_spiel_id, fault.other_saison_id) for fault in clashes] == [
            (CLAIMED_ACROSS_SEASONS, SAISON_ID, HOLDER_IN_ANOTHER_SEASON, ANOTHER_SAISON_ID),
            (CLAIMED_AFTER_MIDNIGHT, SAISON_ID, HOLDER_THE_EVENING_BEFORE, ANOTHER_SAISON_ID),
        ]


# The adoption stamp: a save carrying `uebernimmt_bericht` stamps the fixture's report, in its own transaction.

# As `get_germany_now` answers, so the stored instant is compared as the moment it is rather than as a wall-clock reading.
ADOPTED_AT = datetime(2026, 5, 2, 18, 30, tzinfo=ZoneInfo("Europe/Berlin"))
# Past the first write, so a stamp copying a constant rather than the seed cannot pass.
SEEDED_VERSION = 2


def a_report_on(spiel: dict[str, Any], *, version: int) -> dict[str, Any]:
    return documents.spielbericht_document(
        spiel, bericht=documents.bericht_document(version=version, seiten=documents.spielbericht_seiten(spiel))
    )


async def reports_now(database: AsyncDatabase) -> dict[ObjectId, dict[str, Any]]:
    """Each report's block, keyed by its fixture."""

    rows = await database[Collection.SPIELBERICHTE].find({}).to_list(length=None)

    return {row["spiel_id"]: row["bericht"] for row in rows}


async def with_reports(database: AsyncDatabase, reports: list[dict[str, Any]]) -> dict[ObjectId, dict[str, Any]]:
    """`reports` stored, and each block as read back: a stored instant returns without the zone it was written with."""

    await database[Collection.SPIELBERICHTE].insert_many(reports)

    return await reports_now(database)


def a_bracket_with_reports(*, quarter_final_at: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """The bracket season, its quarter-final's report at `quarter_final_at` and the semi-final's at the seeded version."""

    spiele = bracket_season()
    quarter, semi = spiele

    return spiele, [a_report_on(quarter, version=quarter_final_at), a_report_on(semi, version=SEEDED_VERSION)]


class TestOnlyALandedSaveStamps:
    def test_an_accepted_save_stamps_its_own_fixtures_report_at_the_seeded_version(self, mongo_replica_set_url: str):
        """The semi-final's report stands at the same version, so a stamp not keyed on the fixture shows on it."""

        spiele, reports = a_bracket_with_reports(quarter_final_at=SEEDED_VERSION)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await with_reports(database, reports)
            spiel_data = await payload_for(database, VIERTELFINALE, team1=side(ALPHA, 3), team2=side(BETA, 1))
            await call_patch(database, client, VIERTELFINALE, spiel_data, uebernimmt_bericht=SEEDED_VERSION)

            return await spiele_now(database), before, await reports_now(database)

        spiele_after, before, after = on_a_seeded_season(mongo_replica_set_url, body, spiele=spiele)

        assert spiele_after[VIERTELFINALE_NR]["ergebnis"] == "3:1"
        stamped = after[VIERTELFINALE]
        assert (stamped["uebernommene_version"], stamped["version"], stamped["uebernommen_von"]) == (
            SEEDED_VERSION,
            SEEDED_VERSION,
            {"art": "admin"},
        )
        assert stamped["uebernommen_am"].replace(tzinfo=UTC) == ADOPTED_AT
        assert after[HALBFINALE] == before[HALBFINALE], "a save stamped a report of a fixture it did not write"

    def test_a_save_leaving_the_fixture_as_stored_still_stamps(self, mongo_replica_set_url: str):
        """A proposal the stored result already equals: the adoption is the save's whole effect, or the report stays open."""

        spiele, reports = a_bracket_with_reports(quarter_final_at=SEEDED_VERSION)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELBERICHTE].insert_many(reports)
            before = await spiele_now(database)
            await call_patch(database, client, VIERTELFINALE, await payload_for(database, VIERTELFINALE), uebernimmt_bericht=SEEDED_VERSION)

            return before, await spiele_now(database), await reports_now(database)

        before, spiele_after, after = on_a_seeded_season(mongo_replica_set_url, body, spiele=spiele)

        assert but_its_bookkeeping(spiele_after[VIERTELFINALE_NR]) == but_its_bookkeeping(before[VIERTELFINALE_NR]), (
            "the premise: this save changes nothing on the fixture"
        )
        assert after[VIERTELFINALE]["uebernommene_version"] == SEEDED_VERSION, "a save changing nothing on the fixture adopted nothing"

    @pytest.mark.parametrize("dry_run", [pytest.param(False, id="refused-spiel_outside_spieltag"), pytest.param(True, id="dry-run")])
    def test_a_refused_save_and_a_preview_stamp_nothing(self, mongo_replica_set_url: str, dry_run: bool):
        """The same seed and version as the accepted save; a refused commit is `fl_backend/tests/api/test_erasure_commit_fail_points.py`'s."""

        spiele, reports = a_bracket_with_reports(quarter_final_at=SEEDED_VERSION)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await with_reports(database, reports)
            # A day off its matchday's span on the save, so the refusal is `spiel_outside_spieltag`; the preview carries the result alone.
            datum = None if dry_run else "2026-05-02"
            spiel_data = await payload_for(
                database, VIERTELFINALE, team1=side(ALPHA, 3), team2=side(BETA, 1), **({} if datum is None else {"datum": datum})
            )
            refusal = None
            try:
                await call_patch(database, client, VIERTELFINALE, spiel_data, dry_run=dry_run, uebernimmt_bericht=SEEDED_VERSION)
            except APIError as refused:
                refusal = refused.error_code

            return refusal, await spiele_now(database), before, await reports_now(database)

        refusal, spiele_after, before, after = on_a_seeded_season(mongo_replica_set_url, body, spiele=spiele)

        # The premise first: the save was refused, or the preview ran, and neither wrote the fixture.
        assert (refusal, spiele_after[VIERTELFINALE_NR]["ergebnis"]) == (None if dry_run else Code.SPIEL_OUTSIDE_SPIELTAG, "1:3")
        assert after[VIERTELFINALE] == before[VIERTELFINALE]


class TestAStaleSeedIsNotAdopted:
    def test_a_report_corrected_since_the_seed_stays_unstamped_and_the_save_lands(self, mongo_replica_set_url: str):
        """The referee corrected the report after the editor read it, so the save carries a version the report has left."""

        spiele, reports = a_bracket_with_reports(quarter_final_at=SEEDED_VERSION + 1)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await with_reports(database, reports)
            spiel_data = await payload_for(database, VIERTELFINALE, team1=side(ALPHA, 3), team2=side(BETA, 1))
            await call_patch(database, client, VIERTELFINALE, spiel_data, uebernimmt_bericht=SEEDED_VERSION)

            return await spiele_now(database), before, await reports_now(database)

        spiele_after, before, after = on_a_seeded_season(mongo_replica_set_url, body, spiele=spiele)

        assert spiele_after[VIERTELFINALE_NR]["ergebnis"] == "3:1", "a stale seed cost the administrator the result they saved"
        assert after[VIERTELFINALE] == before[VIERTELFINALE], "a report corrected since the seed was adopted unread"


class TestAReportAboutOtherClubsIsNotAdopted:
    @pytest.mark.parametrize("seite", ["team1", "team2"])
    def test_it_stays_unstamped_at_the_seeded_version_and_the_save_lands(self, mongo_replica_set_url: str, seite: str):
        """Written while another club held one side: stamped, its 3:1 would read as the clubs the save leaves."""

        spiele, (quarter_report, semi_report) = a_bracket_with_reports(quarter_final_at=SEEDED_VERSION)
        quarter_report["bericht"]["seiten"][seite] = ObjectId()

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await with_reports(database, [quarter_report, semi_report])
            spiel_data = await payload_for(database, VIERTELFINALE, team1=side(ALPHA, 3), team2=side(BETA, 1))
            await call_patch(database, client, VIERTELFINALE, spiel_data, uebernimmt_bericht=SEEDED_VERSION)

            return await spiele_now(database), before, await reports_now(database)

        spiele_after, before, after = on_a_seeded_season(mongo_replica_set_url, body, spiele=spiele)

        assert spiele_after[VIERTELFINALE_NR]["ergebnis"] == "3:1", "a report about other clubs cost the administrator the result"
        assert after[VIERTELFINALE] == before[VIERTELFINALE], "a report about other clubs was adopted for the clubs playing"
