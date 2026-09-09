"""
API · the narrow restore route, driven against a real mongod because only the stored fixture answers

`PATCH /spiele/{spiel_id}/paarung` is what a season's undo replays every fixture through, the one the
save itself named included, and its response reports what the write MEANT to do, so a case reading
that alone would still pass the day the write stopped landing: every assertion below re-reads the
fixture out of the database. The refusals and the composition are
`tests/api/test_spiele_write_execution.py`'s, and completing a narrowed payload off the stored
fixture is `tests/api/test_bracket.py`'s; nothing here re-decides either.
"""

from typing import Any, Awaitable, Callable

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.cache import invalidate_saison_cache
from app.api.spiele.admin_router import patch_spiel_data, patch_spiel_paarung
from app.api.spiele.schemas import FLPatchSpielDataPayload, FLPatchSpielDataResponse, FLPatchSpielPaarungPayload
from app.core.collections import Collection
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

# Each matchday's phase and its day, which is also the day every fixture on it is played: the write
# path reads the span back to judge the saved date.
SPIELTAGE = {SPIELTAG_GRUPPE: ("gruppenphase", "2026-03-15"), SPIELTAG_HALBFINALE: ("halbfinale", "2026-05-08")}

UHRZEIT = "18:00:00"

# Where the save moves the edited fixture, so its own restore has a field outside the Paarung to put
# back. The time and never the date: a date off its Spieltag's span is refused (`REQ-DATE-001`).
SAVED_UHRZEIT = "19:30:00"

SETTLED_SEMI = oid("0011")
HELD = oid("0021")
FILLING = oid("0022")

# Read back off the stored documents, which key by `spiel_nr` rather than by id.
SETTLED_SEMI_NR = 5
HELD_NR = 11
FILLING_NR = 12

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
        # Null on both sides of every fixture here: the restore reads a `quelle` off the document
        # rather than out of the request, so a resolution refilling the slot would answer for it
        # instead (`docs/backend/spec.md :: I23`).
        "team1_quelle": None,
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


async def call_paarung(
    database: AsyncDatabase, client: AsyncMongoClient, spiel_id: ObjectId, paarung: FLPatchSpielPaarungPayload
) -> FLPatchSpielDataResponse:
    return await patch_spiel_paarung(spiel_id=spiel_id, spiel_paarung=paarung, **_dependencies(database, client))


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
            answered = await call_paarung(
                database,
                client,
                SETTLED_SEMI,
                FLPatchSpielPaarungPayload.model_validate(
                    {
                        "team1": {"team_id": ALPHA, "tore": None},
                        "team2": {"team_id": GAMMA, "tore": None},
                        "elfmeterschiessen": None,
                        "sonderereignis": None,
                        # Nothing beyond the Paarung, which is what leaves the fields asserted below
                        # the stored document's rather than this request's.
                        "other_fields": None,
                    }
                ),
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

    Every fixture goes back through the narrow route, the edited one leading, which frees the club the
    moved one is about to claim again (`docs/backend/spec.md :: I215`).
    """

    def _replayed(self, url: str) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], list[FLPatchSpielDataResponse]]:
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
            # the undo has to replay from, and replayed in the order it reported.
            replayed = [
                await call_paarung(database, client, prior.spiel_id, FLPatchSpielPaarungPayload(**prior.model_dump(exclude={"spiel_id"})))
                for prior in saved.prior_paarungen
            ]

            return released, await stored_spiel(database, FILLING), await stored_spiel(database, HELD), replayed

        return on_a_seeded_season(url, body, spiele=one_spieltag_holding_a_played_fixture())

    def test_the_occupants_and_the_scoreline_come_back_together(self, mongo_replica_set_url: str):
        released, _, held, replayed = self._replayed(mongo_replica_set_url)

        # The save really did empty it, so the restore below has something to put back rather than a
        # fixture that never moved.
        assert (released["team1"], released["team2"], released["ergebnis"]) == (None, side(GAMMA), None)

        assert (held["team1"], held["team2"]) == (side(ALPHA, 2), side(GAMMA, 1))
        assert held["ergebnis"] == "2:1"

        # Nothing else moved with either: the edited fixture went back first, so Alpha was free to claim.
        assert [(answered.advanced_to, answered.released_sides) for answered in replayed] == [([], []), ([], [])]

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
