"""
API · what a pupil's own page reads of one season

Apart from `schemas.py`, which the season's models import: this read model is built from a club page's fixture, so it
stands above both.
"""

from app.api.saisons.schemas import FLTeamPageSpiel
from app.api.spieler.schemas import FLSpielerSelfKaderRow
from app.shared.schemas.responses import BaseAPIResponse


class FLSpielerSaisonSelfSpiel(FLTeamPageSpiel):
    """One fixture of the pupil's club, with their own place in the club's line-up for it."""

    # True where the stored line-up starts them, false where it benches them, and null where it does not name them or
    # the club has stored none.
    starts: bool | None


class FLSpielerSaisonSelfResponse(BaseAPIResponse):
    """A pupil's own season: where they play, and their club's fixtures."""

    saison_id: str
    # Every season the pupil holds a squad row in, newest first, which the page's season button offers.
    saison_ids: list[str]
    # Their squad row of this season, a deregistered one included; null where they hold none.
    kader: FLSpielerSelfKaderRow | None
    # Empty where they hold no squad row of this season.
    spiele: list[FLSpielerSaisonSelfSpiel]
