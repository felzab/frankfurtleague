"""SCRIPTS · the platform checker's net: each clause driven red against a plant and green without it.

Every case runs `scripts/docs_gate/platform.py` in an interpreter of its own over a throwaway
repository, in `scripts/tests/test_check_docs.py`'s shape: the gate's copy is imported from inside
the fixture, so its REPO_ROOT is the fixture and the corpus is what git lists there. The copy sits
under a folder that is NOT `scripts/`, because here `scripts/` is corpus. Stdlib only, the type
checker reading `scripts/` with no environment declared; and no plant is spelled at module level
in a shape the checker reads, each being built inside the case that needs it.
"""

from __future__ import annotations

import atexit
import contextlib
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Final

REPO_ROOT: Final = Path(__file__).resolve().parent.parent.parent

# The copied gate, named so the fixture's own `scripts/` folder is read as corpus rather than skipped.
GATE_COPY: Final = "gate"
DRIVER: Final = "drive.py"
NL: Final = chr(10)
# The checks by the names the registry gives them.
PLATFORM: Final = "platform-branch"
CRLF: Final = "crlf-write"

TOOL: Final = "scripts/tool.py"
TOOL_TEST: Final = "scripts/tests/test_tool.py"
RUN_SH: Final = "scripts/run.sh"
HOOK: Final = ".claude/hooks/probe.sh"
# `commit-msg` rather than `pre-commit`: the real allowlist names a symbol in the latter, and a row is
# held to any file of that path the corpus holds -- this fixture's included.
GIT_HOOK: Final = ".githooks/commit-msg"
BACKEND: Final = "fl_backend/app/writer.py"
# Every registered check's verdict is a failure, so a red run is exit 1 and a green one 0.
RED: Final = 1
GREEN: Final = 0


def _lines(*lines: str) -> str:
    return NL.join(lines) + NL


def _corpus() -> dict[str, str]:
    """The clean corpus: one file per surface the checker reads, none carrying a branch it would report."""
    return {
        ".gitignore": _lines("/" + GATE_COPY + "/"),
        TOOL: _lines(
            '"""SCRIPTS · a module that binds the platform once, as the rule prescribes."""',
            "import sys",
            "from pathlib import Path",
            "from typing import Final",
            "",
            'POSIX: Final = sys.platform != "win32"',
            "",
            "",
            "def stop() -> str:",
            '    return "group" if POSIX else "handle"',
            "",
            "",
            "def save(path: Path, text: str) -> None:",
            '    path.write_bytes(text.encode("utf-8"))',
        ),
        TOOL_TEST: _lines(
            "import tool",
            "",
            "",
            "def test_both_arms() -> None:",
            "    tool.POSIX = True",
            '    assert tool.stop() == "group"',
            "    tool.POSIX = False",
            '    assert tool.stop() == "handle"',
        ),
        RUN_SH: _lines(
            "#!/usr/bin/env bash",
            "# A script with no platform branch; a comment naming uname or cygpath explains one and is not one.",
            "printf 'ok'",
        ),
        HOOK: _lines("#!/usr/bin/env bash", "printf 'hook'"),
        GIT_HOOK: _lines("#!/usr/bin/env bash", "exit 0"),
        BACKEND: _lines(
            '"""BACKEND · a module whose opens read, so the write clause has a file it says nothing about."""',
            "from pathlib import Path",
            "",
            "",
            "def load(path: Path) -> bytes:",
            "    with open(path) as handle:",
            "        handle.read()",
            '    with path.open("rb") as raw:',
            "        return raw.read()",
        ),
        DRIVER: _lines(
            "import json",
            "import sys",
            "from pathlib import Path",
            "",
            'sys.path.insert(0, str(Path(__file__).resolve().parent / "' + GATE_COPY + '"))',
            "from docs_gate import platform",
            "",
            "rows, write_rows = json.loads(sys.argv[1]), json.loads(sys.argv[2])",
            "found = platform.check_platform_branches({**platform.PLATFORM_ALLOW, **rows})",
            "found += platform.check_text_writes({**platform.TEXT_WRITE_ALLOW, **write_rows})",
            "for finding in found:",
            "    print(chr(9).join((finding.check, finding.file, str(finding.line or 0), finding.detail)))",
            'raise SystemExit(1 if any(finding.severity == "fail" for finding in found) else 0)',
        ),
    }


