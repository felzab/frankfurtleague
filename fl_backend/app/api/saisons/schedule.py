"""
SAISONS · the schedule a season's rules imply

Pure arithmetic over `FLSaisonRules`. No I/O, no documents, no season needed -- given the rules, this
module says how many matchdays the competition has, which phase each is in, and how many matches each
one holds.

**It exists because those numbers were being entered by hand.** `spieltage.anzahl_spiele` was a stored
count of something fully determined by `number_of_groups`, `teams_per_group` and `qualifiers_per_group`,
so it could disagree with the rules that decide it and nothing reconciled the two (ADR-0065).

 THE COMPETITION ──────────────────────────────────────────────────────────────────────────────────────────

  A season is `number_of_groups` groups of `teams_per_group` teams. Each group plays a SINGLE ROUND
  ROBIN -- every team meets every other team in its group exactly once -- and all groups play on the same
  matchdays. Then `qualifiers_per_group` teams from each group enter a straight knockout bracket.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • **The group phase's matchday count is a round-robin schedule, not a division.** n teams need n-1
    rounds when n is even and n rounds when n is odd, because an odd group cannot pair everybody: one
    team sits out each round, so it takes one more round to give every team its n-1 opponents. That is
    the standard circle method and it is why this is not simply `C(n,2) / (n/2)`.
  • **A bye is a real state and is modelled rather than refused** (owner, 2026-08-07). An odd group
    happens when a club withdraws after the draw, and refusing it would block the season rather than the
    withdrawal.
  • **The bracket needs a power-of-two entry field.** Each knockout round halves, so the qualifiers must
    be 2, 4, ... up to `MAX_QUALIFIERS` -- and that ceiling is what the phase set can hold rather than a
    number chosen here. `find_rules_refusal` is what refuses the rest.
  • **The knockout rounds are the LAST k phases of `KNOCKOUT_PHASES`**, so eight qualifiers play
    quarter-final, semi-final, final and never touch `achtelfinale`. Reading from the end is what makes a
    new phase raise the ceiling without renaming any round below it.
  • Every count here is DERIVED and nothing stores one. A matchday's `anzahl_spiele` on the wire is this
    module's answer, computed per read the way the league table is (ADR-0026).

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/domain.md -- the derived-versus-stored rule this module is the largest instance of
  docs/_decisions/0065-a-seasons-schedule-is-derived-from-its-rules.md
"""

from dataclasses import dataclass

from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.schemas import KNOCKOUT_PHASES, MAX_QUALIFIERS, FLSaisonPhase


@dataclass(frozen=True)
class PhaseSchedule:
    """One phase of a season: how many matchdays it takes and how many matches each one holds."""

    phase: FLSaisonPhase
    matchdays: int
    matches_per_matchday: int


def group_matchdays(teams_per_group: int) -> int:
    """
    How many matchdays a single round robin of `teams_per_group` teams takes.

    `n - 1` for an even n and `n` for an odd one. The odd case is not a rounding artefact: with an odd
    number of teams no round can pair all of them, so one team has a bye each round and the schedule needs
    an extra round to give everybody their `n - 1` opponents.
    """

    if teams_per_group < 2:
        return 0
    return teams_per_group - 1 if teams_per_group % 2 == 0 else teams_per_group


def group_matches_per_matchday(number_of_groups: int, teams_per_group: int) -> int:
    """
    How many matches one group matchday holds, across every group.

    `teams_per_group // 2` per group: an even group pairs everybody, an odd group pairs all but the team
    on its bye. All groups play on the same matchday, so the per-group figure multiplies up.
    """

    return number_of_groups * (teams_per_group // 2)


def total_group_matches(number_of_groups: int, teams_per_group: int) -> int:
    """
    Every group-phase match: `C(n, 2)` per group.

    Stated separately from matchdays x matches-per-matchday because the two agree only for an even group.
    An ODD group's last round is short -- the schedule reserves a slot for the team on its bye -- so
    multiplying would over-count. This is the figure to trust.
    """

    if teams_per_group < 2:
        return 0
    return number_of_groups * (teams_per_group * (teams_per_group - 1) // 2)


def qualifier_count(rules: FLSaisonRules) -> int:
    """How many teams reach the bracket."""

    return rules.number_of_groups * rules.qualifiers_per_group


def knockout_phases_for(qualifiers: int) -> tuple[FLSaisonPhase, ...]:
    """
    The rounds a bracket of `qualifiers` teams plays, in playing order.

    Read from the END of `KNOCKOUT_PHASES`: eight qualifiers play the last three rounds -- quarter-final,
    semi-final, final -- rather than the first three. That is what lets a new phase be added at the wide
    end and raise the ceiling without renaming a round anybody already plays.

    Returns empty for anything that is not a power of two in range; `find_rules_refusal` is what turns
    that into a refusal, so this function stays total and answerable for any input.
    """

    if qualifiers < 2 or qualifiers > MAX_QUALIFIERS or qualifiers & (qualifiers - 1) != 0:
        return ()

    rounds = qualifiers.bit_length() - 1
    return KNOCKOUT_PHASES[-rounds:]


def schedule_for(rules: FLSaisonRules) -> tuple[PhaseSchedule, ...]:
    """
    The whole season, phase by phase, in playing order.

    The group phase first, then one matchday per knockout round with the round's own match count -- eight
    qualifiers give 4, 2, 1. A rules combination with no bracket contributes no knockout phases rather
    than raising: the season editor refuses that combination, and this module is also read by surfaces
    describing a season that was saved before the refusal existed.
    """

    schedule = [
        PhaseSchedule(
            phase="gruppenphase",
            matchdays=group_matchdays(rules.teams_per_group),
            matches_per_matchday=group_matches_per_matchday(rules.number_of_groups, rules.teams_per_group),
        )
    ]

    remaining = qualifier_count(rules)
    for phase in knockout_phases_for(remaining):
        # Each round halves the field, so its match count is half of what entered it.
        schedule.append(PhaseSchedule(phase=phase, matchdays=1, matches_per_matchday=remaining // 2))
        remaining //= 2

    return tuple(schedule)


def expected_matches(rules: FLSaisonRules, phase: FLSaisonPhase) -> int:
    """
    How many matches one matchday of this phase should hold.

    This is what `spieltage.anzahl_spiele` reports (ADR-0065). Zero for a knockout round this season's
    bracket does not reach, which is the honest answer: a season sending eight teams into the bracket
    plays no round of sixteen, so a matchday claiming to be one is a matchday in a phase nobody runs.
    """

    for entry in schedule_for(rules):
        if entry.phase == phase:
            return entry.matches_per_matchday
    return 0
