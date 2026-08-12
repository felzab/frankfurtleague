"""
TESTS · the seeded league the team and spiele pipeline suites read

`build_team_pipeline` and `build_spiele_pipeline` are dicts MongoDB executes: the schema suites
prove a dict says the right thing, and only a database proves the right thing comes back — so
everything here is behind the `db` marker (ADR-0023), and the `mongod` container is a session
fixture in `tests/conftest.py` because the constraint suite wants the same one. A short list of
teams and matches, sized so the expected figures can be worked out on paper — each row makes
exactly one pipeline invariant observable, its purpose commented beside it below, and the
hand-derived figures sit above `league`.

Invariants:
- The corpus is never "cleaned up" to match production: several rows are deliberately impossible.
- Season 2025 exists so a join keyed on anything but the fixture's own season fails a test here.
"""

from dataclasses import dataclass
from typing import Any

import pytest
from bson import ObjectId
from pymongo.database import Database

SAISON = "2026"
PRIOR_SAISON = "2025"

# Fixed rather than generated, so a failure names the same team every run. Each team makes one
# invariant observable:
TEAM_OIDS = {
    # Three Gruppenphase matches and one Viertelfinale — the SCOPE, and the only team whose two
    # tables differ. Its junction row also carries a stale `statistik` (see the seed below).
    "Helmholtz": ObjectId("6890a1b2c3d4e5f607190001"),
    # A cancelled match WITH a result — the FORFEIT rule — plus a match with no `ergebnis`.
    "Bock": ObjectId("6890a1b2c3d4e5f607190002"),
    # A match whose `ergebnis` is set while `team1.tore` is null — the hand-edited shape, and the
    # reason the `$match` restates the goal counts. Also the only DISQUALIFIED team, whose junction
    # row is the one the spiele join reads.
    "Lessing": ObjectId("6890a1b2c3d4e5f607190003"),
    # A junction row and no counting match at all — the ZEROED FALLBACK.
    "Ohne": ObjectId("6890a1b2c3d4e5f607190004"),
    # No junction row — the STRICT JOIN, which must drop it entirely even though it plays a match.
    "Fremd": ObjectId("6890a1b2c3d4e5f607190005"),
    # A counting match and NO cancellation — the only team whose `anzahl_abgesagte_spiele` comes
    # from the `$ifNull` rather than a counted row, and the state the badge's own guard reads.
    "Komplett": ObjectId("6890a1b2c3d4e5f607190006"),
}

# Lessing's disqualification, the one in the seed. A dict rather than a model, so the seed stays a
# description of documents: a fixture built through Pydantic could not express a row the validator
# rejects.
DISQUALIFIKATION = {"grund": "Nicht angetreten zum Spieltag", "datum": "2026-03-14"}


@dataclass(frozen=True)
class SeededLeague:
    """The seeded database, plus the ids a test needs to ask about one team."""

    database: Database
    team_oids: dict[str, ObjectId]


def _team(name: str, shorthand: str) -> dict[str, Any]:
    """A `teams` document carrying every field the projection reads, so the result validates as FLTeam."""
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
        # A club still in the league (ADR-0025). Present rather than omitted: Mongo matches a missing
        # field against `None`, so a seed without it passes the base filter and then fails response
        # validation -- which reads as a projection bug.
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
    is_canceled: bool = False,
    saison_id: str = SAISON,
) -> dict[str, Any]:
    """
    One `spiele` document, with the goal counts and the `ergebnis` supplied SEPARATELY.

    Production derives one from the other, so they always agree there. Passing them independently is
    what lets a test build the one document where they do not -- the hand-edited shape the pipeline's
    `team1.tore` / `team2.tore` filters exist to survive.

    A team name of `None` is a bracket slot whose occupant is not decided yet, which is a legal and
    permanent-by-default state (ADR-0034) and the one the spiele pipeline's join has to survive.
    """
    return {
        "spiel_nr": nr,
        "saison_id": saison_id,
        "saison_phase": phase,
        "is_canceled": is_canceled,
        "ergebnis": ergebnis,
        "team1": None if team1 is None else {"team_id": TEAM_OIDS[team1], "name": team1, "tore": tore1},
        "team2": None if team2 is None else {"team_id": TEAM_OIDS[team2], "name": team2, "tore": tore2},
    }


