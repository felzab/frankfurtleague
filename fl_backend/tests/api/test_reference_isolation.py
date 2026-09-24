"""
API · a club's, a venue's and a referee's retirement, rename and booking, each driven with its rival landing inside its window

A retirement judges the rows an entry or a booking writes, which judges the date the retirement
stamps; a rename rewrites the copies it can see while a booking copies the name it read; and
`REQ-CLASH-001` reads other fixtures while each save writes only its own. Neither write of a pair
writes what the other reads, so each pair conflicts only on the anchor the booking takes on the row
it names. Each case runs one write to completion between the other's judgement and its write; the
refusals themselves are decided on in `tests/api/test_team_retire_refusal.py`,
`tests/api/test_team_entry_refusal.py`, `tests/api/test_containment_refusals.py` and
`tests/api/test_occupant_refusal.py`.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.admin_router import annehmen_bewerbung
from app.api.bewerbungen.schemas import FLAnnehmenBewerbungPayload
from app.api.schiedsrichter.admin_router import anonymise_schiedsrichter, delete_schiedsrichter, patch_schiedsrichter
from app.api.schiedsrichter.schemas import FLPatchSchiedsrichterPayload
from app.api.schiedsrichter.services import REFEREE_STILL_ASSIGNED
from app.api.spiele.admin_router import patch_spiel_data, patch_spiele_paarungen
from app.api.spiele.schemas import FLPatchSpielDataPayload, FLPatchSpielePaarungenPayload, unplayed_filter
from app.api.spiele.services import BOOKING_UNKNOWN_RESOURCE, FIXTURE_DOUBLE_BOOKED
from app.api.spielorte.admin_router import delete_spielort, patch_spielort
from app.api.spielorte.schemas import FLPatchSpielortPayload
from app.api.spielorte.services import VENUE_STILL_BOOKED
from app.api.teams.admin_router import delete_team, patch_team, post_saison_team, replace_saison_team
from app.api.teams.schemas import FLPatchTeamPayload, FLPostSaisonTeamPayload, FLReplaceSaisonTeamPayload
from app.api.teams.services import CLUB_RETIRED, RETIRE_BLOCKED
from app.core.collections import Collection
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID
from tests.config import build_test_config
from tests.database import a_clean_database, on_the_seed_loop
from tests.isolation import COMMITTED, outcome_of
from tests.payloads import spiel_patch_body
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_reference_isolation_test")

CONFIG = build_test_config()

TODAY = "2026-04-01"


SAISON = "2026"
RETIRED_ON = "2026-03-01"

# The erasure's clock, on the day it stamps: the redaction reads the instant and the retirement the day.
ERASED_AT = datetime(2026, 3, 1, 12, 0, tzinfo=ZoneInfo("Europe/Berlin"))

ACCEPTED_BY = "triage.quillhilde@example.com"

CLUB = ObjectId("6890a1b2c3d4e5f608270001")
# The club a replacement hands its row away from, standing in the season already.
OUTGOING = ObjectId("6890a1b2c3d4e5f608270002")
BEWERBUNG = ObjectId("6890a1b2c3d4e5f608270003")

SPIELTAG = ObjectId("6890a1b2c3d4e5f608280001")
FIXTURE = ObjectId("6890a1b2c3d4e5f608280002")
VENUE = ObjectId("6890a1b2c3d4e5f608280003")
REFEREE = ObjectId("6890a1b2c3d4e5f608280004")
# The two fixtures beside `FIXTURE` that the clash cases book the same row onto.
SECOND_FIXTURE = ObjectId("6890a1b2c3d4e5f608280005")
THIRD_FIXTURE = ObjectId("6890a1b2c3d4e5f608280006")

ADDRESS = {"strasse": "Hanauer Landstraße", "hausnummer": "12a", "plz": "60314", "stadtteil": "Ostend", "stadt": "Frankfurt am Main"}
SEED_MAPS_LINK = "Sportplatz Ostpark, Hanauer Landstraße 12a, 60314 Frankfurt am Main, Deutschland"

# Neither played nor still to play, so no retirement is refused for it and the erasure leaves its booking.
CALLED_OFF = "ausgefallen"

NOTE = "Anstoß bleibt"


def saison_document() -> dict[str, Any]:
    """`future`, the one status every entry writer admits and `REQ-RETIRE-001` refuses."""

    return {
        "_id": SAISON,
        "start_date": "2026-01-01",
        "end_date": "2026-06-30",
        "status": "future",
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


def team_document(team_id: ObjectId, shorthand: str) -> dict[str, Any]:
    return {
        "_id": team_id,
        "name": f"Schule {shorthand}",
        "shorthand": shorthand,
        "description": "",
        "full_name": f"Schule {shorthand} Gesamtschule",
        "website_url": "https://example.de",
        "address": ADDRESS,
        "inactive_since": None,
    }


def kontaktperson(vorname: str) -> dict[str, Any]:
    return {
        "vorname": vorname,
        "nachname": f"{vorname}-Mustermann",
        "email": f"{vorname.lower()}@example.com",
        "telefon": "+49 69 1234567",
        "geburtsdatum": "1980-05-04",
        "einwilligung": {"umfang": "kontaktdaten", "erfasst_von": "person", "text_version": "v1", "datum": "2026-01-15"},
    }


def bewerbung_document() -> dict[str, Any]:
    """An application picking `CLUB` with no `bestaetigungen`, so its acceptance meets `REQ-ENTER-005` and never `REQ-BEWERBUNG-013`."""

    return {
        "_id": BEWERBUNG,
        "saison_id": SAISON,
        "eingereicht_am": "2026-02-01",
        "status": "eingereicht",
        "team_id": CLUB,
        "schule": None,
        "kontakte": {
            "trainer": kontaktperson("Wraxlington"),
            "ansprechperson": kontaktperson("Quillhilde"),
            "stellvertretung": kontaktperson("Bramblewick"),
            "trainer_ist_zugleich": None,
        },
        "trikot": {"vorhandener_satz": "16 rote Trikots, Größe M", "wunschfarbe": "rot"},
        "kader": {"voraussichtliche_groesse": 14, "gute_spieler": 3},
        "entscheidung": None,
    }


def fixture_document(**overrides: Any) -> dict[str, Any]:
    """A group fixture still to be played, holding no venue and no referee unless `overrides` books one."""

    return {
        "_id": FIXTURE,
        "spiel_nr": 1,
        "saison_id": SAISON,
        "saison_phase": "gruppenphase",
        "spieltag_id": SPIELTAG,
        "team1": None,
        "team2": None,
        "team1_quelle": None,
        "team2_quelle": None,
        "datum": "2026-03-15",
        "uhrzeit": "14:00:00",
        "ort": None,
        "schiedsrichter": None,
        "ergebnis": None,
        "elfmeterschiessen": None,
        "sonderereignis": None,
        "notiz": None,
        **overrides,
    }


# Every row a booking names is anchored once already, as one booked before is: a `$set` of a constant
# then rewrites nothing and conflicts with no retirement, where on a fresh row it would pass for the `$inc`.
LEAGUE: dict[Collection, list[dict[str, Any]]] = {
    Collection.SAISONS: [saison_document()],
    Collection.TEAMS: [{**team_document(CLUB, "CL"), "bounded_writes": 1}, team_document(OUTGOING, "OG")],
    # What a replacement hands over; neither an entry into group A nor the acceptance is refused for it.
    Collection.SAISON_TEAMS: [
        {"saison_id": SAISON, "team_id": OUTGOING, "gruppe": "A", "austritt": None, "name": "Schule OG", "shorthand": "OG"}
    ],
    Collection.BEWERBUNGEN: [bewerbung_document()],
    Collection.SPIELTAGE: [
        {"_id": SPIELTAG, "beginn": "2026-03-15", "ende": "2026-03-15", "position": 1, "saison_id": SAISON, "saison_phase": "gruppenphase"}
    ],
    Collection.SPIELE: [fixture_document()],
    Collection.SPIELORTE: [
        {
            "_id": VENUE,
            "name": "Sportplatz Ostpark",
            "address": ADDRESS,
            "maps_link": SEED_MAPS_LINK,
            "default_mietpreis": 40,
            "inactive_since": None,
            "bounded_writes": 1,
        }
    ],
    Collection.SCHIEDSRICHTER: [
        {
            "_id": REFEREE,
            "name": "Anna Körner",
            "schule": "Carl-Schurz-Schule",
            "default_payment": 20,
            "kontakt": {"telefon": "+49 69 1234567", "email": "koerner.anna@example.com"},
            "inactive_since": None,
            "bounded_writes": 1,
        }
    ],
}

# A write under test, given the client and a handle on every collection, one of them possibly hooked.
Write = Callable[[AsyncMongoClient, Mapping[Collection, Any]], Awaitable[Any]]


@dataclass(frozen=True)
class Slot:
    """The fixture field booking a venue or a referee, and the blocks that book it."""

    collection: Collection
    row_id: ObjectId
    field: str
    reference: str
    #: The block a payload books it with, the figure beside the id being what this fixture agrees to pay.
    booking: dict[str, Any]
    #: The block a fixture already booked with it stores, its composed copies included.
    stored: dict[str, Any]


ORT = Slot(
    Collection.SPIELORTE,
    VENUE,
    "ort",
    "spielort_id",
    {"spielort_id": str(VENUE), "mietpreis": 40},
    {"spielort_id": VENUE, "name": "Sportplatz Ostpark", "maps_link": SEED_MAPS_LINK, "mietpreis": 40},
)
SCHIEDSRICHTER = Slot(
    Collection.SCHIEDSRICHTER,
    REFEREE,
    "schiedsrichter",
    "schiedsrichter_id",
    {"schiedsrichter_id": str(REFEREE), "payment": 20},
    {"schiedsrichter_id": REFEREE, "name": "Anna Körner", "payment": 20},
)

SLOTS = [pytest.param(ORT, id="venue"), pytest.param(SCHIEDSRICHTER, id="referee")]


def saved_in_the_editor(stored: dict[str, Any], **overrides: Any) -> Write:
    """The editor's save of `stored` with `overrides` changed, whichever fixture `stored` is."""

    async def write(client: AsyncMongoClient, handles: Mapping[Collection, Any]) -> Any:
        return await patch_spiel_data(
            spiel_id=stored["_id"],
            spiel_data=FLPatchSpielDataPayload(**spiel_patch_body(stored, **overrides)),
            db=client,
            spiele_collection=handles[Collection.SPIELE],
            teams_collection=handles[Collection.TEAMS],
            saisons_collection=handles[Collection.SAISONS],
            saison_teams_collection=handles[Collection.SAISON_TEAMS],
            spieltage_collection=handles[Collection.SPIELTAGE],
            spielorte_collection=handles[Collection.SPIELORTE],
            schiedsrichter_collection=handles[Collection.SCHIEDSRICHTER],
            dry_run=False,
        )

    return write


