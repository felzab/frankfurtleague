from datetime import date
from typing import Any, Iterable, Mapping, Sequence

from app.api.saisons.schedule import expected_matches, knockout_phases_for, schedule_for
from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.schemas import MAX_QUALIFIERS, FLSaisonPhase, FLSpiel
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

# `erlaubte_stufen` stays editable because it bounds what a form offers, never what a stored squad
# row holds.
FROZEN_RULES_FIELDS: tuple[str, ...] = ("win_points", "draw_points", "qualifiers_per_group")


def find_rules_refusal(
    *,
    saison_status: str,
    stored: FLSaisonRules | None,
    proposed: FLSaisonRules,
    occupancy_by_gruppe: dict[FLGruppenNames, int],
    highest_wired_platz: int,
    attached_by_phase: Mapping[FLSaisonPhase, int] | None = None,
) -> WriteRefusal | None:
    """Why these rules must be refused, or `None`.

    `stored` is `None` on a create, where only the rules reading the payload alone apply.
    `attached_by_phase` is the LARGEST count any single matchday of a phase holds, not the sum.
    """

    # The freeze first: no point naming a bound when the whole edit is refused anyway.
    if stored is not None and saison_status == "past":
        changed = [field for field in FROZEN_RULES_FIELDS if getattr(stored, field) != getattr(proposed, field)]
        if changed:
            return WriteRefusal(
                error_code=RULES_SAISON_FINISHED,
                message=f"season is past; {', '.join(changed)} cannot change because the league table is scored from rules on every read",
            )

    # Before the bracket rule, being narrower: it names two fields an admin can compare, where the
    # bracket's answer is a property of their product.
    if proposed.qualifiers_per_group > proposed.teams_per_group:
        return WriteRefusal(
            error_code=RULES_QUALIFIERS_ABOVE_GROUP,
            message=f"{proposed.qualifiers_per_group} qualifier(s) per group from groups of {proposed.teams_per_group}; "
            "a group cannot send more teams into the bracket than it holds",
        )

    # The bracket next: a property of the proposed rules alone, needing no stored data.
    qualifiers = proposed.number_of_groups * proposed.qualifiers_per_group
    if not knockout_phases_for(qualifiers):
        return WriteRefusal(
            error_code=RULES_BRACKET_IMPOSSIBLE,
            message=f"{proposed.number_of_groups} group(s) x {proposed.qualifiers_per_group} qualifier(s) is {qualifiers}, "
            f"which is not a power of two between 2 and {MAX_QUALIFIERS}; a knockout bracket has no shape for it",
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

    if proposed.qualifiers_per_group < highest_wired_platz:
        return WriteRefusal(
            error_code=RULES_QUALIFIERS_BELOW_WIRING,
            message=f"a bracket slot names platz {highest_wired_platz}; qualifiers_per_group cannot drop below a placing already wired",
        )

    # Last, being the only check computing the whole schedule. EVERY phase: lowering the qualifier
    # count shortens the ladder, so an unreached phase expects 0 while its matchdays keep fixtures.
    for phase, attached in sorted((attached_by_phase or {}).items()):
        expected = expected_matches(proposed, phase)
        if attached > expected:
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

    `spieltag_spans` is each LIVE matchday's `(beginn, ende)`; excluding retired ones is the
    caller's, retirement being how a mis-dated matchday leaves the schedule.
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

# The refusal is also the log line, and a season's worth of numbers in it buries the message.
_NAMED_UNPLAYED = 5


def unplayed_spiel_nrs(spiele: Iterable[FLSpiel]) -> list[int]:
    """The fixture numbers of every match still waiting to be played, in order.

    Unplayed means NO RESULT and NOT CANCELLED; one with no occupants counts too, an open bracket
    slot being as unfinished as an unscored match.
    """

    return sorted(spiel.spiel_nr for spiel in spiele if spiel.ergebnis is None and not spiel.is_canceled)


def find_activation_refusal(*, outgoing_unplayed: Sequence[int]) -> WriteRefusal | None:
    """Why this rollover must be refused, or `None`.

    `outgoing_unplayed` is empty where there is no incumbent. The outgoing set excludes the target,
    so a season is never blocked by its own fixtures.
    """

    if not outgoing_unplayed:
        return None

    named = ", ".join(str(nr) for nr in outgoing_unplayed[:_NAMED_UNPLAYED])
    rest = f" and {len(outgoing_unplayed) - _NAMED_UNPLAYED} more" if len(outgoing_unplayed) > _NAMED_UNPLAYED else ""

    return WriteRefusal(
        error_code=ACTIVATE_SAISON_UNFINISHED,
        message=f"the outgoing season has {len(outgoing_unplayed)} unplayed fixtures (spiel_nr {named}{rest}); "
        "enter their results or cancel them before closing the season",
    )
