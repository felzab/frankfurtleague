import json
from collections.abc import Iterator
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.aufstellungen.schemas import FLAufstellungPublic
from app.api.aufstellungen.services import PUBLIC_AUFSTELLUNGEN_AS, compose_public_aufstellungen
from app.api.saisons.public_router import get_spiel
from app.api.spielberichte.services import PUBLIC_PERSONS_AS, compose_public_bericht
from app.core.collections import Collection
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
    """Two goals for the home side, one by a named pupil and one by nobody named; a card to an internal pupil and one to an erased one."""

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
                {"side": "team2", "spieler_id": None, "minute": "70", "colour": "rot"},
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


def test_a_card_names_the_pupil_it_was_shown_to():
    """The seeded report's cards name nobody the public may read, so a card serving nobody would pass every case below."""

    spiel = adopted_match()
    report = report_of(spiel)
    to_named = {"side": "team2", "spieler_id": NAMED, "minute": "60", "colour": "gelb"}
    joined = {
        **report,
        "bericht": {**report["bericht"], "cards": [to_named]},
        PUBLIC_PERSONS_AS: [{"_id": NAMED, "first_name": "Maxim", "last_name": "M."}],
    }

    served = compose_public_bericht(joined, spiel)

    assert served.cards is not None
    assert [card.spieler.model_dump() for card in served.cards] == [{"first_name": "Maxim", "last_name": "M."}]


def named_only_match() -> dict[str, Any]:
    """A 1:0 the report proposed and the administrator adopted, beside `adopted_match` in the same season."""

    return documents.spiel_document(
        spiel_id=ObjectId("6890a1b2c3d4e5f607430022"),
        saison_id=SAISON,
        spiel_nr=2,
        spieltag_id=adopted_match()["spieltag_id"],
        team1={"team_id": HOME, "tore": 1},
        team2={"team_id": AWAY, "tore": 0},
        ergebnis="1:0",
        date="2026-05-09",
        time="18:00:00",
    )


def named_only_report(spiel: dict[str, Any]) -> dict[str, Any]:
    """One goal by the named pupil and no card: no entry naming nobody, whose null would join every pupil to the report."""

    return documents.spielbericht_document(
        spiel,
        bericht=documents.bericht_document(
            ergebnis_vorschlag={"team1_tore": 1, "team2_tore": 0, "elfmeterschiessen": None, "sonderereignis": None},
            scorers=[{"side": "team1", "spieler_id": NAMED, "minute": "12", "eigentor": False}],
            cards=[],
            sides=documents.spielbericht_sides(spiel),
            adopted=True,
        ),
    )


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
            await database[Collection.SPIELE].insert_many([spiel, named_only_match()])
            await database[Collection.SPIELBERICHTE].insert_many([report_of(spiel), named_only_report(named_only_match())])
            await database[Collection.SPIELER].insert_many(
                [
                    documents.spieler_document(NAMED, "Maxim", "Müller"),
                    documents.spieler_document(INTERNAL, "Nadja", "Gerber", einwilligung=internal),
                ]
            )
            await database[Collection.AUFSTELLUNGEN].insert_many(
                [
                    # The club a knockout correction replaced on a side keeps its line-up, which no side joins.
                    documents.aufstellung_document(spiel, REPLACED, starters=[NAMED]),
                    # An erased pupil's entry, which names nobody, and a withheld one: served alike.
                    documents.aufstellung_document(spiel, AWAY, starters=[None], bench=[INTERNAL]),
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


def the_page(url: str, spiel_id: ObjectId | None = None) -> Any:
    async def body() -> Any:
        database: AsyncDatabase = shared_client(url)[DATABASE_NAME]
        return await get_spiel(
            saison_id=SAISON,
            spiel_id=spiel_id or adopted_match()["_id"],
            saisons_collection=database[Collection.SAISONS],
            spiele_collection=database[Collection.SPIELE],
            teams_collection=database[Collection.TEAMS],
            spielberichte_collection=database[Collection.SPIELBERICHTE],
        )

    return on_the_seed_loop(body())


def test_a_line_ups_nameless_rows_read_alike_after_its_named_ones():
    """The stored order is the shirt numbers', so a nameless row left in its place would say whose it is, as would a field beside it."""

    stored = [{"spieler_id": None, "starts": True}, {"spieler_id": INTERNAL, "starts": False}, {"spieler_id": NAMED, "starts": True}]
    joined = {
        "team_id": HOME,
        "spieler": stored,
        "persons": [{"_id": INTERNAL, "first_name": None, "last_name": None}, {"_id": NAMED, "first_name": "Maxim", "last_name": "M."}],
        "squad_rows": [
            {"spieler_id": INTERNAL, "nummer": "4", "position": "Abwehr", "rolle": "co_kapitaen"},
            {"spieler_id": NAMED, "nummer": "7", "position": "Angriff", "rolle": None},
        ],
    }

    served = compose_public_aufstellungen({**adopted_match(), PUBLIC_AUFSTELLUNGEN_AS: [joined]})

    assert served.team1 is not None and served.team2 is None
    nobody = dict.fromkeys(("first_name", "last_name", "nummer", "position", "rolle"))
    assert [entry.model_dump() for entry in served.team1.spieler] == [
        {"first_name": "Maxim", "last_name": "M.", "nummer": "7", "position": "Angriff", "rolle": None, "starts": True},
        {**nobody, "starts": True},
        {**nobody, "starts": False},
    ]


@pytest.mark.db
def test_each_entry_reads_as_a_name_or_as_nobody(seeded_url: str):
    """By minute; a withheld name, an erased pupil and a scorer nobody named are served alike, and no card says which."""

    bericht = the_page(seeded_url).bericht
    entries = [*bericht.scorers, *bericht.cards]
    served = [(entry.minute, entry.spieler.model_dump()) for entry in entries]

    nobody = {"first_name": None, "last_name": None}
    assert served == [("45+2", {"first_name": "Maxim", "last_name": "M."}), ("80", nobody), ("60", nobody), ("70", nobody)]
    assert not {"Gerber", "Nadja", "Müller", "reason", "foulspiel"} & set(json.dumps(bericht.model_dump(mode="json")).replace('"', " ").split())


@pytest.mark.db
def test_a_report_naming_only_pupils_joins_each_by_their_id(seeded_url: str):
    """The case above holds a null entry, which a broken join matches against every pupil and so still names the scorer."""

    scorers = the_page(seeded_url, named_only_match()["_id"]).bericht.scorers

    assert scorers is not None
    assert [scorer.spieler.model_dump() for scorer in scorers] == [{"first_name": "Maxim", "last_name": "M."}]


@pytest.mark.db
def test_each_side_serves_the_line_up_of_its_club_through_the_mask(seeded_url: str):
    """In the order the club entered it, the captaincy beside a published name alone; the replaced club's line-up never."""

    aufstellungen = the_page(seeded_url).aufstellungen

    def served(side: FLAufstellungPublic | None) -> list[tuple[Any, ...]]:
        assert side is not None
        return [(entry.first_name, entry.last_name, entry.nummer, entry.position, entry.rolle, entry.starts) for entry in side.spieler]

    # The number is this season's, never one the club gave the pupil in another.
    assert served(aufstellungen.team1) == [("Maxim", "M.", "7", "Angriff", "kapitaen", True)]
    assert served(aufstellungen.team2) == [(None, None, None, None, None, True), (None, None, None, None, None, False)]
