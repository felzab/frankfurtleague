"""SCRIPTS · the route-handler accounting, driven red on each finding it can report.

`check_public_routes.py` is the only thing comparing the App Router tree to the edge's locations, so
a defect in it is silent by construction: the gate stays green and the handler ships unmetered. Every
case below plants the shape it reports rather than reading the repository's own, and the two that do
read the repository are what tie the mechanism to the tree it guards.

The refusals are driven for the same reason: a construct the reader cannot place has to end the run
at `EXIT_REFUSED`, and one it quietly skips reads as coverage.
"""

from __future__ import annotations

import re
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


def test_a_page_a_slot_intercepts_on_its_own_level_answers_the_intercepted_url():
    """A slot is no segment of the URL, and `(.)spiele` names `spiele` on its own level: the pop-up answers the match page's URL."""
    [page] = routes.pages(tree("/saisons/[saison]/@modal/(.)spiele/[spiel]", file="page.tsx"))

    assert (page.url, page.head, page.dynamic) == ("/saisons/[saison]/spiele/[spiel]", "/saisons/", True)


@pytest.mark.parametrize("marker", ["(..)", "(...)", "(..)(..)"])
def test_a_page_intercepting_a_level_up_or_the_root_refuses(marker):
    """Its URL drops segments above it, which this reader does not derive; silence would place it wrongly."""
    try:
        routes.pages(tree(f"/saisons/[saison]/@modal/{marker}spiele/[spiel]", file="page.tsx"))
    except routes.RouteShape as refusal:
        assert re.search("cannot derive", str(refusal)), refusal
    else:
        raise AssertionError("an intercepting route reaching above its level was given a URL")


def test_a_reserved_metadata_name_the_map_does_not_carry_refuses():
    """The gap this population closes is the NEXT metadata file, which silence would let through."""
    try:
        routes.metadata(with_files("opengraph-image.tsx"))
    except routes.RouteShape as refusal:
        assert re.search("opengraph-image", str(refusal)), refusal
    else:
        raise AssertionError("a generated metadata image was given a URL")


def test_a_metadata_convention_below_the_tree_root_refuses():
    """A nested sitemap's URL is decided by what the file exports, which this reader does not read."""
    try:
        routes.metadata(with_files("dashboard/sitemap.ts"))
    except routes.RouteShape as refusal:
        assert re.search("outside the App Router root", str(refusal)), refusal
    else:
        raise AssertionError("a nested metadata convention was placed at the root's URL")


def test_a_declared_convention_no_file_serves_is_a_finding(monkeypatch):
    """The rot `unused` reports for a prefix location's reason, over the metadata declaration."""
    monkeypatch.setattr(routes, "METADATA", (routes.Metadata("sitemap", "/sitemap.xml", "a pinned list"),))

    findings = routes.unclaimed(())

    assert severities(findings) == ["fail"]
    assert "/sitemap.xml" in details(findings)


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
    findings, _ = judged(tree("/api/beispiel/eins"), served(prefix("/api/beispiel/"), CATCH_ALL))

    assert severities(findings) == ["fail"]
    assert "no recorded reason" in details(findings)


def test_a_recorded_reason_covers_the_handlers_that_fall_to_its_prefix(monkeypatch):
    """The other half of the same rule: a handler under a recorded prefix is accounted for by its reason."""
    reason = routes.Reason("/api/beispiel/", "each behind a guard of its own")
    monkeypatch.setattr(routes, "REASONS", (reason,))
    findings, used = judged(tree("/api/beispiel/eins", "/api/beispiel/zwei"), served(prefix("/api/beispiel/"), CATCH_ALL))

    assert findings == []
    assert used == {reason}


def test_a_dynamic_segment_with_no_prefix_over_it_is_unmeterable():
    """An exact match cannot name a catch-all's URLs, so only a prefix reaches the subtree at all."""
    findings, _ = judged(tree("/api/auth/[...all]"), served(METERED, CATCH_ALL))

    assert severities(findings) == ["fail"]
    assert "unmeterable" in details(findings)


