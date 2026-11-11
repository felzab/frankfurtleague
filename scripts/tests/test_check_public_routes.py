"""SCRIPTS · the route-handler accounting, driven red on each finding it can report.

`check_public_routes.py` is the only thing comparing the App Router tree to the edge's locations, so
a defect in it is silent by construction: the gate stays green and the handler ships unmetered. Every
case below plants the shape it reports; the gate's own run of the checker is what reads the
repository's tree.

The refusals are driven for the same reason: a construct the reader cannot place, or a rule that
finds nothing to judge, has to end the run at `EXIT_REFUSED`, and one quietly skipped reads as
coverage.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from conftest import details, import_scripts, new_root, severities, write

[routes] = import_scripts("check_public_routes")

SOURCE = "fixture.conf"
HANDLER = "export const POST = () => new Response();\n"
ZONE = "        limit_req zone=bewerbung burst=2 nodelay;\n"
PASS = "        proxy_pass http://frontend:3000;\n"


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


def test_a_metered_exact_match_covers_its_handler():
    """The resting state every red case below is measured against."""
    assert accounted(tree("/api/bewerbung"), served(METERED, CATCH_ALL)) == []


def test_a_recorded_reason_at_an_exact_match_path_does_not_excuse_its_missing_meter(monkeypatch):
    """Not redundant beside the plain unmetered-exact case: the recorded reason names that same path.

    `REASONS` accounts for what a PREFIX covers, so nothing there may answer for an exact match.
    """
    monkeypatch.setattr(routes, "REASONS", (routes.Reason("/api/bewerbung", "a prefix reason spelled at an exact match's own path"),))
    findings = accounted(tree("/api/bewerbung"), served(exact("/api/bewerbung", metered=False), CATCH_ALL))

    assert severities(findings) == ["fail"]
    assert "carries no limit_req" in details(findings)


def test_a_handler_recorded_unmetered_is_no_finding_and_its_neighbour_still_is(monkeypatch):
    """The record names one URL: a handler beside it, unmetered the same way, is reported."""
    monkeypatch.setattr(routes, "UNMETERED", (routes.Unmetered("/api/hook", "a machine's webhook"),))
    findings = accounted(tree("/api/hook", "/api/hook2"), served(exact("/api/hook", metered=False), CATCH_ALL))

    assert severities(findings) == ["fail"]
    assert "/api/hook2" in details(findings)


def test_a_handler_filed_as_a_tsx_route_is_walked_too():
    """Next resolves all four extensions, so a walk seeing one of them accounts for part of the tree."""
    findings = accounted(tree("/api/beispiel", file="route.tsx"), served(METERED, CATCH_ALL))

    assert severities(findings) == ["fail"]
    assert "/api/beispiel" in details(findings)


def test_a_handler_filed_under_another_spelling_of_route_ts_is_not_accounted_for():
    """Next resolves `route.ts` and no other spelling of it, so a `Route.ts` answers no URL.

    Vacuous on Linux, where the walk cannot see the file at all; on Windows, which resolves a
    name case-blind, it is the whole trap.
    """
    assert routes.handlers(tree("/api/sweep", file="Route.ts")) == ()


GENERATED = "export default function meta() {\n  return [];\n}\n"


def with_files(*names: str) -> Path:
    """An App Router tree holding exactly the files named, each at its path under the tree's root."""
    app = new_root("check-public-routes-") / "app"
    app.mkdir(parents=True)
    for name in names:
        write(app, name, GENERATED)
    return app


def test_a_metadata_convention_at_the_tree_root_is_accounted_for():
    """The population is these as well as the handlers: a file no walk sees is a URL nobody decided."""
    assert [one.url for one in routes.metadata(with_files("sitemap.ts"))] == ["/sitemap.xml"]


def test_a_metadata_convention_is_resolved_from_every_extension_a_handler_is():
    """Next reads one page-extension list for both, so a walk seeing fewer accounts for part of the tree."""
    assert [one.url for one in routes.metadata(with_files("robots.jsx"))] == ["/robots.txt"]


def test_a_module_named_for_a_convention_and_something_else_is_not_the_convention():
    """`sitemap.test.ts` sits beside `sitemap.ts` in this repository and answers no URL at all."""
    assert routes.metadata(with_files("sitemap.test.ts", "brandAssets.test.ts")) == ()


