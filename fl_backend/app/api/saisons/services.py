from collections.abc import Mapping, Sequence
from datetime import date
from http import HTTPStatus
from typing import Any

from app.api.saisons.schedule import knockout_phases_for, qualifier_count, schedule_for
from app.api.saisons.schemas import FIRST_SAISON_YEAR, MAX_TEAMS_PER_GROUP, MIN_TEAMS_PER_GROUP, FLSaisonRules, FLSpielplanShape
from app.api.spiele.schemas import FLSpielJoinedInternal, FLSpielTeamFieldJoinedInternal
from app.api.spiele.services import podium_of
from app.api.teams.schemas import MAX_NUMBER_OF_GROUPS
from app.api.teams.services import offered_gruppen
from app.core.clock import days_after
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError, FieldFault
from app.shared.saison import season_has_ended
from app.shared.schemas.literals import FLGruppenNames, FLSaisonPhase


def base_tier_status_term() -> dict[str, Any]:
    """The `status` term every base-tier season read runs, withholding a `future` season.

    A season still being drawn up is the base tier's to know nothing about, its very existence included. Narrowed, never
    fetched then hidden: a withheld season matches nothing, so `document_not_found`'s 404 stays true and no 403 confirms
    the season exists.
    """

    return {"status": {"$ne": "future"}}


SAISON_AS = "saison"

# A row's own `saisons` row beside it as `saison`, its status and its span alone: the one join a read asks a
# season's state by, a seat's, a fixture's and a line-up's alike, keyed by the row's `saison_id`.
SAISON_LOOKUP: Mapping[str, Any] = {
    "$lookup": {
        "from": Collection.SAISONS,
        "localField": "saison_id",
        "foreignField": "_id",
        "pipeline": [{"$project": {"status": 1, "start_date": 1, "end_date": 1}}],
        "as": SAISON_AS,
    }
}

SPIELTAG_ROWS_AS = "spieltag_rows"

# The matchday's `position` beside the match, and how many matchdays its phase holds in the season, in the same
# aggregation: the landing's opening match, the club page's matches and a match's page each name its matchday by them,
# a knockout round spread over several matchdays telling each apart by its position.
SPIELTAG_POSITION_LOOKUP: Mapping[str, Any] = {
    "$lookup": {
        "from": Collection.SPIELTAGE,
        "localField": "spieltag_id",
        "foreignField": "_id",
        "pipeline": [
            {
                "$lookup": {
                    "from": Collection.SPIELTAGE,
                    "let": {"saison_id": "$saison_id", "saison_phase": "$saison_phase"},
                    # Both equalities, so `uniq_saison_id_saison_phase_position`'s prefix serves the count.
                    "pipeline": [
                        {"$match": {"$expr": {"$and": [{"$eq": ["$saison_id", "$$saison_id"]}, {"$eq": ["$saison_phase", "$$saison_phase"]}]}}},
                        {"$count": "spieltage"},
                    ],
                    "as": "in_phase",
                }
            },
            {"$project": {"_id": 0, "position": 1, "count_in_phase": {"$first": "$in_phase.spieltage"}}},
        ],
        "as": SPIELTAG_ROWS_AS,
    }
}


def matchday_of(spiel_raw: Mapping[str, Any]) -> dict[str, int]:
    """A match's matchday as `SPIELTAG_POSITION_LOOKUP` joined it: its `position` and its phase's count of matchdays."""

    joined = spiel_raw[SPIELTAG_ROWS_AS][0]

    return {"spieltag_position": joined["position"], "count_spieltage_in_phase": joined["count_in_phase"]}


def has_started(*, start_date: str, today: str) -> bool:
    """Whether a season has started: from its `start_date`, the German day `today` is, onwards.

    The one start every start lock and the landing read, so the countdown reaching 00:00 in Berlin and the locks closing
    are one instant. A date and never a fixture: the season's own field is what an administrator sets, and a start read
    off the earliest match moved whenever a match was re-dated.
    """

    return start_date <= today


