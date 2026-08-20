from dataclasses import dataclass
from typing import Any

import pytest
from bson import ObjectId
from pymongo.database import Database

SAISON = "2026"
PRIOR_SAISON = "2025"

# Fixed rather than generated, so a failure names the same team. Each row is deliberate; several are
# impossible in production and none may be cleaned up.
TEAM_OIDS = {
    # The scope: the only team whose two tables differ; its junction row carries a stale `statistik`.
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


@dataclass(frozen=True)
class SeededLeague:
    database: Database
    team_oids: dict[str, ObjectId]


def _team(name: str, shorthand: str) -> dict[str, Any]:
    return {
        "_id": TEAM_OIDS[name],
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
    for collection in ("teams", "saison_teams", "spiele"):
        mongo_database.drop_collection(collection)

    mongo_database.teams.insert_many(
        [
            _team("Helmholtz", "HE"),
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
            {
                "saison_id": SAISON,
                "team_id": TEAM_OIDS["Helmholtz"],
                "gruppe": "A",
                "austritt": None,
                "statistik": {
                    "anzahl_gespielte_spiele": 99,
                    "siege": 99,
                    "niederlagen": 99,
                    "unentschieden": 99,
                    "tore_geschossen": 99,
                    "tore_kassiert": 99,
                    "punkte": 99,
                },
            },
            {"saison_id": SAISON, "team_id": TEAM_OIDS["Bock"], "gruppe": "A", "austritt": None},
            {"saison_id": SAISON, "team_id": TEAM_OIDS["Lessing"], "gruppe": "A", "austritt": dict(AUSTRITT)},
            {"saison_id": SAISON, "team_id": TEAM_OIDS["Ohne"], "gruppe": "B", "austritt": None},
            {"saison_id": SAISON, "team_id": TEAM_OIDS["Komplett"], "gruppe": "B", "austritt": None},
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
