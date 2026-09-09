"""
API · the restore route, driven against a real mongod because only the stored fixture answers

`PATCH /spiele/paarungen` is the whole of a season's undo, and its response reports what the write
MEANT to do, so a case reading that alone would still pass the day the write stopped landing: every
assertion below re-reads the fixtures out of the database. The refusals and the composition are
`tests/api/test_spiele_write_execution.py`'s, and completing a narrowed payload off the stored
fixture is `tests/api/test_bracket.py`'s; nothing here re-decides either.
"""

from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.cache import invalidate_saison_cache
from app.api.spiele.admin_router import patch_spiel_data, patch_spiele_paarungen
from app.api.spiele.schemas import (
    FLPatchSpielDataPayload,
    FLPatchSpielDataResponse,
    FLPatchSpielePaarungenPayload,
    FLPatchSpielePaarungenResponse,
    FLPatchSpielPaarungPayload,
)
from app.core.collections import Collection
from app.core.exceptions import DocumentConflictException
from tests.database import a_clean_database, on_the_seed_loop
from tests.payloads import spiel_patch_body
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spiel_paarung_test")

SAISON_ID = "2026"

ADDRESS = {"strasse": "Hanauer Landstraße", "hausnummer": "12a", "plz": "60314", "stadtteil": "Ostend", "stadt": "Frankfurt am Main"}

# The reference's OWN figure, which no fixture here agrees: a booking carries the money it was made
# at, so either default leaking through a restore shows up as this number on a fixture.
DEFAULT_MIETPREIS = 65
DEFAULT_PAYMENT = 15

# What the fixtures below agreed, which is what a narrowed save has to leave untouched.
MIETPREIS = 95
PAYMENT = 35


def oid(tail: str) -> ObjectId:
    return ObjectId(f"6890a1b2c3d4e5f607a1{tail}")


# Fixed rather than generated, so a failure names the same club every run.
ALPHA = oid("0001")
BETA = oid("0002")
GAMMA = oid("0003")
DELTA = oid("0004")

NAMES = {ALPHA: ("Alpha", "AL"), BETA: ("Beta", "BE"), GAMMA: ("Gamma", "GA"), DELTA: ("Delta", "DE")}

SPIELTAG_GRUPPE = oid("00a1")
SPIELTAG_HALBFINALE = oid("00a2")
SPIELTAG_VIERTELFINALE = oid("00a3")
SPIELTAG_FINALE = oid("00a4")

# Each matchday's phase and its day, which is also the day every fixture on it is played: the write
# path reads the span back to judge the saved date.
SPIELTAGE = {
    SPIELTAG_GRUPPE: ("gruppenphase", "2026-03-15"),
    SPIELTAG_VIERTELFINALE: ("viertelfinale", "2026-04-10"),
    SPIELTAG_HALBFINALE: ("halbfinale", "2026-05-08"),
    SPIELTAG_FINALE: ("finale", "2026-06-05"),
}

UHRZEIT = "18:00:00"

# Where the save moves the edited fixture, so its own restore has a field outside the Paarung to put
# back. The time and never the date: a date off its Spieltag's span is refused (`REQ-DATE-001`).
SAVED_UHRZEIT = "19:30:00"

SETTLED_SEMI = oid("0011")
HELD = oid("0021")
FILLING = oid("0022")

# The chain: the quarter-final feeds the semi-final, which feeds the final. Its whole point is that
# each restore is legal only once the fixture before it has put its winner back.
VIERTELFINALE = oid("0031")
HALBFINALE = oid("0032")
FINALE = oid("0033")

# Read back off the stored documents, which key by `spiel_nr` rather than by id.
SETTLED_SEMI_NR = 5
HELD_NR = 11
FILLING_NR = 12

# Ascending across the chain, which is what makes `spiel_nr` order feeder-first: a `quelle` may name
# only a match played in an earlier round. Distinct from every number above, so a failure names one
# fixture of one seed.
VIERTELFINALE_NR = 21
HALBFINALE_NR = 22
FINALE_NR = 23