def test_a_prefix_above_a_dynamic_segment_covers_it(monkeypatch):
    """The catch-all's own case: the prefix has to sit above the segment, not inside it."""
    reason = routes.Reason("/api/auth", "the sign-in library's catch-all")
    monkeypatch.setattr(routes, "REASONS", (reason,))
    findings, used = judged(tree("/api/auth/[...all]"), served(prefix("/api/auth"), CATCH_ALL))

    assert findings == []
    assert used == {reason}


def test_a_prefix_inside_the_dynamic_segment_does_not_cover_it():
    """`/api/auth/passkey/verify-authentication` sits under the catch-all and covers no other path of it."""
    inner = prefix("/api/auth/passkey/verify-authentication")

    assert routes.covering_prefix("/api/auth/", served(inner, CATCH_ALL)) is None


def test_a_recorded_reason_charging_no_handler_is_a_finding(monkeypatch):
    """Accounting rot the other way: the handlers moved and the claim stayed."""
    monkeypatch.setattr(routes, "REASONS", (routes.Reason("/api/beispiel/", "each behind a guard of its own"),))

    findings = routes.unused(set(), served(prefix("/api/beispiel/"), CATCH_ALL))

    assert severities(findings) == ["fail"]
    assert "no handler is charged to that location" in details(findings)


def test_a_recorded_reason_naming_no_prefix_location_says_which_half_went(monkeypatch):
    """The two causes send a reader to different files, so the finding tells them apart."""
    monkeypatch.setattr(routes, "REASONS", (routes.Reason("/api/beispiel/", "each behind a guard of its own"),))

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


def test_a_location_answering_itself_refuses():
    """It forwards no route, so read as an exact match it would stand for a handler the edge never reaches."""
    try:
        served(block("location = /api/intern", "        return 404;\n"), CATCH_ALL)
    except routes.NginxSyntax as refusal:
        assert re.search("return", str(refusal)), refusal
    else:
        raise AssertionError("a location answering with `return` was read")


GONE = exact("/api/gone") + exact("/api/gone/")


def orphans(app: Path, where: tuple) -> list:
    """What the orphan rule says about a planted tree and a planted set of locations."""
    return routes.orphaned(where, routes.handlers(app) + routes.pages(app), routes.metadata(app))


def test_an_exact_match_naming_no_file_in_the_tree_is_a_finding(monkeypatch):
    """The block a moved handler leaves behind: the URL is gone and the pair still meters it.

    The answered pair beside it is the non-vacuity arm: a rule reporting every exact match alike
    fails here.
    """
    monkeypatch.setattr(routes, "ELSEWHERE", ())
    findings = orphans(tree("/api/bewerbung"), served(METERED, GONE, CATCH_ALL))

    assert severities(findings) == ["fail", "fail"]
    assert "/api/gone" in details(findings)
    assert "/api/bewerbung" not in details(findings)


def test_an_exact_match_naming_a_page_is_no_orphan(monkeypatch):
    """`= /signin` meters a page's server action, and no route handler answers that URL at all."""
    monkeypatch.setattr(routes, "ELSEWHERE", ())

    assert orphans(tree("/signin", file="page.tsx"), served(exact("/signin"), CATCH_ALL)) == []


def test_an_exact_match_under_a_dynamic_segment_is_no_orphan(monkeypatch):
    """A catch-all answers URLs no directory spells, so one of them is unnameable rather than absent."""
    monkeypatch.setattr(routes, "ELSEWHERE", ())
    app = tree("/bewerbung/[saison_id]", file="page.tsx")

    assert orphans(app, served(exact("/bewerbung/2026"), CATCH_ALL)) == []


def test_a_sibling_of_a_dynamic_head_is_no_excused_orphan(monkeypatch):
    """`url_of` gives a dynamic head its own trailing slash; without it every location merely sharing that prefix goes unreported."""
    monkeypatch.setattr(routes, "ELSEWHERE", ())
    app = tree("/bewerbung/[saison_id]", file="page.tsx")

    findings = orphans(app, served(exact("/bewerbungen-alt"), CATCH_ALL))

    assert severities(findings) == ["fail"]
    assert "/bewerbungen-alt" in details(findings)


