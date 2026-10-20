"""SCRIPTS · what the verify workflow's caches are keyed on, and which job writes each.

A cache keyed too narrowly restores a verdict another tree's inputs earned, and a second writer races
the first for one key: neither turns anything red. The prettier key is driven through the workflow's
own step text over a stand-in install, as the runner runs it.
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Any, Final

import pytest
from conftest import BASH, REPO_ROOT, base_env, run_shell, step_script, write_shell

WORKFLOWS: Final = REPO_ROOT / ".github" / "workflows"
VERIFY: Final = WORKFLOWS / "verify.yml"
PRETTIER_STEP: Final = "Name the installed packages a prettier verdict depends on"
NODE: Final = shutil.which("node")

# Prettier, the Tailwind package and a plugin with a dependency and a peer of its own; a package a
# stylesheet imports; and one nothing the check loads reaches.
INSTALL: Final[dict[str, dict[str, Any]]] = {
    "prettier": {},
    "tailwindcss": {},
    "plug": {"dependencies": {"dep": "^1"}, "peerDependencies": {"peer": "^1"}},
    "dep": {},
    "peer": {},
    "cssdep": {},
    "unrelated": {},
}
CONFIG: Final[dict[str, Any]] = {"plugins": ["plug"], "tailwindStylesheet": "./fl_frontend/src/app/globals.css"}
# Nested, so the walk is shown to recurse; the relative import stays under src, which the key hashes.
SHEET: Final = "src/app/globals.css"
SHEET_TEXT: Final = '@import "tailwindcss";\n@import "cssdep/x.css";\n@import "./theme.css";\n'
KEY_RE: Final = re.compile(r"^key=([0-9a-f]{64})$", re.MULTILINE)


def _fixture(
    root: Path, *, install: dict[str, dict[str, Any]] = INSTALL, bump: str = "", sheet: str = SHEET_TEXT, config: dict[str, Any] = CONFIG
) -> Path:
    """A checkout holding `.prettierrc.json` and `fl_frontend`'s stylesheets and install, every package at 1.0.0 but `bump`."""
    (root / ".prettierrc.json").write_bytes(json.dumps(config).encode("utf-8"))
    frontend = root / "fl_frontend"
    for rel, text in ((SHEET, sheet), ("src/app/theme.css", "")):
        (frontend / rel).parent.mkdir(parents=True, exist_ok=True)
        (frontend / rel).write_bytes(text.encode("utf-8"))
    for name, fields in install.items():
        package = frontend / "node_modules" / name
        package.mkdir(parents=True)
        manifest = {"name": name, "version": "1.0.1" if name == bump else "1.0.0", **fields}
        (package / "package.json").write_bytes(json.dumps(manifest).encode("utf-8"))
    return frontend


def _run(root: Path, **fixture: Any) -> tuple[int, str | None, str]:
    """The step's exit code, the key it wrote to `GITHUB_OUTPUT`, and what it printed."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    assert NODE is not None, "no node on PATH -- the step runs one"
    root.mkdir()
    frontend = _fixture(root, **fixture)
    output = root / "github-output"
    output.write_bytes(b"")
    script = write_shell(root / "step.sh", step_script(VERIFY, PRETTIER_STEP))
    # The step's `working-directory`.
    done = run_shell(BASH, script, env={**base_env(), "GITHUB_OUTPUT": output.as_posix()}, cwd=frontend)
    found = KEY_RE.search(output.read_bytes().decode("utf-8"))
    return done.returncode, found[1] if found else None, done.stdout + done.stderr


def _key(root: Path, **fixture: Any) -> str:
    code, key, said = _run(root, **fixture)
    assert code == 0 and key is not None, f"exit {code}, key {key}\n{said}"
    return key


def test_a_package_no_check_loads_leaves_the_key_where_it_was(tmp_path: Path) -> None:
    """The point of the key: a lockfile change missing every formatting package keeps the cache warm."""
    assert _key(tmp_path / "after", bump="unrelated") == _key(tmp_path / "before")


@pytest.mark.parametrize(
    "bumped", ["dep", "peer", "cssdep"], ids=["a-plugin-s-dependency", "a-plugin-s-peer", "a-package-a-stylesheet-imports"]
)
def test_a_package_a_check_loads_moves_the_key(tmp_path: Path, bumped: str) -> None:
    """Prettier keys a verdict on no plugin's code, so a key holding still here restores a stale one."""
    assert _key(tmp_path / "after", bump=bumped) != _key(tmp_path / "before")


def test_a_required_dependency_missing_stops_the_step(tmp_path: Path) -> None:
    code, _, said = _run(tmp_path / "run", install={name: fields for name, fields in INSTALL.items() if name != "dep"})
    assert code != 0, said
    assert "plug depends on dep, which is not installed" in said, said


