"""
API · the share one call of the address change's clock takes

Arithmetic alone, so the default tier holds it; the clock against a real mongod is
`tests/api/test_adresswechsel_sweep_execution.py`'s.
"""

from app.api.adresswechsel import sweep_router
from app.core.middlewares import REQUEST_DEADLINE_S

# One lapsed change's commands on the wire, pinned by
# `fl_backend/tests/api/test_adresswechsel_sweep_execution.py :: TestALapseCostsTheCommandsItsShareIsSizedAt`.
COMMANDS_A_LAPSE = 6

# A due change moving a pupil row and a confirmed referee row, pinned by
# `fl_backend/tests/api/test_adresswechsel_sweep_execution.py :: TestADueChangeCostsTheCommandsItsShareIsSizedAt`. No
# retention rule bounds an address's records, so a dearer change meets the deadline, moving nothing (`:: TestTheDeadlineStopsTheCall`).
COMMANDS_A_DUE_PERSON = 48

# The call's other command, one aggregate answering one document at any size, pinned on the wire by
# `fl_backend/tests/api/test_adresswechsel_sweep_execution.py :: TestTheWorstCallSendsTheCommandsItsBudgetCounts`.
OTHER_COMMANDS = 1

# The running season a page holding a due change asks once, where the season cache holds none.
SEASON_READ = 1

# The per-command cost, the largest of two windows timing whole calls of lapses locally, 2026-10-16; a due change's
# commands timed lower, 2026-10-20.
PER_COMMAND_S = 0.00184

# The round trip `sweep_router.ADRESSWECHSEL_PER_PASS`'s comment sizes the share for.
ROUND_TRIP_S = 0.037


def test_a_full_share_finishes_inside_the_deadline_at_the_round_trip_its_comment_names():
    """A share raised past its budget passes every case counting its own changes, and times out a whole call in production.

    Sized at the dearer of a lapse and a due pupil-and-referee change, which a share mixes.
    """

    dearest = max(COMMANDS_A_LAPSE, COMMANDS_A_DUE_PERSON)

    assert (sweep_router.ADRESSWECHSEL_PER_PASS * dearest + OTHER_COMMANDS + SEASON_READ) * (ROUND_TRIP_S + PER_COMMAND_S) < REQUEST_DEADLINE_S


def test_the_share_is_the_largest_the_deadline_takes():
    """One more and the call outruns the deadline: the share is cut from the count, never raised past it."""

    dearest = max(COMMANDS_A_LAPSE, COMMANDS_A_DUE_PERSON)

    assert ((sweep_router.ADRESSWECHSEL_PER_PASS + 1) * dearest + OTHER_COMMANDS + SEASON_READ) * (
        ROUND_TRIP_S + PER_COMMAND_S
    ) >= REQUEST_DEADLINE_S