def test_a_recorded_answer_covers_an_exact_match_the_tree_cannot(monkeypatch):
    """The liveness probe's case: the edge answers it from the backend, and no walk of this tree sees it."""
    monkeypatch.setattr(routes, "ELSEWHERE", (routes.Elsewhere("/api/gone", "answered elsewhere"),))

    assert orphans(tree("/api/bewerbung"), served(METERED, exact("/api/gone"), CATCH_ALL)) == []


def test_a_top_level_dynamic_route_excuses_no_exact_match(monkeypatch):
    """Its static head is the root, and taking that as coverage leaves this rule unable to fail.

    `location /` is refused one level up for the same reason, reached from the configuration instead
    of from the tree.
    """
    monkeypatch.setattr(routes, "ELSEWHERE", ())
    findings = orphans(tree("/[slug]"), served(GONE, CATCH_ALL))

    assert severities(findings) == ["fail", "fail"]
    assert "/api/gone" in details(findings)


def test_a_recorded_answer_the_tree_itself_serves_is_a_finding(monkeypatch):
    """A row outlives its reason the moment a file answers that URL, and the location then reads as recorded rather than accounted."""
    monkeypatch.setattr(routes, "ELSEWHERE", (routes.Elsewhere("/api/bewerbung", "answered elsewhere"),))
    app = tree("/api/bewerbung")
    findings = routes.undeclared(served(METERED, CATCH_ALL), routes.handlers(app) + routes.pages(app), routes.metadata(app))

    assert severities(findings) == ["fail"]
    assert "answers for itself" in details(findings)


def test_a_recorded_answer_no_location_names_is_a_finding(monkeypatch):
    """The rot `unused` reports for a prefix location's reason, over the off-tree table."""
    monkeypatch.setattr(routes, "ELSEWHERE", (routes.Elsewhere("/api/gone", "answered elsewhere"),))

    findings = routes.undeclared(served(METERED, CATCH_ALL), (), ())

    assert severities(findings) == ["fail"]
    assert "named by no exact-match location" in details(findings)


SERVER_READ = "export default async function Page(props) {\n  const { token } = await props.searchParams;\n}\n"
LINK_PAIR = "        limit_req zone=linkseite burst=60 nodelay;\n        limit_req zone=linkseite48 burst=600 nodelay;\n"


def link_page(url: str, text: str = SERVER_READ) -> Path:
    """An App Router tree holding one page at `url`, its module `text`."""
    app = new_root("check-public-routes-") / "app"
    app.mkdir(parents=True)
    write(app, url.strip("/") + "/page.tsx", text)
    return app


def unmetered(app: Path, where: tuple) -> list:
    """What the link-page rule says about a planted tree and a planted set of locations."""
    return routes.unmetered_links(routes.link_pages(routes.pages(app)), where, app.parent, SOURCE)


@pytest.mark.parametrize(
    "text",
    [SERVER_READ, '"use client";\nexport default function Page() {\n  return useSearchParams().get("token");\n}\n'],
    ids=["server-page", "client-hook"],
)
def test_a_link_page_only_the_catch_all_answers_is_a_finding(text):
    """The page and its twin each, under both spellings of the read, the hook's being what a case-blind match exists for."""
    findings = unmetered(link_page("/neu", text), served(METERED, CATCH_ALL))

    assert severities(findings) == ["fail", "fail"]
    assert "/neu reaches `location /`" in details(findings)


def test_a_link_page_whose_twin_another_pair_meters_is_a_finding():
    """Metered is not enough: the twin's own zone pair passes any rule asking only for a `limit_req`."""
    where = served(block("location = /neu", LINK_PAIR, PASS), exact("/neu/"), CATCH_ALL)

    findings = unmetered(link_page("/neu"), where)

    assert severities(findings) == ["fail"]
    assert "/neu/ reaches `location = /neu/`" in details(findings)