@pytest.fixture(scope="session")
def league(mongo_database: Database) -> SeededLeague:
    """The corpus described beside `TEAM_OIDS` and the rows below, inserted once.

    The figures every test asserts against, derived by hand from the seeded matches:

    ======================================================================================
    gruppenphase   Helmholtz 3 matches 1/1/1  5:7  4 pts   Bock 2  1/0/1  2:3  3 pts
                   Lessing   3 matches 1/1/1  6:3  4 pts   Ohne 0  0/0/0  0:0  0 pts
                   Komplett  1 match   1/0/0  2:0  3 pts
    gesamt         Helmholtz 4 matches 2/1/1 10:7  7 pts   Bock 3  1/0/2  2:8  3 pts
    ======================================================================================

    Helmholtz reading 3 against 4 is the cheapest proof the scope filters at all -- the same
    divergence ADR-0022 measured against the live database.

    Called off, which moves none of the figures above: Helmholtz 1 under `gruppenphase` and 2 under
    `gesamt`, Bock 1 and 2, Lessing 1 under both, Ohne 1 under both, Komplett 0 under both. Bock's
    and Lessing's is the forfeit, which the figures above count as played and this figure counts too.
    """
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
            # The stale `statistik` is the point of this row, not decoration: it holds figures that
            # match nothing the matches below produce, so any read of a stored copy fails loudly.
            {
                "saison_id": SAISON,
                "team_id": TEAM_OIDS["Helmholtz"],
                "gruppe": "A",
                "disqualifikation": None,
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
            {"saison_id": SAISON, "team_id": TEAM_OIDS["Bock"], "gruppe": "A", "disqualifikation": None},
            {"saison_id": SAISON, "team_id": TEAM_OIDS["Lessing"], "gruppe": "A", "disqualifikation": dict(DISQUALIFIKATION)},
            {"saison_id": SAISON, "team_id": TEAM_OIDS["Ohne"], "gruppe": "B", "disqualifikation": None},
            {"saison_id": SAISON, "team_id": TEAM_OIDS["Komplett"], "gruppe": "B", "disqualifikation": None},
            # No row for Fremd, and none for Helmholtz in 2025 -- both absences are asserted on.
        ]
    )

    mongo_database.spiele.insert_many(
        [
            _spiel(1, "gruppenphase", "Helmholtz", "Bock", 3, 1, ergebnis="3:1"),
            _spiel(2, "gruppenphase", "Lessing", "Helmholtz", 2, 2, ergebnis="2:2"),
            _spiel(3, "gruppenphase", "Helmholtz", "Lessing", 0, 4, ergebnis="0:4"),
            # Cancelled and carrying a result: a forfeit. It counts as played AND as called off, so
            # it is the one row proving the two counts are not a partition.
            _spiel(4, "gruppenphase", "Bock", "Lessing", 1, 0, ergebnis="1:0", is_canceled=True),
            # Not yet played.
            _spiel(5, "gruppenphase", "Bock", "Helmholtz", None, None, ergebnis=None),
            # The playoff match, and the whole difference between the two scopes.
            _spiel(6, "viertelfinale", "Helmholtz", "Bock", 5, 0, ergebnis="5:0"),
            # An `ergebnis` with no goal counts behind it -- excluded, or it would group as a 0:0 draw.
            _spiel(7, "gruppenphase", "Lessing", "Ohne", None, None, ergebnis="3:0"),
            # Last season, played, and out of scope for every team-table assertion. It is the whole
            # point of the spiele suite, though: both its sides are teams whose 2026 junction rows say
            # something the 2025 fixture must not pick up.
            _spiel(8, "gruppenphase", "Helmholtz", "Lessing", 7, 0, ergebnis="7:0", saison_id=PRIOR_SAISON),
            # A bracket slot the group phase has not filled (ADR-0034). Carries no result, so it counts
            # towards nothing here and exists only so the spiele join is proved against a null side.
            _spiel(9, "viertelfinale", None, "Bock", None, None, ergebnis=None),
            # Called off and never played. Helmholtz has counting matches and Ohne has none, so the
            # one row proves the cancellation count on both sides of the `$group`/fallback split.
            _spiel(10, "gruppenphase", "Helmholtz", "Ohne", None, None, ergebnis=None, is_canceled=True),
            # The same, one phase later, so the cancellation count can be shown to obey the scope.
            _spiel(11, "halbfinale", "Helmholtz", "Bock", None, None, ergebnis=None, is_canceled=True),
            # Played, and nothing about it called off. Its opponent holds no junction row, so the
            # match gives Komplett a counting match without moving any figure asserted above.
            _spiel(12, "gruppenphase", "Komplett", "Fremd", 2, 0, ergebnis="2:0"),
        ]
    )

    return SeededLeague(database=mongo_database, team_oids=dict(TEAM_OIDS))
