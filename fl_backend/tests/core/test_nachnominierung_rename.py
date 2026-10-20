"""
CORE · that no tracked file but this one names the late-entry marker's old spelling

A stored-key rename is where a green tree ships a dead field: a label left in a component nobody
opened reads as the marker's absence, and a test string left behind stops checking anything. This
module spells the stem to find it, so the assertion is an exact set holding this module alone.

This module carries no database marker, so the default tier runs it — which the `backend` gate
scope carries and a frontend-only run does not, leaving a label renamed back in `fl_frontend/`
unswept until the next run that reaches this scope.
"""

import re
import subprocess
from pathlib import Path
from typing import Final

import pytest

from tests.openapi_document import REGENERATE

REPO_ROOT: Final = Path(__file__).resolve().parents[3]

# The STEM, case-insensitively: the stored key, the camel-case draft field, the banner id and the
# German word a person reads are one miss, and a pattern naming the stored key alone passes over
# the other three.
OLD_SPELLING: Final = re.compile("nachgetragen", re.IGNORECASE)

# git's own binary test, at `buffer_is_binary`: a NUL in the first 8000 bytes.
BINARY_SNIFF_BYTES: Final = 8000

# This module's own pattern and sample. `fl_backend/openapi.json` is regenerated from the models, which
# declare the new key alone, so it is never a member.
SPELLING_IT: Final = frozenset({"fl_backend/tests/core/test_nachnominierung_rename.py"})

# The one path this assertion cannot be green without and nobody may hand-edit: the published
# contract, regenerated from the models by whoever commits.
PENDING_AT_ASSEMBLY: Final = "fl_backend/openapi.json"

# Each spelling the tree held before the rename, so a reader narrowed to one of them fails here
# rather than passing over the rest of the tree in silence.
SAMPLE: Final = ("is_nachgetragen", "isNachgetragen", "setIsNachgetragen", "NACHGETRAGEN", "Nachgetragen", "nachgetragen")


def _files_git_would_keep() -> list[Path]:
    """Git's listing rather than a walk, and its unstaged half too.

    A file the branch has only just added is where a missed rename hides, and `--exclude-standard`
    is what leaves a scratch path out.
    """

    try:
        done = subprocess.run(
            ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=False,
        )
    except OSError as launch:
        pytest.fail(f"git could not be launched, so no file was read: {launch}")

    if done.returncode != 0:
        pytest.fail(f"git listed no files (exit {done.returncode}), so this assertion read nothing: {done.stderr.strip()}")

    return [REPO_ROOT / name for name in done.stdout.split("\0") if name]


def _names_the_old_spelling(path: Path) -> bool:
    raw = path.read_bytes()
    if b"\x00" in raw[:BINARY_SNIFF_BYTES]:
        return False

    # Lenient, because the stem is ASCII: a replacement character can neither invent a hit nor hide one.
    return OLD_SPELLING.search(raw.decode("utf-8", errors="replace")) is not None


class TestTheReader:
    """A sample as well as the tree: every hit surviving in the tree is one spelling, so the tree alone cannot show the others are read."""

    def test_it_finds_every_spelling_the_rename_moved(self):
        assert [text for text in SAMPLE if OLD_SPELLING.search(text)] == list(SAMPLE)

    def test_it_finds_nothing_in_the_new_vocabulary(self):
        assert OLD_SPELLING.search("ist_nachnominiert istNachnominiert Nachnominiert kader-nachnominiert") is None


def test_only_this_module_names_the_marker_s_old_spelling():
    found: set[str] = set()
    unreadable: list[str] = []

    for path in _files_git_would_keep():
        shown = path.relative_to(REPO_ROOT).as_posix()
        try:
            if _names_the_old_spelling(path):
                found.add(shown)
        except OSError as failure:
            # Named rather than raised: git lists a deleted file until the deletion is staged, and a
            # traceback here would name neither this rule nor the file that tripped it.
            unreadable.append(f"{shown} ({failure.strerror})")

    assert not unreadable, "these listed files could not be read, so the set below was taken over an incomplete tree: " + ", ".join(
        sorted(unreadable)
    )

    assert found == SPELLING_IT, (
        f"unexpected: {sorted(found - SPELLING_IT)}; missing: {sorted(SPELLING_IT - found)}. "
        f"An extra is a rename left behind; this module missing means the reader no longer finds its own pattern. "
        f"{PENDING_AT_ASSEMBLY} is an extra until it is rebuilt, which is the committer's step:  {REGENERATE}"
    )
