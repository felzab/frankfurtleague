"""A dependency patch is keyed to one exact version, and no other copy of its package is installed.

pnpm refuses a patch that applies to nothing, so a bump stops at the entry and someone reads the
patch. pnpm also accepts a range or a bare name as the key, and a peer's copy left at the keyed
version keeps the patch applying: either carries it across a bump with the install exiting 0.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Final

import pytest
from conftest import REPO_ROOT

FRONTEND: Final = REPO_ROOT / "fl_frontend"
WORKSPACE: Final = FRONTEND / "pnpm-workspace.yaml"
LOCKFILE: Final = FRONTEND / "pnpm-lock.yaml"

# `name@1.2.3`, a scoped name or a prerelease included. A bare name or a range would carry the patch
# across a bump, past the refusal this rests on.
EXACT_VERSION: Final = re.compile(r".+@\d+\.\d+\.\d+(?:-[\w.-]+)?")


def _keys(path: Path) -> list[str]:
    """The keys of the `patchedDependencies` block, its comment lines skipped."""
    keys: list[str] = []
    inside = False
    for line in path.read_text(encoding="utf-8").splitlines():
        if line == "patchedDependencies:":
            inside = True
        elif inside and line.startswith(" ") and not line.lstrip().startswith("#"):
            keys.append(line.strip().split(": ")[0].strip("'\""))
        elif inside and not line.startswith(" "):
            break
    return keys


def test_the_reader_finds_every_patch_pnpm_applies() -> None:
    assert set(_keys(WORKSPACE)) == set(_keys(LOCKFILE)), (
        "pnpm-workspace.yaml's patchedDependencies, as this reader finds them, are not the lockfile's"
    )


@pytest.mark.parametrize("key", _keys(WORKSPACE))
def test_every_patch_is_keyed_to_one_exact_version(key: str) -> None:
    assert EXACT_VERSION.fullmatch(key), f"{key} is not keyed to one exact version"


@pytest.mark.parametrize("key", _keys(WORKSPACE))
def test_every_copy_of_a_patched_package_is_the_patched_version(key: str) -> None:
    """pnpm's refusal needs the keyed version gone: a peer's copy left behind by a bump keeps the patch applied, and the install exits 0."""
    name = key.rpartition("@")[0]
    copies = set(re.findall(rf"^  '?({re.escape(name)}@[^('\s]+?)'?(?:\(.*\))?:$", LOCKFILE.read_text(encoding="utf-8"), re.MULTILINE))
    assert copies == {key}, f"the lockfile holds {sorted(copies)}, and pnpm patches {key} alone"
