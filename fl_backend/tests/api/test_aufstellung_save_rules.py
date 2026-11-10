"""
API · the rules a line-up's save holds the whole written list to, pinned on fabricated squads

A nominee is named only while the line-up names fewer than eleven regular players, and no more of them than the gap;
and eleven start at most, an erased pupil's kept entry among them. Only a pupil the stored line-up does not name is
judged against the squad. The payload names each pupil once and eleven starters at most.
"""

from typing import Any

import pytest
from bson import ObjectId
from pydantic import ValidationError

from app.api.aufstellungen.schemas import FLAufstellungEntry, FLAufstellungPayload
from app.api.aufstellungen.services import find_nominee_refusal, judge_the_names, newly_named
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


@pytest.mark.parametrize(
    ("saved", "judged"),
    [
        pytest.param(None, {0, 1}, id="a first save judges everyone"),
        pytest.param({"spieler": [{"spieler_id": REGULAR[0], "starts": True}]}, {1}, id="a pupil already named is not judged again"),
    ],
)
def test_only_a_pupil_the_stored_line_up_does_not_name_is_judged_against_the_squad(saved: dict[str, Any] | None, judged: set[int]):
    """So a line-up keeps a pupil ausgetragen or erased since it named them, and judges a newcomer all the same."""

    entries = [FLAufstellungEntry(spieler_id=pupil, starts=False) for pupil in REGULAR[:2]]

    assert newly_named(entries, saved) == {REGULAR[index] for index in judged}


def _starters(count: int) -> list[dict[str, Any]]:
    return [{"spieler_id": pupil, "starts": True} for pupil in [*REGULAR, *NOMINEES][:count]]


@pytest.mark.parametrize(
    ("entries", "refusals"),
    [
        pytest.param(_starters(AUFSTELLUNG_STARTERS_MAX), [], id="a whole side starting"),
        pytest.param(
            _starters(AUFSTELLUNG_STARTERS_MAX + 1),
            [("starters_exceed_eleven", {"max": AUFSTELLUNG_STARTERS_MAX})],
            id="one starter past a side",
        ),
        pytest.param(
            [{"spieler_id": REGULAR[0], "starts": True}, {"spieler_id": REGULAR[0], "starts": False}],
            [("spieler_named_twice", None)],
            id="one pupil twice",
        ),
    ],
)
def test_the_list_names_each_pupil_once_and_a_side_of_starters_at_most(entries: list[dict[str, Any]], refusals: list[Any]):
    """A `>=` refuses a team ticking a whole side; a pupil named twice counts twice towards the shortage above."""

    try:
        FLAufstellungPayload.model_validate({"spieler": entries, "version": None})
        refused = []
    except ValidationError as failure:
        refused = [(error["type"], error.get("ctx")) for error in failure.errors()]

    assert refused == refusals


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
