from bson import ObjectId

from app.api.teams.schemas import FLGruppen, FLGruppenTeam, FLTeamStatistik
from app.api.teams.services import build_tabelle
from app.shared.schemas.literals import FLAustrittType


def row(name: str, *, played: int, pending: int, austritt_type: FLAustrittType | None = None) -> FLGruppenTeam:
    return FLGruppenTeam(
        id=ObjectId(),
        name=name,
        shorthand=name[:3].upper(),
        statistik=FLTeamStatistik(count_gespielte_spiele=played),
        austritt_type=austritt_type,
        count_pending_spiele=pending,
    )


def test_the_tabelle_numbers_each_row_that_can_hold_a_platz_and_walks_past_the_rest():
    """A club that left keeps its row and takes no place, as does one with no match that counts or still could."""

    standing = [
        row("Alpha", played=3, pending=0),
        row("Beta", played=3, pending=0, austritt_type="disqualifikation"),
        row("Gamma", played=0, pending=0),
        row("Delta", played=2, pending=1),
    ]

    tabelle = build_tabelle(FLGruppen({"A": standing}))

    assert [(placed.name, placed.platz) for placed in tabelle.root["A"]] == [("Alpha", 1), ("Beta", None), ("Gamma", None), ("Delta", 2)]
