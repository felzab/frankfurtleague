from collections.abc import Iterable, Mapping, Sequence
from datetime import date
from http import HTTPStatus
from typing import Any

from app.api.saisons.schedule import expected_matches, knockout_phases_for, qualifier_count, schedule_for
from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.schemas import FLSpiel, is_unplayed
from app.api.teams.services import offered_gruppen
from app.core.codes import Code
from app.core.exceptions import WriteRefusal
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from app.shared.schemas.literals import FLGruppenNames, FLSaisonPhase, FLSaisonStatus


def with_schedule(saison_raw: Mapping[str, Any]) -> dict[str, Any]:
    """Attach a season's derived `schedule` before validation.

    Injected into the raw document, not computed on the model: `schedule_for` imports
    `FLSaisonRules`, so a computed field there would close an import cycle.
    """

    return {**saison_raw, "schedule": [entry.__dict__ for entry in schedule_for(FLSaisonRules.model_validate(saison_raw["rules"]))]}


# A season still being drawn up is the base tier's to know nothing about, its very existence included.
WITHHELD_FROM_BASE_TIER: FLSaisonStatus = "future"


def base_tier_status_term(requested: FLSaisonStatus | None = None) -> dict[str, Any]:
    """The `status` term every base-tier season read runs; `requested` is the caller's own filter.

    NARROWED, never fetched then hidden: a withheld season matches nothing, so `document_not_found`'s 404
    stays true and no 403 confirms the season exists.
    """

    if requested is None:
        return {"status": {"$ne": WITHHELD_FROM_BASE_TIER}}

    # Both operators: an explicit `?status=future` then matches nothing, rather than the narrowing
    # being overwritten by the term the caller asked for.
    return {"status": {"$eq": requested, "$ne": WITHHELD_FROM_BASE_TIER}}


# What a started season holds fixed: a league does not change its scoring or its seeding mid-season.
# `erlaubte_stufen` stays editable because it bounds what a form offers, never what a stored squad
# row holds.
FROZEN_RULES_FIELDS: tuple[str, ...] = ("win_points", "draw_points", "qualifiers_per_group", "tiebreak_order")

# The three the fixtures were drawn from. A RAISE is what nothing else refuses: `anzahl_spiele` is
# derived per matchday, so every matchday would then expect matches nobody drew, and
# `rules_spieltag_over_its_phase` reads the narrowing direction alone.
SHAPE_RULES_FIELDS: tuple[str, ...] = ("number_of_groups", "teams_per_group", "qualifiers_per_group")

# The one of the three a REDRAW moves. `spielplan_gruppen_off_rules` asks every offered group for exactly
# `teams_per_group`, so a redraw carrying either of the others is refused for the groups then off
# their size; qualifiers touch no group's occupancy at all.
REDRAWABLE_SHAPE_FIELD = "qualifiers_per_group"


def total_season_fixtures(rules: FLSaisonRules) -> int:
    """Every match these rules imply, the bracket's rounds included.

    One fold, so every reader weighs one number against the one read's page: a second reading of
    `schedule_for` would drift the moment a phase moved.
    """

    return sum(entry.matchdays * entry.matches_per_matchday for entry in schedule_for(rules))


def _forfeit_draws_a_knockout(rules: FLSaisonRules) -> bool:
    """Whether these rules compose a knockout no-show as a level result.

    `knockout_phases_for` again rather than a second reading of the product, so this and
    `rules_bracket_impossible` cannot disagree about whether the season has a bracket.
    """

    return bool(knockout_phases_for(qualifier_count(rules))) and rules.forfeit_ergebnis.sieger_tore == rules.forfeit_ergebnis.verlierer_tore


def find_rules_freeze_refusal(*, saison_status: str, started: bool, stored: FLSaisonRules, proposed: FLSaisonRules) -> WriteRefusal | None:
    """Why this edit of a started season's rules must be refused, or `None`.

    Judged before `find_rules_refusal`: no point naming a bound when the whole edit is refused anyway.
    Compared by value, so a dates-only edit resubmitting the stored rules passes.
    """

    # `past` beside the start, so a finished season none of whose group fixtures carries a date stays
    # frozen too.
    if not (started or saison_status == "past"):
        return None

    if all(getattr(stored, field) == getattr(proposed, field) for field in FROZEN_RULES_FIELDS):
        return None

    return WriteRefusal(
        error_code=Code.RULES_SAISON_STARTED,
        status=HTTPStatus.CONFLICT,
    )