def test_an_image_convention_supplied_as_an_image_file_is_outside_the_population():
    """Nothing runs to answer these, so the class this reader accounts for stops at the code ones."""
    assert routes.metadata(with_files("icon.svg", "apple-icon.png", "favicon.ico")) == ()


def test_a_reserved_name_inside_a_private_folder_is_no_claim_on_the_population():
    """Next opts such a folder out of routing, so a component called `icon.tsx` under one answers nothing.

    A refusal here would be repaired by renaming a legitimate component, which is the wrong repair.
    """
    assert routes.metadata(with_files("_components/icon.tsx", "_lib/sitemap.ts")) == ()


@pytest.mark.parametrize("name", ["twitter-image.tsx", "opengraph-image.tsx", "saisons/opengraph-image.tsx"])
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


@pytest.mark.parametrize("marker", ["(..)", "(...)", "(..)(..)"])
def test_a_page_intercepting_a_level_up_or_the_root_refuses(marker):
    """Its URL drops segments above it, which this reader does not derive; silence would place it wrongly."""
    with pytest.raises(routes.RouteShape, match="cannot derive"):
        routes.pages(tree(f"/saisons/[saison]/@modal/{marker}spiele/[spiel]", file="page.tsx"))


ROOT_INTERCEPTOR = "/@modal/(.)saisons/[saison]/spiele/[spiel]"


def intercepting(*urls: str) -> list:
    """What the interception rule says about a tree holding a page at each of `urls`."""
    return routes.interceptions(accounting(tree(*urls, file="page.tsx")))


def test_one_interceptor_in_the_slot_every_page_shares_is_no_finding():
    """The resting state: the root layout's slot, with the page it intercepts beside it."""
    assert intercepting(ROOT_INTERCEPTOR, "/saisons/[saison]/spiele/[spiel]") == []


def test_an_interceptor_under_a_route_group_is_a_finding():
    """A group is no level, so `(classic)`'s slot intercepts from every page while its layout draws it on its own alone."""
    findings = intercepting("/(classic)" + ROOT_INTERCEPTOR)

    assert severities(findings) == ["fail"]
    assert "under the route group (classic)" in details(findings)


def test_a_route_group_below_the_intercepting_segment_is_no_finding():
    """A group inside the intercepted path organises what is drawn, not the level the rewrite reads."""
    assert intercepting("/@modal/(.)saisons/[saison]/(match)/spiele/[spiel]") == []


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
    findings = accounted(tree("/api/beispiel"), served(METERED, CATCH_ALL))

    assert severities(findings) == ["fail"]
    assert "/api/beispiel" in details(findings)


def test_the_catch_all_is_never_coverage():
    """`location /` matches every URI, so counting it would leave this check unable to fail."""
    assert routes.covering_prefix("/api/beispiel", served(CATCH_ALL)) is None


def test_a_prefix_covering_a_handler_needs_a_recorded_reason(monkeypatch):
    """A prefix names where a path goes and meters nothing, so the reason is the whole accounting."""
    monkeypatch.setattr(routes, "REASONS", ())
    findings = accounted(tree("/api/beispiel/eins"), served(prefix("/api/beispiel/"), CATCH_ALL))

    assert severities(findings) == ["fail"]
    assert "no recorded reason" in details(findings)


def test_a_recorded_reason_covers_the_handlers_that_fall_to_its_prefix(monkeypatch):
    """The other half of the same rule: a handler under a recorded prefix is accounted for by its reason."""
    monkeypatch.setattr(routes, "REASONS", (routes.Reason("/api/beispiel/", "each behind a guard of its own"),))

    assert accounted(tree("/api/beispiel/eins", "/api/beispiel/zwei"), served(prefix("/api/beispiel/"), CATCH_ALL)) == []


def test_a_dynamic_segment_with_no_prefix_over_it_is_unmeterable():
    """An exact match cannot name a catch-all's URLs, so only a prefix reaches the subtree at all."""
    findings = accounted(tree("/api/auth/[...all]"), served(METERED, CATCH_ALL))

    assert severities(findings) == ["fail"]
    assert "unmeterable" in details(findings)


