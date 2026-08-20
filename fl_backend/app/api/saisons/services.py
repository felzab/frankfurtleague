from datetime import date
from typing import Any, Iterable, Mapping, Sequence

from app.api.saisons.schedule import expected_matches, knockout_phases_for, qualifier_count, schedule_for
from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.schemas import MAX_QUALIFIERS, SONDEREREIGNIS_WITHOUT_A_RESULT, FLSaisonPhase, FLSpiel
from app.api.teams.schemas import FLGruppenNames
from app.api.teams.services import offered_gruppen
from app.core.exceptions import WriteRefusal


def with_schedule(saison_raw: Mapping[str, Any]) -> dict[str, Any]:
    """Attach a season's derived `schedule` before validation.

    Injected into the raw document, not computed on the model: `schedule_for` imports
    `FLSaisonRules`, so a computed field there would close an import cycle.
    """

    return {**saison_raw, "schedule": [entry.__dict__ for entry in schedule_for(FLSaisonRules.model_validate(saison_raw["rules"]))]}


# What each code below refuses is `docs/logging/error-codes.md`.
RULES_BRACKET_IMPOSSIBLE = "REQ-RULES-001"
RULES_GROUPS_IN_USE = "REQ-RULES-002"
RULES_CAPACITY_BELOW_USE = "REQ-RULES-003"
RULES_QUALIFIERS_BELOW_WIRING = "REQ-RULES-004"
RULES_SAISON_FINISHED = "REQ-RULES-005"
RULES_QUALIFIERS_ABOVE_GROUP = "REQ-RULES-007"
RULES_MATCHDAY_OVER_ITS_PHASE = "REQ-RULES-006"
RULES_DRAW_OUTVALUES_WIN = "REQ-RULES-008"
RULES_KADER_BELOW_USE = "REQ-RULES-009"
RULES_FORFEIT_DRAWS_A_KNOCKOUT = "REQ-RULES-010"
RULES_SHAPE_AFTER_DRAW = "REQ-RULES-011"

# `erlaubte_stufen` stays editable because it bounds what a form offers, never what a stored squad
# row holds.
FROZEN_RULES_FIELDS: tuple[str, ...] = ("win_points", "draw_points", "qualifiers_per_group", "tiebreak_order")

# The three the fixtures were drawn from. A RAISE is what nothing else refuses: `anzahl_spiele` is
# derived per matchday, so every matchday would then expect matches nobody drew, and
# `REQ-RULES-006` reads the narrowing direction alone.
SHAPE_RULES_FIELDS: tuple[str, ...] = ("number_of_groups", "teams_per_group", "qualifiers_per_group")


def _forfeit_draws_a_knockout(rules: FLSaisonRules) -> bool:
    """Whether these rules compose a knockout no-show as a level result.

    `knockout_phases_for` again rather than a second reading of the product, so this and
    `REQ-RULES-001` cannot disagree about whether the season has a bracket.
    """

    return bool(knockout_phases_for(qualifier_count(rules))) and rules.forfeit_ergebnis.sieger_tore == rules.forfeit_ergebnis.verlierer_tore


