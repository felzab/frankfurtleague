"""SCRIPTS · the route-handler accounting, driven red on each finding it can report.

`check_public_routes.py` is the only thing comparing the App Router tree to the edge's locations, so
a defect in it is silent by construction: the gate stays green and the handler ships unmetered. Every
case below plants the shape it reports rather than reading the repository's own, and the two that do
read the repository are what tie the mechanism to the tree it guards.

The refusals are driven for the same reason: a construct the reader cannot place has to end the run
at `EXIT_REFUSED`, and one it quietly skips reads as coverage.

`scripts/checks/` is put on the path here because the module under test is run as a script
everywhere else, which is what seeds that directory onto the path for it.
"""

from __future__ import annotations

import importlib
import re
import sys
from pathlib import Path

from conftest import new_root, withdraw, write

SCRIPTS = Path(__file__).resolve().parents[1]

# Withdrawn again, kernel dropped from the cache with it: `test_check_docs.py` runs the gate from
# a throwaway copy of scripts/, and a `checker_kernel` cached here would answer its imports and
# root every check at the wrong repository.
sys.path.insert(0, str(SCRIPTS / "checks"))
try:
    routes = importlib.import_module("check_public_routes")
finally:
    sys.path.remove(str(SCRIPTS / "checks"))
    withdraw("check_public_routes", "checker_kernel")

SOURCE = "fixture.conf"
HANDLER = "export const POST = () => new Response();\n"
ZONE = "        limit_req zone=bewerbung burst=2 nodelay;\n"
PASS = "        proxy_pass http://frontend:3000;\n"


def block(header: str, *lines: str) -> str:
    """One location block, written the way `nginx/prod.conf` writes them."""
    return "\n    " + header + " {\n" + "".join(lines) + "    }\n"


def exact(path: str, *, metered: bool = True) -> str:
    """One exact-match location, with or without the zone that meters it."""
    return block("location = " + path, ZONE if metered else "", PASS)


def prefix(path: str, *, metered: bool = False) -> str:
    """One prefix location, which meters nothing unless a case says otherwise."""
    return block("location " + path, ZONE if metered else "", PASS)


METERED = exact("/api/bewerbung") + exact("/api/bewerbung/")
CATCH_ALL = block("location /", "        limit_conn conn 50;\n", PASS)


def served(*blocks: str) -> tuple:
    """The locations of one server block holding the blocks given."""
    text = "server {\n    server_name frankfurtleague.de;\n" + "".join(blocks) + "}\n"
    return routes.locations(routes.parse(text, SOURCE), SOURCE)


def tree(*urls: str, file: str = "route.ts") -> Path:
    """An App Router tree answering exactly the URLs given, and nothing else."""
    app = new_root("check-public-routes-") / "app"
    app.mkdir(parents=True)
    for url in urls:
        write(app, url.strip("/") + "/" + file, HANDLER)
    return app


def judged(app: Path, where: tuple) -> tuple[list, set]:
    """One accounting run over a planted tree and a planted set of locations."""
    return routes.account(routes.handlers(app), where, app.parent, SOURCE)


def details(findings: list) -> str:
    """Every finding's text as one string, for a case asserting on what a run reported."""
    return "\n".join(finding.detail for finding in findings)


def severities(findings: list) -> list:
    """The severities a run reported, so a case pins how many findings it caused as well as which."""
    return [finding.severity for finding in findings]


def test_a_metered_exact_match_covers_its_handler():
    """The resting state every red case below is measured against."""
    findings, used = judged(tree("/api/bewerbung"), served(METERED, CATCH_ALL))

    assert findings == []
    assert used == set()


UNMETERED_TWIN = routes.Reason("/api/bewerbung", "a prefix reason spelled at an exact match's own path")


def test_a_recorded_reason_at_an_exact_match_path_does_not_excuse_its_missing_meter(monkeypatch):
    """Not redundant beside the plain unmetered-exact case: the recorded reason names that same path.

    `REASONS` accounts for what a PREFIX covers, so nothing there may answer for an exact match.
    """
    monkeypatch.setattr(routes, "REASONS", (UNMETERED_TWIN,))
    findings, used = judged(tree("/api/bewerbung"), served(exact("/api/bewerbung", metered=False), CATCH_ALL))

    assert severities(findings) == ["fail"]
    assert "carries no limit_req" in details(findings)
    assert used == set()


