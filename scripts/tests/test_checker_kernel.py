"""The checker kernel's launcher: a checker that dies before its `run` line answers the crash, never a finding.

Python answers an uncaught exception, one at import or compile included, with 1, the code the exit contract gives
findings, and `run` in a checker's own `__main__` line reaches neither. So every caller runs a checker through
`scripts/lib/checker_kernel.py`, and a caller that does not reads a broken checker as a finding about the change.
The kernel's parser answers an argument our own script got wrong as that crash too, and a caller settles the status
in its own shell, where a crash can end the run.
"""

from __future__ import annotations

import re
import subprocess
import sys
from typing import Final

import pytest
from conftest import PROCESS_BOUND_S, REPO_ROOT, new_root

KERNEL: Final = REPO_ROOT / "scripts" / "lib" / "checker_kernel.py"
LAUNCHER: Final = "scripts/lib/checker_kernel.py"


def _launched(script: str, *arguments: str) -> tuple[int, str]:
    """`script` written to a fixture file and run through the launcher, its exit code and both streams."""
    path = new_root("fl-checker-kernel-") / "checker.py"
    path.write_bytes(script.encode("utf-8"))
    done = subprocess.run(
        (sys.executable, str(KERNEL), str(path), *arguments),
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        check=False,
        timeout=PROCESS_BOUND_S,
    )
    return done.returncode, done.stdout + done.stderr


@pytest.mark.parametrize(
    ("script", "code"),
    [
        pytest.param("import sys\nsys.exit(0 if sys.argv[1:] == ['a', 'b'] else 1)\n", 0, id="its-arguments-reach-the-checker"),
        pytest.param("import sys\nsys.exit(1)\n", 1, id="a-finding-stays-a-finding"),
        pytest.param("import sys\nsys.exit(2)\n", 2, id="a-refusal-stays-a-refusal"),
        pytest.param("import a_module_nobody_wrote\n", 3, id="an-import-that-fails-is-a-crash"),
        pytest.param("def broken(:\n", 3, id="a-checker-that-does-not-compile-is-a-crash"),
        pytest.param("raise RuntimeError('at import')\n", 3, id="an-exception-at-import-is-a-crash"),
    ],
)
def test_the_launcher_answers_the_checker_s_own_code_and_a_crash_for_anything_before_it(script: str, code: int) -> None:
    exited, output = _launched(script, "a", "b")
    assert exited == code, f"exited {exited}, and the exit contract gives it {code}\n{output}"


# A checker on the kernel's parser with one subcommand, as `nginx_conf.py` is: argparse answers a subparser's
# error from the subparser itself, so the subcommand is where a parser that does not inherit the override fails.
PARSING: Final = f"""import sys
sys.path.insert(0, {str(KERNEL.parent)!r})
from checker_kernel import ArgumentParser, run
def main() -> int:
    parser = ArgumentParser()
    one = parser.add_subparsers(dest="query", required=True).add_parser("figure")
    one.add_argument("directive", choices=("limit_req", "limit_conn"))
    parser.parse_args()
    return 0
sys.exit(run(main))
"""


@pytest.mark.parametrize(
    ("arguments", "code"),
    [
        pytest.param(("figure", "limit_req"), 0, id="a-good-invocation-passes"),
        pytest.param(("--help",), 0, id="help-is-no-failure"),
        pytest.param(("bogus",), 3, id="an-unknown-subcommand-is-a-crash"),
        pytest.param(("figure", "nope"), 3, id="a-subcommand-s-bad-choice-is-a-crash"),
        pytest.param(("figure",), 3, id="a-subcommand-s-missing-argument-is-a-crash"),
    ],
)
def test_an_argument_a_checker_refuses_is_a_crash_never_a_refusal(arguments: tuple[str, ...], code: int) -> None:
    """argparse answers a usage error with 2, the code the exit contract gives a refusal, and only our own scripts call a checker."""
    exited, output = _launched(PARSING, *arguments)
    assert exited == code, f"exited {exited}, and the exit contract gives it {code}\n{output}"


def test_every_checker_parses_its_arguments_with_the_kernel_s_parser() -> None:
    """A checker building argparse's own parser answers a usage error of ours as a refusal of its input."""
    stray = [
        f"{path.relative_to(REPO_ROOT).as_posix()}:{number}"
        for directory in ("checks", "lib")
        for path in sorted((REPO_ROOT / "scripts" / directory).glob("*.py"))
        if path != KERNEL
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1)
        if "argparse.ArgumentParser(" in line
    ]
    assert stray == [], "argparse's own parser, where checker_kernel.ArgumentParser answers a usage error as a crash:\n" + "\n".join(stray)


# A Python file of the gate's own, named on a shell line: the launcher itself aside.
CHECKER_RE: Final = re.compile(r"\bscripts/(?:checks|lib)/(?!checker_kernel\.py)\w+\.py\b")


