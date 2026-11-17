"""The checker kernel's launcher: a checker that dies before its `run` line answers the crash, never a finding.

Python answers an uncaught exception, one at import or compile included, with 1, the code the exit contract gives
findings, and `run` in a checker's own `__main__` line reaches neither. So every caller runs a checker through
`scripts/lib/checker_kernel.py`, and a caller that does not reads a broken checker as a finding about the change.
The kernel's parser answers an argument our own script got wrong as that crash too, and a tool run as a module through
the launcher answers an exception escaping it so. Every shell script reads an external command's status through its
row, or in a guard, and never beside the command by a rule of its own, which a sweep over each script's syntax tree
holds, shfmt's, from the image scripts/gate/tools.Dockerfile pins.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
from dataclasses import dataclass, field
from functools import cache
from typing import Any, Final

import pytest
from conftest import REPO_ROOT, new_root, run_bounded

KERNEL: Final = REPO_ROOT / "scripts" / "lib" / "checker_kernel.py"
LAUNCHER: Final = "scripts/lib/checker_kernel.py"


def _launched(script: str, *arguments: str) -> tuple[int, str]:
    """`script` written to a fixture file and run through the launcher, its exit code and both streams."""
    path = new_root("fl-checker-kernel-") / "checker.py"
    path.write_bytes(script.encode("utf-8"))
    done = run_bounded((sys.executable, str(KERNEL), str(path), *arguments))
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
    done = run_bounded((sys.executable, str(KERNEL), "-m", "fixture_tool", "."), env={**os.environ, "PYTHONPATH": str(directory)})
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


# --- every status a script reads reaches its row --------------------------------------------------------------

# The rule `scripts/lib/_lib.sh :: The exit contract` states, judged on each script's syntax tree as shfmt (mvdan/sh,
# the parser shfmt formats with) prints it, `--to-json`. Bash suspends `set -e` and the ERR trap for every command a
# function or a list runs as a condition, on either side but the last of `&&` and `||`, or after `!`, so where a
# command runs is followed through every function it is called from, to a fixed point.

Node = dict[str, Any]

# Bash's builtins and the words naming no command of their own; a name neither these nor a function of the scripts is
# an external command.
BUILTINS: Final = frozenset(
    {"alias", "bg", "bind", "break", "builtin", "caller", "compgen", "complete", "compopt", "continue", "declare", "dirs"}
    | {"disown", "echo", "enable", "eval", "exit", "export", "false", "fc", "fg", "getopts", "hash", "help", "history"}
    | {"jobs", "kill", "let", "local", "logout", "mapfile", "printf", "pwd", "read", "readarray", "readonly", "return"}
    | {"set", "shift", "shopt", "suspend", "test", "times", "true", "type", "typeset", "ulimit", "umask", "unalias"}
    | {"unset", "wait", ":", "["}
)
# The builtins whose failure is the step's own, judged as an external command's is.
FAILING_BUILTINS: Final = frozenset({"cd", "pushd", "popd"})
# The runners, whose command meets its row: each by the operands ahead of its command, the options taking a value,
# the options standing alone, and whether the command runs in a subshell of the runner's. `check` takes its finding's
# sentence before the command.
RUNNERS: Final[dict[str, tuple[int, frozenset[str], frozenset[str], bool]]] = {
    "run_tool": (1, frozenset({"--stdout", "--finding", "--refusal", "--crash"}), frozenset({"--annotated", "--"}), False),
    "tool_class": (1, frozenset({"--stdout"}), frozenset(), False),
    "answered": (1, frozenset({"--stdout"}), frozenset(), False),
    "probe": (1, frozenset({"--stdout"}), frozenset(), False),
    "check": (0, frozenset({"--exits"}), frozenset({"--summary", "--annotated", "--pytest"}), True),
    "run_beside": (1, frozenset(), frozenset(), False),
}
SENTENCE_FIRST: Final = frozenset({"check"})
# Functions running the command after their operands as their own, its status theirs: by the operands, the options
# taking a value, and whether the command runs in a subshell.
WRAPPERS: Final[dict[str, tuple[int, frozenset[str], bool]]] = {
    "quietly": (0, frozenset({"--exits"}), True),
    "in_dir": (1, frozenset(), True),
    "_into": (1, frozenset(), False),
}
# Commands running the command after their own words: `env` its assignments and flags first.
PASSING: Final = frozenset({"env", "exec", "command", "nice", "nohup", "time"})
# The verbs that keep the run's count, or end it, which a subshell would keep or end alone.
VERBS: Final = frozenset(
    {"fail", "die", "refuse", "ok", "warn", "note_fail", "crash", "settle", "run_tool", "probe", "answered", "step"}
    | {"section", "finish", "end_section", "add_row", "end_row"}
)
SWALLOWS: Final = frozenset({"true", ":"})
LIBRARY: Final = "scripts/lib/_lib.sh"

# How a command's status is read, and what each one that no route reads says.
UNREAD: Final = {
    "ignored": "runs where bash suspends the error trap, so its failure is no crash and nothing reads it",
    "condition": "has its status read as a condition by no row: run it through `probe`",
    "swallowed": "has its status swallowed",
    "dropped": "runs in a substitution whose status nothing reads",
    "background": "runs in the background where no `wait` reads it",
    "verb-in-subshell": "is a verb run in a subshell, whose count or ending the run never sees",
}
READ: Final = frozenset({"crash", "crashed", "routed"})


@dataclass(frozen=True)
class Ctx:
    """Where a command runs: bash's error trap suspended, inside a subshell, and in a trap's handler."""

    suspended: bool
    subshell: bool


PLAIN: Final = Ctx(suspended=False, subshell=False)


@dataclass
class Func:
    file: str
    name: str
    body: Node
    exempt: bool
    contexts: set[Ctx] = field(default_factory=lambda: set[Ctx]())
    # How each call site reads the function's own status, `passed:<function>` where it hands it to its caller.
    tails: set[str] = field(default_factory=lambda: set[str]())


@dataclass(frozen=True)
class Seen:
    file: str
    line: int
    command: str
    read: str
    function: str | None


def _literal(word: Node | None) -> str | None:
    """The word's text where it is one literal, quoted or not."""
    parts = (word or {}).get("Parts") or []
    if len(parts) != 1:
        return None
    part = parts[0]
    if part.get("Type") in ("Lit", "SglQuoted"):
        return part.get("Value", "")
    if part.get("Type") == "DblQuoted":
        inner = part.get("Parts") or []
        if len(inner) == 1 and inner[0].get("Type") == "Lit":
            return inner[0].get("Value", "")
    return None


