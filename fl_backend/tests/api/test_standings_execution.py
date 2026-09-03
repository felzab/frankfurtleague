from typing import Any, Iterator

import pytest
from bson import ObjectId
from pydantic import ValidationError
from pymongo import MongoClient
from pymongo.database import Database

from app.api.saisons.schemas import FLSaisonForfeitErgebnis, FLSaisonRules
from app.api.spiele.schemas import FLSonderereignis, FLSpiel
from app.api.spieler.schemas import FLSpielerStufe
from app.api.teams.schemas import FLTeam, FLTeamsFilterParams, FLTeamStatistikScope
from app.api.teams.services import ZERO_STATISTIK, build_statistik_by_team, build_team_pipeline
from app.core.collections import Collection
from tests.worker import worker_database

DATABASE_NAME = worker_database("fl_standings_test")

SAISON_ID = "2026"
PRIOR_SAISON_ID = "2025"

# Typed as the `Literal` list `FLSaisonRules` declares: a bare `list[str]` is invariant against it.
STUFEN: list[FLSpielerStufe] = ["E1", "Q1", "Q2", "Q3", "Q4"]

RULES = FLSaisonRules(
    win_points=3,
    draw_points=1,
    qualifiers_per_group=2,
    number_of_groups=4,
    teams_per_group=4,
    tiebreak_order="tordifferenz",
    max_kadergroesse=18,
    forfeit_ergebnis=FLSaisonForfeitErgebnis(sieger_tore=3, verlierer_tore=0),
    erlaubte_stufen=STUFEN,
)

# Fixed rather than generated, so a failure names the same club every run.
ANNA = ObjectId("6890a1b2c3d4e5f607230001")
BODO = ObjectId("6890a1b2c3d4e5f607230002")
CARO = ObjectId("6890a1b2c3d4e5f607230003")
DIRK = ObjectId("6890a1b2c3d4e5f607230004")
# No junction row, so the strict join drops it while its fixtures still feed its opponents.
EXTERN = ObjectId("6890a1b2c3d4e5f607230005")

NAMES = {ANNA: "Anna", BODO: "Bodo", CARO: "Caro", DIRK: "Dirk", EXTERN: "Extern"}

SPIELTAG_ID = ObjectId("6890a1b2c3d4e5f6072300a1")


def team_document(team_id: ObjectId) -> dict[str, Any]:
    name = NAMES[team_id]

    return {
        "_id": team_id,
        "name": name,
        "shorthand": name[:2].upper(),
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
        "inactive_since": None,
    }


def junction(team_id: ObjectId) -> dict[str, Any]:
    """A dict rather than a model: `saison_teams` has no model of the row."""

    name = NAMES[team_id]

    return {
        "saison_id": SAISON_ID,
        "team_id": team_id,
        "gruppe": "A",
        "austritt": None,
        "name": name,
        "shorthand": name[:2].upper(),
    }


def side(team_id: ObjectId, tore: int | None) -> dict[str, Any]:
    return {"team_id": team_id, "name": NAMES[team_id], "shorthand": NAMES[team_id][:2].upper(), "tore": tore}


def spiel_document(
    nr: int,
    saison_phase: str,
    team1: ObjectId | None,
    team2: ObjectId | None,
    tore1: int | None,
    tore2: int | None,
    *,
    ergebnis: str | None,
    sonderereignis: FLSonderereignis | None = None,
    saison_id: str = SAISON_ID,
) -> dict[str, Any]:
    """Goals and `ergebnis` are supplied separately -- production derives one from the other -- which is what builds the hand-edited shape."""

    return {
        "_id": ObjectId(f"6890a1b2c3d4e5f60723{nr:04d}"),
        "spiel_nr": nr,
        "saison_id": saison_id,
        "saison_phase": saison_phase,
        "spieltag_id": SPIELTAG_ID,
        "team1": None if team1 is None else side(team1, tore1),
        "team2": None if team2 is None else side(team2, tore2),
        "team1_quelle": None,
        "team2_quelle": None,
        "datum": "2026-03-15",
        "uhrzeit": "18:00:00",
        "ort": None,
        "schiedsrichter": None,
        "ergebnis": ergebnis,
        "elfmeterschiessen": None,
        "sonderereignis": sonderereignis,
        "notiz": None,
    }


