from __future__ import annotations

import argparse
import sys

import checker_kernel

from .branch import (
    Branch,
    branch_additions,
    check_added_citations,
    check_branch_diff,
    check_branch_impact,
    check_comment_bounds,
    check_counts,
    check_history_phrases,
    check_prose_shas,
    check_stamp_freshness,
    check_stamps,
)
from .kernel import (
    Finding,
    tolerate_console_encoding,
    tracked_files,
)
from .perkind import (
    check_check_registry,
    check_enforced_by,
    check_glossary,
    check_inputs,
    check_invariant_tables,
    check_line_endings,
    check_overviews,
    check_roadmap,
    check_rule_index,
    check_rule_shape,
    check_segment_map,
    check_spec_sheets,
    check_stamp_missing,
    check_template_fragments,
    invariant_ids,
    rule_ids,
)
from .references import check_file


def main() -> int:
    tolerate_console_encoding()
    parser = argparse.ArgumentParser(description="Documentation gate (docs/_standard/chapters/5-currency.md).")
    parser.add_argument("--all", action="store_true", help="list every advisory finding, not just the first ten")
    args = parser.parse_args()

    files = tracked_files()
    if not files:
        # Refused, not green: an empty corpus is a tree this gate could not read.
        print("      no tracked file matched -- nothing was read, so this run proves nothing", file=sys.stderr)
        return checker_kernel.EXIT_REFUSED

    # Resolved once, and handed to every branch-scoped check below. The kernel's resolver prefers
    # the remote-tracking ref: a stale local one reads another branch's commits as this one's.
    branch = Branch(checker_kernel.DEFAULT_BASE, checker_kernel.resolve_base())

    existing_rules = rule_ids()
    existing_invariants = invariant_ids()
    additions = branch_additions(branch)
    findings: list[Finding] = []
    for path in files:
        findings.extend(check_file(path, existing_rules, existing_invariants))
    findings.extend(check_stamps(files))
    findings.extend(check_stamp_missing())
    findings.extend(check_stamp_freshness(branch))
    findings.extend(check_branch_impact(branch))
    findings.extend(check_branch_diff(branch))
    findings.extend(check_roadmap())
    findings.extend(check_inputs())
    findings.extend(check_line_endings())
    findings.extend(check_spec_sheets())
    findings.extend(check_invariant_tables())
    findings.extend(check_overviews())
    findings.extend(check_glossary())
    findings.extend(check_enforced_by())
    findings.extend(check_rule_shape())
    findings.extend(check_rule_index(existing_rules))
    findings.extend(check_check_registry())
    findings.extend(check_segment_map())
    findings.extend(check_template_fragments())
    findings.extend(check_prose_shas(files))
    findings.extend(check_history_phrases(additions))
    findings.extend(check_counts(additions))
    findings.extend(check_added_citations(additions))
    findings.extend(check_comment_bounds(branch))

    failures = [f for f in findings if f.severity == "fail"]
    reports = [f for f in findings if f.severity == "report"]

    if failures:
        print(f"\n      {len(failures)} failing finding(s):")
        for finding in failures:
            print(finding.line())

    if reports:
        print(f"\n      {len(reports)} advisory finding(s):")
        for finding in reports if args.all else reports[:10]:
            print(finding.line())
        if not args.all and len(reports) > 10:
            print(f"      ... and {len(reports) - 10} more -- scripts/check_docs.py --all lists every one")

    docs = sum(1 for f in files if f.suffix == ".md")
    sources = len(files) - docs
    print(f"\n      scanned {docs} documents and {sources} source files against {len(existing_rules)} rules")
    return checker_kernel.EXIT_FINDINGS if failures else checker_kernel.EXIT_OK
