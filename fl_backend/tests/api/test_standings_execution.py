from collections.abc import AsyncIterator, Mapping
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.schemas import FLSaisonForfeitErgebnis, FLSaisonRules
from app.api.spiele.schemas import FLSpiel
from app.api.teams.crud import pull_tabelle
from app.api.teams.schemas import FLTeamStatistik
from app.api.teams.services import build_statistik_by_team, build_team_pipeline
from app.core.collections import Collection
from app.shared.schemas.literals import FLSonderereignis, FLSpielerStufe
from tests import documents
from tests.database import held_corpus
from tests.documents import AUSTRITT
from tests.worker import worker_database

DATABASE_NAME = worker_database("fl_standings_test")

SAISON_ID = "2026"
PRIOR_SAISON_ID = "2025"

# Typed as the `Literal` list `FLSaisonRules` declares: a bare `list[str]` is invariant against it.
STUFEN: list[FLSpielerStufe] = ["E1", "Q1", "Q2", "Q3", "Q4"]

RULES = FLSaisonRules(
    # Each term unlike the usual 3, 1 and 0, so a derivation scoring any of them by a constant disagrees with the table.
    win_points=4,
    draw_points=2,
    loss_points=1,
    qualifiers_per_gruppe=2,
    number_of_gruppen=4,
    teams_per_gruppe=4,
    tiebreak_order="tordifferenz",
    max_kader_size=18,
    forfeit_ergebnis=FLSaisonForfeitErgebnis(sieger_tore=3, verlierer_tore=0),
    allowed_stufen=STUFEN,
)

# Fixed rather than generated, so a failure names the same club every run.
ANNA = ObjectId("6890a1b2c3d4e5f607230001")
BODO = ObjectId("6890a1b2c3d4e5f607230002")
CARO = ObjectId("6890a1b2c3d4e5f607230003")
DIRK = ObjectId("6890a1b2c3d4e5f607230004")
# No season row, so the strict join drops it while its fixtures still feed its opponents.
EXTERN = ObjectId("6890a1b2c3d4e5f607230005")
# A counting match and no fixture that did not take place.
EMIL = ObjectId("6890a1b2c3d4e5f607230006")
# No counting match at all, and one knockout fixture called off.
FRIDA = ObjectId("6890a1b2c3d4e5f607230007")

NAMES = {ANNA: "Anna", BODO: "Bodo", CARO: "Caro", DIRK: "Dirk", EXTERN: "Extern", EMIL: "Emil", FRIDA: "Frida"}

SPIELTAG_ID = ObjectId("6890a1b2c3d4e5f6072300a1")

# On Anna's season row, figures matching nothing her fixtures produce, so a read of the stored copy shows.
STALE_STATISTIK = {field: 99 for field in FLTeamStatistik.model_fields}


def team_document(team_id: ObjectId) -> dict[str, Any]:
    name = NAMES[team_id]

    # Anna's club has been renamed since she entered, so only her season row says what this season calls her.
    return documents.team_document(team_id, "Anna-Schule" if team_id == ANNA else name, name[:3].upper())


def junction(team_id: ObjectId) -> dict[str, Any]:
    name = NAMES[team_id]
    row = documents.saison_team_document(
        SAISON_ID, team_id, name, name[:3].upper(), gruppe="B" if team_id == DIRK else "A", austritt=dict(AUSTRITT) if team_id == DIRK else None
    )

    # Added past the record model, which holds no stored figures.
    return {**row, "statistik": STALE_STATISTIK} if team_id == ANNA else row


def side(team_id: ObjectId, tore: int | None) -> dict[str, Any]:
    return {"team_id": team_id, "tore": tore}


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

    return documents.spiel_document(
        spiel_id=ObjectId(f"6890a1b2c3d4e5f60723{nr:04d}"),
        saison_id=saison_id,
        spiel_nr=nr,
        spieltag_id=SPIELTAG_ID,
        saison_phase=saison_phase,
        team1=None if team1 is None else side(team1, tore1),
        team2=None if team2 is None else side(team2, tore2),
        date="2026-03-15",
        time="18:00:00",
        ergebnis=ergebnis,
        sonderereignis=sonderereignis,
    )


