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
from app.api.spiele.schemas import PHASE_RANK, FLSaisonPhase
from app.api.spieltage.schemas import FLSpieltag, FLSpieltageFilterParams
from app.core.exceptions import WriteRefusal


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

# A matchday moved to a phase accounting for fewer matches than it holds. Too few is legal: a season
# being set up passes through every count. Too many is a state no setup reaches, because a single
# round robin fixes the number (ADR-0052).
SPIELTAG_OVER_ITS_PHASE = "REQ-SPIELTAG-002"

# Retiring would leave the phase below the count its rules imply (decided 2026-08-13); nothing else
# counts rows. The figure is a FLOOR, never a ceiling -- a split round is two rows for one phase
# (ADR-0051) -- so only the step going below it is refused.
SPIELTAG_BELOW_IMPLIED_COUNT = "REQ-RETIRE-005"


def find_spieltag_retire_refusal(*, played_count: int, live_in_phase: int, implied_in_phase: int) -> WriteRefusal | None:
    """
    Why retiring this matchday must be refused, as a `WriteRefusal` -- or `None`.

    `played_count` is how many of its fixtures carry an `ergebnis`, counted by the caller inside its own
    read. A fixture with no result does not block: an empty or unplayed matchday is exactly the one
    somebody created by mistake, and retiring it hides nothing anybody competed for.

    Cancelled counts as played when a result was entered, and that is deliberate: a cancelled match with
    a result still counts for the league table (docs/glossary.md), so its scoreline is as public as any
    other. The caller decides that by what it counts, and it counts `ergebnis`.

    `live_in_phase` INCLUDES this matchday -- it is the phase's live rows as they stand before the
    retirement -- and `implied_in_phase` is `implied_matchdays` for that phase. A phase above the floor
    retires down to it and no further, which is what keeps a split round (ADR-0051) reducible back to
    one matchday but not to none.

    **What is refused is the STEP across the floor, never the state below it.** A phase already short
    was put there by a create or by a rules change rather than by a retirement, so refusing one there
    would lock its rows in place without restoring the missing ones -- and a phase holding no matchdays
    at all is where every season starts. Draining a phase that does satisfy its floor stays impossible,
    because the first step out of it is the one refused.
    """

    if played_count > 0:
        subject = (
            "1 played match; retiring it would remove its result"
            if played_count == 1
            else f"{played_count} played matches; retiring it would remove their results"
        )

        return WriteRefusal(error_code=SPIELTAG_HOLDS_PLAYED, message=f"the matchday holds {subject} from the public Spielplan")

    # A phase the bracket never reaches has no floor to cross, so falling short of it is arithmetic on
    # a row that was already retired rather than a gap the rules can name.
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


# A matchday MOVED into a round the season's rules never produce (decided 2026-08-13). The mirror of
# `REQ-SPIELTAG-004` on the edit path: the create refuses that row, and until this existed the patch
# could still produce one.
SPIELTAG_MOVED_TO_UNPLAYED_PHASE = "REQ-SPIELTAG-005"

# A matchday carrying fixtures MOVED across the gruppenphase/knockout boundary (ADR-0075). The
# bracket selects rounds by the MATCHDAY's phase and fixtures by the FIXTURE's, so the move
# strands one against the other.
SPIELTAG_CROSSES_THE_BRACKET_BOUNDARY = "REQ-SPIELTAG-006"


def find_spieltag_unplayed_phase_refusal(
    *,
    stored_phase: FLSaisonPhase,
    proposed_phase: FLSaisonPhase,
    implied_in_proposed: int,
) -> WriteRefusal | None:
    """
    Why moving this matchday into the proposed round must be refused, as a `WriteRefusal` (ADR-0075).

    The edit path's mirror of `REQ-SPIELTAG-004`. `implied_in_proposed` is `implied_matchdays` for the
    PROPOSED phase, and zero means the season's rules produce no such round -- so the row would report a
    round with no matches in it and sit in a bracket the season never reaches.

    **Judged first among the phase rules**, because it is a property of the season's rules and the payload
    alone: `find_spieltag_create_refusal` orders its two the same way, and for the same reason -- moving
    fixtures around would not make the round exist, so naming the rules is the only actionable answer.

    **It reads the PROPOSED phase alone, so moving OUT of an unplayed round stays open.** That is the
    repair: a row stranded in a round the bracket never reaches, by a rules change or by a create that
    predates `REQ-SPIELTAG-004`, is exactly the one an admin has to be able to move somewhere real.
    """

    # An unchanged phase is a dates-only edit, and this is not a statement about where the row sits.
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
    """
    Why this matchday may not cross the gruppenphase/knockout boundary, as a `WriteRefusal` (ADR-0075).

    `saison_phase` is an editable input on purpose (ADR-0052) -- which matchday is the quarter-final is a
    scheduling decision. What ADR-0052 never asked is whether every transition should be reachable, and
    this one is not once the matchday carries fixtures: the bracket selects its rounds by the MATCHDAY's
    phase and its fixtures by the FIXTURE's, and no endpoint writes `spiele.saison_phase` (ADR-0037), so
    after the move those fixtures sit on the far side of that join with nothing able to bring them across.

    **The two counts split this matchday's fixtures by the FIXTURE's own phase**, on the one boundary the
    bracket cares about: `gruppenphase` against every knockout round. Judged LAST of the phase rules,
    because it is the widest statement -- `REQ-SPIELTAG-002` names two numbers an admin can compare.

    **It grades the STEP, three times over.** A payload repeating the stored phase crosses nothing, so a
    dates-only patch is never judged here. A move TOWARDS the fixtures is the repair and passes, which is
    what keeps a mislabelled row correctable. And a matchday holding both kinds is left alone in either
    direction: whichever way it goes something is stranded, so refusing would freeze a row's phase
    permanently over a state no edit on this endpoint produced.

    **An EMPTY matchday crosses freely.** Correcting one created before its fixtures were drawn is the
    ordinary setup mistake, and there is nothing on the row to strand.
    """

    crosses_the_boundary = (stored_phase == "gruppenphase") != (proposed_phase == "gruppenphase")
    if not crosses_the_boundary or fixtures_on_stored_side == 0 or fixtures_on_proposed_side > 0:
        return None

    # Named by SIDE rather than by phase: a fixture on the knockout side may hold any of the four rounds,
    # and none of them is necessarily the matchday's own.
    stored_side = "gruppenphase" if stored_phase == "gruppenphase" else "knockout"
    proposed_side = "gruppenphase" if proposed_phase == "gruppenphase" else "knockout"

    return WriteRefusal(
        error_code=SPIELTAG_CROSSES_THE_BRACKET_BOUNDARY,
        message=f"the matchday holds {fixtures_on_stored_side} {stored_side} fixture(s) and no {proposed_side} one; "
        f"moving it to {proposed_phase} would leave those fixtures on the other side of the bracket "
        "boundary from their own matchday, and nothing here can move them across",
    )


