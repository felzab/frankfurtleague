"""SCRIPTS · the shared fixture builder, held to git's answer about the tree it copies.

Every gate-facing suite builds its throwaway `scripts/` through
`scripts/tests/conftest.py :: copy_scripts`, so what that builder drops or keeps decides what every
other module in this directory measures. It has no module of its own to answer to, which is why its
cases live here rather than beside a subject they happen to share a fixture with: a builder that
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


def test_the_fixture_builder_keeps_a_file_only_a_machines_own_ignore_rules_hide() -> None:
    """`--exclude-standard` would read those rules, and a fixture differing per developer proves nothing."""
    source = new_root("fixture-builder-machine-")
    configure(source, str(source / ".no-hooks"))
    write(source, "gate/demo.sh", "#!/usr/bin/env bash\n")
    git(source, "add", ".")
    git(source, "commit", "-m", "Fixture: one tracked tree")
    # Uncommitted, so an ignore rule is the only thing that can decide against it -- and this rule
    # lives where no clone and no CI checkout would find it.
    write(source, "checks/check_local.py", "PLANTED = 1\n")
    excludes = new_root("fixture-builder-excludes-")
    write(excludes, "machine-excludes", "check_local.py\n")
    git(source, "config", "core.excludesFile", (excludes / "machine-excludes").as_posix())
    copy = new_root("fixture-builder-machine-copy-") / "scripts"
    copy_scripts(copy, source=source)
    assert (copy / "checks" / "check_local.py").is_file(), "one machine's ignore file decided what the fixture holds"


def test_the_fixture_builder_leaves_out_a_tracked_file_the_working_tree_no_longer_holds() -> None:
    """The index still lists it, and copying it would end every module's fixture in a FileNotFoundError."""
    source = new_root("fixture-builder-deleted-")
    configure(source, str(source / ".no-hooks"))
    write(source, "gate/demo.sh", "#!/usr/bin/env bash\n")
    write(source, "checks/check_gone.py", "GONE = 1\n")
    git(source, "add", ".")
    git(source, "commit", "-m", "Fixture: one tracked tree")
    (source / "checks" / "check_gone.py").unlink()
    copy = new_root("fixture-builder-deleted-copy-") / "scripts"
    copy_scripts(copy, source=source)
    assert (copy / "gate" / "demo.sh").is_file(), "the copy stopped at the deleted path"
    assert not (copy / "checks" / "check_gone.py").exists(), "a path the working tree has dropped reached the copy"


def test_the_fixture_builder_copies_a_tracked_file_whose_name_opens_with_a_space() -> None:
    """A reader stripping the whole listing rewrites its head, and the name it then opens is tracked nowhere.

    The two assertions separate that from a copy which listed nothing at all.
    """
    source = new_root("fixture-builder-space-")
    configure(source, str(source / ".no-hooks"))
    # A space sorts ahead of every printable byte, so this name is the listing's head -- the one
    # position a strip of the whole answer can reach.
    write(source, " leading.py", "LEADING = 1\n")
    write(source, "gate/demo.sh", "#!/usr/bin/env bash\n")
    git(source, "add", ".")
    git(source, "commit", "-m", "Fixture: a name opening with a space")
    copy = new_root("fixture-builder-space-copy-") / "scripts"
    copy_scripts(copy, source=source)
    assert (copy / " leading.py").is_file(), "the space opening a tracked name was lost before the copy"
    assert (copy / "gate" / "demo.sh").is_file(), "the copy dropped the whole listing rather than its head"