def _shown(word: Node) -> str:
    """The word roughly as written, for a finding's line."""
    out: list[str] = []
    for part in word.get("Parts") or []:
        kind = part.get("Type")
        if kind in ("Lit", "SglQuoted"):
            out.append(part.get("Value", ""))
        elif kind == "DblQuoted":
            out.append(_shown(part))
        elif kind == "ParamExp":
            out.append("$" + ((part.get("Param") or {}).get("Value") or "?"))
        else:
            out.append("…")
    return "".join(out)


def _is_argv(word: Node) -> bool:
    """`"$@"`, or a slice of it: the command a runner or a wrapper was handed."""
    parts = word.get("Parts") or []
    if len(parts) == 1 and parts[0].get("Type") == "DblQuoted":
        parts = parts[0].get("Parts") or []
    return len(parts) == 1 and parts[0].get("Type") == "ParamExp" and (parts[0].get("Param") or {}).get("Value") in ("@", "*")


def _line(node: Node) -> int:
    return int((node.get("Pos") or {}).get("Line", 0))


def _substitutions(node: Any) -> list[Node]:
    """Every command or process substitution inside `node`, outermost first, in the order written."""
    found: list[Node] = []
    if isinstance(node, dict):
        if node.get("Type") in ("CmdSubst", "ProcSubst"):
            return [node]
        for value in node.values():
            found += _substitutions(value)
    elif isinstance(node, list):
        for value in node:
            found += _substitutions(value)
    return found


