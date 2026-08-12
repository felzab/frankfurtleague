"""
SAISONS · filter construction, the derived schedule, and what a season write refuses

Pure throughout — no I/O — so every refusal rule is testable without a database. The
`build_saisons_*` helpers translate `FLSaisonsFilterOptions` into a Mongo filter and sort;
everything below them decides whether a season write is one the competition can hold.

Invariants:
- An edit that would strand existing data is refused at the write (decided 2026-08-07).
- A finished season's competitive rules are frozen — only the dates stay editable (decided 2026-08-07).
- `MAX_QUALIFIERS` is `2 ** len(KNOCKOUT_PHASES)`: the rule widens by adding a phase (ADR-0052).
- A refusal returns `(error_code, detail)` and never raises — the caller owns the status code.
- The checks run in the order an admin can act on them, like `find_entry_refusal`.

See:
- docs/domain.md — the editability matrix these rules implement
"""

from typing import Any, Iterable, Mapping, Sequence

from app.api.saisons.schedule import expected_matches, knockout_phases_for, schedule_for
from app.api.saisons.schemas import FLSaisonRules, FLSaisonsFilterOptions
from app.api.spiele.schemas import MAX_QUALIFIERS, FLSaisonPhase, FLSpiel
from app.api.teams.schemas import FLGruppenNames
from app.api.teams.services import offered_gruppen


def with_schedule(saison_raw: Mapping[str, Any]) -> dict[str, Any]:
    """
    Attaches a season's derived `schedule` before validation.

    Injected into the raw document rather than computed on the model, for the reason `FLSaison.schedule`
    gives: `schedule_for` imports `FLSaisonRules` from that module, so a computed field there would close
    an import cycle. The shape is the same one `app/api/spieltage/services.py :: with_expected_matches` uses
    for a matchday's count, and for the same reason -- the field is REQUIRED on the model, so a document
    reaching validation without it is a 500 rather than a silently absent key.

    **Every path that answers with an `FLSaison` goes through this**, which is what
    `fl_backend/tests/api/test_schedule.py :: TestTheSeasonCarriesItsSchedule` holds it to.
    """

    return {**saison_raw, "schedule": [entry.__dict__ for entry in schedule_for(FLSaisonRules.model_validate(saison_raw["rules"]))]}


def build_saisons_sort(sort_by: str, order: str) -> list[tuple[str, int]]:
    direction = 1 if order == "asc" else -1

    return [(sort_by, direction)]


def build_saisons_filter(filters: FLSaisonsFilterOptions) -> dict[str, Any]:
    query = filters.model_dump(include={"status"}, exclude_none=True, by_alias=True)

    return query


# `number_of_groups x qualifiers_per_group` is not a power of two, or exceeds what the phase set
# holds. A knockout ladder halves down to one final, so twelve qualifiers cannot be paired to a
# winner and thirty-two have no round to play.
RULES_BRACKET_IMPOSSIBLE = "REQ-RULES-001"

# `number_of_groups` would drop below a group that still holds teams, leaving those rows naming a
# group the season does not run -- the state `REQ-ENTER-002` prevents from the other direction.
RULES_GROUPS_IN_USE = "REQ-RULES-002"

# `teams_per_group` would drop below the fullest group's occupancy, leaving a group over a capacity no
# entry was ever refused against.
RULES_CAPACITY_BELOW_USE = "REQ-RULES-003"

# `qualifiers_per_group` would drop below the highest placing a bracket slot names, leaving it
# referencing a placing its group cannot produce. The resolution reports that as a bracket fault
# (ADR-0039), but to whoever opens triage rather than the cause.
RULES_QUALIFIERS_BELOW_WIRING = "REQ-RULES-004"

# A `past` season's competitive rules. Frozen because the table is derived: editing them rewrites a
# finished competition's result and nothing records the previous one.
RULES_SAISON_FINISHED = "REQ-RULES-005"

# `qualifiers_per_group` exceeds `teams_per_group` (decided 2026-08-08). A group of four cannot supply
# six qualifiers, so the seeding walk asks for a placing no standing will hold -- what
# `REQ-RULES-004` refuses from the other direction.
RULES_QUALIFIERS_ABOVE_GROUP = "REQ-RULES-007"

