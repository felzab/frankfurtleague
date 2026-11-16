"""The checker kernel's launcher: a checker that dies before its `run` line answers the crash, never a finding.

Python answers an uncaught exception, one at import or compile included, with 1, the code the exit contract gives
findings, and `run` in a checker's own `__main__` line reaches neither. So every caller runs a checker through
`scripts/lib/checker_kernel.py`, and a caller that does not reads a broken checker as a finding about the change.
The kernel's parser answers an argument our own script got wrong as that crash too, and a tool run as a module through
the launcher answers an exception escaping it so. Every shell script reads an external command's status through its
row, or in a guard, and never beside the command by a rule of its own.
"""

from __future__ import annotations

import os
import re
import shlex
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


@pytest.mark.parametrize(
    ("module", "code"),
    [
        pytest.param("import sys\nsys.exit(0 if sys.argv[1:] == ['.'] else 1)\n", 0, id="its-arguments-reach-the-module"),
        # deptry's findings exit through `sys.exit(bool(...))`, a bool.
        pytest.param("import sys\nsys.exit(True)\n", 1, id="a-finding-stays-a-finding"),
        pytest.param("raise RuntimeError('escaped')\n", 3, id="an-escaped-exception-is-a-crash"),
        pytest.param("import a_module_nobody_wrote\n", 3, id="an-import-that-fails-is-a-crash"),
    ],
)
def test_a_module_run_through_the_launcher_answers_a_crash_for_what_escapes_it(module: str, code: int) -> None:
    """A tool whose findings exit 1 shares that 1 with Python's own for an exception escaping it, which the launcher answers 3."""
    directory = new_root("fl-checker-kernel-module-")
    (directory / "fixture_tool.py").write_bytes(module.encode("utf-8"))
    done = subprocess.run(
        (sys.executable, str(KERNEL), "-m", "fixture_tool", "."),
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        env={**os.environ, "PYTHONPATH": str(directory)},
        check=False,
        timeout=PROCESS_BOUND_S,
    )
    assert done.returncode == code, f"exited {done.returncode}, and the exit contract gives it {code}\n{done.stdout}{done.stderr}"


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


# --- a status read outside the table ------------------------------------------------------------------

# Words that are no external command: the shell's tests, keywords and builtins.
SHELL_OWN: Final = frozenset(
    {"[[", "[", "((", "test", "true", "false", ":", "read", "mapfile", "readarray", "cd", "printf", "echo", "wait", "kill"}
    | {"shift", "return", "exit", "source", ".", "trap", "set", "unset", "export", "local", "declare", "eval", "let", "type"}
    | {"hash", "getopts", "break", "continue", "command", "if", "then", "elif", "else", "while", "until", "do", "!"}
)
# What runs the command after it rather than being it, by how many operands of its own it takes.
WRAPPERS: Final = {"quietly": 0, "in_dir": 1, "env": 0, "exec": 0, "time": 0}
# The verbs by which a status becomes a verdict, or is handed on as one.
VERDICTS: Final = frozenset({"die", "refuse", "fail", "note_fail", "crash", "on_error", "return", "exit"})
FUNCTION_RE: Final = re.compile(r"^\s*([A-Za-z_][\w-]*)\(\)\s*\{")
ASSIGNMENT_RE: Final = re.compile(r"^[A-Za-z_]\w*(?:\[[^]]*\])?\+?=")
HEREDOC_RE: Final = re.compile(r"<<-?\s*'?(\w+)'?")
CAPTURE_RE: Final = re.compile(r"\s*(\w+)=\$\?\s*")
CASE_ARM_RE: Final = re.compile(r"^[^\s()\"']+\)\s+")


def _scripts() -> dict[str, list[str]]:
    """Every shell script under scripts/, by its path, as lines."""
    return {
        path.relative_to(REPO_ROOT).as_posix(): path.read_text(encoding="utf-8").splitlines()
        for path in sorted((REPO_ROOT / "scripts").rglob("*.sh"))
    }


def _guards(lib: list[str]) -> set[str]:
    """The functions of `_lib.sh`'s Guards section, the one place a status is read without its row."""
    inside = False
    named: set[str] = set()
    for line in lib:
        if line.startswith("# --- "):
            inside = line.startswith("# --- Guards")
        elif inside and (opened := FUNCTION_RE.match(line)):
            named.add(opened[1])
    return named


def _statements(lines: list[str]) -> list[tuple[int, str | None, str]]:
    """Each logical line, numbered by its first, with the function holding it.

    A continued line and a line opening with `||` or `&&` join the one above; comments and heredoc bodies are left out.
    """
    out: list[tuple[int, str | None, str]] = []
    function: str | None = None
    heredoc: str | None = None
    held: tuple[int, str | None, str] | None = None
    for number, line in enumerate(lines, start=1):
        if heredoc is not None:
            if line.strip() == heredoc:
                heredoc = None
            continue
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        defined = FUNCTION_RE.match(line)
        # A one-line function holds only its own line.
        if defined and not stripped.endswith("}"):
            function = defined[1]
        owner = defined[1] if defined else function
        if held is not None and (held[2].endswith("\\") or stripped.startswith(("||", "&&"))):
            held = (held[0], held[1], held[2].removesuffix("\\") + " " + stripped)
        else:
            if held is not None:
                out.append(held)
            held = (number, owner, stripped)
        if (opened := HEREDOC_RE.search(line)) and "<<<" not in line:
            heredoc = opened[1]
        if line == "}":
            function = None
    if held is not None:
        out.append(held)
    return out