def find_rules_refusal(
    *,
    saison_status: str,
    stored: FLSaisonRules | None,
    proposed: FLSaisonRules,
    occupancy_by_gruppe: dict[FLGruppenNames, int],
    highest_wired_platz: int,
    largest_squad: int = 0,
    attached_by_phase: Mapping[FLSaisonPhase, int] | None = None,
    drawn_fixtures: int = 0,
) -> WriteRefusal | None:
    """Why these rules must be refused, or `None`.

    `stored` is `None` on a create, whose whole rules object is the step
    (`docs/backend/spec.md :: I44`). `attached_by_phase` is the LARGEST count any single matchday of
    a phase holds, not the sum.
    """

    # The freeze first: no point naming a bound when the whole edit is refused anyway.
    if stored is not None and saison_status == "past":
        changed = [field for field in FROZEN_RULES_FIELDS if getattr(stored, field) != getattr(proposed, field)]
        if changed:
            return WriteRefusal(
                error_code=RULES_SAISON_FINISHED,
                message=f"season is past; {', '.join(changed)} cannot change because the league table is scored from rules on every read",
            )

    # Early for the reason the first freeze is: where a number cannot change at all, naming what it
    # may not drop past sends an admin to the wrong repair. Compared by value, so a resubmission
    # passes (`docs/backend/spec.md :: I44`).

    # `REQ-RULES-004` and `REQ-RULES-006` stay unreachable through this route: both read a figure
    # derived from fixtures, so whenever either could fire this has already refused the same field.
    # Unreachable, not wrong.
    if stored is not None and drawn_fixtures > 0:
        redrawn = [field for field in SHAPE_RULES_FIELDS if getattr(stored, field) != getattr(proposed, field)]
        if redrawn:
            return WriteRefusal(
                error_code=RULES_SHAPE_AFTER_DRAW,
                message=f"the season's {drawn_fixtures} fixtures are already drawn from these rules; "
                f"{', '.join(redrawn)} cannot change without drawing them again",
            )

    # Before the bracket rule, being narrower: it names two fields an admin can compare, where the
    # bracket's answer is a property of their product.
    excess = proposed.qualifiers_per_group - proposed.teams_per_group
    # The EXCESS, against the stored one: `rules` is required on the patch, so a dates-only edit
    # resubmits a stored violation unchanged, and shrinking an excess repairs it
    # (`docs/backend/spec.md :: I44`).
    if excess > 0 and (stored is None or excess > stored.qualifiers_per_group - stored.teams_per_group):
        return WriteRefusal(
            error_code=RULES_QUALIFIERS_ABOVE_GROUP,
            message=f"{proposed.qualifiers_per_group} qualifier(s) per group from groups of {proposed.teams_per_group}; "
            "a group cannot send more teams into the bracket than it holds",
        )

    # The EXCESS again, so a stored violation resubmitted unchanged passes and shrinking it repairs
    # the season (`docs/backend/spec.md :: I44`).
    draw_excess = proposed.draw_points - proposed.win_points
    if draw_excess > 0 and (stored is None or draw_excess > stored.draw_points - stored.win_points):
        return WriteRefusal(
            error_code=RULES_DRAW_OUTVALUES_WIN,
            message=f"a draw would be worth {proposed.draw_points} against {proposed.win_points} for a win; "
            "no season can make drawing the better result",
        )

    qualifiers = proposed.number_of_groups * proposed.qualifiers_per_group
    stored_qualifiers = None if stored is None else stored.number_of_groups * stored.qualifiers_per_group
    # Against the stored product: an unchanged product carries an unchanged verdict, so equality
    # alone lets the dates-only edit through, `rules` being required on the patch
    # (`docs/backend/spec.md :: I44`).
    if not knockout_phases_for(qualifiers) and qualifiers != stored_qualifiers:
        return WriteRefusal(
            error_code=RULES_BRACKET_IMPOSSIBLE,
            message=f"{proposed.number_of_groups} group(s) x {proposed.qualifiers_per_group} qualifier(s) is {qualifiers}, "
            f"which is not a power of two between 2 and {MAX_QUALIFIERS}; a knockout bracket has no shape for it",
        )

    # No shoot-out can break it: a composed forfeit discards one, so a level award leaves
    # `app/api/spiele/services.py :: _outcome_of` advancing nobody. Only the step that pairs the two
    # is refused (`docs/backend/spec.md :: I44`).
    if _forfeit_draws_a_knockout(proposed) and (stored is None or not _forfeit_draws_a_knockout(stored)):
        return WriteRefusal(
            error_code=RULES_FORFEIT_DRAWS_A_KNOCKOUT,
            message=f"a no-show would be awarded {proposed.forfeit_ergebnis.sieger_tore}:{proposed.forfeit_ergebnis.verlierer_tore} "
            "and this season plays a knockout round; a drawn forfeit leaves that round with nobody to advance",
        )

    if stored is None:
        return None

    if proposed.number_of_groups < stored.number_of_groups:
        offered = offered_gruppen(proposed.number_of_groups)
        stranded = sorted(gruppe for gruppe, held in occupancy_by_gruppe.items() if held > 0 and gruppe not in offered)
        if stranded:
            return WriteRefusal(
                error_code=RULES_GROUPS_IN_USE,
                message=f"gruppe {', '.join(stranded)} still holds teams; a season cannot stop running a group its teams are entered in",
            )

    if proposed.teams_per_group < stored.teams_per_group:
        fullest = max(occupancy_by_gruppe.values(), default=0)
        if fullest > proposed.teams_per_group:
            return WriteRefusal(
                error_code=RULES_CAPACITY_BELOW_USE,
                message=f"a group already holds {fullest} teams; teams_per_group cannot drop below the fullest group",
            )

    # Only where the patch LOWERS it, on `REQ-RULES-003`'s shape: a cap left where it stands is not
    # this edit's doing, and refusing it would bar the very edit that repairs the season.
    if proposed.max_kadergroesse < stored.max_kadergroesse and largest_squad > proposed.max_kadergroesse:
        return WriteRefusal(
            error_code=RULES_KADER_BELOW_USE,
            message=f"a squad already holds {largest_squad} players; max_kadergroesse cannot drop below the largest squad the season holds",
        )

    # Only where the patch LOWERS it: `rules` is required, so a dates-only edit resubmits a count
    # already under the wiring, and refusing that would leave the season unpatchable
    # (`docs/backend/spec.md :: I44`).
    if proposed.qualifiers_per_group < highest_wired_platz and proposed.qualifiers_per_group < stored.qualifiers_per_group:
        return WriteRefusal(
            error_code=RULES_QUALIFIERS_BELOW_WIRING,
            message=f"a bracket slot names platz {highest_wired_platz}; qualifiers_per_group cannot drop below a placing already wired",
        )

    # Last, being the only check computing the whole schedule. EVERY phase: lowering the qualifier
    # count shortens the ladder, so an unreached phase expects 0 while its matchdays keep fixtures.
    for phase, attached in sorted((attached_by_phase or {}).items()):
        expected = expected_matches(proposed, phase)
        # Only where the step NARROWS the phase: a count nothing changed is not this edit's doing,
        # and refusing it would leave the season unpatchable (`docs/backend/spec.md :: I44`).
        if attached > expected and expected < expected_matches(stored, phase):
            return WriteRefusal(
                error_code=RULES_MATCHDAY_OVER_ITS_PHASE,
                message=f"a {phase} matchday holds {attached} fixtures and these rules account for {expected}; "
                "the count follows from the rules, so lowering them would strand fixtures",
            )

    return None


