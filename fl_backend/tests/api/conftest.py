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

# The spelling a season row and a fixture side both copy in at entry. Helmholtz's differs from its
# club document's, which is what proves the copy; Fremd, holding no season row, is written to match
# its club document instead.
SAISON_SHORTHANDS = {
    "Helmholtz": "HE",
    "Bock": "BO",
    "Lessing": "LE",
    "Ohne": "OH",
    "Fremd": "FR",
    "Komplett": "KO",
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

    # A client of its own: the seeding one is asynchronous, and this guard's comparison is synchronous.
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


def _junction(key: str, gruppe: str, **overrides: Any) -> dict[str, Any]:
    """The row `post_saison_team` writes: the club's identity COPIED in at entry, never joined on read."""

    return {
        "saison_id": SAISON,
        "team_id": TEAM_OIDS[key],
        "gruppe": gruppe,
        "austritt": None,
        "name": key,
        "shorthand": SAISON_SHORTHANDS[key],
        **overrides,
    }


def _side(key: str | None, tore: int | None) -> dict[str, Any] | None:
    """The name and shorthand a fixture side carries are COMPOSED from the season row and ride on no payload (`docs/backend/spec.md :: I3`)."""

    if key is None:
        return None

    return {"team_id": TEAM_OIDS[key], "name": key, "tore": tore, "shorthand": SAISON_SHORTHANDS[key]}


def _spieltag_oid(saison_id: str, nr: int) -> ObjectId:
    """One per fixture, not one per phase: that would field six clubs twice on a Spieltag, which `REQ-SPIELTAG-001` refuses.

    No `spieltage` row is seeded and nothing joins on the key, but `spieltag_id` is not nullable.
    """

    return ObjectId(f"6890a1b2c3d4e5f6{saison_id}{nr:04d}")


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
        "spieltag_id": _spieltag_oid(saison_id, nr),
        # Written null rather than left out: each is a nullable key the collection still REQUIRES,
        # and a `quelle` is its side's independent sibling rather than a value the side implies
        # (`docs/backend/spec.md :: I22`).
        "datum": None,
        "uhrzeit": None,
        "ort": None,
        "schiedsrichter": None,
        "team1_quelle": None,
        "team2_quelle": None,
        "elfmeterschiessen": None,
        "sonderereignis": sonderereignis,
        "ergebnis": ergebnis,
        "team1": _side(team1, tore1),
        "team2": _side(team2, tore2),
    }


# Module level, so `test_corpus_shape.py` can hold the rows to the shipped validator without a
# database: the collections these are written into carry none (`tests/conftest.py :: mongo_database`).
TEAMS = [
    _team("Helmholtz", "HG", name="Helmholtz-Gymnasium"),
    _team("Bock", "BO"),
    _team("Lessing", "LE"),
    _team("Ohne", "OH"),
    _team("Fremd", "FR"),
    _team("Komplett", "KO"),
]

SAISON_TEAMS = [
    # Figures matching nothing the matches below produce, so any read of a stored copy fails.
    _junction(
        "Helmholtz",
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
    _junction("Bock", "A"),
    _junction("Lessing", "A", austritt=dict(AUSTRITT)),
    _junction("Ohne", "B"),
    _junction("Komplett", "B"),
    # No row for Fremd, and none for Helmholtz in 2025 — both are asserted on.
]

SPIELE = [
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


@pytest.fixture(scope="session")
def league(mongo_database: Database) -> SeededLeague:
    """Collections dropped singly: `fl_test` is shared, not owned.

    `squads` in `test_spieler_memberships_read.py` seeds the rest of it, so a clear reaching past
    what this fixture seeds empties that corpus, and the reverse.
    """

    for collection in ("teams", "saison_teams", "spiele"):
        mongo_database.drop_collection(collection)

    # Copies: `insert_many` writes `_id` into each mapping it is handed, and the module-level rows
    # are read by `test_corpus_shape.py` as the fixture declares them.
    mongo_database.teams.insert_many([dict(row) for row in TEAMS])
    mongo_database.saison_teams.insert_many([dict(row) for row in SAISON_TEAMS])
    mongo_database.spiele.insert_many([dict(row) for row in SPIELE])

    return SeededLeague(database=mongo_database, team_oids=dict(TEAM_OIDS))


# A floor rather than the exact count: an endpoint added is covered by the parametrisation in each
# module without editing anything, so pinning the number would ask for a bump and prove nothing.

# One constant rather than one per module: `test_admin_guard.py` walks the published surface and
# `test_actor_binding.py` the mounted routes, and a floor raised for one leaves the other standing
# under a tree it has outgrown.

# Set under the inventory by less than the largest router holds, so that router dropping out of the
# mount lands below the floor.
MINIMUM_EXPECTED_MUTATIONS = 30