def test_a_prefix_above_a_dynamic_segment_covers_it(monkeypatch):
    """The catch-all's own case: the prefix has to sit above the segment, not inside it."""
    monkeypatch.setattr(routes, "REASONS", (routes.Reason("/api/auth", "the sign-in library's catch-all"),))

    assert accounted(tree("/api/auth/[...all]"), served(prefix("/api/auth"), CATCH_ALL)) == []


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
    findings = unmetered(link_page("/neu", text), served(METERED, CATCH_ALL))

    assert severities(findings) == ["fail"]
    assert "/neu reaches `location /`" in details(findings)


def test_a_link_page_another_zone_meters_is_a_finding():
    """Metered is not enough: another zone passes any rule asking only for a `limit_req`."""
    findings = unmetered(link_page("/neu"), served(exact("/neu"), CATCH_ALL))

    assert severities(findings) == ["fail"]
    assert "/neu reaches `location = /neu`" in details(findings)


def test_a_link_page_on_the_link_zone_is_no_finding():
    """The control for the two above."""
    assert unmetered(link_page("/neu"), served(block("location = /neu", LINK_ZONE, PASS), CATCH_ALL)) == []


def test_no_link_page_at_all_refuses():
    """The rule judged nothing, which would otherwise read as every link page metered."""
    with pytest.raises(routes.NothingJudged, match="no page"):
        unmetered(tree("/api/bewerbung"), served(METERED, CATCH_ALL))


MINTER = 'const NEU_PATH = "/neuhilfe";\nexport const neuLink = (origin: string, token: string) => `${origin}${NEU_PATH}?token=${token}`;\n'


def test_a_link_page_reading_its_token_through_another_module_is_found_by_its_minter():
    """The page's own module names neither word the reader matches, so the minter is what finds it."""
    app = link_page(
        "/neuhilfe",
        'import { linkSchluessel } from "./linkLesen";\nexport default async function Page(props) {\n  return linkSchluessel(props);\n}\n',
    )
    write(app, "neuhilfe/linkLesen.ts", "export const linkSchluessel = async (props) => (await props.searchParams).token;\n")
    write(app.parent, "core/neuLink.ts", MINTER)
    paged = routes.pages(app)
    assert routes.link_pages(paged) == (), "the page names its token itself, so this case tests the reader instead"

    assert [page.url for page in routes.linked_pages(paged, routes.minted(app.parent))] == ["/neuhilfe"]


RECORD_LINK = "export const neuLink = (origin: string, art: Art, token: string) => `${origin}${NEU_PFAD[art]}?token=${token}`;\n"


def test_a_link_through_a_record_of_paths_mints_one_to_each_of_its_values():
    """The key is a run-time value, so every value is a page some mail opens; a quoted key spells the same record."""
    root = new_root("check-public-routes-")
    record = 'const NEU_PFAD: Readonly<Record<Art, string>> = {\n  eins: "/neuhilfe",\n  "zwei": "/neuhilfe/zwei",\n};\n'
    write(root, "core/neuLink.ts", record + RECORD_LINK)

    assert [path for _, path in routes.minted(root)] == ["/neuhilfe", "/neuhilfe/zwei"]


ROUTES_TABLE = (
    "export const ROUTES = {\n"
    '  neuhilfe: { path: () => "/neuhilfe" as const, title: null, crawl: "disallow" },\n'
    "  neuZwei: {\n"
    '    path: () => "/neuhilfe/zwei" as const,\n'
    "    title: null,\n"
    '    crawl: "disallow",\n'
    "  },\n"
    '  neuSaison: { path: (saison: string) => `/neuhilfe/${saison}` as const, title: null, crawl: "disallow" },\n'
    "};\n"
)


def test_a_link_through_a_routes_row_mints_one_to_that_row_s_path():
    """The page's address is spelled once, in the table, so the link is placed where the table places it."""
    root = new_root("check-public-routes-")
    write(root, "core/routes.ts", ROUTES_TABLE)
    write(
        root,
        "core/neuLink.ts",
        "export const eins = (origin: string, token: string) => `${origin}${ROUTES.neuhilfe.path()}?token=${token}`;\n"
        "export const zwei = (origin: string, token: string) => `${origin}${ROUTES.neuZwei.path()}?token=${token}`;\n",
    )

    assert [path for _, path in routes.minted(root)] == ["/neuhilfe", "/neuhilfe/zwei"]


