from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from app.api.saisons.schedule import expected_matches
from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.schemas import PHASE_RANK
from app.api.spieltage.schemas import FLSpieltag, FLSpieltageFilterParams
from app.core.crud import build_query, build_sort
from app.core.exceptions import WriteRefusal


def build_spieltage_sort(sort_by: str, order: str) -> list[tuple[str, int]]:
    """The Mongo sort, an APPROXIMATION of the natural order that `order_spieltage` refines.

    The phase RANK is on no document, so no `find` separates the phases and `limit` may keep a
    prefix of each. `position` leads, being exact inside one.
    """

    if sort_by == "natural":
        # The chain follows `order` only here, this sort being a prefix SELECTOR: on a `position` tie
        # straddling `limit`, a descending page needs the descending end of that tie.
        direction = 1 if order == "asc" else -1

        return build_sort(sort_by="position", order=order, chain=(("_id", direction),))

    # Tie-broken by the two fields that make any ordering here reproducible. `position` and not a
    # date: every matchday has one, and it is the order the season's schedule was drawn in.
    return build_sort(sort_by=sort_by, order=order, chain=(("position", 1), ("_id", 1)))


def order_spieltage(spieltage: list[FLSpieltag]) -> list[FLSpieltag]:
    """A season's matchdays in the order they are played: phase, then the stored `position`.

    The id tie-breaks a list spanning two seasons, whose positions repeat;
    `uniq_saison_id_saison_phase_position` makes that unreachable within one.
    """

    return sorted(spieltage, key=lambda spieltag: (PHASE_RANK[spieltag.saison_phase], spieltag.position, str(spieltag.id)))


def build_spieltage_filter(filters: FLSpieltageFilterParams) -> dict[str, Any]:
    return build_query(
        filters,
        terms={"saison_id", "saison_phase"},
        compiled={"saison_phase": {"$ne": "gruppenphase"}} if filters.saison_phase == "playoffs" else None,
    )


def with_expected_matches(spieltag_raw: Mapping[str, Any], rules: FLSaisonRules) -> dict[str, Any]:
    """One raw matchday with its derived `anzahl_spiele` attached, ready to validate.

    Every path validating a stored matchday goes through this, the echo included: the count is on
    no document, so an echo skipping it reports a matchday with no matches.
    """

    return {**spieltag_raw, "anzahl_spiele": expected_matches(rules, spieltag_raw["saison_phase"])}


# What each code below refuses is `docs/logging/error-codes.md`.
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


# `position` and `beginn` order a phase independently, so nothing else stops a season from showing
# its matchdays in one order and dating them in another. `ende` is left free: it is the escape a
# postponement takes, and the message names it.
SPIELTAG_BEGINN_OUT_OF_ORDER = "REQ-DATE-008"


@dataclass(frozen=True)
class DatedNeighbour:
    """One dated matchday beside the one being re-dated, inside the same phase of the same season."""

    position: int
    beginn: str


def dated_beginn(spieltag_raw: Mapping[str, Any]) -> str | None:
    """One stored `beginn` as the rule takes it, or `None` for an undated row.

    `app/core/constraints.py :: Collection.SPIELTAGE` validates the field string-or-null, so nothing
    converts it: a `str()` would turn an undated row into a day above every ISO date.
    """

    return spieltag_raw["beginn"]


def dated_neighbour(spieltag_raw: Mapping[str, Any] | None) -> DatedNeighbour | None:
    """The neighbouring row as the refusal takes it, or `None` where that side holds no dated matchday."""

    if spieltag_raw is None:
        return None

    beginn = dated_beginn(spieltag_raw)

    return None if beginn is None else DatedNeighbour(position=spieltag_raw["position"], beginn=beginn)


def find_spieltag_order_refusal(
    *,
    beginn: str,
    ende: str,
    stored_beginn: str | None,
    previous: DatedNeighbour | None,
    following: DatedNeighbour | None,
) -> WriteRefusal | None:
    """Why this matchday's `beginn` must be refused for its place in the phase, or `None`.

    `previous` and `following` are the nearest DATED matchday below and above this `position`; an
    undated one states no date to compare, so the caller passes neither.
    """

    # The STEP, never the state (`docs/backend/spec.md :: I44`): an `ende`-only edit resubmits this
    # `beginn`. A first dating moves from no pair at all, so it is judged against both neighbours.
    moved_earlier = stored_beginn is None or beginn < stored_beginn
    moved_later = stored_beginn is None or beginn > stored_beginn

    # The predecessor first, and both are reachable at once only for a first dating landing between
    # two neighbours already out of order: the earlier position is the pair a reader checks first.
    if previous is not None and moved_earlier and beginn < previous.beginn:
        # A stored `beginn` already below the predecessor's is the floor the STEP leaves: the rule
        # takes it back unchanged, so naming the predecessor's day would refuse ground it gives.
        floor = (
            f"its `beginn` cannot go earlier than the {stored_beginn} it already stands on"
            if stored_beginn is not None and stored_beginn < previous.beginn
            else "its `beginn` cannot go earlier than that"
        )

        return WriteRefusal(
            error_code=SPIELTAG_BEGINN_OUT_OF_ORDER,
            # Below the floor the goal is reachable at fixture level alone: the predecessor's own
            # matches move into the later days, and no `beginn` moves at all.
            message=f"this matchday begins {beginn} and position {previous.position} of its phase begins {previous.beginn}; "
            f"{floor}; to play this one first, widen position {previous.position}'s `ende` "
            "and move that matchday's own fixtures into the later days",
        )

    if following is not None and moved_later and following.beginn < beginn:
        # `ende` is never below `beginn` on the payload (`FLPatchSpieltagPayload`), so a span reaching
        # here already runs past the follower and asking for a wider one would name a step taken.
        opening = (
            f"to postpone this one, restore its `beginn` of {stored_beginn}"
            if stored_beginn is not None
            else f"it holds no `beginn` to keep, so date it at or before {following.beginn}"
        )

        return WriteRefusal(
            error_code=SPIELTAG_BEGINN_OUT_OF_ORDER,
            message=f"this matchday begins {beginn} and position {following.position} of its phase begins {following.beginn}; "
            f"{opening} and save that with this `ende` of {ende}, which already runs past that day, "
            "then re-date its fixtures inside that span",
        )

    return None
