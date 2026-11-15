"""The route-handler accounting, driven red on each finding it can report.

`check_public_routes.py` is the only thing comparing the App Router tree to the edge's locations, so
a defect in it is silent by construction: the gate stays green and the handler ships unmetered. Every
case below plants the shape it reports; the gate's own run of the checker is what reads the
repository's tree.

The refusals are driven for the same reason: a construct the reader cannot place, or a rule that
finds nothing to judge, has to end the run at `EXIT_REFUSED`, and one quietly skipped reads as
coverage.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest
from conftest import REPO_ROOT, import_scripts, new_root

[routes] = import_scripts("check_public_routes")

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


def severities(findings: list) -> list:
    """The severities a run reported, so a case pins how many findings it caused as well as which."""
    return [finding.severity for finding in findings]


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
    return routes.locations(routes.parse(text, SOURCE), SOURCE)


def tree(*urls: str, file: str = "route.ts") -> Path:
    """An App Router tree answering exactly the URLs given, and nothing else."""
    app = new_root("check-public-routes-") / "app"
    app.mkdir(parents=True)
    for url in urls:
        write(app, url.strip("/") + "/" + file, HANDLER)
    return app


def accounting(app: Path | None = None, where: tuple = (), *, rates: dict | None = None, squad: int = 10, referrer: tuple = ()):
    """What every rule reads, over a planted tree, a planted set of locations and a planted referrer map's entries."""
    app = tree() if app is None else app
    paged = routes.pages(app)
    return routes.Accounting(
        found=routes.handlers(app),
        paged=paged,
        linked=routes.link_pages(paged),
        where=where,
        rates={"linkpage": 30} if rates is None else rates,
        squad=squad,
        referrer=referrer,
        app_dir=app,
        root=app.parent,
        conf=SOURCE,
    )


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

    assert severities(findings) == ["fail"]
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


def test_a_page_a_slot_intercepts_on_its_own_level_answers_the_intercepted_url():
    """A slot is no segment of the URL, and `(.)spiele` names `spiele` on its own level: the pop-up answers the match page's URL."""
    [page] = routes.pages(tree("/saisons/[saison]/@modal/(.)spiele/[spiel]", file="page.tsx"))

    assert (page.url, page.head, page.dynamic) == ("/saisons/[saison]/spiele/[spiel]", "/saisons/", True)


@pytest.mark.parametrize("marker", ["(..)", "(...)"])
def test_a_page_intercepting_a_level_up_or_the_root_refuses(marker):
    """Its URL drops segments above it, which this reader does not derive; silence would place it wrongly."""
    with pytest.raises(routes.RouteShape, match="cannot derive"):
        routes.pages(tree(f"/saisons/[saison]/@modal/{marker}spiele/[spiel]", file="page.tsx"))


ROOT_INTERCEPTOR = "/@modal/(.)saisons/[saison]/spiele/[spiel]"


def intercepting(*urls: str) -> list:
    """What the interception rule says about a tree holding a page at each of `urls`."""
    return routes.interceptions(accounting(tree(*urls, file="page.tsx")))


def test_an_interceptor_under_a_route_group_is_a_finding():
    """A group is no level, so `(classic)`'s slot intercepts from every page while its layout draws it on its own alone."""
    findings = intercepting("/(classic)" + ROOT_INTERCEPTOR)

    assert severities(findings) == ["fail"]
    assert "under the route group (classic)" in details(findings)


def test_two_interceptors_for_one_address_are_a_finding():
    """Each level's rewrite matches from a season page, whatever each names its dynamic segment."""
    findings = intercepting(ROOT_INTERCEPTOR, "/saisons/[id]/@modal/(.)spiele/[spiel]")

    assert severities(findings) == ["fail"]
    assert "all intercept /saisons/[]/spiele/[]" in details(findings)


def test_an_exact_match_carrying_no_limit_req_is_a_finding():
    """The gap the check exists for: a location naming the handler and metering nothing."""
    findings = accounted(tree("/api/bewerbung"), served(exact("/api/bewerbung", metered=False), CATCH_ALL))

    assert severities(findings) == ["fail"]
    assert "carries no limit_req" in details(findings)


