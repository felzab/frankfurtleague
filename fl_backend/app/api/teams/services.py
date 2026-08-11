"""
TEAMS · aggregation pipeline, and the group standing

`build_team_pipeline` builds the read pipeline for `GET /teams`; `build_gruppen` and
`build_decided_standings` order each group by the tiebreak chain and say which placings no
remaining result can change (ADR-0035) — pure throughout. A team document is season-independent:
`gruppe` and `disqualifikation` are joined from `saison_teams`, and `statistik` is derived from
that season's `spiele` on every read — caching or storing it is ADR-0019 reversed.

Invariants:
- A match counts exactly when it carries an `ergebnis`; `is_canceled` is not consulted — forfeits count.
- `elfmeterschiessen` is not consulted either: penalties are a draw for every figure here (ADR-0036).
- `statistik_scope` picks the matches and defaults to the Gruppenphase (ADR-0022).
- The pipeline takes an `FLSaisonRules` — points come from the season's own rules (ADR-0019).
- One ordering serves the displayed table and the bracket seeding — the same chain, same `_tiers`.
- A tie is broken below points only among teams whose figures are final (ADR-0035).

See:
- docs/glossary.md — "Statistik", the same counting rules in domain terms
"""

from dataclasses import dataclass
from itertools import product
from typing import AbstractSet, Any, Iterable, Mapping, Sequence, get_args

from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.schemas import FLSpiel
from app.api.teams.schemas import FLGruppen, FLGruppenNames, FLTeam, FLTeamsFilterParams, FLTeamStatistik, FLTeamStatistikScope
from app.core.collections import Collection
from app.shared.schemas.custom import CustomObjectId

SPIELE_COLLECTION_NAME = "spiele"
AS_NAME = "saison_data"
STATISTIK_AS_NAME = "statistik_data"

# What a team whose season holds no counting match gets. Derived from the model rather than written
# out, so a field added to FLTeamStatistik cannot be forgotten here and fail response validation.
ZERO_STATISTIK: Mapping[str, int] = {field_name: 0 for field_name in FLTeamStatistik.model_fields}


def build_statistik_lookup_stage(saison_id: str, rules: FLSaisonRules, scope: FLTeamStatistikScope) -> Mapping[str, Any]:
    """
    The `$lookup` deriving one team's seven statistics from the season's matches (ADR-0019).

    A match counts exactly when it carries an `ergebnis`. `is_canceled` is deliberately not consulted:
    a cancelled match with a result is a forfeit, and a forfeit counts.

    **`elfmeterschiessen` is not consulted either, and that is the same kind of deliberate omission.** A
    knockout settled on penalties is a DRAW here -- one point each, one entry in `unentschieden`, and
    the shoot-out's own counts nowhere in `tore_geschossen` (ADR-0036). The bracket reads that fixture
    the other way and advances a winner from it
    (`fl_backend/app/api/spiele/services.py :: _outcome_of`), so the table and
    the bracket say different things about the same match ON PURPOSE. That is what every competition
    scoring a shoot-out does, and it is why the two counts are a scoreline of their own rather than
    goals: adding them to `tore` would move a league table on kicks that were never part of the match.

    `scope` decides which matches are in scope at all (ADR-0022): `"gruppenphase"` is the league table
    and narrows to that phase, `"gesamt"` is every phase and is what a team's own page shows.
    """

    is_this_team_in_slot_one = {"$eq": ["$team1.team_id", "$$team_oid"]}

    phase_match: Mapping[str, Any] = {"saison_phase": "gruppenphase"} if scope == "gruppenphase" else {}

    return {
        "$lookup": {
            "from": SPIELE_COLLECTION_NAME,
            "let": {"team_oid": "$_id"},
            "pipeline": [
                {
                    "$match": {
                        "saison_id": saison_id,
                        # The phase rule (ADR-0022). Absent under "gesamt" rather than negated:
                        # no `saison_phase` value means "any", and an `$in` over every phase would
                        # need widening by hand the day one is added.
                        **phase_match,
                        # The counting rule, in one place. Note what is absent: `is_canceled`
                        # (ADR-0019) and `elfmeterschiessen` (ADR-0036). A shoot-out decides the
                        # bracket and never the table -- see the docstring above.
                        "ergebnis": {"$ne": None},
                        # Deliberately redundant with the line above: a hand-edited document is
                        # where `ergebnis` and the goal counts can disagree, and a null count would
                        # then group as a 0:0 draw instead of dropping out.
                        "team1.tore": {"$ne": None},
                        "team2.tore": {"$ne": None},
                        "$expr": {"$or": [is_this_team_in_slot_one, {"$eq": ["$team2.team_id", "$$team_oid"]}]},
                    }
                },
                {
                    # Both teams are embedded in the one match document, so each match is first turned
                    # around to face THIS team before anything is counted.
                    "$project": {
                        "_id": 0,
                        "tore_self": {"$cond": [is_this_team_in_slot_one, "$team1.tore", "$team2.tore"]},
                        "tore_opponent": {"$cond": [is_this_team_in_slot_one, "$team2.tore", "$team1.tore"]},
                    }
                },
                {
                    "$group": {
                        "_id": None,
                        "anzahl_gespielte_spiele": {"$sum": 1},
                        "siege": {"$sum": {"$cond": [{"$gt": ["$tore_self", "$tore_opponent"]}, 1, 0]}},
                        "unentschieden": {"$sum": {"$cond": [{"$eq": ["$tore_self", "$tore_opponent"]}, 1, 0]}},
                        "niederlagen": {"$sum": {"$cond": [{"$lt": ["$tore_self", "$tore_opponent"]}, 1, 0]}},
                        "tore_geschossen": {"$sum": "$tore_self"},
                        "tore_kassiert": {"$sum": "$tore_opponent"},
                    }
                },
                {
                    # Points come last, from the season's own rules. A defeat adds nothing because
                    # FLSaisonRules carries no loss_points -- that is the model's statement, not a
                    # third constant chosen here.
                    "$project": {
                        "_id": 0,
                        "anzahl_gespielte_spiele": 1,
                        "siege": 1,
                        "unentschieden": 1,
                        "niederlagen": 1,
                        "tore_geschossen": 1,
                        "tore_kassiert": 1,
                        "punkte": {
                            "$add": [
                                {"$multiply": ["$siege", rules.win_points]},
                                {"$multiply": ["$unentschieden", rules.draw_points]},
                            ]
                        },
                    }
                },
            ],
            "as": STATISTIK_AS_NAME,
        }
    }


