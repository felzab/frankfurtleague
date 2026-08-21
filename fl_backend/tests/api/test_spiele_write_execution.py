import asyncio
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo.errors import OperationFailure

from app.api.saisons.cache import invalidate_saison_cache
from app.api.spiele.admin_router import patch_spiel_data
from app.api.spiele.crud import apply_release_to_spiel
from app.api.spiele.schemas import (
    SONDEREREIGNIS_NO_SHOW,
    FLPatchSpielDataPayload,
    FLPatchSpielDataResponse,
    FLSpiel,
    FLSpielElfmeterschiessen,
    FLSpielListAdapter,
)
from app.api.spiele.services import (
    BOOKING_UNKNOWN_RESOURCE,
    ELIGIBILITY_DISQUALIFIED,
    FIXTURE_DOUBLE_BOOKED,
    FIXTURE_OUTSIDE_SPIELTAG,
    STATE_RESULT_ON_A_NON_EVENT,
    judge_spieltag_occupancy,
)
from app.core.collections import Collection
from app.core.exceptions import DocumentConflictException

pytestmark = pytest.mark.db

DATABASE_NAME = "fl_spiele_write_test"

# Named rather than caught broadly: another failure must not read as the rollback this suite proves.
DOCUMENT_VALIDATION_FAILED = 121

SAISON_ID = "2026"

# Fixed rather than generated, so a failure names the same club every run.
ALPHA = ObjectId("6890a1b2c3d4e5f607220001")
BETA = ObjectId("6890a1b2c3d4e5f607220002")
GAMMA = ObjectId("6890a1b2c3d4e5f607220003")
DELTA = ObjectId("6890a1b2c3d4e5f607220004")

NAMES = {ALPHA: ("Alpha", "AL"), BETA: ("Beta", "BE"), GAMMA: ("Gamma", "GA"), DELTA: ("Delta", "DE")}

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

    return {
        "_id": team_id,
        "name": name,
        "shorthand": shorthand,
        "description": "",
        "full_name": f"{name}-Schule",
        "website_url": f"https://{name.lower()}.example.de",
        "address": {
            "strasse": "Hanauer Landstraße",
            "hausnummer": "12a",
            "plz": "60314",
            "stadtteil": "Ostend",
            "stadt": "Frankfurt am Main",
        },
        # Present rather than omitted: the pipeline's base filter matches a missing field against
        # `None`, so the row would pass it and then fail validation.
        "inactive_since": None,
    }


def junction(team_id: ObjectId) -> dict[str, Any]:
    """A dict rather than a model: `saison_teams` has no model of the row.

    The name and the shorthand are the season's own, and a saved side is composed from them rather
    than from anything the payload carries.
    """

    name, shorthand = NAMES[team_id]

    return {"saison_id": SAISON_ID, "team_id": team_id, "gruppe": "A", "austritt": None, "name": name, "shorthand": shorthand}


def saison_document() -> dict[str, Any]:
    """`rules` alone, because that is all this path reads a season for; the document is never validated here."""

    return {
        "_id": SAISON_ID,
        "rules": {
            "win_points": 3,
            "draw_points": 1,
            "qualifiers_per_group": 2,
            "number_of_groups": 4,
            "teams_per_group": 4,
            "tiebreak_order": "tordifferenz",
            "max_kadergroesse": 18,
            "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
            "erlaubte_stufen": ["E1", "Q1", "Q2", "Q3", "Q4"],
        },
    }


