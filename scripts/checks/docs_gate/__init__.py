"""SCRIPTS · the documentation gate: the kernel's readers, the corpus checks, the branch checks, and the copy rules.

The kernel is imported here so its floor guard runs before a sibling is compiled, a SyntaxError
raised while compiling one exiting 1 -- a finding's code. This file's own syntax is the one thing
that can stop that guard, so it has to parse at `checker_kernel.py :: PARSE_FLOOR`.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Imported rather than run, so nothing has put `lib/` on the path yet: a driver naming only the
# copy's root reaches this package before it reaches any entry point beside it.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "lib"))

import checker_kernel as _floor  # noqa: E402, F401 -- imported for the import-time guard alone