def build_team_pipeline(filters: FLTeamsFilterParams, rules: FLSaisonRules, team_id: Any | None = None) -> list[Mapping[str, Any]]:
    # Not a filter that may be omitted: the statistics below are per season, so without one this would
    # match no match at all and hand back a table of zeros that looks like a real answer. The router
    # resolves it (ADR-0002) before calling.
    if filters.saison_id is None:
        raise ValueError("build_team_pipeline requires a resolved saison_id -- statistics are derived per season (ADR-0019).")

    pipeline: list[Mapping[str, Any]] = []

    base_match: dict[str, Any] = {}

    # Clubs that have left the league (ADR-0025). Not the same as a team disqualified FOR a season --
    # that is `disqualifikation` on the junction, filtered inside the lookup below, and a disqualified
    # team stays in the table.
    if not filters.include_inactive:
        base_match["inactive_since"] = None

    # An argument rather than a filter field: `GET /teams/{team_id}` addresses one document, and the
    # difference between "this team" and "teams matching" is the difference between a path and a query.
    if team_id is not None:
        base_match["_id"] = team_id

    # Apply the base match BEFORE the lookup to save memory
    if base_match:
        pipeline.append({"$match": base_match})

    lookup_filters = filters.model_dump(
        include={"saison_id", "gruppe"},
        exclude_none=True,
        context={"keep_oid": True},
    )

    # Translated rather than dumped: `is_disqualified` asks whether the row holds a record, and the
    # row stores no boolean to match against (ADR-0047). `$ne: null` also excludes a row missing the
    # key, which the validator forbids.
    if filters.is_disqualified is not None:
        lookup_filters["disqualifikation"] = {"$ne": None} if filters.is_disqualified else None

    lookup_pipeline: list[Mapping[str, Any]] = [{"$match": {"$expr": {"$eq": ["$team_id", "$$base_team_id"]}}}]

    if lookup_filters:
        lookup_pipeline.append({"$match": lookup_filters})

    pipeline.append(
        {
            "$lookup": {
                "from": Collection.SAISON_TEAMS,
                "let": {"base_team_id": "$_id"},
                "pipeline": lookup_pipeline,
                "as": AS_NAME,
            }
        }
    )

    strict_join = bool(getattr(filters, "saison_id", None))
    pipeline.append(
        {
            "$unwind": {
                "path": f"${AS_NAME}",
                "preserveNullAndEmptyArrays": not strict_join,
            }
        }
    )

    # After the strict unwind, so the matches are only summed for teams that survive the join.
    pipeline.append(build_statistik_lookup_stage(saison_id=filters.saison_id, rules=rules, scope=filters.statistik_scope))

    # One projection, because there is one team shape. Never branch a reduced variant off it: measured
    # 2026-08-02, the trim is 26 KiB and no query work at all -- both lookups run either way
    # (ADR-0027).
    pipeline.append(
        {
            "$project": {
                "_id": 1,
                "name": 1,
                "shorthand": 1,
                "address": 1,
                "description": 1,
                "full_name": 1,
                "website_url": 1,
                "inactive_since": 1,
                # The lookup yields one grouped document, or none at all for a team with no counting
                # match -- `$group` emits nothing for an empty input rather than a row of zeros.
                "statistik": {"$ifNull": [{"$first": f"${STATISTIK_AS_NAME}"}, ZERO_STATISTIK]},
                "saison_id": f"${AS_NAME}.saison_id",
                "gruppe": f"${AS_NAME}.gruppe",
                "disqualifikation": f"${AS_NAME}.disqualifikation",
            }
        }
    )

    pipeline.append({"$sort": {filters.sort_by: 1 if filters.order == "asc" else -1, "name": 1}})

    if getattr(filters, "limit", None) is not None:
        pipeline.append({"$limit": filters.limit})

    return pipeline