def entry_is_a_nominee(*, registrierung: Mapping[str, Any] | None, day: str) -> bool:
    """Whether a squad entry dated `day` is a Nachnominierung: one past the end of the season's registration window.

    The one verdict the marker, the cap and the link's page read. A season storing no window has no end to pass, so
    nobody in it is a nominee. The window is null or the whole object the season form writes, `end` included.
    """

    return registrierung is not None and str(registrierung["end"]) < day


type DecidedPodium = tuple[
    FLSpielTeamFieldJoinedInternal | None,
    FLSpielTeamFieldJoinedInternal | None,
    FLSpielTeamFieldJoinedInternal | None,
    FLSpielTeamFieldJoinedInternal | None,
]


def decided_podium(finale: Sequence[FLSpielJoinedInternal]) -> DecidedPodium | None:
    """A season's four places once all four are in, else `None`: the one rule the landing, the admin list and the editor call it decided by.

    Every season ends in a knockout (`find_rules_refusal` refuses rules drawing none), so the Finale's matchday places
    it, and every bracket the rules admit plays a match for third place: it is decided once all four places are in, a
    played final beside an unplayed match for third place still running. A place decided once its club had left is
    vacant, its side `None`, and still a place in.
    """

    match [side for _, side in podium_of(finale)]:
        case [first_place, second_place, third_place, fourth_place]:
            return (first_place, second_place, third_place, fourth_place)
        case _:
            return None


def next_saison_id(newest_id: str | None) -> str:
    """The id the create mints: the year after the newest stored season's, or the league's first where none is stored.

    A season's id is its year in `SAISON_ID_LENGTH` digits, so the newest is the greatest.
    """

    return str(FIRST_SAISON_YEAR) if newest_id is None else str(int(newest_id) + 1)


def find_saison_create_refusal(*, future_stands: bool) -> APIError | None:
    """`create_saison_future_stands`, with no path: a planned season stands, so the next one is already made.

    Takes the answer rather than the lookup, so the caller's read runs in the caller's transaction. Two creates racing
    each other read the same snapshot and mint one id; the second's insert meets the first's as a write conflict, which
    `transact` retries, and the retry reads the planned season and is refused here.
    """

    if not future_stands:
        return None

    return APIError(HTTPStatus.CONFLICT, Code.CREATE_SAISON_FUTURE_STANDS)


def find_saison_start_refusal(*, stored_start_date: str, proposed_start_date: str, taken_place: bool) -> APIError | None:
    """Why moving this season's start must be refused, or `None`: once a fixture of it has taken place, the start is fixed.

    Editable until then, so a season frozen early is unlocked by moving its start. After a match, moving it would
    reopen what every start lock closed on a season somebody already played. Compared by value, so an edit
    resubmitting the stored date passes.
    """

    if stored_start_date == proposed_start_date or not taken_place:
        return None

    return APIError(HTTPStatus.CONFLICT, Code.SAISON_START_TAKEN_PLACE)


def find_saison_start_austritt_refusal(*, stored_start_date: str, proposed_start_date: str, austritt_stored: bool) -> FieldFault | None:
    """Why moving this season's start later must be refused, or `None`: a club's exit is stored.

    An exit is recorded only from the start date (`austritt_before_saison_start`); a start moved later would make the
    season read as unstarted again and reopen the group swap, which would then field a club that has left. An earlier
    start, or the stored one resubmitted, passes. `latest` is the latest start the save may set: the stored one.
    """

    if not austritt_stored or proposed_start_date <= stored_start_date:
        return None

    return FieldFault(
        path=("start_date",), code=Code.SAISON_START_AUSTRITT_STORED, status=HTTPStatus.CONFLICT, bounds={"latest": stored_start_date}
    )


def find_saison_past_refusal(*, saison_status: str) -> APIError | None:
    """`saison_past` for a write a finished season's record no longer takes: a fixture, a matchday's dates, a club's row, a report.

    Pure. A caller's read of `status` stays current through its write set: `activate_saison` anchors the fixtures of every
    season it closes, and the club move anchors the season document the rollover writes.
    """

    if not season_has_ended(saison_status=saison_status):
        return None

    return APIError(HTTPStatus.CONFLICT, Code.SAISON_PAST)


