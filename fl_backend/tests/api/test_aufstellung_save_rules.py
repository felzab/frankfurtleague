"""
API · the rules a line-up's save judges whom it names by, pinned on fabricated squads

A nominee is named only while the line-up names fewer than eleven regular players, and no more of them than the gap;
and eleven start at most, an erased pupil's kept entry among them.
"""

import pytest
from bson import ObjectId

from app.api.aufstellungen.schemas import FLAufstellungEntry
from app.api.aufstellungen.services import find_nominee_refusal, find_not_in_kader_refusal, judge_the_names, newly_named
from app.core.codes import Code
from app.core.exceptions import APIError
from app.core.sentinels import GHOST_SPIELER_ID
from app.shared.schemas.bounds import AUFSTELLUNG_STARTERS_MAX

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
    # The bound the screen words the eleven from: dropped, its line would fall to the unexpected one.
    assert refusal is None or (refusal.fields, refusal.bounds) == ((("spieler",),), {"max": AUFSTELLUNG_STARTERS_MAX})


def test_a_pupil_newly_named_outside_the_live_squad_is_refused_on_each_entry_naming_one():
    """The paths the screen marks its rows by: an entry stored before, or in the squad, is never among them."""

    outside, ausgetragen = ObjectId(), ObjectId()
    kader = [
        *({**row, "inactive_since": None} for row in KADER),
        {"spieler_id": ausgetragen, "is_nachnominiert": False, "inactive_since": "2026-10-01"},
    ]
    saved = {"spieler": [{"spieler_id": ausgetragen, "starts": False}]}
    entries = [FLAufstellungEntry(spieler_id=pupil, starts=False) for pupil in (REGULAR[0], outside, ausgetragen, outside)]

    refusal = find_not_in_kader_refusal(entries=entries, new=newly_named(entries, saved), kader=kader)

    assert refusal is not None
    assert (refusal.error_code, refusal.fields) == (Code.SPIELER_NOT_IN_KADER, (("spieler", 1, "spieler_id"), ("spieler", 3, "spieler_id")))


def test_a_save_naming_the_placeholder_is_refused_on_that_entry():
    """Stored, the placeholder would read as named before and pass, and a list keyed by the pupil collapses every erased entry into one."""

    saved = {"spieler": [{"spieler_id": REGULAR[0], "starts": True}, {"spieler_id": GHOST_SPIELER_ID, "starts": True}]}
    entries = [FLAufstellungEntry(spieler_id=pupil, starts=True) for pupil in (REGULAR[0], GHOST_SPIELER_ID)]
    kader = [{**row, "inactive_since": None} for row in KADER]

    with pytest.raises(APIError) as raised:
        judge_the_names(entries=entries, kept=[], new=newly_named(entries, saved), kader=kader)
    assert (raised.value.error_code, raised.value.fields) == (Code.SPIELER_NOT_IN_KADER, (("spieler", 1, "spieler_id"),))


@pytest.mark.parametrize(("kept", "refused"), [pytest.param(1, False, id="eleven in all"), pytest.param(2, True, id="twelve in all")])
def test_an_erased_pupils_kept_start_counts_toward_eleven(kept: int, refused: bool):
    """The payload's own rule sees ten starters either way: a twelfth stored start would go unnoticed on the public page."""

    entries = [FLAufstellungEntry(spieler_id=pupil, starts=True) for pupil in REGULAR[:10]]
    erased = [FLAufstellungEntry(spieler_id=GHOST_SPIELER_ID, starts=True)] * kept
    kader = [{**row, "inactive_since": None} for row in KADER]

    if not refused:
        judge_the_names(entries=entries, kept=erased, new=set(), kader=kader)
        return
    with pytest.raises(APIError) as raised:
        judge_the_names(entries=entries, kept=erased, new=set(), kader=kader)
    assert raised.value.error_code == Code.AUFSTELLUNG_STARTERS_EXCEED_ELEVEN