MINTER = 'const NEU_PATH = "/neuhilfe";\nexport const neuLink = (origin: string, token: string) => `${origin}${NEU_PATH}?token=${token}`;\n'


def helper_read_page() -> Path:
    """A tree whose page at `/neuhilfe` reads its token through a sibling module, and a module minting its link."""
    app = link_page(
        "/neuhilfe",
        'import { linkSchluessel } from "./linkLesen";\nexport default async function Page(props) {\n  return linkSchluessel(props);\n}\n',
    )
    write(app, "neuhilfe/linkLesen.ts", "export const linkSchluessel = async (props) => (await props.searchParams).token;\n")
    write(app.parent, "core/neuLink.ts", MINTER)
    return app


def test_a_link_page_reading_its_token_through_another_module_is_found_by_its_minter(monkeypatch, capsys):
    """Through `main`, where the two listings are joined: the page's own module names neither word the reader matches."""
    app = helper_read_page()
    assert routes.link_pages(routes.pages(app)) == (), "the page names its token itself, so this case tests the reader instead"

    assert run_main(app, "server {\n" + CATCH_ALL + "}\n", monkeypatch) == 1
    assert "/neuhilfe reaches `location /`" in capsys.readouterr().out


def test_a_link_minted_to_a_path_no_page_answers_is_a_finding(monkeypatch, capsys):
    """Otherwise a minter pointing past its page drops out of the listing, and the page with it."""
    app = link_page("/neuhilfe-alt", "export default function Page() {}\n")
    write(app.parent, "core/neuLink.ts", MINTER)

    assert run_main(app, "server {\n" + CATCH_ALL + "}\n", monkeypatch) == 1
    assert "core/neuLink.ts mints a link to /neuhilfe, which no page" in capsys.readouterr().out


RECORD_LINK = "export const neuLink = (origin: string, art: Art, token: string) => `${origin}${NEU_PFAD[art]}?token=${token}`;\n"


def test_a_link_through_a_record_of_paths_mints_one_to_each_of_its_values():
    """The key is a run-time value, so every value is a page some mail opens; a quoted key spells the same record."""
    root = new_root("check-public-routes-")
    record = 'const NEU_PFAD: Readonly<Record<Art, string>> = {\n  eins: "/neuhilfe",\n  "zwei": "/neuhilfe/zwei",\n};\n'
    write(root, "core/neuLink.ts", record + RECORD_LINK)

    assert [path for _, path in routes.minted(root)] == ["/neuhilfe", "/neuhilfe/zwei"]


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
def test_a_minted_link_this_reader_cannot_place_refuses(monkeypatch, text):
    """A minter it skipped would drop its page from the listing, which reads as a tree with one link page fewer.

    A record is placed whole or not at all: dropping the value it cannot read drops that value's page.
    """
    app = link_page("/neuhilfe")
    write(app.parent, "core/neuLink.ts", text)

    assert run_main(app, "server {\n" + CATCH_ALL + "}\n", monkeypatch) == routes.EXIT_REFUSED


@pytest.mark.parametrize("suffix", [".ts", ".tsx", ".js", ".jsx"])
def test_a_test_file_holding_a_token_query_mints_nothing(suffix):
    """Every extension the walk reads: a fixture is no minter."""
    root = new_root("check-public-routes-")
    write(root, f"core/neuLink.test{suffix}", "const fixture = `/neuhilfe?token=kein-echtes-token`;\n")

    assert routes.minted(root) == ()


def test_a_link_block_metering_the_link_zone_on_another_burst_is_a_finding():
    """One above the shared burst, which a paired probe at the edge reads the same as a refill."""
    uneven = LINK_PAIR.replace("burst=60 ", "burst=61 ")
    where = served(block("location = /neu", LINK_PAIR, PASS), block("location = /neu/", uneven, PASS), CATCH_ALL)

    findings = routes.uneven_links(where, SOURCE)

    assert severities(findings) == ["fail"]
    assert "`location = /neu/` meters linkseite with `limit_req zone=linkseite burst=61 nodelay`" in details(findings)


