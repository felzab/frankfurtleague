"""
SCRIPTS · the documentation gate

The entry point verify.sh runs; the checks live in the package beside this file. A
`<file> :: <symbol>` citation resolves by finding the symbol's text inside the file it names, so
every symbol the corpus cites as `check_docs.py :: <symbol>` is re-exported below. The package is
NOT named check_docs: a sibling of that name carrying __init__.py resolves ahead of this file.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Every caller runs this as a script, so sys.path opens with THIS directory and `lib/` is a
# sibling of it rather than in it.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from checker_kernel import EXIT_CRASH, run

# Guarded because it runs before `run` can classify it: an import failing here exits 1, which the
# exit contract reserves for findings, and the gate would report a documentation fault.
try:
    from docs_gate.branch import check_comment_bounds
    from docs_gate.checks import (
        METADATA_LINE_RE,
        RULE_ID_RE,
        check_enforced_by,
        check_metadata_breaks,
        check_segment_map,
        check_template_fragments,
        main,
    )
    from docs_gate.kernel import CHECKS, SCANNED_SUFFIXES, roadmap_ids
except ModuleNotFoundError as missing:
    if __name__ != "__main__":
        raise
    print(
        f"      cannot import {missing.name} with {sys.executable}, so nothing was checked -- the environment is incomplete:"
        " `uv sync --project fl_backend --dev --frozen` installs the dev group this gate reads with",
        file=sys.stderr,
    )
    sys.exit(EXIT_CRASH)

# Named for export rather than for use here: every one below is cited from a document, a command
# file or a sibling checker.
__all__ = [
    "CHECKS",
    "METADATA_LINE_RE",
    "RULE_ID_RE",
    "SCANNED_SUFFIXES",
    "check_comment_bounds",
    "check_enforced_by",
    "check_metadata_breaks",
    "check_segment_map",
    "check_template_fragments",
    "main",
    "roadmap_ids",
]

if __name__ == "__main__":
    sys.exit(run(main))