# How many outstanding fixtures the certainty check will walk before giving up: every combination of
# outcomes is tried, so the work is 3^n. Beyond the bound nothing is reported as final, which is the
# safe direction and the honest one.
CERTAINTY_FIXTURE_LIMIT = 10


def _counted_goals(spiel: FLSpiel) -> tuple[CustomObjectId, int, CustomObjectId, int] | None:
    """
    One match as `(team1_id, tore1, team2_id, tore2)`, or `None` when it does not count.

    The counting rule is `build_statistik_lookup_stage`'s, restated in Python because a standing has to
    ask the same question of a match the pipeline has already summed: a match contributes exactly when
    it carries an `ergebnis` and both sides' goals (ADR-0019). `is_canceled` is deliberately not
    consulted -- a cancelled match with a result is a forfeit, and a forfeit counts. Neither is
    `elfmeterschiessen`: a shoot-out is a draw everywhere a standing is derived, including the
    head-to-head mini-table this feeds (ADR-0036).
    """

    if spiel.ergebnis is None or spiel.team1 is None or spiel.team2 is None:
        return None
    if spiel.team1.tore is None or spiel.team2.tore is None:
        return None

    return spiel.team1.team_id, spiel.team1.tore, spiel.team2.team_id, spiel.team2.tore


def _goal_key(team: FLTeam) -> tuple[int, int]:
    """Goal difference, then goals scored -- the two criteria under points that `statistik` answers."""

    return (team.statistik.tore_geschossen - team.statistik.tore_kassiert, team.statistik.tore_geschossen)


def _head_to_head_keys(
    teams: Sequence[FLTeam],
    spiele: Iterable[FLSpiel],
    rules: FLSaisonRules,
) -> Mapping[CustomObjectId, tuple[int, int, int]]:
    """
    The mini-table over the matches `teams` played against EACH OTHER: points, goal difference, goals.

    Applied to a whole tied set rather than pair by pair, which is what makes it the standard
    formulation: with three teams level, "who beat whom" is not even transitive, so a pairwise rule
    can order A above B above C above A.

    Points come from the season's own `rules`, exactly as the full table's do, and a defeat again adds
    nothing because `FLSaisonRules` carries no `loss_points`.
    """

    ids = {team.id for team in teams}
    punkte = dict.fromkeys(ids, 0)
    geschossen = dict.fromkeys(ids, 0)
    kassiert = dict.fromkeys(ids, 0)

    for spiel in spiele:
        counted = _counted_goals(spiel)
        if counted is None:
            continue

        team1_id, tore1, team2_id, tore2 = counted
        if team1_id not in ids or team2_id not in ids:
            continue

        geschossen[team1_id] += tore1
        kassiert[team1_id] += tore2
        geschossen[team2_id] += tore2
        kassiert[team2_id] += tore1

        if tore1 == tore2:
            punkte[team1_id] += rules.draw_points
            punkte[team2_id] += rules.draw_points
        else:
            punkte[team1_id if tore1 > tore2 else team2_id] += rules.win_points

    return {team_id: (punkte[team_id], geschossen[team_id] - kassiert[team_id], geschossen[team_id]) for team_id in ids}