def spiel_documents() -> list[dict[str, Any]]:
    """One fixture per branch of the counting rule, so an arm only one derivation takes cannot hide."""

    return [
        spiel_document(1, "gruppenphase", ANNA, BODO, 3, 1, ergebnis="3:1"),
        spiel_document(2, "gruppenphase", ANNA, CARO, 2, 2, ergebnis="2:2"),
        # A forfeit: the awarded result counts as played and as an absage both.
        spiel_document(3, "gruppenphase", BODO, DIRK, 1, 0, ergebnis="1:0", sonderereignis="nichtantreten_team2"),
        spiel_document(4, "gruppenphase", CARO, DIRK, None, None, ergebnis=None),
        # An `ergebnis` with no goal counts behind it, which would group as a 0:0 draw uncaught.
        spiel_document(5, "gruppenphase", ANNA, BODO, None, None, ergebnis="3:0"),
        # The whole difference between the two scopes.
        spiel_document(6, "viertelfinale", ANNA, CARO, 5, 0, ergebnis="5:0"),
        spiel_document(7, "gruppenphase", CARO, DIRK, None, None, ergebnis=None, sonderereignis="ausgefallen"),
        spiel_document(8, "gruppenphase", DIRK, ANNA, None, None, ergebnis=None, sonderereignis="annulliert"),
        # Abandoned with the score that stood: played, and never an absage.
        spiel_document(9, "gruppenphase", ANNA, BODO, 4, 1, ergebnis="4:1", sonderereignis="abgebrochen"),
        # An unfilled bracket slot, so a null side is proved against both derivations.
        spiel_document(10, "viertelfinale", None, DIRK, None, None, ergebnis=None),
        # Last season: both sides hold 2026 junction rows a 2025 fixture must not pick up.
        spiel_document(11, "gruppenphase", ANNA, BODO, 7, 0, ergebnis="7:0", saison_id=PRIOR_SAISON_ID),
        # Its opponent holds no junction row, so Caro gains a counting match without moving anyone else.
        spiel_document(12, "gruppenphase", CARO, EXTERN, 2, 0, ergebnis="2:0"),
        # One club on both sides: the only branch `build_statistik_by_team`'s `sides` SET exists for.
        # Without it a list there counts Bodo twice and every test still passes, letting the bracket
        # seed from a table the page never showed.
        spiel_document(13, "gruppenphase", BODO, BODO, 2, 2, ergebnis="2:2"),
    ]


@pytest.fixture(scope="module")
def seeded(mongo_url: str) -> Iterator[Database]:
    """A database of this module's own: the session-scoped `league` owns the collections of `fl_test`.

    Built once for the module and dropped on the way out: `tests/database.py` amortises a per-test
    build, and its registry would outlive the database.
    """

    client = MongoClient(mongo_url)
    try:
        client.drop_database(DATABASE_NAME)
        database = client[DATABASE_NAME]

        database[Collection.TEAMS].insert_many([team_document(team_id) for team_id in NAMES])
        database[Collection.SAISON_TEAMS].insert_many([junction(team_id) for team_id in NAMES if team_id != EXTERN])
        database[Collection.SPIELE].insert_many(spiel_documents())

        yield database
    finally:
        client.drop_database(DATABASE_NAME)
        client.close()


def season_in_scope(scope: FLTeamStatistikScope) -> list[FLSpiel]:
    """The fixtures a caller of `build_statistik_by_team` must hand it: the `$lookup`'s `$match`, spelled as a filter."""

    return [
        FLSpiel.model_validate(document)
        for document in spiel_documents()
        if document["saison_id"] == SAISON_ID and (scope == "gesamt" or document["saison_phase"] == "gruppenphase")
    ]


class TestTheTwoDerivationsAgree:
    """The pipeline reads the collection and `build_statistik_by_team` reads a list; the bracket resolution now trusts the second."""

    @pytest.mark.db
    @pytest.mark.parametrize("scope", ["gruppenphase", "gesamt"])
    def test_the_figures_match_the_pipelines_over_the_same_fixtures(self, seeded: Database, scope: FLTeamStatistikScope):
        filters = FLTeamsFilterParams(saison_id=SAISON_ID, statistik_scope=scope)
        rows = list(seeded[Collection.TEAMS].aggregate(build_team_pipeline(filters=filters, rules=RULES)))

        derived = build_statistik_by_team(season_in_scope(scope), RULES)

        # Guarded rather than assumed: an empty read, or a table of zeros, would agree with anything.
        assert {row["name"] for row in rows} == {"Anna", "Bodo", "Caro", "Dirk"}
        assert any(row["statistik"]["anzahl_gespielte_spiele"] > 0 for row in rows)

        for row in rows:
            expected = derived.get(row["_id"], ZERO_STATISTIK)
            assert row["statistik"] == dict(expected), f"the two derivations disagree about {row['name']}"


class TestTheScopeIsTheCallersFilter:
    """Its own class, and unmarked: the claim below reads `spiel_documents` through a filter and opens no database."""

    def test_the_scope_is_the_callers_filter_and_moves_the_figures(self):
        """Both halves of one claim: the derivation filters nothing, so a caller handing it the wrong season answers the wrong question."""

        gruppenphase = build_statistik_by_team(season_in_scope("gruppenphase"), RULES)
        gesamt = build_statistik_by_team(season_in_scope("gesamt"), RULES)

        assert gruppenphase[ANNA].anzahl_gespielte_spiele == 3
        assert gesamt[ANNA].anzahl_gespielte_spiele == 4
        assert gruppenphase[DIRK] == gesamt[DIRK]


class TestAPipelineWithoutRulesDerivesNoTable:
    @pytest.mark.db
    def test_a_row_it_returns_is_refused_by_flteam(self, seeded: Database):
        """The loud half of `rules=None`: a caller that forgets to supply figures gets a refusal, never a table of zeros."""

        filters = FLTeamsFilterParams(saison_id=SAISON_ID)
        rows = list(seeded[Collection.TEAMS].aggregate(build_team_pipeline(filters=filters, rules=None)))

        assert rows, "the read returned nothing, so the refusal below would prove nothing"
        assert "statistik" not in rows[0]

        with pytest.raises(ValidationError) as refused:
            FLTeam.model_validate(rows[0])

        assert [str(error["loc"][-1]) for error in refused.value.errors()] == ["statistik"]
