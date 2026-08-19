"""
SCRIPTS · the documentation gate

The entry point verify.sh runs. Every check lives in the package beside this file, one module per
seam; what stays here is the name the rest of the corpus cites. A `<file> :: <symbol>` citation is
answered by finding the symbol's own text inside the file it names, so the re-exports below are
what keeps a citation of this file resolving.

Invariants:
- Every symbol the corpus cites as `check_docs.py :: <symbol>` is re-exported here.
- The package is not named check_docs. A sibling package of that name carrying
  __init__.py always resolves ahead of this file, which nothing could then import.

See:
- scripts/docs_gate/run.py — the run order, and the exit code this returns
- docs/_standard/chapters/5-currency.md — what each check means, and its verdict
"""

from __future__ import annotations

import sys

from checker_kernel import run
from docs_gate.branch import _stamp_only_delta, check_branch_impact, check_comment_bounds
from docs_gate.kernel import CHECKS, SCANNED_SUFFIXES
from docs_gate.perkind import (
    METADATA_LINE_RE,
    RULE_FIELD_RE,
    check_enforced_by,
    check_metadata_breaks,
    check_segment_map,
    check_stamp_missing,
    check_template_fragments,
    roadmap_ids,
)
from docs_gate.references import RULE_ID_RE
from docs_gate.run import main

# Named for export rather than for use here: a citation resolves by finding its symbol inside the
# file it names, and every one below is cited from a document, a command file or a sibling checker.
__all__ = [
    "CHECKS",
    "METADATA_LINE_RE",
    "RULE_FIELD_RE",
    "RULE_ID_RE",
    "SCANNED_SUFFIXES",
    "_stamp_only_delta",
    "check_branch_impact",
    "check_comment_bounds",
    "check_enforced_by",
    "check_metadata_breaks",
    "check_segment_map",
    "check_stamp_missing",
    "check_template_fragments",
    "main",
    "roadmap_ids",
]

if __name__ == "__main__":
    sys.exit(run(main))
