"""SCRIPTS · the regenerate-command sweep, driven red on each finding and each refusal it can reach.

`check_regenerate_spelling.py` is the only thing holding the sites that print that command to the
one spelling the backend declares, so a defect in it is silent by construction: the gate stays green
and a reader is sent to an interpreter without the backend's dependencies. Every case plants the
shape it reports, and the two reading this repository's own tree tie the mechanism to what it
guards.

The refusals are driven for the same reason: a declaration no site can be compared against has to
end the run at `EXIT_REFUSED`, because reporting every site as drifted would send its reader to
copy the broken spelling.

`scripts/checks/` is put on the path here because the module under test is run as a script
everywhere else, which is what seeds that directory onto the path for it.

Invariants:
  Nothing here types the command as one literal, which would put this file into the sweep's own population.
"""

from __future__ import annotations

import importlib
import inspect
import sys
from pathlib import Path

from conftest import configure, details, git, new_root, severities, withdraw, write

SCRIPTS = Path(__file__).resolve().parents[1]

# Withdrawn again, kernel dropped from the cache with it: `test_check_docs.py` runs the gate from a
# throwaway copy of scripts/, and a `checker_kernel` cached here would answer its imports and root
# every check at the wrong repository.
sys.path.insert(0, str(SCRIPTS / "checks"))
try:
    spelling = importlib.import_module("check_regenerate_spelling")
finally:
    sys.path.remove(str(SCRIPTS / "checks"))
    withdraw("check_regenerate_spelling", "checker_kernel")

# Built from the module's own constants rather than typed, for the invariant above.
COMMAND = spelling.RUN_THROUGH + spelling.COMMAND_TAIL

SITE = "docs/backend/spec.md"
OTHER = "fl_frontend/src/core/apiContract.test.ts"


def declaration(command: str = COMMAND) -> str:
    """The backend module as this sweep reads it: the one annotated assignment it looks for."""
    return f'from typing import Final\n\nREGENERATE: Final = "{command}"\n'


def naming(command: str = COMMAND) -> str:
    """One site's text, printing the command to whoever has to run it."""
    return f"Refresh the document with `{command}`.\n"


def planted(files: dict[str, str]) -> Path:
    """A plain directory holding those files -- no repository, for the readers that take a listing."""
    root = new_root("check-regenerate-spelling-")
    for rel, text in files.items():
        write(root, rel, text)
    return root


def repository(files: dict[str, str]) -> Path:
    """The same corpus with every file tracked, for the cases that run `main` end to end."""
    root = planted(files)
    configure(root, hooks=str(root / ".githooks"))
    git(root, "add", "-A")
    return root


def corpus(site: str = naming(), *, home: str = declaration()) -> dict[str, str]:
    """The resting corpus: the declaration, and one registered site spelling it that way."""
    return {spelling.HOME: home, SITE: site}


def judged(root: Path, files: dict[str, str], monkeypatch) -> list:
    """One sweep and one judgement over a planted tree, the register narrowed to what it holds."""
    monkeypatch.setattr(spelling, "SITES", (SITE,))
    found, _ = spelling.sweep(root, list(files))
    return spelling.judge(found, spelling.declared(root / spelling.HOME))


def run_main(root: Path, monkeypatch, *, sites: tuple[str, ...] = (SITE,)) -> int:
    """One end-to-end run over a planted repository, where the exit contract is decided."""
    monkeypatch.setattr(spelling, "SITES", sites)
    monkeypatch.setattr(sys, "argv", ["check_regenerate_spelling.py", str(root)])
    return spelling.main()


def test_a_site_spelling_the_command_as_the_backend_declares_it_is_clean(monkeypatch):
    """`test_check_public_routes.py :: test_a_metered_exact_match_covers_its_handler`'s argument, over a site that spells it right."""
    files = corpus()

    assert judged(planted(files), files, monkeypatch) == []


