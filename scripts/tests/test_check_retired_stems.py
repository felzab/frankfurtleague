"""SCRIPTS · the retired-stem check, driven red by a German name planted in each place a name stands.

`check_retired_stems.py` is the one thing holding the code's names English, so a rule it lost would
pass in silence: every case plants a name in a fixture repository and reads the run's exit code and
report. The visitor's German is planted beside it, since a check reporting the visitor's text would
be switched off rather than read. The gate's own run of the checker is what reads this repository,
this file included, so the fixtures retire invented words rather than any the real list holds.
"""

from __future__ import annotations

import subprocess
from collections.abc import Mapping
from pathlib import Path

import pytest
from conftest import import_scripts, new_root

[stems] = import_scripts("check_retired_stems")

STEMS = "zorb\nplonk\nzoeb\nwo\n"


def git(root: Path, *args: str) -> None:
    subprocess.run(("git", *args), cwd=root, capture_output=True, check=True)


def tree(files: Mapping[str, str | bytes], *, stem_list: str | None = STEMS, attributes: str | None = None) -> Path:
    """A fixture repository tracking the files given, the stem list at its place unless told otherwise."""
    root = new_root("check-retired-stems-")
    git(root, "init", "-q")
    planted = dict(files)
    if stem_list is not None:
        planted[stems.STEM_LIST] = stem_list
    if attributes is not None:
        planted[".gitattributes"] = attributes
    for rel, content in planted.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        # Bytes, so Windows writes no carriage return.
        path.write_bytes(content if isinstance(content, bytes) else content.encode("utf-8"))
    git(root, "add", "--", ".")
    return root


def judged(capsys: pytest.CaptureFixture[str], files: Mapping[str, str | bytes], **options: str | None) -> tuple[int, str]:
    """The exit code over a fixture repository, and everything the run printed."""
    code = stems.main(tree(files, **options))
    printed = capsys.readouterr()
    return code, printed.out + printed.err


def test_english_names_pass(capsys):
    """The resting state every red case is measured against, `zorbal` holding no `zorb` among them."""
    code, _ = judged(capsys, {"app/main.py": "zorbal = connect_zorbal()\n", "src/view.ts": "export const overview = 1;\n"})

    assert code == 0


def test_a_path_segment_holding_a_stem_is_reported():
    root = tree({"src/answerZorb.ts": "export const answer = 1;\n"})

    assert [(hit.path, hit.line, hit.name, hit.stem) for hit in stems.judge(root, frozenset({"zorb"}))] == [
        ("src/answerZorb.ts", None, "answerZorb.ts", "zorb")
    ]


@pytest.mark.parametrize(
    ("rel", "source", "name"),
    [
        ("app/panel.py", "class FLTeamPanelZorb:\n    pass\n", "FLTeamPanelZorb"),
        ("src/rows.ts", "export const x = 1;\nexport function zorbRow() {}\n", "zorbRow"),
        ("src/Rail.tsx", "export const r = () => (\n  <Rail plonk={1} />\n);\n", "plonk"),
        ("scripts/run.sh", "#!/usr/bin/env bash\nlocal zorb_file=x\n", "zorb_file"),
        ("hooks/pre-commit", '#!/usr/bin/env bash\necho "${zorb_file:-$(cat "${here}/x")}"\n', "zorb_file"),
        ("compose.yml", "services:\n  zorb:\n    image: x\n", "zorb"),
        ("src/size.ts", "export const zöb = 1;\n", "zöb"),
    ],
    ids=["python", "typescript", "jsx-attribute", "shell", "suffixless-hook", "yaml", "umlaut"],
)
def test_an_identifier_holding_a_stem_is_reported_in_each_language(capsys, rel, source, name):
    code, printed = judged(capsys, {rel: source})

    assert code == 1
    assert f"{rel}:" in printed
    assert f"  {name}  holds " in printed


@pytest.mark.parametrize(
    ("rel", "source"),
    [
        ("app/router.py", 'FIELDS = {"zorb": 1}\n'),
        ("app/router.py", 'PATH = f"/api/zorb/{team_id}"\n'),
        ("src/rail.ts", 'export const ids = ["plonk"];\n'),
        ("src/route.ts", "export const path = (id: string) => `/area/zorb/${id}`;\n"),
        ("app/config.json", '{"zorbRows": true}\n'),
    ],
    ids=["python-key", "python-f-string", "typescript", "template", "json-key"],
)
def test_a_string_that_is_a_name_is_reported(capsys, rel, source):
    code, printed = judged(capsys, {rel: source})

    assert code == 1
    assert rel in printed


