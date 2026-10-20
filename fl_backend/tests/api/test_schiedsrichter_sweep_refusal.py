"""
API · the share one call of the lapsed address's clock takes

Arithmetic alone, so the default tier holds it; the clock against a real mongod is
`tests/api/test_schiedsrichter_sweep_execution.py`'s.
"""

from app.api.schiedsrichter import sweep_router
from app.core.middlewares import REQUEST_DEADLINE_S

# One referee's commands on the wire and one pupil's, pinned by
# `fl_backend/tests/api/test_schiedsrichter_sweep_execution.py :: TestOneRowCostsTheCommandsItsShareIsSizedAt`.
COMMANDS_A_REFEREE = 7
COMMANDS_A_PUPIL = 7

# A due change moving a pupil row and a confirmed referee row, pinned by
# `fl_backend/tests/api/test_schiedsrichter_sweep_execution.py :: TestADueChangeCostsTheCommandsItsShareIsSizedAt`. More
# records cost more, and the call's deadline stops it at that change (`docs/backend/spec.md :: I322`).
COMMANDS_A_DUE_PERSON = 17

# The call's other command, one aggregate answering one document at any size, pinned on the wire by
# `fl_backend/tests/api/test_schiedsrichter_sweep_execution.py :: TestTheWorstCallSendsTheCommandsItsBudgetCounts`.
OTHER_COMMANDS = 1

# The running season a page holding a due change asks once, where the season cache holds none.
SEASON_READ = 1

# The per-command cost, the largest of two windows timing whole calls locally, 2026-10-16.
PER_COMMAND_S = 0.00184

# The round trip `sweep_router.ADRESSWECHSEL_PER_PASS`'s comment sizes the share for.
ROUND_TRIP_S = 0.037


def test_a_full_share_finishes_inside_the_deadline_at_the_round_trip_its_comment_names():
    """A share raised past its budget passes every case counting its own rows, and times out a whole call in production.

    Sized at the dearest row, a share being any mix of lapses and due changes.
    """

    dearest = max(COMMANDS_A_REFEREE, COMMANDS_A_PUPIL, COMMANDS_A_DUE_PERSON)

    assert (sweep_router.ADRESSWECHSEL_PER_PASS * dearest + OTHER_COMMANDS + SEASON_READ) * (ROUND_TRIP_S + PER_COMMAND_S) < REQUEST_DEADLINE_S


def test_the_share_is_the_largest_the_deadline_takes():
    """One more and the call outruns the deadline: the share is cut from the count, never raised past it."""

    dearest = max(COMMANDS_A_REFEREE, COMMANDS_A_PUPIL, COMMANDS_A_DUE_PERSON)

    assert ((sweep_router.ADRESSWECHSEL_PER_PASS + 1) * dearest + OTHER_COMMANDS + SEASON_READ) * (
        ROUND_TRIP_S + PER_COMMAND_S
    ) >= REQUEST_DEADLINE_S
