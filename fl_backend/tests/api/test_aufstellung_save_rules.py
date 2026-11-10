"""
API · the shortage rule a line-up's save holds its nominees to, pinned on fabricated squads

A nominee is named only while the line-up names fewer than eleven regular players, and no more of them than the gap.
"""

import pytest
from bson import ObjectId

from app.api.aufstellungen.schemas import FLAufstellungEntry
from app.api.aufstellungen.services import find_nominee_refusal
from app.core.codes import Code

REGULAR = [ObjectId() for _ in range(11)]
NOMINEES = [ObjectId() for _ in range(2)]
KADER = [
    *({"spieler_id": pupil, "is_nachnominiert": False} for pupil in REGULAR),
    *({"spieler_id": pupil, "is_nachnominiert": True} for pupil in NOMINEES),
]


@pytest.mark.parametrize(
    ("regular", "nominees", "refused"),
    [
        pytest.param(10, 1, False, id="one nominee into a gap of one"),
        pytest.param(9, 2, False, id="two nominees into a gap of two"),
        pytest.param(10, 2, True, id="two nominees into a gap of one"),
        pytest.param(11, 1, True, id="a nominee beside eleven regular players"),
        pytest.param(11, 0, False, id="eleven regular players and no nominee"),
    ],
)
def test_nominees_fill_the_gap_below_eleven_and_no_more(regular: int, nominees: int, refused: bool):
    """Off by one here and a club fields a nominee a regular player's place was owed to, or is refused one it was owed."""

    entries = [FLAufstellungEntry(spieler_id=pupil, starts=False) for pupil in [*REGULAR[:regular], *NOMINEES[:nominees]]]
    refusal = find_nominee_refusal(entries=entries, kader=KADER)

    assert (refusal is not None and refusal.error_code == Code.AUFSTELLUNG_NOMINEE_WITHOUT_SHORTAGE) is refused
