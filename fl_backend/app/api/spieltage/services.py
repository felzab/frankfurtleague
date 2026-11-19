from collections.abc import Iterable, Mapping, Sequence
from http import HTTPStatus
from typing import Any

from app.api.spiele.schemas import PHASE_RANK, is_unplayed
from app.api.spieltage.schemas import (
    FLSpielplanSpieltag,
    FLSpielplanSpieltagAdmin,
    FLSpielplanSpieltagAdminListAdapter,
    FLSpielplanSpieltagListAdapter,
    FLSpieltag,
)
from app.core.codes import Code
from app.core.exceptions import APIError
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.literals import FLSaisonStatus


def order_spieltage[Spieltag: FLSpieltag](spieltage: list[Spieltag]) -> list[Spieltag]:
    """A season's matchdays in the order they are played: phase, then the stored `position`.

    The id tie-breaks a list spanning two seasons, whose positions repeat;
    `uniq_saison_id_saison_phase_position` makes that unreachable within one.
    """

    return sorted(spieltage, key=lambda spieltag: (PHASE_RANK[spieltag.saison_phase], spieltag.position, str(spieltag.id)))


def _with_their_spiele(spieltage_raw: Iterable[Mapping[str, Any]], spiele_raw: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    spiele_by_spieltag: dict[Any, list[Mapping[str, Any]]] = {}
    for spiel_raw in sorted(spiele_raw, key=lambda spiel_raw: spiel_raw["spiel_nr"]):
        spiele_by_spieltag.setdefault(spiel_raw["spieltag_id"], []).append(spiel_raw)

    return [{**raw, "spiele": spiele_by_spieltag.get(raw["_id"], [])} for raw in spieltage_raw]


def build_spielplan(spieltage_raw: Iterable[Mapping[str, Any]], spiele_raw: Iterable[Mapping[str, Any]]) -> list[FLSpielplanSpieltag]:
    """A season's matchdays in the order they are played, each holding its matches by `spiel_nr`.

    `spiele_raw` is what `build_spiele_pipeline` yields for the same season.
    """

    return order_spieltage(FLSpielplanSpieltagListAdapter.validate_python(_with_their_spiele(spieltage_raw, spiele_raw)))


def build_admin_spielplan(
    spieltage_raw: Iterable[Mapping[str, Any]], spiele_raw: Iterable[Mapping[str, Any]]
) -> list[FLSpielplanSpieltagAdmin]:
    """`build_spielplan`'s matchdays, their matches in the admin shape: money, the referee's whole name and `version`."""

    return order_spieltage(FLSpielplanSpieltagAdminListAdapter.validate_python(_with_their_spiele(spieltage_raw, spiele_raw)))


def current_spieltag_id(spieltage: Sequence[FLSpielplanSpieltag], *, saison_status: FLSaisonStatus) -> CustomObjectId | None:
    """The matchday the Spielplan opens on: the first holding a match still to be played, else the last.

    A finished season has nothing left to play, whatever its fixtures still lack, so it opens on its last.
    """

    if saison_status != "past":
        for spieltag in spieltage:
            if any(is_unplayed(ergebnis=spiel.ergebnis, sonderereignis=spiel.sonderereignis) for spiel in spieltag.spiele):
                return spieltag.id

    return spieltage[-1].id if spieltage else None


def find_spieltag_span_refusal(
    *,
    start: str,
    end: str,
    saison_start: str,
    saison_end: str,
    spiel_dates: Sequence[str],
) -> APIError | None:
    """Why this matchday's span must be refused, or `None`.

    `spiel_dates` is every dated fixture of the matchday; an undated one constrains nothing.
    """

    if start < saison_start or end > saison_end:
        return APIError(HTTPStatus.CONFLICT, Code.SPIELTAG_OUTSIDE_SAISON)

    outside = sorted(date for date in spiel_dates if date < start or date > end)
    if outside:
        return APIError(HTTPStatus.CONFLICT, Code.SPIELTAG_SPAN_BELOW_SPIELE)

    return None


def find_spieltag_order_refusal(
    *,
    start: str,
    stored_start: str | None,
    previous_start: str | None,
    following_start: str | None,
) -> APIError | None:
    """Why this matchday's `start` must be refused for its place in the phase, or `None`.

    `previous_start` and `following_start` are the starts of the nearest dated matchday below and above this
    `position`, `None` where that side holds none; an undated one states no date to compare, so the caller steps over it.
    """

    # The step, never the state: an `end`-only edit resubmits this
    # `start`. A first dating moves from no pair at all, so it is judged against both neighbours.
    moved_earlier = stored_start is None or start < stored_start
    moved_later = stored_start is None or start > stored_start

    # The predecessor first, and both are reachable at once only for a first dating landing between
    # two neighbours already out of order: the earlier position is the pair a reader checks first.
    if previous_start is not None and moved_earlier and start < previous_start:
        return APIError(HTTPStatus.CONFLICT, Code.SPIELTAG_START_OUT_OF_ORDER)

    if following_start is not None and moved_later and following_start < start:
        return APIError(HTTPStatus.CONFLICT, Code.SPIELTAG_START_OUT_OF_ORDER)

    return None