def _break_tie(band: Sequence[FLTeam], spiele: Iterable[FLSpiel], rules: FLSaisonRules) -> list[list[FLTeam]]:
    """
    Teams level on points, split by everything below it.

    Goal difference, then goals scored, then the head-to-head table among whoever is still level.

    Every member's figures are final -- the caller checks that before asking, because a team with a
    match left has an unbounded goal difference and ordering on it would be ordering on a guess.
    """

    by_goals: dict[tuple[int, int], list[FLTeam]] = {}
    for team in band:
        by_goals.setdefault(_goal_key(team), []).append(team)

    tiers: list[list[FLTeam]] = []
    for goal_key in sorted(by_goals, reverse=True):
        still_level = by_goals[goal_key]
        if len(still_level) == 1:
            tiers.append(still_level)
            continue

        head_to_head = _head_to_head_keys(still_level, spiele, rules)
        by_head_to_head: dict[tuple[int, int, int], list[FLTeam]] = {}
        for team in still_level:
            by_head_to_head.setdefault(head_to_head[team.id], []).append(team)

        # One pass, not a recursion back to the top of the chain: a set that the head-to-head table
        # cannot separate either is a genuine tie, and it is reported as one rather than resolved by
        # a further criterion nobody has chosen (ADR-0035).
        tiers.extend(by_head_to_head[key] for key in sorted(by_head_to_head, reverse=True))

    return tiers


def _tiers(
    teams: Sequence[FLTeam],
    punkte: Mapping[CustomObjectId, int],
    settled: AbstractSet[CustomObjectId],
    spiele: Iterable[FLSpiel],
    rules: FLSaisonRules,
) -> list[list[FLTeam]]:
    """
    `teams` split into descending bands, highest first.

    A band of one is a team whose position is decided; a band of several is a tie nothing in the chain
    could break.

    `punkte` is passed in rather than read off `statistik` because `build_decided_standings` ranks these
    same teams under results that have not happened yet. The base numbers are still the pipeline's, so
    ADR-0019's counting rule keeps exactly one implementation.

    `settled` names the teams whose goals are final. A band containing one that is not stays whole:
    nothing bounds a goal margin, so a team with a match left can end anywhere within its points band
    and ordering the rest around it would assert a placing that is still moving.

    Within a band the input order survives, which is the pipeline's sort by `name` -- so a tie the chain
    cannot break renders alphabetically rather than arbitrarily.
    """

    by_punkte: dict[int, list[FLTeam]] = {}
    for team in teams:
        by_punkte.setdefault(punkte[team.id], []).append(team)

    tiers: list[list[FLTeam]] = []
    for score in sorted(by_punkte, reverse=True):
        band = by_punkte[score]
        if len(band) == 1 or not all(team.id in settled for team in band):
            tiers.append(band)
            continue

        tiers.extend(_break_tie(band, spiele, rules))

    return tiers


def _may_hold_a_platz(team: FLTeam, still_to_play: int) -> bool:
    """
    Whether a team can occupy a placing a bracket slot could name.

    Two exclusions, and both exist so the table and the bracket say the same thing (ADR-0035). A
    DISQUALIFIED team keeps its row in the standing and cannot advance out of it, so the placings walk
    past it and the team below takes the place. A team with NO MATCH THAT COUNTS OR STILL COULD holds no
    placing at all: the pipeline serves it a zeroed `statistik`, which ranks above every team with a
    negative goal difference, and `SaisontabelleView` already prints `N/A` rather than a position there.

    `still_to_play` is what makes this one rule rather than two. Read on the table as it stands it is
    zero, and the second clause is "has played"; read while a group is running it also admits a team
    whose first fixture is still to come.
    """

    return team.disqualifikation is None and (team.statistik.anzahl_gespielte_spiele + still_to_play) > 0


def _spiele_by_gruppe(
    spiele: Iterable[FLSpiel],
    gruppe_of: Mapping[CustomObjectId, FLGruppenNames],
) -> tuple[dict[FLGruppenNames, list[FLSpiel]], set[FLGruppenNames]]:
    """
    Each group's own fixtures, and the groups holding a fixture that cannot be attributed to one.

    A fixture belongs to a group when BOTH of its sides are teams of that group. The second half of the
    answer is the exception that matters: a fixture still to be played with a side nobody has entered
    yet will award points inside some group and can be given no outcome, so no placing in a group it
    touches is final while it stands -- and one with NO entered side touches every group, because
    nothing bounds which teams it will turn out to involve.
    """

    by_gruppe: dict[FLGruppenNames, list[FLSpiel]] = {name: [] for name in get_args(FLGruppenNames)}
    unattributable: set[FLGruppenNames] = set()

    for spiel in spiele:
        left = gruppe_of.get(spiel.team1.team_id) if spiel.team1 is not None else None
        right = gruppe_of.get(spiel.team2.team_id) if spiel.team2 is not None else None

        if left is not None and left == right:
            by_gruppe[left].append(spiel)
            continue

        if _counted_goals(spiel) is None and not spiel.is_canceled:
            if spiel.team1 is None and spiel.team2 is None:
                # NO side to attribute at all: it will award points inside some group and nothing can
                # say which, so no placing is final while it stands. A fixture whose sides are known
                # but outside the standings falls through -- its points reach nobody.
                unattributable.update(get_args(FLGruppenNames))
            else:
                unattributable.update(name for name in (left, right) if name is not None)

    return by_gruppe, unattributable


