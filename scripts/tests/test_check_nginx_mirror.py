"""SCRIPTS · the nginx mirror: the reader, the roles and the declared list

The comparison rests on a reader nothing else in this repository has, so the refusals are driven
here one construct at a time: each is a shape that would otherwise be walked past, leaving the two
files called equal about a directive nobody read.

The real pair is loaded at the end, both directions, so a difference the list misses and a row the
files do not justify each fail here rather than only at the gate.

`scripts/checks/` is put on the path here because the module under test is run as a script
everywhere else, which is what seeds that directory onto the path for it.
"""

from __future__ import annotations

import importlib
import re
import sys
from pathlib import Path
from typing import Any

from conftest import withdraw, write

SCRIPTS = Path(__file__).resolve().parents[1]

# Withdrawn at module import, kernel dropped from the cache with it: `test_check_docs.py` runs the
# gate from a throwaway copy of scripts/, and a `checker_kernel` cached here would answer its
# imports and root every check at the wrong repository.
sys.path.insert(0, str(SCRIPTS / "checks"))
try:
    mirror = importlib.import_module("check_nginx_mirror")
finally:
    sys.path.remove(str(SCRIPTS / "checks"))
    withdraw("check_nginx_mirror", "checker_kernel")


PROD_FIXTURE = r"""
# The production half of a pair small enough to read.
set_real_ip_from 10.0.0.1;
limit_req_zone $signin_limit_key zone=bewerbung:10m rate=2r/m;

map $remote_addr $client_net {
    "~^(\d+)$"  $1;
    default     $remote_addr;
}

server {
    listen 443 ssl;
    server_name example.test;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Content-Security-Policy "default-src 'self'; object-src 'none';" always;
    proxy_set_header X-FL-Actor "";

    location = /signin {
        limit_req zone=bewerbung burst=3 nodelay;
        proxy_pass http://frontend:3000;
    }
}
"""


def pair(root: Path, prod: str, local: str) -> tuple[Path, Path]:
    """Both halves on disk, under the names a reader of a finding sees."""
    write(root, "prod.conf", prod)
    write(root, "local.conf", local)
    return root / "prod.conf", root / "local.conf"


def read(root: Path, text: str, name: str = "one.conf") -> dict[str, Any]:
    """One configuration through the whole reader, which is the only way in that callers have."""
    write(root, name, text)
    return mirror.load(root / name)


def judged(prod: dict[str, Any], local: dict[str, Any]) -> list[tuple[Any, Any]]:
    """Every difference against the delta declaring it, the pairing `uncovered` reads."""
    return [(difference, mirror.declaring(difference)) for difference in mirror.diff(prod, local)]


def run_main(monkeypatch, prod: Path, local: Path) -> int:
    """The entry point over a named pair, which is where the exit contract is observable."""
    monkeypatch.setattr(sys, "argv", ["check_nginx_mirror.py", str(prod), str(local)])
    return mirror.main()


def test_a_comment_is_not_a_directive(tmp_path):
    """A `#` outside quotes ends the line, so a commented-out directive is not one file's setting."""
    node = read(tmp_path, "server_tokens off;\n# server_tokens on;\n")

    assert node == {"server_tokens": (("off",),)}


def test_a_quoted_argument_keeps_the_semicolon_inside_it(tmp_path):
    """The CSP's own separator, which an unquoted read would break the directive on."""
    node = read(tmp_path, "add_header Content-Security-Policy \"default-src 'self'; object-src 'none';\" always;\n")

    assert node["add_header"] == (("Content-Security-Policy", "default-src 'self'; object-src 'none';", "always"),)


def test_a_backslash_before_a_regex_class_survives_the_quotes(tmp_path):
    """nginx drops the backslash before a quote alone, so a map arm's `\\d` still means a digit."""
    node = read(tmp_path, 'map $remote_addr $client_net {\n    "~^(\\d+)\\"$"  $1;\n}\n')

    assert node["map[$client_net]"]["arms"] == (('~^(\\d+)"$', "$1"),)