# What a started season holds fixed: a league does not change its scoring or its seeding mid-season.
# `allowed_stufen` stays editable because it bounds what a form offers, never what a stored squad
# row holds.
FROZEN_RULES_FIELDS: tuple[str, ...] = ("win_points", "draw_points", "loss_points", "qualifiers_per_gruppe", "tiebreak_order")

# The three the fixtures were drawn from: changed either way, the rules would imply other matches than the ones drawn.
SHAPE_RULES_FIELDS: tuple[str, ...] = ("number_of_gruppen", "teams_per_gruppe", "qualifiers_per_gruppe")


def _forfeit_unentschieden_in_a_knockout(rules: FLSaisonRules) -> bool:
    """Whether these rules compose a knockout no-show as a level result.

    `knockout_phases_for` again rather than a second reading of the product, so this and
    `rules_bracket_impossible` cannot disagree about whether the season has a bracket.
    """

    return bool(knockout_phases_for(qualifier_count(rules))) and rules.forfeit_ergebnis.sieger_tore == rules.forfeit_ergebnis.verlierer_tore


def find_rules_freeze_refusal(*, saison_status: str, started: bool, stored: FLSaisonRules, proposed: FLSaisonRules) -> APIError | None:
    """Why this edit of a started season's rules must be refused, or `None`.

    Judged before `find_rules_refusal`: no point naming a bound when the whole edit is refused anyway.
    Compared by value, so a dates-only edit resubmitting the stored rules passes.
    """

    # `past` beside the start, so a finished season stays frozen even where its stored `start_date` was
    # moved past today.
    if not (started or saison_status == "past"):
        return None

    if all(getattr(stored, field) == getattr(proposed, field) for field in FROZEN_RULES_FIELDS):
        return None

    return APIError(HTTPStatus.CONFLICT, Code.RULES_SAISON_STARTED)


def find_shape_refusal(
    *,
    # `None` on a create, whose whole rules object is the step.
    stored: FLSaisonRules | None,
    proposed: FLSaisonRules,
    drawn: bool = False,
) -> APIError | None:
    """Why these rules' shape must be refused as a whole, or `None`: a gate, asked before `find_rules_refusal`'s boxes.

    Neither names a box: the editor locks the three numbers once the season is drawn, and offers only the shapes
    `workable_shapes` admits, so only a page read before a draw or a change of the other rules sends either.
    """

    # Early, as the freeze is: where a number cannot change at all, naming what it may not drop past
    # sends an admin to the wrong repair. Compared by value, so a resubmission passes.
    # Absolute, in every status and whatever is recorded: the shape and the fixtures drawn from it
    # are one fact, so this path never moves half of it. An undraw removes the fixtures, and the next
    # draw runs from the shape saved after it.
    if stored is not None and drawn:
        redrawn = [field for field in SHAPE_RULES_FIELDS if getattr(stored, field) != getattr(proposed, field)]
        if redrawn:
            return APIError(HTTPStatus.CONFLICT, Code.RULES_SHAPE_AFTER_SPIELPLAN)

    # Only where the numbers agree with each other: the narrower rule names two boxes an admin can compare, where the
    # bracket's answer is a property of their product.
    if _numbers_refusal(proposed) is not None:
        return None

    qualifiers = proposed.number_of_gruppen * proposed.qualifiers_per_gruppe
    stored_qualifiers = None if stored is None else stored.number_of_gruppen * stored.qualifiers_per_gruppe
    # Against the stored product: an unchanged product carries an unchanged verdict, so equality
    # alone lets the dates-only edit through, `rules` being required on the patch.
    if not knockout_phases_for(qualifiers) and qualifiers != stored_qualifiers:
        return APIError(HTTPStatus.UNPROCESSABLE_CONTENT, Code.RULES_BRACKET_IMPOSSIBLE)

    return None