def find_rules_refusal(
    *,
    # `None` on a create, whose whole rules object is the step.
    stored: FLSaisonRules | None,
    proposed: FLSaisonRules,
    occupancy_by_gruppe: dict[FLGruppenNames, int],
    highest_wired_platz: int,
    largest_squad: int = 0,
    # The LARGEST count any single matchday of a phase holds, never the sum.
    attached_by_phase: Mapping[FLSaisonPhase, int] | None = None,
    drawn_fixtures: int = 0,
) -> WriteRefusal | None:
    """Why these rules must be refused, or `None`."""

    # Early for the freeze's reason: where a number cannot change at all, naming what it may not drop
    # past sends an admin to the wrong repair. Compared by value, so a resubmission passes.

    # ABSOLUTE, in every status and whatever is recorded: the shape and the fixtures drawn from it
    # are one fact, so this path never moves half of it. The whole of it moves on the draw, which
    # takes the three numbers on its own payload.
    if stored is not None and drawn_fixtures > 0:
        redrawn = [field for field in SHAPE_RULES_FIELDS if getattr(stored, field) != getattr(proposed, field)]
        if redrawn:
            return WriteRefusal(
                error_code=Code.RULES_SHAPE_AFTER_SPIELPLAN,
                status=HTTPStatus.CONFLICT,
            )

    # Before the bracket rule, being narrower: it names two fields an admin can compare, where the
    # bracket's answer is a property of their product.
    excess = proposed.qualifiers_per_group - proposed.teams_per_group
    # The EXCESS, against the stored one: `rules` is required on the patch, so a dates-only edit
    # resubmits a stored violation unchanged, and shrinking an excess repairs it.
    if excess > 0 and (stored is None or excess > stored.qualifiers_per_group - stored.teams_per_group):
        return WriteRefusal(
            error_code=Code.RULES_QUALIFIERS_ABOVE_GRUPPE,
            status=HTTPStatus.UNPROCESSABLE_CONTENT,
        )

    # The EXCESS again, so a stored violation resubmitted unchanged passes and shrinking it repairs
    # the season.
    draw_excess = proposed.draw_points - proposed.win_points
    if draw_excess > 0 and (stored is None or draw_excess > stored.draw_points - stored.win_points):
        return WriteRefusal(
            error_code=Code.RULES_UNENTSCHIEDEN_OUTVALUES_WIN,
            status=HTTPStatus.UNPROCESSABLE_CONTENT,
        )

    qualifiers = proposed.number_of_groups * proposed.qualifiers_per_group
    stored_qualifiers = None if stored is None else stored.number_of_groups * stored.qualifiers_per_group
    # Against the stored product: an unchanged product carries an unchanged verdict, so equality
    # alone lets the dates-only edit through, `rules` being required on the patch.
    if not knockout_phases_for(qualifiers) and qualifiers != stored_qualifiers:
        return WriteRefusal(
            error_code=Code.RULES_BRACKET_IMPOSSIBLE,
            status=HTTPStatus.UNPROCESSABLE_CONTENT,
        )

    # AFTER the bracket rule, which is narrower and answers first: a product with no bracket plays
    # no knockout round, so a count taken over one measures a season the admin has not asked for.
    fixtures = total_season_fixtures(proposed)
    stored_fixtures = None if stored is None else total_season_fixtures(stored)
    # The EXCESS, as `rules_qualifiers_above_gruppe` and `rules_unentschieden_outvalues_win` beside it: `rules` is required on the patch,
    # so a dates-only edit resubmits a stored count unchanged and any step that shrinks one repairs
    # the season.
    if fixtures > LIST_LIMIT_DEFAULT and (stored_fixtures is None or fixtures > stored_fixtures):
        return WriteRefusal(
            error_code=Code.RULES_SPIELE_OVER_ONE_READ,
            status=HTTPStatus.UNPROCESSABLE_CONTENT,
        )

    # No shoot-out can break it: a composed forfeit discards one, so a level award leaves
    # `app/api/spiele/services.py :: _outcome_of` advancing nobody. Only the step that pairs the two
    # is refused.
    if _forfeit_draws_a_knockout(proposed) and (stored is None or not _forfeit_draws_a_knockout(stored)):
        return WriteRefusal(
            error_code=Code.RULES_FORFEIT_DRAWS_A_KNOCKOUT,
            status=HTTPStatus.UNPROCESSABLE_CONTENT,
        )

    if stored is None:
        return None

    if proposed.number_of_groups < stored.number_of_groups:
        offered = offered_gruppen(proposed.number_of_groups)
        stranded = sorted(gruppe for gruppe, held in occupancy_by_gruppe.items() if held > 0 and gruppe not in offered)
        if stranded:
            return WriteRefusal(
                error_code=Code.RULES_GRUPPEN_IN_USE,
                status=HTTPStatus.CONFLICT,
            )

    if proposed.teams_per_group < stored.teams_per_group:
        fullest = max(occupancy_by_gruppe.values(), default=0)
        if fullest > proposed.teams_per_group:
            return WriteRefusal(
                error_code=Code.RULES_CAPACITY_BELOW_USE,
                status=HTTPStatus.CONFLICT,
            )

    # Only where the patch LOWERS it, on `rules_capacity_below_use`'s shape: a cap left where it stands is not
    # this edit's doing, and refusing it would bar the very edit that repairs the season.
    if proposed.max_kadergroesse < stored.max_kadergroesse and largest_squad > proposed.max_kadergroesse:
        return WriteRefusal(
            error_code=Code.RULES_KADER_BELOW_USE,
            status=HTTPStatus.CONFLICT,
        )

    # Only where the patch LOWERS it: `rules` is required, so a dates-only edit resubmits a count
    # already under the wiring, and refusing that would leave the season unpatchable.
    if proposed.qualifiers_per_group < highest_wired_platz and proposed.qualifiers_per_group < stored.qualifiers_per_group:
        return WriteRefusal(
            error_code=Code.RULES_QUALIFIERS_BELOW_WIRING,
            status=HTTPStatus.CONFLICT,
        )

    # Last, being the only check computing the whole schedule. EVERY phase: lowering the qualifier
    # count shortens the ladder, so an unreached phase expects 0 while its matchdays keep fixtures.
    for phase, attached in sorted((attached_by_phase or {}).items()):
        expected = expected_matches(proposed, phase)
        # Only where the step NARROWS the phase: a count nothing changed is not this edit's doing,
        # and refusing it would leave the season unpatchable.
        if attached > expected and expected < expected_matches(stored, phase):
            return WriteRefusal(
                error_code=Code.RULES_SPIELTAG_OVER_ITS_PHASE,
                status=HTTPStatus.CONFLICT,
            )

    return None