def test_a_name_under_both_dependency_lists_is_optional(tmp_path: Path) -> None:
    """npm reads it as optional, so one a platform skips installing is no refusal."""
    plug = {"dependencies": {"dep": "^1", "native": "^1"}, "optionalDependencies": {"native": "^1"}}
    _key(tmp_path / "run", install={**INSTALL, "plug": plug})


@pytest.mark.parametrize(
    ("sheet", "config", "says"),
    [
        pytest.param(SHEET_TEXT + '@plugin "./plugin.js";\n', CONFIG, "loads ./plugin.js", id="a-relative-plugin"),
        pytest.param(SHEET_TEXT + '@config "../../tailwind.config.js";\n', CONFIG, "loads ../../tailwind.config.js", id="a-relative-config"),
        pytest.param(SHEET_TEXT + '@import "../../../shared.css";\n', CONFIG, "loads ../../../shared.css", id="a-sheet-outside-src"),
        pytest.param(
            SHEET_TEXT,
            {**CONFIG, "tailwindStylesheet": "./shared.css"},
            "tailwindStylesheet ./shared.css",
            id="a-tailwind-stylesheet-outside-src",
        ),
        # The plugin's deprecated spellings of that option, each read where `tailwindStylesheet` is absent.
        pytest.param(
            SHEET_TEXT,
            {"plugins": ["plug"], "tailwindEntryPoint": "./shared.css"},
            "tailwindEntryPoint ./shared.css",
            id="an-entry-point-outside-src",
        ),
        pytest.param(
            SHEET_TEXT, {"plugins": ["plug"], "tailwindConfig": "./shared.css"}, "tailwindConfig ./shared.css", id="a-css-config-outside-src"
        ),
        pytest.param(
            SHEET_TEXT,
            {"plugins": ["plug"], "tailwindConfig": "./tailwind.config.js"},
            "tailwindConfig ./tailwind.config.js is a script",
            id="a-script-config",
        ),
    ],
)
def test_a_file_the_key_does_not_carry_stops_the_step(tmp_path: Path, sheet: str, config: dict[str, Any], says: str) -> None:
    """The Tailwind plugin reads each, and the key hashes no script and no stylesheet outside src."""
    code, _, said = _run(tmp_path / "run", sheet=sheet, config=config)
    assert code != 0, said
    assert says in said, said


def _steps(workflow: Path) -> list[list[str]]:
    """Each step's lines, from its `- ` to the next one's."""
    lines = workflow.read_text(encoding="utf-8").splitlines()
    starts = [number for number, line in enumerate(lines) if line.startswith("      - ")]
    return [lines[start:end] for start, end in zip(starts, [*starts[1:], len(lines)], strict=True)]


def test_the_prettier_cache_is_keyed_on_the_step_the_cases_drive_and_the_stylesheets() -> None:
    """A key dropping either term restores a verdict another install or another stylesheet earned."""
    steps = _steps(VERIFY)
    [named] = [step for step in steps if f"        name: {PRETTIER_STEP}" in step]
    [step_id] = [found[1] for line in named if (found := re.fullmatch(r"      - id: (\S+)", line))]
    [cache] = [step for step in steps if "          path: fl_frontend/node_modules/.cache/prettier" in step]
    [key] = [line.removeprefix("          key: ") for line in cache if line.startswith("          key: ")]
    opened = cache.index("          restore-keys: |")
    restore = [line.strip() for line in cache[opened + 1 :] if line.startswith("            ")]
    # The stylesheets the step's `keyed` admits, the files its walk leaves to this hash.
    terms = [f"${{{{ steps.{step_id}.outputs.key }}}}", "${{ hashFiles('fl_frontend/src/**/*.css') }}"]
    assert restore, "the prettier cache restores no prefix"
    for prefix in restore:
        assert key.startswith(prefix), f"the restore prefix {prefix!r} is not the key's, so it restores another key's verdict"
        for term in terms:
            assert term in prefix, f"the restore prefix {prefix!r} lacks {term}"


def test_one_job_alone_saves_the_pnpm_store() -> None:
    """A second writer prunes the store too and races the first to save one key, the loser's failure only a warning."""
    writers = [
        f"{path.name}:{number}"
        for path in sorted(WORKFLOWS.glob("*.yml"))
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1)
        # Any value but a literal `false`: an expression such as `${{ matrix.shard == 1 }}` reaches the action as `true`.
        if (found := re.fullmatch(r"\s+save-store:\s*(.*?)\s*(?:#.*)?", line)) and found[1].strip("\"'") != "false"
    ]
    assert len(writers) == 1, f"save-store other than false in {writers}, where one job writes the store"
