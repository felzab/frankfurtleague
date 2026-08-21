"""SAISONS · the documents a season's draw inserts, composed and never written.

Pure by construction: the caller owns the reads that supply the clubs and the writes that follow.
Nothing here judges the draw against the season, because a half-written draw is all such a rule
could see.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from bson import ObjectId

from app.api.saisons.schedule import knockout_phases_for, qualifier_count
from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.schemas import FLSaisonPhase, FLSpielQuelleGruppe, FLSpielQuelleSpiel, FLSpielTeamField
from app.api.teams.schemas import FLGruppenNames
from app.api.teams.services import offered_gruppen

# Pinned, not derived: pairing partnered groups fixes WHO meets in round one, never WHERE a fixture
# sits -- 8 of 24 such placements at 4x2, and 480 of 576 at 4x4, meet a same-group pair early. A
# published bracket is a table in every competition.
BRACKET_SEEDING: Mapping[tuple[int, int], tuple[tuple[FLGruppenNames, int], ...]] = {
    (1, 2): (("A", 1), ("A", 2)),
    (1, 4): (("A", 1), ("A", 4), ("A", 2), ("A", 3)),
    (1, 8): (("A", 1), ("A", 8), ("A", 4), ("A", 5), ("A", 2), ("A", 7), ("A", 3), ("A", 6)),
    (1, 16): (
        ("A", 1),
        ("A", 16),
        ("A", 8),
        ("A", 9),
        ("A", 4),
        ("A", 13),
        ("A", 5),
        ("A", 12),
        ("A", 2),
        ("A", 15),
        ("A", 7),
        ("A", 10),
        ("A", 3),
        ("A", 14),
        ("A", 6),
        ("A", 11),
    ),
    (2, 1): (("A", 1), ("B", 1)),
    (2, 2): (("A", 1), ("B", 2), ("B", 1), ("A", 2)),
    (2, 4): (("A", 1), ("B", 4), ("A", 2), ("B", 3), ("B", 1), ("A", 4), ("B", 2), ("A", 3)),
    (2, 8): (
        ("A", 1),
        ("B", 8),
        ("A", 4),
        ("B", 5),
        ("A", 2),
        ("B", 7),
        ("A", 3),
        ("B", 6),
        ("B", 1),
        ("A", 8),
        ("B", 4),
        ("A", 5),
        ("B", 2),
        ("A", 7),
        ("B", 3),
        ("A", 6),
    ),
    (4, 1): (("A", 1), ("B", 1), ("C", 1), ("D", 1)),
    (4, 2): (("A", 1), ("B", 2), ("C", 1), ("D", 2), ("B", 1), ("A", 2), ("D", 1), ("C", 2)),
    (4, 4): (
        ("A", 1),
        ("B", 4),
        ("C", 2),
        ("D", 3),
        ("B", 1),
        ("A", 4),
        ("D", 2),
        ("C", 3),
        ("C", 1),
        ("D", 4),
        ("A", 2),
        ("B", 3),
        ("D", 1),
        ("C", 4),
        ("B", 2),
        ("A", 3),
    ),
}


@dataclass(frozen=True)
class EnteredTeam:
    """One club as its `saison_teams` row holds it.

    `name` and `shorthand` come off the ROW, which is what the season is played under. `row_id` is
    the entry order, and no edit to either name redraws it.
    """

    row_id: ObjectId
    team_id: ObjectId
    gruppe: FLGruppenNames
    name: str
    shorthand: str


@dataclass(frozen=True)
class Spielplan:
    """A whole season's draw, each list in the order it is played and inserted."""

    spieltage: tuple[dict[str, Any], ...]
    spiele: tuple[dict[str, Any], ...]