def test_a_recorded_reason_at_an_exact_match_path_declares_no_prefix_location(monkeypatch):
    """An exact match is no prefix location, so a reason spelling its path declares nothing."""
    monkeypatch.setattr(routes, "REASONS", (UNMETERED_TWIN,))
    where = served(exact("/api/bewerbung", metered=False), CATCH_ALL)

    assert "no prefix location declares that path" in details(routes.unused(set(), where))


def test_a_handler_filed_as_a_tsx_route_is_walked_too():
    """Next resolves all four extensions, so a walk seeing one of them accounts for part of the tree."""
    findings, _ = judged(tree("/api/mail/zustellung", file="route.tsx"), served(METERED, CATCH_ALL))

    assert severities(findings) == ["fail"]
    assert "/api/mail/zustellung" in details(findings)


def test_a_handler_filed_under_another_spelling_of_route_ts_is_not_accounted_for():
    """Next resolves `route.ts` and no other spelling of it, so a `Route.ts` answers no URL.

    Vacuous on Linux, where the walk cannot see the file at all; on Windows, which resolves a
    name case-blind, it is the whole trap.
    """
    assert routes.handlers(tree("/api/sweep", file="Route.ts")) == ()


def test_an_exact_match_carrying_no_limit_req_is_a_finding():
    """The gap the check exists for: a location naming the handler and metering nothing."""
    findings, _ = judged(tree("/api/bewerbung"), served(exact("/api/bewerbung", metered=False), CATCH_ALL))

    assert severities(findings) == ["fail"]
    assert "carries no limit_req" in details(findings)


def test_a_handler_no_location_names_is_a_finding():
    """A route handler added with no edge change at all, which is how one ships unmetered."""
    findings, _ = judged(tree("/api/mail/zustellung"), served(METERED, CATCH_ALL))

    assert severities(findings) == ["fail"]
    assert "/api/mail/zustellung" in details(findings)


def test_the_catch_all_is_never_coverage():
    """`location /` matches every URI, so counting it would leave this check unable to fail."""
    assert routes.covering_prefix("/api/mail/zustellung", served(CATCH_ALL)) is None


def test_a_prefix_covering_a_handler_needs_a_recorded_reason(monkeypatch):
    """A prefix names where a path goes and meters nothing, so the reason is the whole accounting."""
    monkeypatch.setattr(routes, "REASONS", ())
    findings, _ = judged(tree("/api/admin/teams/undo"), served(prefix("/api/admin/"), CATCH_ALL))

    assert severities(findings) == ["fail"]
    assert "no recorded reason" in details(findings)


def test_a_recorded_reason_covers_the_handlers_that_fall_to_its_prefix(monkeypatch):
    """The other half of the same rule, and what the eight undo handlers are accounted for by."""
    reason = routes.Reason("/api/admin/", "behind the admin guard")
    monkeypatch.setattr(routes, "REASONS", (reason,))
    findings, used = judged(tree("/api/admin/teams/undo", "/api/admin/spiele/undo"), served(prefix("/api/admin/"), CATCH_ALL))

    assert findings == []
    assert used == {reason}


def test_a_dynamic_segment_with_no_prefix_over_it_is_unmeterable():
    """An exact match cannot name a catch-all's URLs, so only a prefix reaches the subtree at all."""
    findings, _ = judged(tree("/api/auth/[...nextauth]"), served(METERED, CATCH_ALL))

    assert severities(findings) == ["fail"]
    assert "unmeterable" in details(findings)


def test_a_prefix_above_a_dynamic_segment_covers_it(monkeypatch):
    """The catch-all's own case: the prefix has to sit above the segment, not inside it."""
    reason = routes.Reason("/api/auth", "Auth.js's catch-all")
    monkeypatch.setattr(routes, "REASONS", (reason,))
    findings, used = judged(tree("/api/auth/[...nextauth]"), served(prefix("/api/auth"), CATCH_ALL))

    assert findings == []
    assert used == {reason}


