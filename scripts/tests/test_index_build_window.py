"""The frontend stops asking for an unanswered index build within the deploy's wait.

`fl_frontend/src/core/authIndexes.ts :: ANSWERED_WITHIN_MS` bounds how long a run of the sign-in store's index builds
asks again for a build the store has not answered, before it writes `auth.index_unbuilt`. The runbook reads the
frontend's log for that event once `scripts/ops/deploy.sh` ends, which it does within `WAIT_S`. A bound above the wait
leaves an unanswered build unwritten when the read comes, so the read finds nothing and calls every index built. Each
file moves on its own, and nothing else compares them.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Final

from conftest import REPO_ROOT

DEPLOY: Final = REPO_ROOT / "scripts" / "ops" / "deploy.sh"
AUTH_INDEXES: Final = REPO_ROOT / "fl_frontend" / "src" / "core" / "authIndexes.ts"

WAIT_RE: Final = re.compile(r"^WAIT_S=(\d+)$", re.MULTILINE)
# A numeric literal with or without its separators, which is the one shape the bound is written in.
BOUND_RE: Final = re.compile(r"^const ANSWERED_WITHIN_MS = (\d[\d_]*);$", re.MULTILINE)


def only(pattern: re.Pattern[str], path: Path) -> int:
    """The one value `pattern` reads in `path`: none or two is a reshaped line this reader must learn."""
    found = pattern.findall(path.read_text(encoding="utf-8"))
    assert len(found) == 1, f"{path.relative_to(REPO_ROOT)}: {len(found)} lines match {pattern.pattern}, where this reader takes one"
    return int(found[0].replace("_", ""))


def test_the_build_window_ends_within_the_deploy_s_wait() -> None:
    wait_ms = only(WAIT_RE, DEPLOY) * 1000
    bound_ms = only(BOUND_RE, AUTH_INDEXES)
    assert bound_ms <= wait_ms, (
        f"authIndexes.ts asks again for an unanswered build for {bound_ms} ms, past deploy.sh's {wait_ms} ms wait: "
        "the runbook's read after a deploy would miss the line"
    )
