"""A season's standings: each group's Tabelle, and the placings no remaining result can still change, which the bracket seeds."""

from collections.abc import Callable, Iterable, Mapping, Sequence, Set
from dataclasses import dataclass
from itertools import combinations, product
from typing import get_args

from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.schemas import SONDEREREIGNIS_WITHOUT_A_RESULT, FLSpielCommon
from app.api.teams.schemas import FLAustritt, FLGruppenTeam, FLTabelle, FLTabelleRow, FLTeam
from app.api.teams.services import counted_goals, offered_gruppen
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.literals import FLGruppenNames

# How much enumeration the bracket's advance will pay for inside the write transaction it holds open.
# Past it the group decides no placing yet, and seeds once no more than this many fixtures stay open.
CERTAINTY_SPIEL_LIMIT = 8


def _goal_key(team: FLTeam) -> tuple[int, int]:
    return (team.statistik.tore_scored - team.statistik.tore_conceded, team.statistik.tore_scored)


@dataclass(frozen=True)
class _MiniTable:
    """The mini-table over one set of teams, and whether it can rank the ones that can place.

    A vacuous (0, 0, 0) -- a team that met none of the others -- is indistinguishable from a real
    one inside the keys, so the caller is told separately.
    """

    keys: Mapping[CustomObjectId, tuple[int, int, int]]
    every_pair_met: bool

    def key_of(self, team: FLTeam) -> tuple[int, ...]:
        return self.keys[team.id]


def _head_to_head_table(
    teams: Sequence[FLTeam],
    spiele: Iterable[FLSpielCommon],
    rules: FLSaisonRules,
    placeable: Set[CustomObjectId],
) -> _MiniTable:
    """The mini-table over the matches `teams` played against each other.

    Over the whole tied set, never pair by pair: with three level, "who beat whom" is not
    transitive, so a pairwise rule can order A above B above C above A.
    """

    ids = {team.id for team in teams}
    punkte = dict.fromkeys(ids, 0)
    scored = dict.fromkeys(ids, 0)
    conceded = dict.fromkeys(ids, 0)
    met: set[frozenset[CustomObjectId]] = set()

    for spiel in spiele:
        counted = counted_goals(spiel)
        if counted is None:
            continue

        team1_id, tore1, team2_id, tore2 = counted
        if team1_id not in ids or team2_id not in ids:
            continue

        met.add(frozenset((team1_id, team2_id)))
        scored[team1_id] += tore1
        conceded[team1_id] += tore2
        scored[team2_id] += tore2
        conceded[team2_id] += tore1

        if tore1 == tore2:
            punkte[team1_id] += rules.draw_points
            punkte[team2_id] += rules.draw_points
        else:
            winner, loser = (team1_id, team2_id) if tore1 > tore2 else (team2_id, team1_id)
            punkte[winner] += rules.win_points
            punkte[loser] += rules.loss_points

    return _MiniTable(
        keys={team_id: (punkte[team_id], scored[team_id] - conceded[team_id], scored[team_id]) for team_id in ids},
        # Asked of the clubs that can hold a placing, pair by pair rather than counted: a club that
        # has left the season is ranked here but can place nowhere, so the meetings it never played
        # decide nothing for the ones that can.
        every_pair_met=all(frozenset(pair) in met for pair in combinations(ids & placeable, 2)),
    )


def _grouped(band: Sequence[FLTeam], key_of: Callable[[FLTeam], tuple[int, ...]]) -> list[list[FLTeam]]:
    """`band` split into descending groups by one criterion; a group of one is decided."""

    grouped: dict[tuple[int, ...], list[FLTeam]] = {}
    for team in band:
        grouped.setdefault(key_of(team), []).append(team)

    return [grouped[key] for key in sorted(grouped, reverse=True)]


