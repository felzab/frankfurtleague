"""SCRIPTS · the orchestration skill's core, held to the size compaction re-attaches whole.

Compaction re-attaches the first 5,000 tokens of each invoked skill, and Anthropic's skill guide
sizes a SKILL.md body under 5k tokens: past that, a compacted coordinator works from a truncated copy
without the rules cut away. A measured compaction of this page kept 19,908 bytes of its body at
5,000 tokens, about 4 bytes a token, so a ceiling of 16,000 bytes holds the core near 4,000 tokens,
a fifth under the cut, for wording denser in tokens than the page that was measured.
"""

from __future__ import annotations

import re
from typing import Final

from conftest import REPO_ROOT

SKILL: Final = REPO_ROOT / ".claude" / "skills" / "orchestration"
CORE: Final = SKILL / "SKILL.md"
CEILING_BYTES: Final = 16_000
# My own message sequences, which the coordinator never reads.
OWNER_PAGES: Final = frozenset({"USAGE.md"})
LINK_RE: Final = re.compile(r"\]\(([^)#]+\.md)\)")


def test_the_core_stays_under_the_size_compaction_keeps_whole() -> None:
    size = len(CORE.read_bytes())
    assert size <= CEILING_BYTES, f"SKILL.md is {size} bytes, over {CEILING_BYTES}: move a once-per-session procedure to its phase file"


def test_every_file_beside_the_core_is_linked_from_it() -> None:
    """References stay one level deep: a file the core never names is one a coordinator never opens."""
    linked = set(LINK_RE.findall(CORE.read_bytes().decode("utf-8")))
    beside = {path.name for path in SKILL.glob("*.md")} - {CORE.name} - OWNER_PAGES
    assert beside <= linked, f"not linked from SKILL.md: {sorted(beside - linked)}"


def test_the_session_id_renders_in_the_core() -> None:
    """The harness substitutes it in invoked skill content only: a file opened with Read keeps the placeholder."""
    assert "${CLAUDE_SESSION_ID}" in CORE.read_bytes().decode("utf-8")
