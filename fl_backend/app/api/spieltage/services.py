"""
SPIELTAGE · filter construction and the derived order

Pure translation of `FLSpieltageFilterParams` into a Mongo filter and sort, plus the one expression of
a matchday's position. No I/O.

**A matchday's position is derived, not stored** (ADR-0064). `order_spieltage` is where that order
lives, and it is the only place in the system that says what "the third matchday" means.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • The natural order is TOTAL: `PHASE_RANK[saison_phase]`, then `beginn`, then `name`. Two matchdays
    can share a phase and a date -- nothing refuses that -- so the name is what keeps the order stable
    across two calls rather than leaving Mongo's document order to decide.
  • The phase leads, and that is the correctness half. Ordering by date alone would let a Halbfinale
    dated before a Viertelfinale render ahead of it, which is exactly the defect a stored position used
    to make possible in the other direction.
  • `order_spieltage` sorts in PYTHON, after the read. A `$sort` on `saison_phase` would order the four
    phases lexically -- finale, gruppenphase, halbfinale, viertelfinale -- which is not the order they
    are played in, and a plain `find` has no stage to compute a rank in.
  • The Mongo sort still approximates the natural order, so `limit` selects the right prefix. At a
    season's half-dozen matchdays that is theoretical; it stops being theoretical if a caller ever
    lowers the limit.

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/domain.md -- what a derived field is, and why a position is one
"""

from typing import Any, Sequence

from app.api.spiele.schemas import PHASE_RANK
from app.api.spieltage.schemas import FLSpieltag, FLSpieltageFilterParams


def build_spieltage_sort(sort_by: str, order: str) -> list[tuple[str, int]]:
    """
    The Mongo sort. For the natural order this is an APPROXIMATION, refined by `order_spieltage`.

    `beginn` first, because a season's phases run in date order in every case anybody has entered — so
    the documents arrive within a swap or two of their final positions, and the `limit` above keeps the
    prefix that the exact ordering would have kept.
    """

    direction = 1 if order == "asc" else -1

    if sort_by == "natural":
        return [("beginn", direction), ("name", direction)]

    # An explicit field, tie-broken by the two that make any ordering here reproducible.
    return [(sort_by, direction), ("beginn", 1), ("name", 1)]


def order_spieltage(spieltage: list[FLSpieltag]) -> list[FLSpieltag]:
    """
    A season's matchdays in the order they are played: phase, then date, then name.

    This is the order every consumer means by "the matchdays". The public Spielplan renders its tabs in
    it, `orderRoundsByWiring` anchors its walk on the last element of it, and the admin list sections by
    the phase it leads with. Nothing stores it, so nothing can contradict it.
    """

    return sorted(spieltage, key=lambda spieltag: (PHASE_RANK[spieltag.saison_phase], spieltag.beginn, spieltag.name))


def build_spieltage_filter(filters: FLSpieltageFilterParams) -> dict[str, Any]:
    query = filters.model_dump(include={"saison_id", "saison_phase"}, exclude_none=True)

    # Phase
    if filters.saison_phase == "playoffs":
        query["saison_phase"] = {"$ne": "gruppenphase"}

    # Retired matchdays stay out unless asked for (ADR-0032). Their matches are unaffected either way:
    # this filters `spieltage`, and `GET /spiele` never joins it.
    if not filters.include_inactive:
        query["inactive_since"] = None

    return query


# =====================================================================================================
# WHAT A MATCHDAY WRITE REFUSES
# =====================================================================================================

# Retiring a matchday that holds a match with a result. A retired matchday is excluded from
# `GET /spieltage`, and the public Spielplan joins fixtures onto the matchdays it received -- so this
# retirement does not merely hide a container, it unpublishes results the league actually produced
# (owner, 2026-08-08).
SPIELTAG_HOLDS_PLAYED = "REQ-RETIRE-002"

# The matchday would hold more fixtures than its phase accounts for. Too FEW is legal and stays legal --
# a season being set up passes through every count on the way to being complete -- but too many is a
# state no setup passes through, because a single round robin fixes the number exactly (ADR-0065).
SPIELTAG_OVER_ITS_PHASE = "REQ-SPIELTAG-002"


