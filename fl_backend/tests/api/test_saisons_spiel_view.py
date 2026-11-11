import json
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.aufstellungen.schemas import FLAufstellungPublic
from app.api.saisons.public_router import get_spiel
from app.api.spielberichte.services import compose_public_bericht
from app.core.collections import Collection
from app.core.sentinels import GHOST_SPIELER_ID
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop, shared_client
from tests.worker import worker_database

from .conftest import unwritten

DATABASE_NAME = worker_database("fl_saisons_spiel_view_test")

EARLIER, SAISON, LATER = "2025", "2026", "2027"
# The home club's id above the away club's, and the replaced club's below both: a line-up read off in the order the
# database holds them, by club, rather than picked by the club on each side, lands on the wrong side.
HOME, AWAY, REPLACED = ObjectId("6890a1b2c3d4e5f607430002"), ObjectId("6890a1b2c3d4e5f607430001"), ObjectId("6890a1b2c3d4e5f607430000")
NAMED, INTERNAL = ObjectId("6890a1b2c3d4e5f607430011"), ObjectId("6890a1b2c3d4e5f607430012")
# The match kicked off on Saturday 9 May 2026 at 16:00 in Berlin, 14:00 UTC; its line-ups locked an hour before.
PLAYED = datetime(2026, 5, 9, 16, tzinfo=UTC)
AHEAD_OF_THE_LOCK = datetime(2026, 5, 2, 12, tzinfo=UTC)


def adopted_match() -> dict[str, Any]:
    """A 2:0 the report proposed, the administrator adopted and nobody changed since."""

    return documents.spiel_document(
        spiel_id=ObjectId("6890a1b2c3d4e5f607430021"),
        saison_id=SAISON,
        spiel_nr=1,
        spieltag_id=ObjectId("6890a1b2c3d4e5f607430031"),
        team1={"team_id": HOME, "tore": 2},
        team2={"team_id": AWAY, "tore": 0},
        ergebnis="2:0",
        date="2026-05-09",
        time="16:00:00",
    )


def report_of(spiel: dict[str, Any], **bericht: Any) -> dict[str, Any]:
    """Two goals for the home side, one by a named pupil and one by nobody named; a card to an internal pupil and one to the erased."""

    return documents.spielbericht_document(
        spiel,
        bericht=documents.bericht_document(
            ergebnis_vorschlag={"team1_tore": 2, "team2_tore": 0, "elfmeterschiessen": None, "sonderereignis": None},
            scorers=[
                {"side": "team1", "spieler_id": None, "minute": "80", "eigentor": False},
                {"side": "team1", "spieler_id": NAMED, "minute": "45+2", "eigentor": False},
            ],
            cards=[
                {"side": "team2", "spieler_id": INTERNAL, "minute": "60", "colour": "gelb"},
                {"side": "team2", "spieler_id": GHOST_SPIELER_ID, "minute": "70", "colour": "rot"},
            ],
            sides=documents.spielbericht_sides(spiel),
            **{"adopted": True, **bericht},
        ),
    )


@pytest.mark.parametrize(
    ("adoption", "public"),
    [
        pytest.param({}, True, id="adopted"),
        pytest.param({"adopted": False}, False, id="never adopted, or corrected since"),
    ],
)
def test_only_an_adopted_report_publishes_its_scorers_and_cards(adoption: dict[str, Any], public: bool):
    spiel = adopted_match()
    served = compose_public_bericht(report_of(spiel, **adoption), spiel)

    assert (served.scorers is not None, served.cards is not None) == (public, public)


