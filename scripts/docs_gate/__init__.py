"""SCRIPTS · the documentation gate, one module per seam the checks divide along.

Invariants:
- The kernel is imported here, so its floor guard runs before a sibling is compiled (ADR-0066). A
  SyntaxError raised while compiling a sibling exits 1, which is a finding's code.
- This file's own syntax is the one thing that can stop that guard: the import below runs only
  after it compiles, so it has to parse at `checker_kernel.py :: PARSE_FLOOR` (ADR-0066).

See:
- scripts/checker_kernel.py — the floor guard, and the exit codes this package answers with
"""

from __future__ import annotations

import checker_kernel as _floor  # noqa: F401 -- imported for the import-time guard alone
