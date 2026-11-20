"""The route-handler accounting, driven red on each finding it can report.

`check_public_routes.py` is the only thing comparing the App Router tree to the edge's locations, so
a defect in it is silent by construction: the gate stays green and the handler ships unmetered. Every
case below plants the shape it reports; the gate's own run of the checker is what reads the
repository's tree.

The refusals are driven for the same reason: a construct the reader cannot place has to end the run
at `EXIT_REFUSED`, and one quietly skipped reads as coverage.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest
from conftest import REPO_ROOT, import_scripts, new_root, run_bounded

[routes, nginx] = import_scripts("check_public_routes", "nginx_conf", directories=("checks", "lib"))

SOURCE = "fixture.conf"
HANDLER = "export const POST = () => new Response();\n"
ZONE = "        limit_req zone=bewerbung burst=2 nodelay;\n"
PASS = "        proxy_pass http://frontend:3000;\n"


def write(root: Path, rel: str, text: str) -> None:
    """One corpus file under a fixture repository, its parents made as needed."""
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    # Bytes, so Windows writes no carriage return.
    path.write_bytes(text.encode("utf-8"))


def details(findings: list) -> str:
    """Every finding's text as one string, for a case asserting on what a run reported."""
    return "\n".join(finding.detail for finding in findings)


def block(header: str, *lines: str) -> str:
    """One location block, written the way `nginx/shared/site.conf` writes them."""
    return "\n    " + header + " {\n" + "".join(lines) + "    }\n"


def exact(path: str, *, metered: bool = True) -> str:
    """One exact-match location, with or without the zone that meters it."""
    return block("location = " + path, ZONE if metered else "", PASS)


def prefix(path: str) -> str:
    """One prefix location, which meters nothing."""
    return block("location " + path, PASS)


METERED = exact("/api/bewerbung")
CATCH_ALL = block("location /", "        limit_conn conn 50;\n", PASS)


def served(*blocks: str) -> tuple:
    """The locations of one server block holding the blocks given."""
    text = "server {\n    server_name frankfurtleague.de;\n" + "".join(blocks) + "}\n"
    return routes.locations(nginx.parse(text, SOURCE), SOURCE)


def tree(*urls: str, file: str = "route.ts") -> Path:
    """An App Router tree answering exactly the URLs given, and nothing else."""
    app = new_root("check-public-routes-") / "app"
    app.mkdir(parents=True)
    for url in urls:
        write(app, url.strip("/") + "/" + file, HANDLER)
    return app


def accounting(app: Path, where: tuple):
    """What every rule reads, over a planted tree and a planted set of locations."""
    return routes.Accounting(found=routes.handlers(app), where=where, root=app.parent, conf=SOURCE)


def accounted(app: Path, where: tuple) -> list:
    """What the handler accounting says about a planted tree and a planted set of locations."""
    return routes.account(accounting(app, where))


def test_a_recorded_reason_at_an_exact_match_path_does_not_excuse_its_missing_meter():
    """Not redundant beside the plain unmetered-exact case: the recorded reason names that same path.

    `REASONS` accounts for what a PREFIX covers, so nothing there may answer for an exact match.
    """
    reason = routes.REASONS[0].path
    app = clean_tree()
    write(app, reason.strip("/") + "/route.ts", HANDLER)

    done = run_checker(app, clean(exact(reason, metered=False)))

    assert done.returncode == 1, done.stdout + done.stderr
    assert failures(done) == [f"FAIL    app/{reason.strip('/')}/route.ts answers {reason}, whose exact-match location carries no limit_req"]


def test_a_handler_recorded_unmetered_is_no_finding_and_its_neighbour_still_is():
    """The record names one URL: a handler beside it, unmetered the same way, is reported."""
    recorded = routes.UNMETERED[0].path
    app = clean_tree()
    for url in (recorded, recorded + "2"):
        write(app, url.strip("/") + "/route.ts", HANDLER)

    done = run_checker(app, clean(exact(recorded, metered=False)))

    assert done.returncode == 1, done.stdout + done.stderr
    assert failures(done) == [f"FAIL    app/{recorded.strip('/')}2/route.ts answers {recorded}2, and no location in {SOURCE} names it"]


def test_a_handler_filed_as_a_tsx_route_is_walked_too():
    """Next resolves both configured extensions, so a walk seeing one of them accounts for part of the tree."""
    findings = accounted(tree("/api/example", file="route.tsx"), served(METERED, CATCH_ALL))

    assert len(findings) == 1
    assert "/api/example" in details(findings)


GENERATED = "export default function meta() {\n  return [];\n}\n"


