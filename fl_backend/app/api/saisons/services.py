"""
SAISONS · filter and sort construction, and what a rules edit refuses

Pure throughout -- no I/O, no collection access -- so every refusal rule is testable without a database.
Two halves: `build_saisons_*` translate `FLSaisonsFilterOptions` into a Mongo filter and sort, and
`find_rules_refusal` decides whether a season's rules are ones the competition can hold.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • **A refusal is the default when an edit would strand data** (owner, 2026-08-07; docs/domain.md). The
    rules decide the shape of the competition, and three of them can be narrowed below what already
    exists -- a group nobody may enter that still holds teams, a group over its own capacity, a bracket
    slot naming a placing that can no longer be reached. Each of those states is legal at every layer and
    invisible until something downstream reads it, which is exactly the class this repository refuses at
    the write rather than reports later.
  • **A finished season's competitive rules are FROZEN** (owner, 2026-08-07). The league table is scored
    from `rules` on every read rather than stored (ADR-0026), so editing the points of a `past` season
    rewrites who won it and nothing anywhere records what it said before. Only the dates stay editable,
    because a mistyped end date on a closed season is a repair with no downside.
  • **The bracket needs a power-of-two field, capped by the phase set.** `MAX_QUALIFIERS` is
    `2 ** len(KNOCKOUT_PHASES)`, so this rule widens by adding a phase rather than by editing a number
    here (ADR-0065).
  • Every refusal returns `(error_code, detail)` and never raises: the caller decides the status code, and
    the detail is the English log line while the code is what the client maps to German
    (docs/logging.md).
  • The checks run in the order an admin can act on them, which is the order `find_entry_refusal` uses
    for the same reason: the answer they get first should be the one they can fix first.

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/domain.md -- the editability matrix these rules implement
  docs/_decisions/0065-a-seasons-schedule-is-derived-from-its-rules.md
"""

from typing import Any

from app.api.saisons.schedule import knockout_phases_for
from app.api.saisons.schemas import FLSaisonRules, FLSaisonsFilterOptions
from app.api.spiele.schemas import MAX_QUALIFIERS
from app.api.teams.schemas import FLGruppenNames
from app.api.teams.services import offered_gruppen


def build_saisons_sort(sort_by: str, order: str) -> list[tuple[str, int]]:
    direction = 1 if order == "asc" else -1

    return [(sort_by, direction)]


def build_saisons_filter(filters: FLSaisonsFilterOptions) -> dict[str, Any]:
    query = filters.model_dump(include={"status"}, exclude_none=True, by_alias=True)

    return query


# =====================================================================================================
# WHAT A RULES EDIT REFUSES
# =====================================================================================================

# `number_of_groups x qualifiers_per_group` is not a power of two, or is above what the phase set can
# hold. A knockout ladder halves each round down to one final, so any other field size has no bracket:
# twelve qualifiers cannot be paired down to a winner, and thirty-two have no round to play in until a
# fifth knockout phase exists.
RULES_BRACKET_IMPOSSIBLE = "REQ-RULES-001"

# `number_of_groups` would drop below a group that still holds teams. Those rows would then name a group
# the season does not run -- a state nothing else in the system refuses, and one the entry endpoint's own
# `REQ-ENTER-002` exists to prevent from the other direction.
RULES_GROUPS_IN_USE = "REQ-RULES-002"

# `teams_per_group` would drop below the fullest group's occupancy, leaving a group over a capacity no
# entry was ever refused against.
RULES_CAPACITY_BELOW_USE = "REQ-RULES-003"

# `qualifiers_per_group` would drop below the highest placing a bracket slot already names, so that slot
# would reference a placing its group can no longer produce. The resolution CONTAINS that state and
# reports it as a bracket fault (ADR-0047) rather than emptying the slot -- but the fault is reported to
# whoever opens the triage list, not to whoever caused it, which is what this refusal fixes.
RULES_QUALIFIERS_BELOW_WIRING = "REQ-RULES-004"

# A `past` season's competitive rules. Frozen because the table is derived: editing them rewrites a
# finished competition's result and nothing records the previous one.
RULES_SAISON_FINISHED = "REQ-RULES-005"

# The three fields a finished season freezes. The dates stay editable -- correcting a mistyped end date on
# a closed season changes nothing anybody competed for -- and so does `erlaubte_stufen`, which bounds what
# a form OFFERS and never what a stored squad row holds (ADR-0061).
FROZEN_RULES_FIELDS: tuple[str, ...] = ("win_points", "draw_points", "qualifiers_per_group")


def find_rules_refusal(
    *,
    saison_status: str,
    stored: FLSaisonRules | None,
    proposed: FLSaisonRules,
    occupancy_by_gruppe: dict[FLGruppenNames, int],
    highest_wired_platz: int,
) -> tuple[str, str] | None:
    """
    Why these rules must be refused, as `(error_code, detail)` -- or `None`.

    `stored` is `None` on a create, where there is nothing to strand and nothing frozen: only the bracket
    rule applies. `occupancy_by_gruppe` counts `saison_teams` rows per group, disqualified rows included,
    because a team never leaves a season (ADR-0033) and its place stays taken. `highest_wired_platz` is
    the largest `platz` any of the season's bracket slots names, or 0 where none does.
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

    # The three narrowings, each stated against what actually exists.
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

    return None
