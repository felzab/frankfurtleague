from typing import Any, Mapping, Sequence

from app.api.saisons.schedule import expected_matches
from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.schemas import PHASE_RANK, FLSaisonPhase
from app.api.spieltage.schemas import FLSpieltag, FLSpieltageFilterParams
from app.core.exceptions import WriteRefusal


def build_spieltage_sort(sort_by: str, order: str) -> list[tuple[str, int]]:
    """The Mongo sort -- for the natural order an APPROXIMATION, refined by `order_spieltage`.

    `beginn` first, because phases run in date order: the documents arrive within a swap or two of
    their final positions, so `limit` keeps the right prefix.
    """

    direction = 1 if order == "asc" else -1

    if sort_by == "natural":
        return [("beginn", direction), ("_id", direction)]

    # Tie-broken by the two fields that make any ordering here reproducible.
    return [(sort_by, direction), ("beginn", 1), ("_id", 1)]


def order_spieltage(spieltage: list[FLSpieltag]) -> list[FLSpieltag]:
    """A season's matchdays in the order they are played: phase, then date, then id.

    The tie-break is the id because the DISPLAYED NAME is composed from this order and so could not
    also decide it.
    """

    return sorted(spieltage, key=lambda spieltag: (PHASE_RANK[spieltag.saison_phase], spieltag.beginn, str(spieltag.id)))


def build_spieltage_filter(filters: FLSpieltageFilterParams) -> dict[str, Any]:
    query = filters.model_dump(include={"saison_id", "saison_phase"}, exclude_none=True)

    if filters.saison_phase == "playoffs":
        query["saison_phase"] = {"$ne": "gruppenphase"}

    # Retiring hides the matchday, never its matches: `GET /spiele` joins no `spieltage` row.
    if not filters.include_inactive:
        query["inactive_since"] = None

    return query


def with_expected_matches(spieltag_raw: Mapping[str, Any], rules: FLSaisonRules) -> dict[str, Any]:
    """One raw matchday with its derived `anzahl_spiele` attached, ready to validate.

    Every path validating a stored matchday goes through this, writes included: a `PATCH` can move
    the phase the count derives from, so an echo skipping it goes stale.
    """

    return {**spieltag_raw, "anzahl_spiele": expected_matches(rules, spieltag_raw["saison_phase"])}


# What each code below refuses is `docs/logging/error-codes.md`.
SPIELTAG_HOLDS_PLAYED = "REQ-RETIRE-002"
SPIELTAG_OVER_ITS_PHASE = "REQ-SPIELTAG-002"
# An implied count is a FLOOR, never a ceiling: a split round is two rows for one phase.
SPIELTAG_BELOW_IMPLIED_COUNT = "REQ-RETIRE-005"


def find_spieltag_retire_refusal(*, played_count: int, live_in_phase: int, implied_in_phase: int) -> WriteRefusal | None:
    """Why retiring this matchday must be refused, or `None`.

    `played_count` counts fixtures carrying an `ergebnis`, so a cancellation with one blocks too;
    `live_in_phase` INCLUDES this matchday.
    """

    if played_count > 0:
        subject = (
            "1 played match; retiring it would remove its result"
            if played_count == 1
            else f"{played_count} played matches; retiring it would remove their results"
        )

        return WriteRefusal(error_code=SPIELTAG_HOLDS_PLAYED, message=f"the matchday holds {subject} from the public Spielplan")

    # The STEP across the floor, never the state below it: refusing there would lock the rows of an
    # already-short phase in place.
    has_a_floor = implied_in_phase > 0
    satisfied_the_floor = live_in_phase >= implied_in_phase
    would_fall_short = live_in_phase - 1 < implied_in_phase

    if has_a_floor and satisfied_the_floor and would_fall_short:
        return WriteRefusal(
            error_code=SPIELTAG_BELOW_IMPLIED_COUNT,
            message=f"the phase holds {live_in_phase} live matchday(s) and these rules imply {implied_in_phase}; "
            "retiring this one would leave the season short of matchdays it still has to play",
        )

    return None


SPIELTAG_MOVED_TO_UNPLAYED_PHASE = "REQ-SPIELTAG-005"
SPIELTAG_CROSSES_THE_BRACKET_BOUNDARY = "REQ-SPIELTAG-006"


def find_spieltag_unplayed_phase_refusal(
    *,
    stored_phase: FLSaisonPhase,
    proposed_phase: FLSaisonPhase,
    implied_in_proposed: int,
) -> WriteRefusal | None:
    """Why moving this matchday into the proposed round must be refused, or `None`.

    The PROPOSED phase alone, so moving OUT of a round the rules never produce stays open: that is
    the repair.
    """

    # An unchanged phase is a dates-only edit; this judges the step, not where the row sits.
    if stored_phase == proposed_phase or implied_in_proposed > 0:
        return None

    return WriteRefusal(
        error_code=SPIELTAG_MOVED_TO_UNPLAYED_PHASE,
        message=f"these rules produce no {proposed_phase}; a matchday cannot be moved into a round the season never plays",
    )


