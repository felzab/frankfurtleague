"""SCRIPTS · the documentation gate: the kernel's readers, the corpus checks, the branch checks, and the copy rules.

The kernel is imported here so its floor guard runs before a sibling is compiled, a SyntaxError
raised while compiling one exiting 1 -- a finding's code. This file's own syntax is the one thing
that can stop that guard, so it has to parse at `checker_kernel.py :: PARSE_FLOOR`.
"""

from __future__ import annotations

import checker_kernel as _floor  # noqa: F401 -- imported for the import-time guard alone
