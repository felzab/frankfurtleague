from dataclasses import dataclass

from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.schemas import KNOCKOUT_PHASES, MAX_QUALIFIERS
from app.shared.schemas.literals import FLSaisonPhase


@dataclass(frozen=True)
class PhaseSchedule:
    """One phase of a season: how many matchdays it takes and how many matches each one holds."""

    phase: FLSaisonPhase
    spieltage: int
    matches_per_spieltag: int


def group_matchdays(teams_per_gruppe: int) -> int:
    """How many matchdays a single round robin of `teams_per_gruppe` teams takes.

    `n - 1` for an even n and `n` for an odd one; the odd case is not rounding, but the bye a round
    that cannot pair everyone leaves.
    """

    if teams_per_gruppe < 2:
        return 0
    return teams_per_gruppe - 1 if teams_per_gruppe % 2 == 0 else teams_per_gruppe


def group_matches_per_matchday(number_of_gruppen: int, teams_per_gruppe: int) -> int:
    """How many matches one group matchday holds, across every group.

    `teams_per_group // 2` per group: an odd group pairs all but the team on its bye, and all groups
    play on the same matchday.
    """

    return number_of_gruppen * (teams_per_gruppe // 2)


def total_group_matches(number_of_gruppen: int, teams_per_gruppe: int) -> int:
    """Every group-phase match: `C(n, 2)` per group.

    From the combination, not matchdays x matches-per-matchday: the two agree by a cancellation,
    where the combination says the number outright.
    """

    if teams_per_gruppe < 2:
        return 0
    return number_of_gruppen * (teams_per_gruppe * (teams_per_gruppe - 1) // 2)


def qualifier_count(rules: FLSaisonRules) -> int:
    """How many teams reach the bracket."""

    return rules.number_of_gruppen * rules.qualifiers_per_gruppe


def knockout_phases_for(qualifiers: int) -> tuple[FLSaisonPhase, ...]:
    """The rounds a bracket of `qualifiers` teams plays, in playing order.

    Read from the END of `KNOCKOUT_PHASES`, which lets a phase be added at the wide end without
    renaming a round anybody plays. Empty for anything not a power of two in range.
    """

    if qualifiers < 2 or qualifiers > MAX_QUALIFIERS or qualifiers & (qualifiers - 1) != 0:
        return ()

    rounds = qualifiers.bit_length() - 1
    return KNOCKOUT_PHASES[-rounds:]


def schedule_for(rules: FLSaisonRules) -> tuple[PhaseSchedule, ...]:
    """The whole season, phase by phase, in playing order.

    A rules combination with no bracket contributes no knockout phases rather than raising.
    """

    schedule = [
        PhaseSchedule(
            phase="gruppenphase",
            spieltage=group_matchdays(rules.teams_per_gruppe),
            matches_per_spieltag=group_matches_per_matchday(rules.number_of_gruppen, rules.teams_per_gruppe),
        )
    ]

    remaining = qualifier_count(rules)
    for phase in knockout_phases_for(remaining):
        schedule.append(PhaseSchedule(phase=phase, spieltage=1, matches_per_spieltag=remaining // 2))
        remaining //= 2

    return tuple(schedule)


def expected_matches(rules: FLSaisonRules, phase: FLSaisonPhase) -> int:
    """How many matches one matchday of this phase should hold -- `spieltage.count_spiele`.

    Zero for a knockout round this season's bracket does not reach.
    """

    for entry in schedule_for(rules):
        if entry.phase == phase:
            return entry.matches_per_spieltag
    return 0