def find_saison_span_refusal(
    *,
    start_date: str,
    end_date: str,
    rules: FLSaisonRules,
    spieltag_spans: Sequence[tuple[str, str]],
) -> WriteRefusal | None:
    """Why this season's span must be refused, or `None`.

    `spieltag_spans` is every DATED matchday of the season, as `(beginn, ende)`: a span the season no
    longer covers strands the matchday, and one still undated constrains nothing, so the caller filters.
    """

    # Inclusive: a season running 2026-05-01 to 2026-05-01 offers one day, not zero.
    offered_days = (date.fromisoformat(end_date) - date.fromisoformat(start_date)).days + 1
    required_days = sum(entry.matchdays for entry in schedule_for(rules))
    if offered_days < required_days:
        return WriteRefusal(
            error_code=Code.SAISON_SPAN_BELOW_SPIELPLAN,
            status=HTTPStatus.UNPROCESSABLE_CONTENT,
        )

    outside = sorted(span for span in spieltag_spans if span[0] < start_date or span[1] > end_date)
    if outside:
        return WriteRefusal(
            error_code=Code.SAISON_SPAN_BELOW_SPIELTAGE,
            status=HTTPStatus.CONFLICT,
        )

    return None


# The two rules a stated shape can break while the value they weigh is a stored one: the forfeit
# award, once the shape's qualifiers give the season a bracket, and the span, once its matchdays
# outgrow it. The draw answers each as a conflict with the season. Every other rule a draw asks
# reads the shape alone, or a stored value only a hand-edited document breaks.
DRAW_TWINS: Mapping[Code, Code] = {
    Code.RULES_FORFEIT_DRAWS_A_KNOCKOUT: Code.RULES_FORFEIT_DRAWS_A_KNOCKOUT_AS_STORED,
    Code.SAISON_SPAN_BELOW_SPIELPLAN: Code.SAISON_SPAN_BELOW_SPIELPLAN_AS_STORED,
}