SPIELORT = oid("00b1")
SCHIEDSRICHTER = oid("00c1")

SPIELORT_NAME = "Sportplatz Ost"
SCHIEDSRICHTER_NAME = "A. Referee"

# Distinct per fixture, so a restore writing the wrong document shows rather than matching what
# belonged there.
SEMI_NOTIZ = "Verlängerung nur bei Gleichstand"
REPLAY_NOTIZ = "Platz getauscht, Anpfiff bleibt"
EDITED_NOTIZ = "Ballfänger hinter dem Tor fehlt"


def side(team_id: ObjectId, tore: int | None = None) -> dict[str, Any]:
    """One side as the DOCUMENT stores it, which is the shape every assertion below compares against."""

    name, shorthand = NAMES[team_id]

    return {"team_id": team_id, "name": name, "shorthand": shorthand, "tore": tore}


def booking() -> dict[str, Any]:
    """The ground as this fixture holds it -- the name and the link the venue's, the rent the fixture's."""

    return {"spielort_id": SPIELORT, "name": SPIELORT_NAME, "maps_link": f"{SPIELORT_NAME}, Frankfurt", "mietpreis": MIETPREIS}


def assignment() -> dict[str, Any]:
    return {"schiedsrichter_id": SCHIEDSRICHTER, "name": SCHIEDSRICHTER_NAME, "payment": PAYMENT}


def team_document(team_id: ObjectId) -> dict[str, Any]:
    name, shorthand = NAMES[team_id]

    return {
        "_id": team_id,
        "name": name,
        "shorthand": shorthand,
        "description": "",
        "full_name": f"{name}-Schule",
        "website_url": f"https://{name.lower()}.example.de",
        "address": dict(ADDRESS),
        # Present rather than omitted: the joined pipeline matches a missing field against `None`, so
        # the row would pass the filter and then fail validation.
        "inactive_since": None,
    }


def junction(team_id: ObjectId) -> dict[str, Any]:
    """The season's own copy of a club's name, which is where a saved side's name comes FROM."""

    name, shorthand = NAMES[team_id]

    return {"saison_id": SAISON_ID, "team_id": team_id, "gruppe": "A", "austritt": None, "name": name, "shorthand": shorthand}