# --- the fixture repository ----------------------------------------------------------------------


@dataclass(frozen=True)
class Fixture:
    root: Path


def _git(root: Path, *args: str) -> None:
    done = subprocess.run(("git", *args), cwd=root, capture_output=True, text=True, encoding="utf-8", check=False)
    if done.returncode != 0:
        raise RuntimeError("git " + " ".join(args) + " failed: " + (done.stderr.strip() or done.stdout.strip()))


def _write(root: Path, rel: str, text: str) -> None:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    # Bytes: a text handle would hand the checker a CRLF corpus, and its own clause is what this file proves.
    path.write_bytes(text.encode("utf-8"))


def _discard(root: Path) -> None:
    """Remove the fixture, the read-only objects git wrote included -- Windows will not unlink those bare."""

    def _clear_readonly(remove: Callable[..., object], path: str, _exc: BaseException) -> None:
        os.chmod(path, stat.S_IWRITE)
        remove(path)

    with contextlib.suppress(OSError):
        shutil.rmtree(root, onexc=_clear_readonly)


def _load() -> Fixture:
    root = Path(tempfile.mkdtemp(prefix="platform-checks-fixture-")).resolve()
    atexit.register(_discard, root)
    ignored = shutil.ignore_patterns("__pycache__", "tests", ".ruff_cache", ".pytest_cache", ".mypy_cache")
    shutil.copytree(REPO_ROOT / "scripts", root / GATE_COPY, ignore=ignored)
    for rel, text in _corpus().items():
        _write(root, rel, text)
    (root / "nohooks").mkdir()
    _git(root, "init", "-b", "main")
    for name, value in (
        ("user.name", "fixture"),
        ("user.email", "fixture@example.invalid"),
        ("commit.gpgsign", "false"),
        ("core.hooksPath", "nohooks"),
    ):
        _git(root, "config", name, value)
    _git(root, "add", "--", ".")
    _git(root, "commit", "-q", "-m", "Fixture corpus")
    return Fixture(root)


_STATE: list[Fixture] = []


def _gate() -> Fixture:
    if not _STATE:
        _STATE.append(_load())
    return _STATE[0]


# --- driving it ----------------------------------------------------------------------------------

# One printed finding: the check, the file, the line it named or 0, and its detail.
Reported = tuple[str, str, int, str]


def _run(rows: dict[str, str] | None = None, write_rows: dict[str, str] | None = None) -> tuple[int, list[Reported]]:
    """The checker's exit code over the fixture as it stands, and every finding it printed."""
    root = _gate().root
    command = (sys.executable, str(root / DRIVER), json.dumps(rows or {}), json.dumps(write_rows or {}))
    done = subprocess.run(command, cwd=root, capture_output=True, text=True, encoding="utf-8", check=False)
    assert done.returncode in (RED, GREEN), "the driver crashed:" + NL + done.stdout + done.stderr
    found: list[Reported] = []
    for line in done.stdout.splitlines():
        check, rel, number, detail = line.split(chr(9), 3)
        found.append((check, rel, int(number), detail))
    return done.returncode, found


@contextlib.contextmanager
def _planted(rel: str, text: str) -> Iterator[None]:
    """One file written for a case and put back -- or removed -- however the case ends."""
    root = _gate().root
    path = root / rel
    before = path.read_bytes() if path.exists() else None
    _write(root, rel, text)
    try:
        yield
    finally:
        if before is None:
            path.unlink()
        else:
            path.write_bytes(before)


def _appended(rel: str, *lines: str) -> contextlib.AbstractContextManager[None]:
    return _planted(rel, (_gate().root / rel).read_text(encoding="utf-8") + _lines(*lines))


def _shape(found: list[Reported]) -> list[tuple[str, str, str]]:
    """Each finding as its check, its file and its clause -- the text before the first colon."""
    return [(check, rel, detail.partition(":")[0]) for check, rel, _, detail in found]


def _only(found: list[Reported], check: str, rel: str, *fragments: str) -> None:
    """Exactly one finding, of this check about this file, whose detail carries every fragment."""
    assert len(found) == 1, found
    reported_check, reported_rel, _, detail = found[0]
    assert (reported_check, reported_rel) == (check, rel), found
    for fragment in fragments:
        assert fragment in detail, detail