def as_the_draw_answers(refusal: WriteRefusal | None) -> WriteRefusal | None:
    """`refusal` as the draw answers it: under its twin where it weighed a stored value, else unchanged."""

    if refusal is None or refusal.error_code not in DRAW_TWINS:
        return refusal

    return WriteRefusal(error_code=DRAW_TWINS[refusal.error_code], status=HTTPStatus.CONFLICT)


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
    "ort.spielort_id",
    "schiedsrichter.schiedsrichter_id",
    "notiz",
)

# The one phase `app/api/saisons/spielplan.py :: draw_spielplan` fills the sides of. Every other it
# wires and leaves empty, and that difference is the whole of what `_a_side_is_off_the_draw` reads.
DRAWN_HOLDING_ITS_SIDES: FLSaisonPhase = "gruppenphase"


def _a_side_is_off_the_draw(spiel: Mapping[str, Any]) -> bool:
    """Whether either side departs from what the draw leaves on this fixture's phase.

    Any other pairing of occupied and wired is an edit: a hand-picked slot, a cleared quelle, an
    emptied side.
    """

    # A document with no `saison_phase` reads as a bracket, so every group fixture then counts as
    # recorded: the projection always carries the key, and a missing one must refuse rather than
    # widen the window it decides.
    is_bracket = spiel.get("saison_phase") != DRAWN_HOLDING_ITS_SIDES

    # Both directions in ONE comparison against the phase: "holds a side" alone is true of every
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

    # STRIPPED, never compared to None: the draw writes no key, clearing a note stores null, and
    # `FLPatchSpielDataPayload.empty_strings_to_none` keeps "" off that route -- a hand edit can
    # still leave one, and an empty note is not a record.
    if (spiel.get("notiz") or "").strip():
        return True

    return (spiel.get("ort") or {}).get("spielort_id") is not None or (spiel.get("schiedsrichter") or {}).get("schiedsrichter_id") is not None


def unplayed_spiel_nrs(spiele: Iterable[FLSpiel]) -> list[int]:
    """The fixture numbers of every match still waiting to be played, in order.

    Unplayed means NO RESULT and NOT CANCELLED; one with no occupants counts too, an open bracket
    slot being as unfinished as an unscored match.
    """

    return sorted(spiel.spiel_nr for spiel in spiele if is_unplayed(ergebnis=spiel.ergebnis, sonderereignis=spiel.sonderereignis))


def find_activation_refusal(
    *, target_status: str, target_fixtures: int, undated_spieltage: int, outgoing_unplayed: Sequence[int]
) -> WriteRefusal | None:
    """Why this rollover must be refused, or `None`.

    `undated_spieltage` counts the TARGET season's matchdays holding no `beginn`; `outgoing_unplayed`
    is the incumbent's alone, empty where there is none, and never the target's own fixtures.
    """

    # The target first: an incumbent an admin can go and finish is beside the point where the season
    # they are promoting may not be promoted at all.
    if target_status == "past":
        return WriteRefusal(
            error_code=Code.SAISON_PAST,
            status=HTTPStatus.CONFLICT,
        )

    if target_fixtures == 0:
        return WriteRefusal(
            error_code=Code.ACTIVATE_TARGET_UNDRAWN,
            status=HTTPStatus.CONFLICT,
        )

    # After the undrawn target and before the incumbent: an undrawn season holds no matchday to
    # date, so this refusal would name a repair the admin cannot make there.
    if undated_spieltage > 0:
        return WriteRefusal(
            error_code=Code.ACTIVATE_SPIELTAGE_UNDATED,
            status=HTTPStatus.CONFLICT,
        )

    if not outgoing_unplayed:
        return None

    return WriteRefusal(
        error_code=Code.ACTIVATE_SAISON_UNFINISHED,
        status=HTTPStatus.CONFLICT,
    )


# The one status a draw, a replace and an undraw run on, and the one nothing returns a season to
# -- which is what makes a shape frozen outside it frozen for good.
PLANNING_STATUS: FLSaisonStatus = "future"