def saison_document() -> dict[str, Any]:
    return {
        "_id": SAISON_ID,
        "start_date": "2026-01-01",
        "end_date": "2026-06-30",
        "status": "active",
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
    # Position 1 in each: the two sit in different phases, where the positions restart, so one number
    # for both still satisfies `uniq_saison_id_saison_phase_position`.
    return [
        {"_id": spieltag_id, "beginn": tag, "ende": tag, "position": 1, "saison_id": SAISON_ID, "saison_phase": saison_phase}
        for spieltag_id, (saison_phase, tag) in SPIELTAGE.items()
    ]


def spielort_document() -> dict[str, Any]:
    return {
        "_id": SPIELORT,
        "name": SPIELORT_NAME,
        "address": dict(ADDRESS),
        "maps_link": f"{SPIELORT_NAME}, Frankfurt",
        "default_mietpreis": DEFAULT_MIETPREIS,
        "inactive_since": None,
    }


def schiedsrichter_document() -> dict[str, Any]:
    return {
        "_id": SCHIEDSRICHTER,
        "name": SCHIEDSRICHTER_NAME,
        "schule": None,
        "default_payment": DEFAULT_PAYMENT,
        "kontakt": {"telefon": None, "email": None},
        "inactive_since": None,
        "anonymisiert_am": None,
    }


def spiel_document(
    *,
    spiel_id: ObjectId,
    spiel_nr: int,
    spieltag_id: ObjectId,
    team1: dict[str, Any] | None,
    team2: dict[str, Any] | None,
    ergebnis: str | None = None,
    elfmeterschiessen: dict[str, int] | None = None,
    notiz: str | None = None,
    booked: bool = False,
    team1_quelle: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Every key spelled out: `FLSpiel` defaults `notiz` alone, so an omitted one fails inside the handler."""

    saison_phase, tag = SPIELTAGE[spieltag_id]

    return {
        "_id": spiel_id,
        "spiel_nr": spiel_nr,
        "saison_id": SAISON_ID,
        "saison_phase": saison_phase,
        "spieltag_id": spieltag_id,
        "team1": team1,
        "team2": team2,
        # `team2_quelle` is null throughout, so every fixture keeps one side the admin owns: a
        # resolution refilling both slots would answer for the payload (`docs/backend/spec.md :: I23`).
        "team1_quelle": team1_quelle,
        "team2_quelle": None,
        "datum": tag,
        "uhrzeit": UHRZEIT,
        "ort": booking() if booked else None,
        "schiedsrichter": assignment() if booked else None,
        "ergebnis": ergebnis,
        "elfmeterschiessen": elfmeterschiessen,
        "sonderereignis": None,
        "notiz": notiz,
    }


def a_settled_semi_final() -> list[dict[str, Any]]:
    """One knockout fixture that went to penalties, both slots the admin's own and both references booked."""

    return [
        spiel_document(
            spiel_id=SETTLED_SEMI,
            spiel_nr=SETTLED_SEMI_NR,
            spieltag_id=SPIELTAG_HALBFINALE,
            team1=side(BETA, 2),
            team2=side(GAMMA, 2),
            ergebnis="2:2",
            elfmeterschiessen={"team1": 4, "team2": 3},
            notiz=SEMI_NOTIZ,
            booked=True,
        )
    ]


def one_spieltag_holding_a_played_fixture() -> list[dict[str, Any]]:
    """A played fixture and an unfilled one on ONE Spieltag, which is what makes fielding Alpha in the second release the first."""

    return [
        spiel_document(
            spiel_id=HELD,
            spiel_nr=HELD_NR,
            spieltag_id=SPIELTAG_GRUPPE,
            team1=side(ALPHA, 2),
            team2=side(GAMMA, 1),
            ergebnis="2:1",
            booked=True,
        ),
        # Nothing booked, so the second save's own double-booking read reaches no other fixture and
        # cannot be what a failure here is about.
        spiel_document(spiel_id=FILLING, spiel_nr=FILLING_NR, spieltag_id=SPIELTAG_GRUPPE, team1=None, team2=side(DELTA)),
    ]


def a_knockout_chain() -> list[dict[str, Any]]:
    """Three rounds a result runs the length of: the quarter-final's winner plays the semi-final, whose winner plays the final.

    Every fixture is decided, so one edit at the top empties both scorelines below it.
    """

    return [
        # Neither side wired: the admin owns both, so the save below can change who won here.
        spiel_document(
            spiel_id=VIERTELFINALE,
            spiel_nr=VIERTELFINALE_NR,
            spieltag_id=SPIELTAG_VIERTELFINALE,
            team1=side(ALPHA, 2),
            team2=side(BETA, 1),
            ergebnis="2:1",
        ),
        spiel_document(
            spiel_id=HALBFINALE,
            spiel_nr=HALBFINALE_NR,
            spieltag_id=SPIELTAG_HALBFINALE,
            team1=side(ALPHA, 1),
            team2=side(GAMMA, 0),
            ergebnis="1:0",
            team1_quelle={"type": "spiel", "spiel_nr": VIERTELFINALE_NR, "ausgang": "sieger"},
        ),
        spiel_document(
            spiel_id=FINALE,
            spiel_nr=FINALE_NR,
            spieltag_id=SPIELTAG_FINALE,
            team1=side(ALPHA, 2),
            team2=side(DELTA, 0),
            ergebnis="2:0",
            team1_quelle={"type": "spiel", "spiel_nr": HALBFINALE_NR, "ausgang": "sieger"},
        ),
    ]


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_seeded_season(url: str, body: Body, *, spiele: list[dict[str, Any]]) -> Any:
    """The SHIPPED validators and indexes, so a document production would refuse fails here too."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME) as (client, database):
            # Process-global and keyed by season id, so an entry another module left would answer for this one.
            invalidate_saison_cache()

            await database[Collection.SAISONS].insert_one(saison_document())
            await database[Collection.TEAMS].insert_many([team_document(team_id) for team_id in NAMES])
            await database[Collection.SAISON_TEAMS].insert_many([junction(team_id) for team_id in NAMES])
            await database[Collection.SPIELTAGE].insert_many(spieltag_documents())
            await database[Collection.SPIELORTE].insert_one(spielort_document())
            await database[Collection.SCHIEDSRICHTER].insert_one(schiedsrichter_document())
            await database[Collection.SPIELE].insert_many(spiele)

            return await body(database, client)

    return on_the_seed_loop(_run())


def _dependencies(database: AsyncDatabase, client: AsyncMongoClient) -> dict[str, Any]:
    """The collections and the client both write routes take, which FastAPI resolves in a served request."""

    return {
        "db": client,
        "spiele_collection": database[Collection.SPIELE],
        "teams_collection": database[Collection.TEAMS],
        "saisons_collection": database[Collection.SAISONS],
        "saison_teams_collection": database[Collection.SAISON_TEAMS],
        "spieltage_collection": database[Collection.SPIELTAGE],
        "spielorte_collection": database[Collection.SPIELORTE],
        "schiedsrichter_collection": database[Collection.SCHIEDSRICHTER],
    }


async def call_patch(
    database: AsyncDatabase, client: AsyncMongoClient, spiel_id: ObjectId, spiel_data: FLPatchSpielDataPayload
) -> FLPatchSpielDataResponse:
    return await patch_spiel_data(spiel_id=spiel_id, spiel_data=spiel_data, dry_run=False, **_dependencies(database, client))


async def call_replay(
    database: AsyncDatabase, client: AsyncMongoClient, paarungen: list[FLPatchSpielPaarungPayload]
) -> FLPatchSpielePaarungenResponse:
    """The whole undo as one request, which is the only shape it has: the list travels in the order it is given."""

    payload = FLPatchSpielePaarungenPayload(paarungen=paarungen)

    return await patch_spiele_paarungen(payload=payload, **_dependencies(database, client))


async def payload_for(database: AsyncDatabase, spiel_id: ObjectId, **overrides: Any) -> FLPatchSpielDataPayload:
    """The stored fixture as a payload changing nothing but `overrides`.

    Read off the document: the wholesale endpoint erases a field the payload leaves out, so a
    hand-written one would make the case about that instead.
    """

    stored = await database[Collection.SPIELE].find_one({"_id": spiel_id})
    assert stored is not None, f"the seed holds no fixture {spiel_id}"

    return FLPatchSpielDataPayload.model_validate(spiel_patch_body(stored, **overrides))


async def stored_spiel(database: AsyncDatabase, spiel_id: ObjectId) -> dict[str, Any]:
    """The RAW document, read outside any transaction -- what a later request would see.

    A model would answer with its own default for a key the write dropped.
    """

    found = await database[Collection.SPIELE].find_one({"_id": spiel_id})
    assert found is not None, f"the fixture {spiel_id} is gone, which no write path here may do"

    return found


class TestARewrittenPaarungLeavesNoScoreline:
    """The goals were scored between two clubs, and a different pairing stands there after the rewrite."""

    def test_the_scoreline_and_the_shoot_out_go_with_the_replaced_occupant(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            answered = await call_replay(
                database,
                client,
                [
                    FLPatchSpielPaarungPayload.model_validate(
                        {
                            "spiel_id": SETTLED_SEMI,
                            "team1": {"team_id": ALPHA, "tore": None},
                            "team2": {"team_id": GAMMA, "tore": None},
                            "elfmeterschiessen": None,
                            "sonderereignis": None,
                            # Nothing beyond the Paarung, which is what leaves the fields asserted
                            # below the stored document's rather than this request's.
                            "other_fields": None,
                        }
                    )
                ],
            )

            return answered, await stored_spiel(database, SETTLED_SEMI)

        answered, semi = on_a_seeded_season(mongo_replica_set_url, body, spiele=a_settled_semi_final())

        assert (semi["team1"], semi["team2"]) == (side(ALPHA), side(GAMMA))
        assert (semi["ergebnis"], semi["elfmeterschiessen"]) == (None, None)

        # Read off the DOCUMENT and not off the payload: what the narrowing is worth is what the
        # request never named still standing afterwards.
        assert (semi["datum"], semi["uhrzeit"], semi["notiz"]) == (SPIELTAGE[SPIELTAG_HALBFINALE][1], UHRZEIT, SEMI_NOTIZ)
        assert (semi["ort"], semi["schiedsrichter"]) == (booking(), assignment())

        assert (answered.advanced_to, answered.released_sides) == ([], [])


class TestAnUndoReplayPutsTheFixtureBackAsItStood:
    """The whole sequence `fl_frontend/src/app/api/admin/spiele/undo/route.ts` runs, driven end to end.

    Every fixture goes back in one request, the edited one leading, which frees the club the moved
    one is about to claim again (`docs/backend/spec.md :: I215`).
    """

    def _replayed(self, url: str) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], FLPatchSpielePaarungenResponse]:
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            saved = await call_patch(
                database,
                client,
                FILLING,
                await payload_for(database, FILLING, team1={"team_id": ALPHA, "tore": None}, uhrzeit=SAVED_UHRZEIT),
            )
            released = await stored_spiel(database, HELD)

            # Between the save and the restore, and by a writer the undo knows nothing about: on the
            # edited fixture as well, which is the half no report can tell from a field it replaced.
            for spiel_id, notiz in ((HELD, REPLAY_NOTIZ), (FILLING, EDITED_NOTIZ)):
                await database[Collection.SPIELE].update_one({"_id": spiel_id}, {"$set": {"notiz": notiz}})

            # Composed from what the SAVE reported rather than from the seed, which is the only shape
            # the undo has to replay from, and sent in the order it reported.
            replayed = await call_replay(
                database, client, [FLPatchSpielPaarungPayload(**prior.model_dump()) for prior in saved.prior_paarungen]
            )

            return released, await stored_spiel(database, FILLING), await stored_spiel(database, HELD), replayed

        return on_a_seeded_season(url, body, spiele=one_spieltag_holding_a_played_fixture())

    def test_the_occupants_and_the_scoreline_come_back_together(self, mongo_replica_set_url: str):
        released, _, held, replayed = self._replayed(mongo_replica_set_url)

        # The save really did empty it, so the restore below has something to put back rather than a
        # fixture that never moved.
        assert (released["team1"], released["team2"], released["ergebnis"]) == (None, side(GAMMA), None)

        assert (held["team1"], held["team2"]) == (side(ALPHA, 2), side(GAMMA, 1))
        assert held["ergebnis"] == "2:1"

        # Nothing else moved: the edited fixture went back first, so Alpha was free to claim, and the
        # replay owed the admin no report of its own.
        assert (replayed.advanced_to, replayed.released_sides, replayed.bracket_faults) == ([], [], [])

    def test_a_note_written_between_the_save_and_the_replay_survives_it(self, mongo_replica_set_url: str):
        """The narrowing, against a database: the wholesale payload would carry the note the save saw and revert this one."""

        _, _, held, _ = self._replayed(mongo_replica_set_url)

        # First, so the note below is read off a fixture the restore WROTE: a restore that landed
        # nothing leaves the note standing too, and this case alone would pass for it.
        assert held["ergebnis"] == "2:1"

        assert held["notiz"] == REPLAY_NOTIZ
        # Beside the note, because both are fields the request never named and one alone would not
        # say whether the restore reads the document or the payload.
        assert (held["ort"], held["schiedsrichter"]) == (booking(), assignment())

    def test_a_note_written_on_the_edited_fixture_survives_its_own_restore(self, mongo_replica_set_url: str):
        """The one fixture whose report also carries fields beyond the Paarung, so its restore is the one that has to choose."""

        _, filling, _, _ = self._replayed(mongo_replica_set_url)

        # First: a restore that landed nothing leaves the note standing too.
        assert filling["team1"] is None

        assert filling["notiz"] == EDITED_NOTIZ

    def test_the_time_the_save_moved_on_the_edited_fixture_comes_back(self, mongo_replica_set_url: str):
        """The other half of `other_fields`: naming no field at all would leave the save's own edit standing."""

        _, filling, _, _ = self._replayed(mongo_replica_set_url)

        assert filling["uhrzeit"] == UHRZEIT


class TestAChainOfRoundsGoesBackWholeOrNotAtAll:
    """The case the single transaction exists for: one edit at the top of a bracket empties every scoreline under it.

    A replay stopping part-way leaves the occupants back and the results gone, with no second press.
    """

    async def _saved(self, database: AsyncDatabase, client: AsyncMongoClient) -> FLPatchSpielDataResponse:
        """The edit that turns the quarter-final round: Beta wins it, and the two rounds below lose their results."""

        return await call_patch(
            database,
            client,
            VIERTELFINALE,
            await payload_for(database, VIERTELFINALE, team1={"team_id": ALPHA, "tore": 1}, team2={"team_id": BETA, "tore": 2}),
        )

    async def _chain(self, database: AsyncDatabase) -> list[dict[str, Any]]:
        """The three fixtures as the database holds them, in playing order."""

        return [await stored_spiel(database, spiel_id) for spiel_id in (VIERTELFINALE, HALBFINALE, FINALE)]

    def test_the_save_empties_both_rounds_below_it(self, mongo_replica_set_url: str):
        """The floor: without it every case below could pass over a save that moved nothing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            saved = await self._saved(database, client)

            return saved, await self._chain(database)

        saved, (_, halbfinale, finale) = on_a_seeded_season(mongo_replica_set_url, body, spiele=a_knockout_chain())

        assert (halbfinale["team1"], halbfinale["team2"], halbfinale["ergebnis"]) == (side(BETA), side(GAMMA), None)
        assert (finale["team1"], finale["team2"], finale["ergebnis"]) == (None, side(DELTA), None)

        # The report the undo replays, and the whole of what the admin has left of those two results.
        assert [prior.spiel_id for prior in saved.prior_paarungen] == [VIERTELFINALE, HALBFINALE, FINALE]

    def test_the_reported_order_puts_the_whole_chain_back(self, mongo_replica_set_url: str):
        """Feeder-first, which is what `spiel_nr` order buys: each restore's resolution refills the slot the next one writes into."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            saved = await self._saved(database, client)
            replayed = await call_replay(
                database, client, [FLPatchSpielPaarungPayload(**prior.model_dump()) for prior in saved.prior_paarungen]
            )

            return replayed, await self._chain(database)

        replayed, (viertelfinale, halbfinale, finale) = on_a_seeded_season(mongo_replica_set_url, body, spiele=a_knockout_chain())

        assert (viertelfinale["team1"], viertelfinale["team2"], viertelfinale["ergebnis"]) == (side(ALPHA, 2), side(BETA, 1), "2:1")
        assert (halbfinale["team1"], halbfinale["team2"], halbfinale["ergebnis"]) == (side(ALPHA, 1), side(GAMMA, 0), "1:0")
        assert (finale["team1"], finale["team2"], finale["ergebnis"]) == (side(ALPHA, 2), side(DELTA, 0), "2:0")

        # The replay's own rewrites are not reported: each names a fixture the list puts back after
        # it, which is the order working rather than a result the admin lost.
        assert (replayed.advanced_to, replayed.released_sides, replayed.bracket_faults) == ([], [], [])

    def test_a_reversed_order_is_refused_and_leaves_the_season_untouched(self, mongo_replica_set_url: str):
        """A wrong order is refused rather than silently accepted: the final leads, and its occupant is not the one stored under it.

        Sent in reverse rather than with a hand-built refusal, which is the shape a wrong order takes.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            saved = await self._saved(database, client)
            after_the_save = await self._chain(database)

            refused: str | None = None
            try:
                await call_replay(
                    database, client, [FLPatchSpielPaarungPayload(**prior.model_dump()) for prior in reversed(saved.prior_paarungen)]
                )
            except DocumentConflictException as conflict:
                refused = conflict.error_code

            return refused, after_the_save, await self._chain(database)

        refused, after_the_save, after_the_replay = on_a_seeded_season(mongo_replica_set_url, body, spiele=a_knockout_chain())

        assert refused == "REQ-WIRING-001"
        assert after_the_replay == after_the_save

    def test_an_entry_that_committed_before_a_later_refusal_is_taken_back_with_it(self, mongo_replica_set_url: str):
        """The rollback itself: the quarter-final's restore lands and the final's behind it is refused.

        The one order a transaction per entry survives, leaving that first write standing.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            saved = await self._saved(database, client)
            after_the_save = await self._chain(database)

            # The quarter-final first, so its restore is legal; the final second, whose slot the
            # semi-final has not refilled yet, so `REQ-WIRING-001` refuses it.
            named, halbfinale, finale = saved.prior_paarungen
            order = (named, finale, halbfinale)

            refused: str | None = None
            try:
                await call_replay(database, client, [FLPatchSpielPaarungPayload(**prior.model_dump()) for prior in order])
            except DocumentConflictException as conflict:
                refused = conflict.error_code

            return refused, after_the_save, await self._chain(database)

        refused, after_the_save, after_the_replay = on_a_seeded_season(mongo_replica_set_url, body, spiele=a_knockout_chain())

        assert refused == "REQ-WIRING-001"

        # Named, so the state the rollback restored is readable without the comparison below: Beta
        # still holds the quarter-final the save gave it, and the restore that landed is gone.
        viertelfinale = after_the_replay[0]
        assert (viertelfinale["team1"], viertelfinale["team2"], viertelfinale["ergebnis"]) == (side(ALPHA, 1), side(BETA, 2), "1:2")

        # Every field of every fixture, not the Paarung alone: a rolled-back transaction leaves the
        # documents byte for byte, and comparing three of their keys would pass over a partial write.
        assert after_the_replay == after_the_save

    def test_what_the_replay_destroys_and_does_not_put_back_is_reported(self, mongo_replica_set_url: str):
        """A fixture the list never names loses its result to the replay, and the admin is told.

        The final is left out of the body, so restoring the rounds above it empties it and nothing puts it back.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            saved = await self._saved(database, client)

            # The final's result restored by hand, so the replay below has one to destroy: the save
            # already took it, and this case is about what the REPLAY costs.
            await database[Collection.SPIELE].update_one(
                {"_id": FINALE}, {"$set": {"team1": side(ALPHA, 2), "team2": side(DELTA, 0), "ergebnis": "2:0"}}
            )

            replayed = await call_replay(
                database,
                client,
                [FLPatchSpielPaarungPayload(**prior.model_dump()) for prior in saved.prior_paarungen if prior.spiel_id != FINALE],
            )

            return replayed, await stored_spiel(database, FINALE)

        replayed, finale = on_a_seeded_season(mongo_replica_set_url, body, spiele=a_knockout_chain())

        # Alpha comes back out of the semi-final and into the final, which costs the scoreline
        # standing there -- and the body named no entry to write it back.
        assert (finale["team1"], finale["ergebnis"]) == (side(ALPHA), None)

        # ONE entry, naming the result that really stood there: both restores rewrite this fixture,
        # and the second finds it already empty, so a second entry would name a loss of nothing.
        assert [(entry.spiel_nr, entry.voided_ergebnis) for entry in replayed.advanced_to] == [(FINALE_NR, "2:0")]