def test_a_prefix_inside_the_dynamic_segment_does_not_cover_it():
    """`/api/auth/signin` meters one path under the catch-all and leaves the rest of it open."""
    inner = prefix("/api/auth/signin", metered=True)

    assert routes.covering_prefix("/api/auth/", served(inner, CATCH_ALL)) is None


def test_a_recorded_reason_charging_no_handler_is_a_finding(monkeypatch):
    """Accounting rot the other way: the handlers moved and the claim stayed."""
    monkeypatch.setattr(routes, "REASONS", (routes.Reason("/api/admin/", "behind the admin guard"),))

    findings = routes.unused(set(), served(prefix("/api/admin/"), CATCH_ALL))

    assert severities(findings) == ["fail"]
    assert "no handler is charged to that location" in details(findings)


def test_a_recorded_reason_naming_no_prefix_location_says_which_half_went(monkeypatch):
    """The two causes send a reader to different files, so the finding tells them apart."""
    monkeypatch.setattr(routes, "REASONS", (routes.Reason("/api/admin/", "behind the admin guard"),))

    findings = routes.unused(set(), served(CATCH_ALL))

    assert "no prefix location declares that path" in details(findings)


def test_a_metered_exact_match_missing_its_twin_is_a_finding():
    """The slashed form falls to `location /` and reaches Next unmetered, which the pair closes."""
    findings = routes.twins(served(exact("/api/bewerbung"), CATCH_ALL))

    assert severities(findings) == ["fail"]
    assert "/api/bewerbung/" in details(findings)


def test_a_metered_twin_missing_its_canonical_is_a_finding():
    """The same pair broken the other way, which no handler's own accounting would notice."""
    findings = routes.twins(served(exact("/api/bewerbung/"), CATCH_ALL))

    assert severities(findings) == ["fail"]
    assert "canonical" in details(findings)


def test_an_unmetered_exact_match_owes_no_twin():
    """`= /api/v0/system/is_live` carries no zone deliberately, so the pair rule must not reach it."""
    probe = exact("/api/v0/system/is_live", metered=False)

    assert routes.twins(served(probe, CATCH_ALL)) == []


def test_a_route_group_leaves_the_url():
    """A parenthesised folder organises the tree and is not a path segment."""
    assert routes.url_of(("api", "(public)", "bewerbung"), Path("route.ts")) == ("/api/bewerbung", "/api/bewerbung", False)


def test_a_catch_all_segment_stops_the_static_head():
    """What a prefix has to cover is everything above the segment, never the segment itself."""
    assert routes.url_of(("api", "auth", "[...nextauth]"), Path("route.ts")) == ("/api/auth/[...nextauth]", "/api/auth/", True)


def test_a_dynamic_segment_stops_it_too():
    """A single dynamic segment is as unnameable by an exact match as a catch-all is."""
    assert routes.url_of(("api", "teams", "[id]"), Path("route.ts")) == ("/api/teams/[id]", "/api/teams/", True)


def test_a_handler_under_a_top_level_dynamic_segment_heads_at_the_root():
    """Nothing stands above it, and a head of `//` starts under no prefix location this reader reads."""
    assert routes.url_of(("[slug]",), Path("route.ts")) == ("/[slug]", "/", True)


# A `try`, not `pytest.raises`, throughout this file, for `scripts/tests/conftest.py`'s pytest
# invariant. `re.search` because the patterns below are the refusal's own wording, not the whole of it.
def test_a_segment_this_reader_cannot_place_refuses():
    """A private folder serves no URL at all, and guessing which is what a refusal exists to stop."""
    try:
        routes.url_of(("api", "_internal", "sweep"), Path("route.ts"))
    except routes.RouteShape as refusal:
        assert re.search("_internal", str(refusal)), refusal
    else:
        raise AssertionError("a private folder was given a URL")


def test_a_regex_location_refuses_rather_than_answering():
    """It selects by something no directory tree compares against, so no verdict is available."""
    try:
        served(block("location ~* ^/api/.*", PASS))
    except routes.NginxSyntax as refusal:
        assert re.search("modifier", str(refusal)), refusal
    else:
        raise AssertionError("a regex location was read as a prefix")