@pytest.mark.parametrize(
    "key",
    ["neuDrei", "neuSaison"],
    ids=["a-row-the-table-does-not-hold", "a-row-taking-segments"],
)
def test_a_link_through_a_routes_row_this_reader_cannot_place_refuses(key):
    """A row it skipped would drop its page from the listing; a row taking segments names no one page."""
    root = new_root("check-public-routes-")
    write(root, "core/routes.ts", ROUTES_TABLE)
    minter = "export const neuLink = (origin: string, token: string) => `${origin}${ROUTES." + key + ".path()}?token=${token}`;\n"
    write(root, "core/neuLink.ts", minter)

    with pytest.raises(routes.RouteShape, match=f"ROUTES.{key}"):
        routes.minted(root)


@pytest.mark.parametrize(
    "text",
    [
        "export const neuLink = (origin: string, token: string) => origin + `/neuhilfe?token=${token}`;\n",
        "export const neuLink = (origin: string, token: string) => `${origin}${NEU_PATH}?token=${token}`;\n",
        'const NEU_PFAD = { eins: "/neuhilfe", zwei: NEU_PATH };\n' + RECORD_LINK,
        RECORD_LINK,
    ],
    ids=["no-origin-in-the-template", "a-path-constant-of-another-module", "a-record-value-no-literal-spells", "a-record-of-another-module"],
)
def test_a_minted_link_this_reader_cannot_place_refuses(text):
    """A minter it skipped would drop its page from the listing, which reads as a tree with one link page fewer.

    A record is placed whole or not at all: dropping the value it cannot read drops that value's page.
    """
    root = new_root("check-public-routes-")
    write(root, "core/neuLink.ts", text)

    with pytest.raises(routes.RouteShape, match="neuLink"):
        routes.minted(root)


@pytest.mark.parametrize("suffix", [".ts", ".tsx", ".js", ".jsx"])
def test_a_test_file_holding_a_token_query_mints_nothing(suffix):
    """Every extension the walk reads: a fixture is no minter."""
    root = new_root("check-public-routes-")
    write(root, f"core/neuLink.test{suffix}", "const fixture = `/neuhilfe?token=kein-echtes-token`;\n")

    assert routes.minted(root) == ()


def test_a_link_burst_sized_for_another_squad_is_a_finding():
    """A squad of 10 at 30 a minute needs 10 x 10 - 2 x 30 = 40."""
    sized = "        limit_req zone=linkpage burst=40 nodelay;\n"
    where = served(block("location = /neu", sized, PASS), block("location /neu/", sized, PASS), CATCH_ALL)

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
    """What the error-log rule says about a link page at `/neu` whose exact location carries `lines`."""
    return routes.unlogged_links(accounting(link_page("/neu"), served(block("location = /neu", LINK_ZONE, *lines, PASS), CATCH_ALL)))


def test_a_link_page_s_location_discarding_its_error_lines_is_no_finding():
    """The control for the two below."""
    assert unlogged(DISCARDED) == []


@pytest.mark.parametrize(
    "lines",
    [(), (DISCARDED, "        error_log stderr;\n"), ("        error_log stderr crit;\n",)],
    ids=["inherited", "a-second-log-beside-it", "a-raised-level"],
)
def test_a_link_page_s_location_writing_an_error_line_anywhere_is_a_finding(lines):
    """nginx writes to every log a level names, so a second beside the discard writes the token; a full disk's line is crit."""
    findings = unlogged(*lines)

    assert severities(findings) == ["fail"]
    assert "/neu reaches `location = /neu`" in details(findings)


NEU_REFERRER = (("/neu", "no-referrer"), ("default", "strict-origin-when-cross-origin"))


def referring(where: tuple, referrer: tuple, url: str = "/neu") -> list:
    """What the referrer rule says about a link page at `url`, the locations and the map's entries given."""
    return routes.referring_links(accounting(link_page(url), where, referrer=referrer))