def spieltag_documents() -> list[dict[str, Any]]:
    return [
        {
            "_id": spieltag_id,
            "beginn": beginn,
            "ende": ende,
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
    """Every key spelled out: `FLSpiel` defaults `notiz` alone, so an omitted one fails inside the handler."""

    saison_phase, datum, _ = SPIELTAGE[spieltag_id]

    return {
        "_id": spiel_id,
        "spiel_nr": spiel_nr,
        "saison_id": SAISON_ID,
        "saison_phase": saison_phase,
        "spieltag_id": spieltag_id,
        "team1": team1,
        "team2": team2,
        "team1_quelle": team1_quelle,
        "team2_quelle": None,
        "datum": datum,
        "uhrzeit": "18:00:00",
        # Null on both, so a payload built from this document claims neither, and the double-booking
        # read is never the thing a failure here is about.
        "ort": None,
        "schiedsrichter": None,
        "ergebnis": ergebnis,
        "elfmeterschiessen": elfmeterschiessen,
        "sonderereignis": None,
        "notiz": None,
    }


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

VENUES = {SPIELORT: ("Sportplatz Ost", None), SPIELORT_RETIRED: ("Bezirkssportanlage West", "2026-02-01")}
REFEREES = {SCHIEDSRICHTER: ("A. Referee", None), SCHIEDSRICHTER_RETIRED: ("B. Whistle", "2026-02-01")}


def venue_documents() -> list[dict[str, Any]]:
    """One live ground and one retired, so a refusal about RETIREMENT cannot pass because the id resolved to nothing."""

    return [
        {"_id": spielort_id, "name": name, "maps_link": f"{name}, Frankfurt", "inactive_since": inactive_since}
        for spielort_id, (name, inactive_since) in VENUES.items()
    ]


def referee_documents() -> list[dict[str, Any]]:
    return [
        {"_id": schiedsrichter_id, "name": name, "inactive_since": inactive_since}
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


Body = Callable[[AsyncIOMotorDatabase, AsyncIOMotorClient], Awaitable[Any]]


def on_a_seeded_season(url: str, body: Body, *, spiele: list[dict[str, Any]]) -> Any:
    """One client and event loop per call: Motor binds to the loop it first ran on. A transaction cannot create a collection."""

    async def _run() -> Any:
        client = AsyncIOMotorClient(url)
        try:
            await client.drop_database(DATABASE_NAME)
            database = client[DATABASE_NAME]

            # Process-global and keyed by season id, so an entry another module left would answer for this one.
            invalidate_saison_cache()

            await database[Collection.SAISONS].insert_one(saison_document())
            # Always, not per scenario: a `gruppe` slot seeds from the table these rows are ranked in.
            await database[Collection.TEAMS].insert_many([team_document(team_id) for team_id in NAMES])
            await database[Collection.SAISON_TEAMS].insert_many([junction(team_id) for team_id in NAMES])
            await database[Collection.SPIELTAGE].insert_many(spieltag_documents())
            # Always, not per scenario: every save composes its stored names from these rows.
            await database[Collection.SPIELORTE].insert_many(venue_documents())
            await database[Collection.SCHIEDSRICHTER].insert_many(referee_documents())
            await database.create_collection(Collection.SPIELE)
            await database[Collection.SPIELE].insert_many(spiele)

            return await body(database, client)
        finally:
            await client.drop_database(DATABASE_NAME)
            client.close()

    return asyncio.run(_run())


async def call_patch(
    database: AsyncIOMotorDatabase,
    client: AsyncIOMotorClient,
    spiel_id: ObjectId,
    spiel_data: FLPatchSpielDataPayload,
    *,
    dry_run: bool = False,
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
        dry_run=dry_run,
    )


async def payload_for(database: AsyncIOMotorDatabase, spiel_id: ObjectId, **overrides: Any) -> FLPatchSpielDataPayload:
    """The stored fixture as a payload changing nothing but `overrides`.

    Read off the document because this endpoint writes wholesale: a field a test left out would be
    erased rather than kept, and the test would be about that instead.
    """

    stored = await database[Collection.SPIELE].find_one({"_id": spiel_id})
    assert stored is not None, f"the seed holds no fixture {spiel_id}"

    unchanged = {field: stored.get(field) for field in FLPatchSpielDataPayload.model_fields}

    return FLPatchSpielDataPayload.model_validate({**unchanged, **overrides})


async def read_spiel(database: AsyncIOMotorDatabase, spiel_id: ObjectId) -> FLSpiel:
    """Read outside any transaction -- what a later request would see."""

    return FLSpiel.model_validate(await database[Collection.SPIELE].find_one({"_id": spiel_id}))


async def spiele_now(database: AsyncIOMotorDatabase) -> dict[int, dict[str, Any]]:
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
        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            spiel_data = await payload_for(database, GRUPPE_FILLING, uhrzeit="18:00:00")

            try:
                await call_patch(database, client, GRUPPE_FILLING, spiel_data)
            except DocumentConflictException as conflict:
                return conflict.error_code

            return None

        answered = on_a_seeded_season(mongo_replica_set_url, body, spiele=one_venue_twice(sonderereignis=sonderereignis))

        assert (answered == FIXTURE_DOUBLE_BOOKED) is refused


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
        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            spiel_data = await payload_for(database, GRUPPE_FILLING, ort={"spielort_id": chosen, "mietpreis": 80})

            with pytest.raises(DocumentConflictException) as refused:
                await call_patch(database, client, GRUPPE_FILLING, spiel_data)

            return refused.value.error_code, await spiele_now(database)

        code, spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=an_unbooked_spieltag())

        assert code == BOOKING_UNKNOWN_RESOURCE
        # The whole save is taken back, so the booking does not land without the rule that judges it.
        assert spiele[GRUPPE_FILLING_NR]["ort"] is None

    def test_booking_a_referee_the_league_cannot_offer_is_refused(self, mongo_replica_set_url: str):
        """The other reference, because a rule reading one only would pass that one and miss this."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            assigned = {"schiedsrichter_id": SCHIEDSRICHTER_RETIRED, "payment": 20}
            spiel_data = await payload_for(database, GRUPPE_FILLING, schiedsrichter=assigned)

            with pytest.raises(DocumentConflictException) as refused:
                await call_patch(database, client, GRUPPE_FILLING, spiel_data)

            return refused.value.error_code

        assert on_a_seeded_season(mongo_replica_set_url, body, spiele=an_unbooked_spieltag()) == BOOKING_UNKNOWN_RESOURCE

    def test_a_live_venue_is_stored_under_the_name_the_venue_carries(self, mongo_replica_set_url: str):
        """The composition end to end: the ground and the rent are the payload's, the name and the link the venue's."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            spiel_data = await payload_for(database, GRUPPE_FILLING, ort={"spielort_id": SPIELORT, "mietpreis": 95})
            await call_patch(database, client, GRUPPE_FILLING, spiel_data)

            return await spiele_now(database)

        spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=an_unbooked_spieltag())

        assert spiele[GRUPPE_FILLING_NR]["ort"] == booking(SPIELORT, mietpreis=95)

    def test_a_live_referee_is_stored_under_the_name_the_referee_carries(self, mongo_replica_set_url: str):
        """The same composition on the other reference, whose fee is what the league pays out -- and the venue's case cannot speak for it."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            assigned = {"schiedsrichter_id": SCHIEDSRICHTER, "payment": 35}
            spiel_data = await payload_for(database, GRUPPE_FILLING, schiedsrichter=assigned)
            await call_patch(database, client, GRUPPE_FILLING, spiel_data)

            return await spiele_now(database)

        spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=an_unbooked_spieltag())

        assert spiele[GRUPPE_FILLING_NR]["schiedsrichter"] == assignment(SCHIEDSRICHTER, payment=35)

    def test_a_retired_venue_an_old_fixture_already_holds_blocks_no_edit(self, mongo_replica_set_url: str):
        """`REQ-RETIRE-003` lets a venue retire while only played fixtures still name it; refusing their edits would be a false refusal."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            spiel_data = await payload_for(database, GRUPPE_FILLING, uhrzeit="19:00:00")
            await call_patch(database, client, GRUPPE_FILLING, spiel_data)

            return await spiele_now(database)

        held, filling = an_unbooked_spieltag()
        spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=[held, {**filling, "ort": booking(SPIELORT_RETIRED)}])

        assert spiele[GRUPPE_FILLING_NR]["uhrzeit"] == "19:00:00"
        assert spiele[GRUPPE_FILLING_NR]["ort"] == booking(SPIELORT_RETIRED)