def _break_tie(
    band: Sequence[FLTeam],
    spiele: Sequence[FLSpielCommon],
    rules: FLSaisonRules,
    placeable: Set[CustomObjectId],
) -> list[list[FLTeam]]:
    """Teams level on points, split by one criterion then the other; `tiebreak_order` picks which leads, where it can.

    Every member's figures must already be final -- the caller checks: a team with a match left has
    an unbounded goal difference.
    """

    lead_table = _head_to_head_table(band, spiele, rules, placeable) if rules.tiebreak_order == "direkter_vergleich" else None
    if lead_table is not None and not lead_table.every_pair_met:
        # A team that has met none of the others scores a vacuous 0:0, above everyone who lost, so a
        # comparison missing a pair cannot rank the band: it takes the goal keys, and the mini-table
        # follows as it does under `tordifferenz`.
        lead_table = None

    tiers: list[list[FLTeam]] = []
    outer = _grouped(band, lead_table.key_of) if lead_table is not None else _grouped(band, _goal_key)

    # One pass, never a recursion back up the chain: a set the second criterion cannot separate is a
    # genuine tie, reported as one.
    for still_level in outer:
        if len(still_level) == 1:
            tiers.append(still_level)
            continue

        if lead_table is not None:
            tiers.extend(_grouped(still_level, _goal_key))
            continue

        # Recomputed over these teams and refused where they have not all met: a table that cannot
        # rank them ranks nobody, wherever it sits in the chain, and the criterion that led is
        # already level across them.
        inner_table = _head_to_head_table(still_level, spiele, rules, placeable)
        tiers.extend(_grouped(still_level, inner_table.key_of) if inner_table.every_pair_met else [still_level])

    return tiers


def _tiers(
    teams: Sequence[FLTeam],
    punkte: Mapping[CustomObjectId, int],
    settled: Set[CustomObjectId],
    spiele: Sequence[FLSpielCommon],
    rules: FLSaisonRules,
) -> list[list[FLTeam]]:
    """`teams` in descending bands; a band of one is a decided position.

    `punkte` is an argument because `build_decided_standings` ranks these same teams under results
    that have not happened yet.
    """

    by_punkte: dict[int, list[FLTeam]] = {}
    for team in teams:
        by_punkte.setdefault(punkte[team.id], []).append(team)

    # Derived here so both callers ask one question: each ranks a club that left before the group was
    # decided and neither lets one hold a placing, so completeness judged over whoever is present would
    # split the two surfaces.
    still_to_play = _still_to_play(spiele)
    decided_on = _decided_on(spiele)
    placeable = frozenset(team.id for team in teams if _may_hold_a_platz(team, still_to_play.get(team.id, 0), decided_on))

    tiers: list[list[FLTeam]] = []
    for score in sorted(by_punkte, reverse=True):
        band = by_punkte[score]
        # A band holding a team whose goals are not final stays whole: nothing bounds a goal margin,
        # so ordering the rest around it asserts a placing that is still moving.
        if len(band) == 1 or not all(team.id in settled for team in band):
            tiers.append(band)
            continue

        tiers.extend(_break_tie(band, spiele, rules, placeable))

    return tiers


def _decided_on(spiele: Iterable[FLSpielCommon]) -> str | None:
    """The day one group's placings are decided: its last fixture's; `None` while any fixture is undated.

    Dates alone, never a result: a fixture's ending is what the walk hypothesises, so a day read off one would move
    under the walk and let a later call-off hand a departed club back a place already seeded without it. A fixture
    called off or played without a date leaves the group undecided as one still to play does: nothing then says the
    group was decided before a club's exit, so a club that left keeps no place on the strength of a fixture nobody
    dated.
    """

    days: list[str] = []
    for spiel in spiele:
        if spiel.date is None:
            return None
        days.append(spiel.date)

    return max(days, default=None)


def in_the_season_when_decided(austritt: FLAustritt | None, decided_on: str | None) -> bool:
    """Whether a club still stood in the season on the day a place was decided, so the place is its to keep.

    Strictly before the exit, as `eligibility_disqualified` and `find_departed_occupants` order a day against it: the exit's
    own day counts as after it, and so does a place not yet dated. One rule for a group's placings and the podium's places,
    and for either route out, since no rule keyed on a club having left reads `type`.
    """

    return austritt is None or (decided_on is not None and decided_on < austritt.date)


def _may_hold_a_platz(team: FLTeam, still_to_play: int, decided_on: str | None) -> bool:
    """Whether a team can hold a placing a bracket slot could name.

    In the season when its group was decided, with a match that counts or still could.
    """

    return in_the_season_when_decided(team.austritt, decided_on) and team.statistik.count_played_spiele + still_to_play > 0