def test_the_repository_own_link_pages_are_on_the_link_pair():
    """The resting state the red cases are measured against, its count pinned.

    Each listing finds the seven alone, so a page refactored to read its token elsewhere stays found by its minter.
    """
    _, where, name = repository_own()
    app = routes.REPO_ROOT / routes.APP_ROUTER
    paged = routes.pages(app)
    opened, unopened = routes.minted_pages(routes.minted(app.parent), paged, routes.REPO_ROOT)
    reading = routes.link_pages(paged)

    assert unopened == []
    assert len(opened) == 7
    assert set(opened) == set(reading)
    assert routes.unmetered_links(opened, where, routes.REPO_ROOT, name) == []
    assert routes.uneven_links(where, name) == []


def test_the_repository_own_exact_matches_all_name_something():
    """The real pair, where the page locations and the recorded probe are what a handler walk misses."""
    found, where, _ = repository_own()
    app = routes.REPO_ROOT / routes.APP_ROUTER

    answering = found + routes.pages(app)
    served_here = routes.metadata(app)

    assert routes.orphaned(where, answering, served_here) == []
    assert routes.undeclared(where, answering, served_here) == []


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


# `re.search` because the patterns below are the refusal's own wording, not the whole of it.
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


def test_a_named_location_an_error_page_sends_to_is_read_as_no_route():
    """Reached by the redirect alone, it covers no handler and names none, so it is neither coverage nor an orphan."""
    found = served("    error_page 429 = @refusal;\n", block("location @refusal", PASS), CATCH_ALL)

    assert [location.path for location in found] == ["/"]


def test_an_error_page_sending_to_no_named_location_refuses():
    """nginx refuses the redirect at its first use, and this reader would otherwise read the file as whole."""
    try:
        served("    error_page 429 = @refusal;\n", CATCH_ALL)
    except routes.NginxSyntax as refusal:
        assert re.search("@refusal", str(refusal)), refusal
    else:
        raise AssertionError("an error_page naming no location was read as whole")


def test_a_variable_error_page_reaches_every_location_its_map_names():
    """Read through the http level's map, so neither the page nor the sentence reads as unreached."""
    text = "server {\n    error_page 429 = $ziel;\n" + block("location @seite", PASS) + block("location @satz", PASS) + CATCH_ALL + "}\n"
    maps = routes.map_values(routes.parse("map $request_method $ziel {\n    GET @seite;\n    default @satz;\n}\n", SOURCE))

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
    try:
        routes.locations(routes.parse(text, SOURCE), SOURCE, maps)
    except routes.NginxSyntax as refusal:
        assert re.search(named, str(refusal)), refusal
    else:
        raise AssertionError("a variable error_page was read as whole")


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
    found = served(block("location ^~ /api/beispiel/", PASS))

    assert [(one.exact, one.path) for one in found] == [(False, "/api/beispiel/")]


def test_a_server_body_file_is_read_at_its_top_level():
    """`nginx/shared/site.conf` is a server's body, included inside each entry file's `server`."""
    found = routes.locations(routes.parse(prefix("/api/") + CATCH_ALL, SOURCE), SOURCE)
    assert [one.path for one in found] == ["/api/", "/"]


def test_locations_at_the_top_and_inside_a_server_refuse():
    text = prefix("/api/") + "server {\n" + CATCH_ALL + "}\n"
    try:
        routes.locations(routes.parse(text, SOURCE), SOURCE)
    except routes.NginxSyntax as refusal:
        assert re.search("both at the top and inside a server block", str(refusal)), refusal
    else:
        raise AssertionError("locations at two levels were read")


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


def repository_own() -> tuple:
    """The real App Router tree and the real edge configuration, read as the gate reads them."""
    conf = routes.REPO_ROOT / routes.NGINX_CONF
    return routes.handlers(routes.REPO_ROOT / routes.APP_ROUTER), routes.edge_locations(conf), conf.name


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


def test_the_repository_own_metadata_conventions_are_accounted_for():
    """The three real files, so a convention filed or dropped here fails before the gate reports it."""
    served = routes.metadata(routes.REPO_ROOT / routes.APP_ROUTER)

    assert set(served) == set(routes.METADATA)
    assert routes.unclaimed(served) == []


