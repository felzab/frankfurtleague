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

from typing import Any

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