def test_a_handler_no_location_names_is_a_finding():
    """A route handler added with no edge change at all, which is how one ships unmetered."""
    findings = accounted(tree("/api/example"), served(METERED, CATCH_ALL))

    assert severities(findings) == ["fail"]
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

    assert severities(findings) == ["fail"]
    assert "unmeterable" in details(findings)


def test_a_prefix_inside_the_dynamic_segment_does_not_cover_it():
    """`/api/auth/passkey/verify-authentication` sits under the catch-all and covers no other path of it."""
    inner = prefix("/api/auth/passkey/verify-authentication")

    assert routes.covering_prefix("/api/auth/", served(inner, CATCH_ALL)) is None


def test_a_location_answering_itself_refuses():
    """It forwards no route, so read as an exact match it would stand for a handler the edge never reaches."""
    with pytest.raises(routes.NginxSyntax, match="return"):
        served(block("location = /api/intern", "        return 404;\n"), CATCH_ALL)


SERVER_READ = "export default async function Page(props) {\n  const { token } = await props.searchParams;\n}\n"
LINK_ZONE = "        limit_req zone=linkpage burst=60 nodelay;\n"


def link_page(url: str, text: str = SERVER_READ) -> Path:
    """An App Router tree holding one page at `url`, its module `text`."""
    app = new_root("check-public-routes-") / "app"
    app.mkdir(parents=True)
    write(app, url.strip("/") + "/page.tsx", text)
    return app


def unmetered(app: Path, where: tuple) -> list:
    """What the link-page rule says about a planted tree and a planted set of locations."""
    return routes.unmetered_links(accounting(app, where))


@pytest.mark.parametrize(
    "text",
    [
        SERVER_READ,
        '"use client";\nexport default function Page() {\n  return useSearchParams().get("token");\n}\n',
        'import { mailedLinkToken } from "@/core/mailedLink";\nexport default async function Page() {\n  return await mailedLinkToken();\n}\n',
    ],
    ids=["server-page", "client-hook", "mailed-link-reader"],
)
def test_a_link_page_only_the_catch_all_answers_is_a_finding(text):
    """Under every spelling of the read, the hook's being what a case-blind match exists for."""
    findings = unmetered(link_page("/new", text), served(METERED, CATCH_ALL))

    assert severities(findings) == ["fail"]
    assert "/new reaches `location /`" in details(findings)


def test_a_link_page_another_zone_meters_is_a_finding():
    """Metered is not enough: another zone passes any rule asking only for a `limit_req`."""
    findings = unmetered(link_page("/new"), served(exact("/new"), CATCH_ALL))

    assert severities(findings) == ["fail"]
    assert "/new reaches `location = /new`" in details(findings)


def test_no_link_page_at_all_refuses():
    """The rule judged nothing, which would otherwise read as every link page metered."""
    with pytest.raises(routes.NothingJudged, match="no page"):
        unmetered(tree("/api/bewerbung"), served(METERED, CATCH_ALL))


MINTER = 'const NEW_PATH = "/newhelp";\nexport const newLink = (origin: string, token: string) => `${origin}${NEW_PATH}?token=${token}`;\n'


def test_a_link_page_reading_its_token_through_another_module_is_found_by_its_minter():
    """The page's own module names neither word the reader matches, so the minter is what finds it."""
    app = link_page(
        "/newhelp",
        'import { linkToken } from "./linkRead";\nexport default async function Page(props) {\n  return linkToken(props);\n}\n',
    )
    write(app, "newhelp/linkRead.ts", "export const linkToken = async (props) => (await props.searchParams).token;\n")
    write(app.parent, "core/newLink.ts", MINTER)
    paged = routes.pages(app)
    assert routes.link_pages(paged) == (), "the page names its token itself, so this case tests the reader instead"

    assert [page.url for page in routes.linked_pages(paged, routes.minted(app.parent))] == ["/newhelp"]


RECORD_LINK = "export const newLink = (origin: string, kind: Kind, token: string) => `${origin}${NEW_PATHS[kind]}?token=${token}`;\n"