def restored(other_fields: dict[str, Any] | None) -> Write:
    """The replay of `FIXTURE`'s Paarung, naming `other_fields` beyond it: the one other route that books a fixture."""

    paarung = {
        "spiel_id": str(FIXTURE),
        "team1": None,
        "team2": None,
        "elfmeterschiessen": None,
        "sonderereignis": None,
        "other_fields": other_fields,
    }

    async def write(client: AsyncMongoClient, handles: Mapping[Collection, Any]) -> Any:
        return await patch_spiele_paarungen(
            payload=FLPatchSpielePaarungenPayload.model_validate({"paarungen": [paarung]}),
            db=client,
            spiele_collection=handles[Collection.SPIELE],
            teams_collection=handles[Collection.TEAMS],
            saisons_collection=handles[Collection.SAISONS],
            saison_teams_collection=handles[Collection.SAISON_TEAMS],
            spieltage_collection=handles[Collection.SPIELTAGE],
            spielorte_collection=handles[Collection.SPIELORTE],
            schiedsrichter_collection=handles[Collection.SCHIEDSRICHTER],
        )

    return write


def called_off_fixture(slot: Slot) -> dict[str, Any]:
    """Booked with `slot` and called off, so a retirement or an erasure leaves the booking standing."""

    return fixture_document(**{slot.field: slot.stored, "sonderereignis": CALLED_OFF})


async def enter(client: AsyncMongoClient, handles: Mapping[Collection, Any]) -> Any:
    return await post_saison_team(
        team_id=CLUB,
        saison_team_data=FLPostSaisonTeamPayload(saison_id=SAISON, gruppe="A"),
        teams_collection=handles[Collection.TEAMS],
        saison_teams_collection=handles[Collection.SAISON_TEAMS],
        saisons_collection=handles[Collection.SAISONS],
        db=client,
    )


async def accept(client: AsyncMongoClient, handles: Mapping[Collection, Any]) -> Any:
    return await annehmen_bewerbung(
        bewerbung_id=BEWERBUNG,
        annahme_data=FLAnnehmenBewerbungPayload.model_validate({"gruppe": "A", "trikot_farbe": "blau"}),
        bewerbungen_collection=handles[Collection.BEWERBUNGEN],
        teams_collection=handles[Collection.TEAMS],
        saison_teams_collection=handles[Collection.SAISON_TEAMS],
        saisons_collection=handles[Collection.SAISONS],
        db=client,
        today=RETIRED_ON,
        von=ACCEPTED_BY,
    )


async def replace(client: AsyncMongoClient, handles: Mapping[Collection, Any]) -> Any:
    return await replace_saison_team(
        team_id=OUTGOING,
        saison_id=SAISON,
        replacement_data=FLReplaceSaisonTeamPayload(incoming_team_id=CLUB),
        teams_collection=handles[Collection.TEAMS],
        saison_teams_collection=handles[Collection.SAISON_TEAMS],
        saisons_collection=handles[Collection.SAISONS],
        spiele_collection=handles[Collection.SPIELE],
        saison_spieler_collection=handles[Collection.SAISON_SPIELER],
        db=client,
        today=RETIRED_ON,
    )