def test_an_empty_quoted_argument_is_still_an_argument(tmp_path):
    """The blanked `X-FL-Actor`: dropped, the directive compares as one argument shorter and agrees."""
    node = read(tmp_path, 'proxy_set_header X-FL-Actor "";\n')

    assert node["proxy_set_header"] == (("X-FL-Actor", ""),)


def test_a_directive_written_twice_compares_as_its_arguments_sorted(tmp_path):
    """Two files listing one header set in different orders configure the same edge."""
    first = read(tmp_path, "add_header A 1;\nadd_header B 2;\n", "first.conf")
    second = read(tmp_path, "add_header B 2;\nadd_header A 1;\n", "second.conf")

    assert mirror.diff(first, second) == []


def test_a_map_body_keeps_the_order_its_arms_are_written_in(tmp_path):
    """nginx tests a regex arm in source order, so a reordered body is a different map."""
    first = read(tmp_path, "map $a $b {\n    ~x  1;\n    ~y  2;\n}\n", "first.conf")
    second = read(tmp_path, "map $a $b {\n    ~y  2;\n    ~x  1;\n}\n", "second.conf")

    assert [one.path for one in mirror.diff(first, second)] == ["map[$b].arms"]


# A `try`, not `pytest.raises`, throughout this file, for `scripts/tests/conftest.py`'s pytest
# invariant. `re.search` because the patterns below are the refusal's own wording, not the whole of it.
def test_an_include_is_refused(tmp_path):
    """It names a file this reader does not open, so the pair it compared was not the whole pair."""
    try:
        read(tmp_path, "include /etc/nginx/extra.conf;\n")
    except mirror.NginxSyntax as refusal:
        assert re.search("names a file this reader does not open", str(refusal)), refusal
    else:
        raise AssertionError("an include parsed")


def test_an_include_inside_a_map_body_is_refused(tmp_path):
    """It has an arm's shape -- a name and one argument -- and names arms that were never compared."""
    text = "map $a $b {\n    include /etc/nginx/arms.conf;\n    default 1;\n}\n"

    try:
        read(tmp_path, text)
    except mirror.NginxSyntax as refusal:
        assert re.search("reads as a directive rather than an arm", str(refusal)), refusal
    else:
        raise AssertionError("an include inside a map body parsed as an arm")


def test_a_block_this_reader_does_not_parse_is_refused(tmp_path):
    """An `if` decides routing, and a reader that walks past one may not call the files equal."""
    text = "server {\n    server_name x;\n    if ($host = y) {\n        return 404;\n    }\n}\n"

    try:
        read(tmp_path, text)
    except mirror.NginxSyntax as refusal:
        assert re.search("opens a block this reader does not parse", str(refusal)), refusal
    else:
        raise AssertionError("an `if` block parsed")


def test_a_location_nested_inside_a_location_is_refused(tmp_path):
    """This model keys a location under its server, and has nowhere to put a second level."""
    text = "server {\n    location / {\n        location /x {\n            proxy_pass http://a;\n        }\n    }\n}\n"

    try:
        read(tmp_path, text)
    except mirror.NginxSyntax as refusal:
        assert re.search("a block inside a `location`", str(refusal)), refusal
    else:
        raise AssertionError("a nested location parsed")


def test_a_location_outside_any_server_is_refused(tmp_path):
    """nginx refuses it too, and a reader that placed one would invent a server block for it."""
    try:
        read(tmp_path, "location / {\n    proxy_pass http://a;\n}\n")
    except mirror.NginxSyntax as refusal:
        assert re.search("outside any server block", str(refusal)), refusal
    else:
        raise AssertionError("a location outside any server parsed")


