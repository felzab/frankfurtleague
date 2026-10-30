from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from http import HTTPStatus
from typing import Any

from app.api.saisons.schedule import expected_matches
from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.schemas import PHASE_ORDER, PHASE_RANK
from app.api.spieltage.schemas import FLSpieltag, FLSpieltageFilterParams
from app.core.codes import Code
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


def build_erster_spieltag_filter(*, saison_id: str) -> dict[str, Any]:
    """Matchday 1 of a season, whose `beginn` opens the Nachnominierung period.

    The phase is named because `position` restarts at 1 in every phase: the position alone matches
    one row per phase, and the driver answers whichever it meets first.
    """

    return {"saison_id": saison_id, "saison_phase": PHASE_ORDER[0], "position": 1}


# The period's one test: a second spelling lets the invite
# tell a pupil one thing while the squad row stores another.
def nachnominierung_laeuft(*, beginn: Any, today: str) -> bool:
    """Whether an entry made on `today` is a Nachnominierung, on the rule's terms."""

    # A type test rather than truthiness: an undated matchday stores `None`, and a value of any other
    # type is no date this comparison can order.
    return isinstance(beginn, str) and beginn <= today


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
            error_code=Code.SPIELTAG_OUTSIDE_SAISON,
            status=HTTPStatus.CONFLICT,
        )

    outside = sorted(datum for datum in fixture_dates if datum < beginn or datum > ende)
    if outside:
        return WriteRefusal(
            error_code=Code.SPIELTAG_SPAN_BELOW_SPIELE,
            status=HTTPStatus.CONFLICT,
        )

    return None


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
    stored_beginn: str | None,
    previous: DatedNeighbour | None,
    following: DatedNeighbour | None,
) -> WriteRefusal | None:
    """Why this matchday's `beginn` must be refused for its place in the phase, or `None`.

    `previous` and `following` are the nearest DATED matchday below and above this `position`; an
    undated one states no date to compare, so the caller passes neither.
    """

    # The STEP, never the state: an `ende`-only edit resubmits this
    # `beginn`. A first dating moves from no pair at all, so it is judged against both neighbours.
    moved_earlier = stored_beginn is None or beginn < stored_beginn
    moved_later = stored_beginn is None or beginn > stored_beginn

    # The predecessor first, and both are reachable at once only for a first dating landing between
    # two neighbours already out of order: the earlier position is the pair a reader checks first.
    if previous is not None and moved_earlier and beginn < previous.beginn:
        return WriteRefusal(
            error_code=Code.SPIELTAG_BEGINN_OUT_OF_ORDER,
            status=HTTPStatus.CONFLICT,
        )

    if following is not None and moved_later and following.beginn < beginn:
        return WriteRefusal(
            error_code=Code.SPIELTAG_BEGINN_OUT_OF_ORDER,
            status=HTTPStatus.CONFLICT,
        )

    return None