def with_files(*names: str) -> Path:
    """An App Router tree holding exactly the files named, each at its path under the tree's root."""
    app = new_root("check-public-routes-") / "app"
    app.mkdir(parents=True)
    for name in names:
        write(app, name, GENERATED)
    return app


@pytest.mark.parametrize("name", ["opengraph-image.tsx"])
def test_a_reserved_metadata_name_the_map_does_not_carry_refuses(name: str):
    """The gap this population closes is the NEXT metadata file, which silence would let through."""
    with pytest.raises(routes.RouteShape, match=Path(name).stem):
        routes.metadata(with_files(name))


def test_a_metadata_convention_below_the_tree_root_refuses():
    """A nested sitemap's URL is decided by what the file exports, which this reader does not read."""
    with pytest.raises(routes.RouteShape, match="outside the App Router root"):
        routes.metadata(with_files("dashboard/sitemap.ts"))


def test_a_route_a_slot_intercepts_on_its_own_level_answers_the_intercepted_url():
    """A slot is no segment of the URL, and `(.)spiele` names `spiele` on its own level: the route answers the match page's URL."""
    [route] = routes.handlers(tree("/saisons/[saison]/@modal/(.)spiele/[spiel]"))

    assert (route.url, route.head, route.dynamic) == ("/saisons/[saison]/spiele/[spiel]", "/saisons/", True)


@pytest.mark.parametrize("marker", ["(..)", "(...)"])
def test_a_route_intercepting_a_level_up_or_the_root_refuses(marker):
    """Its URL drops segments above it, which this reader does not derive; silence would place it wrongly."""
    with pytest.raises(routes.RouteShape, match="cannot derive"):
        routes.handlers(tree(f"/saisons/[saison]/@modal/{marker}spiele/[spiel]"))


def test_an_exact_match_carrying_no_limit_req_is_a_finding():
    """The gap the check exists for: a location naming the handler and metering nothing."""
    findings = accounted(tree("/api/bewerbung"), served(exact("/api/bewerbung", metered=False), CATCH_ALL))

    assert len(findings) == 1
    assert "carries no limit_req" in details(findings)


def test_a_handler_no_location_names_is_a_finding():
    """A route handler added with no edge change at all, which is how one ships unmetered."""
    findings = accounted(tree("/api/example"), served(METERED, CATCH_ALL))

    assert len(findings) == 1
    assert "/api/example" in details(findings)


def test_the_catch_all_is_never_coverage():
    """`location /` matches every URI, so counting it would leave this check unable to fail."""
    assert routes.covering_prefix("/api/example", served(CATCH_ALL)) is None


def test_a_prefix_covering_a_handler_needs_a_recorded_reason():
    """A prefix names where a path goes and meters nothing, so the reason is the whole accounting."""
    assert routes.declaring("/api/example/") is None, "the prefix this case plants is one REASONS records"
    app = clean_tree()
    write(app, "api/example/one/route.ts", HANDLER)

    done = run_checker(app, clean(prefix("/api/example/")))

    assert done.returncode == 1, done.stdout + done.stderr
    assert failures(done) == [
        "FAIL    app/api/example/one/route.ts answers /api/example/one, covered by the prefix location /api/example/ and by no recorded reason"
    ]


def test_a_dynamic_segment_with_no_prefix_over_it_is_unmeterable():
    """An exact match cannot name a catch-all's URLs, so only a prefix reaches the subtree at all."""
    findings = accounted(tree("/api/auth/[...all]"), served(METERED, CATCH_ALL))

    assert len(findings) == 1
    assert "unmeterable" in details(findings)


def test_a_prefix_inside_the_dynamic_segment_does_not_cover_it():
    """`/api/auth/passkey/verify-authentication` sits under the catch-all and covers no other path of it."""
    inner = prefix("/api/auth/passkey/verify-authentication")

    assert routes.covering_prefix("/api/auth/", served(inner, CATCH_ALL)) is None


def test_a_location_answering_itself_refuses():
    """It forwards no route, so read as an exact match it would stand for a handler the edge never reaches."""
    with pytest.raises(routes.NginxSyntax, match="return"):
        served(block("location = /api/intern", "        return 404;\n"), CATCH_ALL)


def test_a_catch_all_segment_stops_the_static_head():
    """What a prefix has to cover is everything above the segment, never the segment itself."""
    assert routes.url_of(("api", "auth", "[...all]"), Path("route.ts")) == ("/api/auth/[...all]", "/api/auth/", True)