def test_a_block_that_never_closes_is_refused(tmp_path):
    """Everything after the missing brace would otherwise read as content of the block above it."""
    try:
        read(tmp_path, "server {\n    server_name x;\n")
    except mirror.NginxSyntax as refusal:
        assert re.search("a block that never closes", str(refusal)), refusal
    else:
        raise AssertionError("an unclosed block parsed")


def test_a_quoted_string_that_never_closes_is_refused(tmp_path):
    """The rest of the file is swallowed into one argument, and the comparison would still answer."""
    text = 'add_header X "unterminated;\nserver_tokens off;\n'

    try:
        read(tmp_path, text)
    except mirror.NginxSyntax as refusal:
        assert re.search("a quoted string that never closes", str(refusal)), refusal
    else:
        raise AssertionError("an unclosed quoted string parsed")


def test_a_directive_running_to_the_end_of_the_file_is_refused(tmp_path):
    """A `;` dropped at the end of a file, the only place this reader can see one dropped.

    Dropped elsewhere it merges two directives and the merge compares clean; `nginx -t` refuses it
    in the same ops scope.
    """
    try:
        read(tmp_path, "server_tokens off")
    except mirror.NginxSyntax as refusal:
        assert re.search("is not terminated by", str(refusal)), refusal
    else:
        raise AssertionError("a directive running to the end of the file parsed")


def test_a_map_arm_that_is_not_a_pattern_and_a_value_is_refused(tmp_path):
    """`hostnames;` and `volatile;` change what the block means and carry no value to compare."""
    text = "map $a $b {\n    hostnames;\n    default 1;\n}\n"

    try:
        read(tmp_path, text)
    except mirror.NginxSyntax as refusal:
        assert re.search("is not a pattern and a value", str(refusal)), refusal
    else:
        raise AssertionError("a valueless map arm parsed")


def test_two_server_blocks_taking_one_role_are_refused(tmp_path):
    """Matching is by role, so a duplicate leaves the comparison choosing which one it read."""
    text = "server {\n    server_name _;\n}\nserver {\n    server_name _;\n}\n"

    try:
        read(tmp_path, text)
    except mirror.NginxSyntax as refusal:
        assert re.search("cannot tell them apart", str(refusal)), refusal
    else:
        raise AssertionError("two server blocks in one role parsed")


def test_a_server_block_naming_neither_a_location_nor_a_name_is_refused(tmp_path):
    """Nothing identifies it across the files, and guessing would pair it with the wrong block."""
    text = "server {\n    listen 80;\n}\n"

    try:
        read(tmp_path, text)
    except mirror.NginxSyntax as refusal:
        assert re.search("declaring neither a location nor a server_name", str(refusal)), refusal
    else:
        raise AssertionError("an unidentifiable server block parsed")


def test_the_block_carrying_locations_is_the_main_listener(tmp_path):
    """The two files agree on no `listen` and no `server_name`, so neither can key this block."""
    node = read(tmp_path, "server {\n    server_name whatever.test;\n    location / {\n        proxy_pass http://a;\n    }\n}\n")

    assert list(node) == ["server[main]"]


def test_the_block_naming_itself_underscore_is_the_catch_all(tmp_path):
    """Production rejects the handshake and local returns 421, and the role is what pairs them."""
    node = read(tmp_path, "server {\n    server_name _;\n    ssl_reject_handshake on;\n}\n")

    assert list(node) == ["server[catch-all]"]


def test_any_other_server_block_is_keyed_on_the_names_it_answers_for(tmp_path):
    """A redirect block has nothing else to be identified by, and both of them are production's."""
    node = read(tmp_path, "server {\n    server_name www.example.test example.test;\n    return 301 https://example.test;\n}\n")

    assert list(node) == ["server[redirect:example.test www.example.test]"]


def test_a_redirect_block_keys_the_same_whichever_order_its_names_are_written_in(tmp_path):
    """nginx answers for both either way, so an unsorted key renames the block and pairs it with nothing."""
    written = "server {\n    server_name a.test b.test;\n    return 301 https://a.test;\n}\n"
    swapped = "server {\n    server_name b.test a.test;\n    return 301 https://a.test;\n}\n"

    assert list(read(tmp_path, written, "first.conf")) == list(read(tmp_path, swapped, "second.conf"))