def spiel_documents() -> list[dict[str, Any]]:
    """One fixture per branch of the counting rule, so an arm only one derivation takes cannot hide."""

    return [
        spiel_document(1, "gruppenphase", ANNA, BODO, 3, 1, ergebnis="3:1"),
        spiel_document(2, "gruppenphase", ANNA, CARO, 2, 2, ergebnis="2:2"),
        # A forfeit: the awarded result counts as played, and never as an absage.
        spiel_document(3, "gruppenphase", BODO, DIRK, 1, 0, ergebnis="1:0", sonderereignis="nichtantreten_team2"),
        spiel_document(4, "gruppenphase", CARO, DIRK, None, None, ergebnis=None),
        # An `ergebnis` with no goal counts behind it, which would group as a 0:0 draw uncaught.
        spiel_document(5, "gruppenphase", ANNA, BODO, None, None, ergebnis="3:0"),
        # A knockout result, which no figure of the table counts.
        spiel_document(6, "viertelfinale", ANNA, CARO, 5, 0, ergebnis="5:0"),
        spiel_document(7, "gruppenphase", CARO, DIRK, None, None, ergebnis=None, sonderereignis="ausgefallen"),
        spiel_document(8, "gruppenphase", DIRK, ANNA, None, None, ergebnis=None, sonderereignis="annulliert"),
        # Abandoned with the score that stood: played, and never an absage.
        spiel_document(9, "gruppenphase", ANNA, BODO, 4, 1, ergebnis="4:1", sonderereignis="abgebrochen"),
        # An unfilled bracket slot, which the phase keeps out of the table with its null side.
        spiel_document(10, "viertelfinale", None, DIRK, None, None, ergebnis=None),
        # Last season: both sides hold 2026 season rows a 2025 fixture must not pick up.
        spiel_document(11, "gruppenphase", ANNA, BODO, 7, 0, ergebnis="7:0", saison_id=PRIOR_SAISON_ID),
        # Its opponent holds no season row, so Caro gains a counting match without moving anyone else.
        spiel_document(12, "gruppenphase", CARO, EXTERN, 2, 0, ergebnis="2:0"),
        # One club on both sides: the only branch `build_statistik_by_team`'s `sides` SET exists for.
        # Without it a list there counts Bodo twice and every test still passes, letting the bracket
        # seed from a table the page never showed.
        spiel_document(13, "gruppenphase", BODO, BODO, 2, 2, ergebnis="2:2"),
        spiel_document(14, "gruppenphase", EMIL, EXTERN, 1, 1, ergebnis="1:1"),
        # Called off in the knockout, so the absage obeys the phase like every figure beside it.
        spiel_document(15, "halbfinale", FRIDA, EXTERN, None, None, ergebnis=None, sonderereignis="ausgefallen"),
    ]


def group_phase() -> list[FLSpiel]:
    """The fixtures a caller of `build_statistik_by_team` must hand it: the season's group phase."""

    return [
        FLSpiel.model_validate(document)
        for document in spiel_documents()
        if document["saison_id"] == SAISON_ID and document["saison_phase"] == "gruppenphase"
    ]


def figures(played: int, won: int, drawn: int, lost: int, scored: int, conceded: int, punkte: int, cancelled: int) -> FLTeamStatistik:
    return FLTeamStatistik(
        count_played_spiele=played,
        siege=won,
        unentschieden=drawn,
        niederlagen=lost,
        tore_scored=scored,
        tore_conceded=conceded,
        punkte=punkte,
        count_cancelled_spiele=cancelled,
    )