def _split(statement: str) -> list[str]:
    """`statement` split at each `||`, `&&`, `|` and `;`, each operator kept as a part of its own.

    Never inside quotes, a substitution, a group, a test or arithmetic.
    """
    parts: list[str] = []
    depth: list[str] = []
    current = ""
    i = 0
    while i < len(statement):
        two = statement[i : i + 2]
        char = statement[i]
        quoted = bool(depth) and depth[-1] in "'\""
        if quoted and depth[-1] == "'":
            if char == "'":
                depth.pop()
            current += char
            i += 1
            continue
        if char == "\\":
            current += statement[i : i + 2]
            i += 2
            continue
        if quoted and char == '"':
            depth.pop()
        elif two in ("$(", "<(", ">(", "${"):
            depth.append(")" if two[1] == "(" else "}")
            current += two
            i += 2
            continue
        elif quoted:
            pass
        elif char in "'\"":
            depth.append(char)
        elif two in ("[[", "(("):
            depth.append("]]" if two == "[[" else "))")
            current += two
            i += 2
            continue
        elif char == "{" and (not current.strip() or current[-1:].isspace()):
            depth.append("}")
        elif depth and statement.startswith(depth[-1], i):
            closing = depth.pop()
            current += closing
            i += len(closing)
            continue
        elif not depth and two in ("||", "&&"):
            parts += [current, two]
            current = ""
            i += 2
            continue
        elif not depth and char in "|;":
            parts += [current, char]
            current = ""
            i += 1
            continue
        current += char
        i += 1
    return [*parts, current]


def _command_words(part: str) -> list[str]:
    """The words naming what a simple command runs.

    Past `!`, groups, assignments and wrappers, and inside the substitution of a command that is only an assignment,
    each command of it.
    """
    text = part.strip()
    # A case arm's pattern ahead of the command it runs.
    text = CASE_ARM_RE.sub("", text)
    if text.startswith(("((", "[[")):
        return [text[:2]]
    text = text.lstrip("!({ ").rstrip(")} ")
    try:
        words = shlex.split(text, posix=True)
    except ValueError:
        words = text.split()
    while words and ASSIGNMENT_RE.match(words[0]):
        if len(words) == 1:
            value = words[0].split("=", 1)[1]
            if "$(" not in value:
                return []
            inner = value.split("$(", 1)[1].rsplit(")", 1)[0]
            return [word for piece in _split(inner)[::2] for word in _command_words(piece)]
        words = words[1:]
    while words and words[0] in WRAPPERS:
        operands = WRAPPERS[words[0]]
        words = words[1 + operands :]
        while words and (words[0].startswith("-") or ASSIGNMENT_RE.match(words[0])):
            words = words[2:] if words[0] == "--exits" else words[1:]
    return words[:1]


def _verdict(part: str) -> bool:
    """Whether what follows an `||` makes the status a verdict, or hands it on as one."""
    return bool(set(part.replace("{", " ").replace(";", " ").split()) & VERDICTS)


def _external(words: list[str], defined: set[str]) -> bool:
    return any(word not in SHELL_OWN and word not in defined for word in words)


def _status_reads(scripts: dict[str, list[str]]) -> tuple[list[str], list[str]]:
    """Every `<external> || <verdict>` outside a guard, and every `case` on a status a function captured."""
    defined = {opened[1] for lines in scripts.values() for line in lines if (opened := FUNCTION_RE.match(line))}
    guards = _guards(scripts["scripts/lib/_lib.sh"])
    beside: list[str] = []
    cased: list[str] = []
    for name, lines in scripts.items():
        captured: dict[str | None, set[str]] = {}
        for number, function, statement in _statements(lines):
            parts = _split(CASE_ARM_RE.sub("", statement))
            for at in range(1, len(parts), 2):
                if parts[at] != "||" or function in guards:
                    continue
                # Every command whose failure reaches this `||`: those `&&` or a pipe joins ahead of it.
                left: list[str] = []
                k = at - 1
                while True:
                    left.append(parts[k])
                    if k >= 2 and parts[k - 1] in ("&&", "|"):
                        k -= 2
                    else:
                        break
                words = [word for part in left for word in _command_words(part)]
                if not _external(words, defined):
                    continue
                right = parts[at + 1]
                if (held := CAPTURE_RE.fullmatch(right)) is not None:
                    captured.setdefault(function, set()).add(held[1])
                elif _verdict(right):
                    beside.append(f"{name}:{number}: {statement}")
            for variable in captured.get(function, set()):
                if re.search(rf'\bcase\s+"?\$\{{?{variable}\}}?"?\s+in\b', statement):
                    cased.append(f"{name}:{number}: {statement}")
    return beside, cased


def test_no_external_command_s_status_is_read_beside_it_but_in_a_guard() -> None:
    """A tool's status meets its row through `run_tool`, `tool_class` or `settle`, or is a guard's, in `_lib.sh`'s Guards.

    `cmd || die` reads a tool's every failure as a finding, `|| refuse` as a refusal and `|| return <n>` as whatever its
    caller makes of it, each by a rule no row holds, and a `case` on a captured status spells that rule out.
    """
    scripts = _scripts()
    # Per kind: a sweep reading no script or no guard passes over none at all.
    assert {"scripts/ops/local.sh", "scripts/ops/deploy.sh", "scripts/checks/edge_test.sh"} <= scripts.keys(), sorted(scripts)
    assert {"require_docker", "require_compose"} <= _guards(scripts["scripts/lib/_lib.sh"]), "the sweep read no guard"
    beside, cased = _status_reads(scripts)
    assert beside == [], "an external command's status read beside it, outside a guard:\n" + "\n".join(beside)
    assert cased == [], "a `case` on a captured status, outside the table:\n" + "\n".join(cased)