class Sweep:
    """Every external command of `trees`, and every `cd`, by how its status is read, and every verb run in a subshell.

    `library` is the file every other one sources: its Guards section reads a status by a rule of its own, and what
    runs before its ERR trap is installed runs before any route exists.
    """

    def __init__(self, trees: dict[str, Node], library: list[str]) -> None:
        self.trees = trees
        start = next(n for n, line in enumerate(library, 1) if line.startswith("# --- Guards"))
        self.guards = (start, next(n for n, line in enumerate(library, 1) if n > start and line.startswith("# --- ")))
        self.bootstrap = next(n for n, line in enumerate(library, 1) if line.startswith("trap '_on_err_trap"))
        self.funcs: dict[tuple[str, str], Func] = {}
        self.seen: list[Seen] = []
        self.settled: dict[tuple[str, str | None], set[str]] = {}
        self.handlers: set[tuple[str, str]] = set()
        self.waits: set[tuple[str, str | None]] = set()
        self.walked: set[tuple[str, str, Ctx]] = set()
        self.runners = dict(RUNNERS)
        for file, tree in trees.items():
            self._index(file, tree)
        self._forwarding()

    def _index(self, file: str, node: Any) -> None:
        if isinstance(node, dict):
            if node.get("Type") == "FuncDecl":
                name = node["Name"]["Value"]
                guard = file == LIBRARY and self.guards[0] <= _line(node) < self.guards[1]
                self.funcs[(file, name)] = Func(file, name, node["Body"], guard)
            for value in node.values():
                self._index(file, value)
        elif isinstance(node, list):
            for value in node:
                self._index(file, value)

    def _forwarding(self) -> None:
        """A function handing its own arguments to a runner as the runner's command is a runner of the same kind."""
        for func in self.funcs.values():
            for call in self._calls(func.body):
                args = call.get("Args") or []
                name = _literal(args[0]) if args else None
                if name in self.runners and func.name not in self.runners:
                    rest = self.runner_command(name, args)
                    if rest and _is_argv(rest[0]):
                        _, valued, flags, subshell = self.runners[name]
                        self.runners[func.name] = (0, valued, flags, subshell)

    def runner_command(self, name: str, args: list[Node]) -> list[Node]:
        """The words of the command the runner `name` is handed in `args`, its own operands and options passed."""
        operands, valued, flags, _ = self.runners[name]
        rest = args[1 + operands :]
        while rest and (_literal(rest[0]) or "") in valued | flags:
            rest = rest[2:] if _literal(rest[0]) in valued else rest[1:]
        return rest[1:] if name in SENTENCE_FIRST else rest

    def _calls(self, node: Any) -> list[Node]:
        found: list[Node] = []
        if isinstance(node, dict):
            if node.get("Type") == "CallExpr":
                found.append(node)
            for value in node.values():
                found += self._calls(value)
        elif isinstance(node, list):
            for value in node:
                found += self._calls(value)
        return found

    def resolve(self, file: str, name: str) -> Func | None:
        return self.funcs.get((file, name)) or self.funcs.get((LIBRARY, name))

    # --- walking --------------------------------------------------------------------------------------------

    def run(self) -> list[str]:
        for func in self.funcs.values():
            # A function named by a word no reading can see, as the gate's `"scope_${SCOPE}"`, runs plain.
            func.contexts.add(PLAIN)
        for file, tree in self.trees.items():
            self.stmts(file, None, tree.get("Stmts") or [], PLAIN, "crash")
        while True:
            pending = [(func, ctx) for func in self.funcs.values() for ctx in func.contexts if (func.file, func.name, ctx) not in self.walked]
            if not pending:
                return self.findings()
            for func, ctx in pending:
                self.walked.add((func.file, func.name, ctx))
                self.stmts(func.file, func.name, [func.body], ctx, "passed")

    def stmts(self, file: str, fn: str | None, stmts: list[Node], ctx: Ctx, tail: str) -> None:
        for at, stmt in enumerate(stmts):
            read = tail if at == len(stmts) - 1 else ("ignored" if ctx.suspended else "crash")
            self.stmt(file, fn, stmt, ctx, read)

    def stmt(self, file: str, fn: str | None, stmt: Node, ctx: Ctx, read: str) -> None:
        if stmt.get("Negated"):
            read, ctx = "condition", Ctx(True, ctx.subshell)
        if stmt.get("Background"):
            read, ctx = "background", Ctx(ctx.suspended, True)
        for redirect in stmt.get("Redirs") or []:
            self.words(file, fn, [redirect.get("Word"), redirect.get("Hdoc")], ctx, "dropped")
        if stmt.get("Cmd"):
            self.cmd(file, fn, stmt["Cmd"], ctx, read)

    def cmd(self, file: str, fn: str | None, cmd: Node, ctx: Ctx, read: str) -> None:
        kind = cmd.get("Type")
        held = Ctx(True, ctx.subshell)
        if kind == "BinaryCmd" and cmd["Op"] in ("&&", "||"):
            left = self.read_by(cmd["Y"]) if cmd["Op"] == "||" else "condition"
            self.stmt(file, fn, cmd["X"], held, left)
            self.stmt(file, fn, cmd["Y"], ctx, read)
        elif kind == "BinaryCmd":
            # A pipe: with `pipefail` every element's status reaches the pipeline's, each in a subshell.
            piped = Ctx(ctx.suspended, True)
            self.stmt(file, fn, cmd["X"], piped, read)
            self.stmt(file, fn, cmd["Y"], piped, read)
        elif kind == "IfClause":
            self.clause(file, fn, cmd, ctx, read)
        elif kind == "WhileClause":
            self.stmts(file, fn, cmd.get("Cond") or [], held, "condition")
            self.stmts(file, fn, cmd.get("Do") or [], ctx, read)
        elif kind == "ForClause":
            self.words(file, fn, [(cmd.get("Loop") or {}).get("Items")], ctx, "dropped")
            self.stmts(file, fn, cmd.get("Do") or [], ctx, read)
        elif kind == "CaseClause":
            self.words(file, fn, [cmd.get("Word")], ctx, "dropped")
            for item in cmd.get("Items") or []:
                self.stmts(file, fn, item.get("Stmts") or [], ctx, read)
        elif kind == "Block":
            self.stmts(file, fn, cmd.get("Stmts") or [], ctx, read)
        elif kind == "Subshell":
            self.stmts(file, fn, cmd.get("Stmts") or [], Ctx(ctx.suspended, True), read)
        elif kind in ("TestClause", "ArithmCmd", "LetClause", "DeclClause"):
            # A test's words and `local`'s values each answer the test's or the declaration's status, never theirs.
            self.words(file, fn, [cmd], ctx, "dropped")
        elif kind == "TimeClause" and cmd.get("Stmt"):
            self.stmt(file, fn, cmd["Stmt"], ctx, read)
        elif kind == "CallExpr":
            self.call(file, fn, cmd, ctx, read)

    def clause(self, file: str, fn: str | None, cmd: Node, ctx: Ctx, read: str) -> None:
        self.stmts(file, fn, cmd.get("Cond") or [], Ctx(True, ctx.subshell), "condition")
        self.stmts(file, fn, cmd.get("Then") or [], ctx, read)
        other = cmd.get("Else")
        if other and other.get("Cond"):
            self.clause(file, fn, other, ctx, read)
        elif other:
            self.stmts(file, fn, other.get("Then") or [], ctx, read)

    def read_by(self, right: Node) -> str:
        """How the command right of `||` reads the status left of it."""
        cmd = right.get("Cmd") or {}
        if cmd.get("Type") == "Block":
            stmts = cmd.get("Stmts") or []
            cmd = (stmts[0].get("Cmd") or {}) if stmts else {}
        if cmd.get("Type") != "CallExpr":
            return "condition"
        args, assigns = cmd.get("Args") or [], cmd.get("Assigns") or []
        if not args and len(assigns) == 1:
            parts = (assigns[0].get("Value") or {}).get("Parts") or []
            if len(parts) == 1 and parts[0].get("Type") == "ParamExp" and parts[0]["Param"]["Value"] == "?":
                return "captured:" + assigns[0]["Name"]["Value"]
        word = _literal(args[0]) if args else None
        code = _literal(args[1]) if len(args) == 2 else None
        if word == "crash" or (word == "exit" and code is not None and code.isdigit() and int(code) >= 3):
            return "crashed"
        if word in SWALLOWS:
            return "swallowed"
        if word == "return" and len(args) == 1:
            return "passed"
        return "condition"

    def words(self, file: str, fn: str | None, words: list[Any], ctx: Ctx, read: str) -> None:
        """Every command in these words' substitutions, the last one read as `read` and every one before it dropped."""
        found = _substitutions(words)
        for at, substitution in enumerate(found):
            inner = Ctx(ctx.suspended, True)
            own = read if at == len(found) - 1 and substitution["Type"] == "CmdSubst" else "dropped"
            self.stmts(file, fn, substitution.get("Stmts") or [], inner, own)

    def call(self, file: str, fn: str | None, cmd: Node, ctx: Ctx, read: str) -> None:
        args, assigns = cmd.get("Args") or [], cmd.get("Assigns") or []
        if not args:
            # An assignment answers the status of its last substitution alone.
            self.words(file, fn, [a.get("Value") for a in assigns] + [a.get("Array") for a in assigns], ctx, read)
            return
        self.words(file, fn, [a.get("Value") for a in assigns], ctx, "dropped")
        self.command(file, fn, args, ctx, read, _line(cmd))

    def command(self, file: str, fn: str | None, args: list[Node], ctx: Ctx, read: str, line: int) -> None:
        """The command `args` names, run under `ctx`, its status read as `read`."""
        if not args:
            return
        head = args[0]
        if _is_argv(head):
            self.words(file, fn, args[1:], ctx, "dropped")
            return
        name = _literal(head)
        # The library's own load, which a failing substitution fails, and whose `|| exit 3` is that crash.
        if name in ("source", "."):
            return
        self.words(file, fn, args, ctx, "dropped")
        if name is None:
            self.seen.append(Seen(file, line, _shown(head), read, fn))
            return
        if name == "trap" and len(args) >= 2:
            handler = self.resolve(file, (_literal(args[1]) or "").split(" ", 1)[0])
            if handler is not None:
                self.handlers.add((handler.file, handler.name))
            return
        if name == "wait":
            self.waits.add((file, fn))
        if name == "settle":
            self.settled.setdefault((file, fn), set()).update(_shown(arg).lstrip("$") for arg in args[1:])
        if name in VERBS and ctx.subshell and file != LIBRARY:
            self.seen.append(Seen(file, line, name, "verb-in-subshell", fn))
        if name in self.runners:
            subshell = self.runners[name][3]
            self.command(file, fn, self.runner_command(name, args), Ctx(True, ctx.subshell or subshell), "routed", line)
            self.enter(file, fn, name, Ctx(ctx.suspended or read not in ("crash", "passed"), ctx.subshell), read)
            return
        if name in WRAPPERS:
            operands, valued, subshell = WRAPPERS[name]
            rest = args[1 + operands :]
            while rest and (_literal(rest[0]) or "") in valued:
                rest = rest[2:]
            inner = Ctx(ctx.suspended or read not in ("crash", "passed"), ctx.subshell or subshell)
            self.command(file, fn, rest, inner, read, line)
            self.enter(file, fn, name, inner, read)
            return
        if name in PASSING:
            rest = args[1:]
            while rest and ((_literal(rest[0]) or "").startswith("-") or "=" in (_literal(rest[0]) or "")):
                if name == "command" and _literal(rest[0]) == "-v":
                    return
                rest = rest[1:]
            self.command(file, fn, rest, ctx, read, line)
            return
        if self.resolve(file, name) is not None:
            self.enter(file, fn, name, Ctx(ctx.suspended or read not in ("crash", "passed"), ctx.subshell), read)
            return
        if name in BUILTINS and name not in FAILING_BUILTINS:
            return
        self.seen.append(Seen(file, line, name, read, fn))

    def enter(self, file: str, caller: str | None, name: str, ctx: Ctx, read: str) -> None:
        func = self.resolve(file, name)
        if func is None:
            return
        func.contexts.add(ctx)
        func.tails.add(f"passed:{caller}" if read == "passed" else read)

    # --- judging --------------------------------------------------------------------------------------------

    def reads_of(self, file: str, name: str, visited: frozenset[tuple[str, str]] = frozenset()) -> set[str]:
        """How every caller reads a function's own status, through the callers it hands it on to."""
        func = self.resolve(file, name)
        if func is None or (func.file, func.name) in visited:
            return set()
        found: set[str] = set()
        # Called by a name no reading sees, as the gate's `"scope_${SCOPE}"`, a function runs plain.
        for tail in func.tails or {"crash"}:
            if tail == "passed:None":
                found.add("crash")
            elif tail.startswith("passed:"):
                found |= self.reads_of(func.file, tail.split(":", 1)[1], visited | {(func.file, func.name)})
            else:
                found.add(tail)
        return found

    def findings(self) -> list[str]:
        found: set[str] = set()
        for seen in self.seen:
            func = self.resolve(seen.file, seen.function) if seen.function else None
            # A guard's status is its refusal, and a trap's handler runs once the verdict is decided.
            if func is not None and (func.exempt or (func.file, func.name) in self.handlers):
                continue
            if func is None and seen.file == LIBRARY and seen.line < self.bootstrap:
                continue
            if seen.read == "background" and (seen.file, seen.function) in self.waits:
                continue
            reads = self.reads_of(seen.file, seen.function) if seen.read == "passed" and seen.function else {seen.read}
            for read in reads:
                if read.startswith("captured:"):
                    if read.split(":", 1)[1] not in self.settled.get((seen.file, seen.function), set()):
                        found.add(f"{seen.file}:{seen.line}: {seen.command} has its status captured and never settled")
                elif read not in READ:
                    found.add(f"{seen.file}:{seen.line}: {seen.command} {UNREAD[read]}")
        return sorted(found)