# The narrowing would leave a matchday holding more fixtures than its phase accounts for (decided
# 2026-08-08). The expected count derives from these rules (ADR-0052), and a matchday over it is a
# state no season setup passes through, unlike being under.
RULES_MATCHDAY_OVER_ITS_PHASE = "REQ-RULES-006"

# The three fields a finished season freezes. The dates stay editable, and so does `erlaubte_stufen`,
# which bounds what a form offers and never what a stored squad row holds (ADR-0048).
FROZEN_RULES_FIELDS: tuple[str, ...] = ("win_points", "draw_points", "qualifiers_per_group")


def find_rules_refusal(
    *,
    saison_status: str,
    stored: FLSaisonRules | None,
    proposed: FLSaisonRules,
    occupancy_by_gruppe: dict[FLGruppenNames, int],
    highest_wired_platz: int,
    attached_by_phase: Mapping[FLSaisonPhase, int] | None = None,
) -> tuple[str, str] | None:
    """
    Why these rules must be refused, as `(error_code, detail)` -- or `None`.

    `stored` is `None` on a create, where there is nothing to strand and nothing frozen: only the rules
    that read the proposed payload alone apply. `occupancy_by_gruppe` counts `saison_teams` rows per group, disqualified rows included,
    because a team never leaves a season (ADR-0026) and its place stays taken. `highest_wired_platz` is
    the largest `platz` any of the season's bracket slots names, or 0 where none does.

    `attached_by_phase` is the LARGEST fixture count any single matchday of each phase already holds --
    the maximum rather than the sum, because the expected count is per matchday. `None` on a create,
    where the season has no matchdays yet.
    """

    # A season that is over freezes first: there is no point telling an admin their group count strands a
    # team when the whole edit is refused anyway.
    if stored is not None and saison_status == "past":
        changed = [field for field in FROZEN_RULES_FIELDS if getattr(stored, field) != getattr(proposed, field)]
        if changed:
            return (
                RULES_SAISON_FINISHED,
                f"season is past; {', '.join(changed)} cannot change because the league table is scored from rules on every read",
            )

    # Before the bracket rule, because it is the narrower statement: it names two fields an admin can
    # compare, where the bracket's answer is a property of their product.
    if proposed.qualifiers_per_group > proposed.teams_per_group:
        return (
            RULES_QUALIFIERS_ABOVE_GROUP,
            f"{proposed.qualifiers_per_group} qualifier(s) per group from groups of {proposed.teams_per_group}; "
            "a group cannot send more teams into the bracket than it holds",
        )

    # The bracket next, because it is a property of the proposed rules alone and needs no stored data.
    qualifiers = proposed.number_of_groups * proposed.qualifiers_per_group
    if not knockout_phases_for(qualifiers):
        return (
            RULES_BRACKET_IMPOSSIBLE,
            f"{proposed.number_of_groups} group(s) x {proposed.qualifiers_per_group} qualifier(s) is {qualifiers}, "
            f"which is not a power of two between 2 and {MAX_QUALIFIERS}; a knockout bracket has no shape for it",
        )

    if stored is None:
        return None

    if proposed.number_of_groups < stored.number_of_groups:
        offered = offered_gruppen(proposed.number_of_groups)
        stranded = sorted(gruppe for gruppe, held in occupancy_by_gruppe.items() if held > 0 and gruppe not in offered)
        if stranded:
            return (
                RULES_GROUPS_IN_USE,
                f"gruppe {', '.join(stranded)} still holds teams; a season cannot stop running a group its teams are entered in",
            )

    if proposed.teams_per_group < stored.teams_per_group:
        fullest = max(occupancy_by_gruppe.values(), default=0)
        if fullest > proposed.teams_per_group:
            return (
                RULES_CAPACITY_BELOW_USE,
                f"a group already holds {fullest} teams; teams_per_group cannot drop below the fullest group",
            )

    if proposed.qualifiers_per_group < highest_wired_platz:
        return (
            RULES_QUALIFIERS_BELOW_WIRING,
            f"a bracket slot names platz {highest_wired_platz}; qualifiers_per_group cannot drop below a placing already wired",
        )

    # Last, because it is the only check that computes the whole schedule. Every phase, not just the
    # group phase: lowering the qualifier count shortens the knockout ladder, so an unreached phase
    # expects 0 while its matchdays keep their fixtures.
    for phase, attached in sorted((attached_by_phase or {}).items()):
        expected = expected_matches(proposed, phase)
        if attached > expected:
            return (
                RULES_MATCHDAY_OVER_ITS_PHASE,
                f"a {phase} matchday holds {attached} fixtures and these rules account for {expected}; "
                "the count follows from the rules, so lowering them would strand fixtures",
            )

    return None