def test_a_handler_under_a_top_level_dynamic_segment_heads_at_the_root():
    """Nothing stands above it, and a head of `//` starts under no prefix location this reader reads."""
    assert routes.url_of(("[slug]",), Path("route.ts")) == ("/[slug]", "/", True)


# `match` because the patterns below are the refusal's own wording, not the whole of it.
def test_a_segment_this_reader_cannot_place_refuses():
    """A private folder serves no URL at all, and guessing which is what a refusal exists to stop."""
    with pytest.raises(routes.RouteShape, match="_internal"):
        routes.url_of(("api", "_internal", "sweep"), Path("route.ts"))


def test_a_regex_location_refuses_rather_than_answering():
    """It selects by something no directory tree compares against, so no verdict is available."""
    with pytest.raises(routes.NginxSyntax, match="modifier"):
        served(block("location ~* ^/api/.*", PASS))


def test_a_named_location_refuses_rather_than_reading_as_a_prefix():
    """No request URI starts with `@`, so reading `@fallback` as a prefix is coverage of nothing."""
    with pytest.raises(routes.NginxSyntax, match="named location"):
        served(block("location @fallback", PASS))


def test_an_error_page_sending_to_no_named_location_refuses():
    """nginx refuses the redirect at its first use, and this reader would otherwise read the file as whole."""
    with pytest.raises(routes.NginxSyntax, match="@refusal"):
        served("    error_page 429 = @refusal;\n", CATCH_ALL)


@pytest.mark.parametrize(
    ("maps", "named"),
    [({}, "\\$target"), ({"$target": frozenset({"@page", "@gone"})}, "@gone")],
    ids=["no-map-defines-it", "its-map-names-no-location"],
)
def test_a_variable_error_page_this_reader_cannot_resolve_refuses(maps, named):
    """Unresolved, every named location it reaches would read as dead; resolved to nothing, as reached."""
    text = "server {\n    error_page 429 = $target;\n" + block("location @page", PASS) + CATCH_ALL + "}\n"
    with pytest.raises(routes.NginxSyntax, match=named):
        routes.locations(nginx.parse(text, SOURCE), SOURCE, maps)


def test_a_location_inside_a_location_refuses():
    """Which of the two answers a request is match order this reader does not resolve."""
    nested = block("location /api/", "        location = /api/x { proxy_pass http://frontend:3000; }\n")

    with pytest.raises(routes.NginxSyntax, match="nested inside a location"):
        served(nested)


def test_a_path_two_exact_matches_declare_refuses():
    """nginx refuses the pair outright, and a reader keying on the path alone keeps one of them.

    The unmetered block first, which is the order that reports the handler behind it metered.
    """
    with pytest.raises(routes.NginxSyntax, match=r"fixture\.conf:8: .* is declared again, first at fixture\.conf:4"):
        served(exact("/api/bewerbung", metered=False) + exact("/api/bewerbung"), CATCH_ALL)


def test_locations_at_the_top_and_inside_a_server_refuse():
    text = prefix("/api/") + "server {\n" + CATCH_ALL + "}\n"
    with pytest.raises(routes.NginxSyntax, match="both at the top and inside a server block"):
        routes.locations(nginx.parse(text, SOURCE), SOURCE)


def test_two_server_blocks_declaring_locations_refuse():
    """A location in the www redirect would read as coverage, and nothing says which serves what."""
    text = "server {\n" + CATCH_ALL + "}\nserver {\n" + prefix("/api/") + "}\n"

    with pytest.raises(routes.NginxSyntax, match="server blocks declare a location"):
        routes.locations(nginx.parse(text, SOURCE), SOURCE)


def test_a_block_that_never_closes_refuses():
    """A truncated file would otherwise read as a configuration declaring fewer locations."""
    with pytest.raises(routes.NginxSyntax, match="never closes"):
        nginx.parse("server {\n    location / { proxy_pass http://frontend:3000;\n", SOURCE)


def test_a_directive_with_no_semicolon_refuses():
    """The line after it would be swallowed into its arguments, which loses a whole directive."""
    with pytest.raises(routes.NginxSyntax, match="semicolon"):
        nginx.parse("server {\n    location / {\n        proxy_pass http://frontend:3000\n    }\n}\n", SOURCE)


def test_a_quoted_string_spanning_lines_is_one_word():
    """`log_format` writes its line that way, and a lexer breaking it invents directives."""
    tree_of = nginx.parse('log_format fl_json escape=json \'{"a":"$b",\'\n    \'"c":$d}\';\n', SOURCE)

    assert [directive.name for directive in tree_of] == ["log_format"]
    assert len(tree_of[0].args) == 4