async def retire_the_club(client: AsyncMongoClient, handles: Mapping[Collection, Any]) -> Any:
    return await delete_team(
        team_id=CLUB,
        teams_collection=handles[Collection.TEAMS],
        saison_teams_collection=handles[Collection.SAISON_TEAMS],
        saisons_collection=handles[Collection.SAISONS],
        db=client,
        today=RETIRED_ON,
    )


async def retire_the_venue(client: AsyncMongoClient, handles: Mapping[Collection, Any]) -> Any:
    return await delete_spielort(
        spielort_id=VENUE,
        spielorte_collection=handles[Collection.SPIELORTE],
        spiele_collection=handles[Collection.SPIELE],
        db=client,
        today=RETIRED_ON,
    )


async def retire_the_referee(client: AsyncMongoClient, handles: Mapping[Collection, Any]) -> Any:
    return await delete_schiedsrichter(
        schiedsrichter_id=REFEREE,
        schiedsrichter_collection=handles[Collection.SCHIEDSRICHTER],
        spiele_collection=handles[Collection.SPIELE],
        db=client,
        today=RETIRED_ON,
    )


async def erase_the_referee(client: AsyncMongoClient, handles: Mapping[Collection, Any]) -> Any:
    return await anonymise_schiedsrichter(
        schiedsrichter_id=REFEREE,
        schiedsrichter_collection=handles[Collection.SCHIEDSRICHTER],
        spiele_collection=handles[Collection.SPIELE],
        aktionen_collection=handles[Collection.AKTIONEN],
        db=client,
        germany_now=ERASED_AT,
    )


RENAMED_CLUB = ("Schule Neuwerk", "NW")
RENAMED_VENUE = "Sportplatz Nord"
RENAMED_REFEREE = "Anna Berger"


async def rename_the_club(client: AsyncMongoClient, handles: Mapping[Collection, Any]) -> Any:
    (club, _) = LEAGUE[Collection.TEAMS]

    return await patch_team(
        team_id=CLUB,
        team_data=FLPatchTeamPayload.model_validate(
            {
                **{field: club[field] for field in ("description", "full_name", "website_url", "address")},
                "name": RENAMED_CLUB[0],
                "shorthand": RENAMED_CLUB[1],
                "schulform": None,
            }
        ),
        teams_collection=handles[Collection.TEAMS],
        spiele_collection=handles[Collection.SPIELE],
        saison_teams_collection=handles[Collection.SAISON_TEAMS],
        saisons_collection=handles[Collection.SAISONS],
        db=client,
    )


async def rename_the_venue(client: AsyncMongoClient, handles: Mapping[Collection, Any]) -> Any:
    (venue,) = LEAGUE[Collection.SPIELORTE]

    return await patch_spielort(
        spielort_id=VENUE,
        spielort_data=FLPatchSpielortPayload.model_validate(
            {"address": venue["address"], "name": RENAMED_VENUE, "default_mietpreis": venue["default_mietpreis"]}
        ),
        spielorte_collection=handles[Collection.SPIELORTE],
        spiele_collection=handles[Collection.SPIELE],
        db=client,
    )


async def rename_the_referee(client: AsyncMongoClient, handles: Mapping[Collection, Any]) -> Any:
    (referee,) = LEAGUE[Collection.SCHIEDSRICHTER]

    return await patch_schiedsrichter(
        schiedsrichter_id=REFEREE,
        schiedsrichter_data=FLPatchSchiedsrichterPayload.model_validate(
            {**{field: referee[field] for field in ("schule", "default_payment", "kontakt")}, "name": RENAMED_REFEREE}
        ),
        schiedsrichter_collection=handles[Collection.SCHIEDSRICHTER],
        spiele_collection=handles[Collection.SPIELE],
        sperrliste_collection=handles[Collection.SPERRLISTE],
        saisons_collection=handles[Collection.SAISONS],
        db=client,
        config=CONFIG,
        today=TODAY,
    )


# The row's retirement, and whether a write it judged still books or enters the row: both at once is
# the state no retirement race may leave.
RetiredStanding = tuple[str | None, bool]


async def club_standing(database: AsyncDatabase) -> RetiredStanding:
    club = await database[Collection.TEAMS].find_one({"_id": CLUB}) or {}

    return club.get("inactive_since"), await database[Collection.SAISON_TEAMS].count_documents({"team_id": CLUB}) > 0


def slot_standing(slot: Slot) -> Callable[[AsyncDatabase], Awaitable[RetiredStanding]]:
    """Booked on a fixture still to be played, because a called-off fixture keeps a retired row lawfully."""

    async def standing(database: AsyncDatabase) -> RetiredStanding:
        row = await database[slot.collection].find_one({"_id": slot.row_id}) or {}
        booked = await database[Collection.SPIELE].count_documents({f"{slot.field}.{slot.reference}": slot.row_id, **unplayed_filter()})

        return row.get("inactive_since"), booked > 0

    return standing


# The row's own name, and every copy a row or a fixture naming it carries: a copy that differs is stale.
Copies = tuple[object, list[object]]


async def club_copies(database: AsyncDatabase) -> Copies:
    club = await database[Collection.TEAMS].find_one({"_id": CLUB}) or {}
    rows = await database[Collection.SAISON_TEAMS].find({"team_id": CLUB}).to_list(length=None)

    return (club.get("name"), club.get("shorthand")), [(row["name"], row["shorthand"]) for row in rows]


def slot_copies(slot: Slot) -> Callable[[AsyncDatabase], Awaitable[Copies]]:
    async def copies(database: AsyncDatabase) -> Copies:
        row = await database[slot.collection].find_one({"_id": slot.row_id}) or {}
        fixtures = await database[Collection.SPIELE].find({f"{slot.field}.{slot.reference}": slot.row_id}).to_list(length=None)

        return row.get("name"), [fixture[slot.field]["name"] for fixture in fixtures]

    return copies


@dataclass(frozen=True)
class Booking:
    """A write naming the row, and the fixtures seeded in place of `LEAGUE`'s own where it needs others."""

    name: str
    write: Write
    spiele: list[dict[str, Any]] | None = None


@dataclass(frozen=True)
class Reference:
    """One kind of row a write enters or books, and what a race over it writes and reads."""

    name: str
    collection: Collection
    #: What an entry or a booking answers once the row has retired.
    refused_with: str
    #: Every write naming the row where the fixture or the season held none of it before.
    bookings: tuple[Booking, ...]
    rename: Write
    renamed: object
    #: Where the rename rewrites the copies a booking makes, which a racing booking starts at.
    copied_into: Collection
    standing: Callable[[AsyncDatabase], Awaitable[RetiredStanding]]
    copies: Callable[[AsyncDatabase], Awaitable[Copies]]


def slot_reference(name: str, slot: Slot, rename: Write, renamed: str) -> Reference:
    stored = fixture_document()
    kept = {field: stored[field] for field in ("team1_quelle", "team2_quelle", "datum", "uhrzeit", "ort", "schiedsrichter", "notiz")}

    return Reference(
        name=name,
        collection=slot.collection,
        refused_with=BOOKING_UNKNOWN_RESOURCE,
        bookings=(
            Booking("editor", saved_in_the_editor(stored, **{slot.field: slot.booking})),
            # Restoring a booking the undone save had replaced.
            Booking("restore", restored({**kept, "replaced": [slot.field], slot.field: slot.booking})),
        ),
        rename=rename,
        renamed=renamed,
        copied_into=Collection.SPIELE,
        standing=slot_standing(slot),
        copies=slot_copies(slot),
    )