def find_spieltag_boundary_refusal(
    *,
    stored_phase: FLSaisonPhase,
    proposed_phase: FLSaisonPhase,
    fixtures_on_stored_side: int,
    fixtures_on_proposed_side: int,
) -> WriteRefusal | None:
    """Why this matchday may not cross the gruppenphase/knockout boundary.

    The bracket selects rounds by the MATCHDAY's phase and fixtures by the FIXTURE's, and no endpoint
    writes `spiele.saison_phase` -- so a move strands those fixtures across that join.
    """

    crosses_the_boundary = (stored_phase == "gruppenphase") != (proposed_phase == "gruppenphase")
    # Graded as a STEP: a move TOWARDS the fixtures is the repair, and a matchday holding both kinds
    # is left alone, either direction stranding something.
    if not crosses_the_boundary or fixtures_on_stored_side == 0 or fixtures_on_proposed_side > 0:
        return None

    # Named by SIDE, not by phase: a knockout-side fixture may hold any round, not the matchday's.
    stored_side = "gruppenphase" if stored_phase == "gruppenphase" else "knockout"
    proposed_side = "gruppenphase" if proposed_phase == "gruppenphase" else "knockout"

    return WriteRefusal(
        error_code=SPIELTAG_CROSSES_THE_BRACKET_BOUNDARY,
        message=f"the matchday holds {fixtures_on_stored_side} {stored_side} fixture(s) and no {proposed_side} one; "
        f"moving it to {proposed_phase} would leave those fixtures on the other side of the bracket "
        "boundary from their own matchday, and nothing here can move them across",
    )


def find_spieltag_phase_refusal(*, attached_count: int, expected_count: int, expected_in_stored_phase: int) -> WriteRefusal | None:
    """Why this matchday's phase must be refused, or `None`.

    `expected_count` is for the PROPOSED phase, `expected_in_stored_phase` for the one it holds now.
    Only the over-full direction is refused.
    """

    # An unchanged phase compares equal, so a dates-only patch never reaches the refusal, and a move
    # to a roomier phase is a repair.
    narrows_the_count = expected_count < expected_in_stored_phase
    would_not_fit = attached_count > expected_count

    if narrows_the_count and would_not_fit:
        return WriteRefusal(
            error_code=SPIELTAG_OVER_ITS_PHASE,
            message=f"the matchday holds {attached_count} fixtures and this phase accounts for {expected_count}; "
            "a single round robin per group fixes that number",
        )

    return None


SPIELTAG_OUTSIDE_SAISON = "REQ-DATE-002"
# `REQ-DATE-001`'s mirror: shrinking the span is the other way to break the same containment.
SPIELTAG_SPAN_BELOW_FIXTURES = "REQ-DATE-003"


def find_spieltag_span_refusal(
    *,
    beginn: str,
    ende: str,
    saison_start: str,
    saison_end: str,
    fixture_dates: Sequence[str],
) -> WriteRefusal | None:
    """Why this matchday's span must be refused, or `None`.

    `fixture_dates` is every DATED fixture of the matchday; an undated one constrains nothing.
    """

    if beginn < saison_start or ende > saison_end:
        return WriteRefusal(
            error_code=SPIELTAG_OUTSIDE_SAISON,
            message=f"the matchday runs {beginn} to {ende} and its season runs {saison_start} to {saison_end}; "
            "a matchday is a block of that season's fixtures",
        )

    outside = sorted(datum for datum in fixture_dates if datum < beginn or datum > ende)
    if outside:
        return WriteRefusal(
            error_code=SPIELTAG_SPAN_BELOW_FIXTURES,
            message=f"{len(outside)} of the matchday's fixtures fall outside {beginn} to {ende} (first: {outside[0]}); "
            "widen the span or move those fixtures",
        )

    return None


# "Started" is a DATE here, never a result.
SPIELTAG_KNOCKOUT_STARTED = "REQ-SPIELTAG-003"
SPIELTAG_PHASE_NOT_PLAYED = "REQ-SPIELTAG-004"


def find_spieltag_create_refusal(
    *,
    implied_in_phase: int,
    saison_phase: FLSaisonPhase,
    earliest_knockout_beginn: str | None,
    today: str,
) -> WriteRefusal | None:
    """Why creating a matchday in this season must be refused, or `None`.

    A non-zero `implied_in_phase` is NOT a quota: a phase may be split across more matchdays than
    the minimum. Today COUNTS as under way.
    """

    # Asked first: a phase nobody plays is wrong whatever the calendar says.
    if implied_in_phase == 0:
        return WriteRefusal(
            error_code=SPIELTAG_PHASE_NOT_PLAYED,
            message=f"these rules produce no {saison_phase}; a matchday cannot belong to a round the season never plays",
        )

    if earliest_knockout_beginn is None or earliest_knockout_beginn > today:
        return None

    return WriteRefusal(
        error_code=SPIELTAG_KNOCKOUT_STARTED,
        message=f"the knockout phase began on {earliest_knockout_beginn} and today is {today}; "
        "a season's matchdays are created before its bracket is under way",
    )
