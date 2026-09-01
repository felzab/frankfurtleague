from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

import pytest
from bson import ObjectId
from pymongo import MongoClient
from pymongo.database import Database

from app.core.config import BackendConfig
from tests.config import build_test_config

SAISON = "2026"
PRIOR_SAISON = "2025"

# Fixed rather than generated, so a failure names the same team. Each row is deliberate; several are
# impossible in production and none may be cleaned up.
TEAM_OIDS = {
    # The scope: the only team whose two tables differ; its junction row carries a stale `statistik`,
    # and its club document a name the club took AFTER this season, so only the row can say what the
    # season was played under.
    "Helmholtz": ObjectId("6890a1b2c3d4e5f607190001"),
    # The forfeit rule: a no-show carrying the result it was awarded, plus a match with no `ergebnis`.
    "Bock": ObjectId("6890a1b2c3d4e5f607190002"),
    # The hand-edited shape — `ergebnis` set while `tore` is null — and the only team out of the season.
    "Lessing": ObjectId("6890a1b2c3d4e5f607190003"),
    # The zeroed fallback: a junction row, no counting match, and an absage from a called-off fixture and an annulled one both.
    "Ohne": ObjectId("6890a1b2c3d4e5f607190004"),
    # The strict join: no junction row, so it drops entirely though it plays a match.
    "Fremd": ObjectId("6890a1b2c3d4e5f607190005"),
    # The abandonment, which counts as played and never as an absage, so the two figures part company here.
    "Komplett": ObjectId("6890a1b2c3d4e5f607190006"),
}

# A dict rather than a model: Pydantic could not express a row the validator rejects.
AUSTRITT = {"type": "disqualifikation", "grund": "Nicht angetreten zum Spieltag", "datum": "2026-03-14"}


def config_for(database_name: str) -> BackendConfig:
    """`build_test_config`'s settings against a database of the caller's own.

    What it is for: a body that WRITES, in a module whose other cases share one seeded corpus. Given
    the shared database it would leave them a corpus nobody seeded.
    """

    return build_test_config().model_copy(update={"db_base_name": database_name})


# One module's shared corpus: every collection it holds, each as its documents in an order two
# reads of an untouched database agree on.
Corpus = dict[str, list[str]]

_WROTE = (
    "'{database}' holds documents its seed did not put there ({moved}). A module sharing one corpus across its tests admits reads"
    " alone: a body that writes hands the next test a corpus nobody seeded, and fails it somewhere else entirely."
)


def _documents(database: Database) -> Corpus:
    """Views and `system.*` are listed beside real collections and hold nothing a seed put there."""

    return {
        info["name"]: sorted(repr(document) for document in database[info["name"]].find())
        for info in database.list_collections()
        if info.get("type") == "collection" and not str(info["name"]).startswith("system.")
    }


@contextmanager
def unwritten(url: str, database_name: str) -> Iterator[None]:
    """Fails a module that WROTE to the corpus seeded once for it, naming the collections it moved.

    `tests/database.py :: _schema` compares the schema instead, which a write never touches.
    """

    # A client of its own: the seeding one is asynchronous, and this guard compares from a synchronous
    # fixture with no loop to await it on.
    client = MongoClient(url)
    try:
        seeded = _documents(client[database_name])

        yield

        present = _documents(client[database_name])
        moved = sorted(name for name in seeded.keys() | present.keys() if seeded.get(name) != present.get(name))

        assert not moved, _WROTE.format(database=database_name, moved=", ".join(moved))
    finally:
        client.close()


@dataclass(frozen=True)
class SeededLeague:
    database: Database
    team_oids: dict[str, ObjectId]


def _team(key: str, shorthand: str, name: str | None = None) -> dict[str, Any]:
    """`name` defaults to the key; passing one is how a club comes to disagree with its own junction row."""

    name = name or key

    return {
        "_id": TEAM_OIDS[key],
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
        # Present rather than omitted: Mongo matches a missing field against `None`, so it would pass the
        # base filter and fail response validation.
        "inactive_since": None,
    }


def _junction(key: str, shorthand: str, gruppe: str, **overrides: Any) -> dict[str, Any]:
    """The row `post_saison_team` writes: the club's identity COPIED in at entry, never joined on read."""

    return {
        "saison_id": SAISON,
        "team_id": TEAM_OIDS[key],
        "gruppe": gruppe,
        "austritt": None,
        "name": key,
        "shorthand": shorthand,
        **overrides,
    }