def _planning_window_is_open(*, saison_status: str, recorded_fixtures: int) -> bool:
    """Whether this season's Spielplan may still be replaced or removed.

    ONE predicate for every rule turning on it: a second copy is how a refusal comes to recommend a
    write the product then turns away.
    """

    return saison_status == PLANNING_STATUS and recorded_fixtures == 0


def find_spielplan_refusal(
    *,
    saison_status: str,
    fixtures_drawn: int,
    spieltage_held: int,
    rules: FLSaisonRules,
    occupancy_by_gruppe: Mapping[FLGruppenNames, int],
    # NEITHER defaults: a caller that forgot `recorded_fixtures` would replace a season already played.
    replace: bool,
    recorded_fixtures: int,
) -> WriteRefusal | None:
    """Why drawing this season's Spielplan must be refused, or `None`.

    Each refuses on its own, so the order decides only which one an admin reads: what no group
    filling repairs first, because `spielplan_gruppen_off_rules` alone names work an admin can go and do.
    """

    # What a confirmed replace is about to delete is no reason to turn it away, so `spielplan_already_drawn`
    # and `spielplan_spieltage_held` step aside for one. `spielplan_replace_outside_its_window` below is what bounds it instead.
    if fixtures_drawn > 0 and not replace:
        return WriteRefusal(
            error_code=Code.SPIELPLAN_ALREADY_DRAWN,
            status=HTTPStatus.CONFLICT,
        )

    if spieltage_held > 0 and not replace:
        return WriteRefusal(
            error_code=Code.SPIELPLAN_SPIELTAGE_HELD,
            status=HTTPStatus.CONFLICT,
        )

    # Whether the season holds anything to delete or not: the flag is the operation the caller asked
    # for, and one flag meaning a replace here and a first draw there is the ambiguity this closes.
    if replace and not _planning_window_is_open(saison_status=saison_status, recorded_fixtures=recorded_fixtures):
        return WriteRefusal(
            error_code=Code.SPIELPLAN_REPLACE_OUTSIDE_ITS_WINDOW,
            status=HTTPStatus.CONFLICT,
        )

    # `past` alone, never `future`-only: activation is one-way, so a season activated before its draw
    # would otherwise be unschedulable for good, and `activate_target_undrawn` keeps the state rare. A
    # REPLACE is `future`-only, above.
    if saison_status == "past":
        return WriteRefusal(
            error_code=Code.SAISON_PAST,
            status=HTTPStatus.CONFLICT,
        )

    offered = offered_gruppen(rules.number_of_groups)

    # Rows carrying an `austritt` count as occupying, exactly as `find_entry_refusal` counts them: a
    # club that withdrew before the draw keeps its place, and the group is still the size it owes.
    off_size = any(occupancy_by_gruppe.get(gruppe, 0) != rules.teams_per_group for gruppe in offered)

    # A key outside `offered` is clubs the draw would put in no round robin at all. `_squads` raises
    # on these states too, as its own contract against a caller that skipped this rule; the endpoint
    # is where they become an answer an admin can act on.
    off_size = off_size or any(held > 0 and gruppe not in offered for gruppe, held in occupancy_by_gruppe.items())

    if off_size:
        return WriteRefusal(
            error_code=Code.SPIELPLAN_GRUPPEN_OFF_RULES,
            status=HTTPStatus.CONFLICT,
        )

    return None


def find_berichte_refusal(*, berichte: int) -> WriteRefusal | None:
    """Why a replace or an undraw must be refused for the referees' reports it would delete with the fixtures, or `None`."""

    if berichte == 0:
        return None

    return WriteRefusal(
        error_code=Code.SPIELPLAN_BERICHTE_EINGEREICHT,
        status=HTTPStatus.CONFLICT,
    )


def find_undraw_refusal(*, saison_status: str, recorded_fixtures: int) -> WriteRefusal | None:
    """Why removing this season's Spielplan must be refused, or `None`.

    The replace's window, read off the OPERATION and not off what there is to remove: a season
    already undrawn is the state asked for, so it removes nothing rather than refusing.
    """

    if _planning_window_is_open(saison_status=saison_status, recorded_fixtures=recorded_fixtures):
        return None

    return WriteRefusal(
        error_code=Code.SPIELPLAN_UNDRAW_OUTSIDE_ITS_WINDOW,
        status=HTTPStatus.CONFLICT,
    )
