"""
API · the rules a line-up's save judges whom it names by, pinned on fabricated squads

A nominee is named only while the line-up names fewer than eleven regular players, and no more of them than the gap.
Only a pupil the stored line-up does not name is judged against the squad, and an entry naming nobody is one the stored
line-up holds, never one a save adds. The payload names each pupil once and eleven starters at most.
"""

from typing import Any

import pytest
from bson import ObjectId

from app.api.aufstellungen.schemas import FLAufstellungEntry
from app.api.aufstellungen.services import count_nameless, find_not_in_kader_refusal, judge_the_names, newly_named
from app.core.codes import Code
from app.core.exceptions import APIError
from app.shared.schemas.bounds import AUFSTELLUNG_STARTERS_MAX

# One past a side, so a line-up can name more regular players than start.
REGULAR = [ObjectId() for _ in range(12)]
NOMINEES = [ObjectId() for _ in range(2)]
KADER = [
    *({"spieler_id": pupil, "is_nachnominiert": False} for pupil in REGULAR),
    *({"spieler_id": pupil, "is_nachnominiert": True} for pupil in NOMINEES),
]
LIVE_KADER = [{**row, "inactive_since": None} for row in KADER]


def judged(entries: list[FLAufstellungEntry]) -> APIError | None:
    """The refusal a save naming `entries` meets, none of them newly named, or None: judged as the save judges, every rule in its order."""

    try:
        judge_the_names(entries=entries, new=set(), nameless=0, kader=LIVE_KADER)
    except APIError as refusal:
        return refusal

    return None


@pytest.mark.parametrize(
    ("regular", "nominees", "refused"),
    [
        pytest.param(10, 1, False, id="one nominee into a gap of one"),
        pytest.param(9, 2, False, id="two nominees into a gap of two"),
        pytest.param(10, 2, True, id="two nominees into a gap of one"),
        pytest.param(11, 1, True, id="a nominee beside eleven regular players"),
        pytest.param(12, 0, False, id="twelve regular players and no nominee"),
    ],
)
def test_nominees_fill_the_gap_below_eleven_and_no_more(regular: int, nominees: int, refused: bool):
    """Off by one here and a club fields a nominee a regular player's place was owed to, or is refused one it was owed.

    A club naming more regular players than a side, its bench among them, names no nominee and is refused nothing.
    """

    refusal = judged([FLAufstellungEntry(spieler_id=pupil, starts=False) for pupil in [*REGULAR[:regular], *NOMINEES[:nominees]]])

    assert (refusal is not None and refusal.error_code == Code.AUFSTELLUNG_NOMINEE_WITHOUT_SHORTAGE) is refused
    # The bound the screen words the eleven from: dropped, its line would fall to the unexpected one.
    assert refusal is None or [(fault.path, fault.bounds) for fault in refusal.faults] == [(("spieler",), {"max": AUFSTELLUNG_STARTERS_MAX})]


def test_a_pupil_newly_named_outside_the_live_kader_is_refused_on_each_entry_naming_one():
    """The paths the screen marks its rows by: an entry stored before, or in the squad, is never among them."""

    outside, withdrawn = ObjectId(), ObjectId()
    kader = [
        *({**row, "inactive_since": None} for row in KADER),
        {"spieler_id": withdrawn, "is_nachnominiert": False, "inactive_since": "2026-10-01"},
    ]
    saved = {"spieler": [{"spieler_id": withdrawn, "starts": False}]}
    entries = [FLAufstellungEntry(spieler_id=pupil, starts=False) for pupil in (REGULAR[0], outside, withdrawn, outside)]

    faults = find_not_in_kader_refusal(entries=entries, new=newly_named(entries, saved), nameless=0, kader=kader)

    assert [(fault.code, fault.path) for fault in faults] == [
        (Code.SPIELER_NOT_IN_KADER, ("spieler", 1, "spieler_id")),
        (Code.SPIELER_NOT_IN_KADER, ("spieler", 3, "spieler_id")),
    ]


def test_a_first_save_judges_everyone_it_names_against_the_kader():
    """With no stored line-up, none of its pupils is spared the squad's judgement.

    A pupil a stored line-up names is spared it, so the line-up keeps one ausgetragen since; the case above holds that.
    """

    entries = [FLAufstellungEntry(spieler_id=pupil, starts=False) for pupil in REGULAR[:2]]

    assert newly_named(entries, None) == set(REGULAR[:2])