def _still_to_play(spiele: Iterable[FLSpiel]) -> Mapping[CustomObjectId, int]:
    """How many fixtures each team has left -- neither counted nor called off, so still to be awarded."""

    counts: dict[CustomObjectId, int] = {}
    for spiel in spiele:
        if _counted_goals(spiel) is not None or spiel.is_canceled:
            continue
        for side in (spiel.team1, spiel.team2):
            if side is not None:
                counts[side.team_id] = counts.get(side.team_id, 0) + 1

    return counts


@dataclass(frozen=True)
class DecidedStanding:
    """
    Which placings in one group no remaining result can still change (ADR-0035).

    `by_platz` holds only the placings that come out the same however the group's outstanding fixtures
    go. An absent placing means one of two different things, and the caller can tell them apart:
    `is_complete` false is "not yet", which is the ordinary state of a running group, while
    `is_complete` true is a tie the chain could not break and needs a person.

    `eligible` counts the teams that can hold a placing at all, so a reference naming a `platz` beyond
    it is naming one this group will never produce.
    """

    eligible: int
    is_complete: bool
    by_platz: Mapping[int, FLTeam]


def _decide_one_gruppe(
    teams: Sequence[FLTeam],
    spiele: Sequence[FLSpiel],
    rules: FLSaisonRules,
    still_to_play: Mapping[CustomObjectId, int],
    has_unattributable: bool,
) -> DecidedStanding:
    """One group's decided placings, by walking every way its outstanding fixtures could still go."""

    # Both sides are known for every fixture `_spiele_by_gruppe` attributes to a group, so the two
    # checks below narrow the type rather than branching on anything.
    open_pairs: list[tuple[CustomObjectId, CustomObjectId]] = [
        (spiel.team1.team_id, spiel.team2.team_id)
        for spiel in spiele
        if _counted_goals(spiel) is None and not spiel.is_canceled and spiel.team1 is not None and spiel.team2 is not None
    ]

    eligible = [team for team in teams if _may_hold_a_platz(team, still_to_play.get(team.id, 0))]
    is_complete = not open_pairs and not has_unattributable

    if has_unattributable or len(open_pairs) > CERTAINTY_FIXTURE_LIMIT:
        return DecidedStanding(eligible=len(eligible), is_complete=is_complete, by_platz={})

    settled = frozenset(team.id for team in eligible if still_to_play.get(team.id, 0) == 0)
    base = {team.id: team.statistik.punkte for team in eligible}
    order = [team.id for team in eligible]

    # Deduplicated by the points table each outcome set produces, and ranked AS the walk goes so it
    # stops the moment no placing survives. Measured 2026-08-09: the full walk over a five-team group
    # costs ~850 ms inside the write transaction.
    decided: Mapping[int, FLTeam] | None = None
    seen: set[tuple[int, ...]] = set()
    for outcomes in product((1, 0, 2), repeat=len(open_pairs)):
        punkte = dict(base)
        for (left, right), outcome in zip(open_pairs, outcomes, strict=True):
            if outcome == 0:
                for side in (left, right):
                    if side in punkte:
                        punkte[side] += rules.draw_points
                continue

            # The loser is added to deliberately: a defeat scores nothing, because `FLSaisonRules`
            # carries no `loss_points` (ADR-0019).
            winner = left if outcome == 1 else right
            if winner in punkte:
                punkte[winner] += rules.win_points

        vector = tuple(punkte[team_id] for team_id in order)
        if vector in seen:
            continue
        seen.add(vector)

        placings = _placings(eligible, dict(zip(order, vector, strict=True)), settled, spiele, rules)

        # A placing survives only while every table so far has put the SAME team there. One outcome
        # that moves a team is enough to make its placing something a person still decides.
        if decided is None:
            decided = placings
        else:
            decided = {platz: team for platz, team in placings.items() if platz in decided and decided[platz].id == team.id}

        if not decided:
            break

    return DecidedStanding(eligible=len(eligible), is_complete=is_complete, by_platz=decided or {})


def _placings(
    teams: Sequence[FLTeam],
    punkte: Mapping[CustomObjectId, int],
    settled: AbstractSet[CustomObjectId],
    spiele: Iterable[FLSpiel],
    rules: FLSaisonRules,
) -> Mapping[int, FLTeam]:
    """The placings one points table pins down. A band holding several teams pins none of them."""

    placings: dict[int, FLTeam] = {}
    platz = 1

    for band in _tiers(teams, punkte, settled, spiele, rules):
        if len(band) == 1:
            placings[platz] = band[0]
        platz += len(band)

    return placings