def find_spieltag_phase_refusal(*, attached_count: int, expected_count: int, expected_in_stored_phase: int) -> WriteRefusal | None:
    """
    Why this matchday's phase must be refused, as a `WriteRefusal` -- or `None`.

    `expected_count` is `schedule_for`'s answer for the PROPOSED phase, `expected_in_stored_phase` is the
    same answer for the phase the matchday holds now, and `attached_count` is how many fixtures already
    carry this matchday's id. Only the over-full direction is refused, so a phase edit that leaves a
    matchday still being filled in passes.

    A phase whose expected count is 0 -- one this season's bracket does not reach -- therefore refuses any
    attached fixture moved into it, which is the right answer: those fixtures have nowhere to be played.

    **What is refused is the STEP that narrows the count, never the state of already being over one.** A
    season's fixtures are created outside the API (ADR-0037) and no payload carries `spieltag_id`, so a
    matchday holding more than its phase accounts for was put there by data this endpoint never wrote --
    and refusing every edit to it would take its DATES with them, by a rule about its phase, while leaving
    the fixtures exactly where they were. A move into a phase narrower still is refused from that state
    too: it is the one edit that makes the mismatch worse.
    """

    # An unchanged phase compares equal, so a dates-only patch never reaches the refusal -- and a move to a
    # roomier phase is a repair rather than the mistake this exists for.
    narrows_the_count = expected_count < expected_in_stored_phase
    would_not_fit = attached_count > expected_count

    if narrows_the_count and would_not_fit:
        return WriteRefusal(
            error_code=SPIELTAG_OVER_ITS_PHASE,
            message=f"the matchday holds {attached_count} fixtures and this phase accounts for {expected_count}; "
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
) -> WriteRefusal | None:
    """
    Why this matchday's span must be refused, as a `WriteRefusal` -- or `None`.

    Two checks in one function because they are one question asked twice: does this span sit inside its
    season, and does it still cover its own fixtures. `fixture_dates` is every DATED fixture of the
    matchday -- an undated one constrains nothing, so the caller filters them out rather than passing a
    null this has to interpret.

    The season check runs first. It is a property of the two documents alone, so it holds even for a
    matchday with no fixtures at all -- which is every matchday at the moment it is created.
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


# A matchday created once the knockout phase has started (decided 2026-08-08): a group matchday created
# then belongs to a phase nobody can still play. **"Started" is a DATE, not a result** -- not the
# question `REQ-RETIRE-002` asks.
SPIELTAG_KNOCKOUT_STARTED = "REQ-SPIELTAG-003"

# A matchday in a phase the bracket never reaches (decided 2026-08-13). The ONE count question with
# an exact answer rather than a floor: a round never played cannot be split across dates. How many a
# played phase holds is not refused (ADR-0051).
SPIELTAG_PHASE_NOT_PLAYED = "REQ-SPIELTAG-004"


def find_spieltag_create_refusal(
    *,
    implied_in_phase: int,
    saison_phase: FLSaisonPhase,
    earliest_knockout_beginn: str | None,
    today: str,
) -> WriteRefusal | None:
    """
    Why creating a matchday in this season must be refused, as a `WriteRefusal` -- or `None`.

    `implied_in_phase` is `implied_matchdays` for the proposed phase; zero means the season's rules
    produce no such round at all, which is `REQ-SPIELTAG-004`. **A non-zero figure is not a quota** --
    nothing here compares it against how many rows the phase already holds, because a phase may
    legitimately be split across more matchdays than the minimum (ADR-0051).

    `earliest_knockout_beginn` is the lowest `beginn` among the season's matchdays whose phase is not
    `gruppenphase`, or `None` where it has none -- a season still in its group phase, or one not drawn yet.
    Both pass: there is no knockout phase to have started.

    Today COUNTS as started, which is the inclusive reading and the safer one: a bracket beginning this
    morning is under way, and a rule that waited until tomorrow would permit a matchday for a round already
    being played.

    The window refusal covers every phase rather than only the knockout ones — the stricter reading,
    chosen deliberately. **The way past it is to move the knockout matchday's date**, which is a real
    change to the schedule rather than a step in setting one up.
    """

    # First, because it is a property of the rules and the payload alone: a phase nobody plays is wrong
    # whatever the calendar says, and saying so names the season's rules rather than a date.
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