def test_a_link_page_its_location_s_entry_withholds_the_referrer_from_is_no_finding():
    """The control, an exact match and a prefix each spelled as they match."""
    assert referring(served(block("location = /neu", LINK_ZONE, PASS), CATCH_ALL), NEU_REFERRER) == []
    prefixed = (("~^/neu/", "no-referrer"), ("default", "strict-origin-when-cross-origin"))
    assert referring(served(block("location /neu/", LINK_ZONE, PASS), CATCH_ALL), prefixed, "/neu/seite") == []


def test_a_link_page_the_map_hands_the_site_s_policy_is_a_finding():
    """A link page added with its block and no entry, which is how one ships handing its address on."""
    findings = referring(served(block("location = /neu", LINK_ZONE, PASS), CATCH_ALL), (("default", "strict-origin-when-cross-origin"),))

    assert severities(findings) == ["fail"]
    assert "gives /neu strict-origin-when-cross-origin" in details(findings)


def test_an_exact_entry_answers_before_a_regex_withholding_the_referrer():
    """nginx's own order: the exact key wins, so a regex covering the page does not."""
    entries = (("/neu/seite", "strict-origin-when-cross-origin"), ("~^/neu/", "no-referrer"), ("default", "strict-origin-when-cross-origin"))
    findings = referring(served(block("location /neu/", LINK_ZONE, PASS), CATCH_ALL), entries, "/neu/seite")

    assert severities(findings) == ["fail"]
    assert "gives /neu/seite strict-origin-when-cross-origin" in details(findings)


@pytest.mark.parametrize("key", ["/andere", "~^/ne", "~*^/neu"], ids=["another-page", "a-wider-regex", "a-caseless-regex"])
def test_an_entry_withholding_the_referrer_where_no_link_page_s_location_matches_is_a_finding(key):
    """Every other page keeps the site's policy, so an entry matching more, or elsewhere, is one."""
    findings = referring(served(block("location = /neu", LINK_ZONE, PASS), CATCH_ALL), (*NEU_REFERRER, (key, "no-referrer")))

    assert severities(findings) == ["fail"]
    assert f"gives {key!r} no-referrer, a match no link page's location" in details(findings)


def test_no_referrer_map_at_all_refuses():
    """The rule judged nothing, which would otherwise read as every link page withholding it."""
    with pytest.raises(routes.NothingJudged, match="no map setting"):
        referring(served(block("location = /neu", LINK_ZONE, PASS), CATCH_ALL), ())


def test_the_referrer_map_is_read_off_the_http_level_in_order():
    """Its entries as nginx reads them, a quoted key unquoted, the map's other variables left out."""
    root = new_root("check-public-routes-")
    other = "map $uri $other {\n    default x;\n}\n"
    write(root, "http.conf", other + 'map $uri $referrer_policy {\n    "~^/neu/" no-referrer;\n    /neu no-referrer;\n    default y;\n}\n')

    assert routes.map_entries(root / "http.conf", "$referrer_policy") == (("~^/neu/", "no-referrer"), ("/neu", "no-referrer"), ("default", "y"))
    assert routes.map_entries(root / "http.conf", "$absent") == ()


def test_a_referrer_map_entry_this_reader_cannot_resolve_refuses():
    """`hostnames` changes how every key matches, and an included file holds entries unread."""
    root = new_root("check-public-routes-")
    write(root, "http.conf", "map $uri $referrer_policy {\n    hostnames;\n    default y;\n}\n")

    with pytest.raises(routes.NginxSyntax, match="hostnames"):
        routes.map_entries(root / "http.conf", "$referrer_policy")


ACTION_ZONE = "        limit_req zone=action burst=30 nodelay;\n"
ACTION_CATCH_ALL = block("location /", "        limit_conn conn 50;\n", ACTION_ZONE, PASS)
RAISED_ZONE = ACTION_ZONE.replace("burst=30 ", "burst=31 ")


def test_a_block_raising_the_catch_all_s_burst_is_a_finding():
    """One above `/`'s, which a script posting any action at that path spends; at `/`'s, none."""
    assert routes.raised_bursts(accounting(where=served(block("location = /neu", LINK_ZONE, ACTION_ZONE, PASS), ACTION_CATCH_ALL))) == []

    findings = routes.raised_bursts(accounting(where=served(block("location = /neu", LINK_ZONE, RAISED_ZONE, PASS), ACTION_CATCH_ALL)))

    assert severities(findings) == ["fail"]
    assert "meters action with `limit_req zone=action burst=31 nodelay`, above `location /`'s burst=30" in details(findings)


