"""
SCRIPTS · the documentation gate

The entry point verify.sh runs; the checks live in the package beside this file. A
`<file> :: <symbol>` citation resolves by finding the symbol's text inside the file it names, so
every symbol the corpus cites as `check_docs.py :: <symbol>` is re-exported below. The package is
NOT named check_docs: a sibling of that name carrying __init__.py resolves ahead of this file.
"""

from __future__ import annotations

import sys

from checker_kernel import run
from docs_gate.branch import check_comment_bounds
from docs_gate.kernel import CHECKS, SCANNED_SUFFIXES
from docs_gate.perkind import (
    METADATA_LINE_RE,
    RULE_FIELD_RE,
    check_enforced_by,
    check_metadata_breaks,
    check_segment_map,
    check_template_fragments,
    roadmap_ids,
)
from docs_gate.references import RULE_ID_RE
from docs_gate.run import main

# Named for export rather than for use here: every one below is cited from a document, a command
# file or a sibling checker.
__all__ = [
    "CHECKS",
    "METADATA_LINE_RE",
    "RULE_FIELD_RE",
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
