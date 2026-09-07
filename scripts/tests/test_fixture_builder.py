"""SCRIPTS · the shared fixture builder, held to git's answer about the tree it copies.

Every gate-facing suite builds its throwaway `scripts/` through
`scripts/tests/conftest.py :: copy_scripts`, so what that builder drops or keeps decides what every
other module in this directory measures. It has no module of its own to answer to, which is why one
case lives here rather than beside a subject it happens to share a fixture with: a builder that
silently stops copying an uncommitted checker leaves every suite green over a copy missing exactly
the file a branch is adding.
"""

from __future__ import annotations

from conftest import configure, copy_scripts, git, new_root, write


def test_the_fixture_builder_copies_what_git_does_not_ignore_and_leaves_the_rest() -> None:
    source = new_root("fixture-builder-source-")
    configure(source, str(source / ".no-hooks"))
    write(source, ".gitignore", "unlisted/\n")
    write(source, "gate/demo.sh", "#!/usr/bin/env bash\n")
    write(source, "tests/test_demo.py", "def test_demo() -> None: ...\n")
    git(source, "add", ".")
    git(source, "commit", "-m", "Fixture: one tracked tree")
    # A cache directory named as no denylist would name it, beside the new module a branch writes
    # before it commits one: what the copy keeps and what it drops are two answers, not one.
    write(source, "unlisted/leftover.json", "{}\n")
    write(source, "checks/check_new.py", "PLANTED = 1\n")
    copy = new_root("fixture-builder-copy-") / "scripts"
    copy_scripts(copy, source=source)
    assert (copy / "gate" / "demo.sh").is_file(), "a tracked file did not reach the copy"
    assert (copy / "checks" / "check_new.py").is_file(), "an uncommitted module did not reach the copy"
    assert not (copy / "unlisted").exists(), "an ignored directory reached the copy"
    assert not (copy / "tests").exists(), "the suite driving the gate reached the gate's own corpus"