def build_gruppen(teams: Iterable[FLTeam], spiele: Iterable[FLSpiel], rules: FLSaisonRules) -> FLGruppen:
    """
    The four groups, always all four, each ordered by the competition's tiebreak chain (ADR-0035).

    Seeded with every group name rather than built from the teams present: a season with nobody in group
    D would otherwise omit the "D" key, the frontend's `FLGruppenSchema` requires all four, and
    /dashboard/saisontabelle fails to parse the response. Every season so far has had teams in all four
    groups, so that failure hides until it does not.

    Ordered as the table STANDS, so every figure in it is current and the whole chain applies. What
    remaining fixtures could still do to it is `build_decided_standings`' question and not this one --
    a table is a statement about now.

    A disqualified team keeps its row here. It is excluded from holding a *placing*, which is a
    different question and is `_may_hold_a_platz`'s.
    """

    teams = list(teams)
    gruppe_of: dict[CustomObjectId, FLGruppenNames] = {team.id: team.gruppe for team in teams}
    by_gruppe, _ = _spiele_by_gruppe(spiele, gruppe_of)

    grouped: dict[FLGruppenNames, list[FLTeam]] = {name: [] for name in get_args(FLGruppenNames)}
    for team in teams:
        # The one way round `FLGruppenNames`: an `FLTeam` built with `model_construct`, which skips
        # validation. Tested against `grouped` rather than for falsiness -- `not team.gruppe` lets "X"
        # through to a bare KeyError instead of this error.
        if team.gruppe not in grouped:
            raise ValueError(f"Team {team.id} has gruppe {team.gruppe!r}, which is not one of A/B/C/D")
        grouped[team.gruppe].append(team)

    # Every figure on the table is final AS A READING OF NOW, which is what lets the whole chain apply.
    everyone = frozenset(gruppe_of)

    return FLGruppen(
        {
            name: [
                team
                for band in _tiers(members, {team.id: team.statistik.punkte for team in members}, everyone, by_gruppe[name], rules)
                for team in band
            ]
            for name, members in grouped.items()
        }
    )


def build_decided_standings(
    teams: Iterable[FLTeam],
    spiele: Iterable[FLSpiel],
    rules: FLSaisonRules,
    gruppen: AbstractSet[FLGruppenNames] | None = None,
) -> Mapping[FLGruppenNames, DecidedStanding]:
    """
    Which placing in each group is already beyond doubt, and which is still anybody's (ADR-0035).

    Pass the season's GROUP-PHASE matches and the teams of that season, in the pipeline's `name` order.
    A placing is reported only when it comes out the same however every outstanding fixture in its group
    goes -- so a slot seeded from one cannot be overturned by a result nobody has entered yet.

    `gruppen` names the groups worth deciding -- the ones a stored `gruppe` reference actually seeds
    from -- and `None` means all four. The walk over a group's outcomes is the expensive half of a
    result entry, and a group no bracket slot reads from buys nothing with it; a group absent from the
    returned mapping reads to `_seed_from_gruppe` as "no standing supplied", which leaves a slot
    exactly as it stands and is unreachable while every referenced group is in `gruppen`.
    """

    spiele = list(spiele)
    teams = list(teams)

    gruppe_of: dict[CustomObjectId, FLGruppenNames] = {team.id: team.gruppe for team in teams}
    by_gruppe, unattributable = _spiele_by_gruppe(spiele, gruppe_of)
    still_to_play = _still_to_play(spiele)

    teams_by_gruppe: dict[FLGruppenNames, list[FLTeam]] = {name: [] for name in get_args(FLGruppenNames)}
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
        for name in get_args(FLGruppenNames)
        if gruppen is None or name in gruppen
    }


def build_team_memberships_pipeline() -> list[Mapping[str, Any]]:
    """
    Every club with every junction row it holds, for the admin list (`GET /teams/memberships`).

    Deliberately UNLIKE `build_team_pipeline`: no season resolution, no strict join, no statistics.
    The admin surface asks a club-centric question, so retired clubs stay in, a club in no season
    comes back with an empty list, and the lookup projects exactly the junction's three data fields.
    """

    return [
        {
            "$lookup": {
                "from": Collection.SAISON_TEAMS,
                "localField": "_id",
                "foreignField": "team_id",
                "pipeline": [{"$project": {"_id": 0, "saison_id": 1, "gruppe": 1, "disqualifikation": 1}}],
                "as": "memberships",
            }
        },
        {"$sort": {"name": 1}},
    ]