def find_rules_refusal(
    *,
    # `None` on a create, whose whole rules object is the step.
    stored: FLSaisonRules | None,
    proposed: FLSaisonRules,
    occupancy_by_gruppe: dict[FLGruppenNames, int],
    largest_kader: int = 0,
) -> FieldFault | None:
    """Why these rules must be refused on a box, or `None`. Asked once `find_shape_refusal` passed them."""

    numbers = _numbers_refusal(proposed)
    if numbers is not None:
        return numbers

    # No shoot-out can break it: a composed forfeit discards one, so a level award leaves
    # `_outcome_of` advancing nobody. Only the step that pairs the two
    # is refused.
    if _forfeit_unentschieden_in_a_knockout(proposed) and (stored is None or not _forfeit_unentschieden_in_a_knockout(stored)):
        return FieldFault(
            path=("rules", "forfeit_ergebnis", "sieger_tore"),
            code=Code.RULES_FORFEIT_UNENTSCHIEDEN_IN_A_KNOCKOUT,
            status=HTTPStatus.UNPROCESSABLE_CONTENT,
            bounds={"min": proposed.forfeit_ergebnis.verlierer_tore + 1},
        )

    if stored is None:
        return None

    if proposed.number_of_gruppen < stored.number_of_gruppen:
        offered = offered_gruppen(proposed.number_of_gruppen)
        stranded = sorted(gruppe for gruppe, held in occupancy_by_gruppe.items() if held > 0 and gruppe not in offered)
        if stranded:
            # The groups are a prefix of the closed set, so the fewest that still offer every occupied one run to the last.
            in_use = max(offered_gruppen(MAX_NUMBER_OF_GROUPS).index(gruppe) for gruppe in stranded) + 1
            return FieldFault(
                path=("rules", "number_of_gruppen"), code=Code.RULES_GRUPPEN_IN_USE, status=HTTPStatus.CONFLICT, bounds={"min": in_use}
            )

    if proposed.teams_per_gruppe < stored.teams_per_gruppe:
        fullest = max(occupancy_by_gruppe.values(), default=0)
        if fullest > proposed.teams_per_gruppe:
            return FieldFault(
                path=("rules", "teams_per_gruppe"), code=Code.RULES_CAPACITY_BELOW_USE, status=HTTPStatus.CONFLICT, bounds={"min": fullest}
            )

    # Only where the patch lowers it, on `rules_capacity_below_use`'s shape: a cap left where it stands is not
    # this edit's doing, and refusing it would bar the very edit that repairs the season.
    if proposed.max_kader_size < stored.max_kader_size and largest_kader > proposed.max_kader_size:
        return FieldFault(
            path=("rules", "max_kader_size"), code=Code.RULES_KADER_BELOW_USE, status=HTTPStatus.CONFLICT, bounds={"min": largest_kader}
        )

    return None


def _numbers_refusal(proposed: FLSaisonRules) -> FieldFault | None:
    """The rules' numbers held to each other: the qualifiers within a group, a draw under a win and a loss under a draw."""

    if proposed.qualifiers_per_gruppe > proposed.teams_per_gruppe:
        return FieldFault(
            path=("rules", "qualifiers_per_gruppe"),
            code=Code.RULES_QUALIFIERS_ABOVE_GRUPPE,
            status=HTTPStatus.UNPROCESSABLE_CONTENT,
            bounds={"max": proposed.teams_per_gruppe},
        )

    if proposed.draw_points > proposed.win_points:
        return FieldFault(
            path=("rules", "draw_points"),
            code=Code.RULES_UNENTSCHIEDEN_OUTVALUES_WIN,
            status=HTTPStatus.UNPROCESSABLE_CONTENT,
            bounds={"max": proposed.win_points},
        )

    # The same order one rung down: a loss is never the better result.
    if proposed.loss_points > proposed.draw_points:
        return FieldFault(
            path=("rules", "loss_points"),
            code=Code.RULES_NIEDERLAGE_OUTVALUES_UNENTSCHIEDEN,
            status=HTTPStatus.UNPROCESSABLE_CONTENT,
            bounds={"max": proposed.draw_points},
        )

    return None