# --- the cases -----------------------------------------------------------------------------------


def test_the_clean_corpus_is_silent() -> None:
    """A constant bound once, a test binding it both ways, and a comment naming a token report nothing."""
    code, found = _run()
    assert (code, found) == (GREEN, []), found


def test_a_predicate_read_outside_a_module_constant_is_plat_1_until_bound_or_allowlisted() -> None:
    """The constant is the admitted shape; a function reading the predicate, or a lower-case module name, is not."""
    with _appended(TOOL, "", "", "def probe() -> bool:", '    return sys.platform == "win32"'):
        code, found = _run()
        assert code == RED
        _only(found, PLATFORM, TOOL, "PLAT-1", "`sys.platform`", "`probe`")
        # The row excuses the read and nothing else: an allowlisted predicate still owes PLAT-3 both
        # of its bindings, which this corpus's test does not carry.
        code, found = _run(rows={TOOL + " :: probe": "a reason, written where a reviewer reads it"})
        assert code == RED
        assert _shape(found) == [(PLATFORM, TOOL, "PLAT-3"), (PLATFORM, TOOL, "PLAT-3")], found
    with _appended(TOOL, "", "host = sys.platform"):
        code, found = _run()
        assert code == RED
        _only(found, PLATFORM, TOOL, "PLAT-1", "`host`")
    with _appended(BACKEND, "", "import platform", "", "", "def where() -> str:", "    return platform.system()"):
        code, found = _run()
        assert code == RED
        _only(found, PLATFORM, BACKEND, "PLAT-1", "`platform.system()`")
    code, found = _run()
    assert (code, found) == (GREEN, []), found


def test_a_driver_rebinding_the_predicate_is_a_value_and_a_read_of_it_is_not() -> None:
    """A Store context is PLAT-3's own shape; a Load of the same chain in a test is a read like any other."""
    with _appended(TOOL_TEST, "", "", "def test_rebound() -> None:", '    tool.sys.platform = "linux"', '    tool.sys.platform = "win32"'):
        code, found = _run()
        assert (code, found) == (GREEN, []), found
    with _appended(TOOL_TEST, "", "", "def test_reads() -> None:", '    assert tool.sys.platform != "haiku"'):
        code, found = _run()
        assert code == RED
        _only(found, PLATFORM, TOOL_TEST, "PLAT-1", "`test_reads`")


def test_a_test_standing_down_on_the_platform_is_plat_2_in_each_shape() -> None:
    """An early return, a skip marker and a driver snippet are spellings of one skipped arm."""
    with _appended(
        TOOL_TEST, "", "", "def test_group() -> None:", "    if not tool.POSIX:", "        return", '    assert tool.stop() == "group"'
    ):
        code, found = _run()
        assert code == RED
        _only(found, PLATFORM, TOOL_TEST, "PLAT-2", "`test_group`")
    with _appended(
        TOOL_TEST, "import pytest", "", "", '@pytest.mark.skipif(not tool.POSIX, reason="no groups")', "def test_marked() -> None:", "    pass"
    ):
        code, found = _run()
        assert code == RED
        _only(found, PLATFORM, TOOL_TEST, "PLAT-2", "`test_marked`", "skipif")
    snippet = ("SNIPPET = (", '    "if not tool.POSIX:",', '    "    raise SystemExit(0)",', '    "assert True",', ")")
    with _appended(TOOL_TEST, "", *snippet):
        code, found = _run()
        assert code == RED
        _only(found, PLATFORM, TOOL_TEST, "PLAT-2", "`SNIPPET`")
        code, found = _run(rows={TOOL_TEST + " :: SNIPPET": "no process group exists to compare off POSIX"})
        assert (code, found) == (GREEN, []), found