# The season's span would stop covering one of its own matchdays (decided 2026-08-08).
# `REQ-DATE-002` refuses a matchday reaching outside its season; this closes the same state from the
# container's side, as `REQ-DATE-001` pairs with `REQ-DATE-003`.
SAISON_SPAN_BELOW_SPIELTAGE = "REQ-DATE-004"


def find_saison_span_refusal(
    *,
    start_date: str,
    end_date: str,
    spieltag_spans: Sequence[tuple[str, str]],
) -> tuple[str, str] | None:
    """
    Why this season's span must be refused, as `(error_code, detail)` -- or `None`.

    `spieltag_spans` is each LIVE matchday's `(beginn, ende)`. Retired matchdays are the caller's to
    exclude: retiring is how a mis-dated matchday is taken out of the schedule, so one blocking the
    repair of the very dates it was retired over would leave the season uneditable.
    """

    outside = sorted(span for span in spieltag_spans if span[0] < start_date or span[1] > end_date)
    if outside:
        return (
            SAISON_SPAN_BELOW_SPIELTAGE,
            f"{len(outside)} of the season's matchdays fall outside {start_date} to {end_date} "
            f"(first: {outside[0][0]} to {outside[0][1]}); widen the span or move those matchdays",
        )

    return None


# The outgoing season still has fixtures nobody has played (decided 2026-08-08). Activating demotes
# the incumbent to `past`, whose rules freeze (REQ-RULES-005) -- so a rollover over unplayed fixtures
# closes a competition that is not finished.
ACTIVATE_SAISON_UNFINISHED = "REQ-ACTIVATE-001"

# How many `spiel_nr` values a refusal names before it stops counting. The panel lists them all; this is
# the log line, and a season's worth of numbers in it buries the rest of the message.
_NAMED_UNPLAYED = 5


def unplayed_spiel_nrs(spiele: Iterable[FLSpiel]) -> list[int]:
    """
    The fixture numbers of every match still waiting to be played, in order.

    Unplayed means **no result and not cancelled**. Cancelling is what makes a fixture nobody will ever
    play into a settled one, which is the route past the refusal below -- and a cancelled match that DOES
    carry a result still counts for the league table (docs/glossary.md), so it is settled either way.

    A fixture with no occupants yet counts as unplayed. That is a bracket slot the group phase never
    filled, and a season leaving one open is exactly as unfinished as one leaving a match unscored.
    """

    return sorted(spiel.spiel_nr for spiel in spiele if spiel.ergebnis is None and not spiel.is_canceled)


def find_activation_refusal(*, outgoing_unplayed: Sequence[int]) -> tuple[str, str] | None:
    """
    Why this rollover must be refused, as `(error_code, detail)` -- or `None`.

    `outgoing_unplayed` is `unplayed_spiel_nrs` over the fixtures of the season currently holding
    `active`, empty where there is no incumbent at all -- the first rollover of a fresh database, which
    nothing blocks.

    Re-activating the season that already holds `active` is a no-op the endpoint reports as such
    (`deactivated: 0`), and the endpoint skips this rule for it entirely -- the outgoing set excludes
    the target, so a season is never its own incumbent and never blocked by its own fixtures.
    """

    if not outgoing_unplayed:
        return None

    named = ", ".join(str(nr) for nr in outgoing_unplayed[:_NAMED_UNPLAYED])
    rest = f" and {len(outgoing_unplayed) - _NAMED_UNPLAYED} more" if len(outgoing_unplayed) > _NAMED_UNPLAYED else ""

    return (
        ACTIVATE_SAISON_UNFINISHED,
        f"the outgoing season has {len(outgoing_unplayed)} unplayed fixtures (spiel_nr {named}{rest}); "
        "enter their results or cancel them before closing the season",
    )