def test_a_link_through_a_record_of_paths_mints_one_to_each_of_its_values():
    """The key is a run-time value, so every value is a page some mail opens; a quoted key spells the same record."""
    root = new_root("check-public-routes-")
    record = 'const NEW_PATHS: Readonly<Record<Kind, string>> = {\n  one: "/newhelp",\n  "two": "/newhelp/two",\n};\n'
    write(root, "core/newLink.ts", record + RECORD_LINK)

    assert [path for _, path in routes.minted(root)] == ["/newhelp", "/newhelp/two"]


ROUTES_TABLE = (
    "export const ROUTES = {\n"
    '  newhelp: { path: () => "/newhelp" as const, title: null, crawl: "disallow" },\n'
    "  newTwo: {\n"
    '    path: () => "/newhelp/two" as const,\n'
    "    title: null,\n"
    '    crawl: "disallow",\n'
    "  },\n"
    '  newSaison: { path: (saison: string) => `/newhelp/${saison}` as const, title: null, crawl: "disallow" },\n'
    "};\n"
)


def test_a_link_through_a_routes_row_mints_one_to_that_row_s_path():
    """The page's address is spelled once, in the table, so the link is placed where the table places it."""
    root = new_root("check-public-routes-")
    write(root, "core/routes.ts", ROUTES_TABLE)
    write(
        root,
        "core/newLink.ts",
        "export const one = (origin: string, token: string) => `${origin}${ROUTES.newhelp.path()}?token=${token}`;\n"
        "export const two = (origin: string, token: string) => `${origin}${ROUTES.newTwo.path()}?token=${token}`;\n",
    )

    assert [path for _, path in routes.minted(root)] == ["/newhelp", "/newhelp/two"]


@pytest.mark.parametrize(
    "key",
    ["newThree", "newSaison"],
    ids=["a-row-the-table-does-not-hold", "a-row-taking-segments"],
)
def test_a_link_through_a_routes_row_this_reader_cannot_place_refuses(key):
    """A row it skipped would drop its page from the listing; a row taking segments names no one page."""
    root = new_root("check-public-routes-")
    write(root, "core/routes.ts", ROUTES_TABLE)
    minter = "export const newLink = (origin: string, token: string) => `${origin}${ROUTES." + key + ".path()}?token=${token}`;\n"
    write(root, "core/newLink.ts", minter)

    with pytest.raises(routes.RouteShape, match=f"ROUTES.{key}"):
        routes.minted(root)


@pytest.mark.parametrize(
    "text",
    [
        "export const newLink = (origin: string, token: string) => origin + `/newhelp?token=${token}`;\n",
        "export const newLink = (origin: string, token: string) => `${origin}${NEW_PATH}?token=${token}`;\n",
        'const NEW_PATHS = { one: "/newhelp", two: NEW_PATH };\n' + RECORD_LINK,
        RECORD_LINK,
    ],
    ids=["no-origin-in-the-template", "a-path-constant-of-another-module", "a-record-value-no-literal-spells", "a-record-of-another-module"],
)
def test_a_minted_link_this_reader_cannot_place_refuses(text):
    """A minter it skipped would drop its page from the listing, which reads as a tree with one link page fewer.

    A record is placed whole or not at all: dropping the value it cannot read drops that value's page.
    """
    root = new_root("check-public-routes-")
    write(root, "core/newLink.ts", text)

    with pytest.raises(routes.RouteShape, match="newLink"):
        routes.minted(root)


def test_a_link_burst_sized_for_another_squad_is_a_finding():
    """A squad of 10 at 30 a minute needs 10 x 10 - 2 x 30 = 40."""
    sized = "        limit_req zone=linkpage burst=40 nodelay;\n"
    where = served(block("location = /new", sized, PASS), block("location /new/", sized, PASS), CATCH_ALL)

    assert routes.unsized_links(accounting(where=where, squad=10)) == []

    findings = routes.unsized_links(accounting(where=where, squad=11))

    assert severities(findings) == ["fail"] * 2
    assert "where a squad of 11 needs burst=50" in details(findings)


def test_a_link_zone_the_http_level_does_not_declare_refuses():
    """Its rate is the sizing's other half, so no burst was judged."""
    with pytest.raises(routes.NothingJudged, match="linkpage"):
        routes.unsized_links(accounting(where=served(CATCH_ALL), rates={}))


DISCARDED = "        error_log /dev/null;\n"


