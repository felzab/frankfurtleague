"""ORCHESTRATION · the tools are type-checked as the Python series every CI job installing one takes.

pyright takes the version from `pythonVersion`, or else from whichever `python` it finds on PATH,
never from the virtualenv `venvPath` names, so the pin is what makes one judgement on every machine.
This folder's pin is held here rather than beside the repository's other copies, since no check
outside `.claude/` may read this folder.
"""

from __future__ import annotations

import re
from typing import Final

from conftest import REPO_ROOT

PYRIGHT_CONFIG: Final = REPO_ROOT / ".claude" / "skills" / "orchestration" / "pyrightconfig.json"
PYTHON_VERSION_FILE: Final = REPO_ROOT / "fl_backend" / ".python-version"


def test_the_tools_are_type_checked_as_the_series_ci_installs() -> None:
    series = PYTHON_VERSION_FILE.read_text(encoding="utf-8").strip()
    # JSON with comments, which no parser of the standard library reads: the one key, by its line.
    pinned = re.findall(r'^\s*"pythonVersion": "([^"]*)"\s*,?\s*$', PYRIGHT_CONFIG.read_text(encoding="utf-8"), re.MULTILINE)
    assert pinned == [series], f"pyrightconfig.json pins pythonVersion {pinned}, and fl_backend/.python-version names {series}"