def run_main(app: Path, text: str, monkeypatch) -> int:
    """One end-to-end run over a planted pair, where the exit contract is decided.

    The real reasons and conventions are withdrawn, or a run answers for what this tree does not
    hold rather than the shape its case planted.
    """
    monkeypatch.setattr(routes, "REASONS", ())
    monkeypatch.setattr(routes, "METADATA", ())
    monkeypatch.setattr(routes, "ELSEWHERE", ())
    conf = app.parent / SOURCE
    conf.write_bytes(text.encode("utf-8"))
    # The http level beside it, holding no map: no planted case sends an error_page through one.
    (app.parent / routes.NGINX_HTTP_CONF).write_bytes(b"")
    monkeypatch.setattr(sys, "argv", ["check_public_routes.py", str(app), str(conf)])
    return routes.main()


def test_a_clean_pair_exits_zero(monkeypatch):
    """The contract's passing arm, and what the gate's docs section reads as a green step."""
    app = tree("/api/bewerbung")

    assert run_main(app, "server {\n" + METERED + CATCH_ALL + "}\n", monkeypatch) == 0


def test_an_orphan_pair_reaches_the_exit_contract(monkeypatch):
    """The rule reaches a reader through `main` alone, and a run that never calls it exits zero."""
    app = tree("/api/bewerbung")

    assert run_main(app, "server {\n" + METERED + GONE + CATCH_ALL + "}\n", monkeypatch) == 1


def test_a_pair_a_page_answers_reaches_the_exit_contract_too(monkeypatch):
    """The other half of that wiring: the page walk decides this run, and without it the pair is an orphan."""
    app = tree("/signin", file="page.tsx")

    assert run_main(app, "server {\n" + exact("/signin") + exact("/signin/") + CATCH_ALL + "}\n", monkeypatch) == 0


def test_an_unmetered_link_page_reaches_the_exit_contract(monkeypatch):
    """The link-page rule reaches a reader through `main` alone, and a run that never calls it exits zero.

    The catch-all alone, since an exact match the planted tree does not answer is a finding of its own.
    """
    app = link_page("/neu")

    assert run_main(app, "server {\n" + CATCH_ALL + "}\n", monkeypatch) == 1


def test_an_uneven_link_burst_reaches_the_exit_contract(monkeypatch):
    """The burst rule reaches a reader through `main` alone; every other rule passes this pair."""
    app = link_page("/neu")
    uneven = LINK_PAIR.replace("burst=60 ", "burst=61 ")
    text = "server {\n" + block("location = /neu", LINK_PAIR, PASS) + block("location = /neu/", uneven, PASS) + CATCH_ALL + "}\n"

    assert run_main(app, text, monkeypatch) == 1
    assert run_main(app, text.replace("burst=61 ", "burst=60 "), monkeypatch) == 0


def test_a_finding_exits_one(monkeypatch):
    """Held over `scripts/checks/check_public_routes.py :: main`, for `scripts/lib/checker_kernel.py :: EXIT_FINDINGS`'s reason."""
    app = tree("/api/mail/zustellung")

    assert run_main(app, "server {\n" + METERED + CATCH_ALL + "}\n", monkeypatch) == 1


def test_a_construct_it_cannot_parse_exits_two(monkeypatch):
    """A refusal collapsed into a failure sends a reader to repair the routes rather than the reader."""
    app = tree("/api/bewerbung")
    text = "server {\n" + block("location ~ ^/api/", PASS) + "}\n"

    assert run_main(app, text, monkeypatch) == routes.EXIT_REFUSED


def test_a_metadata_file_this_reader_cannot_place_exits_two(monkeypatch):
    """The gap the population closes, at the exit contract: the next metadata route ends the run."""
    app = with_files("api/bewerbung/route.ts", "twitter-image.tsx")

    assert run_main(app, "server {\n" + METERED + CATCH_ALL + "}\n", monkeypatch) == routes.EXIT_REFUSED


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