def test_a_catch_all_metering_no_zone_refuses():
    """No ceiling to judge a burst against, which would otherwise read as no burst raised."""
    with pytest.raises(routes.NothingJudged, match="meters no zone"):
        routes.raised_bursts(accounting(where=served(block("location = /neu", RAISED_ZONE, PASS), CATCH_ALL)))


def test_a_route_group_leaves_the_url():
    """A parenthesised folder organises the tree and is not a path segment."""
    assert routes.url_of(("api", "(public)", "bewerbung"), Path("route.ts")) == ("/api/bewerbung", "/api/bewerbung", False)


def test_a_catch_all_segment_stops_the_static_head():
    """What a prefix has to cover is everything above the segment, never the segment itself."""
    assert routes.url_of(("api", "auth", "[...all]"), Path("route.ts")) == ("/api/auth/[...all]", "/api/auth/", True)


def test_a_dynamic_segment_stops_it_too():
    """A single dynamic segment is as unnameable by an exact match as a catch-all is."""
    assert routes.url_of(("api", "teams", "[id]"), Path("route.ts")) == ("/api/teams/[id]", "/api/teams/", True)


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


def test_a_named_location_an_error_page_sends_to_is_read_as_no_route():
    """Reached by the redirect alone, it answers no request URI and so covers no handler."""
    found = served("    error_page 429 = @refusal;\n", block("location @refusal", PASS), CATCH_ALL)

    assert [location.path for location in found] == ["/"]


def test_an_error_page_sending_to_no_named_location_refuses():
    """nginx refuses the redirect at its first use, and this reader would otherwise read the file as whole."""
    with pytest.raises(routes.NginxSyntax, match="@refusal"):
        served("    error_page 429 = @refusal;\n", CATCH_ALL)


def test_a_variable_error_page_reaches_every_location_its_map_names():
    """Read through the http level's map, so neither the page nor the sentence reads as unreached."""
    text = "server {\n    error_page 429 = $ziel;\n" + block("location @seite", PASS) + block("location @satz", PASS) + CATCH_ALL + "}\n"
    maps = routes.map_values(routes.parse('map $http_accept $ziel {\n    "~*text/html" @seite;\n    default @satz;\n}\n', SOURCE))

    found = routes.locations(routes.parse(text, SOURCE), SOURCE, maps)

    assert [location.path for location in found] == ["/"]


@pytest.mark.parametrize(
    ("maps", "named"),
    [({}, "\\$ziel"), ({"$ziel": frozenset({"@seite", "@weg"})}, "@weg")],
    ids=["no-map-defines-it", "its-map-names-no-location"],
)
def test_a_variable_error_page_this_reader_cannot_resolve_refuses(maps, named):
    """Unresolved, every named location it reaches would read as dead; resolved to nothing, as reached."""
    text = "server {\n    error_page 429 = $ziel;\n" + block("location @seite", PASS) + CATCH_ALL + "}\n"
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


def test_a_prefix_written_with_the_no_regex_modifier_still_matches_a_prefix():
    """`^~` changes which locations nginx goes on to consider, not what this one matches."""
    found = served(block("location ^~ /api/beispiel/", PASS))

    assert [(one.exact, one.path) for one in found] == [(False, "/api/beispiel/")]


def test_a_server_body_file_is_read_at_its_top_level():
    """`nginx/shared/site.conf` is a server's body, included inside each entry file's `server`."""
    found = routes.locations(routes.parse(prefix("/api/") + CATCH_ALL, SOURCE), SOURCE)
    assert [one.path for one in found] == ["/api/", "/"]


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