def _spiel(
    nr: int,
    phase: str,
    team1: str | None,
    team2: str | None,
    tore1: int | None,
    tore2: int | None,
    *,
    ergebnis: str | None,
    sonderereignis: str | None = None,
    saison_id: str = SAISON,
) -> dict[str, Any]:
    """Goals and `ergebnis` are supplied separately — production derives one from the other — which is what builds the hand-edited shape."""
    return {
        "spiel_nr": nr,
        "saison_id": saison_id,
        "saison_phase": phase,
        "sonderereignis": sonderereignis,
        "ergebnis": ergebnis,
        "team1": None if team1 is None else {"team_id": TEAM_OIDS[team1], "name": team1, "tore": tore1},
        "team2": None if team2 is None else {"team_id": TEAM_OIDS[team2], "name": team2, "tore": tore2},
    }


@pytest.fixture(scope="session")
def league(mongo_database: Database) -> SeededLeague:
    """Collections dropped singly: `fl_test` is shared, not owned.

    `squads` in `test_spieler_memberships_read.py` seeds the rest of it, so a clear reaching past
    what this fixture seeds empties that corpus, and the reverse.
    """

    for collection in ("teams", "saison_teams", "spiele"):
        mongo_database.drop_collection(collection)

    mongo_database.teams.insert_many(
        [
            _team("Helmholtz", "HG", name="Helmholtz-Gymnasium"),
            _team("Bock", "BO"),
            _team("Lessing", "LE"),
            _team("Ohne", "OH"),
            _team("Fremd", "FR"),
            _team("Komplett", "KO"),
        ]
    )

    mongo_database.saison_teams.insert_many(
        [
            # Figures matching nothing the matches below produce, so any read of a stored copy fails.
            _junction(
                "Helmholtz",
                "HE",
                "A",
                statistik={
                    "anzahl_gespielte_spiele": 99,
                    "siege": 99,
                    "niederlagen": 99,
                    "unentschieden": 99,
                    "tore_geschossen": 99,
                    "tore_kassiert": 99,
                    "punkte": 99,
                },
            ),
            _junction("Bock", "BO", "A"),
            _junction("Lessing", "LE", "A", austritt=dict(AUSTRITT)),
            _junction("Ohne", "OH", "B"),
            _junction("Komplett", "KO", "B"),
            # No row for Fremd, and none for Helmholtz in 2025 — both are asserted on.
        ]
    )

    mongo_database.spiele.insert_many(
        [
            _spiel(1, "gruppenphase", "Helmholtz", "Bock", 3, 1, ergebnis="3:1"),
            _spiel(2, "gruppenphase", "Lessing", "Helmholtz", 2, 2, ergebnis="2:2"),
            _spiel(3, "gruppenphase", "Helmholtz", "Lessing", 0, 4, ergebnis="0:4"),
            # A forfeit: Lessing stayed away, so the awarded result counts as played and as an absage both.
            _spiel(4, "gruppenphase", "Bock", "Lessing", 1, 0, ergebnis="1:0", sonderereignis="nichtantreten_team2"),
            # Not yet played.
            _spiel(5, "gruppenphase", "Bock", "Helmholtz", None, None, ergebnis=None),
            # The playoff match, and the whole difference between the two scopes.
            _spiel(6, "viertelfinale", "Helmholtz", "Bock", 5, 0, ergebnis="5:0"),
            # An `ergebnis` with no goal counts behind it -- excluded, or it would group as a 0:0 draw.
            _spiel(7, "gruppenphase", "Lessing", "Ohne", None, None, ergebnis="3:0"),
            # Last season: both sides hold 2026 junction rows a 2025 fixture must not pick up.
            _spiel(8, "gruppenphase", "Helmholtz", "Lessing", 7, 0, ergebnis="7:0", saison_id=PRIOR_SAISON),
            # An unfilled bracket slot carrying no result, so the spiele join is proved against a null side.
            _spiel(9, "viertelfinale", None, "Bock", None, None, ergebnis=None),
            # Called off and never played: one row proves the count on both sides of the `$group`/fallback split.
            _spiel(10, "gruppenphase", "Helmholtz", "Ohne", None, None, ergebnis=None, sonderereignis="ausgefallen"),
            # The same, one phase later, so the absage count can be shown to obey the scope.
            _spiel(11, "halbfinale", "Helmholtz", "Bock", None, None, ergebnis=None, sonderereignis="ausgefallen"),
            # Its opponent holds no junction row, so Komplett gains a counting match without moving anyone else.
            _spiel(12, "gruppenphase", "Komplett", "Fremd", 2, 0, ergebnis="2:0"),
            # Struck from the record, so Ohne stays on zero played and takes a second absage beside its Spiel 10.
            _spiel(13, "gruppenphase", "Ohne", "Fremd", None, None, ergebnis=None, sonderereignis="annulliert"),
            # Abandoned with the score that stood: Komplett's second counting match, and still no absage.
            _spiel(14, "gruppenphase", "Komplett", "Fremd", 4, 1, ergebnis="4:1", sonderereignis="abgebrochen"),
        ]
    )

    return SeededLeague(database=mongo_database, team_oids=dict(TEAM_OIDS))