def _library() -> list[str]:
    return (REPO_ROOT / LIBRARY).read_text(encoding="utf-8").splitlines()


def _tool_image(stage: str) -> str:
    """The image the tools file pins under `stage`, as `_lib.sh :: tool_image` reads it."""
    tools = (REPO_ROOT / "scripts" / "gate" / "tools.Dockerfile").read_text(encoding="utf-8")
    images = re.findall(rf"(?m)^FROM (\S+) AS {re.escape(stage)}$", tools)
    assert len(images) == 1, f"scripts/gate/tools.Dockerfile names {images} for the stage {stage}"
    return images[0]


@cache
def _parsed(sources: tuple[tuple[str, bytes], ...]) -> dict[str, Node]:
    """Each script's syntax tree as the pinned shfmt image prints it, every script parsed in one container."""
    image = _tool_image("shfmt")
    assert shutil.which("docker") is not None, f"no docker on PATH, so the shell parser {image} cannot run and no script was read"
    folder = new_root("fl-shell-trees-")
    for number, (_, source) in enumerate(sources):
        (folder / f"{number:03}.sh").write_bytes(source)
    loop = 'for script in /scripts/*.sh; do shfmt --to-json < "$script" > "$script.json" || exit 9; done'
    done = run_bounded(("docker", "run", "--rm", "-v", f"{folder}:/scripts", "--entrypoint", "sh", image, "-c", loop))
    assert done.returncode == 0, (
        f"Docker did not run the shell parser {image} (exit {done.returncode}), so no script was read:\n{done.stdout}{done.stderr}"
    )
    return {name: json.loads((folder / f"{number:03}.sh.json").read_bytes()) for number, (name, _) in enumerate(sources)}


