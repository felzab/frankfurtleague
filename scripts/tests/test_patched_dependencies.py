"""SCRIPTS · a dependency patch names its upstream issue and one exact version.

pnpm refuses a patch that applies to nothing, so a bump stops at the entry. What the reader then
needs to find there, an issue to check and a version the patch was read against, is no concern of
pnpm's, and nothing else compares the two.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Final, NamedTuple

import pytest

FRONTEND: Final = Path(__file__).resolve().parents[2] / "fl_frontend"
WORKSPACE: Final = FRONTEND / "pnpm-workspace.yaml"
LOCKFILE: Final = FRONTEND / "pnpm-lock.yaml"

# `name@1.2.3`, a scoped name or a prerelease included. A bare name or a range would carry the patch
# across a bump, past the refusal this rests on.
EXACT_VERSION: Final = re.compile(r".+@\d+\.\d+\.\d+(?:-[\w.-]+)?")
UPSTREAM_ISSUE: Final = re.compile(r"https://\S+/issues/\d+")


class Entry(NamedTuple):
    key: str
    comment: str


def _entries(path: Path) -> list[Entry]:
    """The `patchedDependencies` block, each key with the comment lines directly above it."""
    entries: list[Entry] = []
    comment: list[str] = []
    inside = False
    for line in path.read_text(encoding="utf-8").splitlines():
        if line == "patchedDependencies:":
            inside = True
        elif inside and line.lstrip().startswith("#") and line.startswith(" "):
            comment.append(line)
        elif inside and line.startswith(" "):
            entries.append(Entry(line.strip().split(": ")[0].strip("'\""), "\n".join(comment)))
            comment = []
        elif inside:
            break
    return entries


def test_the_reader_finds_every_patch_pnpm_applies() -> None:
    assert {entry.key for entry in _entries(WORKSPACE)} == {entry.key for entry in _entries(LOCKFILE)}, (
        "pnpm-workspace.yaml's patchedDependencies, as this reader finds them, are not the lockfile's"
    )


@pytest.mark.parametrize("entry", _entries(WORKSPACE), ids=lambda entry: entry.key)
def test_every_patch_names_its_upstream_issue_and_one_exact_version(entry: Entry) -> None:
    assert UPSTREAM_ISSUE.search(entry.comment), f"{entry.key} names no upstream issue's URL in the comment above it"
    assert EXACT_VERSION.fullmatch(entry.key), f"{entry.key} is not keyed to one exact version"


@pytest.mark.parametrize("entry", _entries(WORKSPACE), ids=lambda entry: entry.key)
def test_every_copy_of_a_patched_package_is_the_patched_version(entry: Entry) -> None:
    """pnpm's refusal needs the keyed version gone: a peer's copy left behind by a bump keeps the patch applied, and the install exits 0."""
    name = entry.key.rpartition("@")[0]
    copies = set(re.findall(rf"^  '?({re.escape(name)}@[^('\s]+?)'?(?:\(.*\))?:$", LOCKFILE.read_text(encoding="utf-8"), re.MULTILINE))
    assert copies == {entry.key}, f"the lockfile holds {sorted(copies)}, and pnpm patches {entry.key} alone"