def build_tabelle(teams: Iterable[FLTeam], spiele: Iterable[FLSpielCommon], rules: FLSaisonRules) -> FLTabelle:
    """Each group's standing as the Tabelle shows it, every row numbered as a `Platz` is.

    A club that has played no match reads null and sorts below every club that has, whatever its zeroes would rank.
    The rest are numbered as the bracket counts its placings (`_placings`), a club advancing the number only while it
    stood in the season when its group was decided (`in_the_season_when_decided`), so a club that left before then reads
    null and hides none, one that left after keeps its number, and clubs the chain leaves level share the
    number their band starts at, where the bracket seeds none of them. The bracket also counts a club with no match
    that has one still to play, so a club ranked below it prints a lower number than the bracket counts it at; the
    bracket decides no such placing, since the club yet to play can still finish level with it on points at any goal
    margin.
    """

    teams = list(teams)
    spiele = list(spiele)

    # The same day `_tiers` decides each group on, so the table and the bracket agree on who holds a place.
    by_gruppe, _ = _spiele_by_gruppe(spiele, {team.id: team.gruppe for team in teams})
    decided_on = {gruppe: _decided_on(group_spiele) for gruppe, group_spiele in by_gruppe.items()}
    still_in = frozenset(team.id for team in teams if in_the_season_when_decided(team.austritt, decided_on.get(team.gruppe)))

    tabelle: dict[FLGruppenNames, list[FLTabelleRow]] = {}
    for name, ranked in _ranked_bands(teams, by_gruppe, rules).items():
        placed: list[FLTabelleRow] = []
        platz = 1
        for band in ranked:
            holders = {row.id for row in band if row.id in still_in and row.statistik.count_played_spiele}
            placed.extend(FLTabelleRow.model_validate({**row.model_dump(), "platz": platz if row.id in holders else None}) for row in band)
            platz += len(holders)
        # Stable, so the clubs that have played keep their standing order, and so do those that have not.
        tabelle[name] = sorted(placed, key=lambda row: not row.statistik.count_played_spiele)

    return tabelle


def _spiele_by_gruppe(
    spiele: Iterable[FLSpielCommon],
    gruppe_of: Mapping[CustomObjectId, FLGruppenNames],
) -> tuple[dict[FLGruppenNames, list[FLSpielCommon]], set[FLGruppenNames]]:
    """Each group's own fixtures, and the groups holding a fixture attributable to none.

    A fixture belongs to a group when BOTH sides are teams of it; one that is not can still award
    points inside it, so no placing there is final while it stands.
    """

    by_gruppe: dict[FLGruppenNames, list[FLSpielCommon]] = {name: [] for name in get_args(FLGruppenNames.__value__)}
    unattributable: set[FLGruppenNames] = set()

    for spiel in spiele:
        left = gruppe_of.get(spiel.team1.team_id) if spiel.team1 is not None else None
        right = gruppe_of.get(spiel.team2.team_id) if spiel.team2 is not None else None

        if left is not None and left == right:
            by_gruppe[left].append(spiel)
            continue

        if counted_goals(spiel) is None and spiel.sonderereignis not in SONDEREREIGNIS_WITHOUT_A_RESULT:
            if spiel.team1 is None and spiel.team2 is None:
                # No side to attribute, so nothing can say which group it lands in.
                unattributable.update(get_args(FLGruppenNames.__value__))
            else:
                unattributable.update(name for name in (left, right) if name is not None)

    return by_gruppe, unattributable


def _still_to_play(spiele: Iterable[FLSpielCommon]) -> Mapping[CustomObjectId, int]:
    """How many fixtures each team has left: neither counted nor called off, so still to be awarded."""

    counts: dict[CustomObjectId, int] = {}
    for spiel in spiele:
        if counted_goals(spiel) is not None or spiel.sonderereignis in SONDEREREIGNIS_WITHOUT_A_RESULT:
            continue
        for side in (spiel.team1, spiel.team2):
            if side is not None:
                counts[side.team_id] = counts.get(side.team_id, 0) + 1

    return counts


@dataclass(frozen=True)
class DecidedStanding:
    """Which placings in one group no remaining result can still change.

    An absent `by_platz` entry means "not yet" while `is_complete` is false, and a tie the chain
    could not break once it is true.
    """

    eligible: int
    is_complete: bool
    by_platz: Mapping[int, FLTeam]