def test_a_constant_or_predicate_bound_to_one_value_alone_is_plat_3() -> None:
    """Both arms must execute everywhere, so the missing binding is named at the definition, and no row excuses it."""
    one_sided = (_gate().root / TOOL_TEST).read_text(encoding="utf-8").replace("    tool.POSIX = False" + NL, "")
    with _planted(TOOL_TEST, one_sided):
        code, found = _run()
        assert code == RED
        _only(found, PLATFORM, TOOL, "PLAT-3", "`tool.POSIX = False`")
        code, found = _run(rows={TOOL + " :: POSIX": "a row cannot stand in for the missing case"})
        assert code == RED, found
    probe = ("", "", "def probe() -> bool:", '    return sys.platform == "win32"')
    row = {TOOL + " :: probe": "read per call for the narrowing"}
    with _appended(TOOL, *probe), _appended(TOOL_TEST, "", "", "def test_linux() -> None:", '    tool.sys.platform = "linux"'):
        code, found = _run(rows=row)
        assert code == RED
        _only(found, PLATFORM, TOOL, "PLAT-3", "'win32'")
    with (
        _appended(TOOL, *probe),
        _appended(TOOL_TEST, "", "", "def test_both() -> None:", '    tool.sys.platform = "linux"', '    tool.sys.platform = "win32"'),
    ):
        code, found = _run(rows=row)
        assert (code, found) == (GREEN, []), found


def test_a_shell_token_in_code_is_plat_4_wherever_the_shell_is_read() -> None:
    """Every shell surface the clause reads, and each anchor a row may name: function, assigned name, step label, fragment."""
    with _appended(RUN_SH, "host() {", '  case "$(uname -s)" in', "    Linux) printf linux ;;", "  esac", "}"):
        code, found = _run()
        assert code == RED
        _only(found, PLATFORM, RUN_SH, "PLAT-4", "uname")
        code, found = _run(rows={RUN_SH + " :: host": "classifies the host"})
        assert (code, found) == (GREEN, []), found
    with _appended(HOOK, 'work="$(cygpath -w "$work" 2>/dev/null || printf %s "$work")"'):
        code, found = _run()
        assert code == RED
        _only(found, PLATFORM, HOOK, "PLAT-4", "cygpath")
        code, found = _run(rows={HOOK + " :: work": "mktemp's MSYS alias"})
        assert (code, found) == (GREEN, []), found
    with _appended(GIT_HOOK, '[[ "${OSTYPE}" == msys ]] && exit 0'):
        code, found = _run()
        assert code == RED
        _only(found, PLATFORM, GIT_HOOK, "PLAT-4", "${OSTYPE")
        code, found = _run(rows={GIT_HOOK + " :: == msys ]] && exit 0": "a fragment of the line, where nothing encloses it"})
        assert (code, found) == (GREEN, []), found
    with _appended(RUN_SH, 'step "probe · a container mount"', "MSYS_NO_PATHCONV=1 run_container /mnt"):
        code, found = _run()
        assert code == RED
        _only(found, PLATFORM, RUN_SH, "PLAT-4", "MSYS_NO_PATHCONV")
        code, found = _run(rows={RUN_SH + " :: probe · a container mount": "MSYS rewrites the container-side path"})
        assert (code, found) == (GREEN, []), found
        # The token itself is never an anchor: a row spelling it would excuse every use in the file.
        code, found = _run(rows={RUN_SH + " :: MSYS_NO_PATHCONV": "the property as its own excuse"})
        assert code == RED, found


def test_a_row_naming_a_function_does_not_excuse_the_lines_calling_it() -> None:
    """An enclosing anchor is matched before a fragment, so `mount_source`'s row never reaches `run_shellcheck`."""
    body = (
        "mount_source() {",
        '  cygpath -w "$REPO_ROOT"',
        "}",
        "run_shellcheck() {",
        '  MSYS_NO_PATHCONV=1 run_container -v "$(mount_source):/mnt"',
        "}",
    )
    with _appended(RUN_SH, *body):
        code, found = _run(rows={RUN_SH + " :: mount_source": "the /tmp mount"})
        assert code == RED
        _only(found, PLATFORM, RUN_SH, "PLAT-4", "MSYS_NO_PATHCONV")
        code, found = _run(rows={RUN_SH + " :: mount_source": "the /tmp mount", RUN_SH + " :: run_shellcheck": "the rewrite"})
        assert (code, found) == (GREEN, []), found


def test_an_allow_row_is_held_to_the_tree_it_excuses() -> None:
    """A row naming a symbol the file lost, or shielding nothing, fails; one naming an absent file is not this tree's."""
    code, found = _run(rows={RUN_SH + " :: nothing_here": "a symbol the script never spelled"})
    assert code == RED
    _only(found, PLATFORM, RUN_SH, "names a symbol the file no longer spells")
    code, found = _run(rows={TOOL + " :: stop": "a symbol that reads no predicate"})
    assert code == RED
    _only(found, PLATFORM, TOOL, "shields no site")
    code, found = _run(rows={"scripts/absent.sh :: anything": "a file this corpus does not hold"})
    assert (code, found) == (GREEN, []), found