# The season is not `future`. A season's field is settled before it starts (decided 2026-08-07): once
# it is running its fixtures exist, and once it is past its table is history -- a team enters neither.
ENTRY_SAISON_NOT_FUTURE = "REQ-ENTER-001"
# The group is outside the first `number_of_groups` of the closed A-D set, so this season never runs it.
ENTRY_GRUPPE_NOT_OFFERED = "REQ-ENTER-002"
# The group already holds `teams_per_group` rows. A disqualified team still counts towards that: it
# never leaves the season (ADR-0026), so its place stays taken.
ENTRY_GRUPPE_FULL = "REQ-ENTER-003"

# A group CHANGE for a team whose fixtures are already drawn (decided 2026-08-08). The group phase is a
# round robin inside each group, so moving a team leaves its fixtures played against the group it left.
# A move is not an entry.
ENTRY_GRUPPE_LOCKED = "REQ-ENTER-004"


def offered_gruppen(number_of_groups: int) -> tuple[FLGruppenNames, ...]:
    """The groups a season runs: the first `number_of_groups` of the closed A-D set, in order."""

    return get_args(FLGruppenNames)[:number_of_groups]


def find_gruppe_move_refusal(*, saison_status: str, fixtures_drawn: int) -> tuple[str, str] | None:
    """
    Why moving this team to another group must be refused, as `(error_code, detail)` -- or `None`.

    **The legal window is "the season is `future`, OR the team has no fixture in it yet"** (decided
    2026-08-08), which the admin page applies as well. Both halves are needed: a `future` season may
    already have its fixtures drawn, and a running season may not.

    `fixtures_drawn` is how many of the season's matches field this team on either side. Zero means the
    group phase has not been drawn for it, so the group is still just a label and moving it costs nothing.

    A disqualification is not a move and never reaches here -- the caller compares the groups first, so
    writing the same group back passes whatever the season's state.
    """

    if saison_status != "future" and fixtures_drawn > 0:
        noun = "fixture" if fixtures_drawn == 1 else "fixtures"

        return (
            ENTRY_GRUPPE_LOCKED,
            f"season is {saison_status} and the team already has {fixtures_drawn} {noun} in it; "
            "a group change would leave them played against the group it left",
        )

    return None


def find_entry_refusal(saison_status: str, gruppe: FLGruppenNames, rules: FLSaisonRules, occupied: int) -> tuple[str, str] | None:
    """
    Why entering this team into the season must be refused, as `(error_code, detail)` -- or `None`.

    Three rules, checked in the order an admin can act on them (decided 2026-08-07): the season must
    be `future`, the group must be one the season offers, and the group must have space. `occupied`
    is the group's current row count, disqualified rows included -- a team never leaves a season
    (ADR-0026), so its place stays taken. The detail is the English log line; the code is what the
    client maps to German (docs/logging/error-codes.md).
    """

    if saison_status != "future":
        return (ENTRY_SAISON_NOT_FUTURE, f"season is {saison_status}; a team enters a season only while it is future")

    if gruppe not in offered_gruppen(rules.number_of_groups):
        return (ENTRY_GRUPPE_NOT_OFFERED, f"gruppe {gruppe} is not offered; this season runs {rules.number_of_groups} group(s)")

    if occupied >= rules.teams_per_group:
        return (ENTRY_GRUPPE_FULL, f"gruppe {gruppe} is full ({occupied}/{rules.teams_per_group} teams)")

    return None


# A group SWAP: two clubs exchanging groups inside one season (ADR-0062).

# Beside the entry codes rather than among them, because a swap is neither an entry nor the move
# `REQ-ENTER-004` locks: each group keeps its size and every drawn fixture keeps its opponents.

# The two ids do not name two clubs of this season standing in different groups: one club named twice, a
# club holding no junction row, or two clubs of one group.

# One code for the three, because the remedy is the same -- the control offers only pairs that ARE a
# swap, so a request carrying one is stale or racing another admin.
SWAP_NOT_A_SWAP = "REQ-SWAP-001"

# The knockout rounds have started, so the standings these groups produce have already been consumed
# by the seeding (ADR-0035). Exchanging the groups behind that rewrites what its slots meant.
SWAP_KNOCKOUT_STARTED = "REQ-SWAP-002"

# A `past` season, frozen for the reason `REQ-RULES-005` freezes its scoring rules (decided
# 2026-08-11): both are inputs the finished table is computed from on every read.
SWAP_SAISON_FINISHED = "REQ-SWAP-003"

