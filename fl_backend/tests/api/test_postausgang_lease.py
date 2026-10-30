"""
API · the Postausgang's lease against the frontend's bounds on a drain

A claim's rows go to the next drain once its lease lapses, so a lease shorter than a page at its worst hands a row out
again while the first drain may still send it: a second mail in the inbox, under a fresh link. The bounds are the
frontend's, read off its source.
"""

import re
from pathlib import Path

from app.api.outbox.services import LEASE_DURATION, SEITE

FRONTEND_CORE = Path(__file__).resolve().parents[3] / "fl_frontend" / "src" / "core"


def _ms(module: str, name: str) -> int:
    path = FRONTEND_CORE / module
    found = re.search(rf"^const {name} = (\d+);$", path.read_text(encoding="utf-8"), re.MULTILINE)
    assert found is not None, f"{path} no longer declares `{name}` where this reads it"

    return int(found[1])


def test_the_lease_outlasts_a_page_of_sends_and_reports_at_their_bounds():
    call_s = _ms("api.ts", "FETCH_TIMEOUT_MS") / 1000
    send_s = _ms("mail.ts", "MAIL_TIMEOUT_MS") / 1000

    # The claim's own answer, then each send and the report after it.
    assert call_s + SEITE * (send_s + call_s) < LEASE_DURATION.total_seconds()
