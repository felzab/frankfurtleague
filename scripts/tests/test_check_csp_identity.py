"""SCRIPTS · the within-file Content-Security-Policy comparison

`check_csp_identity.py` reads one file at a time, so every case here writes its own configuration
text: the reader against the shapes an nginx file can put a declaration in, and `disagreements`
against the three answers it owes — a file that agrees, one whose copies drifted, and one that
sets no policy at all.

The real configurations are driven too, so a drifted copy in either fails here and not only at the
gate.

Stdlib only, and `scripts/checks/` is put on the path here because the module under test is run
as a script everywhere else, which is what seeds that directory onto the path for it.
"""

from __future__ import annotations

import contextlib
import importlib
import sys
import textwrap
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    # Named a second time for pyright alone: `import_module` hands back a `ModuleType`, whose
    # attributes are no type expression. Never imported at run time -- the withdrawal below is why.
    from check_csp_identity import Block, Declaration

SCRIPTS = Path(__file__).resolve().parents[1]

# Withdrawn again, kernel dropped from the cache with it: `test_check_docs.py` runs the gate from
# a throwaway copy of scripts/, and a `checker_kernel` cached here would answer its imports and
# root every check at the wrong repository.
sys.path.insert(0, str(SCRIPTS / "checks"))
try:
    csp = importlib.import_module("check_csp_identity")
finally:
    sys.path.remove(str(SCRIPTS / "checks"))
    sys.modules.pop("check_csp_identity", None)
    sys.modules.pop("checker_kernel", None)

POLICY = "default-src 'self'; style-src 'self' 'unsafe-inline';"
OTHER = "default-src 'self'; style-src 'self';"


def site(policy: str, indent: str = "    ") -> str:
    """One declaration as either configuration writes it, `always` included."""
    return f'{indent}add_header Content-Security-Policy "{policy}" always;'


def read(text: str) -> list[Declaration]:
    return csp.declarations(textwrap.dedent(text).strip("\n"), "under-test.conf")


def test_every_site_in_a_file_is_read_with_its_line():
    """The line number is what a finding sends a reader to, so a lost one costs the finding its point."""
    found = read(f"""
        server {{
        {site(POLICY, "")}
            location / {{
        {site(OTHER, "")}
            }}
        }}
        """)

    assert [(one.line, one.policy) for one in found] == [(2, POLICY), (4, OTHER)]


def test_a_declaration_without_always_is_read():
    """`always` is optional on `add_header`, and a reader that needs it would skip a real site."""
    assert [one.policy for one in read(f'    add_header Content-Security-Policy "{POLICY}";')] == [POLICY]


def test_a_line_setting_another_header_is_not_a_site():
    """Every location here sets four other headers beside this one."""
    assert read('    add_header X-Frame-Options "SAMEORIGIN" always;') == []


# `suppress` and a raise, not `pytest.raises`, throughout this file, for `scripts/tests/conftest.py`'s
# pytest invariant.
def test_a_declaration_this_reader_cannot_take_a_policy_out_of_refuses():
    """An unquoted value is a line the reader cannot compare, and a line it cannot read is not one it may pass."""
    with contextlib.suppress(csp.Unreadable):
        read("    add_header Content-Security-Policy default-src;")
        raise AssertionError("an unquoted policy was read")


def test_a_file_saying_one_thing_at_every_site_raises_nothing():
    """The resting state, and the shape both configurations are meant to be in."""
    found = [csp.Declaration(10, POLICY), csp.Declaration(20, POLICY), csp.Declaration(30, POLICY)]

    assert csp.disagreements("under-test.conf", found) == []


def test_a_copy_that_drifted_is_named_against_the_first():
    """The defect the check exists for: one location edited alone serves a policy of its own."""
    found = [csp.Declaration(10, POLICY), csp.Declaration(20, OTHER)]

    findings = csp.disagreements("under-test.conf", found)

    assert [finding.severity for finding in findings] == ["fail"]
    assert "under-test.conf:20" in findings[0].detail
    assert OTHER in findings[0].detail


def test_every_copy_that_drifted_is_reported():
    """A run naming one at a time would take a gate run per site to clear a file."""
    found = [csp.Declaration(10, POLICY), csp.Declaration(20, OTHER), csp.Declaration(30, OTHER)]

    assert len(csp.disagreements("under-test.conf", found)) == 2


def test_a_file_setting_no_policy_at_all_is_a_finding():
    """The population is a directory listing, so this file is judged rather than dropped (PRE-4)."""
    findings = csp.disagreements("under-test.conf", [])

    assert [finding.severity for finding in findings] == ["fail"]
    assert "no Content-Security-Policy" in findings[0].detail