def circle_rounds(teams: int) -> tuple[tuple[tuple[int, int], ...], ...]:
    """Every round of one group's round robin, as index pairs into its ordered team list.

    A pair's FIRST index is `team1`. Position 0 is pinned while the rest rotate, so its pair flips
    on odd rounds -- otherwise that club is listed first in every round.
    """

    if teams < 2:
        return ()

    # A dummy for an odd field, so a round pairs the whole list; whoever draws it byes that round.
    field: list[int | None] = list(range(teams))
    if teams % 2:
        field.append(None)

    size = len(field)
    rounds: list[tuple[tuple[int, int], ...]] = []
    for index in range(size - 1):
        pairs: list[tuple[int, int]] = []
        for offset in range(size // 2):
            one, other = field[offset], field[size - 1 - offset]
            if one is None or other is None:
                continue
            pairs.append((other, one) if offset == 0 and index % 2 else (one, other))
        rounds.append(tuple(pairs))
        # Position 0 stays put while the rest rotate: rotating the WHOLE list maps this pairing onto
        # itself, so every round would repeat the first.
        field = [field[0], field[-1], *field[1:-1]]

    return tuple(rounds)


def _squads(rules: FLSaisonRules, entered: Sequence[EnteredTeam]) -> dict[FLGruppenNames, tuple[EnteredTeam, ...]]:
    """Each offered group's clubs in entry order, the groups themselves in A-D order.

    Raises rather than drawing what stands: a group off its size shortens one round robin while
    every matchday's `anzahl_spiele` goes on expecting the full one.
    """

    squads: dict[FLGruppenNames, list[EnteredTeam]] = {gruppe: [] for gruppe in offered_gruppen(rules.number_of_groups)}
    for team in sorted(entered, key=lambda row: row.row_id):
        if team.gruppe not in squads:
            raise ValueError(f"{team.name} stands in group {team.gruppe}, which a season of {rules.number_of_groups} group(s) does not offer")
        squads[team.gruppe].append(team)

    wrong = {gruppe: len(squad) for gruppe, squad in squads.items() if len(squad) != rules.teams_per_group}
    if wrong:
        raise ValueError(f"this season plays groups of {rules.teams_per_group}; these hold otherwise: {wrong}")

    return {gruppe: tuple(squad) for gruppe, squad in squads.items()}


def _side(team: EnteredTeam) -> dict[str, Any]:
    """One side of a group fixture, composed through the model every read validates against.

    `keep_oid` holds `team_id` as an ObjectId: dumped to its string, the `spiele` validator refuses
    the whole document.
    """

    return FLSpielTeamField(team_id=team.team_id, tore=None, name=team.name, shorthand=team.shorthand).model_dump(context={"keep_oid": True})


def _spieltag(*, saison_id: str, phase: FLSaisonPhase, position: int) -> dict[str, Any]:
    """One matchday. `position` restarts at 1 in each phase, which is what `uniq_saison_id_saison_phase_position` keys on."""

    return {
        "_id": ObjectId(),
        # Null because dating a matchday is a separate operation: the draw settles the round and its
        # place, and `PATCH /spieltage/{id}` -- a dates-only payload -- is where a person sets these.
        "beginn": None,
        "ende": None,
        "saison_phase": phase,
        "saison_id": saison_id,
        "position": position,
    }


def _spiel(
    *,
    saison_id: str,
    phase: FLSaisonPhase,
    spieltag_id: ObjectId,
    spiel_nr: int,
    team1: dict[str, Any] | None = None,
    team2: dict[str, Any] | None = None,
    team1_quelle: dict[str, Any] | None = None,
    team2_quelle: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """One fixture carrying every key `app/core/constraints.py :: COLLECTION_VALIDATORS` requires.

    Nothing is scheduled and nothing has happened, so the rest is null: a date, a venue and a
    referee are the admin's, and a drawn season states none of them.
    """

    return {
        # Real ObjectIds, never their strings: both id fields are declared `objectId`, so a
        # `mode="json"` dump of this document fails the validator on four fields at once.
        "_id": ObjectId(),
        "team1": team1,
        "team2": team2,
        "team1_quelle": team1_quelle,
        "team2_quelle": team2_quelle,
        "datum": None,
        "uhrzeit": None,
        "ort": None,
        "schiedsrichter": None,
        "ergebnis": None,
        "elfmeterschiessen": None,
        "spieltag_id": spieltag_id,
        # A plain int: BSON encodes it as int32, where `bson.Int64` fails the declared `"int"`.
        "spiel_nr": spiel_nr,
        "sonderereignis": None,
        "saison_phase": phase,
        "saison_id": saison_id,
    }


def draw_spielplan(*, saison_id: str, rules: FLSaisonRules, entered: Sequence[EnteredTeam]) -> Spielplan:
    """Every document one season's draw inserts, `spiel_nr` contiguous from 1 in playing order.

    No document carries a date: the draw settles who plays whom and in what order, and every date is
    set afterwards, one matchday and one fixture at a time.
    """

    squads = _squads(rules, entered)

    spieltage: list[dict[str, Any]] = []
    spiele: list[dict[str, Any]] = []
    spiel_nr = 1

    # Round k of every group is matchday k: the groups play in step, so no club stands twice on one
    # matchday and every group finishes its round robin on the same one.
    for index, pairs in enumerate(circle_rounds(rules.teams_per_group)):
        spieltag = _spieltag(saison_id=saison_id, phase="gruppenphase", position=index + 1)
        spieltage.append(spieltag)
        for squad in squads.values():
            for one, other in pairs:
                spiele.append(
                    _spiel(
                        saison_id=saison_id,
                        phase="gruppenphase",
                        spieltag_id=spieltag["_id"],
                        spiel_nr=spiel_nr,
                        team1=_side(squad[one]),
                        team2=_side(squad[other]),
                    )
                )
                spiel_nr += 1

    remaining = qualifier_count(rules)
    knockout = knockout_phases_for(remaining)
    seeding = BRACKET_SEEDING[(rules.number_of_groups, rules.qualifiers_per_group)] if knockout else ()

    # The round already drawn, left to right; empty before the first, which reads the standings
    # instead -- the one round whose sides no earlier fixture can name.
    feeding: tuple[int, ...] = ()
    for phase in knockout:
        spieltag = _spieltag(saison_id=saison_id, phase=phase, position=1)
        spieltage.append(spieltag)
        drawn: list[int] = []
        for slot in range(0, remaining, 2):
            sides = (
                [FLSpielQuelleSpiel(type="spiel", spiel_nr=nr, ausgang="sieger").model_dump() for nr in feeding[slot : slot + 2]]
                if feeding
                else [FLSpielQuelleGruppe(type="gruppe", gruppe=gruppe, platz=platz).model_dump() for gruppe, platz in seeding[slot : slot + 2]]
            )
            spiele.append(
                _spiel(
                    saison_id=saison_id,
                    phase=phase,
                    spieltag_id=spieltag["_id"],
                    spiel_nr=spiel_nr,
                    team1_quelle=sides[0],
                    team2_quelle=sides[1],
                )
            )
            drawn.append(spiel_nr)
            spiel_nr += 1

        feeding = tuple(drawn)
        remaining //= 2

    return Spielplan(spieltage=tuple(spieltage), spiele=tuple(spiele))
