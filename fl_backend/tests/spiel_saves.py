"""
TESTS · a season whose fixtures a case saves, and the save run by the route's own function outside a request

Each suite seeds it on a database of its own.
"""

from datetime import datetime
from typing import Any

from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.spiele.admin_router import patch_spiel
from app.api.spiele.schemas import (
    FLPatchSpielDataPayload,
    FLPatchSpielDataResponse,
    FLSpielVoidedErgebnis,
)
from app.core import clock
from app.core.collections import Collection
from tests import documents
from tests.handles import wired
from tests.payloads import spiel_patch_body
from tests.stored import the_row

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

# Read back off the stored documents, which key by `spiel_nr` rather than by id.
VIERTELFINALE_NR = 1
HALBFINALE_NR = 5


def side(team_id: ObjectId, tore: int | None = None) -> dict[str, Any]:
    """A side as a fixture stores it: the club and its goals, its name joined at read."""

    return {"team_id": team_id, "tore": tore}


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

    rules = documents.rules_document(win_points=3, draw_points=1, qualifiers_per_gruppe=2, tiebreak_order="tordifferenz")

    return documents.saison_document(SAISON_ID, "active", rules=rules)


def spieltag_documents() -> list[dict[str, Any]]:
    # Position 1 in each: the three sit in three different phases, where the positions restart, so
    # one number for all of them still satisfies `uniq_saison_id_saison_phase_position`.
    return [
        documents.spieltag_document(spieltag_id, SAISON_ID, 1, saison_phase=saison_phase, start=start, end=end)
        for spieltag_id, (saison_phase, start, end) in SPIELTAGE.items()
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
    saison_phase, date, _ = SPIELTAGE[spieltag_id]

    # `spielort` and `schiedsrichter` stay null, so a payload built from this document claims neither, and
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
        date=date,
        time="18:00:00",
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


SPIELORT = ObjectId("6890a1b2c3d4e5f6072200b1")
SPIELORT_RETIRED = ObjectId("6890a1b2c3d4e5f6072200b2")

SCHIEDSRICHTER = ObjectId("6890a1b2c3d4e5f6072200c1")
SCHIEDSRICHTER_RETIRED = ObjectId("6890a1b2c3d4e5f6072200c2")
# Entered by an administrator, its person's confirmation not yet in.
SCHIEDSRICHTER_UNCONFIRMED = ObjectId("6890a1b2c3d4e5f6072200c3")

RETIRED_ON = "2026-02-01"

VENUES = {SPIELORT: ("Sportplatz Ost", None), SPIELORT_RETIRED: ("Bezirkssportanlage West", RETIRED_ON)}
REFEREES = {
    SCHIEDSRICHTER: ("A. Referee", None),
    SCHIEDSRICHTER_RETIRED: ("B. Whistle", RETIRED_ON),
    SCHIEDSRICHTER_UNCONFIRMED: ("C. Pfiff", None),
}


def venue_documents() -> list[dict[str, Any]]:
    """One live ground and one retired, so a refusal about RETIREMENT cannot pass because the id resolved to nothing.

    The default rent is the ground's own and never the rent a fixture agreed, which `booking` sets.
    """

    return [
        documents.spielort_document(spielort_id, name, default_mietpreis=DEFAULT_MIETPREIS, inactive_since=inactive_since)
        for spielort_id, (name, inactive_since) in VENUES.items()
    ]


def referee_documents() -> list[dict[str, Any]]:
    return [
        documents.schiedsrichter_document(
            schiedsrichter_id,
            # Every referee record holds an address: an administrator enters each, and it is how the person learns of it.
            email=f"schiedsrichter.{schiedsrichter_id}@example.com",
            name=name,
            default_payment=DEFAULT_PAYMENT,
            # Every row confirmed by its person but the one a case books unconfirmed.
            einwilligung=(
                None
                if schiedsrichter_id == SCHIEDSRICHTER_UNCONFIRMED
                else documents.own_einwilligung_document(text_versions=documents.SCHIEDSRICHTER_TEXT_VERSIONS, confirmed_at="2026-01-20")
            ),
            inactive_since=inactive_since,
        )
        for schiedsrichter_id, (name, inactive_since) in REFEREES.items()
    ]


async def the_season(database: AsyncDatabase, spiele: list[dict[str, Any]]) -> None:
    """The season, its clubs, matchdays, venues and referees, and `spiele` on it."""

    await database[Collection.SAISONS].insert_one(saison_document())
    # Always, not per scenario: a `gruppe` slot seeds from the table these rows are ranked in.
    await database[Collection.TEAMS].insert_many([team_document(team_id) for team_id in NAMES])
    await database[Collection.SAISON_TEAMS].insert_many([junction(team_id) for team_id in NAMES])
    await database[Collection.SPIELTAGE].insert_many(spieltag_documents())
    # Always, not per scenario: every save composes its stored names from these rows.
    await database[Collection.SPIELORTE].insert_many(venue_documents())
    await database[Collection.SCHIEDSRICHTER].insert_many(referee_documents())
    await database[Collection.SPIELE].insert_many(spiele)


async def call_patch(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    spiel_id: ObjectId,
    spiel_data: FLPatchSpielDataPayload,
    *,
    dry_run: bool = False,
    adopts_bericht: int | None = None,
    confirming: list[FLSpielVoidedErgebnis] | None = None,
    now: datetime | None = None,
    aufstellungen: Any = None,
    spiele: Any = None,
    spielbestaetigungen: Any = None,
) -> FLPatchSpielDataResponse:
    """The save as the editor sends it: confirming the later results its own dry run says it deletes, unless `confirming` names them."""

    if not dry_run and confirming is None:
        confirming = (await call_patch(database, client, spiel_id, spiel_data, dry_run=True, now=now)).voided_ergebnisse

    # The handles a case hands in by name, each in place of the one wired off `database`.
    replaced = {"spiele_collection": spiele, "aufstellungen_collection": aufstellungen, "spielbestaetigungen_collection": spielbestaetigungen}

    # The request's snapshot session, which the administrator's guard opens and the dry run reads in.
    async with client.start_session(snapshot=True) as session:
        return await patch_spiel(
            spiel_id=spiel_id,
            spiel_data=spiel_data if confirming is None else spiel_data.model_copy(update={"voided_ergebnisse": confirming}),
            db=client,
            **wired(patch_spiel, database, **{name: handle for name, handle in replaced.items() if handle is not None}),
            adopts_bericht=adopts_bericht,
            germany_now=ADOPTED_AT if now is None else now,
            dry_run=dry_run,
            session=session,
        )


async def payload_for(database: AsyncDatabase, spiel_id: ObjectId, **overrides: Any) -> FLPatchSpielDataPayload:
    """The stored fixture as a payload changing nothing but `overrides`.

    Read off the document because this endpoint writes wholesale: a field a test left out would be
    erased rather than kept, and the test would be about that instead.
    """

    stored = await the_row(database, Collection.SPIELE, {"_id": spiel_id}, f"the seed holds no fixture {spiel_id}")

    return FLPatchSpielDataPayload.model_validate(spiel_patch_body(stored, **overrides))


async def spiele_now(database: AsyncDatabase) -> dict[int, dict[str, Any]]:
    """The RAW documents, keyed by `spiel_nr`: a model would answer with its own defaults for a key the write dropped."""

    rows = await database[Collection.SPIELE].find({"saison_id": SAISON_ID}).to_list(length=None)

    return {row["spiel_nr"]: row for row in rows}


# The instant the save runs at.
ADOPTED_AT = datetime(2026, 5, 2, 12, tzinfo=clock.GERMANY)
# Past the first write, so a stamp matching a constant rather than the version the editor read cannot pass.
SEEDED_VERSION = 2


def a_report_on(spiel: dict[str, Any], *, version: int) -> dict[str, Any]:
    return documents.spielbericht_document(spiel, version=version)


async def reports_now(database: AsyncDatabase) -> dict[ObjectId, dict[str, Any]]:
    """Each report's document, keyed by its fixture."""

    rows = await database[Collection.SPIELBERICHTE].find({}).to_list(length=None)

    return {row["spiel_id"]: row for row in rows}


async def with_reports(database: AsyncDatabase, reports: list[dict[str, Any]]) -> dict[ObjectId, dict[str, Any]]:
    """`reports` stored, and each document as read back: a stored instant returns without the zone it was written with."""

    await database[Collection.SPIELBERICHTE].insert_many(reports)

    return await reports_now(database)


def a_bracket_with_reports(*, quarter_final_at: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """The bracket season, its quarter-final's report at `quarter_final_at` and the semi-final's at the seeded version."""

    spiele = bracket_season()
    quarter, semi = spiele

    return spiele, [a_report_on(quarter, version=quarter_final_at), a_report_on(semi, version=SEEDED_VERSION)]
