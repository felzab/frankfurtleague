"""
SPIELTAGE · filter construction, the derived order, and the derived match count

Pure translation of `FLSpieltageFilterParams` into a Mongo filter and sort, plus the two things a
matchday does not store: its position, of which `order_spieltage` is the only expression in the
system (ADR-0051), and its match count, which `with_expected_matches` attaches (ADR-0052).

Invariants:
- The natural order is total: `PHASE_RANK[saison_phase]`, then `beginn`, then `_id`.
- The phase leads — date alone would let a Halbfinale render ahead of a Viertelfinale.
- `order_spieltage` sorts in Python, after the read: `$sort` would order phases lexically.
- The Mongo sort still approximates the natural order, so `limit` selects the right prefix.
- Every path validating a stored matchday injects `anzahl_spiele` first, reads and writes alike.

See:
- docs/domain.md — what a derived field is, and why a position is one
"""

from typing import Any, Mapping, Sequence

from app.api.saisons.schedule import expected_matches
from app.api.saisons.schemas import FLSaisonRules
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
        return [("beginn", direction), ("_id", direction)]

    # An explicit field, tie-broken by the two that make any ordering here reproducible.
    return [(sort_by, direction), ("beginn", 1), ("_id", 1)]


def order_spieltage(spieltage: list[FLSpieltag]) -> list[FLSpieltag]:
    """
    A season's matchdays in the order they are played: phase, then date, then id.

    This is the order every consumer means by "the matchdays". The public Spielplan renders its tabs in
    it, `orderRoundsByWiring` anchors its walk on the last element of it, and the admin list sections by
    the phase it leads with. Nothing stores it, so nothing can contradict it.

    **It is also what the DISPLAYED NAME is composed from** (ADR-0051), which is why the final tie-break is
    the id and not a name: a matchday has no name to break a tie with, and one derived from this order
    could not also decide it.
    """

    return sorted(spieltage, key=lambda spieltag: (PHASE_RANK[spieltag.saison_phase], spieltag.beginn, str(spieltag.id)))


def build_spieltage_filter(filters: FLSpieltageFilterParams) -> dict[str, Any]:
    query = filters.model_dump(include={"saison_id", "saison_phase"}, exclude_none=True)

    if filters.saison_phase == "playoffs":
        query["saison_phase"] = {"$ne": "gruppenphase"}

    # Retired matchdays stay out unless asked for (ADR-0025). Their matches are unaffected either way:
    # this filters `spieltage`, and `GET /spiele` never joins it.
    if not filters.include_inactive:
        query["inactive_since"] = None

    return query


def with_expected_matches(spieltag_raw: Mapping[str, Any], rules: FLSaisonRules) -> dict[str, Any]:
    """
    One raw matchday with its derived `anzahl_spiele` attached, ready to validate.

    Injected into the DOCUMENT rather than set on the model afterwards, because the field is required on
    `FLSpieltag` and sits on no document (ADR-0052) -- so a matchday reaching validation without it is a
    500, and doing it here means the model's own bound (`ge=0`) still judges the derived value.

    **Every path that validates a stored matchday goes through this, writes as much as reads.** A write
    endpoint echoes the document it just changed, and `PATCH` can move the `saison_phase` the count is
    derived from, so an echo skipping this would answer with a stale number even once it stopped raising.
    One home for the derivation is also what ADR-0052 is for: a second one is a second answer.
    """

    return {**spieltag_raw, "anzahl_spiele": expected_matches(rules, spieltag_raw["saison_phase"])}


# Retiring a matchday that holds a match with a result (decided 2026-08-08). A retired matchday is
# excluded from `GET /spieltage`, and the public Spielplan joins fixtures onto what it received -- so
# this unpublishes results the league produced.
SPIELTAG_HOLDS_PLAYED = "REQ-RETIRE-002"

# The matchday would hold more fixtures than its phase accounts for. Too few is legal: a season being
# set up passes through every count. Too many is a state no setup passes through, because a single
# round robin fixes the number (ADR-0052).
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


# **A postponed match PROLONGS the matchday, with no exception**: an escape-hatch marker would be a
# second statement of the same fact -- the shape ADR-0034 refused for `is_manual` and ADR-0025 for a
# boolean beside a date.

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


# A matchday created once the knockout phase has started (decided 2026-08-08): a group matchday created
# then belongs to a phase nobody can still play. **"Started" is a DATE, not a result** -- not the
# question `REQ-RETIRE-002` asks.
SPIELTAG_KNOCKOUT_STARTED = "REQ-SPIELTAG-003"


def find_spieltag_create_refusal(*, earliest_knockout_beginn: str | None, today: str) -> tuple[str, str] | None:
    """
    Why creating a matchday in this season must be refused, as `(error_code, detail)` -- or `None`.

    `earliest_knockout_beginn` is the lowest `beginn` among the season's matchdays whose phase is not
    `gruppenphase`, or `None` where it has none -- a season still in its group phase, or one not drawn yet.
    Both pass: there is no knockout phase to have started.

    Today COUNTS as started, which is the inclusive reading and the safer one: a bracket beginning this
    morning is under way, and a rule that waited until tomorrow would permit a matchday for a round already
    being played.

    The refusal covers every phase rather than only the knockout ones — the stricter reading, chosen
    deliberately. **The way past it is to move the knockout matchday's date**, which is a real change to
    the schedule rather than a step in setting one up.
    """

    if earliest_knockout_beginn is None or earliest_knockout_beginn > today:
        return None

    return (
        SPIELTAG_KNOCKOUT_STARTED,
        f"the knockout phase began on {earliest_knockout_beginn} and today is {today}; "
        "a season's matchdays are created before its bracket is under way",
    )