CLUB_ROW = Reference(
    name="club",
    collection=Collection.TEAMS,
    refused_with=CLUB_RETIRED,
    bookings=(Booking("entry", enter), Booking("acceptance", accept), Booking("replacement", replace)),
    rename=rename_the_club,
    renamed=RENAMED_CLUB,
    copied_into=Collection.SAISON_TEAMS,
    standing=club_standing,
    copies=club_copies,
)
VENUE_ROW = slot_reference("venue", ORT, rename_the_venue, RENAMED_VENUE)
REFEREE_ROW = slot_reference("referee", SCHIEDSRICHTER, rename_the_referee, RENAMED_REFEREE)


def revivals_of(slot: Slot) -> tuple[Booking, ...]:
    """Lifting the call-off, which puts the fixture back among those still to be played with its booking unchanged."""

    called_off = called_off_fixture(slot)

    return (
        Booking("editor-revival", saved_in_the_editor(called_off, sonderereignis=None), [called_off]),
        # An undo of the call-off: the Paarung alone, every other field read off the stored fixture.
        Booking("restore-revival", restored(None), [called_off]),
    )


@dataclass(frozen=True)
class Retirement:
    name: str
    write: Write
    #: Where it reads what it judges, which a rival booking lands straight after: a later read would
    #: open the snapshot, hiding a read left off the session.
    judged: Collection
    #: What it answers a booking it missed; the erasure refuses nothing and repoints instead.
    refused_with: str


RETIRE_THE_CLUB = Retirement("retirement", retire_the_club, Collection.SAISON_TEAMS, RETIRE_BLOCKED)
RETIRE_THE_VENUE = Retirement("retirement", retire_the_venue, Collection.SPIELE, VENUE_STILL_BOOKED)
RETIRE_THE_REFEREE = Retirement("retirement", retire_the_referee, Collection.SPIELE, REFEREE_STILL_ASSIGNED)
# After its first read, the referee's: it reads the row before it touches a fixture.
ERASE_THE_REFEREE = Retirement("erasure", erase_the_referee, Collection.SCHIEDSRICHTER, COMMITTED)


def races(reference: Reference, retirement: Retirement, bookings: tuple[Booking, ...]) -> list[Any]:
    return [pytest.param(reference, retirement, booking, id=f"{reference.name}-{retirement.name}-{booking.name}") for booking in bookings]


VENUE_BOOKINGS = (*VENUE_ROW.bookings, *revivals_of(ORT))
REFEREE_BOOKINGS = (*REFEREE_ROW.bookings, *revivals_of(SCHIEDSRICHTER))

REFUSING_RACES = [
    *races(CLUB_ROW, RETIRE_THE_CLUB, CLUB_ROW.bookings),
    *races(VENUE_ROW, RETIRE_THE_VENUE, VENUE_BOOKINGS),
    *races(REFEREE_ROW, RETIRE_THE_REFEREE, REFEREE_BOOKINGS),
]
ERASURE_RACES = races(REFEREE_ROW, ERASE_THE_REFEREE, REFEREE_BOOKINGS)