def workable_shapes(rules: FLSaisonRules) -> list[FLSpielplanShape]:
    """Every shape these rules' others admit, each judged by `find_rules_refusal` as a create judges rules.

    So the rules form offers exactly the shapes the write admits, the bracket's sizes among them, rather than a copy of
    the rules. A product the knockout ladder cannot halve to a final is skipped unjudged, the bracket rule refusing it on
    every season; the occupancy and the span are the season's state, judged on the save itself.
    """

    shapes: list[FLSpielplanShape] = []
    for groups in range(1, MAX_NUMBER_OF_GROUPS + 1):
        for teams in range(MIN_TEAMS_PER_GROUP, MAX_TEAMS_PER_GROUP + 1):
            for qualifiers in range(1, teams + 1):
                if not knockout_phases_for(groups * qualifiers):
                    continue
                shape = FLSpielplanShape(number_of_gruppen=groups, teams_per_gruppe=teams, qualifiers_per_gruppe=qualifiers)
                # `model_copy` skips validation, safely: the shape's own model declares the three under the rules' own types.
                candidate = rules.model_copy(update=shape.model_dump())
                if find_rules_refusal(stored=None, proposed=candidate, occupancy_by_gruppe={}) is None:
                    shapes.append(shape)

    return shapes


def find_saison_span_refusal(
    *,
    start_date: str,
    end_date: str,
    rules: FLSaisonRules,
    spieltag_spans: Sequence[tuple[str, str]],
) -> tuple[FieldFault, ...]:
    """Why this season's span must be refused: a fault on each date that falls short, or none.

    `spieltag_spans` is every dated matchday of the season, as `(start, end)`: a span the season no
    longer covers strands the matchday, and one still undated constrains nothing, so the caller filters.
    """

    # Inclusive: a season running 2026-05-01 to 2026-05-01 offers one day, not zero.
    offered_days = (date.fromisoformat(end_date) - date.fromisoformat(start_date)).days + 1
    required_days = sum(entry.spieltage for entry in schedule_for(rules))
    if offered_days < required_days:
        # On the end, as the span's own rule sits there, its bound the earliest end the schedule fits: the start is the
        # day the locks read, the box a season's length is repaired on is its end.
        return (
            FieldFault(
                path=("end_date",),
                code=Code.SAISON_SPAN_BELOW_SPIELPLAN,
                status=HTTPStatus.UNPROCESSABLE_CONTENT,
                bounds={"earliest": days_after(day=start_date, days=required_days - 1)},
            ),
        )

    # `start` and `end` are the span the dated matchdays need, named on each side the season falls short of.
    first, last = min((span[0] for span in spieltag_spans), default=start_date), max((span[1] for span in spieltag_spans), default=end_date)
    return tuple(
        FieldFault(path=path, code=Code.SAISON_SPAN_BELOW_SPIELTAGE, status=HTTPStatus.CONFLICT, bounds={"start": first, "end": last})
        for path, falls_short in ((("start_date",), first < start_date), (("end_date",), last > end_date))
        if falls_short
    )


# The projection `holds_a_recorded_fact` reads, beside the predicate itself: a field in one and not
# the other reads a recorded fixture as untouched. `saison_phase` is the entry that is no record --
# it tells the two shapes the draw writes apart.
RECORDED_FACT_FIELDS: tuple[str, ...] = (
    "saison_phase",
    "team1.team_id",
    "team2.team_id",
    "team1.tore",
    "team2.tore",
    "team1_quelle",
    "team2_quelle",
    "ergebnis",
    "sonderereignis",
    "spielort.spielort_id",
    "schiedsrichter.schiedsrichter_id",
    "note",
)

# The one phase `draw_spielplan` fills the sides of. Every other it
# wires and leaves empty, and that difference is the whole of what `_a_side_is_off_the_draw` reads.
DRAWN_HOLDING_ITS_SIDES: FLSaisonPhase = "gruppenphase"