def _endings(rules: FLSaisonRules) -> tuple[tuple[int, int, bool], ...]:
    """The fourth ending is the call-off, which alone awards nothing to both sides and alone leaves neither club it to play.

    `SONDEREREIGNIS_WITHOUT_A_RESULT` is the state a save records for it.
    """

    return (
        (rules.win_points, rules.loss_points, True),
        (rules.draw_points, rules.draw_points, True),
        (rules.loss_points, rules.win_points, True),
        (0, 0, False),
    )


def _decide_one_gruppe(
    teams: Sequence[FLTeam],
    spiele: Sequence[FLSpielCommon],
    rules: FLSaisonRules,
    still_to_play: Mapping[CustomObjectId, int],
    has_unattributable: bool,
) -> DecidedStanding:
    """One group's decided placings, by walking every ending of its open fixtures; none while more than `CERTAINTY_SPIEL_LIMIT` are open."""

    # `_spiele_by_gruppe` attributes only fixtures with both sides known, so the two side checks
    # below narrow the type rather than branch.
    open_pairs: list[tuple[CustomObjectId, CustomObjectId]] = [
        (spiel.team1.team_id, spiel.team2.team_id)
        for spiel in spiele
        if counted_goals(spiel) is None
        and spiel.sonderereignis not in SONDEREREIGNIS_WITHOUT_A_RESULT
        and spiel.team1 is not None
        and spiel.team2 is not None
    ]

    # One day for every hypothesised ending: the walk moves results, never dates, and `_decided_on` reads dates alone.
    decided_on = _decided_on(spiele)
    placeable = frozenset(team.id for team in teams if _may_hold_a_platz(team, still_to_play.get(team.id, 0), decided_on))
    is_complete = not open_pairs and not has_unattributable

    if has_unattributable or len(open_pairs) > CERTAINTY_SPIEL_LIMIT:
        return DecidedStanding(eligible=len(placeable), is_complete=is_complete, by_platz={})

    # Every member, never `placeable` alone: filtering before the ranking drops a departed club's
    # results from the mini-table the displayed table computes with them, so the two surfaces order
    # one group differently.
    settled = frozenset(team.id for team in teams if still_to_play.get(team.id, 0) == 0)

    by_id = {team.id: team for team in teams}
    base = {team.id: team.statistik.punkte for team in teams}
    order = [team.id for team in teams]
    # Every other club is in `placeable` under every ending, so only these need asking again: a club
    # keeps its place in the set on the strength of one counted match, whatever a call-off takes.
    fragile = [team_id for team_id in placeable if by_id[team_id].statistik.count_played_spiele == 0]

    # Ranked as the walk goes rather than after it, so a group deciding nothing costs one ranking:
    # this runs inside the write transaction.
    decided: Mapping[int, FLTeam] | None = None
    seen: set[tuple[tuple[int, ...], frozenset[CustomObjectId]]] = set()
    for endings in product(_endings(rules), repeat=len(open_pairs)):
        punkte = dict(base)
        # A result leaves this count alone rather than moving the fixture into `count_played_spiele`:
        # the walk hypothesises no `statistik`, and `_may_hold_a_platz` reads the two together.
        left_to_play = {team_id: still_to_play.get(team_id, 0) for team_id in fragile}
        for (left, right), (to_left, to_right, played) in zip(open_pairs, endings, strict=True):
            # Added to unguarded: `_spiele_by_gruppe` attributes a fixture to this group only when
            # both its teams are of it, so `base` already holds every side.
            punkte[left] += to_left
            punkte[right] += to_right
            if played:
                continue
            for side in (left, right):
                if side in left_to_play:
                    left_to_play[side] -= 1

        dropped = frozenset(team_id for team_id, left in left_to_play.items() if not _may_hold_a_platz(by_id[team_id], left, decided_on))
        vector = tuple(punkte[team_id] for team_id in order)
        # The points table stopped deciding the ranking on its own once a call-off became an ending,
        # so a vector skipped on its table alone is one that ranks differently.
        if (vector, dropped) in seen:
            continue
        seen.add((vector, dropped))

        # `settled` stays as the fixtures leave it: a hypothesised one would put a club into a band
        # `_tiers` breaks against a placeable set it derives itself, which is not the one here.
        placings = _placings(teams, punkte, settled, spiele, rules, placeable - dropped)

        # A placing survives only while every table so far has put the same team there.
        if decided is None:
            decided = placings
        else:
            decided = {platz: team for platz, team in placings.items() if platz in decided and decided[platz].id == team.id}

        if not decided:
            break

    return DecidedStanding(eligible=len(placeable), is_complete=is_complete, by_platz=decided or {})