def test_every_shell_caller_runs_a_checker_through_the_launcher() -> None:
    """A caller naming a checker without the launcher ahead of it reads the checker's import crash as a finding."""
    named: list[str] = []
    unlaunched: list[str] = []
    for path in sorted((REPO_ROOT / "scripts").rglob("*.sh")):
        for number, written in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            # The command alone, a comment after it or on a line of its own aside.
            line = "" if written.lstrip().startswith("#") else written.split(" # ", 1)[0]
            for match in CHECKER_RE.finditer(line):
                named.append(match[0])
                if f"{LAUNCHER} {match[0]}" not in line:
                    unlaunched.append(f"{path.relative_to(REPO_ROOT).as_posix()}:{number}: {line.strip()}")
    # Per checker: a sweep that reads no caller passes over none at all.
    assert {"scripts/checks/check_compose_model.py", "scripts/checks/check_public_routes.py", "scripts/lib/nginx_conf.py"} <= set(named), (
        f"the sweep read callers of {sorted(set(named))} alone"
    )
    assert unlaunched == [], f"a checker run without {LAUNCHER} ahead of it:\n" + "\n".join(unlaunched)


FUNCTION_RE: Final = re.compile(r"^(\w+)\(\) \{")


def _called(name: str) -> re.Pattern[str]:
    """`name` where a command starts: a line's first word, or the word after a separator, a case arm's pattern or a keyword opening a list."""
    return re.compile(rf"(?:^|[;&|(){{]|\bthen|\bdo|\belse)\s*{name}(?=\s|$)")


def _scripts() -> dict[str, list[str]]:
    """Every shell script under scripts/, by its path, as lines."""
    return {
        path.relative_to(REPO_ROOT).as_posix(): path.read_text(encoding="utf-8").splitlines()
        for path in sorted((REPO_ROOT / "scripts").rglob("*.sh"))
    }


def _commands(lines: list[str]) -> list[tuple[int, str | None, str]]:
    """Each line that is not a comment, numbered, with the function whose body holds it, None at a script's top level."""
    out: list[tuple[int, str | None, str]] = []
    name = None
    for number, line in enumerate(lines, start=1):
        opened = FUNCTION_RE.match(line)
        if opened:
            name = opened[1]
        elif name is not None and line == "}":
            name = None
        elif not line.lstrip().startswith("#"):
            out.append((number, name, line))
    return out


def _settlers(scripts: dict[str, list[str]]) -> set[str]:
    """Every shell function calling `settle`, directly or through another such function."""
    bodies: dict[str, list[str]] = {}
    for lines in scripts.values():
        for _, name, line in _commands(lines):
            if name is not None:
                bodies.setdefault(name, []).append(line)
    reached = {"settle"}
    while grown := {
        name for name, body in bodies.items() if name not in reached and any(_called(one).search(line) for one in reached for line in body)
    }:
        reached |= grown
    return reached


def test_no_status_is_settled_inside_a_substitution() -> None:
    """`settle` ends the run for a crash, which inside `$(…)` or `<(…)` ends the subshell alone and reads as the caller's refusal."""
    scripts = _scripts()
    settlers = _settlers(scripts) - {"settle"}
    # Per caller: a sweep reading no settler passes over none at all.
    assert {"conf_query", "verdict", "check"} <= settlers, f"the sweep found {sorted(settlers)} alone reaching settle"
    inside = re.compile(r"[$<]\(\s*(?:" + "|".join(sorted(settlers | {"settle"})) + r")(?![\w-])")
    substituted = [
        f"{name}:{number}: {line.strip()}"
        for name, lines in scripts.items()
        for number, line in enumerate(lines, start=1)
        if inside.search(line)
    ]
    assert substituted == [], "a status settled inside a substitution, where a crash ends the subshell alone:\n" + "\n".join(substituted)


INTERRUPT: Final = _called("on_interrupt")


def test_only_settle_ends_a_run_on_a_status_it_read_as_an_interrupt() -> None:
    """A case arm handing a status's 130 to `on_interrupt` beside `settle` is a hand copy of the reader, which drifts from the table."""
    reached: list[str] = []
    copies: list[str] = []
    for name, lines in _scripts().items():
        for number, function, line in _commands(lines):
            # The signal trap, which no status reaches.
            if line.startswith("trap ") or not INTERRUPT.search(line):
                continue
            (reached if function == "settle" else copies).append(f"{name}:{number}: {line.strip()}")
    # The reader's own arm: a sweep that finds none matches no arm at all.
    assert reached, "the sweep found no `on_interrupt` arm in `settle`"
    assert copies == [], "a status read to an interrupt outside `settle`:\n" + "\n".join(copies)