def _starters(count: int) -> list[FLAufstellungEntry]:
    return [FLAufstellungEntry(spieler_id=pupil, starts=True) for pupil in [*REGULAR, *NOMINEES][:count]]


@pytest.mark.parametrize(
    ("entries", "refusals"),
    [
        pytest.param(_starters(AUFSTELLUNG_STARTERS_MAX), [], id="a whole side starting"),
        pytest.param(
            _starters(AUFSTELLUNG_STARTERS_MAX + 1),
            [(Code.STARTERS_EXCEED_ELEVEN, ("spieler",), {"max": AUFSTELLUNG_STARTERS_MAX})],
            id="one starter past a side",
        ),
        pytest.param(
            [FLAufstellungEntry(spieler_id=REGULAR[0], starts=True), FLAufstellungEntry(spieler_id=REGULAR[0], starts=False)],
            [(Code.SPIELER_NAMED_TWICE, ("spieler", 1, "spieler_id"), {})],
            id="one pupil twice, on the later entry",
        ),
        pytest.param(
            [FLAufstellungEntry(spieler_id=None, starts=True), FLAufstellungEntry(spieler_id=None, starts=False)],
            [],
            id="two entries naming nobody",
        ),
        # Each judged apart, so an answer naming the first alone leaves the second for a later press.
        pytest.param(
            [*_starters(AUFSTELLUNG_STARTERS_MAX + 1), FLAufstellungEntry(spieler_id=ObjectId(), starts=False)],
            [
                (Code.STARTERS_EXCEED_ELEVEN, ("spieler",), {"max": AUFSTELLUNG_STARTERS_MAX}),
                (Code.SPIELER_NOT_IN_KADER, ("spieler", AUFSTELLUNG_STARTERS_MAX + 1, "spieler_id"), {}),
            ],
            id="one starter past a side and a pupil outside the squad",
        ),
        # The pupil named twice is counted twice as a starter, so the count waits on the repair.
        pytest.param(
            [*_starters(AUFSTELLUNG_STARTERS_MAX), FLAufstellungEntry(spieler_id=REGULAR[0], starts=True)],
            [(Code.SPIELER_NAMED_TWICE, ("spieler", AUFSTELLUNG_STARTERS_MAX, "spieler_id"), {})],
            id="a starter twice, past a side only by the repeat",
        ),
    ],
)
def test_the_list_names_each_pupil_once_and_a_side_of_starters_at_most(entries: list[FLAufstellungEntry], refusals: list[Any]):
    """A `>=` refuses a team ticking a whole side; a pupil named twice counts twice towards the shortage above."""

    newcomers = {entry.spieler_id for entry in entries if entry.spieler_id is not None} - {row["spieler_id"] for row in KADER}
    try:
        judge_the_names(entries=entries, new=newcomers, nameless=len(entries), kader=LIVE_KADER)
        refused = []
    except APIError as refusal:
        refused = [(fault.code, fault.path, dict(fault.bounds)) for fault in refusal.faults]

    assert refused == refusals


@pytest.mark.parametrize(("sent", "refused"), [pytest.param(1, (), id="the one stored"), pytest.param(2, (2,), id="one more")])
def test_a_save_keeps_the_entries_naming_nobody_and_adds_none(sent: int, refused: tuple[int, ...]):
    """Only an erasure makes an entry naming nobody: one a save added would field a place in a played match nobody filled."""

    saved = {"spieler": [{"spieler_id": REGULAR[0], "starts": True}, {"spieler_id": None, "starts": True}]}
    entries = [
        FLAufstellungEntry(spieler_id=REGULAR[0], starts=True),
        *(FLAufstellungEntry(spieler_id=None, starts=False) for _ in range(sent)),
    ]

    faults = find_not_in_kader_refusal(entries=entries, new=newly_named(entries, saved), nameless=count_nameless(saved), kader=LIVE_KADER)

    assert [(fault.code, fault.path) for fault in faults] == [
        (Code.SPIELER_NOT_IN_KADER, ("spieler", index, "spieler_id")) for index in refused
    ]


def test_a_first_save_adds_no_entry_naming_nobody():
    """No line-up is stored yet, so it holds no entry naming nobody for the save to keep."""

    entries = [FLAufstellungEntry(spieler_id=None, starts=True)]

    faults = find_not_in_kader_refusal(entries=entries, new=set(), nameless=count_nameless(None), kader=[])

    assert [(fault.code, fault.path) for fault in faults] == [(Code.SPIELER_NOT_IN_KADER, ("spieler", 0, "spieler_id"))]