def _a_side_is_off_the_draw(spiel: Mapping[str, Any]) -> bool:
    """Whether either side departs from what the draw leaves on this fixture's phase.

    Any other pairing of occupied and wired is an edit: a hand-picked slot, a cleared quelle, an
    emptied side.
    """

    is_bracket = spiel["saison_phase"] != DRAWN_HOLDING_ITS_SIDES

    # Both directions in one comparison against the phase: "holds a side" alone is true of every
    # group fixture the draw wrote, and would shut the window on every drawn season.
    as_drawn = (not is_bracket, is_bracket)

    team1 = ((spiel.get("team1") or {}).get("team_id") is not None, spiel.get("team1_quelle") is not None)
    team2 = ((spiel.get("team2") or {}).get("team_id") is not None, spiel.get("team2_quelle") is not None)

    return team1 != as_drawn or team2 != as_drawn


def holds_a_recorded_fact(spiel: Mapping[str, Any]) -> bool:
    """Whether anything has been entered against this fixture since the draw wrote it.

    Wider than `has_taken_place`: the window is nothing recorded, so a called-off fixture, a booked
    one, a noted one and one whose sides moved all close it. A date does not.
    """

    if spiel.get("ergebnis") is not None or spiel.get("sonderereignis") is not None:
        return True

    # Both slots spelled out, as `_a_side_is_off_the_draw` above is, and refused by the same sweep:
    # a key reached through a variable names a path the projection cannot be asked about.
    if (spiel.get("team1") or {}).get("tore") is not None or (spiel.get("team2") or {}).get("tore") is not None:
        return True

    if _a_side_is_off_the_draw(spiel):
        return True

    # Absent or null where nothing is noted: the draw writes no key, clearing a note stores null, and the fixture's save
    # keeps "" off its route.
    if spiel.get("note") is not None:
        return True

    # A referee's booking by its block, never its id: one naming nobody keeps a played match's fee once its referee was
    # erased, and is a record all the same.
    return (spiel.get("spielort") or {}).get("spielort_id") is not None or spiel.get("schiedsrichter") is not None


def find_activation_refusal(*, target_status: str, target_drawn: bool, spieltage_undated: bool, outgoing_unplayed: bool) -> APIError | None:
    """Why this rollover must be refused, or `None`.

    `spieltage_undated` is whether a matchday of the target season holds no `start`; `outgoing_unplayed` is whether the
    incumbent still owes a match by `is_unplayed`, false where there is none, and never asks the target's own fixtures.
    An open bracket slot owes one as an unscored match does, since neither holds a result.
    """

    # The target first: an incumbent an admin can go and finish is beside the point where the season
    # they are promoting may not be promoted at all.
    if target_status == "past":
        return APIError(HTTPStatus.CONFLICT, Code.SAISON_PAST)

    if not target_drawn:
        return APIError(HTTPStatus.CONFLICT, Code.ACTIVATE_TARGET_UNDRAWN)

    # After the undrawn target and before the incumbent: an undrawn season holds no matchday to
    # date, so this refusal would name a repair the admin cannot make there.
    if spieltage_undated:
        return APIError(HTTPStatus.CONFLICT, Code.ACTIVATE_SPIELTAGE_UNDATED)

    if not outgoing_unplayed:
        return None

    return APIError(HTTPStatus.CONFLICT, Code.ACTIVATE_SAISON_UNFINISHED)


def _planning_window_is_open(*, saison_status: str, recorded_spiele: int) -> bool:
    """Whether this season's Spielplan may still be replaced or removed: it is `future`, and nothing is recorded against it.

    `future` is the one status nothing returns a season to, which is what makes a shape frozen outside it frozen for
    good. One predicate for every rule turning on it: a second copy is how a refusal comes to recommend a write the
    product then turns away.
    """

    return saison_status == "future" and recorded_spiele == 0