def test_a_refusal_below_a_string_spanning_lines_names_the_line_it_stands_on():
    """The counter travels with the scan, or every refusal under a wrapped value reports one too low."""
    text = 'server {\n    add_header X "one\ntwo";\n\n    location ~ ^/api/ {\n' + PASS + "    }\n}\n"

    with pytest.raises(routes.NginxSyntax, match=r"fixture\.conf:5:"):
        routes.locations(routes.parse(text, SOURCE), SOURCE)


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
    "map $uri $referrer_policy {\n    /neu no-referrer;\n    default strict-origin-when-cross-origin;\n}\n"
)
LINK_BURST = 10 * routes.kader_size_max(routes.REPO_ROOT / routes.OPENAPI) - 2 * 30
CLEAN = (
    "server {\n"
    + METERED
    + block("location = /neu", f"        limit_req zone=linkpage burst={LINK_BURST} nodelay;\n", ACTION_ZONE, DISCARDED, PASS)
    + ACTION_CATCH_ALL
    + "}\n"
)


def run_main(app: Path, text: str, monkeypatch) -> int:
    """One end-to-end run over a planted pair, where the exit contract is decided.

    The real reasons and conventions are withdrawn, or a run answers for what this tree does not
    hold rather than the shape its case planted.
    """
    monkeypatch.setattr(routes, "REASONS", ())
    monkeypatch.setattr(routes, "METADATA", ())
    monkeypatch.setattr(routes, "UNMETERED", ())
    conf = app.parent / SOURCE
    conf.write_bytes(text.encode("utf-8"))
    (app.parent / routes.NGINX_HTTP_CONF).write_bytes(HTTP_CONF.encode("utf-8"))
    monkeypatch.setattr(sys, "argv", ["check_public_routes.py", str(app), str(conf)])
    return routes.main()


def clean_tree() -> Path:
    """A route handler and a link page, each with the location `CLEAN` gives it."""
    app = link_page("/neu")
    write(app, "api/bewerbung/route.ts", HANDLER)
    return app


def test_a_clean_pair_exits_zero(monkeypatch):
    """The contract's passing arm, and what the gate's docs section reads as a green step."""
    assert run_main(clean_tree(), CLEAN, monkeypatch) == 0


def test_a_rule_in_the_table_that_fails_fails_the_run(monkeypatch):
    """`main` runs `RULES` whole, so this one case holds the wiring every rule reaches a reader through."""
    monkeypatch.setattr(routes, "RULES", (*routes.RULES, lambda judged: [routes.Finding("fail", "planted")]))

    assert run_main(clean_tree(), CLEAN, monkeypatch) == 1


def test_a_rule_that_judged_nothing_exits_two(monkeypatch):
    """A refusal collapsed into a failure, or into a pass, sends a reader to the wrong repair."""

    def judged_nothing(judged):
        raise routes.NothingJudged("planted")

    monkeypatch.setattr(routes, "RULES", (*routes.RULES, judged_nothing))

    assert run_main(clean_tree(), CLEAN, monkeypatch) == routes.EXIT_REFUSED


def test_a_construct_it_cannot_parse_exits_two(monkeypatch):
    """A refusal collapsed into a failure sends a reader to repair the routes rather than the reader."""
    text = "server {\n" + block("location ~ ^/api/", PASS) + "}\n"

    assert run_main(clean_tree(), text, monkeypatch) == routes.EXIT_REFUSED


def test_a_metadata_file_this_reader_cannot_place_exits_two(monkeypatch):
    """The gap the population closes, at the exit contract: the next metadata route ends the run."""
    app = clean_tree()
    write(app, "twitter-image.tsx", GENERATED)

    assert run_main(app, CLEAN, monkeypatch) == routes.EXIT_REFUSED


def test_a_missing_route_tree_exits_two(monkeypatch):
    """Input the checker cannot read is a refusal, never a tree it may call accounted for."""
    app = clean_tree()
    conf = app.parent / SOURCE
    conf.write_bytes(CLEAN.encode("utf-8"))
    monkeypatch.setattr(sys, "argv", ["check_public_routes.py", str(app.parent / "gone"), str(conf)])

    assert routes.main() == routes.EXIT_REFUSED


def test_a_configuration_that_is_not_utf_8_exits_two(monkeypatch):
    """A byte no decoder places is input this check cannot judge, and a traceback is not a verdict."""
    app = clean_tree()
    conf = app.parent / SOURCE
    conf.write_bytes(b"# \xff\n" + CLEAN.encode("utf-8"))
    monkeypatch.setattr(sys, "argv", ["check_public_routes.py", str(app), str(conf)])

    assert routes.main() == routes.EXIT_REFUSED