def test_a_text_mode_write_without_newline_is_red_and_removing_it_is_green() -> None:
    """The acceptance case: `write_text` planted, exit 1 with the finding; removed, exit 0; `newline=""` never flagged."""
    with _appended(TOOL, "", 'Path("x").write_text("a\\n")'):
        code, found = _run()
        assert code == RED
        _only(found, CRLF, TOOL, "text-mode write", "`Path.write_text`", 'newline=""')
        code, found = _run(write_rows={TOOL + " :: " + TOOL: "a module-level write, excused by the file itself"})
        assert code == RED, "a row naming no symbol in the file excused a module-level statement"
    code, found = _run()
    assert (code, found) == (GREEN, []), found
    with _appended(
        TOOL,
        "",
        "",
        "def keep(path: Path) -> None:",
        '    with open(path, "w", encoding="utf-8", newline="") as handle:',
        '        handle.write("x")',
    ):
        code, found = _run()
        assert (code, found) == (GREEN, []), found
    with _appended(BACKEND, "", "", "def dump(path: Path) -> None:", '    path.write_text("a")'):
        code, found = _run()
        assert code == RED
        _only(found, CRLF, BACKEND, "text-mode write")
        code, found = _run(write_rows={BACKEND + " :: dump": "a file the deployment's own tools read back, CRLF and all"})
        assert (code, found) == (GREEN, []), found


def test_every_text_writer_spelling_is_read_and_a_read_or_binary_mode_is_not() -> None:
    """One function per spelling: a finding for every writer the clause knows, and none for a reader."""
    writers = (
        ('    with open(path, "w") as a:', "        a.write(text)"),
        ('    with open(path, mode="a", encoding="utf-8") as b:', "        b.write(text)"),
        ('    with path.open("w+") as c:', "        c.write(text)"),
        ('    with io.open(path, "wt") as d:', "        d.write(text)"),
        ('    with os.fdopen(fd, "w") as e:', "        e.write(text)"),
        ('    with NamedTemporaryFile("w") as f:', "        f.write(text)"),
        ('    with tempfile.NamedTemporaryFile(mode="w+", delete=False) as g:', "        g.write(text)"),
        ('    path.write_text(text, encoding="utf-8")',),
        ("    with open(path, mode) as h:", "        h.write(text)"),
        ('    with open(path, "w", newline="\\r\\n") as i:', "        i.write(text)"),
    )
    readers = (
        ("    with open(path) as a:", "        a.read()"),
        ('    with open(path, "r") as b:', "        b.read()"),
        ('    with open(path, "rb") as c:', "        c.read()"),
        ('    with path.open("wb") as d:', "        d.write(text.encode())"),
        ('    with open(path, "w", newline="") as e:', "        e.write(text)"),
        ('    with open(path, "a", newline="") as f:', "        f.write(text)"),
        ('    path.write_text(text, newline="\\n")',),
        ("    path.write_text(text, newline=chr(10))",),
        ("    with NamedTemporaryFile() as g:", "        g.write(text.encode())"),
        ("    with tempfile.TemporaryFile() as h:", "        h.write(text.encode())"),
        ("    path.read_text()",),
    )
    head = ("", "import io", "import os", "import tempfile", "from tempfile import NamedTemporaryFile", "", "")

    def module(cases: tuple[tuple[str, ...], ...]) -> list[str]:
        lines: list[str] = list(head)
        for index, body in enumerate(cases):
            lines.extend((f"def case_{index}(path: Path, fd: int, text: str, mode: str) -> None:", *body, "", ""))
        return lines

    with _appended(TOOL, *module(writers)):
        code, found = _run()
        assert code == RED
        assert [check for check, _, _, _ in found] == [CRLF] * len(writers), found
        assert all(rel == TOOL for _, rel, _, _ in found), found
        assert "cannot read" in found[8][3] and "other than" in found[9][3], found
    with _appended(TOOL, *module(readers)):
        code, found = _run()
        assert (code, found) == (GREEN, []), found
