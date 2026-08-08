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
    an import cycle. The shape is the same one `_with_expected_matches` uses for a matchday's count, and
    for the same reason -- the field is REQUIRED on the model, so a document reaching validation without
    it is a 500 rather than a silently absent key.

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

# `qualifiers_per_group` exceeds `teams_per_group` (owner, 2026-08-08). A group of four cannot supply six
# qualifiers, so the bracket would expect more teams out of the group phase than the group phase can
# produce -- and the seeding walk then asks for a placing no standing will ever hold, which is the state
# `REQ-RULES-004` refuses from the other direction. The editor warned about this and saved anyway.
RULES_QUALIFIERS_ABOVE_GROUP = "REQ-RULES-007"

# The narrowing would leave one of the season's matchdays holding more fixtures than its phase accounts
# for (owner, 2026-08-08). The matchday's expected count is derived from these rules (ADR-0065), so
# lowering `number_of_groups` or `teams_per_group` lowers it for every group-phase matchday at once --
# and a matchday over its own count is a state no season setup passes through, unlike being under it.
RULES_MATCHDAY_OVER_ITS_PHASE = "REQ-RULES-006"

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
    attached_by_phase: Mapping[FLSaisonPhase, int] | None = None,
) -> tuple[str, str] | None:
    """
    Why these rules must be refused, as `(error_code, detail)` -- or `None`.

    `stored` is `None` on a create, where there is nothing to strand and nothing frozen: only the bracket
    rule applies. `occupancy_by_gruppe` counts `saison_teams` rows per group, disqualified rows included,
    because a team never leaves a season (ADR-0033) and its place stays taken. `highest_wired_platz` is
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

    # A group cannot supply more qualifiers than it holds teams. Before the bracket rule, because it is
    # the narrower statement: it names two fields an admin can compare, where the bracket's answer is a
    # property of their product.
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

    # Last, because it is the only one that has to compute the whole schedule to answer. Every phase is
    # checked rather than just the group phase: lowering the qualifier count shortens the KNOCKOUT ladder,
    # so a phase the season no longer reaches drops to an expected 0 while its matchdays keep their
    # fixtures.
    for phase, attached in sorted((attached_by_phase or {}).items()):
        expected = expected_matches(proposed, phase)
        if attached > expected:
            return (
                RULES_MATCHDAY_OVER_ITS_PHASE,
                f"a {phase} matchday holds {attached} fixtures and these rules account for {expected}; "
                "the count follows from the rules, so lowering them would strand fixtures",
            )

    return None


# =====================================================================================================
# WHAT THE ROLLOVER REFUSES
# =====================================================================================================

# The outgoing season still has fixtures nobody has played (owner, 2026-08-08). Activating a season
# demotes the incumbent to `past`, and a `past` season's competitive rules freeze (REQ-RULES-005) while
# its table becomes the record of what happened -- so a rollover over unplayed fixtures closes a
# competition that is not finished, and does it in the one transaction that cannot be undone by editing
# the season afterwards.
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
    (`deactivated: 0`), and it reaches this rule like any other call: a season cannot be its own outgoing
    incumbent and also have unplayed fixtures without those fixtures being the ones it is about to close.
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