class TestASavedSideIsNamedByTheSeason:
    def test_the_stored_name_comes_from_the_junction_rather_than_the_payload(self, mongo_replica_set_url: str):
        """A club renamed while the season runs: the fixture's copy is rewritten from the junction on the next save of it."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await database[Collection.SAISON_TEAMS].update_one({"team_id": GAMMA}, {"$set": {"name": "Gamma-Schule", "shorthand": "GS"}})
            spiel_data = await payload_for(database, GRUPPE_FILLING)
            await call_patch(database, client, GRUPPE_FILLING, spiel_data)

            return await spiele_now(database)

        spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=an_unbooked_spieltag())

        assert spiele[GRUPPE_FILLING_NR]["team1"] == {"team_id": GAMMA, "name": "Gamma-Schule", "shorthand": "GS", "tore": None}
        # Composed from its OWN row, which the rename above did not touch: the change followed the
        # junction rather than one name reaching every side.
        assert spiele[GRUPPE_FILLING_NR]["team2"] == side(DELTA)


class TestTheStateRefusalIsReachedThroughTheRoute:
    """That `find_state_refusal` is WIRED, not merely written: an unwired refusal is a green suite and a dead rule."""

    def test_goals_on_a_fixture_that_awards_nothing_are_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            spiel_data = await payload_for(database, VIERTELFINALE, sonderereignis="ausgefallen", team1=side(ALPHA, 3), team2=side(BETA, 1))

            with pytest.raises(DocumentConflictException) as refused:
                await call_patch(database, client, VIERTELFINALE, spiel_data)

            return refused.value, await spiele_now(database)

        refused, spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=bracket_season())

        assert refused.error_code == STATE_RESULT_ON_A_NON_EVENT
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
            pytest.param(GAMMA_DEPARTED_FROM, ELIGIBILITY_DISQUALIFIED, id="moved onto the exit"),
            # The control: one day earlier the same save clears this rule and is refused by the NEXT
            # one, so the refusal above is about the exit rather than about any date at all.
            pytest.param(A_DAY_SHORT_OF_THE_EXIT, FIXTURE_OUTSIDE_SPIELTAG, id="moved a day short of it"),
        ],
    )
    def test_a_fixture_re_dated_past_its_own_occupants_exit_is_judged_as_a_newly_fielded_club_is(
        self, mongo_replica_set_url: str, datum: str, error_code: str
    ):
        """The WIDENED case: both sides stay exactly as stored and only `datum` moves, which is the save `stays` would otherwise skip."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await database[Collection.SAISON_TEAMS].update_one({"team_id": GAMMA}, {"$set": {"austritt": GAMMA_AUSTRITT}})
            spiel_data = await payload_for(database, GRUPPE_FILLING, datum=datum)

            with pytest.raises(DocumentConflictException) as refused:
                await call_patch(database, client, GRUPPE_FILLING, spiel_data)

            return refused.value, await spiele_now(database)

        refused, spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=an_unbooked_spieltag())

        assert refused.error_code == error_code
        # Nothing written under either refusal: the judgement runs inside the transaction's callback.
        assert spiele[GRUPPE_FILLING_NR]["datum"] == SPIELTAGE[SPIELTAG_GRUPPE][1]

    def test_the_refusal_names_the_club_under_the_name_the_season_carries(self, mongo_replica_set_url: str):
        """The season's name reaches the message only through the junction projection, so a key dropped from it fails here."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            await database[Collection.SAISON_TEAMS].update_one(
                {"team_id": GAMMA}, {"$set": {"austritt": GAMMA_AUSTRITT, "name": "Gamma-Schule"}}
            )
            spiel_data = await payload_for(database, GRUPPE_FILLING, datum=GAMMA_DEPARTED_FROM)

            with pytest.raises(DocumentConflictException) as refused:
                await call_patch(database, client, GRUPPE_FILLING, spiel_data)

            return refused.value

        refused = on_a_seeded_season(mongo_replica_set_url, body, spiele=an_unbooked_spieltag())

        assert refused.error_code == ELIGIBILITY_DISQUALIFIED
        assert "Gamma-Schule" in refused.error_detail["message"]


class TestASavedResultCarriesThroughTheBracket:
    def test_the_refilled_slot_loses_its_result_and_its_shoot_out(self, mongo_replica_set_url: str):
        """Alpha replaces Beta in the semi-final, and `docs/backend/spec.md :: I25b` says both halves of the old result go."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            spiel_data = await payload_for(database, VIERTELFINALE, team1=side(ALPHA, 3), team2=side(BETA, 1))
            response = await call_patch(database, client, VIERTELFINALE, spiel_data)

            return response, await spiele_now(database)

        response, spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=bracket_season())

        assert spiele[VIERTELFINALE_NR]["ergebnis"] == "3:1"

        assert spiele[HALBFINALE_NR]["team1"] == {"team_id": ALPHA, "name": "Alpha", "shorthand": "AL", "tore": None}
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
        """A no-show naming a club the bracket replaced describes nobody, and `REQ-STATE-003` then refuses every later save of it."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
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

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
            spiel_data = await payload_for(database, VIERTELFINALE)
            response = await call_patch(database, client, VIERTELFINALE, spiel_data)

            return response, await spiele_now(database)

        response, spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=bracket_season())

        assert response.advanced_to == []
        assert spiele[HALBFINALE_NR]["team1"]["team_id"] == BETA
        assert spiele[HALBFINALE_NR]["elfmeterschiessen"] == {"team1": 4, "team2": 3}


class TestAMidFlightFailureTakesTheWholeSaveBack:
    def test_neither_the_edit_nor_the_advancement_survives(self, mongo_replica_set_url: str):
        """A validator admitting only a string `ergebnis` refuses the advancement's null, after the admin's own edit has landed."""

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
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

        code, spiele = on_a_seeded_season(mongo_replica_set_url, body, spiele=bracket_season())

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

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
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

        assert run.after_save == run.predicted
        assert run.after_preview == run.before, "the dry run wrote something"
        assert run.saved == run.preview, "the preview answered differently from the save it previews"

        (released,) = run.saved.released_sides
        assert (released.spiel_nr, released.side, released.team_name) == (GRUPPE_HELD_NR, "team1", "Alpha")
        assert released.voided_ergebnis == ergebnis
        # Reported for the reason the scoreline is: a no-show cleared silently is a record the admin
        # never learns this save cost them.
        assert released.voided_sonderereignis == (sonderereignis if sonderereignis in SONDEREREIGNIS_NO_SHOW else None)

        # Asserted on both, so a seed that never landed cannot pass as an event correctly cleared.
        assert run.before.sonderereignis == sonderereignis
        # `REQ-STATE-003` refuses a no-show beside an unresolved slot, so one outliving this release
        # would leave a fixture the admin's next save is refused over.
        assert run.after_save.sonderereignis == (None if sonderereignis in ("nichtantreten_team1", "nichtantreten_team2") else sonderereignis)

    def test_a_fixture_giving_up_both_its_sides_is_emptied_by_one_write(self, mongo_replica_set_url: str):
        """Both clubs of one held fixture, released in a single write.

        Side by side the two `$set`s would null `team1` and then set `team1.tore` beneath it --
        `PathNotViable`, and the save falls. The report stays per side, so the preview names both.
        """

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
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

        assert run.after_save == run.predicted
        assert (run.after_save.team1, run.after_save.team2, run.after_save.ergebnis) == (None, None, None)
        assert run.after_preview == run.before, "the dry run wrote something"
        assert run.saved == run.preview, "the preview answered differently from the save it previews"

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
        payload also fields -- the double entry `docs/backend/spec.md :: I30` bars.
        """

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
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

        assert run.after_save == run.predicted

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

        async def body(database: AsyncIOMotorDatabase, client: AsyncIOMotorClient) -> Any:
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
        assert run.preview == run.saved, "the preview answered differently from the save it previews"