def test_a_regex_holding_an_escaped_quote_stays_inside_its_string():
    """A map body's regex carries backslashes, and one read as an escape ends the string early."""
    tree_of = nginx.parse('map $uri $x {\n    "~^/a\\"b"  1;\n    default    0;\n}\n', SOURCE)

    assert tree_of[0].block is not None
    assert len(tree_of[0].block) == 2


# The http level beside the server body, which the reader opens for the maps an `error_page` sends through.
HTTP_CONF = "limit_req_zone $client_net zone=bewerbung:10m rate=6r/m;\n"
CHECKER = REPO_ROOT / "scripts" / "checks" / "check_public_routes.py"


def clean(*blocks: str) -> str:
    """The server body every rule passes over `clean_tree`, the blocks given beside its own."""
    return "server {\n" + METERED + "".join(blocks) + CATCH_ALL + "}\n"


def clean_tree() -> Path:
    """A route handler with the location `clean` gives it."""
    return tree("/api/bewerbung")


def run_checker(app: Path, text: str | bytes, *, tree: Path | None = None) -> subprocess.CompletedProcess[str]:
    """The checker run as the gate runs it, over `app` and a configuration of `text` beside it.

    The real tables stand: what they record names no URL a fixture tree holds unless its case plants it.
    `tree` hands it another route tree than `app`, the configuration still beside `app`.
    """
    conf = app.parent / SOURCE
    conf.write_bytes(text if isinstance(text, bytes) else text.encode("utf-8"))
    (app.parent / routes.NGINX_HTTP_CONF).write_bytes(HTTP_CONF.encode("utf-8"))
    return run_bounded((sys.executable, str(CHECKER), str(tree or app), str(conf)))


def failures(done: subprocess.CompletedProcess[str]) -> list[str]:
    """The first line of each finding the run printed, as a reader of the gate's output meets it."""
    return [line.strip() for line in done.stdout.splitlines() if line.strip().startswith("FAIL")]


REFUSED = "Nothing was accounted for, so this is a refusal rather than a verdict on the routes."


def test_a_clean_pair_exits_zero():
    """The contract's passing arm, and what the gate's ops section reads as a green step."""
    done = run_checker(clean_tree(), clean())

    assert done.returncode == 0, done.stdout + done.stderr
    assert "1 route handler(s) accounted for" in done.stdout, done.stdout


def test_a_finding_fails_the_run():
    """`main` runs every rule of `RULES` and answers 1 for what one finds, the finding printed for the reader."""
    app = clean_tree()
    write(app, "api/example/route.ts", HANDLER)

    done = run_checker(app, clean())

    assert done.returncode == 1, done.stdout + done.stderr
    assert failures(done) == [f"FAIL    app/api/example/route.ts answers /api/example, and no location in {SOURCE} names it"]


def test_a_construct_it_cannot_parse_exits_two():
    """A refusal collapsed into a failure sends a reader to repair the routes rather than the reader."""
    done = run_checker(clean_tree(), "server {\n" + block("location ~ ^/api/", PASS) + "}\n")

    assert done.returncode == routes.EXIT_REFUSED, done.stdout + done.stderr
    assert "the location modifier '~'" in done.stderr and REFUSED in done.stderr, done.stderr


def test_a_metadata_file_this_reader_cannot_place_exits_two():
    """The gap the population closes, at the exit contract: the next metadata route ends the run."""
    app = clean_tree()
    write(app, "twitter-image.tsx", GENERATED)

    done = run_checker(app, clean())

    assert done.returncode == routes.EXIT_REFUSED, done.stdout + done.stderr
    assert "the metadata image 'twitter-image.tsx'" in done.stderr and REFUSED in done.stderr, done.stderr


def test_a_missing_route_tree_exits_two():
    """Input the checker cannot read is a refusal, never a tree it may call accounted for."""
    app = clean_tree()

    done = run_checker(app, clean(), tree=app.parent / "gone")

    assert done.returncode == routes.EXIT_REFUSED, done.stdout + done.stderr
    assert "no App Router tree here" in done.stderr and REFUSED in done.stderr, done.stderr


def test_a_configuration_that_is_not_utf_8_exits_two():
    """A byte no decoder places is input this check cannot judge, and a traceback is not a verdict."""
    done = run_checker(clean_tree(), b"# \xff\n" + clean().encode("utf-8"))

    assert done.returncode == routes.EXIT_REFUSED, done.stdout + done.stderr
    assert "the route tree and the edge configuration both have to be readable" in done.stderr and "Traceback" not in done.stderr, done.stderr