def test_a_drifted_prefix_is_a_finding(monkeypatch):
    """The gap the check exists for: the tail still names the module and the interpreter is wrong."""
    files = corpus(naming(spelling.COMMAND_TAIL))

    findings = judged(planted(files), files, monkeypatch)

    assert severities(findings) == ["fail"]
    assert SITE in details(findings)


def test_a_finding_quotes_the_command_rather_than_the_line_it_stands_on(monkeypatch):
    """A site's line is a whole spec-sheet table row, and the repair is the prefix in front of it."""
    files = corpus("| I21 | " + "padding " * 40 + f"regenerate it with `{spelling.COMMAND_TAIL}` |\n")

    findings = judged(planted(files), files, monkeypatch)

    assert "| I21 |" not in details(findings)
    assert spelling.COMMAND_TAIL in details(findings)


def test_a_registered_site_that_stopped_naming_the_command_is_a_finding(monkeypatch):
    """The direction the population cannot see: a site whose own tail drifted leaves it silently."""
    files = corpus("Refresh it as the backend README says.\n")

    findings = judged(planted(files), files, monkeypatch)

    assert severities(findings) == ["fail"]
    assert "no longer names the command" in details(findings)


def test_a_tracked_file_no_entry_registers_is_a_finding(monkeypatch):
    """A site added later would otherwise print whatever it was written with, compared to nothing."""
    files = {**corpus(), OTHER: naming()}

    findings = judged(planted(files), files, monkeypatch)

    assert severities(findings) == ["fail"]
    assert OTHER in details(findings)


def test_the_declaring_module_needs_no_entry_of_its_own(monkeypatch):
    """It carries the command because it declares it, and registering it would compare it to itself."""
    files = corpus()

    assert spelling.HOME not in details(judged(planted(files), files, monkeypatch))


def test_this_checkers_own_path_is_left_out_of_the_population():
    """It spells the tail as its finder, so a sweep counting it would report itself every run."""
    files = {spelling.SELF: naming()}
    found, _ = spelling.sweep(planted(files), list(files))

    assert found == {}


def test_a_file_carrying_no_command_is_never_read_as_a_site():
    """The population is the marker's, so nothing else in the tree reaches the comparison at all."""
    files = {SITE: "Nothing about the published document here.\n"}
    found, _ = spelling.sweep(planted(files), list(files))

    assert found == {}


# A `try`, not `pytest.raises`, throughout this file, for `scripts/tests/conftest.py`'s pytest
# invariant.
def test_a_declaration_outside_the_project_environment_refuses():
    """Compared against, it would make every correctly spelled site a finding telling its reader to copy it."""
    root = planted({spelling.HOME: declaration(spelling.COMMAND_TAIL)})

    try:
        spelling.declared(root / spelling.HOME)
    except spelling.Refusal as refusal:
        assert "project environment" in str(refusal), refusal
    else:
        raise AssertionError("a command outside the project environment was read as the reference")


def test_a_declaration_that_is_not_the_command_this_sweep_finds_by_refuses():
    """Its population would then be the sites of some other command, and it would report on those."""
    root = planted({spelling.HOME: declaration(spelling.RUN_THROUGH + "python -m tests.openapi_document --check")})

    try:
        spelling.declared(root / spelling.HOME)
    except spelling.Refusal as refusal:
        assert "finds a site by" in str(refusal), refusal
    else:
        raise AssertionError("a command this sweep cannot find a site by was read as the reference")


def test_a_declaration_that_is_not_a_string_refuses():
    """A site prints a command, so a reference of any other type is one nothing can be held to."""
    root = planted({spelling.HOME: "from typing import Final\n\nREGENERATE: Final = 3\n"})

    try:
        spelling.declared(root / spelling.HOME)
    except spelling.Refusal as refusal:
        assert "int" in str(refusal), refusal
    else:
        raise AssertionError("a number was read as the command")