def unlogged(*lines: str) -> list:
    """What the error-log rule says about a link page at `/new` whose exact location carries `lines`."""
    return routes.unlogged_links(accounting(link_page("/new"), served(block("location = /new", LINK_ZONE, *lines, PASS), CATCH_ALL)))


@pytest.mark.parametrize(
    "lines",
    [(), (DISCARDED, "        error_log stderr;\n"), ("        error_log stderr crit;\n",)],
    ids=["inherited", "a-second-log-beside-it", "a-raised-level"],
)
def test_a_link_page_s_location_writing_an_error_line_anywhere_is_a_finding(lines):
    """nginx writes to every log a level names, so a second beside the discard writes the token; a full disk's line is crit."""
    findings = unlogged(*lines)

    assert severities(findings) == ["fail"]
    assert "/new reaches `location = /new`" in details(findings)


NEW_REFERRER = (("/new", "no-referrer"), ("default", "strict-origin-when-cross-origin"))


def referring(where: tuple, referrer: tuple, url: str = "/new") -> list:
    """What the referrer rule says about a link page at `url`, the locations and the map's entries given."""
    return routes.referring_links(accounting(link_page(url), where, referrer=referrer))


def test_a_link_page_the_map_hands_the_site_s_policy_is_a_finding():
    """A link page added with its block and no entry, which is how one ships handing its address on."""
    findings = referring(served(block("location = /new", LINK_ZONE, PASS), CATCH_ALL), (("default", "strict-origin-when-cross-origin"),))

    assert severities(findings) == ["fail"]
    assert "gives /new strict-origin-when-cross-origin" in details(findings)


def test_an_exact_entry_answers_before_a_regex_withholding_the_referrer():
    """nginx's own order: the exact key wins, so a regex covering the page does not."""
    entries = (("/new/page", "strict-origin-when-cross-origin"), ("~^/new/", "no-referrer"), ("default", "strict-origin-when-cross-origin"))
    findings = referring(served(block("location /new/", LINK_ZONE, PASS), CATCH_ALL), entries, "/new/page")

    assert severities(findings) == ["fail"]
    assert "gives /new/page strict-origin-when-cross-origin" in details(findings)


@pytest.mark.parametrize("key", ["/other", "~^/ne", "~*^/new"], ids=["another-page", "a-wider-regex", "a-caseless-regex"])
def test_an_entry_withholding_the_referrer_where_no_link_page_s_location_matches_is_a_finding(key):
    """Every other page keeps the site's policy, so an entry matching more, or elsewhere, is one."""
    findings = referring(served(block("location = /new", LINK_ZONE, PASS), CATCH_ALL), (*NEW_REFERRER, (key, "no-referrer")))

    assert severities(findings) == ["fail"]
    assert f"gives {key!r} no-referrer, a match no link page's location" in details(findings)


def test_no_referrer_map_at_all_refuses():
    """The rule judged nothing, which would otherwise read as every link page withholding it."""
    with pytest.raises(routes.NothingJudged, match="no map setting"):
        referring(served(block("location = /new", LINK_ZONE, PASS), CATCH_ALL), ())


def test_the_referrer_map_is_read_off_the_http_level_in_order():
    """Its entries as nginx reads them, a quoted key unquoted, the map's other variables left out."""
    root = new_root("check-public-routes-")
    other = "map $uri $other {\n    default x;\n}\n"
    write(root, "http.conf", other + 'map $uri $referrer_policy {\n    "~^/new/" no-referrer;\n    /new no-referrer;\n    default y;\n}\n')

    assert routes.map_entries(root / "http.conf", "$referrer_policy") == (("~^/new/", "no-referrer"), ("/new", "no-referrer"), ("default", "y"))
    assert routes.map_entries(root / "http.conf", "$absent") == ()


def test_a_referrer_map_entry_this_reader_cannot_resolve_refuses():
    """`hostnames` changes how every key matches, and an included file holds entries unread."""
    root = new_root("check-public-routes-")
    write(root, "http.conf", "map $uri $referrer_policy {\n    hostnames;\n    default y;\n}\n")

    with pytest.raises(routes.NginxSyntax, match="hostnames"):
        routes.map_entries(root / "http.conf", "$referrer_policy")