def test_a_location_is_keyed_on_its_modifier_and_its_path(tmp_path):
    """`= /signin` and `/signin` route differently, so the key carries the modifier with the path."""
    node = read(tmp_path, "server {\n    location = /signin {\n        proxy_pass http://a;\n    }\n}\n")

    assert list(node["server[main]"]) == ["location[= /signin]"]


def test_documents_that_agree_produce_no_difference():
    """The mirror's resting state: nothing to judge means nothing to declare."""
    document = {"server[main]": {"listen": (("80",),)}}

    assert mirror.diff(document, document) == []


def test_a_directive_only_the_production_file_writes_reads_as_absent_locally():
    """`ABSENT` is a value rather than a gap, which is what lets a delta pin one side of it."""
    found = mirror.diff({"server[main]": {"http2": (("on",),)}}, {"server[main]": {}})

    assert [(one.path, one.local) for one in found] == [("server[main].http2", mirror.ABSENT)]


def test_a_whole_block_only_one_file_has_is_one_difference():
    """Production's two redirect blocks are one row each; per-directive rows would need a dozen."""
    found = mirror.diff({"server[redirect:x]": {"listen": (("80",),)}}, {})

    assert [one.path for one in found] == ["server[redirect:x]"]


def test_a_difference_is_reported_at_the_deepest_key_the_two_share():
    """Reporting a whole server for one changed ceiling would need a delta far wider than the change."""
    found = mirror.diff(
        {"server[main]": {"location[/]": {"limit_conn": (("conn", "50"),)}}},
        {"server[main]": {"location[/]": {"limit_conn": (("conn", "10"),)}}},
    )

    assert [one.path for one in found] == ["server[main].location[/].limit_conn"]


def test_any_accepts_whatever_that_file_writes():
    """Every TLS row pins one side and leaves production's own value free, being production's."""
    assert mirror.side_matches(mirror.ANY, (("on",),)) is True


def test_any_does_not_accept_a_missing_key():
    """`ANY` says "whatever that file writes there", and a file that writes nothing wrote nothing."""
    assert mirror.side_matches(mirror.ANY, mirror.ABSENT) is False


def test_a_pinned_side_is_matched_by_equality_alone():
    """A pinned row is the one that fails when production's listen port moves off 443."""
    assert mirror.side_matches((("443", "ssl"),), (("443", "ssl"),)) is True
    assert mirror.side_matches((("443", "ssl"),), (("8443", "ssl"),)) is False


PINNED = mirror.Delta("server[main].listen", (("443", "ssl"),), (("80",),), "the local stack terminates no TLS")
FREE = mirror.Delta("server[main].ssl_stapling", mirror.ANY, mirror.ABSENT, "no stapling without TLS")


def test_a_difference_both_sides_of_a_row_describe_is_declared(monkeypatch):
    """The ordinary case, and the one every row on the real list is meant to be in."""
    monkeypatch.setattr(mirror, "DECLARED_DELTAS", (PINNED, FREE))

    assert mirror.declaring(mirror.Difference("server[main].listen", (("443", "ssl"),), (("80",),))) is PINNED


def test_a_row_whose_path_matches_but_whose_pinned_value_no_longer_does_declares_nothing(monkeypatch):
    """A second listen added beside the declared one has to fail, or the pin buys nothing over ANY."""
    monkeypatch.setattr(mirror, "DECLARED_DELTAS", (PINNED,))
    difference = mirror.Difference("server[main].listen", (("443", "ssl"), ("8443", "ssl")), (("80",),))

    assert mirror.declaring(difference) is None