def test_a_named_location_refuses_rather_than_reading_as_a_prefix():
    """No request URI starts with `@`, so reading `@fallback` as a prefix is coverage of nothing."""
    try:
        served(block("location @fallback", PASS))
    except routes.NginxSyntax as refusal:
        assert re.search("named location", str(refusal)), refusal
    else:
        raise AssertionError("a named location was read as a prefix")


def test_a_location_inside_a_location_refuses():
    """Which of the two answers a request is match order this reader does not resolve."""
    nested = block("location /api/", "        location = /api/x { proxy_pass http://frontend:3000; }\n")

    try:
        served(nested)
    except routes.NginxSyntax as refusal:
        assert re.search("nested inside a location", str(refusal)), refusal
    else:
        raise AssertionError("a nested location was placed")


def test_a_path_two_exact_matches_declare_refuses():
    """nginx refuses the pair outright, and a reader keying on the path alone keeps one of them.

    The unmetered block first, which is the order that reports the handler behind it metered.
    """
    try:
        served(exact("/api/bewerbung", metered=False) + exact("/api/bewerbung"), CATCH_ALL)
    except routes.NginxSyntax as refusal:
        assert re.search(r"fixture\.conf:8: .* is declared again, first at fixture\.conf:4", str(refusal)), refusal
    else:
        raise AssertionError("one path declared by two exact matches was read")


def test_a_prefix_written_with_the_no_regex_modifier_still_matches_a_prefix():
    """`^~` changes which locations nginx goes on to consider, not what this one matches."""
    found = served(block("location ^~ /api/admin/", PASS))

    assert [(one.exact, one.path) for one in found] == [(False, "/api/admin/")]


def test_two_server_blocks_declaring_locations_refuse():
    """A location in the www redirect would read as coverage, and nothing says which serves what."""
    text = "server {\n" + CATCH_ALL + "}\nserver {\n" + prefix("/api/") + "}\n"

    try:
        routes.locations(routes.parse(text, SOURCE), SOURCE)
    except routes.NginxSyntax as refusal:
        assert re.search("server blocks declare a location", str(refusal)), refusal
    else:
        raise AssertionError("two location-declaring server blocks were read")


def test_a_block_that_never_closes_refuses():
    """A truncated file would otherwise read as a configuration declaring fewer locations."""
    truncated = "server {\n    location / { proxy_pass http://frontend:3000;\n"

    try:
        routes.parse(truncated, SOURCE)
    except routes.NginxSyntax as refusal:
        assert re.search("never closes", str(refusal)), refusal
    else:
        raise AssertionError("a truncated file parsed")


def test_a_directive_with_no_semicolon_refuses():
    """The line after it would be swallowed into its arguments, which loses a whole directive."""
    unterminated = "server {\n    location / {\n        proxy_pass http://frontend:3000\n    }\n}\n"

    try:
        routes.parse(unterminated, SOURCE)
    except routes.NginxSyntax as refusal:
        assert re.search("semicolon", str(refusal)), refusal
    else:
        raise AssertionError("an unterminated directive parsed")


def test_a_refusal_below_a_string_spanning_lines_names_the_line_it_stands_on():
    """The counter travels with the scan, or every refusal under a wrapped value reports one too low."""
    text = 'server {\n    add_header X "one\ntwo";\n\n    location ~ ^/api/ {\n' + PASS + "    }\n}\n"

    try:
        routes.locations(routes.parse(text, SOURCE), SOURCE)
    except routes.NginxSyntax as refusal:
        assert re.search(r"fixture\.conf:5:", str(refusal)), refusal
    else:
        raise AssertionError("a regex location under a wrapped value was read as a prefix")


def test_a_quoted_string_spanning_lines_is_one_word():
    """`log_format` writes its line that way, and a lexer breaking it invents directives."""
    tree_of = routes.parse('log_format fl_json escape=json \'{"a":"$b",\'\n    \'"c":$d}\';\n', SOURCE)

    assert [directive.name for directive in tree_of] == ["log_format"]
    assert len(tree_of[0].args) == 4