def test_a_declaration_no_reader_can_evaluate_refuses():
    """Split across an operator it is a name this reader cannot resolve, not a command."""
    root = planted({spelling.HOME: "from typing import Final\n\nREGENERATE: Final = PREFIX + TAIL\n"})

    try:
        spelling.declared(root / spelling.HOME)
    except spelling.Refusal as refusal:
        assert "evaluate" in str(refusal), refusal
    else:
        raise AssertionError("an expression was read as the command")


def test_a_module_declaring_nothing_refuses():
    """The reference is gone, and comparing every site to nothing is the one thing this may not do."""
    root = planted({spelling.HOME: "from typing import Final\n\nOTHER: Final = 1\n"})

    try:
        spelling.declared(root / spelling.HOME)
    except spelling.Refusal as refusal:
        assert spelling.DECLARATION in str(refusal), refusal
    else:
        raise AssertionError("a module declaring nothing answered with a command")


def test_a_tree_git_cannot_list_refuses():
    """A listing that answered nothing would read as a tree where no file names the command."""
    root = planted(corpus())

    try:
        spelling.tracked(root)
    except spelling.Refusal as refusal:
        assert "could not list" in str(refusal), refusal
    else:
        raise AssertionError("a directory that is no repository was listed")


def test_a_clean_tree_exits_zero(monkeypatch):
    """`test_check_public_routes.py :: test_a_clean_pair_exits_zero`'s argument, over a tree with nothing to report."""
    assert run_main(repository(corpus()), monkeypatch) == 0


def test_a_finding_exits_one(monkeypatch):
    """Held over `scripts/checks/check_regenerate_spelling.py :: main`, for `scripts/lib/checker_kernel.py :: EXIT_FINDINGS`'s reason."""
    assert run_main(repository(corpus(naming(spelling.COMMAND_TAIL))), monkeypatch) == 1


def test_a_declaration_it_cannot_judge_exits_two(monkeypatch):
    """A refusal collapsed into a failure sends a reader to repair the sites rather than the reference."""
    root = repository(corpus(home=declaration(spelling.COMMAND_TAIL)))

    assert run_main(root, monkeypatch) == spelling.EXIT_REFUSED


def test_a_tracked_file_the_run_could_not_read_exits_two(monkeypatch):
    """The register is closed against the population, and an unread file could be a site nobody registered."""
    root = repository({**corpus(), OTHER: naming()})
    (root / OTHER).unlink()

    assert run_main(root, monkeypatch) == spelling.EXIT_REFUSED


def test_a_tracked_file_that_is_not_utf_8_exits_two(monkeypatch):
    """A byte no decoder places is input this sweep cannot judge, and skipping it would read as coverage."""
    root = repository(corpus())
    (root / OTHER).parent.mkdir(parents=True, exist_ok=True)
    (root / OTHER).write_bytes(naming().encode("utf-8") + b"\xff\n")
    git(root, "add", "-A")

    assert run_main(root, monkeypatch) == spelling.EXIT_REFUSED


def test_the_module_under_test_is_this_repository_own():
    """`test_check_compose_mirror.py :: test_the_module_under_test_is_this_repository_own`'s argument, over the spelling sweep's import."""
    assert spelling.REPO_ROOT == SCRIPTS.parent


def test_the_excluded_path_is_this_checkers_own():
    """The exclusion is by path, so a rename that misses it puts the sweep back into its own population."""
    assert (spelling.REPO_ROOT / spelling.SELF).resolve() == Path(inspect.getfile(spelling)).resolve()


def test_the_repository_own_sites_all_spell_the_command_the_declared_way():
    """The real tree, so a drift in any site fails here and not only at the gate."""
    command = spelling.declared(spelling.REPO_ROOT / spelling.HOME)
    found, _ = spelling.sweep(spelling.REPO_ROOT, spelling.tracked(spelling.REPO_ROOT))

    assert spelling.judge(found, command) == []


def test_the_declared_command_runs_through_the_project_environment():
    """`uv run` rather than a bare `python`: outside it the interpreter has neither FastAPI nor the package."""
    assert spelling.declared(spelling.REPO_ROOT / spelling.HOME) == COMMAND