CEILING = "        limit_conn conn 50;\n"
ACTION_ZONE = "        limit_req zone=action burst=30 nodelay;\n"
ACTION_CATCH_ALL = block("location /", CEILING, ACTION_ZONE, PASS)
RAISED_ZONE = ACTION_ZONE.replace("burst=30 ", "burst=31 ")
AUTH_ZONE = "        limit_req zone=authapi burst=10 nodelay;\n"


def loosened(*blocks: str, app: Path | None = None) -> list:
    """What the carved-out meter rule says about the blocks given beside the catch-all metering actions."""
    return routes.loosened(accounting(app, served(*blocks, ACTION_CATCH_ALL)))


@pytest.mark.parametrize(
    ("lines", "lacking"),
    [
        ((CEILING,), "`limit_req zone=action burst=30 nodelay`"),
        ((ACTION_ZONE,), "`limit_conn conn 50`"),
        ((CEILING, RAISED_ZONE), "`limit_req zone=action burst=30 nodelay`"),
    ],
    ids=["no-action-zone", "no-ceiling", "a-raised-burst"],
)
def test_a_page_s_location_lacking_a_line_of_the_catch_all_s_meter_is_a_finding(lines, lacking):
    """Next runs a server action at any page's path, so a block lacking either line is where a script posts past it."""
    findings = loosened(block("location /new/", *lines, PASS))

    assert severities(findings) == ["fail"]
    assert f"`location /new/` is carved out of `location /` and lacks its {lacking}" in details(findings)


def test_an_exact_match_carved_out_of_a_handler_s_prefix_owes_the_prefix_s_zone():
    """The prefix's handler answers the path, so the exact match meters it as the prefix does, a zone of its own beside."""
    app = tree("/api/auth/[...all]")
    prefix_block = block("location /api/auth", AUTH_ZONE, PASS)

    assert loosened(prefix_block, block("location = /api/auth/code", AUTH_ZONE, ZONE, PASS), app=app) == []

    findings = loosened(prefix_block, block("location = /api/auth/code", ZONE, PASS), app=app)

    assert severities(findings) == ["fail"]
    assert "carved out of `location /api/auth` and lacks its `limit_req zone=authapi burst=10 nodelay`" in details(findings)


def test_a_location_the_ceiling_is_recorded_not_to_bound_still_owes_the_action_zone():
    """The record lifts the ceiling alone."""
    assert loosened(block("location /_next/static/", ACTION_ZONE, PASS)) == []

    findings = loosened(block("location /_next/static/", PASS))

    assert severities(findings) == ["fail"]
    assert "lacks its `limit_req zone=action burst=30 nodelay`\n" in details(findings)


@pytest.mark.parametrize(
    ("blocks", "said"),
    [
        ((block("location = /new", RAISED_ZONE, PASS), CATCH_ALL.replace(CEILING, "")), "meters nothing"),
        ((ACTION_CATCH_ALL,), "no location but"),
    ],
    ids=["a-catch-all-metering-nothing", "no-page-s-location-beside-it"],
)
def test_the_carved_out_meter_rule_judging_nothing_refuses(blocks, said):
    """No meter to hold a page's location to, or no page's location to hold, would otherwise read as none loosened."""
    with pytest.raises(routes.NothingJudged, match=said):
        routes.loosened(accounting(where=served(*blocks)))


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
        routes.locations(routes.parse(text, SOURCE), SOURCE, maps)


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
        routes.locations(routes.parse(text, SOURCE), SOURCE)


def test_two_server_blocks_declaring_locations_refuse():
    """A location in the www redirect would read as coverage, and nothing says which serves what."""
    text = "server {\n" + CATCH_ALL + "}\nserver {\n" + prefix("/api/") + "}\n"

    with pytest.raises(routes.NginxSyntax, match="server blocks declare a location"):
        routes.locations(routes.parse(text, SOURCE), SOURCE)


def test_a_block_that_never_closes_refuses():
    """A truncated file would otherwise read as a configuration declaring fewer locations."""
    with pytest.raises(routes.NginxSyntax, match="never closes"):
        routes.parse("server {\n    location / { proxy_pass http://frontend:3000;\n", SOURCE)


