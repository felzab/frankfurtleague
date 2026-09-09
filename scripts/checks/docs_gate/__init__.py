"""SCRIPTS · the documentation gate: every check `kernel.py :: CHECKS` registers, and the readers they share.

The path insert below is the package's whole job at import: every sibling reaches `checker_kernel`
by its bare name, and nothing has put `lib/` on the path by the time the first one is compiled.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Imported rather than run, so nothing has put `lib/` on the path yet: a driver naming only the
# copy's root reaches this package before it reaches any entry point beside it.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "lib"))