def _placings(
    teams: Sequence[FLTeam],
    punkte: Mapping[CustomObjectId, int],
    settled: Set[CustomObjectId],
    spiele: Sequence[FLSpielCommon],
    rules: FLSaisonRules,
    placeable: Set[CustomObjectId],
) -> Mapping[int, FLTeam]:
    """The placings one points table pins down. A band holding several teams that can place pins none of them."""

    placings: dict[int, FLTeam] = {}
    platz = 1

    for band in _tiers(teams, punkte, settled, spiele, rules):
        # Only a club that can hold a placing advances the number, so a departed one takes no place
        # and hides none.
        holders = [team for team in band if team.id in placeable]
        if len(holders) == 1:
            placings[platz] = holders[0]
        platz += len(holders)

    return placings


def _ranked_bands(
    teams: Sequence[FLTeam], by_gruppe: Mapping[FLGruppenNames, Sequence[FLSpielCommon]], rules: FLSaisonRules
) -> dict[FLGruppenNames, list[list[FLGruppenTeam]]]:
    """Every group the season offers as its standing's bands, a band of several being clubs the chain leaves level.

    `by_gruppe` is `_spiele_by_gruppe`'s split of the season's fixtures, which the caller has already made. Seeded from
    the count of groups rather than the teams present: a group nobody stands in keeps its key, and the closed set here
    would answer a smaller season groups it never ran.
    """

    grouped: dict[FLGruppenNames, list[FLTeam]] = {name: [] for name in offered_gruppen(rules.number_of_gruppen)}
    for team in teams:
        grouped[team.gruppe].append(team)

    # Every figure is final as a reading of now, which is what lets the whole chain apply.
    everyone = frozenset(team.id for team in teams)

    return {
        name: [
            [_standing_row(team) for team in band]
            for band in _tiers(members, {team.id: team.statistik.punkte for team in members}, everyone, by_gruppe[name], rules)
        ]
        for name, members in grouped.items()
    }


def _standing_row(team: FLTeam) -> FLGruppenTeam:
    """One ranked team as the table publishes it."""

    return FLGruppenTeam(
        id=team.id,
        name=team.name,
        shorthand=team.shorthand,
        statistik=team.statistik,
        austritt_type=team.austritt.type if team.austritt is not None else None,
    )


def build_decided_standings(
    teams: Iterable[FLTeam],
    spiele: Iterable[FLSpielCommon],
    rules: FLSaisonRules,
    gruppen: Set[FLGruppenNames] | None = None,
) -> Mapping[FLGruppenNames, DecidedStanding]:
    """Which placing in each group is beyond doubt, and which is still anybody's.

    Pass the season's group-phase matches. `gruppen` narrows to the groups worth deciding: the walk
    is the expensive half of a save.
    """

    spiele = list(spiele)
    teams = list(teams)

    gruppe_of: dict[CustomObjectId, FLGruppenNames] = {team.id: team.gruppe for team in teams}
    by_gruppe, unattributable = _spiele_by_gruppe(spiele, gruppe_of)
    still_to_play = _still_to_play(spiele)

    teams_by_gruppe: dict[FLGruppenNames, list[FLTeam]] = {name: [] for name in get_args(FLGruppenNames.__value__)}
    for team in teams:
        if team.gruppe in teams_by_gruppe:
            teams_by_gruppe[team.gruppe].append(team)

    return {
        name: _decide_one_gruppe(
            teams=teams_by_gruppe[name],
            spiele=by_gruppe[name],
            rules=rules,
            still_to_play=still_to_play,
            has_unattributable=name in unattributable,
        )
        for name in get_args(FLGruppenNames.__value__)
        if gruppen is None or name in gruppen
    }
