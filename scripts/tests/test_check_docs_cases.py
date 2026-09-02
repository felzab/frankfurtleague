"""SCRIPTS · the loop that drives every registered check against its plant

`scripts/tests/test_check_docs.py` declares the fixture repository, the corpus it commits, the
plants and the `CASES` table; what stands here is the loop those cases are driven through. It costs
about as much as every other case in that file put together, and the gate's pytest step hands a
module whole to one worker, so it is timed beside them rather than behind them only while it is a
file of its own.

The table itself stays beside the plants, so `scripts/tests/test_check_docs.py ::
test_every_registered_check_and_verdict_has_a_plant` and the loop below read one `CASES`: a check
cannot be registered against a plant in one of them and unknown to the other.
"""

from __future__ import annotations

from test_check_docs import CASES, _mismatches


def test_every_check_reports_its_planted_violation() -> None:
    """Each plant raises exactly the findings its case declares -- no fewer, and nothing beside them."""
    wrong = _mismatches(CASES)
    assert not wrong, "\n".join(wrong)