def test_a_directive_with_no_semicolon_refuses():
    """The line after it would be swallowed into its arguments, which loses a whole directive."""
    with pytest.raises(routes.NginxSyntax, match="semicolon"):
        routes.parse("server {\n    location / {\n        proxy_pass http://frontend:3000\n    }\n}\n", SOURCE)


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


# The http level and the link block a clean run needs, every rule having something to judge: the
# link zone declared at 30 a minute, a link page's block sized for the squad the backend publishes and
# discarding its error lines, the referrer withheld from it, and the catch-all metering server actions.
HTTP_CONF = (
    "limit_req_zone $client_net zone=linkpage:10m rate=30r/m;\n"
    "map $uri $referrer_policy {\n    /new no-referrer;\n    default strict-origin-when-cross-origin;\n}\n"
)
LINK_BURST = 10 * routes.kader_size_max(routes.REPO_ROOT / routes.OPENAPI) - 2 * 30
CHECKER = REPO_ROOT / "scripts" / "checks" / "check_public_routes.py"


def clean(*blocks: str) -> str:
    """The server body every rule passes over `clean_tree`, the blocks given beside its own."""
    link = block("location = /new", CEILING, f"        limit_req zone=linkpage burst={LINK_BURST} nodelay;\n", ACTION_ZONE, DISCARDED, PASS)
    return "server {\n" + METERED + link + "".join(blocks) + ACTION_CATCH_ALL + "}\n"


def clean_tree() -> Path:
    """A route handler and a link page, each with the location `clean` gives it."""
    app = link_page("/new")
    write(app, "api/bewerbung/route.ts", HANDLER)
    return app


def run_checker(app: Path, text: str | bytes, *, tree: Path | None = None) -> subprocess.CompletedProcess[str]:
    """The checker run as the gate runs it, as its own process, over `app` and a configuration of `text` beside it.

    The real tables stand: what they record names no URL a fixture tree holds unless its case plants it.
    `tree` hands it another route tree than `app`, the configuration still beside `app`.
    """
    conf = app.parent / SOURCE
    conf.write_bytes(text if isinstance(text, bytes) else text.encode("utf-8"))
    (app.parent / routes.NGINX_HTTP_CONF).write_bytes(HTTP_CONF.encode("utf-8"))
    # Its own encoding, not the machine's: the checker's streams are utf-8 whatever the codepage.
    return subprocess.run(
        (sys.executable, str(CHECKER), str(tree or app), str(conf)), capture_output=True, encoding="utf-8", errors="replace", check=False
    )


def failures(done: subprocess.CompletedProcess[str]) -> list[str]:
    """The first line of each finding the run printed, as a reader of the gate's output meets it."""
    return [line.strip() for line in done.stdout.splitlines() if line.strip().startswith("FAIL")]


REFUSED = "Nothing was accounted for, so this is a refusal rather than a verdict on the routes."


def test_a_clean_pair_exits_zero():
    """The contract's passing arm, and what the gate's ops section reads as a green step."""
    done = run_checker(clean_tree(), clean())

    assert done.returncode == 0, done.stdout + done.stderr
    assert "1 route handler(s) accounted for" in done.stdout and "1 link page(s) on the link pages' zone" in done.stdout, done.stdout


def test_a_finding_fails_the_run():
    """`main` runs every rule of `RULES` and answers 1 for what one finds, the finding printed for the reader."""
    app = clean_tree()
    write(app, "api/example/route.ts", HANDLER)

    done = run_checker(app, clean())

    assert done.returncode == 1, done.stdout + done.stderr
    assert failures(done) == [f"FAIL    app/api/example/route.ts answers /api/example, and no location in {SOURCE} names it"]


def test_a_rule_that_judged_nothing_exits_two():
    """A refusal collapsed into a failure, or into a pass, sends a reader to the wrong repair.

    A tree with no link page leaves the link rules nothing to judge.
    """
    app = tree("/api/bewerbung")

    done = run_checker(app, clean())

    assert done.returncode == routes.EXIT_REFUSED, done.stdout + done.stderr
    assert "A rule found nothing to judge, so this is a refusal rather than a pass." in done.stderr, done.stderr


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