def find_spielplan_refusal(
    *,
    saison_status: str,
    spiele_drawn: int,
    rules: FLSaisonRules,
    occupancy_by_gruppe: Mapping[FLGruppenNames, int],
    # Neither defaults: a caller that forgot `recorded_spiele` would replace a season already played.
    replace: bool,
    recorded_spiele: int,
) -> APIError | None:
    """Why drawing this season's Spielplan must be refused, or `None`.

    Each refuses on its own, so the order decides only which one an admin reads: what no group
    filling repairs first, because `spielplan_gruppen_off_rules` alone names work an admin can go and do.
    """

    # What a confirmed replace is about to delete is no reason to turn it away, so `spielplan_already_drawn` steps aside
    # for one. `spielplan_replace_outside_its_window` below is what bounds it instead.
    if spiele_drawn > 0 and not replace:
        return APIError(HTTPStatus.CONFLICT, Code.SPIELPLAN_ALREADY_DRAWN)

    # Whether the season holds anything to delete or not: the flag is the operation the caller asked
    # for, and one flag meaning a replace here and a first draw there is the ambiguity this closes.
    if replace and not _planning_window_is_open(saison_status=saison_status, recorded_spiele=recorded_spiele):
        return APIError(HTTPStatus.CONFLICT, Code.SPIELPLAN_REPLACE_OUTSIDE_ITS_WINDOW)

    # `past` alone, never `future`-only: activation is one-way, so a season activated before its draw
    # would otherwise be unschedulable for good, and `activate_target_undrawn` keeps the state rare. A
    # replace is `future`-only, above.
    if saison_status == "past":
        return APIError(HTTPStatus.CONFLICT, Code.SAISON_PAST)

    offered = offered_gruppen(rules.number_of_gruppen)

    # Rows carrying an `austritt` count as occupying: a club that withdrew before the draw keeps its place, and the
    # group is still the size it owes.
    off_size = any(occupancy_by_gruppe.get(gruppe, 0) != rules.teams_per_gruppe for gruppe in offered)

    # A key outside `offered` is clubs the draw would put in no round robin at all. `_teams_by_gruppe` raises
    # on these states too, as its own contract against a caller that skipped this rule; the endpoint
    # is where they become an answer an admin can act on.
    off_size = off_size or any(held > 0 and gruppe not in offered for gruppe, held in occupancy_by_gruppe.items())

    if off_size:
        return APIError(HTTPStatus.CONFLICT, Code.SPIELPLAN_GRUPPEN_OFF_RULES)

    return None


def find_berichte_refusal(*, berichte: int) -> APIError | None:
    """Why a replace or an undraw must be refused for the referees' reports it would delete with the fixtures, or `None`."""

    if berichte == 0:
        return None

    return APIError(HTTPStatus.CONFLICT, Code.SPIELPLAN_BERICHTE_SUBMITTED)


def find_undraw_refusal(*, saison_status: str, recorded_spiele: int) -> APIError | None:
    """Why removing this season's Spielplan must be refused, or `None`.

    The replace's window, read off the operation and not off what there is to remove: a season
    already undrawn is the state asked for, so it removes nothing rather than refusing.
    """

    if _planning_window_is_open(saison_status=saison_status, recorded_spiele=recorded_spiele):
        return None

    return APIError(HTTPStatus.CONFLICT, Code.SPIELPLAN_UNDRAW_OUTSIDE_ITS_WINDOW)


def find_gruppe_swap_refusal(
    *,
    team1_gruppe: str | None,
    team2_gruppe: str | None,
    saison_status: str,
    # `has_started`: a swap rewrites fixtures, and once the season is under
    # way a fixture is a record of who played it. Before the start the save refuses a result
    # (`ergebnis_before_saison_start`), which keeps records out of what the rewrite moves.
    started: bool,
) -> APIError | None:
    """Why exchanging these two clubs' groups must be refused, or `None`.

    **The order is the argument**: it narrows from "not a swap" through the season. The season's start is the one lock,
    an exit is recorded only from it (`austritt_before_saison_start`) and the start never moves later past a stored one
    (`saison_start_austritt_stored`), so the fixtures an exchange rewrites never field a club that has left.
    """

    # A side in no group is no swap, and nor is one club named on both sides, which reads its one group twice.
    if team1_gruppe is None or team2_gruppe is None or team1_gruppe == team2_gruppe:
        return APIError(HTTPStatus.UNPROCESSABLE_CONTENT, Code.SWAP_NOT_A_SWAP)

    if saison_status == "past":
        return APIError(HTTPStatus.CONFLICT, Code.SAISON_PAST)

    if started:
        return APIError(HTTPStatus.CONFLICT, Code.SWAP_SAISON_STARTED)

    return None
