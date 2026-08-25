from datetime import date
from typing import Any, Iterable, Mapping, Sequence

from app.api.saisons.schedule import expected_matches, knockout_phases_for, qualifier_count, schedule_for
from app.api.saisons.schemas import FLSaisonRules, FLSaisonStatus
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


# A season still being drawn up is the base tier's to know nothing about, its very existence included.
WITHHELD_FROM_BASE_TIER: FLSaisonStatus = "future"


def base_tier_status_term(requested: FLSaisonStatus | None = None) -> dict[str, Any]:
    """The `status` term every base-tier season read runs; `requested` is the caller's own filter.

    NARROWED, never fetched then hidden: a withheld season matches nothing, so `DB-COMMON-001`'s 404
    stays true and no 403 confirms the season exists.
    """

    if requested is None:
        return {"status": {"$ne": WITHHELD_FROM_BASE_TIER}}

    # Both operators: an explicit `?status=future` then matches nothing, rather than the narrowing
    # being overwritten by the term the caller asked for.
    return {"status": {"$eq": requested, "$ne": WITHHELD_FROM_BASE_TIER}}


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

# The one of the three a REDRAW moves. `REQ-SPIELPLAN-004` asks every offered group for exactly
# `teams_per_group`, so a redraw carrying either of the others is refused for the groups then off
# their size; qualifiers touch no group's occupancy at all.
REDRAWABLE_SHAPE_FIELD = "qualifiers_per_group"


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

    # ABSOLUTE, in every status and whatever is recorded: the shape and the fixtures drawn from it
    # are one fact, so this path never moves half of it. The whole of it moves on the draw, which
    # takes the three numbers on its own payload.
    if stored is not None and drawn_fixtures > 0:
        redrawn = [field for field in SHAPE_RULES_FIELDS if getattr(stored, field) != getattr(proposed, field)]
        if redrawn:
            # Per field, the two repairs being different jobs: raising a pinned one needs clubs
            # entered between the removal and the draw, and lowering one is refused by
            # `REQ-RULES-002` or `REQ-RULES-003` while the clubs stand, withdrawn or not.
            pinned = [field for field in redrawn if field != REDRAWABLE_SHAPE_FIELD]

            repairs: list[str] = []
            if REDRAWABLE_SHAPE_FIELD in redrawn:
                repairs.append(f"to move {REDRAWABLE_SHAPE_FIELD}, draw the Spielplan again with the new number")
            if pinned:
                repairs.append(
                    f"the clubs entered fix {' and '.join(pinned)}, so undraw the Spielplan, change the entries, then draw the Spielplan again"
                )

            return WriteRefusal(
                error_code=RULES_SHAPE_AFTER_DRAW,
                message=f"the season's {drawn_fixtures} fixtures are already drawn from these rules; {'; '.join(repairs)}",
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

    `spieltag_spans` is every DATED matchday of the season, as `(beginn, ende)`: a span the season no
    longer covers strands the matchday, and one still undated constrains nothing, so the caller filters.
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
# The pair to `REQ-SPIELPLAN-003`: that one lets a running season still be drawn, and this one keeps
# a season from going live undrawn in the first place.
ACTIVATE_TARGET_UNDRAWN = "REQ-ACTIVATE-003"

# The refusal is also the log line, and a season's worth of numbers in it buries the message.
_NAMED_UNPLAYED = 5


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
    "elfmeterschiessen",
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

    A group fixture is drawn OCCUPIED and unwired, a bracket fixture WIRED and empty, so any other
    pairing is an edit: a hand-picked slot, a cleared quelle, an emptied side.
    """

    # A document with no `saison_phase` reads as a bracket, so every group fixture then counts as
    # recorded: the projection always carries the key, and a missing one must refuse rather than
    # widen the window it decides.
    is_bracket = spiel.get("saison_phase") != DRAWN_HOLDING_ITS_SIDES

    for slot in ("team1", "team2"):
        occupied = (spiel.get(slot) or {}).get("team_id") is not None
        wired = spiel.get(f"{slot}_quelle") is not None

        # Both directions in ONE comparison against the phase: "holds a side" alone is true of every
        # group fixture the draw wrote, and would shut the window on every drawn season.
        if (occupied, wired) != (not is_bracket, is_bracket):
            return True

    return False


def holds_a_recorded_fact(spiel: Mapping[str, Any]) -> bool:
    """Whether anything has been entered against this fixture since the draw wrote it.

    Wider than `has_taken_place`: the window is nothing recorded, so a called-off fixture, a booked
    one, a noted one and one whose sides moved all close it. A date does not.
    """

    if spiel.get("ergebnis") is not None or spiel.get("sonderereignis") is not None:
        return True

    # Beside `ergebnis` rather than behind it: `apply_payload_to_spiel` keeps a shoot-out only where
    # it stores a result too, so one standing alone is a hand edit -- which is the same route the
    # goals below and the note further down are read for.
    if spiel.get("elfmeterschiessen") is not None:
        return True

    if any((spiel.get(slot) or {}).get("tore") is not None for slot in ("team1", "team2")):
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

    # An ABANDONED fixture with no result still owes one, because a replay may follow; the two
    # states that award nothing owe nothing.
    return sorted(spiel.spiel_nr for spiel in spiele if spiel.ergebnis is None and spiel.sonderereignis not in SONDEREREIGNIS_WITHOUT_A_RESULT)


def find_activation_refusal(*, target_status: str, target_fixtures: int, outgoing_unplayed: Sequence[int]) -> WriteRefusal | None:
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

    if target_fixtures == 0:
        return WriteRefusal(
            error_code=ACTIVATE_TARGET_UNDRAWN,
            message="the target season has no fixtures; draw its Spielplan first, or the league goes live with nothing to play",
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


# What each code below refuses is `docs/logging/error-codes.md`.
SPIELPLAN_ALREADY_DRAWN = "REQ-SPIELPLAN-001"
SPIELPLAN_MATCHDAYS_HELD = "REQ-SPIELPLAN-002"
SPIELPLAN_SAISON_FINISHED = "REQ-SPIELPLAN-003"
# One code, because one repair reaches all three: every offered group holding exactly
# `teams_per_group`, short or over, and no club standing outside them.
SPIELPLAN_GRUPPEN_OFF_RULES = "REQ-SPIELPLAN-004"

# ONE code for both halves of the window a confirmed replace runs in -- `future`, and nothing played
# -- because neither names work an admin can go and do: `status` moves one way, and a played result
# is the record.
SPIELPLAN_REPLACE_OUTSIDE_ITS_WINDOW = "REQ-SPIELPLAN-005"


def _outside_the_planning_window(*, saison_status: str, recorded_fixtures: int) -> str:
    """The window's second half in words, for the replace and the undraw alike.

    Spelled ONCE: the sentence enumerates what `holds_a_recorded_fact` counts, and two copies of it
    disagree the moment that predicate weighs one more field.
    """

    return (
        f"and this one is {saison_status} and holds {recorded_fixtures} fixture(s) carrying a result, a cancellation, a booking, "
        "a note or a side moved off the draw; it runs only on a planned season with nothing entered against it"
    )


def find_spielplan_refusal(
    *,
    saison_status: str,
    fixtures_drawn: int,
    spieltage_held: int,
    watermark: Mapping[str, Any] | None,
    rules: FLSaisonRules,
    occupancy_by_gruppe: Mapping[FLGruppenNames, int],
    # NEITHER defaults: a caller that forgot `recorded_fixtures` would replace a season already played.
    replace: bool,
    recorded_fixtures: int,
) -> WriteRefusal | None:
    """Why drawing this season's Spielplan must be refused, or `None`.

    Each refuses on its own, so the order decides only which one an admin reads: what no group
    filling repairs first, because `REQ-SPIELPLAN-004` alone names work an admin can go and do.
    """

    # `REQ-SPIELPLAN-005`'s window, named here because `REQ-SPIELPLAN-001` is judged FIRST and would
    # otherwise offer a replace this refuses, sending an admin who confirms into a second 409.
    replace_is_offered = saison_status == "future" and recorded_fixtures == 0

    # What a confirmed replace is about to delete is no reason to turn it away, so `REQ-SPIELPLAN-001`
    # and `REQ-SPIELPLAN-002` step aside for one. `REQ-SPIELPLAN-005` below is what bounds it instead.
    if fixtures_drawn > 0 and not replace:
        # The FIXTURES are the guard, never the watermark: a draw written outside this endpoint
        # carries none, and offering to draw over one is the single thing this must not do.
        held = (
            f"generated on {watermark['generiert_am']}, {watermark['spiele']} fixtures across {watermark['spieltage']} matchdays"
            if watermark is not None
            else f"{fixtures_drawn} fixtures this endpoint did not write"
        )

        remedy = (
            "drawing again would replace it, and a replace is confirmed"
            if replace_is_offered
            else "no replace can remove it: that runs only on a planned season with nothing entered against it"
        )

        return WriteRefusal(
            error_code=SPIELPLAN_ALREADY_DRAWN,
            message=f"the season already holds a Spielplan ({held}); {remedy}",
        )

    if spieltage_held > 0 and not replace:
        return WriteRefusal(
            error_code=SPIELPLAN_MATCHDAYS_HELD,
            message=f"the season already holds {spieltage_held} matchday(s); the draw writes the whole list at once and merges with none",
        )

    # Whether the season holds anything to delete or not: the flag is the operation the caller asked
    # for, and one flag meaning a replace here and a first draw there is the ambiguity this closes.
    if replace and not replace_is_offered:
        return WriteRefusal(
            error_code=SPIELPLAN_REPLACE_OUTSIDE_ITS_WINDOW,
            message="a replace deletes every matchday and fixture the season holds, "
            + _outside_the_planning_window(saison_status=saison_status, recorded_fixtures=recorded_fixtures),
        )

    # `past` alone, never `future`-only: activation is one-way, so a season activated before its draw
    # would otherwise be unschedulable for good, and `REQ-ACTIVATE-003` keeps the state rare. A
    # REPLACE is `future`-only, above.
    if saison_status == "past":
        return WriteRefusal(
            error_code=SPIELPLAN_SAISON_FINISHED,
            message=f"season is {saison_status}; its table is the record of what happened, and a draw would reopen it",
        )

    offered = offered_gruppen(rules.number_of_groups)

    # Rows carrying an `austritt` count as occupying, exactly as `find_entry_refusal` counts them: a
    # club that withdrew before the draw keeps its place, and the group is still the size it owes.
    off_size = [
        f"gruppe {gruppe} holds {occupancy_by_gruppe.get(gruppe, 0)} of {rules.teams_per_group}"
        for gruppe in offered
        if occupancy_by_gruppe.get(gruppe, 0) != rules.teams_per_group
    ]

    # A key outside `offered` is clubs the draw would put in no round robin at all. `_squads` raises
    # on these states too, as its own contract against a caller that skipped this rule; the endpoint
    # is where they become an answer an admin can act on.
    off_size += [
        f"gruppe {gruppe} holds {held} and a season of {rules.number_of_groups} group(s) does not offer it"
        for gruppe, held in sorted(occupancy_by_gruppe.items())
        if held > 0 and gruppe not in offered
    ]

    if off_size:
        return WriteRefusal(
            error_code=SPIELPLAN_GRUPPEN_OFF_RULES,
            message=f"{', '.join(off_size)}; every group plays the same round robin, so a group off its size draws a different "
            "number of fixtures and a club outside the offered groups draws none",
        )

    return None


# A code of its own, never `REQ-SPIELPLAN-005`'s: a rule resolves to ONE `implemented_by`, and that
# one already names `find_spielplan_refusal`.
SPIELPLAN_UNDRAW_OUTSIDE_ITS_WINDOW = "REQ-SPIELPLAN-006"


def find_undraw_refusal(*, saison_status: str, recorded_fixtures: int) -> WriteRefusal | None:
    """Why removing this season's Spielplan must be refused, or `None`.

    The replace's window, read off the OPERATION and not off what there is to remove: a season
    already undrawn is the state asked for, so it removes nothing rather than refusing.
    """

    if saison_status == "future" and recorded_fixtures == 0:
        return None

    return WriteRefusal(
        error_code=SPIELPLAN_UNDRAW_OUTSIDE_ITS_WINDOW,
        message="removing a Spielplan deletes every matchday and fixture the season holds, "
        + _outside_the_planning_window(saison_status=saison_status, recorded_fixtures=recorded_fixtures),
    )