def _tree_sources() -> tuple[tuple[str, bytes], ...]:
    return tuple((path.relative_to(REPO_ROOT).as_posix(), path.read_bytes()) for path in sorted((REPO_ROOT / "scripts").rglob("*.sh")))


# Each shape a status reaches nothing by, as a script of one would write it, and the finding the sweep must name.
SHAPES: Final = {
    "a-function-hiding-a-command-read-beside-it": (
        'pin() { mv -f .env.next .env; }\npin || refuse "the .env could not be written"\n',
        "mv has its status read as a condition",
    ),
    "a-bare-command-in-a-function-a-runner-runs": (
        'contract() {\n  untracked="$(git ls-files --others)"\n  printf "%s\\n" "$untracked"\n}\ntool_class contract contract || exit 3\n',
        "git runs where bash suspends the error trap",
    ),
    "a-directory-change-sharing-the-tool-s-status": (
        'in_dir() { local dir="$1"; shift; ( cd "$dir" && "$@" ); }\ncheck --exits ruff "ruff failed." in_dir fl_backend ruff check\n',
        "cd has its status read as a condition",
    ),
    "a-process-substitution": ("mapfile -t files < <(git ls-files)\n", "git runs in a substitution whose status nothing reads"),
    "a-status-swallowed": ("grep -F token access.log || true\n", "grep has its status swallowed"),
    "a-status-swallowed-in-a-substitution": (
        'lines="$({ grep -F token access.log || true; })"\n',
        "grep has its status swallowed",
    ),
    "a-condition": ("if docker image prune -af; then :; fi\n", "docker has its status read as a condition"),
    "a-negated-condition": ('if ! cmp -s sent.body page.html; then fail "the page"; fi\n', "cmp has its status read as a condition"),
    "a-status-captured-and-never-settled": (
        'rc=0\ndocker ps || rc=$?\ncase "$rc" in 1) die "a finding" ;; esac\n',
        "docker has its status captured and never settled",
    ),
    "a-substitution-in-an-argument": ('info "$(git rev-parse HEAD)"\n', "git runs in a substitution whose status nothing reads"),
    "an-assignment-s-earlier-substitution": ('self="$(git rev-parse HEAD)/$(printf x)"\n', "git runs in a substitution"),
    "a-command-in-the-background-unread": ("sleep 5 &\n", "sleep runs in the background where no `wait` reads it"),
    "a-verb-in-a-substitution": ('said="$(fail "a finding")"\n', "fail is a verb run in a subshell"),
}