def test_a_difference_at_a_path_no_row_names_declares_nothing(monkeypatch):
    """The undeclared-difference finding, which is the checker's primary claim."""
    monkeypatch.setattr(mirror, "DECLARED_DELTAS", (PINNED, FREE))

    assert mirror.declaring(mirror.Difference("limit_req_zone", (("a",),), (("b",),))) is None


def test_a_row_covering_nothing_is_a_finding(monkeypatch):
    """Allowlist rot pointed the way nothing usually catches: the files agreed and the claim stayed."""
    monkeypatch.setattr(mirror, "DECLARED_DELTAS", (PINNED, FREE))
    covered = [(mirror.Difference(FREE.path, (("on",),), mirror.ABSENT), FREE)]

    findings = mirror.uncovered(covered)

    assert [finding.severity for finding in findings] == ["fail"]
    assert PINNED.path in findings[0].detail


def test_two_rows_sharing_a_path_do_not_mark_each_other_covered(monkeypatch):
    """Why `uncovered` compares identity: the two resolver rows carry one reason word for word."""
    twin = mirror.Delta(PINNED.path, PINNED.prod, PINNED.local, PINNED.why)
    monkeypatch.setattr(mirror, "DECLARED_DELTAS", (PINNED, twin))
    covered = [(mirror.Difference(PINNED.path, PINNED.prod, PINNED.local), PINNED)]

    assert len(mirror.uncovered(covered)) == 1


def test_a_repeated_directive_is_reported_as_what_parts_the_two_files():
    """Ten zones printed whole leave the reader diffing them by eye for the one rate that moved."""
    difference = mirror.Difference("limit_req_zone", (("$k", "zone=a", "rate=2r/m"),), (("$k", "zone=a", "rate=9r/m"),))

    described = mirror.described(difference, "prod.conf", "local.conf")

    assert "prod.conf alone: $k zone=a rate=2r/m" in described
    assert "local.conf alone: $k zone=a rate=9r/m" in described


def test_a_difference_neither_side_is_alone_in_is_shown_whole():
    """A reordered `map` body: the arms match as sets, so a narrowed report would print nothing."""
    arms = (("~x", "1"), ("~y", "2"))

    described = mirror.described(mirror.Difference("map[$b].arms", arms, arms[::-1]), "prod.conf", "local.conf")

    assert "prod.conf: ~x 1 ; ~y 2" in described


def test_a_rate_planted_in_one_fixture_file_alone_is_a_finding(tmp_path, monkeypatch):
    """The failure the checker exists to report, over a pair that differs exactly once.

    Asserted on the exit code, not the text: `checker_kernel.py :: report_findings` binds its
    stream as a default argument, so no capture fixture sees it.
    """
    monkeypatch.setattr(mirror, "DECLARED_DELTAS", ())
    prod, local = pair(tmp_path, PROD_FIXTURE, PROD_FIXTURE.replace("rate=2r/m", "rate=9r/m"))

    assert run_main(monkeypatch, prod, local) == 1
    assert [one.path for one in mirror.diff(mirror.load(prod), mirror.load(local))] == ["limit_req_zone"]


def test_the_same_pair_untouched_is_green(tmp_path, monkeypatch):
    """The other half of the case above: without the plant the fixture pair has nothing to report."""
    monkeypatch.setattr(mirror, "DECLARED_DELTAS", ())
    prod, local = pair(tmp_path, PROD_FIXTURE, PROD_FIXTURE)

    assert run_main(monkeypatch, prod, local) == 0


REDIRECT_BLOCK = """
server {
    server_name redirect.test;
    return 301 https://example.test;
}
"""


def test_the_green_line_counts_the_blocks_that_were_compared(tmp_path, monkeypatch, capsys):
    """A block one file alone holds is a declared difference, and counting it overstates the run."""
    only_prod = mirror.Delta("server[redirect:redirect.test]", mirror.ANY, mirror.ABSENT, "production's redirect")
    monkeypatch.setattr(mirror, "DECLARED_DELTAS", (only_prod,))
    prod, local = pair(tmp_path, PROD_FIXTURE + REDIRECT_BLOCK, PROD_FIXTURE)

    assert run_main(monkeypatch, prod, local) == 0
    assert "1 server block(s) compared" in capsys.readouterr().out