SAISON_SPAN_BELOW_SPIELTAGE = "REQ-DATE-004"
# DERIVED, never an arbitrary floor: no two matchdays share a day. A one-day MATCHDAY stays legal.
SAISON_SPAN_BELOW_SCHEDULE = "REQ-DATE-005"


def find_saison_span_refusal(
    *,
    start_date: str,
    end_date: str,
    rules: FLSaisonRules,
    spieltag_spans: Sequence[tuple[str, str]],
) -> WriteRefusal | None:
    """Why this season's span must be refused, or `None`.

    `spieltag_spans` is every matchday of the season, as `(beginn, ende)`: a span the season no
    longer covers strands the matchday, so the repair is that matchday's dates or the rules.
    """

    # Inclusive: a season running 2026-05-01 to 2026-05-01 offers one day, not zero.
    offered_days = (date.fromisoformat(end_date) - date.fromisoformat(start_date)).days + 1
    required_days = sum(entry.matchdays for entry in schedule_for(rules))
    if offered_days < required_days:
        return WriteRefusal(
            error_code=SAISON_SPAN_BELOW_SCHEDULE,
            message=f"the season runs {start_date} to {end_date}, which is {offered_days} day(s), and these rules "
            f"imply {required_days} matchday(s); two matchdays cannot share a day",
        )

    outside = sorted(span for span in spieltag_spans if span[0] < start_date or span[1] > end_date)
    if outside:
        return WriteRefusal(
            error_code=SAISON_SPAN_BELOW_SPIELTAGE,
            message=f"{len(outside)} of the season's matchdays fall outside {start_date} to {end_date} "
            f"(first: {outside[0][0]} to {outside[0][1]}); widen the span or move those matchdays",
        )

    return None


# Activating demotes the incumbent to `past`, whose rules then freeze (`REQ-RULES-005`).
ACTIVATE_SAISON_UNFINISHED = "REQ-ACTIVATE-001"

# No escape, and no demotion endpoint beside it: both keep the state reachable, and this is the one
# operation that can reopen a finished season's points, groups and table. A season closed by mistake
# is repaired at the database.
ACTIVATE_TARGET_PAST = "REQ-ACTIVATE-002"

# The refusal is also the log line, and a season's worth of numbers in it buries the message.
_NAMED_UNPLAYED = 5


def unplayed_spiel_nrs(spiele: Iterable[FLSpiel]) -> list[int]:
    """The fixture numbers of every match still waiting to be played, in order.

    Unplayed means NO RESULT and NOT CANCELLED; one with no occupants counts too, an open bracket
    slot being as unfinished as an unscored match.
    """

    # An ABANDONED fixture with no result still owes one, because a replay may follow; the two
    # states that award nothing owe nothing.
    return sorted(spiel.spiel_nr for spiel in spiele if spiel.ergebnis is None and spiel.sonderereignis not in SONDEREREIGNIS_WITHOUT_A_RESULT)


def find_activation_refusal(*, target_status: str, outgoing_unplayed: Sequence[int]) -> WriteRefusal | None:
    """Why this rollover must be refused, or `None`.

    `target_status` is the status of the season being promoted, and `outgoing_unplayed` is empty
    where there is no incumbent. The outgoing set excludes the target, so a season is never blocked
    by its own.
    """

    # The target first: an incumbent an admin can go and finish is beside the point where the season
    # they are promoting may not be promoted at all.
    if target_status == "past":
        return WriteRefusal(
            error_code=ACTIVATE_TARGET_PAST,
            message="the target season is past, and its points, its groups and the table derived from them are the "
            "record of what happened; activating it would reopen all three",
        )

    if not outgoing_unplayed:
        return None

    named = ", ".join(str(nr) for nr in outgoing_unplayed[:_NAMED_UNPLAYED])
    rest = f" and {len(outgoing_unplayed) - _NAMED_UNPLAYED} more" if len(outgoing_unplayed) > _NAMED_UNPLAYED else ""

    return WriteRefusal(
        error_code=ACTIVATE_SAISON_UNFINISHED,
        message=f"the outgoing season has {len(outgoing_unplayed)} unplayed fixtures (spiel_nr {named}{rest}); "
        "enter their results or cancel them before closing the season",
    )