# Each route, which the sweep must pass.
ROUTED: Final = """run_tool utility --crash "the directory could not be made." -- mkdir -p scratch
if probe grep grep -qF token access.log; then fail "the token"; fi
listed=""
tool_class utility --stdout listed git ls-files || exit 3
head="$(git rev-parse HEAD)"
file="$(mktemp)" || crash "mktemp could not make a file"
rc=0
docker ps || rc=$?
settle docker "$rc" "$LINENO" "docker ps"
check --exits ruff "ruff failed." ruff check scripts && ok "ruff clean"
sleep 1 &
wait "$!"
"""


def _sweep(*names: str) -> list[str]:
    """The findings of the sweep over the library and the fixture scripts or tree scripts `names` name."""
    sources = _tree_sources() + tuple((f"fixture/{name}.sh", text.encode()) for name, (text, _) in SHAPES.items())
    sources += (("fixture/routed.sh", ROUTED.encode()),)
    trees = _parsed(sources)
    return Sweep({name: trees[name] for name in (LIBRARY, *names)}, _library()).run()


@pytest.mark.parametrize("shape", SHAPES.keys())
def test_the_sweep_names_each_shape_a_status_reaches_nothing_by(shape: str) -> None:
    """A sweep blind to a shape passes every script holding it, so each is planted here as one script of its own."""
    found = _sweep(f"fixture/{shape}.sh")
    wanted = SHAPES[shape][1]
    assert any(f"fixture/{shape}.sh:" in line and wanted in line for line in found), f"the sweep missed {wanted!r}: {found}"


def test_the_sweep_passes_every_route() -> None:
    """A sweep naming a route as a finding would push a script off the routes themselves."""
    assert _sweep("fixture/routed.sh") == []


def test_every_command_s_status_meets_its_row_or_a_guard_or_crashes() -> None:
    """The rule `_lib.sh`'s exit contract states, over every shell script under scripts/."""
    names = [name for name, _ in _tree_sources()]
    # Per kind: a sweep reading no script passes over none at all.
    assert {"scripts/ops/local.sh", "scripts/ops/deploy.sh", "scripts/checks/edge_test.sh"} <= set(names), names
    found = _sweep(*(name for name in names if name != LIBRARY))
    assert found == [], "a status no route reads:\n" + "\n".join(found)