def read_blocks(text: str) -> list[Block]:
    return csp.blocks(textwrap.dedent(text).strip("\n"), "under-test.conf")


def test_a_block_setting_another_header_and_no_policy_is_a_finding():
    """`docs/ops/spec.md :: I2`'s own defect: the block replaced the inherited set and put nothing back."""
    configuration = f"""
        server {{
        {site(POLICY, "")}
            location /_next/static/ {{
                add_header X-Frame-Options "SAMEORIGIN" always;
            }}
        }}
        """

    findings = csp.dropped("under-test.conf", read_blocks(configuration))

    assert [finding.severity for finding in findings] == ["fail"]
    assert "location /_next/static/" in findings[0].detail
    assert "under-test.conf:3" in findings[0].detail


def test_a_block_setting_no_header_at_all_raises_nothing():
    """The inheriting location, which is most of them: nothing was replaced, so nothing is owed."""
    configuration = f"""
        server {{
        {site(POLICY, "")}
            location = /signin {{
                limit_req zone=signin burst=3 nodelay;
                proxy_pass http://frontend:3000;
            }}
        }}
        """

    assert csp.dropped("under-test.conf", read_blocks(configuration)) == []


def test_a_block_that_redirects_is_not_asked_for_a_policy():
    """A 301 carries no document for a policy to govern, and the www block sets HSTS on one."""
    configuration = """
        server {
            add_header Strict-Transport-Security "max-age=63072000" always;
            return 301 https://frankfurtleague.de$request_uri;
        }
        """

    assert csp.dropped("under-test.conf", read_blocks(configuration)) == []


def test_a_brace_inside_a_quoted_value_opens_no_block():
    """`log_format fl_json` writes JSON, so a reader counting bare braces loses the file's nesting."""
    found = read_blocks("""
        log_format fl_json escape=json '{"level":"INFO",'
            '"host":"$http_host"}';
        server {
            add_header X-Frame-Options "SAMEORIGIN" always;
        }
        """)

    assert [one.label for one in found] == ["server"]


def test_the_repository_own_configurations_drop_the_policy_nowhere():
    """The check against the real files, so a header added to a bare location fails here too."""
    for path in sorted((csp.REPO_ROOT / csp.CONFIG_DIR).glob(csp.CONFIG_GLOB)):
        found = csp.blocks(path.read_text(encoding="utf-8"), path.name)

        assert found != []
        assert csp.dropped(path.name, found) == []


def test_a_block_opened_and_closed_on_one_line_refuses():
    """The shape this reader cannot place: charging its add_header to the enclosing block would pass it."""
    with contextlib.suppress(csp.Unreadable):
        read_blocks('server { add_header X-Frame-Options "SAMEORIGIN" always; }')
        raise AssertionError("a block opened and closed on one line was placed")


def test_a_block_never_closed_refuses():
    """Half a file read as a whole one, where the frame still open holds whatever came after it."""
    with contextlib.suppress(csp.Unreadable):
        read_blocks('server {\n    add_header X-Frame-Options "SAMEORIGIN" always;')
        raise AssertionError("a block that never closes was read")


def test_a_population_that_matched_no_configuration_refuses(monkeypatch):
    """Exit 2 is "nothing was compared", and a silent 0 there reads as a verdict on the files."""
    monkeypatch.setattr(csp, "CONFIG_GLOB", "*.no-such-suffix")
    monkeypatch.setattr(sys, "argv", ["check_csp_identity.py"])

    assert csp.main() == csp.EXIT_REFUSED


def test_a_declaration_the_reader_cannot_parse_refuses_through_main(tmp_path, monkeypatch):
    """The refusal reaches the exit code, not only `declarations`: a caller reads the number alone."""
    unreadable = tmp_path / "unreadable.conf"
    unreadable.write_text("server {\n    add_header Content-Security-Policy default-src;\n}\n", encoding="utf-8", newline="")
    monkeypatch.setattr(sys, "argv", ["check_csp_identity.py", str(unreadable)])

    assert csp.main() == csp.EXIT_REFUSED


def test_the_module_under_test_is_this_repository_own():
    """Names the import-order hazard the withdrawal above prevents, rather than leaving it silent."""
    assert csp.REPO_ROOT == SCRIPTS.parent


def test_the_repository_own_configurations_each_say_one_thing():
    """The check against the real files, so a plant in either is a failure here too."""
    paths = sorted((csp.REPO_ROOT / csp.CONFIG_DIR).glob(csp.CONFIG_GLOB))

    assert paths != []
    for path in paths:
        found = csp.declarations(path.read_text(encoding="utf-8"), path.name)

        assert found != []
        assert csp.disagreements(path.name, found) == []