def test_a_construct_outside_the_subset_exits_refused_rather_than_answering(tmp_path, monkeypatch):
    """`checker_kernel.py :: EXIT_REFUSED`: nothing was compared, so no verdict on the pair is owed."""
    prod, local = pair(tmp_path, PROD_FIXTURE, PROD_FIXTURE + "include /etc/nginx/extra.conf;\n")

    assert run_main(monkeypatch, prod, local) == mirror.EXIT_REFUSED


def test_a_file_that_cannot_be_opened_is_refused_rather_than_crashing(tmp_path, monkeypatch):
    """A missing half is input the check cannot judge, which is not a broken environment."""
    prod, _ = pair(tmp_path, PROD_FIXTURE, PROD_FIXTURE)

    assert run_main(monkeypatch, prod, tmp_path / "absent.conf") == mirror.EXIT_REFUSED


def test_the_module_under_test_is_this_repository_own():
    """Names the import-order hazard the withdrawal above prevents, rather than leaving it silent."""
    assert mirror.REPO_ROOT == SCRIPTS.parent


def test_the_repository_own_edge_files_are_clean():
    """The reader against the real pair, so a construct either file gains refuses here too."""
    assert mirror.load(mirror.REPO_ROOT / mirror.PROD)
    assert mirror.load(mirror.REPO_ROOT / mirror.LOCAL)


def test_the_repository_own_edge_pair_is_fully_declared():
    """The real list against the real files, so a mis-expressed row fails here and not only at the gate.

    Both directions at once: no difference the list misses, and no row the files do not justify.
    """
    prod = mirror.load(mirror.REPO_ROOT / mirror.PROD)
    local = mirror.load(mirror.REPO_ROOT / mirror.LOCAL)
    covered = judged(prod, local)

    assert [difference.path for difference, delta in covered if delta is None] == []
    assert mirror.uncovered(covered) == []
    assert len(covered) == len(mirror.DECLARED_DELTAS)


def edge_files() -> tuple[str, str]:
    """Both real edge configurations as text, for a case that plants in a copy of them."""
    return (
        (mirror.REPO_ROOT / mirror.PROD).read_bytes().decode("utf-8"),
        (mirror.REPO_ROOT / mirror.LOCAL).read_bytes().decode("utf-8"),
    )


def test_a_range_dropped_from_the_local_trusted_list_is_a_finding(tmp_path, monkeypatch):
    """The trust boundary narrowing on the side no tunnel stands in front of, which ANY accepted."""
    prod_text, local_text = edge_files()
    dropped = local_text.replace(f"set_real_ip_from {mirror.CLOUDFLARE_RANGES[0]};\n", "")

    assert run_main(monkeypatch, *pair(tmp_path, prod_text, dropped)) == 1


def test_an_arm_dropped_from_the_local_fallback_block_is_a_finding(tmp_path, monkeypatch):
    """The second copy of the same set, which realip reads and the access line reports."""
    prod_text, local_text = edge_files()
    dropped = local_text.replace(f"    {mirror.CLOUDFLARE_RANGES[0]}  1;\n", "")

    assert run_main(monkeypatch, *pair(tmp_path, prod_text, dropped)) == 1


def test_production_widened_back_to_the_published_ranges_is_a_finding(tmp_path, monkeypatch):
    """The boundary moving the other way: the two files still differ, so only the pin reports it."""
    prod_text, local_text = edge_files()
    connector = f"set_real_ip_from {mirror.TUNNEL};\n"
    widened = prod_text.replace(connector, connector + "".join(f"set_real_ip_from {one};\n" for one in mirror.CLOUDFLARE_RANGES))

    assert run_main(monkeypatch, *pair(tmp_path, widened, local_text)) == 1
