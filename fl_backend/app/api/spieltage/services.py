from typing import Any, Mapping, Sequence

from app.api.saisons.schedule import expected_matches
from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.schemas import PHASE_RANK
from app.api.spieltage.schemas import FLSpieltag, FLSpieltageFilterParams
from app.core.crud import build_query, build_sort
from app.core.exceptions import WriteRefusal


def build_spieltage_sort(sort_by: str, order: str) -> list[tuple[str, int]]:
    """The Mongo sort -- for the natural order an APPROXIMATION, refined by `order_spieltage`.

    `position` first, which is exact inside one phase; the phase RANK is on no document, so nothing
    a `find` can sort on separates the phases and `limit` may keep a prefix from each.
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

    The id stays the last tie-break for a list spanning two seasons, where one phase's positions
    repeat; `uniq_saison_id_saison_phase_position` makes it unreachable within one season.
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