# Either club has taken part in its group's round robin (decided 2026-08-11). Every club plays every
# other club of its group, so one that has played inside a group cannot be moved out of it.
SWAP_GRUPPENPHASE_PLAYED = "REQ-SWAP-004"


def find_gruppe_swap_refusal(
    *,
    is_same_team: bool,
    team1_gruppe: str | None,
    team2_gruppe: str | None,
    saison_status: str,
    played_knockout_fixtures: int,
    played_gruppenphase_fixtures: int,
) -> tuple[str, str] | None:
    """
    Why exchanging these two clubs' groups must be refused, as `(error_code, detail)` -- or `None`.

    Each `gruppe` is what that club's `saison_teams` row holds for the season, and `None` means the club
    holds no row in it at all.

    **Both fixture counts read "played" the same way: carrying an `ergebnis`, OR called off.** That is
    the repository's own reading (`app.api.saisons.services.unplayed_spiel_nrs`) and the competition's --
    a called-off match here is a forfeit and counts as a real game. So a club with a cancelled group
    fixture has taken part in its round robin, and a cancelled knockout fixture filled its slot from a
    group placing exactly as a played one did. The two counts differ only in which phase they read.

    `played_gruppenphase_fixtures` is narrowed to fixtures fielding one of THESE TWO clubs, because
    `REQ-SWAP-004` is about their own participation; `played_knockout_fixtures` counts the season's,
    because `REQ-SWAP-002` is about the bracket having consumed a standing whoever it named.

    **Four rules, and the order is the argument.** A pair that is not a swap describes nothing this
    season could do, so it is answered as that before anything about the season is consulted. The season
    being over comes next, for `find_rules_refusal`'s reason, stated in its own first comment: where the
    whole operation is refused anyway, naming a bound that merely also applies sends an admin to look at
    the wrong thing. A `past` season is refused whatever its bracket holds, so answering `REQ-SWAP-002`
    there would name a reason contingent on a refusal that has already happened. Then the bracket, then
    the round robin -- narrowing from the season to the two clubs.

    Deliberately silent about `ENTRY_GRUPPE_LOCKED`, which refuses a MOVE for a club whose fixtures are
    drawn. That lock's own message names this operation as the defensible one, so a swap neither routes
    through it nor relaxes it (ADR-0062).
    """

    if is_same_team:
        return (SWAP_NOT_A_SWAP, "both ids name one club; a swap exchanges two of them")

    missing = [label for label, gruppe in (("team1", team1_gruppe), ("team2", team2_gruppe)) if gruppe is None]
    if missing:
        return (
            SWAP_NOT_A_SWAP,
            f"no saison_teams row for {' and '.join(missing)}; a swap exchanges two clubs that are both entered in the season",
        )

    if team1_gruppe == team2_gruppe:
        return (SWAP_NOT_A_SWAP, f"both clubs stand in gruppe {team1_gruppe}; a swap exchanges two different groups")

    if saison_status == "past":
        return (
            SWAP_SAISON_FINISHED,
            "season is past; its groups are frozen because the league table is derived from them on every read",
        )

    if played_knockout_fixtures > 0:
        noun = "fixture has" if played_knockout_fixtures == 1 else "fixtures have"

        return (
            SWAP_KNOCKOUT_STARTED,
            f"{played_knockout_fixtures} knockout {noun} already been played or called off; the bracket has been seeded from these groups",
        )

    if played_gruppenphase_fixtures > 0:
        noun = "fixture has" if played_gruppenphase_fixtures == 1 else "fixtures have"

        return (
            SWAP_GRUPPENPHASE_PLAYED,
            f"{played_gruppenphase_fixtures} gruppenphase {noun} already been played or called off for these two clubs; "
            "a club that has played inside its group cannot leave it without leaving a round robin that is not one",
        )

    return None


# A club still entered in a season that is running or planned: retiring it pulls it out of every picker
# while its fixtures are played or drawn -- the state the soft delete exists to prevent, reached through
# the soft delete itself (ADR-0026).
RETIRE_BLOCKED = "REQ-RETIRE-001"


def find_retire_refusal(saison_statuses: Iterable[str]) -> str | None:
    """
    Why retiring this club must be refused, or `None` when it may be retired.

    One rule (decided 2026-08-07): a club whose seasons are all `past` -- or that is in no season at
    all -- may be retired; a club entered in an `active` or `future` season may not. The message is
    the English log detail; the code is what the client reads (docs/logging/error-codes.md).
    """

    blocking = sorted({saison_status for saison_status in saison_statuses if saison_status in ("active", "future")})
    if not blocking:
        return None

    return f"club is entered in a season with status {'/'.join(blocking)}; only a club whose seasons are all past may be retired"