@pytest.fixture(scope="module")
def seeded_url(mongo_replica_set_url: str) -> Iterator[str]:
    spiel = adopted_match()
    internal = {**documents.EINWILLIGUNG, "scope": "internal"}

    async def _seed() -> None:
        async with a_clean_database(mongo_replica_set_url, DATABASE_NAME) as (_, database):
            await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON, "active"))
            await database[Collection.SPIELTAGE].insert_one(
                {
                    "_id": spiel["spieltag_id"],
                    "start": None,
                    "end": None,
                    "position": 1,
                    "saison_phase": "gruppenphase",
                    "saison_id": SAISON,
                    "version": 0,
                }
            )
            await database[Collection.SAISON_TEAMS].insert_many(
                [documents.saison_team_document(SAISON, HOME, "Alpha", "ALP"), documents.saison_team_document(SAISON, AWAY, "Beta", "BET")]
            )
            await database[Collection.SPIELE].insert_one(spiel)
            await database[Collection.SPIELBERICHTE].insert_one(report_of(spiel))
            await database[Collection.SPIELER].insert_many(
                [
                    documents.spieler_document(NAMED, "Maxim", "Müller"),
                    documents.spieler_document(INTERNAL, "Nadja", "Gerber", einwilligung=internal),
                    documents.ghost_spieler_document(),
                ]
            )
            await database[Collection.AUFSTELLUNGEN].insert_many(
                [
                    # The club a knockout correction replaced on a side keeps its line-up, which no side joins.
                    documents.aufstellung_document(spiel, REPLACED, starters=[NAMED]),
                    documents.aufstellung_document(spiel, AWAY, starters=[GHOST_SPIELER_ID], bench=[INTERNAL]),
                    documents.aufstellung_document(spiel, HOME, starters=[NAMED]),
                ]
            )
            await database[Collection.SAISON_SPIELER].insert_many(
                [
                    documents.saison_spieler_document(NAMED, SAISON, HOME, nummer="7", position="Angriff", rolle="kapitaen"),
                    # A captaincy beside a withheld name would say who the nameless pupil is.
                    documents.saison_spieler_document(INTERNAL, SAISON, AWAY, nummer="4", position="Abwehr", rolle="co_kapitaen"),
                    # The same pupil for the same club the seasons either side, under other numbers, so whichever row a join
                    # without the season term kept last, it would not be this season's.
                    documents.saison_spieler_document(NAMED, EARLIER, HOME, nummer="98", position="Abwehr"),
                    documents.saison_spieler_document(NAMED, LATER, HOME, nummer="99", position="Abwehr"),
                ]
            )

    on_the_seed_loop(_seed())

    with unwritten(mongo_replica_set_url, DATABASE_NAME):
        yield mongo_replica_set_url


def the_page(url: str, *, now: datetime = PLAYED) -> Any:
    async def body() -> Any:
        database: AsyncDatabase = shared_client(url)[DATABASE_NAME]
        return await get_spiel(
            saison_id=SAISON,
            spiel_id=adopted_match()["_id"],
            saisons_collection=database[Collection.SAISONS],
            spiele_collection=database[Collection.SPIELE],
            teams_collection=database[Collection.TEAMS],
            spielberichte_collection=database[Collection.SPIELBERICHTE],
            now=now,
        )

    return on_the_seed_loop(body())


@pytest.mark.db
def test_each_entry_reads_as_a_name_as_anonymous_or_as_unknown(seeded_url: str):
    """By minute; the internal pupil keeps their number and position, the erased one keeps nothing, and no card says why.

    The named pupil's number is this season's, never one their club gave them in another.
    """

    bericht = the_page(seeded_url).bericht
    entries = [*bericht.scorers, *bericht.cards]
    served = [(entry.minute, entry.spieler.type, entry.spieler.first_name, entry.spieler.last_name, entry.spieler.nummer) for entry in entries]

    assert served == [
        ("45+2", "named", "Maxim", "M.", "7"),
        ("80", "unknown", None, None, None),
        ("60", "anonymous", None, None, "4"),
        ("70", "anonymous", None, None, None),
    ]
    assert not {"Gerber", "Nadja", "Müller", "reason", "foulspiel"} & set(json.dumps(bericht.model_dump(mode="json")).replace('"', " ").split())


@pytest.mark.db
def test_each_side_serves_the_line_up_of_its_club_through_the_mask(seeded_url: str):
    """In the order the club entered it, the captaincy beside a published name alone; the replaced club's line-up never."""

    aufstellungen = the_page(seeded_url).aufstellungen

    def served(side: FLAufstellungPublic | None) -> list[tuple[Any, ...]]:
        assert side is not None
        return [(entry.type, entry.first_name, entry.last_name, entry.nummer, entry.rolle, entry.starts) for entry in side.spieler]

    assert served(aufstellungen.team1) == [("named", "Maxim", "M.", "7", "kapitaen", True)]
    assert served(aufstellungen.team2) == [("anonymous", None, None, None, None, True), ("anonymous", None, None, "4", None, False)]


@pytest.mark.db
def test_an_erased_pupils_entry_is_served_only_where_the_line_up_keeps_it(seeded_url: str):
    """A match re-dated ahead of its lock is picked anew, as its screen shows it: the page serves no place nobody fills.

    The stored entry stands until the club's next save, so the read judges the lock itself.
    """

    team2 = the_page(seeded_url, now=AHEAD_OF_THE_LOCK).aufstellungen.team2

    assert team2 is not None
    assert [(entry.type, entry.nummer, entry.starts) for entry in team2.spieler] == [("anonymous", "4", False)]