def test_a_regex_holding_an_escaped_quote_stays_inside_its_string():
    """A map body's regex carries backslashes, and one read as an escape ends the string early."""
    tree_of = routes.parse('map $uri $x {\n    "~^/a\\"b"  1;\n    default    0;\n}\n', SOURCE)

    assert tree_of[0].block is not None
    assert len(tree_of[0].block) == 2


def test_the_module_under_test_is_this_repository_own():
    """Names the import-order hazard the withdrawal above prevents, rather than leaving it silent.

    A `checker_kernel` from `test_check_docs.py`'s throwaway copy would root this module there.
    """
    assert routes.REPO_ROOT == SCRIPTS.parent


def repository_own() -> tuple:
    """The real App Router tree and the real edge configuration, read as the gate reads them."""
    conf = routes.REPO_ROOT / routes.NGINX_CONF
    where = routes.locations(routes.parse(conf.read_bytes().decode("utf-8"), conf.name), conf.name)
    return routes.handlers(routes.REPO_ROOT / routes.APP_ROUTER), where, conf.name


def test_the_repository_own_routes_are_accounted_for():
    """The real pair, so a plant in either fails here and not only at the gate."""
    found, where, name = repository_own()

    findings, used = routes.account(found, where, routes.REPO_ROOT, name)

    assert findings == []
    assert routes.unused(used, where) == []
    assert routes.twins(where) == []


def test_every_recorded_reason_is_charged_by_the_repository_own_tree():
    """A reason nothing uses is the claim outliving its handlers, which only the real tree shows."""
    found, where, name = repository_own()

    _, used = routes.account(found, where, routes.REPO_ROOT, name)

    assert used == set(routes.REASONS)


def run_main(app: Path, text: str, monkeypatch) -> int:
    """One end-to-end run over a planted pair, where the exit contract is decided.

    The real reasons are withdrawn, or a run answers for handlers this tree does not hold rather
    than for the shape its case planted.
    """
    monkeypatch.setattr(routes, "REASONS", ())
    conf = app.parent / SOURCE
    conf.write_bytes(text.encode("utf-8"))
    monkeypatch.setattr(sys, "argv", ["check_public_routes.py", str(app), str(conf)])
    return routes.main()


def test_a_clean_pair_exits_zero(monkeypatch):
    """The contract's passing arm, and what the gate's docs section reads as a green step."""
    app = tree("/api/bewerbung")

    assert run_main(app, "server {\n" + METERED + CATCH_ALL + "}\n", monkeypatch) == 0


def test_a_finding_exits_one(monkeypatch):
    """A finding is a change to make, which the kernel separates from input it could not judge."""
    app = tree("/api/mail/zustellung")

    assert run_main(app, "server {\n" + METERED + CATCH_ALL + "}\n", monkeypatch) == 1


def test_a_construct_it_cannot_parse_exits_two(monkeypatch):
    """A refusal collapsed into a failure sends a reader to repair the routes rather than the reader."""
    app = tree("/api/bewerbung")
    text = "server {\n" + block("location ~ ^/api/", PASS) + "}\n"

    assert run_main(app, text, monkeypatch) == routes.EXIT_REFUSED


def test_a_missing_route_tree_exits_two(monkeypatch):
    """Input the checker cannot read is a refusal, never a tree it may call accounted for."""
    app = tree("/api/bewerbung")
    conf = app.parent / SOURCE
    conf.write_bytes(("server {\n" + METERED + CATCH_ALL + "}\n").encode("utf-8"))
    monkeypatch.setattr(sys, "argv", ["check_public_routes.py", str(app.parent / "gone"), str(conf)])

    assert routes.main() == routes.EXIT_REFUSED


def test_a_configuration_that_is_not_utf_8_exits_two(monkeypatch):
    """A byte no decoder places is input this check cannot judge, and a traceback is not a verdict."""
    app = tree("/api/bewerbung")
    conf = app.parent / SOURCE
    conf.write_bytes(b"server {\n    # \xff\n" + (METERED + CATCH_ALL).encode("utf-8") + b"}\n")
    monkeypatch.setattr(sys, "argv", ["check_public_routes.py", str(app), str(conf)])

    assert routes.main() == routes.EXIT_REFUSED
