"""The invented-data rule, driven red on each kind of value it judges and green on each it reserves.

`check_invented_data.py` is the only thing holding a test's made-up addresses and numbers to reserved
ones, so a rule it quietly stops applying is silent by construction. Each case below plants the value
it judges; the gate's own run of the checker is what reads the repository's tests.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest
from conftest import REPO_ROOT, import_scripts, new_root, run_bounded

[invented, kernel] = import_scripts("check_invented_data", "checker_kernel", directories=("checks", "lib"))

CHECKER = REPO_ROOT / "scripts" / "checks" / "check_invented_data.py"


def judged(text: str) -> list[str]:
    return [finding.detail for finding in invented.judge(text, "case.py")]


@pytest.mark.parametrize(
    "text",
    [
        pytest.param('EMAIL = "anna@schule.de"', id="an address on a registrable domain"),
        pytest.param('"Anna@Schule.DE"', id="its capitals"),
        pytest.param('"@x.de"', id="an empty local part"),
        pytest.param('f"{name}@{shorthand}.de"', id="a template's domain"),
        pytest.param('"anna@example.community"', id="a name only beginning with a reserved one"),
        pytest.param('website_url = "https://carl-schurz-schule.de"', id="a site"),
        pytest.param("`https://${club}.example.de/`", id="a template's site"),
        pytest.param('phone = "+49 170 1234567"', id="a mobile number"),
        pytest.param('"069 1234567"', id="a Frankfurt number"),
        pytest.param('"0049 (0)69 9000 91234"', id="a number longer than a range's"),
        pytest.param('f"+49 170 {position}"', id="a number a placeholder completes"),
    ],
)
def test_an_invented_value_a_third_party_may_hold_is_a_finding(text: str):
    assert len(judged(text)) == 1, judged(text)


@pytest.mark.parametrize(
    "text",
    [
        pytest.param('"anna@schule.example.org", "a@b.example.net", "x@example.com"', id="RFC 2606's second-level names"),
        pytest.param(
            '"a@mail.schule.co.example", "a@b.test", "a@b.invalid", "a@b.localhost", "a@mail.schule.local"', id="the reserved top-level names"
        ),
        pytest.param('"ada@schule.xn--zckzah"', id="IANA's IDN test domain"),
        pytest.param('"admin@frankfurtleague.de", "https://frankfurtleague.de"', id="the league's own domain"),
        pytest.param('f"{name}@{MAIL_DOMAIN}", "@{chr(0xFF58)}.example.org"', id="a template with a reserved name"),
        pytest.param('"https://challenges.cloudflare.com/turnstile", "https://www.instagram.com/x"', id="a named host"),
        pytest.param('"http://localhost:3000", "http://backend:8000", "https://1.2.3.4", "https://a.bc"', id="no registrable host"),
        pytest.param('"+49 69 90009123", "069 90009999", "(069) 90009123.", "069-9000-"', id="Frankfurt's range, whole or cut"),
        pytest.param('"+49 171 3920099", "+4917604069001", "0176 04069002", f"+49171392000{n}"', id="the mobile ranges"),
        pytest.param('"0491 234567", "+49 1 234567"', id="a kept number"),
    ],
)
def test_a_reserved_value_passes(text: str):
    assert judged(text) == []


@pytest.mark.parametrize(
    "text",
    [
        pytest.param("@pytest.mark.db\n", id="a decorator"),
        pytest.param("`@pytest.mark.db`", id="a decorator a comment quotes"),
        pytest.param('"react-aria@1.22.1.patch"', id="a package's version"),
        pytest.param("# (https://github.com/owner/repo)", id="a cited page"),
        pytest.param('"l•••@n•••.org"', id="a masked address"),
        pytest.param('"02.04.2008", "01011990", "0123456789abcdef01234567", "069 1"', id="a date, an id and a cut too short"),
    ],
)
def test_what_names_no_invented_value_is_not_judged(text: str):
    assert judged(text) == []


def run_checker(*files: Path) -> subprocess.CompletedProcess[str]:
    """The checker run as the gate runs it, as its own process."""
    return run_bounded((sys.executable, str(CHECKER), *map(str, files)))


def planted(name: str, content: bytes) -> Path:
    path = new_root("check-invented-data-") / name
    path.write_bytes(content)
    return path


def test_a_clean_file_exits_zero():
    done = run_checker(planted("test_clean.py", b'EMAIL = "anna@schule.example.org"\n'))

    assert done.returncode == kernel.EXIT_OK, done.stdout + done.stderr


def test_a_finding_fails_the_run_naming_its_line():
    path = planted("test_found.py", b'\nEMAIL = "anna@schule.de"\n')

    done = run_checker(path)

    assert done.returncode == kernel.EXIT_FINDINGS, done.stdout + done.stderr
    assert f"{path.as_posix()}:2: the address host schule.de is no reserved name" in done.stdout, done.stdout


def test_a_file_it_cannot_read_is_a_refusal():
    """A file skipped would read as a pass over what it holds."""
    done = run_checker(planted("test_latin1.py", b'EMAIL = "j\xf6rg@schule.de"\n'))

    assert done.returncode == kernel.EXIT_REFUSED, done.stdout + done.stderr