@pytest.mark.parametrize(
    ("rel", "source"),
    [
        ("app/mail.py", 'LINE = "Dein Zorb steht fest"\n'),
        ("app/mail.py", 'SENDER = "zorb@example.org"\n'),
        ("app/mail.py", 'ADDRESS = f"zorb.{position}@example.org"\n'),
        ("app/mail.py", 'LABEL = "Zorb"\n'),
        ("src/team.ts", 'export const team = { shorthand: "WO" };\n'),
        ("src/core/word.ts", 'export const label = "zöb";\n'),
        ("app/mail.py", "# the zorb rows\nx = 1\n"),
        ("app/mail.py", 'def f():\n    """The zorb rows."""\n'),
        ("src/match.ts", "export const isRow = (line: string) => /^zorb$/.test(line);\n"),
        ("src/Page.tsx", "export const Page = () => <p>zorb</p>;\n"),
        ("scripts/run.sh", "#!/usr/bin/env bash\ncat <<EOF\nzorb\nEOF\n"),
    ],
    ids=[
        "sentence",
        "address",
        "interpolated-address",
        "capitalised",
        "kuerzel",
        "umlaut",
        "comment",
        "docstring",
        "regex",
        "jsx-text",
        "heredoc",
    ],
)
def test_the_visitors_text_is_no_name(capsys, rel, source):
    code, printed = judged(capsys, {rel: source})

    assert code == 0, printed


def test_a_catalogue_string_is_the_visitors_text_and_its_key_a_name(capsys):
    catalogue = "fl_frontend/src/core/copy.ts"
    clean, _ = judged(capsys, {catalogue: 'export const COPY = { or: "zorb" };\n'})
    keyed, printed = judged(capsys, {catalogue: 'export const COPY = { zorb: "Zorb" };\n'})

    assert (clean, keyed) == (0, 1)
    assert f"{catalogue}:1  zorb  holds zorb" in printed


def test_a_generated_file_and_a_lockfile_are_not_read(capsys):
    files = {
        "src/generated/client.ts": "export const zorbRow = 1;\n",
        "pnpm-lock.yaml": "packages:\n  zorb: {}\n",
        # Read, so the marked run judged something rather than refusing.
        "src/main.ts": "export const main = 1;\n",
    }
    marked, _ = judged(capsys, files, attributes="src/generated/** linguist-generated=true\n")
    unmarked, printed = judged(capsys, files)

    assert (marked, unmarked) == (0, 1)
    assert "src/generated/client.ts" in printed
    assert "pnpm-lock.yaml" not in printed


def test_a_hit_is_reported_once_per_line_name_and_stem(capsys):
    code, printed = judged(capsys, {"app/a.py": "zorb = zorb\n"})

    assert code == 1
    assert printed.count("app/a.py:1  zorb  holds zorb") == 1


def test_no_stem_list_refuses(capsys):
    code, printed = judged(capsys, {"app/a.py": "x = 1\n"}, stem_list=None)

    assert code == stems.EXIT_REFUSED
    assert stems.STEM_LIST in printed


def test_an_empty_stem_list_refuses(capsys):
    code, _ = judged(capsys, {"app/a.py": "x = 1\n"}, stem_list="\n")

    assert code == stems.EXIT_REFUSED


def test_a_tree_git_does_not_hold_refuses(capsys):
    root = new_root("check-retired-stems-")
    (root / stems.STEM_LIST).parent.mkdir(parents=True)
    (root / stems.STEM_LIST).write_bytes(STEMS.encode("utf-8"))

    assert stems.main(root) == stems.EXIT_REFUSED
    assert "git" in capsys.readouterr().err


def test_a_code_file_that_does_not_decode_refuses(capsys):
    code, printed = judged(capsys, {"app/a.py": b"x = '\xff'\n"})

    assert code == stems.EXIT_REFUSED
    assert "app/a.py" in printed


@pytest.mark.parametrize(
    ("rel", "source"),
    [("src/a.ts", 'const a = "never closed;\n'), ("app/a.py", 'x = """never closed\n'), ("scripts/a.sh", '#!/bin/bash\necho "never closed\n')],
    ids=["typescript", "python", "shell"],
)
def test_a_file_the_reader_cannot_lex_refuses(capsys, rel, source):
    code, printed = judged(capsys, {rel: source})

    assert code == stems.EXIT_REFUSED
    assert rel in printed


def test_a_tree_holding_no_code_refuses(capsys):
    code, _ = judged(capsys, {"docs/guide.md": "# Guide\n"})

    assert code == stems.EXIT_REFUSED