def find_spieltag_retire_refusal(*, played_count: int) -> tuple[str, str] | None:
    """
    Why retiring this matchday must be refused, as `(error_code, detail)` -- or `None`.

    `played_count` is how many of its fixtures carry an `ergebnis`, counted by the caller inside its own
    read. A fixture with no result does not block: an empty or unplayed matchday is exactly the one
    somebody created by mistake, and retiring it hides nothing anybody competed for.

    Cancelled counts as played when a result was entered, and that is deliberate: a cancelled match with
    a result still counts for the league table (docs/glossary.md), so its scoreline is as public as any
    other. The caller decides that by what it counts, and it counts `ergebnis`.
    """

    if played_count > 0:
        subject = (
            "1 played match; retiring it would remove its result"
            if played_count == 1
            else f"{played_count} played matches; retiring it would remove their results"
        )

        return (SPIELTAG_HOLDS_PLAYED, f"the matchday holds {subject} from the public Spielplan")

    return None


def find_spieltag_phase_refusal(*, attached_count: int, expected_count: int) -> tuple[str, str] | None:
    """
    Why this matchday's phase must be refused, as `(error_code, detail)` -- or `None`.

    `expected_count` is `schedule_for`'s answer for the PROPOSED phase, and `attached_count` is how many
    fixtures already carry this matchday's id. Only the over-full direction is refused, so a phase edit
    that leaves a matchday still being filled in passes.

    A phase whose expected count is 0 -- one this season's bracket does not reach -- therefore refuses
    any attached fixture at all, which is the right answer: those fixtures have nowhere to be played.
    """

    if attached_count > expected_count:
        return (
            SPIELTAG_OVER_ITS_PHASE,
            f"the matchday holds {attached_count} fixtures and this phase accounts for {expected_count}; "
            "a single round robin per group fixes that number",
        )

    return None


# =====================================================================================================
# WHAT CONTAINS WHAT: THE DATE SPANS
# =====================================================================================================
#
# Three rules, one family, and they all say the same thing in different places: a span contains what sits
# inside it (owner, 2026-08-08). A season contains its matchdays, a matchday contains its fixtures.
#
# **A postponed match means PROLONGING the matchday, and there is deliberately no exception** (owner,
# 2026-08-08). A matchday's `beginn`/`ende` DESCRIBES when its fixtures are played rather than planning
# when they must be, so a fixture moving to the 20th means the matchday now runs to the 20th -- editing
# `ende` makes the data true. A per-fixture escape hatch would need a marker saying "this one may sit
# outside", which is a second statement of the same fact with nothing holding the two consistent: the
# shape ADR-0042 refused for `is_manual` and ADR-0032 refused for a boolean beside a date. Extending
# `ende` also costs no ordering, because matchdays sort by `beginn` (ADR-0064).

# The matchday's own span falls outside its season's. A matchday is a named block of that season's
# fixtures, so one running before the season opens or after it closes is a block of a competition that
# was not on.
SPIELTAG_OUTSIDE_SAISON = "REQ-DATE-002"

# The matchday's span would no longer cover a date one of its own fixtures holds. The mirror of
# `REQ-DATE-001`: the same containment, refused from the container's side, because shrinking the span is
# the other way to break it.
SPIELTAG_SPAN_BELOW_FIXTURES = "REQ-DATE-003"


def find_spieltag_span_refusal(
    *,
    beginn: str,
    ende: str,
    saison_start: str,
    saison_end: str,
    fixture_dates: Sequence[str],
) -> tuple[str, str] | None:
    """
    Why this matchday's span must be refused, as `(error_code, detail)` -- or `None`.

    Two checks in one function because they are one question asked twice: does this span sit inside its
    season, and does it still cover its own fixtures. `fixture_dates` is every DATED fixture of the
    matchday -- an undated one constrains nothing, so the caller filters them out rather than passing a
    null this has to interpret.

    The season check runs first. It is a property of the two documents alone, so it holds even for a
    matchday with no fixtures at all -- which is every matchday at the moment it is created.
    """

    if beginn < saison_start or ende > saison_end:
        return (
            SPIELTAG_OUTSIDE_SAISON,
            f"the matchday runs {beginn} to {ende} and its season runs {saison_start} to {saison_end}; "
            "a matchday is a block of that season's fixtures",
        )

    outside = sorted(datum for datum in fixture_dates if datum < beginn or datum > ende)
    if outside:
        return (
            SPIELTAG_SPAN_BELOW_FIXTURES,
            f"{len(outside)} of the matchday's fixtures fall outside {beginn} to {ende} (first: {outside[0]}); "
            "widen the span or move those fixtures",
        )

    return None