# Worked by hand from `spiel_documents` under `RULES`: what each club's row of the table reads.
GRUPPENPHASE: Mapping[ObjectId, FLTeamStatistik] = {
    # Fixtures 1, 2 and 9 counted, 5 not; 8 annulled.
    ANNA: figures(3, 2, 1, 0, 9, 4, 10, 1),
    # Fixtures 1, 3, 9 and 13 counted, the forfeit among them; 13 once, though Bodo holds both sides.
    BODO: figures(4, 1, 1, 2, 5, 9, 8, 0),
    # Fixtures 2 and 12 counted, 4 unplayed; 7 called off.
    CARO: figures(2, 1, 1, 0, 4, 2, 6, 1),
    # Fixture 3's award counted against Dirk; 7 and 8 absagen.
    DIRK: figures(1, 0, 0, 1, 0, 1, 1, 2),
    EMIL: figures(1, 0, 1, 0, 1, 1, 2, 0),
    # Held by no season row, so no table shows Extern: the derivation still counts its fixtures 12 and 14.
    EXTERN: figures(2, 0, 1, 1, 1, 3, 3, 0),
}


class TestEachBranchOfTheCountingRule:
    """Unmarked: `build_statistik_by_team` reads a list, and the Tabelle's read below hands it the season's group phase."""

    def test_each_team_reads_the_figures_worked_by_hand(self):
        """The derivation filters nothing, so the figures move only through the fixtures the caller hands it."""

        derived = build_statistik_by_team(group_phase(), RULES)

        assert {NAMES[team_id]: row for team_id, row in derived.items()} == {NAMES[team_id]: row for team_id, row in GRUPPENPHASE.items()}


@pytest.fixture(scope="module")
async def seeded(mongo_replica_set_url: str) -> AsyncIterator[AsyncDatabase]:
    """A database of this module's own, seeded once for its reads, which no case writes."""

    async def seed(database: AsyncDatabase) -> AsyncDatabase:
        await database[Collection.TEAMS].insert_many([team_document(team_id) for team_id in NAMES])
        await database[Collection.SAISON_TEAMS].insert_many([junction(team_id) for team_id in NAMES if team_id != EXTERN])
        await database[Collection.SPIELE].insert_many(spiel_documents())

        return database

    async with held_corpus(
        mongo_replica_set_url, DATABASE_NAME, seed, stores_a_refused_shape="Anna's season row holds stale figures past its record model"
    ) as database:
        yield database


async def standings(database: AsyncDatabase) -> dict[str, Mapping[str, Any]]:
    pipeline = build_team_pipeline(saison_id=SAISON_ID)

    return {row["name"]: row for row in await (await database[Collection.TEAMS].aggregate(pipeline)).to_list(length=None)}


@pytest.mark.db
class TestTheTabelleRead:
    async def test_each_row_reads_the_figures_worked_by_hand(self, seeded: AsyncDatabase):
        """The read narrows the season's fixtures to its group phase itself, so the knockout ones seeded here count nowhere."""

        tabelle = await pull_tabelle(
            teams_collection=seeded[Collection.TEAMS], spiele_collection=seeded[Collection.SPIELE], saison_id=SAISON_ID, rules=RULES
        )

        rows = {row.name: row.statistik for gruppe in tabelle.values() for row in gruppe}
        # Frida played only a knockout fixture, called off, so every figure of hers is zero.
        assert rows == {NAMES[team_id]: GRUPPENPHASE.get(team_id, FLTeamStatistik()) for team_id in NAMES if team_id != EXTERN}

    async def test_the_season_row_supplies_the_name_the_gruppe_and_the_whole_austritt(self, seeded: AsyncDatabase):
        """The club's own name is one it took later; the record travels whole, as a flag would pass a presence check."""

        rows = await standings(seeded)

        assert "Anna-Schule" not in rows
        assert (rows["Dirk"]["gruppe"], rows["Dirk"]["austritt"]) == ("B", AUSTRITT)
        assert (rows["Anna"]["gruppe"], rows["Anna"]["austritt"]) == ("A", None)