class RunningARivalMidWrite:
    """Never after this request writes here: a rival landing on a document it holds waits on its lock, while this request awaits the rival.

    After a read, once the request has judged it; before a write.
    """

    def __init__(self, inner: Any, rival: Callable[[], Awaitable[None]]) -> None:
        self._inner = inner
        self._rival: Callable[[], Awaitable[None]] | None = rival

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    async def run_the_rival(self) -> None:
        # ONE-SHOT: the retry has to judge what the rival committed rather than run it again.
        if self._rival is not None:
            rival, self._rival = self._rival, None
            await rival()

    def find(self, *args: Any, **kwargs: Any) -> CursorRunningARivalAfterItsRead:
        return CursorRunningARivalAfterItsRead(self._inner.find(*args, **kwargs), self)

    async def find_one(self, *args: Any, **kwargs: Any) -> Any:
        found = await self._inner.find_one(*args, **kwargs)
        await self.run_the_rival()

        return found

    async def update_many(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()

        return await self._inner.update_many(*args, **kwargs)


class CursorRunningARivalAfterItsRead:
    """The cursor a retirement reads what it judges through: the rival lands once the list is in hand, as `find_one`'s does."""

    def __init__(self, inner: Any, hook: RunningARivalMidWrite) -> None:
        self._inner = inner
        self._hook = hook

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    def limit(self, *args: Any, **kwargs: Any) -> CursorRunningARivalAfterItsRead:
        self._inner = self._inner.limit(*args, **kwargs)

        return self

    async def to_list(self, *args: Any, **kwargs: Any) -> Any:
        found = await self._inner.to_list(*args, **kwargs)
        await self._hook.run_the_rival()

        return found


async def a_seeded_league(database: AsyncDatabase, spiele: list[dict[str, Any]] | None) -> dict[Collection, Any]:
    """`LEAGUE`, its one fixture replaced by `spiele` where a case needs others."""

    for name, rows in {**LEAGUE, **({} if spiele is None else {Collection.SPIELE: spiele})}.items():
        await database[name].insert_many([dict(row) for row in rows])

    return {collection: database[collection] for collection in Collection}


def interleaved[Standing](
    url: str,
    under_test: Write,
    hooked: Collection,
    rival: Write,
    standing: Callable[[AsyncDatabase], Awaitable[Standing]],
    spiele: list[dict[str, Any]] | None = None,
) -> tuple[str, str | None, Standing]:
    """What `under_test` and `rival` each answered, `rival` running to completion inside it at `hooked`: `None` for one that never ran."""

    async def body() -> tuple[str, str | None, Standing]:
        async with a_clean_database(url, DATABASE_NAME) as (client, database):
            handles = await a_seeded_league(database, spiele)
            rival_outcomes: list[str] = []

            async def the_rival_lands() -> None:
                rival_outcomes.append(await outcome_of(rival(client, handles)))

            hook = RunningARivalMidWrite(database[hooked], the_rival_lands)
            outcome = await outcome_of(under_test(client, {**handles, hooked: hook}))

            return outcome, next(iter(rival_outcomes), None), await standing(database)

    return on_the_seed_loop(body())


class RowsAnnouncingTheirAnchor:
    """Reports the moment a booking reaches the row's anchor, which is as far as it gets while a rename holds the row."""

    def __init__(self, inner: Any, reached: asyncio.Event) -> None:
        self._inner = inner
        self._reached = reached

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    async def update_many(self, *args: Any, **kwargs: Any) -> Any:
        self._reached.set()

        return await self._inner.update_many(*args, **kwargs)


def booked_inside_the_rename(url: str, reference: Reference, booking: Write) -> tuple[str, str | None, Copies]:
    """The booking starts at the rename's first copy, and the rename waits until it reaches its anchor or finishes.

    A task: the rename holds the row, so a booking awaited inline retries against it until `with_transaction` gives up.
    """

    async def body() -> tuple[str, str | None, Copies]:
        async with a_clean_database(url, DATABASE_NAME) as (client, database):
            handles = await a_seeded_league(database, None)
            reached = asyncio.Event()
            bookings: list[asyncio.Task[str]] = []

            async def start_the_booking() -> None:
                announcing = {**handles, reference.collection: RowsAnnouncingTheirAnchor(database[reference.collection], reached)}
                started = asyncio.create_task(outcome_of(booking(client, announcing)))
                bookings.append(started)
                anchor = asyncio.create_task(reached.wait())
                # Whichever comes first: a booking taking no anchor never reaches one, and commits past the rename instead.
                await asyncio.wait({started, anchor}, return_when=asyncio.FIRST_COMPLETED)
                anchor.cancel()

            hook = RunningARivalMidWrite(database[reference.copied_into], start_the_booking)
            rename_outcome = await outcome_of(reference.rename(client, {**handles, reference.copied_into: hook}))

            return rename_outcome, await bookings[0] if bookings else None, await reference.copies(database)

    return on_the_seed_loop(body())


class TestARetirementLandingMidBookingIsJudgedAgain:
    """The entry, the booking or the revival has read the row as current when the retirement commits."""

    @pytest.mark.parametrize(("reference", "retirement", "booking"), REFUSING_RACES)
    def test_the_booking_is_refused_on_the_date_the_retirement_stamped(
        self, mongo_replica_set_url: str, reference: Reference, retirement: Retirement, booking: Booking
    ):
        raced = interleaved(mongo_replica_set_url, booking.write, reference.collection, retirement.write, reference.standing, booking.spiele)

        assert raced == (reference.refused_with, COMMITTED, (RETIRED_ON, False))

    @pytest.mark.parametrize(("reference", "retirement", "booking"), ERASURE_RACES)
    def test_the_booking_is_refused_on_a_referee_the_erasure_removed(
        self, mongo_replica_set_url: str, reference: Reference, retirement: Retirement, booking: Booking
    ):
        """The other order of the erasure's race: the booking retries, finds no row at all, and is refused as any unknown id is."""

        raced = interleaved(mongo_replica_set_url, booking.write, reference.collection, retirement.write, nothing_names_them, booking.spiele)

        assert raced == (reference.refused_with, COMMITTED, (False, 0))


class TestABookingLandingMidRetirementIsJudgedAgain:
    """The retirement has judged the rows it reads when the entry, the booking or the revival commits."""

    @pytest.mark.parametrize(("reference", "retirement", "booking"), REFUSING_RACES)
    def test_the_retirement_is_refused_on_the_booking_it_missed(
        self, mongo_replica_set_url: str, reference: Reference, retirement: Retirement, booking: Booking
    ):
        raced = interleaved(mongo_replica_set_url, retirement.write, retirement.judged, booking.write, reference.standing, booking.spiele)

        assert raced == (retirement.refused_with, COMMITTED, (None, True))

    @pytest.mark.parametrize(("reference", "retirement", "booking"), ERASURE_RACES)
    def test_the_erasure_hands_the_booking_it_missed_to_the_ghost(
        self, mongo_replica_set_url: str, reference: Reference, retirement: Retirement, booking: Booking
    ):
        """The erasure refuses nothing: a booking landing inside it is repointed by the retry rather than left on a row that is gone."""

        raced = interleaved(mongo_replica_set_url, retirement.write, retirement.judged, booking.write, erased_standing, booking.spiele)

        assert raced == (COMMITTED, COMMITTED, (False, GHOST_SCHIEDSRICHTER_ID))


async def erased_standing(database: AsyncDatabase) -> tuple[bool, ObjectId | None]:
    """Whether the referee's row survived, and which referee `FIXTURE` names now.

    Read instead of `slot_standing`: the erasure deletes the row, so a retirement date read off it
    would answer `None` whether the erasure ran or not.
    """

    row = await database[Collection.SCHIEDSRICHTER].find_one({"_id": REFEREE})
    fixture = await database[Collection.SPIELE].find_one({"_id": FIXTURE}) or {}

    return row is not None, (fixture.get("schiedsrichter") or {}).get("schiedsrichter_id")


async def nothing_names_them(database: AsyncDatabase) -> tuple[bool, int]:
    """Whether the referee's row survived, and how many fixtures still name it.

    Counted rather than read off one: these bookings seed different fixtures, and what holds for all
    is that none points at a row that is gone.
    """

    row = await database[Collection.SCHIEDSRICHTER].find_one({"_id": REFEREE})

    return row is not None, await database[Collection.SPIELE].count_documents({"schiedsrichter.schiedsrichter_id": REFEREE})


RENAME_RACES = [
    pytest.param(reference, booking.write, id=f"{reference.name}-{booking.name}")
    for reference in (CLUB_ROW, VENUE_ROW, REFEREE_ROW)
    for booking in reference.bookings
]


class TestARenameLandingMidBookingIsCopiedAfterAll:
    """The booking has read the row's old name when the rename commits, rewriting every copy but the one not yet written."""

    @pytest.mark.parametrize(("reference", "booking"), RENAME_RACES)
    def test_the_booking_copies_the_name_the_rename_stored(self, mongo_replica_set_url: str, reference: Reference, booking: Write):
        raced = interleaved(mongo_replica_set_url, booking, reference.collection, reference.rename, reference.copies)

        assert raced == (COMMITTED, COMMITTED, (reference.renamed, [reference.renamed]))


class TestABookingLandingMidRenameIsCopiedAfterAll:
    """The rename has written the row when the booking reads it, so the copies it rewrites cannot include the booking's."""

    @pytest.mark.parametrize(("reference", "booking"), RENAME_RACES)
    def test_the_booking_waits_out_the_rename_and_copies_its_name(self, mongo_replica_set_url: str, reference: Reference, booking: Write):
        raced = booked_inside_the_rename(mongo_replica_set_url, reference, booking)

        assert raced == (COMMITTED, COMMITTED, (reference.renamed, [reference.renamed]))


QUARTER_FINAL = ObjectId("6890a1b2c3d4e5f608280007")
SEMI_FINAL = ObjectId("6890a1b2c3d4e5f608280008")
# A second semi-final of the same day, booked where the first stood, once its no-show freed the slot.
LATER_SEMI_FINAL = ObjectId("6890a1b2c3d4e5f608280009")
ALPHA = ObjectId("6890a1b2c3d4e5f608280011")
BETA = ObjectId("6890a1b2c3d4e5f608280012")
GAMMA = ObjectId("6890a1b2c3d4e5f608280013")
# On no `spieltage` row, so no date rule is what a case here is about.
QUARTER_FINAL_SPIELTAG = ObjectId("6890a1b2c3d4e5f608280021")
SEMI_FINAL_SPIELTAG = ObjectId("6890a1b2c3d4e5f608280022")

SEMI_FINAL_NR = 5
LATER_SEMI_FINAL_NR = 6


def club(team_id: ObjectId, tore: int | None = None) -> dict[str, Any]:
    name = {ALPHA: "Alpha", BETA: "Beta", GAMMA: "Gamma"}[team_id]

    return {"team_id": team_id, "name": name, "shorthand": name[:2].upper(), "tore": tore}


def quarter_final() -> dict[str, Any]:
    """Won by Beta, which put Beta in the semi-final: the result the reopening below overturns."""

    return fixture_document(
        _id=QUARTER_FINAL,
        spiel_nr=1,
        saison_phase="viertelfinale",
        spieltag_id=QUARTER_FINAL_SPIELTAG,
        datum="2026-05-01",
        team1=club(ALPHA, 1),
        team2=club(BETA, 3),
        ergebnis="1:3",
    )


def semi_final(slot: Slot, **overrides: Any) -> dict[str, Any]:
    """Played at 18:00 under `slot`'s booking, so no retirement or erasure of the row is refused over it."""

    return fixture_document(
        **{
            "_id": SEMI_FINAL,
            "spiel_nr": SEMI_FINAL_NR,
            "saison_phase": "halbfinale",
            "spieltag_id": SEMI_FINAL_SPIELTAG,
            "datum": "2026-05-08",
            "uhrzeit": "18:00:00",
            "team1": club(BETA, 2),
            "team2": club(GAMMA, 1),
            "team1_quelle": {"type": "spiel", "spiel_nr": 1, "ausgang": "sieger"},
            "ergebnis": "2:1",
            slot.field: slot.stored,
            **overrides,
        }
    )


# The quarter-final corrected so Alpha won it, which rewrites the semi-final's slot and voids the result it was played to.
REOPENED_BY_AN_OVERTURN = saved_in_the_editor(quarter_final(), team1={"team_id": ALPHA, "tore": 3}, team2={"team_id": BETA, "tore": 1})


def played_on_the_spieltag(slot: Slot) -> dict[str, Any]:
    """`FIXTURE` played under `slot`'s booking by the club the save below fields elsewhere on its Spieltag."""

    outgoing = {"team_id": OUTGOING, "name": "Schule OG", "shorthand": "OG", "tore": 2}
    other = {"team_id": CLUB, "name": "Schule CL", "shorthand": "CL", "tore": 1}

    return fixture_document(team1=outgoing, team2=other, ergebnis="2:1", **{slot.field: slot.stored})


# Holding nothing and claiming nothing, so the only booking the save touches is the one its release reopens.
SECOND_ON_THE_SPIELTAG = fixture_document(_id=SECOND_FIXTURE, spiel_nr=2, uhrzeit="10:00:00")

# Fielding the club a played fixture of the same Spieltag holds empties that side there and voids its result.
REOPENED_BY_A_RELEASE = saved_in_the_editor(SECOND_ON_THE_SPIELTAG, team1={"team_id": OUTGOING, "tore": None})


@dataclass(frozen=True)
class Reopening:
    """One of the two writes voiding a played fixture's result on nobody's request, and the fixture it reopens."""

    name: str
    write: Write
    spiele: Callable[[Slot], list[dict[str, Any]]]
    reopened: ObjectId


REOPENINGS = [
    pytest.param(Reopening("overturn", REOPENED_BY_AN_OVERTURN, lambda slot: [quarter_final(), semi_final(slot)], SEMI_FINAL), id="overturn"),
    pytest.param(
        Reopening("release", REOPENED_BY_A_RELEASE, lambda slot: [played_on_the_spieltag(slot), SECOND_ON_THE_SPIELTAG], FIXTURE), id="release"
    ),
]

# The row's retirement, the reopened fixture's booking of it, that fixture's result, and the row's anchor count.
ReopenedStanding = tuple[str | None, ObjectId | None, str | None, int]


async def anchor_of(slot: Slot, database: AsyncDatabase) -> int:
    """The row's `bounded_writes`: seeded at one, so a two is the anchor the write under test took on it."""

    row = await database[slot.collection].find_one({"_id": slot.row_id}) or {}

    return row["bounded_writes"]


def reopening_of(slot: Slot, spiel_id: ObjectId) -> Callable[[AsyncDatabase], Awaitable[ReopenedStanding]]:
    async def standing(database: AsyncDatabase) -> ReopenedStanding:
        row = await database[slot.collection].find_one({"_id": slot.row_id}) or {}
        fixture = await database[Collection.SPIELE].find_one({"_id": spiel_id}) or {}

        return row.get("inactive_since"), (fixture.get(slot.field) or {}).get(slot.reference), fixture.get("ergebnis"), row["bounded_writes"]

    return standing


def erased_reopening_of(spiel_id: ObjectId) -> Callable[[AsyncDatabase], Awaitable[tuple[bool, ObjectId | None, str | None]]]:
    """Whether the referee's row survived, which referee the reopened fixture names, and the result it was left holding."""

    async def standing(database: AsyncDatabase) -> tuple[bool, ObjectId | None, str | None]:
        row = await database[Collection.SCHIEDSRICHTER].find_one({"_id": REFEREE})
        fixture = await database[Collection.SPIELE].find_one({"_id": spiel_id}) or {}

        return row is not None, (fixture.get("schiedsrichter") or {}).get("schiedsrichter_id"), fixture.get("ergebnis")

    return standing


class TestAReopeningAndARetirementLandingInsideEachOther:
    """A reopening is judged by no booking rule, so a retirement inside it changes what the queue reports and never whether it saves.

    `docs/backend/spec.md :: I257`, and `:: I256` for the erasure's strip.
    """

    @pytest.mark.parametrize("reopening", REOPENINGS)
    @pytest.mark.parametrize(
        ("slot", "retirement", "hooked", "standing"),
        [
            pytest.param(ORT, RETIRE_THE_VENUE, Collection.SPIELE, (RETIRED_ON, VENUE, None, 2), id="venue"),
            pytest.param(SCHIEDSRICHTER, RETIRE_THE_REFEREE, Collection.SPIELE, (RETIRED_ON, REFEREE, None, 2), id="referee"),
        ],
    )
    def test_the_reopening_commits_beside_the_retirement(
        self,
        mongo_replica_set_url: str,
        reopening: Reopening,
        slot: Slot,
        retirement: Retirement,
        hooked: Collection,
        standing: ReopenedStanding,
    ):
        """Landed after the reopening's first read of `hooked`, so the retirement judged the fixture still played."""

        raced = interleaved(
            mongo_replica_set_url, reopening.write, hooked, retirement.write, reopening_of(slot, reopening.reopened), reopening.spiele(slot)
        )

        assert raced == (COMMITTED, COMMITTED, standing)

    @pytest.mark.parametrize("reopening", REOPENINGS)
    @pytest.mark.parametrize(
        ("slot", "retirement", "standing"),
        [
            pytest.param(ORT, RETIRE_THE_VENUE, (None, VENUE, None, 2), id="venue"),
            pytest.param(SCHIEDSRICHTER, RETIRE_THE_REFEREE, (None, REFEREE, None, 2), id="referee"),
        ],
    )
    def test_the_retirement_is_judged_again_on_the_fixture_reopened(
        self, mongo_replica_set_url: str, reopening: Reopening, slot: Slot, retirement: Retirement, standing: ReopenedStanding
    ):
        """The reopening anchors the rows it books again, which is what the retirement conflicts on."""

        raced = interleaved(
            mongo_replica_set_url,
            retirement.write,
            retirement.judged,
            reopening.write,
            reopening_of(slot, reopening.reopened),
            reopening.spiele(slot),
        )

        assert raced == (retirement.refused_with, COMMITTED, standing)

    @pytest.mark.parametrize("reopening", REOPENINGS)
    @pytest.mark.parametrize(
        "erasure_first",
        [pytest.param(True, id="erasure-first"), pytest.param(False, id="reopening-first")],
    )
    def test_a_reopening_and_the_erasure_leave_the_fixture_on_the_ghost(
        self, mongo_replica_set_url: str, reopening: Reopening, erasure_first: bool
    ):
        """Both orders, one case: neither write refuses, so whichever retries lands on the same state.

        The retirement's cases above read the row back; here it is gone, so what is read is the
        fixture and the ghost it names.
        """

        # Parked at its first read of `spiele`, before any write: parked at its referee read it has
        # already written the reopened fixture, and the erasure waits on that row until the
        # transaction's lifetime runs out.
        under_test, hooked, rival = (
            (ERASE_THE_REFEREE.write, ERASE_THE_REFEREE.judged, reopening.write)
            if erasure_first
            else (reopening.write, Collection.SPIELE, ERASE_THE_REFEREE.write)
        )

        raced = interleaved(
            mongo_replica_set_url,
            under_test,
            hooked,
            rival,
            erased_reopening_of(reopening.reopened),
            reopening.spiele(SCHIEDSRICHTER),
        )

        assert raced == (COMMITTED, COMMITTED, (False, GHOST_SCHIEDSRICHTER_ID, None))


BOOKED_ON_BOTH = fixture_document(ort=ORT.stored, schiedsrichter=SCHIEDSRICHTER.stored)


async def anchors_now(database: AsyncDatabase) -> tuple[int, int]:
    venue = await database[Collection.SPIELORTE].find_one({"_id": VENUE}) or {}
    referee = await database[Collection.SCHIEDSRICHTER].find_one({"_id": REFEREE}) or {}

    return venue["bounded_writes"], referee["bounded_writes"]


class TestASaveAnchorsTheRowsItBooksOrClaimsAnew:
    """An anchor serialises the save with every retirement and rival save of its row, so one on a row no rule judged is a conflict for nothing.

    Each row starts anchored once, so a two is this save's anchor.
    """

    @pytest.mark.parametrize(
        ("write", "spiele", "anchored"),
        [
            pytest.param(saved_in_the_editor(BOOKED_ON_BOTH, notiz=NOTE), [BOOKED_ON_BOTH], (1, 1), id="a note"),
            pytest.param(saved_in_the_editor(BOOKED_ON_BOTH, sonderereignis=CALLED_OFF), [BOOKED_ON_BOTH], (1, 1), id="a call-off"),
            pytest.param(saved_in_the_editor(fixture_document(), ort=ORT.booking), None, (2, 1), id="a venue booked"),
            pytest.param(saved_in_the_editor(BOOKED_ON_BOTH, uhrzeit="16:00:00"), [BOOKED_ON_BOTH], (2, 2), id="both claims moved"),
            pytest.param(
                saved_in_the_editor({**BOOKED_ON_BOTH, "sonderereignis": CALLED_OFF}, sonderereignis=None),
                [{**BOOKED_ON_BOTH, "sonderereignis": CALLED_OFF}],
                (2, 2),
                id="a call-off lifted",
            ),
            pytest.param(
                REOPENED_BY_AN_OVERTURN,
                [quarter_final(), semi_final(ORT, schiedsrichter=SCHIEDSRICHTER.stored)],
                (2, 2),
                id="a fixture reopened elsewhere",
            ),
        ],
    )
    def test_the_rows_anchored_are_those_a_booking_rule_judged(
        self, mongo_replica_set_url: str, write: Write, spiele: list[dict[str, Any]] | None, anchored: tuple[int, int]
    ):
        async def body() -> tuple[str, tuple[int, int]]:
            async with a_clean_database(mongo_replica_set_url, DATABASE_NAME) as (client, database):
                handles = await a_seeded_league(database, spiele)

                return await outcome_of(write(client, handles)), await anchors_now(database)

        assert on_the_seed_loop(body()) == (COMMITTED, anchored)


def clash_fixtures(slot: Slot) -> list[dict[str, Any]]:
    """Three fixtures on one day: the first and the third hold `slot`, far enough apart, and the second nothing.

    Each save below passes alone; any two together put the row in two places under four hours apart.
    """

    return [
        fixture_document(uhrzeit="10:00:00", **{slot.field: slot.stored}),
        fixture_document(_id=SECOND_FIXTURE, spiel_nr=2, uhrzeit="14:00:00"),
        fixture_document(_id=THIRD_FIXTURE, spiel_nr=3, uhrzeit="20:00:00", **{slot.field: slot.stored}),
    ]


def moved_to_the_afternoon(slot: Slot) -> Write:
    """The first fixture keeps its booking and moves to the hour the second is played at."""

    return saved_in_the_editor(clash_fixtures(slot)[0], uhrzeit="14:00:00")


def booked_onto_the_second(slot: Slot) -> Write:
    return saved_in_the_editor(clash_fixtures(slot)[1], **{slot.field: slot.booking})


def moved_from_the_evening(slot: Slot) -> Write:
    """The third fixture keeps its booking and moves an hour after the one the first is moved to."""

    return saved_in_the_editor(clash_fixtures(slot)[2], uhrzeit="15:00:00")


def booked_hours_of(slot: Slot) -> Callable[[AsyncDatabase], Awaitable[list[tuple[int, str]]]]:
    """Every fixture holding the row, and at what time: two less than four hours apart are a double booking."""

    async def hours(database: AsyncDatabase) -> list[tuple[int, str]]:
        rows = await database[Collection.SPIELE].find({f"{slot.field}.{slot.reference}": slot.row_id}).to_list(length=None)

        return sorted((row["spiel_nr"], row["uhrzeit"]) for row in rows)

    return hours


def booked_hours_beside(
    slot: Slot, spiel_id: ObjectId, field: str
) -> Callable[[AsyncDatabase], Awaitable[tuple[list[tuple[int, str]], Any, int]]]:
    """`booked_hours_of`, one fixture's `field`, which shows the write racing the booking really landed, and the row's anchor count."""

    async def standing(database: AsyncDatabase) -> tuple[list[tuple[int, str]], Any, int]:
        fixture = await database[Collection.SPIELE].find_one({"_id": spiel_id}) or {}

        return await booked_hours_of(slot)(database), fixture.get(field), await anchor_of(slot, database)

    return standing


class TestTwoSavesBookingOneRowAtOneHourAreJudgedAgainstEachOther:
    """`REQ-CLASH-001` reads the OTHER fixtures, and each save writes only its own, so a booking kept and moved has to conflict too."""

    @pytest.mark.parametrize(
        ("under_test", "rival", "left_booked"),
        [
            # Where the row is left booked once the save under test is refused: exactly where the rival alone leaves it.
            pytest.param(
                moved_to_the_afternoon, booked_onto_the_second, [(1, "10:00:00"), (2, "14:00:00"), (3, "20:00:00")], id="moved-while-booked"
            ),
            pytest.param(booked_onto_the_second, moved_to_the_afternoon, [(1, "14:00:00"), (3, "20:00:00")], id="booked-while-moved"),
            pytest.param(moved_to_the_afternoon, moved_from_the_evening, [(1, "10:00:00"), (3, "15:00:00")], id="moved-while-moved"),
            pytest.param(moved_from_the_evening, moved_to_the_afternoon, [(1, "14:00:00"), (3, "20:00:00")], id="moved-while-moved-back"),
        ],
    )
    @pytest.mark.parametrize("slot", SLOTS)
    def test_the_save_judged_before_the_rival_committed_is_refused_on_it(
        self,
        mongo_replica_set_url: str,
        under_test: Callable[[Slot], Write],
        rival: Callable[[Slot], Write],
        left_booked: list[tuple[int, str]],
        slot: Slot,
    ):
        """Landed after the save's first read, which opens its snapshot: every read the clash is judged on comes after it."""

        raced = interleaved(
            mongo_replica_set_url, under_test(slot), Collection.SPIELE, rival(slot), booked_hours_of(slot), clash_fixtures(slot)
        )

        assert raced == (FIXTURE_DOUBLE_BOOKED, COMMITTED, left_booked)


def a_no_show_bracket(slot: Slot) -> list[dict[str, Any]]:
    """The semi-final a no-show that freed its slot, and a second one of that day not yet booked."""

    no_show = semi_final(slot, team1=club(BETA, 3), team2=club(GAMMA, 0), ergebnis="3:0", sonderereignis="nichtantreten_team2")
    later = fixture_document(
        _id=LATER_SEMI_FINAL,
        spiel_nr=LATER_SEMI_FINAL_NR,
        saison_phase="halbfinale",
        spieltag_id=SEMI_FINAL_SPIELTAG,
        datum="2026-05-08",
        uhrzeit="19:00:00",
    )

    return [quarter_final(), no_show, later]


def booked_an_hour_after_the_no_show(slot: Slot) -> Write:
    return saved_in_the_editor(a_no_show_bracket(slot)[2], **{slot.field: slot.booking})


class TestALiftedNoShowAndABookingAtItsHourAreJudgedAgainstEachOther:
    """The reopening lifts a no-show and claims its slot again, and a save booking the row an hour later writes only its own fixture.

    The semi-final's event, read beside the bookings, shows the no-show really lifted.
    """

    @pytest.mark.parametrize("slot", SLOTS)
    def test_the_booking_judged_before_the_reopening_committed_is_refused_on_it(self, mongo_replica_set_url: str, slot: Slot):
        booking, standing = booked_an_hour_after_the_no_show(slot), booked_hours_beside(slot, SEMI_FINAL, "sonderereignis")
        raced = interleaved(mongo_replica_set_url, booking, Collection.SPIELE, REOPENED_BY_AN_OVERTURN, standing, a_no_show_bracket(slot))

        # The reopening's anchor alone: the refused booking's is rolled back with it.
        assert raced == (FIXTURE_DOUBLE_BOOKED, COMMITTED, ([(SEMI_FINAL_NR, "18:00:00")], None, 2))

    @pytest.mark.parametrize("slot", SLOTS)
    def test_the_reopening_judged_before_the_booking_committed_still_commits(self, mongo_replica_set_url: str, slot: Slot):
        """The reopening refuses nothing, so the retry commits into the clash, which the queue then names (`docs/backend/spec.md :: I257`)."""

        booking, standing = booked_an_hour_after_the_no_show(slot), booked_hours_beside(slot, SEMI_FINAL, "sonderereignis")
        raced = interleaved(mongo_replica_set_url, REOPENED_BY_AN_OVERTURN, Collection.SPIELE, booking, standing, a_no_show_bracket(slot))

        # The booking's anchor, and the reopening's on the retry it forced.
        assert raced == (COMMITTED, COMMITTED, ([(SEMI_FINAL_NR, "18:00:00"), (LATER_SEMI_FINAL_NR, "19:00:00")], None, 3))


def a_clash_a_reopening_left(slot: Slot) -> list[dict[str, Any]]:
    """Two fixtures holding `slot` an hour apart, as a lifted no-show leaves them, and a third an hour after the second, holding nothing."""

    return [
        fixture_document(uhrzeit="18:00:00", **{slot.field: slot.stored}),
        fixture_document(_id=SECOND_FIXTURE, spiel_nr=2, uhrzeit="19:00:00", **{slot.field: slot.stored}),
        fixture_document(_id=THIRD_FIXTURE, spiel_nr=3, uhrzeit="20:00:00"),
    ]


# Where the row is left once the note has committed and the new claim beside it was refused: nothing anchored, neither made a claim.
NOTED_BESIDE_THE_CLASH = ([(1, "18:00:00"), (2, "19:00:00")], NOTE, 1)


def noted_on_the_first(slot: Slot) -> Write:
    return saved_in_the_editor(a_clash_a_reopening_left(slot)[0], notiz=NOTE)


def booked_onto_the_third(slot: Slot) -> Write:
    return saved_in_the_editor(a_clash_a_reopening_left(slot)[2], **{slot.field: slot.booking})


class TestASaveKeepingAClashingSlotAndANewClaimBesideItAreJudgedApart:
    """A kept claim is not judged and a new one is: the note commits and the booking beside it is refused, whichever lands inside the other.

    `docs/backend/spec.md :: I258`.
    """

    @pytest.mark.parametrize("slot", SLOTS)
    def test_a_booking_landing_mid_note_is_refused_and_the_note_commits(self, mongo_replica_set_url: str, slot: Slot):
        standing = booked_hours_beside(slot, FIXTURE, "notiz")
        raced = interleaved(
            mongo_replica_set_url,
            noted_on_the_first(slot),
            Collection.SPIELE,
            booked_onto_the_third(slot),
            standing,
            a_clash_a_reopening_left(slot),
        )

        assert raced == (COMMITTED, FIXTURE_DOUBLE_BOOKED, NOTED_BESIDE_THE_CLASH)

    @pytest.mark.parametrize("slot", SLOTS)
    def test_a_note_landing_mid_booking_commits_and_the_booking_is_refused(self, mongo_replica_set_url: str, slot: Slot):
        standing = booked_hours_beside(slot, FIXTURE, "notiz")
        raced = interleaved(
            mongo_replica_set_url,
            booked_onto_the_third(slot),
            Collection.SPIELE,
            noted_on_the_first(slot),
            standing,
            a_clash_a_reopening_left(slot),
        )

        assert raced == (FIXTURE_DOUBLE_BOOKED, COMMITTED, NOTED_BESIDE_THE_CLASH)
