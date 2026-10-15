"""
API · the share one call of the lapsed referee address's clock takes

Arithmetic alone, so the default tier holds it; the clock against a real mongod is
`tests/api/test_schiedsrichter_sweep_execution.py`'s.
"""

from app.api.schiedsrichter import sweep_router
from app.core.middlewares import REQUEST_DEADLINE_S

# One referee's commands on the wire, pinned by
# `fl_backend/tests/api/test_schiedsrichter_sweep_execution.py :: TestOneRefereeCostsTheCommandsItsShareIsSizedAt`.
COMMANDS_A_REFEREE = 6

# The call's other commands, two on the wire while its read fits the driver's first batch and one more
# past it; the per-command cost the largest of two windows timing whole calls locally, 2026-10-16.
OTHER_COMMANDS = 2 + 1
PER_COMMAND_S = 0.00184

# The round trip `sweep_router.ADRESSWECHSEL_PER_PASS`'s comment sizes the share for.
ROUND_TRIP_S = 0.037


def test_a_full_share_finishes_inside_the_deadline_at_the_round_trip_its_comment_names():
    """A share raised past its budget passes every case counting its own referees, and times out a whole call in production."""

    assert (sweep_router.ADRESSWECHSEL_PER_PASS * COMMANDS_A_REFEREE + OTHER_COMMANDS) * (ROUND_TRIP_S + PER_COMMAND_S) < REQUEST_DEADLINE_S
